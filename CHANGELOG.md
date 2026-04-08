# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- iOS support (Core ML / Apple Neural Engine)
- Automatic model download manager
- Abort/cancel streaming mid-generation
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

[Unreleased]: https://github.com/albertoroda/react-native-ai-core/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/albertoroda/react-native-ai-core/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/albertoroda/react-native-ai-core/releases/tag/v0.1.0
