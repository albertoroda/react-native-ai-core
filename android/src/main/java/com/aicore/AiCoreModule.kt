package com.aicore

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
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
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.SamplerConfig
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AiCoreModule(reactContext: ReactApplicationContext) :
  NativeAiCoreSpec(reactContext) {

  @Volatile private var mlkitModel: GenerativeModel? = null
  @Volatile private var llmInference: LlmInference? = null
  @Volatile private var litertlmEngine: Engine? = null
  @Volatile private var litertlmConversation: Conversation? = null

  // ── Engine state tracking ─────────────────────────────────────────────────
  @Volatile private var currentEngineName: String = ""
  @Volatile private var currentModelPath: String = ""
  @Volatile private var systemPrompt: String? = null

  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())

  private val conversationHistory = mutableListOf<Pair<String, String>>()
  @Volatile private var cancelRequested = false
  @Volatile private var activeGenerationJob: Job? = null

  // ── Download state ────────────────────────────────────────────────────────
  @Volatile private var downloadCancelRequested = false
  @Volatile private var activeDownloadCall: okhttp3.Call? = null
  private val downloadExecutor: ExecutorService = Executors.newSingleThreadExecutor()

  // Guard against closing the LiteRT-LM engine while native inference is in
  // flight — a concurrent close() causes SIGSEGV in the native thread.
  @Volatile private var inferenceInFlight = false

  // ── Runtime-configurable inference parameters ─────────────────────────────
  // Defaults mirror the companion-object constants; updated via configure().
  @Volatile private var inferenceTimeoutSec: Long = DEFAULT_INFERENCE_TIMEOUT_SEC
  @Volatile private var configTemperature: Float  = DEFAULT_TEMPERATURE_VALUE
  @Volatile private var configTopK: Int           = DEFAULT_TOP_K_VALUE
  @Volatile private var configMaxContinuations: Int = DEFAULT_MAX_CONTINUATIONS
  @Volatile private var configEnableVision: Boolean = false

  companion object {
    const val NAME = NativeAiCoreSpec.NAME
    const val EVENT_STREAM_TOKEN      = "AICore_streamToken"
    const val EVENT_STREAM_COMPLETE   = "AICore_streamComplete"
    const val EVENT_STREAM_ERROR      = "AICore_streamError"
    const val EVENT_DOWNLOAD_PROGRESS = "AICore_downloadProgress"
    const val EVENT_STATELESS_TOKEN   = "AICore_statelessToken"
    private const val DEFAULT_MAX_TOKENS        = 4096  // MediaPipe context window (input+output)
    private const val LITERTLM_MAX_TOKENS       = 4096  // LiteRT-LM: context window (input+output)
    private const val REQUESTED_MAX_OUTPUT_TOKENS = 256
    private const val FALLBACK_MAX_OUTPUT_TOKENS = 256
    private const val PROMPT_CHAR_BUDGET        = 4000
    private const val HISTORY_MAX_CHARS         = 9000
    // ── Defaults for runtime-configurable parameters (see configure()) ────────
    private const val DEFAULT_TEMPERATURE_VALUE     = 0.7f
    private const val DEFAULT_TOP_K_VALUE           = 64
    private const val DEFAULT_INFERENCE_TIMEOUT_SEC = 420L  // 7 min — covers ~2500 tok @ 15 tok/s
    private const val DEFAULT_MAX_CONTINUATIONS     = 12
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
    val base = buildPromptWithBudget(userPrompt, null, END_MARKER_INSTRUCTION)
    val sp = systemPrompt ?: return base
    return "System: $sp\n\n$base"
  }

  // Gemma IT chat template: <start_of_turn>user\n…<end_of_turn>\n<start_of_turn>model\n
  @Synchronized
  private fun buildGemmaPrompt(userPrompt: String, useConversationHistory: Boolean): String {
    val sb = StringBuilder()
    // Inject system prompt as a system turn (supported by Gemma 3+ IT models)
    systemPrompt?.let { sp ->
      sb.append("<start_of_turn>system\n").append(sp).append("<end_of_turn>\n")
    }
    if (useConversationHistory) {
      for ((u, a) in conversationHistory) {
        sb.append("<start_of_turn>user\n").append(u).append("<end_of_turn>\n")
        sb.append("<start_of_turn>model\n").append(a).append("<end_of_turn>\n")
      }
    }
    sb.append("<start_of_turn>user\n").append(userPrompt).append("<end_of_turn>\n")
    sb.append("<start_of_turn>model\n")
    return sb.toString()
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
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        reactApplicationContext.startForegroundService(intent)
      } else {
        reactApplicationContext.startService(intent)
      }
    } catch (e: Exception) {
      // ForegroundServiceStartNotAllowedException (API 31+) or similar — app is
      // in a state where foreground services cannot be started (background
      // process limit, power-save mode, etc.). Log and continue without the
      // foreground service; inference will still work but may be suspended by
      // the OS if the app goes to background.
      android.util.Log.w("AiCore", "Could not start InferenceService: ${e.message}")
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
      .setTemperature(configTemperature)
      .setTopK(configTopK)
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

  @OptIn(ExperimentalApi::class)
  override fun initialize(modelPath: String, maxContextLength: Double, promise: Promise) {
    mlkitModel = null
    llmInference?.close()
    llmInference = null
    // Wait for any in-flight LiteRT-LM native call to finish before closing
    // the engine. Calling close() while a native thread is inside sendMessageAsync
    // causes a SIGSEGV in LiteRT-LM's C++ layer.
    val deadline = System.currentTimeMillis() + 5_000L
    while (inferenceInFlight && System.currentTimeMillis() < deadline) {
      Thread.sleep(50)
    }
    litertlmConversation?.close()
    litertlmConversation = null
    litertlmEngine?.close()
    litertlmEngine = null
    currentEngineName = ""
    currentModelPath = ""
    resetHistory()

    if (modelPath.isEmpty()) {
      coroutineScope.launch {
        try {
          val model = Generation.getClient()
          when (model.checkStatus()) {
            FeatureStatus.AVAILABLE -> {
              mlkitModel = model
              currentEngineName = "aicore"
              currentModelPath = ""
              promise.resolve(true)
            }
            FeatureStatus.DOWNLOADABLE -> {
              model.download().collect { ds ->
                when (ds) {
                  DownloadStatus.DownloadCompleted -> {
                    mlkitModel = model
                    currentEngineName = "aicore"
                    currentModelPath = ""
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
          val resolvedPath = if (modelPath.startsWith("~/")) {
            val extDir = reactApplicationContext.getExternalFilesDir(null)?.absolutePath ?: ""
            extDir + "/" + modelPath.removePrefix("~/")
          } else {
            modelPath
          }
          val modelFile = File(resolvedPath)
          android.util.Log.d("AiCore", "Checking model at: $resolvedPath (exists=${modelFile.exists()})")
          if (!modelFile.exists()) {
            promise.reject("MODEL_NOT_FOUND", "Model file not found at: $resolvedPath")
            return@execute
          }
          if (resolvedPath.endsWith(".litertlm")) {
            // Use CPU backend directly. GPU (OpenCL) is not available on Tensor G4
            // and initialize() does NOT throw — the OpenCL error only surfaces on
            // the first inference call, making GPU→CPU fallback at init impossible.
            val contextTokens = if (maxContextLength > 0.0) maxContextLength.toInt() else LITERTLM_MAX_TOKENS
            val samplerConfig = SamplerConfig(
              topK = configTopK,
              topP = 0.95,
              temperature = configTemperature.toDouble(),
            )
            val cfg = EngineConfig(
              modelPath = resolvedPath,
              backend = Backend.CPU(),
              visionBackend = if (configEnableVision) Backend.GPU() else null,
              maxNumTokens = contextTokens,
              cacheDir = reactApplicationContext.getExternalFilesDir(null)?.absolutePath,
            )
            val engine = Engine(cfg)
            engine.initialize()
            android.util.Log.d("AiCore", "LiteRT-LM: CPU backend OK ✓")
            litertlmEngine = engine
            litertlmConversation = engine.createConversation(
              ConversationConfig(samplerConfig = samplerConfig)
            )
            currentEngineName = "litertlm"
            currentModelPath = resolvedPath
          } else {
            val options = LlmInference.LlmInferenceOptions.builder()
              .setModelPath(resolvedPath)
              .setMaxTokens(DEFAULT_MAX_TOKENS)
              .setPreferredBackend(LlmInference.Backend.DEFAULT)
              .build()
            llmInference = LlmInference.createFromOptions(reactApplicationContext, options)
            currentEngineName = "mediapipe"
            currentModelPath = resolvedPath
          }
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

  /**
   * One-shot vision inference: sends [imageBase64] + [prompt] to the LiteRT-LM engine and
   * returns the full response as a string.
   *
   * Requirements:
   *  - Model must be a multimodal LiteRT-LM model (Gemma 3n or Gemma 4).
   *  - Engine must have been initialised after calling `configure({ enableVision: true })`.
   *
   * [imageBase64] is a standard Base64-encoded PNG/JPEG image (no data-URI prefix needed).
   * Does NOT read from or write to the conversation history.
   */
  @OptIn(ExperimentalApi::class)
  override fun generateResponseWithImage(prompt: String, imageBase64: String, promise: Promise) {
    val litertlm = litertlmConversation
    if (litertlm == null) {
      promise.reject("NOT_INITIALIZED", "LLM not initialized.")
      return
    }
    if (!configEnableVision) {
      promise.reject("VISION_NOT_ENABLED",
        "Vision is not enabled. Call configure({ enableVision: true }) before initialize().")
      return
    }

    startInferenceService()
    cancelRequested = false

    executor.execute {
      inferenceInFlight = true
      try {
        val imageBytes = Base64.decode(imageBase64, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
          ?: run {
            stopInferenceService()
            promise.reject("INVALID_IMAGE", "Could not decode image from Base64 string.")
            return@execute
          }
        val pngBytes = bitmap.toPngByteArray()

        val contents = Contents.of(listOf(
          Content.ImageBytes(pngBytes),
          Content.Text(prompt),
        ))

        val resultBuilder = StringBuilder()
        var errorThrowable: Throwable? = null
        val latch = CountDownLatch(1)

        litertlm.sendMessageAsync(
          contents,
          object : MessageCallback {
            override fun onMessage(message: Message) {
              if (!cancelRequested) {
                val text = message.toString()
                if (text.isNotEmpty()) resultBuilder.append(text)
              }
            }
            override fun onDone() { latch.countDown() }
            override fun onError(throwable: Throwable) {
              errorThrowable = throwable
              latch.countDown()
            }
          },
          emptyMap(),
        )

        val completed = latch.await(inferenceTimeoutSec, TimeUnit.SECONDS)
        val err = errorThrowable
        when {
          cancelRequested -> {
            stopInferenceService()
            promise.reject("CANCELLED", "Generation cancelled.")
          }
          !completed -> {
            stopInferenceService()
            promise.reject("GENERATION_ERROR", "Vision inference timed out after ${inferenceTimeoutSec}s")
          }
          err != null -> {
            stopInferenceService()
            promise.reject("GENERATION_ERROR", err.message, err)
          }
          else -> {
            stopInferenceService()
            promise.resolve(resultBuilder.toString().trim())
          }
        }
      } catch (e: IllegalStateException) {
        tryResetLitertlmConversation()
        stopInferenceService()
        promise.reject("CONVERSATION_RESET", "Model was reinitialized during inference. Please retry.", e)
      } catch (e: Exception) {
        stopInferenceService()
        promise.reject("GENERATION_ERROR", e.message, e)
      } finally {
        inferenceInFlight = false
      }
    }
  }

  /**
   * Streaming vision inference: sends [imageBase64] + [prompt] to the LiteRT-LM engine.
   * Tokens are emitted via NativeEventEmitter (AICore_streamToken / AICore_streamComplete / AICore_streamError).
   *
   * Requirements: same as [generateResponseWithImage].
   * Does NOT write to conversation history.
   */
  @OptIn(ExperimentalApi::class)
  override fun generateResponseStreamWithImage(prompt: String, imageBase64: String) {
    val litertlm = litertlmConversation
    if (litertlm == null) {
      sendEvent(EVENT_STREAM_ERROR, createErrorMap("NOT_INITIALIZED", "LLM not initialized."))
      return
    }
    if (!configEnableVision) {
      sendEvent(EVENT_STREAM_ERROR, createErrorMap("VISION_NOT_ENABLED",
        "Vision is not enabled. Call configure({ enableVision: true }) before initialize()."))
      return
    }

    startInferenceService()
    cancelRequested = false

    // IMPORTANT: Do NOT use executor.execute + CountDownLatch here.
    // The LiteRT-LM GPU vision backend dispatches sendMessageAsync callbacks on the
    // SAME thread that called sendMessageAsync (the executor thread). Blocking that
    // thread with latch.await() creates a deadlock — callbacks can never fire.
    // Solution: use a coroutine on Dispatchers.IO (a different thread pool) +
    // suspendCancellableCoroutine so the thread suspends without blocking, and the
    // GPU callback can resume it from whichever thread it fires on.
    coroutineScope.launch(Dispatchers.IO) {
      inferenceInFlight = true
      try {
        val imageBytes = Base64.decode(imageBase64, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
          ?: run {
            stopInferenceService()
            sendEvent(EVENT_STREAM_ERROR, createErrorMap("INVALID_IMAGE", "Could not decode image from Base64 string."))
            return@launch
          }
        val pngBytes = bitmap.toPngByteArray()

        val contents = Contents.of(listOf(
          Content.ImageBytes(pngBytes),
          Content.Text(prompt),
        ))

        try {
          suspendCancellableCoroutine<Unit> { continuation ->
            litertlm.sendMessageAsync(
              contents,
              object : MessageCallback {
                override fun onMessage(message: Message) {
                  if (!cancelRequested) {
                    val token = message.toString()
                    if (token.isNotEmpty()) emitStreamToken(token, false)
                  }
                }
                override fun onDone() {
                  if (continuation.isActive) continuation.resume(Unit)
                }
                override fun onError(throwable: Throwable) {
                  if (continuation.isActive) continuation.resumeWithException(throwable)
                }
              },
              emptyMap(),
            )
            continuation.invokeOnCancellation {
              litertlm.cancelProcess()
            }
          }
          // suspendCancellableCoroutine returned normally → onDone fired
          emitStreamToken("", true)
          stopInferenceService()
          sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
        } catch (e: Exception) {
          // onError fired or coroutine was cancelled
          if (cancelRequested) {
            emitStreamToken("", true)
            stopInferenceService()
            sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
          } else {
            stopInferenceService()
            sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", e.message ?: "Vision inference error"))
          }
        }
      } catch (e: IllegalStateException) {
        tryResetLitertlmConversation()
        stopInferenceService()
        sendEvent(EVENT_STREAM_ERROR, createErrorMap("CONVERSATION_RESET",
          "Model was reinitialized during inference. Please retry."))
      } catch (e: Exception) {
        stopInferenceService()
        sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", e.message ?: "Error"))
      } finally {
        inferenceInFlight = false
      }
    }
  }

  /** Converts a Bitmap to a PNG byte array (Gallery pattern). */
  private fun Bitmap.toPngByteArray(): ByteArray {
    val stream = ByteArrayOutputStream()
    this.compress(Bitmap.CompressFormat.PNG, 100, stream)
    return stream.toByteArray()
  }

  private fun generateResponseInternal(
    prompt: String,
    useConversationHistory: Boolean,
    promise: Promise
  ) {
    val mlkit = mlkitModel
    val mediapipe = llmInference
    val litertlm = litertlmConversation
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
              continuations < configMaxContinuations
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
          val gemmaPrompt = buildGemmaPrompt(prompt, useConversationHistory)
          session = createMediaPipeSession()
          session.addQueryChunk(gemmaPrompt)
          val raw = session.generateResponse()
          session.close()
          session = null
          // Strip any trailing <end_of_turn> token Gemma may append
          val full = raw.replace("<end_of_turn>", "").trim()
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
      litertlm != null -> executor.execute {
        inferenceInFlight = true
        try {
          val resultBuilder = StringBuilder()
          var errorThrowable: Throwable? = null
          val latch = CountDownLatch(1)
          litertlm.sendMessageAsync(
            Contents.of(listOf(Content.Text(prompt))),
            object : MessageCallback {
              override fun onMessage(message: Message) {
                if (!cancelRequested) {
                  val text = message.toString()
                  if (text.isNotEmpty()) {
                    resultBuilder.append(text)
                    sendEvent(EVENT_STATELESS_TOKEN, Arguments.createMap().apply {
                      putString("token", text)
                    })
                  }
                }
              }
              override fun onDone() { latch.countDown() }
              override fun onError(throwable: Throwable) {
                errorThrowable = throwable
                latch.countDown()
              }
            },
            emptyMap(),
          )
          val completed = latch.await(inferenceTimeoutSec, TimeUnit.SECONDS)
          val err = errorThrowable
          when {
            cancelRequested -> {
              stopInferenceService()
              promise.reject("CANCELLED", "Generation cancelled.")
            }
            !completed -> {
              stopInferenceService()
              promise.reject("GENERATION_ERROR", "Inference timed out after ${inferenceTimeoutSec}s")
            }
            err != null -> {
              val isContextError = err.message?.contains("context", ignoreCase = true) == true ||
                  err.message?.contains("token", ignoreCase = true) == true ||
                  err.message?.contains("exceed", ignoreCase = true) == true ||
                  err.message?.contains("out of range", ignoreCase = true) == true
              if (isContextError) {
                tryResetLitertlmConversation()
                stopInferenceService()
                promise.reject(
                  "CONTEXT_LIMIT_EXCEEDED",
                  "Prompt is too long for the model's context window. " +
                    "Reduce the prompt length and try again. (${err.message})",
                  err
                )
              } else {
                stopInferenceService()
                promise.reject("GENERATION_ERROR", err.message, err)
              }
            }
            else -> {
              val full = resultBuilder.toString().trim()
              stopInferenceService()
              promise.resolve(full)
            }
          }
        } catch (e: IllegalStateException) {
          // Conversation was closed (e.g. by a concurrent initialize/release) between
          // the time this task was enqueued and when it actually ran. Reset and report.
          tryResetLitertlmConversation()
          stopInferenceService()
          promise.reject("CONVERSATION_RESET", "Model was reinitialized during inference. Please retry.", e)
        } catch (e: Exception) {
          stopInferenceService()
          promise.reject("GENERATION_ERROR", e.message, e)
        } finally {
          inferenceInFlight = false
        }
      }
      else -> promise.reject("NOT_INITIALIZED", "LLM not initialized.")
    }
  }

  override fun generateResponseStream(prompt: String) {
    val mlkit = mlkitModel
    val mediapipe = llmInference
    val litertlm = litertlmConversation
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
            if (shouldContinueResponse(total.toString()) && continuations < configMaxContinuations) {
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
        var session: LlmInferenceSession? = null
        try {
          val gemmaPrompt = buildGemmaPrompt(prompt, true)
          val latch = CountDownLatch(1)
          session = createMediaPipeSession()
          session.addQueryChunk(gemmaPrompt)
          session.generateResponseAsync(ProgressListener<String> { partial, done ->
            if (cancelRequested) {
              latch.countDown()
              return@ProgressListener
            }
            val token = (partial ?: "").replace("<end_of_turn>", "")
            if (token.isNotEmpty()) {
              total.append(token)
              emitStreamToken(token, false)
            }
            if (done) {
              latch.countDown()
            }
          })
          val streamCompleted = latch.await(inferenceTimeoutSec, TimeUnit.SECONDS)
          session?.close()
          session = null
          if (!streamCompleted) {
            stopInferenceService()
            sendEvent(EVENT_STREAM_ERROR, createErrorMap("TIMEOUT", "MediaPipe stream timed out after ${inferenceTimeoutSec}s"))
            return@execute
          }
          if (!cancelRequested) saveToHistory(prompt, total.toString().trim())
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
      litertlm != null -> executor.execute {
        inferenceInFlight = true
        try {
          val total = StringBuilder()
          val latch = CountDownLatch(1)
          var errorMsg: String? = null
          litertlm.sendMessageAsync(
            Contents.of(listOf(Content.Text(prompt))),
            object : MessageCallback {
              override fun onMessage(message: Message) {
                if (!cancelRequested) {
                  val token = message.toString()
                  if (token.isNotEmpty()) {
                    total.append(token)
                    emitStreamToken(token, false)
                  }
                }
              }
              override fun onDone() { latch.countDown() }
              override fun onError(throwable: Throwable) {
                errorMsg = throwable.message
                latch.countDown()
              }
            },
            emptyMap(),
          )
          val streamCompleted = latch.await(inferenceTimeoutSec, TimeUnit.SECONDS)
          if (cancelRequested) {
            emitStreamToken("", true)
            stopInferenceService()
            sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
          } else if (!streamCompleted) {
            stopInferenceService()
            sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", "Inference timed out after ${inferenceTimeoutSec}s"))
          } else if (errorMsg != null) {
            // If context window is full, reset conversation and report a clear error
            val isContextError = errorMsg!!.contains("context", ignoreCase = true) ||
                errorMsg!!.contains("token", ignoreCase = true) ||
                errorMsg!!.contains("exceed", ignoreCase = true) ||
                errorMsg!!.contains("out of range", ignoreCase = true)
            if (isContextError) {
              tryResetLitertlmConversation()
              stopInferenceService()
              sendEvent(EVENT_STREAM_ERROR, createErrorMap(
                "CONTEXT_LIMIT_EXCEEDED",
                "Prompt is too long for the model's context window. " +
                  "Reduce the prompt length and try again. (${errorMsg})"
              ))
            } else {
              stopInferenceService()
              sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", errorMsg ?: "Error"))
            }
          } else {
            emitStreamToken("", true)
            stopInferenceService()
            sendEvent(EVENT_STREAM_COMPLETE, Arguments.createMap())
          }
        } catch (e: IllegalStateException) {
          // Conversation was closed concurrently (initialize/release race). Reset and report.
          tryResetLitertlmConversation()
          stopInferenceService()
          sendEvent(EVENT_STREAM_ERROR, createErrorMap("CONVERSATION_RESET", "Model was reinitialized during inference. Please retry."))
        } catch (e: Exception) {
          stopInferenceService()
          sendEvent(EVENT_STREAM_ERROR, createErrorMap("STREAM_ERROR", e.message ?: "Error"))
        } finally {
          inferenceInFlight = false
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
        if (litertlmConversation != null) { promise.resolve("AVAILABLE"); return@launch }
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
        litertlmConversation?.close()
        litertlmConversation = null
        litertlmEngine?.close()
        litertlmEngine = null
        currentEngineName = ""
        currentModelPath = ""
        resetHistory()
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("RELEASE_ERROR", e.message, e)
      }
    }
  }

  @OptIn(ExperimentalApi::class)
  override fun resetConversation(promise: Promise) {
    resetHistory()
    val engine = litertlmEngine
    if (engine != null) {
      try {
        litertlmConversation?.close()
        litertlmConversation = engine.createConversation(
          ConversationConfig(
            samplerConfig = SamplerConfig(
              topK = configTopK,
              topP = 0.95,
              temperature = configTemperature.toDouble(),
            )
          )
        )
      } catch (_: Exception) {}
    }
    promise.resolve(null)
  }

  @OptIn(ExperimentalApi::class)
  private fun tryResetLitertlmConversation() {
    val engine = litertlmEngine ?: return
    try {
      litertlmConversation?.close()
      litertlmConversation = engine.createConversation(
        ConversationConfig(
          samplerConfig = SamplerConfig(topK = configTopK, topP = 0.95, temperature = configTemperature.toDouble())
        )
      )
      resetHistory()
      android.util.Log.w("AiCore", "LiteRT-LM: conversation reset (context window full)")
    } catch (e: Exception) {
      android.util.Log.e("AiCore", "LiteRT-LM: failed to reset conversation: ${e.message}")
    }
  }

  /**
   * Updates runtime-configurable inference parameters.
   * Pass -1 (or any negative value) for any parameter to keep its current value.
   *
   * @param inferenceTimeoutSec  Seconds before inference is aborted. Range [30, 3600]. Default 420.
   * @param temperature          Sampling temperature [0.0, 2.0]. Default 0.7.
   *                             Applies to LiteRT-LM on the NEXT conversation reset or initialize.
   * @param topK                 Top-K sampling [1, 256]. Default 64.
   *                             Applies to LiteRT-LM on the NEXT conversation reset or initialize.
   * @param maxContinuations     Max MLKit continuation passes [0, 50]. Default 12.
   * @param enableVision         0 = disable, 1 = enable, -1 = keep current.
   *                             Requires a multimodal model (Gemma 3n / Gemma 4).
   *                             Takes effect on the NEXT initialize() call.
   */
  override fun configure(
    inferenceTimeoutSec: Double,
    temperature: Double,
    topK: Double,
    maxContinuations: Double,
    enableVision: Double,
    promise: Promise,
  ) {
    if (inferenceTimeoutSec >= 1.0) {
      this.inferenceTimeoutSec = inferenceTimeoutSec.toLong().coerceIn(30L, 3600L)
    }
    if (temperature >= 0.0) {
      this.configTemperature = temperature.toFloat().coerceIn(0f, 2f)
    }
    if (topK >= 1.0) {
      this.configTopK = topK.toInt().coerceIn(1, 256)
    }
    if (maxContinuations >= 0.0) {
      this.configMaxContinuations = maxContinuations.toInt().coerceIn(0, 50)
    }
    if (enableVision >= 0.0) {
      this.configEnableVision = enableVision > 0.5
    }
    promise.resolve(null)
  }

  override fun cancelGeneration(promise: Promise) {
    cancelRequested = true
    activeGenerationJob?.cancel()
    litertlmConversation?.cancelProcess()
    promise.resolve(null)
  }

  override fun downloadModel(
    url: String,
    name: String,
    commitHash: String,
    fileName: String,
    totalBytes: Double,
    hfToken: String,
    promise: Promise
  ) {
    downloadExecutor.execute {
      downloadCancelRequested = false
      val destDir = File(reactApplicationContext.getExternalFilesDir(null), "ai-core-models${File.separator}$name${File.separator}$commitHash")
      destDir.mkdirs()
      val destFile = File(destDir, fileName)
      val tmpFile  = File(destDir, "$fileName.tmp")

      try {
        val client = OkHttpClient.Builder()
          .connectTimeout(30, TimeUnit.SECONDS)
          .readTimeout(0,  TimeUnit.SECONDS)
          .build()
        val request = Request.Builder()
          .url(url)
          .apply { if (hfToken.isNotBlank()) header("Authorization", "Bearer $hfToken") }
          .build()
        val call = client.newCall(request)
        activeDownloadCall = call

        call.execute().use { response ->
          if (!response.isSuccessful) {
            promise.reject("DOWNLOAD_FAILED", "HTTP ${response.code}")
            return@execute
          }
          val body = response.body ?: run {
            promise.reject("DOWNLOAD_FAILED", "Empty response body")
            return@execute
          }
          val total = if (totalBytes > 0) totalBytes.toLong() else body.contentLength()
          var received = 0L
          val startTime = System.currentTimeMillis()
          var lastEmitMs = 0L
          val bufSize = 128 * 1024
          val buf = ByteArray(bufSize)

          tmpFile.outputStream().buffered(bufSize).use { sink ->
            val source = body.source()
            while (!downloadCancelRequested) {
              val n = source.read(buf)
              if (n == -1) break
              sink.write(buf, 0, n)
              received += n
              val now = System.currentTimeMillis()
              if (now - lastEmitMs >= 300) {
                val elapsed = (now - startTime).coerceAtLeast(1)
                val rate    = received * 1000L / elapsed
                val remaining = if (rate > 0 && total > 0) (total - received) * 1000L / rate else 0L
                sendEvent(EVENT_DOWNLOAD_PROGRESS, Arguments.createMap().apply {
                  putDouble("receivedBytes",  received.toDouble())
                  putDouble("totalBytes",     total.toDouble())
                  putDouble("bytesPerSecond", rate.toDouble())
                  putDouble("remainingMs",    remaining.toDouble())
                })
                lastEmitMs = now
              }
            }
          }

          if (downloadCancelRequested) {
            tmpFile.delete()
            promise.reject("CANCELLED", "Download cancelled.")
            return@execute
          }

          tmpFile.renameTo(destFile)
          promise.resolve(destFile.absolutePath)
        }
      } catch (e: Exception) {
        tmpFile.delete()
        promise.reject("DOWNLOAD_ERROR", e.message, e)
      }
    }
  }

  override fun cancelDownload(promise: Promise) {
    downloadCancelRequested = true
    activeDownloadCall?.cancel()
    promise.resolve(null)
  }

  override fun getDownloadedModels(promise: Promise) {
    downloadExecutor.execute {
      try {
        val baseDir = File(reactApplicationContext.getExternalFilesDir(null), "ai-core-models")
        val array = Arguments.createArray()
        if (baseDir.exists()) {
          baseDir.listFiles()?.forEach { nameDir ->
            nameDir.listFiles()?.forEach { hashDir ->
              hashDir.listFiles()?.filter { it.isFile && !it.name.endsWith(".tmp") }?.forEach { file ->
                array.pushMap(Arguments.createMap().apply {
                  putString("name",        nameDir.name)
                  putString("commitHash",  hashDir.name)
                  putString("fileName",    file.name)
                  putString("path",        file.absolutePath)
                  putDouble("sizeInBytes", file.length().toDouble())
                })
              }
            }
          }
        }
        promise.resolve(array)
      } catch (e: Exception) {
        promise.reject("ERROR", e.message, e)
      }
    }
  }

  override fun setSystemPrompt(prompt: String, promise: Promise) {
    systemPrompt = prompt.trim().ifEmpty { null }
    promise.resolve(null)
  }

  override fun clearSystemPrompt(promise: Promise) {
    systemPrompt = null
    promise.resolve(null)
  }

  override fun getTokenCount(text: String, promise: Promise) {
    // Gemma tokenizer: ~3.5 characters per token for English/code
    val estimated = (text.length / 3.5).toInt().coerceAtLeast(0)
    promise.resolve(estimated)
  }

  override fun getInitializedModel(promise: Promise) {
    val engine = currentEngineName
    if (engine.isEmpty()) {
      promise.resolve("")
      return
    }
    val safePath = currentModelPath
      .replace("\\", "\\\\")
      .replace("\"", "\\\"")
    promise.resolve("{\"engine\":\"$engine\",\"modelPath\":\"$safePath\"}")
  }

  override fun addListener(eventName: String) {}
  override fun removeListeners(count: Double) {}

  override fun invalidate() {
    super.invalidate()
    // Signal running tasks to stop before we tear down resources.
    cancelRequested = true
    downloadCancelRequested = true
    activeDownloadCall?.cancel()
    activeGenerationJob?.cancel()
    try {
      stopInferenceService()
      llmInference?.close()
      llmInference = null
      mlkitModel = null
      litertlmConversation?.close()
      litertlmConversation = null
      litertlmEngine?.close()
      litertlmEngine = null
    } finally {
      // shutdownNow() interrupts executor threads that are blocked on latch.await(),
      // preventing the bridge teardown from hanging for up to INFERENCE_TIMEOUT_SEC.
      executor.shutdownNow()
      downloadExecutor.shutdownNow()
      coroutineScope.cancel()
    }
  }
}
