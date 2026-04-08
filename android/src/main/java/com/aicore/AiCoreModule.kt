package com.aicore

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import com.google.mediapipe.tasks.genai.llminference.ProgressListener
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class AiCoreModule(reactContext: ReactApplicationContext) :
  NativeAiCoreSpec(reactContext) {

  @Volatile private var mlkitModel: GenerativeModel? = null
  @Volatile private var llmInference: LlmInference? = null

  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

  private val conversationHistory = mutableListOf<Pair<String, String>>()
  @Volatile private var cancelRequested = false
  @Volatile private var activeGenerationJob: Job? = null

  companion object {
    const val NAME = NativeAiCoreSpec.NAME
    const val EVENT_STREAM_TOKEN    = "AICore_streamToken"
    const val EVENT_STREAM_COMPLETE = "AICore_streamComplete"
    const val EVENT_STREAM_ERROR    = "AICore_streamError"
    private const val DEFAULT_TEMPERATURE      = 0.7f
    private const val DEFAULT_MAX_TOKENS        = 4096  // MediaPipe context window (input+output)
    private const val REQUESTED_MAX_OUTPUT_TOKENS = 256
    private const val FALLBACK_MAX_OUTPUT_TOKENS = 256
    private const val DEFAULT_TOP_K             = 40
    private const val PROMPT_CHAR_BUDGET        = 4000
    private const val HISTORY_MAX_CHARS         = 9000
    private const val MAX_CONTINUATIONS         = 12
    private const val MAX_STREAM_IDLE_RETRIES   = 3
    private const val QUOTA_ERROR_CODE          = 9  // AICore NPU quota exceeded error code
    private const val CONTINUATION_DELAY_MS     = 1200L
    private const val QUOTA_RETRY_DELAY_MS      = 1800L
    private const val MAX_QUOTA_RETRIES         = 2
    private const val MAX_NON_STREAM_QUOTA_RETRIES = 6
    private const val BACKGROUND_RETRY_DELAY_MS  = 2000L
    private const val MAX_BACKGROUND_RETRIES     = 1
    private const val CONTINUATION_PROMPT       = "Continue exactly from the last generated character. Do not repeat, restart, summarize, explain, or add headings. Output only the direct continuation."
    private const val END_MARKER                = "-E-"
    private const val END_MARKER_INSTRUCTION    = "[INTERNAL] Append $END_MARKER only once at the true end of the final answer. Never use it before the end."
    private val STANDARD_MODEL_PATHS = listOf(
      "/data/local/tmp/gemini-nano.bin",
      "/sdcard/Download/gemini-nano.bin"
    )
  }

  @Synchronized
  private fun buildContextualPrompt(userPrompt: String): String {
    return buildPromptWithBudget(userPrompt, null, END_MARKER_INSTRUCTION)
  }

  @Synchronized
  private fun saveToHistory(userPrompt: String, assistantResponse: String) {
    conversationHistory.add(Pair(userPrompt, assistantResponse))
    var total = conversationHistory.sumOf { it.first.length + it.second.length }
    while (total > HISTORY_MAX_CHARS && conversationHistory.size > 1) {
      val removed = conversationHistory.removeAt(0)
      total -= removed.first.length + removed.second.length
    }
  }

  @Synchronized
  private fun resetHistory() {
    conversationHistory.clear()
  }

  private fun trimFromStart(text: String, maxChars: Int): String {
    if (text.length <= maxChars) return text
    return text.takeLast(maxChars)
  }

  private fun trimFromEnd(text: String, maxChars: Int): String {
    if (text.length <= maxChars) return text
    return text.take(maxChars)
  }

  @Synchronized
  private fun buildPromptWithBudget(
    userPrompt: String,
    assistantPrefix: String?,
    hiddenUserPrompt: String?
  ): String {
    val hiddenInstruction = hiddenUserPrompt?.let { "\n$it\nAssistant:" } ?: ""
    val assistantBase = "\nAssistant:"
    val normalizedUserPrompt = trimFromEnd(userPrompt, PROMPT_CHAR_BUDGET)
    val historySnapshot = conversationHistory.toMutableList()

    while (true) {
      val sb = StringBuilder()
      for ((u, a) in historySnapshot) {
        sb.append("User: ").append(u).append("\nAssistant: ").append(a).append("\n")
      }
      sb.append("User: ").append(normalizedUserPrompt).append(assistantBase)
      if (assistantPrefix != null) {
        sb.append(' ').append(assistantPrefix)
      }
      sb.append(hiddenInstruction)

      val candidate = sb.toString()
      if (candidate.length < PROMPT_CHAR_BUDGET || historySnapshot.isEmpty()) {
        if (candidate.length <= PROMPT_CHAR_BUDGET) return candidate

        val fixedPrefix = "User: $normalizedUserPrompt$assistantBase"
        val availableForAssistant = (PROMPT_CHAR_BUDGET - fixedPrefix.length - hiddenInstruction.length - 1)
          .coerceAtLeast(0)
        val trimmedAssistantPrefix = assistantPrefix?.let { trimFromStart(it, availableForAssistant) }

        return buildString {
          append(fixedPrefix)
          if (trimmedAssistantPrefix != null && trimmedAssistantPrefix.isNotEmpty()) {
            append(' ').append(trimmedAssistantPrefix)
          }
          append(hiddenInstruction)
        }
      }

      historySnapshot.removeAt(0)
    }
  }

  private fun shouldContinueResponse(text: String): Boolean {
    if (text.isBlank()) return false
    val trimmed = text.trimEnd()
    return !(trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?'))
  }

  private fun buildContinuationPrompt(originalUserPrompt: String, partialResponse: String): String {
    return buildPromptWithBudget(
      originalUserPrompt,
      partialResponse,
      "$CONTINUATION_PROMPT\n$END_MARKER_INSTRUCTION"
    )
  }

  private fun containsEndMarker(text: String): Boolean {
    return text.contains(END_MARKER)
  }

  private fun stripEndMarker(text: String): String {
    return text.replace(END_MARKER, "")
  }

  private fun sanitizeVisibleText(text: String): String {
    var cleaned = text
    cleaned = cleaned.replace(Regex("(?i)\\[\\s*internal\\s*\\][^\\n\\r]*"), "")
    cleaned = cleaned.replace(Regex("(?i)append\\s+\\Q$END_MARKER\\E[^\\n\\r]*"), "")
    cleaned = cleaned.replace(Regex("(?i)never use it before the end\\.?"), "")
    return cleaned
  }

  private fun adjustChunkBoundary(existing: String, incoming: String): String {
    if (incoming.isEmpty() || existing.isEmpty()) return incoming

    var chunk = incoming
    val last = existing.last()
    val first = chunk.first()

    if (last.isLetterOrDigit() && first.isLetterOrDigit()) {
      chunk = " $chunk"
    }

    if (existing.last() == ' ' && chunk.firstOrNull() == ' ') {
      chunk = chunk.trimStart(' ')
    }

    return chunk
  }

  private fun emitStreamToken(token: String, done: Boolean) {
    sendEvent(EVENT_STREAM_TOKEN, Arguments.createMap().apply {
      putString("token", token)
      putBoolean("done", done)
    })
  }

  private fun isOutOfRangeError(error: Throwable): Boolean {
    return error.message?.contains("out of range", ignoreCase = true) == true
  }

  private fun isQuotaError(error: Throwable): Boolean {
    return error is GenAiException && error.errorCode == QUOTA_ERROR_CODE
  }

  private fun isBackgroundError(error: Throwable): Boolean {
    val msg = error.message?.lowercase() ?: ""
    return msg.contains("background usage is blocked") ||
           msg.contains("use the api when your app is in the foreground")
  }

  private suspend fun generateMlKitChunk(model: GenerativeModel, prompt: String): String {
    var quotaRetries = 0
    var backgroundRetries = 0
    while (true) {
      try {
        val request = generateContentRequest(TextPart(prompt)) {
          maxOutputTokens = REQUESTED_MAX_OUTPUT_TOKENS
        }
        return model.generateContent(request).candidates.firstOrNull()?.text ?: ""
      } catch (error: Exception) {
        if (isQuotaError(error) && quotaRetries < MAX_QUOTA_RETRIES) {
          quotaRetries++
          delay(QUOTA_RETRY_DELAY_MS)
          continue
        }
        if (isBackgroundError(error) && backgroundRetries < MAX_BACKGROUND_RETRIES) {
          backgroundRetries++
          delay(BACKGROUND_RETRY_DELAY_MS)
          continue
        }
        if (!isOutOfRangeError(error)) throw error
        while (true) {
          try {
            val fallbackRequest = generateContentRequest(TextPart(prompt)) {
              maxOutputTokens = FALLBACK_MAX_OUTPUT_TOKENS
            }
            return model.generateContent(fallbackRequest).candidates.firstOrNull()?.text ?: ""
          } catch (fallbackError: Exception) {
            if (isQuotaError(fallbackError) && quotaRetries < MAX_QUOTA_RETRIES) {
              quotaRetries++
              delay(QUOTA_RETRY_DELAY_MS)
              continue
            }
            throw fallbackError
          }
        }
      }
    }
  }

  private suspend fun streamMlKitChunk(
    model: GenerativeModel,
    prompt: String,
    onToken: (String) -> Unit
  ): Boolean {
    suspend fun collectWithLimit(limit: Int): Boolean {
      var quotaRetries = 0
      var backgroundRetries = 0
      while (true) {
        var quotaHit = false
        var backgroundHit = false
        val request = generateContentRequest(TextPart(prompt)) {
          maxOutputTokens = limit
        }
        try {
          model.generateContentStream(request)
            .catch { error ->
              if (isQuotaError(error)) {
                quotaHit = true
              } else if (isBackgroundError(error)) {
                backgroundHit = true
              } else {
                throw error
              }
            }
            .collect { chunk ->
              val token = chunk.candidates.firstOrNull()?.text ?: ""
              onToken(token)
            }
        } catch (error: Exception) {
          if (isQuotaError(error)) {
            quotaHit = true
          } else if (isBackgroundError(error)) {
            backgroundHit = true
          } else {
            throw error
          }
        }
        if (!quotaHit && !backgroundHit) return false
        if (quotaHit) {
          if (quotaRetries >= MAX_QUOTA_RETRIES) return true
          quotaRetries++
          delay(QUOTA_RETRY_DELAY_MS)
        } else {
          if (backgroundRetries >= MAX_BACKGROUND_RETRIES) return false
          backgroundRetries++
          delay(BACKGROUND_RETRY_DELAY_MS)
        }
      }
    }

    return try {
      collectWithLimit(REQUESTED_MAX_OUTPUT_TOKENS)
    } catch (error: Exception) {
      if (!isOutOfRangeError(error)) throw error
      collectWithLimit(FALLBACK_MAX_OUTPUT_TOKENS)
    }
  }

  private fun sendEvent(name: String, params: WritableMap?) {
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, params)
  }

  private fun startInferenceService() {
    val intent = Intent(reactApplicationContext, InferenceService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactApplicationContext.startForegroundService(intent)
    } else {
      reactApplicationContext.startService(intent)
    }
  }

  private fun stopInferenceService() {
    val intent = Intent(reactApplicationContext, InferenceService::class.java).apply {
      action = InferenceService.ACTION_STOP
    }
    reactApplicationContext.startService(intent)
  }

  private fun createErrorMap(code: String, message: String): WritableMap =
    Arguments.createMap().apply {
      putString("code", code)
      putString("message", message)
    }

  private fun createMediaPipeSession(): LlmInferenceSession {
    val inference = llmInference ?: throw IllegalStateException("LLM not initialized.")
    val opts = LlmInferenceSession.LlmInferenceSessionOptions.builder()
      .setTemperature(DEFAULT_TEMPERATURE)
      .setTopK(DEFAULT_TOP_K)
      .build()
    return LlmInferenceSession.createFromOptions(inference, opts)
  }

  private fun buildPrompt(userPrompt: String, useConversationHistory: Boolean): String {
    return if (useConversationHistory) buildContextualPrompt(userPrompt) else userPrompt
  }

  private fun maybeSaveToHistory(
    userPrompt: String,
    assistantResponse: String,
    useConversationHistory: Boolean
  ) {
    if (useConversationHistory) {
      saveToHistory(userPrompt, assistantResponse)
    }
  }

  override fun initialize(modelPath: String, promise: Promise) {
    mlkitModel = null
    llmInference?.close()
    llmInference = null
    resetHistory()

    if (modelPath.isEmpty()) {
      coroutineScope.launch {
        try {
          val model = Generation.getClient()
          when (model.checkStatus()) {
            FeatureStatus.AVAILABLE -> {
              mlkitModel = model
              promise.resolve(true)
            }
            FeatureStatus.DOWNLOADABLE -> {
              model.download().collect { ds ->
                when (ds) {
                  DownloadStatus.DownloadCompleted -> {
                    mlkitModel = model
                    promise.resolve(true)
                  }
                  is DownloadStatus.DownloadFailed -> promise.reject("DOWNLOAD_FAILED", ds.e.message, ds.e)
                  else -> {}
                }
              }
            }
            FeatureStatus.DOWNLOADING -> promise.reject("ALREADY_DOWNLOADING", "Model download already in progress.")
            FeatureStatus.UNAVAILABLE -> promise.reject("AICORE_UNAVAILABLE", "Gemini Nano is not available on this device.")
            else -> promise.reject("AICORE_UNKNOWN", "Unknown AICore status.")
          }
        } catch (e: Exception) {
          promise.reject("AICORE_ERROR", e.message, e)
        }
      }
    } else {
      executor.execute {
        try {
          if (!File(modelPath).exists()) {
            promise.reject("MODEL_NOT_FOUND", "Model file not found at: $modelPath")
            return@execute
          }
          val options = LlmInference.LlmInferenceOptions.builder()
            .setModelPath(modelPath)
            .setMaxTokens(DEFAULT_MAX_TOKENS)
            .setPreferredBackend(LlmInference.Backend.DEFAULT)
            .build()
          llmInference = LlmInference.createFromOptions(reactApplicationContext, options)
          promise.resolve(true)
        } catch (e: UnsupportedOperationException) {
          promise.reject("NPU_UNSUPPORTED", e.message, e)
        } catch (e: RuntimeException) {
          promise.reject("INIT_FAILED", e.message, e)
        } catch (e: Exception) {
          promise.reject("INIT_ERROR", e.message, e)
        }
      }
    }
  }

  override fun generateResponse(prompt: String, promise: Promise) {
    generateResponseInternal(prompt, true, promise)
  }

  override fun generateResponseStateless(prompt: String, promise: Promise) {
    generateResponseInternal(prompt, false, promise)
  }

  private fun generateResponseInternal(
    prompt: String,
    useConversationHistory: Boolean,
    promise: Promise
  ) {
    val mlkit = mlkitModel
    val mediapipe = llmInference
    startInferenceService()
    cancelRequested = false
    when {
      mlkit != null -> coroutineScope.launch {
        try {
          val rawTotal = StringBuilder()
          val visibleTotal = StringBuilder()
          var currentPrompt = buildPrompt(prompt, useConversationHistory)
          var continuations = 0
          var continuationJoinPending = false
          var quotaRetries = 0
          while (true) {
            if (cancelRequested) {
              stopInferenceService()
              promise.reject("CANCELLED", "Generation cancelled.")
              return@launch
            }
            val part = try {
              generateMlKitChunk(mlkit, currentPrompt)
            } catch (e: GenAiException) {
              if (e.errorCode == QUOTA_ERROR_CODE) {
                if (quotaRetries < MAX_NON_STREAM_QUOTA_RETRIES) {
                  quotaRetries++
                  delay(QUOTA_RETRY_DELAY_MS)
                  continue
                }
                if (rawTotal.isNotEmpty()) break
              }
              throw e
            }
            quotaRetries = 0
            rawTotal.append(part)
            if (containsEndMarker(rawTotal.toString())) break

            val cleanPart = sanitizeVisibleText(stripEndMarker(part))
            val partForUi = if (continuationJoinPending) {
              continuationJoinPending = false
              adjustChunkBoundary(visibleTotal.toString(), cleanPart)
            } else {
              cleanPart
            }
            visibleTotal.append(partForUi)
            val visible = visibleTotal.toString()
            if (
              useConversationHistory &&
              shouldContinueResponse(visible) &&
              continuations < MAX_CONTINUATIONS
            ) {
              currentPrompt = buildContinuationPrompt(prompt, visible)
              continuations++
              continuationJoinPending = true
              delay(CONTINUATION_DELAY_MS)
            } else break
          }
          val full = if (visibleTotal.isNotEmpty()) {
            sanitizeVisibleText(visibleTotal.toString())
          } else {
            sanitizeVisibleText(stripEndMarker(rawTotal.toString()))
          }
          maybeSaveToHistory(prompt, full, useConversationHistory)
          stopInferenceService()
          promise.resolve(full)
        } catch (e: Exception) {
          if (cancelRequested) {
            stopInferenceService()
            promise.reject("CANCELLED", "Generation cancelled.")
          } else {
            stopInferenceService()
            promise.reject("GENERATION_ERROR", e.message, e)
          }
        }
      }.also { activeGenerationJob = it }
      mediapipe != null -> executor.execute {
        var session: LlmInferenceSession? = null
        try {
          val rawTotal = StringBuilder()
          val visibleTotal = StringBuilder()
          var currentPrompt = buildPrompt(prompt, useConversationHistory)
          var continuations = 0
          var continuationJoinPending = false
          while (true) {
            if (cancelRequested) {
              stopInferenceService()
              promise.reject("CANCELLED", "Generation cancelled.")
              return@execute
            }
            session = createMediaPipeSession()
            session.addQueryChunk(currentPrompt)
            val part = session.generateResponse()
            session.close()
            session = null
            rawTotal.append(part)
            if (containsEndMarker(rawTotal.toString())) break

            val cleanPart = sanitizeVisibleText(stripEndMarker(part))
            val partForUi = if (continuationJoinPending) {
              continuationJoinPending = false
              adjustChunkBoundary(visibleTotal.toString(), cleanPart)
            } else {
              cleanPart
            }
            visibleTotal.append(partForUi)
            val visible = visibleTotal.toString()
            if (
              useConversationHistory &&
              shouldContinueResponse(visible) &&
              continuations < MAX_CONTINUATIONS
            ) {
              currentPrompt = buildContinuationPrompt(prompt, visible)
              continuations++
              continuationJoinPending = true
            } else break
          }
          val full = if (visibleTotal.isNotEmpty()) {
            sanitizeVisibleText(visibleTotal.toString())
          } else {
            sanitizeVisibleText(stripEndMarker(rawTotal.toString()))
          }
          maybeSaveToHistory(prompt, full, useConversationHistory)
          stopInferenceService()
          promise.resolve(full)
        } catch (e: Exception) {
          stopInferenceService()
          promise.reject("GENERATION_ERROR", e.message, e)
        } finally {
          session?.close()
        }
      }
      else -> promise.reject("NOT_INITIALIZED", "LLM not initialized.")
    }
  }

  override fun generateResponseStream(prompt: String) {
    val mlkit = mlkitModel
    val mediapipe = llmInference
    startInferenceService()
    cancelRequested = false
    when {
      mlkit != null -> coroutineScope.launch {
        val total = StringBuilder()
        val rawTotal = StringBuilder()
        var currentPrompt = buildContextualPrompt(prompt)
        var continuations = 0
        var continuationJoinPending = false
        var firstDeltaInPass = false
        var idleRetries = 0
        var streamError = false
        var markerReached = false
        try {
          while (true) {
            if (cancelRequested) break
            val beforeLength = total.length
            firstDeltaInPass = true
            var quotaHit = false
            try {
              quotaHit = streamMlKitChunk(mlkit, currentPrompt) { token ->
                rawTotal.append(token)
                if (containsEndMarker(rawTotal.toString())) {
                  markerReached = true
                }

                val visibleNow = sanitizeVisibleText(stripEndMarker(rawTotal.toString()))
                if (visibleNow.length > total.length) {
                  val delta = visibleNow.substring(total.length)
                  val adjustedDelta = if (continuationJoinPending && firstDeltaInPass) {
                    continuationJoinPending = false
                    firstDeltaInPass = false
                    adjustChunkBoundary(total.toString(), delta)
                  } else {
                    firstDeltaInPass = false
                    delta
                  }
                  if (adjustedDelta.isNotEmpty()) {
                    total.append(adjustedDelta)
                    emitStreamToken(adjustedDelta, false)
                  }
                }
              }
            } catch (e: GenAiException) {
              if (e.errorCode == QUOTA_ERROR_CODE && total.isNotEmpty()) {
                quotaHit = true
              } else {
                throw e
              }
            } catch (e: Exception) {
              if (cancelRequested) break
              streamError = true
              stopInferenceService()
              sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", e.message ?: "Error"))
              break
            }
            if (streamError) return@launch
            if (markerReached) break

            val appendedNewText = total.length > beforeLength
            if (!appendedNewText && shouldContinueResponse(total.toString()) && idleRetries < MAX_STREAM_IDLE_RETRIES) {
              idleRetries++
              currentPrompt = buildContinuationPrompt(prompt, total.toString())
              continuationJoinPending = true
              delay(if (quotaHit) QUOTA_RETRY_DELAY_MS else CONTINUATION_DELAY_MS)
              continue
            }

            idleRetries = 0
            if (shouldContinueResponse(total.toString()) && continuations < MAX_CONTINUATIONS) {
              currentPrompt = buildContinuationPrompt(prompt, total.toString())
              continuations++
              continuationJoinPending = true
              delay(if (quotaHit) QUOTA_RETRY_DELAY_MS else CONTINUATION_DELAY_MS)
            } else break
          }
          if (!cancelRequested) saveToHistory(prompt, sanitizeVisibleText(total.toString()))
          emitStreamToken("", true)
          stopInferenceService()
          sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
        } catch (e: Exception) {
          if (cancelRequested) {
            emitStreamToken("", true)
            stopInferenceService()
            sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
          } else if (!streamError) {
            stopInferenceService()
            sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", e.message ?: "Error"))
          }
        }
      }.also { activeGenerationJob = it }
      mediapipe != null -> executor.execute {
        val total = StringBuilder()
        val rawTotal = StringBuilder()
        var currentPrompt = buildContextualPrompt(prompt)
        var continuations = 0
        var continuationJoinPending = false
        var firstDeltaInPass = false
        var session: LlmInferenceSession? = null
        var markerReached = false
        try {
          while (true) {
            if (cancelRequested) break
            val latch = CountDownLatch(1)
            firstDeltaInPass = true
            session = createMediaPipeSession()
            val capturedSession = session
            session.addQueryChunk(currentPrompt)
            session.generateResponseAsync(ProgressListener<String> { partial, done ->
              if (cancelRequested) {
                capturedSession.close()
                latch.countDown()
                return@ProgressListener
              }
              val token = partial ?: ""
              rawTotal.append(token)
              if (containsEndMarker(rawTotal.toString())) {
                markerReached = true
              }

              val visibleNow = sanitizeVisibleText(stripEndMarker(rawTotal.toString()))
              if (visibleNow.length > total.length) {
                val delta = visibleNow.substring(total.length)
                val adjustedDelta = if (continuationJoinPending && firstDeltaInPass) {
                  continuationJoinPending = false
                  firstDeltaInPass = false
                  adjustChunkBoundary(total.toString(), delta)
                } else {
                  firstDeltaInPass = false
                  delta
                }
                if (adjustedDelta.isNotEmpty()) {
                  total.append(adjustedDelta)
                  emitStreamToken(adjustedDelta, false)
                }
              }
              if (done) {
                capturedSession.close()
                latch.countDown()
              }
            })
            latch.await()
            session = null
            if (markerReached) break
            if (shouldContinueResponse(total.toString()) && continuations < MAX_CONTINUATIONS) {
              currentPrompt = buildContinuationPrompt(prompt, total.toString())
              continuations++
              continuationJoinPending = true
            } else break
          }
          if (!cancelRequested) saveToHistory(prompt, sanitizeVisibleText(total.toString()))
          emitStreamToken("", true)
          stopInferenceService()
          sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
        } catch (e: Exception) {
          session?.close()
          if (cancelRequested) {
            emitStreamToken("", true)
            stopInferenceService()
            sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
          } else {
            stopInferenceService()
            sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", e.message ?: "Error"))
          }
        }
      }
      else -> sendEvent(EVENT_STREAM_ERROR, createErrorMap("NOT_INITIALIZED", "LLM not initialized."))
    }
  }

  override fun checkAvailability(promise: Promise) {
    coroutineScope.launch {
      try {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
          promise.resolve("UNSUPPORTED")
          return@launch
        }
        if (mlkitModel != null) { promise.resolve("AVAILABLE_NPU"); return@launch }
        if (llmInference != null) { promise.resolve("AVAILABLE"); return@launch }
        when (Generation.getClient().checkStatus()) {
          FeatureStatus.AVAILABLE -> promise.resolve("AVAILABLE_NPU")
          FeatureStatus.DOWNLOADABLE, FeatureStatus.DOWNLOADING -> promise.resolve("NEED_DOWNLOAD")
          FeatureStatus.UNAVAILABLE -> {
            val appPath = "${reactApplicationContext.filesDir}/gemini-nano.bin"
            val found = (STANDARD_MODEL_PATHS + appPath).any { File(it).exists() }
            promise.resolve(if (found) "AVAILABLE" else "UNSUPPORTED")
          }
          else -> promise.resolve("UNSUPPORTED")
        }
      } catch (e: Exception) {
        promise.reject("AVAILABILITY_ERROR", e.message, e)
      }
    }
  }

  override fun release(promise: Promise) {
    executor.execute {
      try {
        mlkitModel = null
        llmInference?.close()
        llmInference = null
        resetHistory()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("RELEASE_ERROR", e.message, e)
      }
    }
  }

  override fun resetConversation(promise: Promise) {
    resetHistory()
    promise.resolve(null)
  }

  override fun cancelGeneration(promise: Promise) {
    cancelRequested = true
    activeGenerationJob?.cancel()
    promise.resolve(null)
  }

  override fun addListener(eventName: String) {}
  override fun removeListeners(count: Double) {}

  override fun invalidate() {
    super.invalidate()
    try {
      stopInferenceService()
      llmInference?.close()
      llmInference = null
      mlkitModel = null
    } finally {
      executor.shutdown()
      coroutineScope.cancel()
    }
  }
}
