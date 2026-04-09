# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
