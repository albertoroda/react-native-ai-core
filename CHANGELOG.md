# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.9] - 2026-04-10

### Added

- **Multimodal (Vision) inference** — New API for image + text on-device inference using the LiteRT-LM GPU backend. Supports Gemma 4 and Gemma 3n models.

  ```typescript
  import AICore, { KnownModel } from 'react-native-ai-core';

  // 1. Enable vision before initializing
  await AICore.configure({ enableVision: true });
  await AICore.ensureModel(KnownModel.GEMMA4_2B, { hfToken });

  // 2. Analyze an image (base64-encoded PNG/JPEG)
  const description = await AICore.generateResponseWithImage(base64, 'What is in this image?');

  // 3. Or stream the response token by token
  const unsubscribe = AICore.generateResponseStreamWithImage(base64, 'Describe this image', {
    onToken:    (token, done) => console.log(token),
    onComplete: () => console.log('done'),
    onError:    (err) => console.error(err),
  });
  ```

  | Method | Returns | Description |
  |---|---|---|
  | `configure({ enableVision: true })` | `Promise<void>` | Enable the GPU vision backend before calling `ensureModel` |
  | `generateResponseWithImage(base64, prompt)` | `Promise<string>` | Blocking image inference |
  | `generateResponseStreamWithImage(base64, prompt, callbacks)` | `() => void` | Streaming image inference. Returns cleanup function |

  Vision-capable models: `GEMMA4_2B`, `GEMMA4_4B`, `GEMMA3N_2B`, `GEMMA3N_4B`.

- **`AICoreMarkdown` component** — Zero-dependency markdown renderer for LLM responses. Exported directly from the library.

  ```tsx
  import { AICoreMarkdown } from 'react-native-ai-core';

  <AICoreMarkdown streaming={isStreaming}>{answer}</AICoreMarkdown>
  ```

  Supports: headings (`#`, `##`, `###`), **bold**, *italic*, ***bold-italic***, `inline code`, fenced code blocks, ordered/unordered lists, horizontal rules, and a blinking cursor while streaming.

  | Prop | Type | Default | Description |
  |---|---|---|---|
  | `children` | `string` | — | Markdown string to render |
  | `streaming` | `boolean` | `false` | Shows a blinking `▌` cursor at the end |
  | `textColor` | `string` | `'#e2e8f0'` | Base text color |
  | `headingColor` | `string` | `'#f1f5f9'` | Heading color |

- **`visionModels` export** — Convenience array of all `KnownModelEntry` objects that support vision, for use in model picker UIs.

  ```ts
  import { visionModels } from 'react-native-ai-core';
  // [GEMMA4_2B, GEMMA4_4B, GEMMA3N_2B, GEMMA3N_4B]
  ```

- **`KnownModelEntry.supportsVision`** — New optional boolean field on `KnownModelEntry`. `true` for Gemma 4 and Gemma 3n models.

### Changed

- **`AICoreConfig`** — Added `enableVision?: boolean` field. When `true`, the LiteRT-LM engine initializes the GPU vision backend (required before calling any `*WithImage` method).

- **`expo-secure-store`** — Moved from `dependencies` to `devDependencies` in the library root. It is only used by the example app. Existing consumers are unaffected.

### Fixed

- **GPU vision backend deadlock** — `generateResponseStreamWithImage` previously used a single-thread executor + `CountDownLatch`. The GPU backend dispatches `sendMessageAsync` callbacks on the same thread, causing a deadlock (silent freeze, no tokens emitted). Replaced with `coroutineScope.launch(Dispatchers.IO)` + `suspendCancellableCoroutine` — the thread suspends without blocking and the GPU callback resumes it correctly.

---

## [0.5.8] - 2026-04-09

### Added

- **`configure(options)` — runtime inference configuration** — New public API that lets the caller tune key inference parameters at any time without reinitialising the engine.

  ```typescript
  // Increase timeout for long document summarisation
  await AICore.configure({ inferenceTimeoutSec: 900 });

  // More creative outputs
  await AICore.configure({ temperature: 1.2, topK: 80 });

  // Multiple parameters at once
  await AICore.configure({ inferenceTimeoutSec: 1200, temperature: 0.5, maxContinuations: 20 });
  ```

  | Option | Default | Range | Notes |
  |---|---|---|---|
  | `inferenceTimeoutSec` | 420 | 30–3600 | Seconds before inference times out. Increase for very long responses |
  | `temperature` | 0.7 | 0.0–2.0 | Sampling temperature. For LiteRT-LM: takes effect on the next `resetConversation()` or `initialize()` |
  | `topK` | 64 | 1–256 | Top-K sampling. For LiteRT-LM: takes effect on the next `resetConversation()` or `initialize()` |
  | `maxContinuations` | 12 | 0–50 | Max MLKit continuation passes (AICore/Gemini Nano engine only) |

  Any field omitted (or explicitly set to `-1`) keeps its current value. Bounds are enforced on the native side (Kotlin).

### Changed

- **`INFERENCE_TIMEOUT_SEC`, `DEFAULT_TEMPERATURE`, `DEFAULT_TOP_K`, `MAX_CONTINUATIONS`** — These were compile-time `companion object` constants in `AiCoreModule.kt`. They are now `@Volatile` instance variables initialised to the same defaults, updated via `configure()`. Existing behaviour is identical for callers that do not call `configure()`.

---

## [0.5.7] - 2026-04-09

### Changed

- **`message.toString()` in LiteRT-LM callbacks** — Both the stateless (`generateResponseStateless`) and streaming (`generateResponseStream`) LiteRT-LM `onMessage` callbacks now use `message.toString()` instead of the multi-cast `(message.contents.contents.firstOrNull() as? Content.Text)?.text`. This matches the pattern used by the official Google AI Edge Gallery and is more resilient to future changes in `Message`'s internal structure.

- **KV cache reset after stateless generation (example)** — `runWeeklyMenuExample` (Example 4) now calls `AICore.resetConversation()` in its `finally` block. LiteRT-LM shares a single KV cache between all calls on the same engine; without the reset, a ~2500-token weekly-menu response would consume chat context window on the next message. The reset is best-effort and does not affect the returned result.

- **`onRawToken` passes delta, not accumulated string** — `runWeeklyMenuStreamExample` (Example 5) now calls `onRawToken(token)` with only the new fragment instead of the full accumulated text. `LocalAITab` concatenates via a functional state updater `setStreamRaw((prev) => (prev ?? '') + delta)`. This makes the per-token render cost constant regardless of response length, fixing progressive slowdown in the live preview panel during long generations.

### Fixed

- **`FAILED_PRECONDITION: A session already exists` crash** — An earlier attempt to create a second fresh LiteRT-LM conversation for stateless calls was reverted: the engine only supports one conversation at a time. The KV cache isolation is now achieved by resetting the shared conversation after each stateless call instead.

---

## [0.5.6] - 2026-04-09

### Fixed

- **`Conversation is not alive` FATAL crash (LiteRT-LM)** — `sendMessageAsync` throws `IllegalStateException` synchronously when the underlying `Conversation` object has already been closed (e.g. a concurrent `initialize()` or `release()` call). Because the executor blocks had no outer `try/catch`, this exception escaped the thread pool and caused an uncaught-exception crash. Both the stateless (`generateResponseStateless`) and streaming (`generateResponseStream`) LiteRT-LM paths are now wrapped in a `try/catch(IllegalStateException)` that resets the conversation and rejects/emits a recoverable `CONVERSATION_RESET` error code instead of crashing.

### Added

- **Per-model `maxContextLength`** — `KnownModelEntry` now accepts an optional `maxContextLength` field. `KnownModel.GEMMA4_2B` and `KnownModel.GEMMA4_4B` are set to `32000`. The value is forwarded through `initialize(modelPath, maxContextLength)` all the way to the Android `EngineConfig(maxNumTokens = ...)`, replacing the previous hardcoded `4096`. Models without the field continue to default to `4096`. This allows Gemma 4 to use its full 32 K context window instead of being silently capped.

- **`CONTEXT_LIMIT_EXCEEDED` error code** — when LiteRT-LM's `onError` callback fires with a message containing `"context"`, `"token"`, `"exceed"` or `"out of range"`, the library now rejects with the dedicated code `CONTEXT_LIMIT_EXCEEDED` (stateless path) or emits it on `EVENT_STREAM_ERROR` (streaming path), and automatically resets the conversation so the next call starts fresh.

- **`estimatedArraySize` and `maxChunkedCalls` options** — `generateStructuredResponse` (chunked strategy) now accepts two new options to control the complexity guard. `estimatedArraySize` (default `5`) overrides the per-array element count used by the estimator, so schemas that produce 2-3 items per array are not incorrectly rejected. `maxChunkedCalls` (default `150`) overrides the hard limit for callers that have verified their device can handle a larger number of calls. The error message now also explains how to use these options instead of saying "split your schema".

---

## [0.5.5] - 2026-04-09

### Fixed

- **`Conversation is not alive` FATAL crash (LiteRT-LM)** — `sendMessageAsync` throws `IllegalStateException` synchronously when the underlying `Conversation` object has already been closed (e.g. a concurrent `initialize()` or `release()` call). Because the executor blocks had no outer `try/catch`, this exception escaped the thread pool and caused an uncaught-exception crash. Both the stateless (`generateResponseStateless`) and streaming (`generateResponseStream`) LiteRT-LM paths are now wrapped in a `try/catch(IllegalStateException)` that resets the conversation and rejects/emits a recoverable `CONVERSATION_RESET` error code instead of crashing.

### Added

- **Per-model `maxContextLength`** — `KnownModelEntry` now accepts an optional `maxContextLength` field. `KnownModel.GEMMA4_2B` and `KnownModel.GEMMA4_4B` are set to `32000`. The value is forwarded through `initialize(modelPath, maxContextLength)` all the way to the Android `EngineConfig(maxNumTokens = ...)`, replacing the previous hardcoded `4096`. Models without the field continue to default to `4096`. This allows Gemma 4 to use its full 32 K context window instead of being silently capped.

- **`CONTEXT_LIMIT_EXCEEDED` error code** — when LiteRT-LM's `onError` callback fires with a message containing `"context"`, `"token"`, `"exceed"` or `"out of range"`, the library now rejects with the dedicated code `CONTEXT_LIMIT_EXCEEDED` (stateless path) or emits it on `EVENT_STREAM_ERROR` (streaming path), and automatically resets the conversation so the next call starts fresh.

- **`estimatedArraySize` and `maxChunkedCalls` options** — `generateStructuredResponse` (chunked strategy) now accepts two new options to control the complexity guard. `estimatedArraySize` (default `5`) overrides the per-array element count used by the estimator, so schemas that produce 2-3 items per array are not incorrectly rejected. `maxChunkedCalls` (default `150`) overrides the hard limit for callers that have verified their device can handle a larger number of calls. The error message now also explains how to use these options instead of saying "split your schema".

---

## [0.5.4] - 2026-04-09

### Fixed

- **`ZodDefault` not unwrapped** — `unwrapModifiers` and `zodTypeToDescription` now handle `z.ZodDefault` (produced by `.default(value)` on any schema field). Previously such fields were treated as `unknown`, causing the generated JSON description sent to the model to omit the field entirely.

- **`ZodEnum.options` type change (zod v4)** — `.options` is now `EnumValue[]` (`string | number`) instead of `string[]`. Fixed by casting to `unknown` before `JSON.stringify` in `zodTypeToDescription` and adding `.map(String)` in `getEnumOptions`.

### Added

- **Chunked-call guard (`MAX_ESTIMATED_CHUNKED_CALLS = 150`)** — `estimateChunkedCalls(schema)` recursively counts the number of native inference calls that `generateChunked` would produce. If the estimate exceeds 150, `generateStructuredResponse` throws `StructuredOutputError` immediately instead of launching hundreds of calls that would exhaust device memory. A 35-meal `WeeklyMenuSchema` was previously causing ~280 calls and an OOM crash with Gemma 4; it now throws a clear, actionable error.

- **Prompt-length guard** — if the rendered prompt exceeds `STRUCTURED_PROMPT_BUDGET × 3` (7 800 chars) the library throws `StructuredOutputError` instead of silently truncating the prompt mid-schema (which caused garbled or empty model output).

---

## [0.5.3] - 2026-04-09

### Fixed

- **Catalog data — missing fields** — The inlined catalog entries in `src/model-catalog-data.ts` were missing extra fields present in the JSON source files (`llmSupportImage`, `llmSupportAudio`, `llmSupportThinking`, `defaultConfig`, `taskTypes`, `bestForTaskTypes`). All entries for v1.0.8 through v1.0.11 and `ios_1.0.0` now include the full field set from their corresponding JSON files.

- **zod upgraded to v4 (`^4`)** — peer dependency updated from `">=3.24.1"` to `"^4"`. Two internal fixes applied: `ZodEnum.options.map((value: unknown) => JSON.stringify(value))` and `getEnumOptions` now uses `.map(String)`.

---

## [0.5.2] - 2026-04-09

### Fixed

- **Catalog bundling — Metro "Unable to resolve" error** — `fetchModelCatalog()` previously used `require('../model_allowlists/*.json')`. Babel copies require-string literals verbatim: the path `'../model_allowlists/'` is correct relative to `src/`, but the compiled output lives in `lib/module/`, so that same path resolves to `lib/model_allowlists/` which does not exist in the installed package. Fixed by inlining all catalog data into a co-located TypeScript source file (`src/model-catalog-data.ts`). Babel compiles it alongside `index.ts` and the resulting `lib/module/model-catalog-data.js` is always adjacent to `lib/module/index.js`, making the `'./model-catalog-data'` import work correctly regardless of where the package is installed.

- **`zod` moved to `peerDependencies`** — `zod` was listed as a `dependency`, causing npm to install a second copy alongside a consumer project that already had `zod@^4.x`. Because Zod v3 and v4 types are incompatible, this silently broke `generateStructuredResponse`. `zod` is now a peer dependency (`">=3.24.1"`) so only one instance is resolved. Consumers must add `zod` to their own `dependencies` — this was already required in practice to define output schemas.

---

## [0.5.1] - 2026-04-09

### Changed

- **`fetchModelCatalog()` — bundled locally, no network required** — the model catalog is now read from `model_allowlists/*.json` files shipped inside the package, instead of fetching from `raw.githubusercontent.com` at runtime. Eliminates failures caused by GitHub being unavailable, CDN throttling, or the upstream repo being moved/deleted. The public API signature (`fetchModelCatalog(version?)`) is unchanged; the function now resolves synchronously from the bundled data (still returns a `Promise` for API compatibility). Available versions: `'1_0_4'` – `'1_0_11'`, `'ios_1_0_0'`.

---

## [0.5.0] - 2026-04-09

### Added

- **`Engine` enum** — type-safe backend selector exported as a `const` object and a union type:
  ```ts
  Engine.AICORE     // 'aicore'
  Engine.LITERTLM   // 'litertlm'
  Engine.MEDIAPIPE  // 'mediapipe'
  ```

- **`KnownModel` registry** — a statically typed, curated map of models from the Google AI Edge catalog. All entries include the correct `modelId`, `catalogName` (the directory name used on disk), engine, and approximate size:

  | Key | Catalog name | Size |
  |---|---|---|
  | `GEMINI_NANO` | — (native NPU) | — |
  | `GEMMA4_2B` | `Gemma-4-E2B-it` | ~2.4 GB |
  | `GEMMA4_4B` | `Gemma-4-E4B-it` | ~3.4 GB |
  | `GEMMA3N_2B` | `Gemma-3n-E2B-it` | ~3.4 GB |
  | `GEMMA3N_4B` | `Gemma-3n-E4B-it` | ~4.6 GB |
  | `GEMMA3_1B` | `Gemma3-1B-IT` | ~0.55 GB |
  | `QWEN25_1B5` | `Qwen2.5-1.5B-Instruct` | ~1.5 GB |
  | `DEEPSEEK_R1_1B5` | `DeepSeek-R1-Distill-Qwen-1.5B` | ~1.7 GB |

- **`KnownModelEntry` interface** — added `catalogName?: string` field. This is the exact `name` from the Google AI Edge catalog JSON (and therefore the directory name used by `downloadModel()`). `isModelDownloaded()` now uses this field for an accurate on-disk lookup.

- **`ensureModel(model, opts?): Promise<void>`** — one-call initialization lifecycle: check on-device → download from HuggingFace Hub if missing → initialize engine. Accepts `hfToken`, `onProgress`, `onStatus` (`'checking' | 'downloading' | 'initializing' | 'ready'`), and `catalogVersion` options.

- **`isModelDownloaded(model): Promise<{ downloaded, path? }>`** — now accepts a full `KnownModelEntry` (preferred) or a raw name string. When given an entry it checks both `name` and `catalogName`, fixing false-negative results for catalog-downloaded models.

- **`getInitializedModel(): Promise<{ engine, modelPath } | null>`** — query the currently loaded engine and model path from native. Returns `null` when idle.

- **`setSystemPrompt(prompt): Promise<void>`** — injects a persistent system instruction into every subsequent `generateResponse`, `generateResponseStream`, and `generateResponseStateless` call. Implemented natively in Kotlin:
  - LiteRT-LM / MediaPipe: prepended as `System: <prompt>\n\n`
  - Gemma IT models: wrapped in `<start_of_turn>system\n...<end_of_turn>` chat template

- **`clearSystemPrompt(): Promise<void>`** — removes the active system prompt.

- **`getTokenCount(text): Promise<number>`** — estimates the token count for a string. Implemented as `max(0, floor(chars / 3.5))` — a conservative approximation suitable for context-window budget checks.

- **`generateResponseStateless(prompt): Promise<string>`** — previously internal. Now exported as a public API. Runs a one-shot inference that bypasses conversation state, suitable for extraction, classification, and tool-call pipelines.

- **Native tracking fields** (`AiCoreModule.kt`) — `currentEngineName`, `currentModelPath`, and `systemPrompt` now tracked across `initialize()` / `release()` calls to power `getInitializedModel()` and the system prompt injection.

### Fixed

- **`isModelDownloaded()` always returning `false`** — the function was comparing the `KnownModel` display name (e.g. `'Gemma 4 2B'`) against the directory name written by `downloadModel()` (e.g. `'Gemma-4-E2B-it'`). Fixed by introducing `catalogName` and matching against both.

- **`ensureModel()` catalog lookup failing** — was matching by `modelId` which no longer coincides with any entry in catalog `1_0_11.json`. Now uses `catalogName` for an exact match with a `modelId` fallback.

- **`KnownModel` `modelId` fields outdated** — all entries updated to the repository IDs actually present in the current Google AI Edge catalog (`1_0_11.json`). Removed `GEMMA3_4B`, `PHI4_MINI`, `MISTRAL_7B`, `LLAMA3_1B`, `LLAMA3_3B` — these are not in the current catalog. Added `GEMMA4_4B`, `GEMMA3N_2B`, `GEMMA3N_4B`, `QWEN25_1B5`, `DEEPSEEK_R1_1B5`.

### Security

- **Removed `MANAGE_EXTERNAL_STORAGE` permission** from `AndroidManifest.xml`. This dangerous permission was declared but never requested at runtime and caused unnecessary Google Play security flags. All model storage uses `getExternalFilesDir()`, which requires no permission on Android ≥ 10.

---

## [0.4.0] - 2026-04-09

### Added

- **LiteRT-LM backend** (`com.google.ai.edge.litertlm:litertlm-android:0.10.0`) — on-device inference with any HuggingFace-compatible `.task` model (Gemma 4, Gemma 3, Gemini Nano, Phi-4, Mistral, Llama 3, etc.)
  - Single `Backend.CPU()` initialization — stable on all Android devices; GPU/NPU path removed after reproducible OpenCL OOM crashes on Tensor G4
  - `LITERTLM_MAX_TOKENS = 4096` — increased from 1024 to support large JSON generations
  - `INFERENCE_TIMEOUT_SEC = 180L` — all `CountDownLatch.await()` calls now time out after 3 minutes, preventing ANR when `onDone()` never fires (upstream litertlm bug #447)
  - Correct message text extraction from LiteRT-LM `Message` objects via `message.contents.contents.filterIsInstance<Content.Text>().joinToString("")`
- **Model Catalog + Download** — browse and download models from HuggingFace Hub directly from the example app
  - HuggingFace token saved to Android Keystore / iOS Keychain via `expo-secure-store` — never stored in plain SharedPreferences
  - Download progress (bytes received, total, kbps) shown in real time
  - Downloaded models listed and selectable in the Models tab
- **Automatic conversation reset** (`tryResetLitertlmConversation`) — auto-resets the context window when the model reports it is full, instead of throwing an unhandled error
- **`expo-secure-store` integration** — HuggingFace token persisted securely across app restarts; cleared automatically when the field is emptied

### Changed

- **Structured output example — `single` strategy** — `buildWeeklyWorkoutPlan` switched from `strategy: 'chunked'` (20+ inference calls) to `strategy: 'single'` (1 inference call), reducing generation time from several minutes to under 30 seconds on Gemma 4 CPU
  - Internal schema (`InternalPlanSchema`) requests only Monday–Friday (5 days, 3 exercises each); Saturday/Sunday rest days are added in JS post-processing, saving ~40 % output tokens
  - Field names shortened (`restSeconds` → `rest`) in the internal schema, expanded back to the public `WorkoutPlan` type after generation
  - `WorkoutPlan`, `WorkoutDay`, `Exercise` converted from Zod-inferred types to plain TypeScript interfaces (schemas were only used for type inference, not runtime validation)
  - `timeoutMs` raised from 90 000 ms → 180 000 ms to accommodate Gemma 4 on CPU
- **Chat UI — ChatGPT-style dark theme**
  - Assistant messages: full-width, no background bubble, `color: #e2e8f0` Markdown text
  - User messages: pill right-aligned, `backgroundColor: #6366f1`, no avatar
  - No top header bar; Clear button moved inline into the model status bar
  - Stream-mode indicator row removed from input bar
- **Keyboard behaviour**
  - Tab bar moved outside `KeyboardAvoidingView` — eliminates residual padding gap after keyboard dismiss on Android
  - `Keyboard.dismiss()` called on send — keyboard closes immediately when a message is sent
  - `blurOnSubmit={true}` — keyboard also closes on Return/Done key
- `windowSoftInputMode` set to `adjustResize` in `AndroidManifest.xml`

### Fixed

- **OOM crash on init** — eliminated NPU → GPU → CPU cascade that loaded the 2.4 GB model up to three times simultaneously
- **OpenCL "cannot find opencl lib" crash** — `initialize()` does not throw for missing OpenCL; first inference fails instead; fixed by removing GPU probe entirely
- **ANR on long generation** — `latch.await()` without timeout caused the UI thread to hang indefinitely when `onDone()` was never called; now uses `latch.await(180, TimeUnit.SECONDS)`
- **Empty message text** — `message.toString()` was returning the Kotlin data-class representation; fixed to extract text via `Content.Text` filter
- **Fallback plan always shown** — `timeoutMs: 90000` was too short for Gemma 4 on CPU; raised to 180 000 ms
- **Lint** — all `prettier/prettier` formatting errors auto-fixed; removed unused Zod runtime schema `WorkoutPlanSchema`

---

## [0.3.1] - 2026-04-08

### Fixed

- CI `build-android`: `expo prebuild` was regenerating `gradle.properties` with `minSdkVersion=24`; the workflow now forces `minSdkVersion=26` via `sed` immediately after prebuild, preventing the manifest merger failure with `genai-prompt`.
- `app.json`: added `"minSdkVersion": 26` to the `android` section so future local prebuilds also generate the correct value.

---

## [0.3.0] - 2026-04-08

### Added

- **`cancelGeneration()`** — new API to stop an in-progress generation at any time.
  - Streaming (`generateResponseStream`): stops the token stream and fires `onComplete` cleanly (no error event).
  - Blocking (`generateResponse`): rejects the pending promise with `{ code: 'CANCELLED' }`.
  - Available as a named export (`cancelGeneration`) and on the default `AICore` object.
- **`signal?: AbortSignal` in `generateStructuredResponse`** — pass a standard `AbortSignal` to cancel the chunked tree-walker mid-flight.
  - Each inter-field `sleep` respects the signal immediately; rejects with `Error { name: 'AbortError' }` as soon as abort is called.
  - Also plumbed through all internal helpers: `generateStateless`, `generateStatelessWithTimeout`, `generateStatelessWithQuotaRetry`, `tryGenerateWithQuotaTolerance`, and `generateChunked`.
- Stop button (■) in the example app replaces the send button while generation is in progress.
- Compact inline stop pill in the structured-output preview banner.

### Changed

- `generateStructuredResponse` options table expanded with `strategy`, `maxContinuations`, `timeoutMs`, `onProgress` and `signal` fields in the README.

### Fixed

- Streaming stop no longer emits `onError` after `cancelGeneration()` — the inner catch now checks the cancel flag before forwarding the exception.
- Structured chunked generation (complex JSON) now stops immediately on cancel instead of completing the current field tree.

---

## [Unreleased]

### Planned
- iOS support (Core ML / Apple Neural Engine)
- Automatic model download manager
- System prompt / persona configuration
- Token count estimation

---

## [0.2.0] - 2026-04-08

### Added
- **Android Foreground Service** (`InferenceService`) — keeps the process alive during background generation with a persistent silent notification
  - `android.permission.FOREGROUND_SERVICE_DATA_SYNC` permission
  - Service auto-stops when the app is removed from the recents list (`onTaskRemoved`)
  - Service stops on module invalidation (hot-reload / app destroy)
- **Structured output — chunked strategy** (`generateStructuredResponse` with `strategy: 'chunked'`)
  - Tree-walker that decomposes any Zod schema into atomic model calls
  - Per-node timeout caps: leaf 15 s, compact object 30 s, array count 8 s
  - Enum / literal coercion via `coercePrimitiveField` — handles unquoted model output
  - `synthesizeLeafFallback` — deterministic per-type fallback when the model times out
  - `getArrayBounds` — reads `.length()` / `.min()` / `.max()` from Zod array schemas plus domain heuristics (`days` → 7, `exercises` → 3–4)
  - `hasNestedArray` guard — prevents compact calls on objects that contain nested arrays
  - `progressLabel` on `WalkContext` for human-readable progress callbacks (`days[1/7]`, `days.0.exercises[2/4]`, …)
- **Background error handling** — auto-retry with 2 s delay (max 1 retry) when ML Kit throws “background usage is blocked”
- **Stateless continuations fix** — automatic response continuations are now gated on `useConversationHistory == true`, eliminating per-field multi-minute timeouts in structured generation
- **Deterministic fallback** in example app — `buildDeterministicWorkoutPlan()` returns a hardcoded valid plan when all on-device calls fail; `buildWeeklyWorkoutPlan` is wrapped in a top-level try/catch
- **`normalizeWorkoutPlan`** — de-duplicates days, enforces Mon–Sun order, fills missing days, forces weekend = rest, limits exercises to 3–4
- **JSON viewer scroll** in example app — vertical (`maxHeight: 220`) + horizontal `ScrollView` for both structured output panels

### Changed
- `INTER_CALL_DELAY_MS` reduced 400 ms → 100 ms
- `MAX_WHOLE_ARRAY_COMPACT_ITEMS` lowered to 2 (array fast-path only for very small arrays)
- All user-visible strings and code comments translated to English

### Fixed
- Build error: `foregroundServiceType="dataProcessing"` is not a valid value; changed to `dataSync`
- `days.0.day` enum field failure — model returned unquoted `Monday`; added case-insensitive enum matching
- Array exercises showing 7/7 — `askArrayCount` now respects schema bounds instead of the global `MAX_ARRAY_COUNT` cap

---

## [0.1.0] - 2026-04-08

> ⚠️ **Development in Progress** — Initial pre-release. APIs may change.

### Added
- **Dual-backend architecture**
  - `ML Kit AICore` (`genai-prompt:1.0.0-beta2`) — hardware-accelerated Gemini Nano via device NPU (Pixel 9+)
  - `MediaPipe Tasks GenAI` (`tasks-genai:0.10.22`) — file-based inference with local `.bin` model
- **TurboModule (New Architecture)** — JSI bridge with zero-overhead native calls
- **Streaming support** — token-by-token delivery via `NativeEventEmitter`
  - Events: `AICore_streamToken`, `AICore_streamComplete`, `AICore_streamError`
- **Multi-turn conversation history** — native Kotlin implementation with sliding window (`HISTORY_MAX_CHARS = 9000`)
- **API methods:**
  - `initialize(modelPath)` — boot the inference engine (empty string = AICore, path = MediaPipe)
  - `generateResponse(prompt)` — single-shot generation
  - `generateResponseStream(prompt, callbacks)` — streaming generation
  - `checkAvailability()` — returns `AVAILABLE | AVAILABLE_NPU | NEED_DOWNLOAD | UNSUPPORTED`
  - `release()` — frees NPU/CPU memory
  - `resetConversation()` — clears conversation history without releasing the model
- **`useAICore` hook** — reference React hook implementation in example app
- **Example app** — full chat UI with Markdown rendering, keyboard avoiding, mode selector

### Technical
- Minimum Android API: 26
- `maxOutputTokens`: 256 (ML Kit AICore API limit)
- Coroutines: `kotlinx-coroutines-android:1.8.1`
- React Native: 0.81.5, Expo SDK 54

[Unreleased]: https://github.com/albertoroda/react-native-ai-core/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/albertoroda/react-native-ai-core/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/albertoroda/react-native-ai-core/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/albertoroda/react-native-ai-core/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/albertoroda/react-native-ai-core/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/albertoroda/react-native-ai-core/releases/tag/v0.1.0
