# react-native-ai-core

[![npm version](https://img.shields.io/npm/v/react-native-ai-core.svg)](https://www.npmjs.com/package/react-native-ai-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform: Android](https://img.shields.io/badge/Platform-Android-green.svg)](https://developer.android.com)
[![New Architecture](https://img.shields.io/badge/New%20Architecture-TurboModule-blue.svg)](https://reactnative.dev/docs/the-new-architecture/landing-page)

> **⚠️ Development in Progress** — This library is under active development. APIs may change between minor versions. Not recommended for production use yet.

On-device LLM inference for React Native using Google's **AI Edge SDKs**. Runs entirely on-device — no internet connection required, full privacy.

Three backends, one API:

| Backend | Constant | When it activates | Hardware |
|---|---|---|---|
| **LiteRT-LM** | `Engine.LITERTLM` | `modelPath` points to a `.litertlm` file | CPU (any Android ≥ 26) |
| **ML Kit AICore** | `Engine.AICORE` | `modelPath = ''` | NPU — Pixel 9+, Android 14+ |
| **MediaPipe** | `Engine.MEDIAPIPE` | `modelPath` points to a `.bin` file | CPU (any Android ≥ 26) |

Built with TurboModules (New Architecture), JSI bridge, zero-overhead streaming via `NativeEventEmitter`.

---

## Requirements

| | Minimum |
|---|---|
| React Native | 0.76+ (New Architecture) |
| Android API | 26 (Android 8) |
| Kotlin | 1.9+ |

> Testing requires a physical Android device. The Android emulator does not support the AI Edge SDKs.

---

## Installation

```sh
npm install react-native-ai-core
# or
yarn add react-native-ai-core
```

Add to `android/gradle.properties`:

```properties
minSdkVersion=26
```

The native module is auto-linked. The library's `AndroidManifest.xml` is merged automatically and declares:

- `INTERNET` — required for downloading models from HuggingFace Hub
- `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_DATA_SYNC` — keeps the process alive during background generation (Android 14+)
- `READ_EXTERNAL_STORAGE` (maxSdkVersion=32) — only required on Android ≤ 12L when using a custom model path outside the app's private directory

---

## HuggingFace Token

Most models in the catalog are **gated** — you need a free HuggingFace account and a read token.

1. Sign up at [huggingface.co](https://huggingface.co/join).
2. Go to **Settings → Access Tokens → New token** — choose *Read* scope.
3. Copy the token (starts with `hf_…`).
4. Accept each model's license on its HuggingFace page (e.g. [Gemma 4 2B](https://huggingface.co/google/gemma-4-2b-it-litertlm)) — click **Agree and access repository**.
5. Pass the token to `ensureModel()` via the `hfToken` option.

> Store the token securely (e.g. Keychain / Android Keystore). Never hardcode it in source code.

---

## Quick Start

```tsx
import AICore, { Engine, KnownModel } from 'react-native-ai-core';

// 1. Programmatic initialization — download model if needed, then initialize
await AICore.ensureModel(KnownModel.GEMMA4_2B, {
  hfToken: 'hf_…',          // only needed for gated models
  onProgress: (p) => console.log(`${Math.round(p.receivedBytes / p.totalBytes * 100)}%`),
  onStatus: (s) => console.log(s), // 'checking' | 'downloading' | 'initializing' | 'ready'
});

// 2. Generate a response
const answer = await AICore.generateResponse('What is React Native?');
console.log(answer);

// 3. Release resources when done
await AICore.release();
```

### Manual initialization (path-based)

```tsx
// ML Kit AICore backend (Gemini Nano NPU, Pixel 9+)
await AICore.initialize('');

// LiteRT-LM backend (any .litertlm file)
await AICore.initialize('/data/user/0/com.myapp/files/ai-core-models/Gemma-4-E2B-it/.../gemma-4-E2B-it.litertlm');

// MediaPipe backend (any .bin file)
await AICore.initialize('/sdcard/Download/model.bin');
```

### Vision (image + text)

Requires a vision-capable model (`GEMMA4_2B`, `GEMMA4_4B`, `GEMMA3N_2B`, or `GEMMA3N_4B`) and `configure({ enableVision: true })` **before** `ensureModel()`.

```tsx
import AICore, { KnownModel } from 'react-native-ai-core';

// 1. Enable GPU vision backend
await AICore.configure({ enableVision: true });
await AICore.ensureModel(KnownModel.GEMMA4_2B, { hfToken: 'hf_…' });

// 2. Convert image to base64 (e.g. with expo-image-picker + expo-file-system)
const base64 = await FileSystem.readAsStringAsync(imageUri, { encoding: 'base64' });

// 3. Blocking
const answer = await AICore.generateResponseWithImage(base64, 'Describe this image.');

// 4. Or streaming
const unsubscribe = AICore.generateResponseStreamWithImage(base64, 'What is in this photo?', {
  onToken:    (token) => setAnswer((p) => p + token),
  onComplete: () => setRunning(false),
  onError:    (err) => console.error(err),
});
```

### Rendering responses

`AICoreMarkdown` renders the model's markdown output natively — no external dependencies.

```tsx
import { AICoreMarkdown } from 'react-native-ai-core';

// Static
<AICoreMarkdown>{answer}</AICoreMarkdown>

// While streaming — shows a blinking cursor
<AICoreMarkdown streaming>{partialAnswer}</AICoreMarkdown>
```

### Streaming

```tsx
const unsubscribe = AICore.generateResponseStream('Explain JSI in detail', {
  onToken:    (token, done) => process.stdout.write(token),
  onComplete: () => console.log('[done]'),
  onError:    (err) => console.error(err.code, err.message),
});

// Remove listeners on unmount
return () => unsubscribe();
```

### Structured output

```tsx
import { z } from 'zod';
import { generateStructuredResponse } from 'react-native-ai-core';

const TicketSchema = z.object({
  category: z.enum(['bug', 'billing', 'feature']),
  priority: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  needsHuman: z.boolean(),
});

const ctrl = new AbortController();

const result = await generateStructuredResponse({
  prompt: 'Classify this support request.',
  input: { message: 'The app crashes when I try to export a PDF invoice.' },
  output: TicketSchema,
  signal: ctrl.signal,
});
```

---

## API Reference

### Core methods

| Method | Returns | Description |
|---|---|---|
| `initialize(modelPath)` | `Promise<boolean>` | Start the engine. Pass `''` for AICore NPU, a `.litertlm` path for LiteRT-LM, or a `.bin` path for MediaPipe |
| `release()` | `Promise<void>` | Free the model from memory |
| `resetConversation()` | `Promise<void>` | Clear chat history without releasing the model |
| `checkAvailability()` | `Promise<AvailabilityStatus>` | Check device support for ML Kit AICore (NPU path) |
| `generateResponse(prompt)` | `Promise<string>` | Blocking inference — waits for the complete response |
| `generateResponseStream(prompt, callbacks)` | `() => void` | Streaming inference — delivers tokens via `NativeEventEmitter`. Returns a cleanup function |
| `cancelGeneration()` | `Promise<void>` | Stop an in-progress `generateResponse` or `generateResponseStream` call |
| `generateResponseStateless(prompt)` | `Promise<string>` | One-shot inference that does **not** pollute conversation history |
| `generateStructuredResponse(options)` | `Promise<T>` | Generate and validate structured JSON output against a Zod schema |
| `generateResponseWithImage(base64, prompt)` | `Promise<string>` | Blocking image + text inference. Requires `configure({ enableVision: true })` |
| `generateResponseStreamWithImage(base64, prompt, callbacks)` | `() => void` | Streaming image + text inference. Returns a cleanup function |

### Model management

| Method | Returns | Description |
|---|---|---|
| `ensureModel(model, opts?)` | `Promise<void>` | Full lifecycle helper: check on-device → download if missing → initialize. Accepts a `KnownModelEntry` |
| `isModelDownloaded(model)` | `Promise<{ downloaded, path? }>` | Check whether a model file is already on the device. Accepts a `KnownModelEntry` or a raw name string |
| `getInitializedModel()` | `Promise<{ engine, modelPath } \| null>` | Query the currently loaded engine and model path. Returns `null` when idle |
| `fetchModelCatalog(version?)` | `Promise<ModelCatalogEntry[]>` | Fetch the Google AI Edge model catalog from GitHub |
| `downloadModel(entry, token?, onProgress?)` | `Promise<string>` | Download a catalog entry from HuggingFace Hub. Returns the local file path |
| `getDownloadedModels()` | `Promise<DownloadedModel[]>` | List all models stored in the app's private files directory |
| `cancelDownload()` | `void` | Cancel an ongoing `downloadModel` call |

### System prompt

| Method | Returns | Description |
|---|---|---|
| `setSystemPrompt(prompt)` | `Promise<void>` | Inject a persistent system-level instruction that is prepended to every subsequent generation call. Has no visible effect in chat history |
| `clearSystemPrompt()` | `Promise<void>` | Remove the active system prompt |

### Runtime configuration

| Method | Returns | Description |
|---|---|---|
| `configure(options)` | `Promise<void>` | Update inference parameters at runtime without reinitialising the engine. Includes `enableVision`. See [`AICoreConfig`](#aicoreconfig) |

### Token estimation

| Method | Returns | Description |
|---|---|---|
| `getTokenCount(text)` | `Promise<number>` | Estimate the token count for a given string. Useful for checking context-window budget before sending large inputs |

### UI components

| Export | Description |
|---|---|
| `AICoreMarkdown` | Native markdown renderer for LLM responses. Supports headings, bold, italic, code blocks, lists, and a streaming cursor |
| `visionModels` | Array of `KnownModelEntry` objects that support vision inference |

---

## Enums & Constants

### `Engine`

Type-safe backend selector. Used in `KnownModelEntry` and `getInitializedModel()`.

```ts
import { Engine } from 'react-native-ai-core';

Engine.AICORE     // 'aicore'    — ML Kit NPU (Pixel 9+)
Engine.LITERTLM   // 'litertlm' — file-based LiteRT-LM (any Android ≥ 26)
Engine.MEDIAPIPE  // 'mediapipe' — file-based MediaPipe (any Android ≥ 26)
```

### `KnownModel`

A curated registry of models from the [Google AI Edge catalog](https://github.com/google-ai-edge/gallery/tree/main/model_allowlists). Pass any entry directly to `ensureModel()` or `isModelDownloaded()`.

```ts
import { KnownModel } from 'react-native-ai-core';

await AICore.ensureModel(KnownModel.GEMMA4_2B, { hfToken });
```

| Key | Display name | Engine | Size | Notes |
|---|---|---|---|---|
| `GEMINI_NANO` | Gemini Nano | `AICORE` | — | Native NPU only (Pixel 9+). No download needed |
| `GEMMA4_2B` | Gemma 4 2B | `LITERTLM` | ~2.4 GB | **Recommended.** Multimodal (text/image/audio), 32 K context |
| `GEMMA4_4B` | Gemma 4 4B | `LITERTLM` | ~3.4 GB | Higher quality, requires ≥ 12 GB RAM |
| `GEMMA3N_2B` | Gemma 3n 2B | `LITERTLM` | ~3.4 GB | Multimodal (text/image/audio), 4 K context |
| `GEMMA3N_4B` | Gemma 3n 4B | `LITERTLM` | ~4.6 GB | Multimodal, requires ≥ 12 GB RAM |
| `GEMMA3_1B` | Gemma 3 1B | `LITERTLM` | ~0.55 GB | Fastest, lowest RAM requirement |
| `QWEN25_1B5` | Qwen 2.5 1.5B | `LITERTLM` | ~1.5 GB | Good multilingual support |
| `DEEPSEEK_R1_1B5` | DeepSeek R1 1.5B | `LITERTLM` | ~1.7 GB | Reasoning-capable distilled model |

> All `LITERTLM` models are sourced from the `google-ai-edge` / `litert-community` organisations on HuggingFace. `ensureModel()` handles the download automatically. See `fetchModelCatalog()` to browse the full list.

---

## Types

```ts
export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'AVAILABLE_NPU'
  | 'NEED_DOWNLOAD'
  | 'UNSUPPORTED';

export type Engine = 'aicore' | 'litertlm' | 'mediapipe';

export interface KnownModelEntry {
  name: string;          // Human-readable display name
  engine: Engine;
  modelId: string;       // HuggingFace repo ID
  sizeGb: number;        // Approximate download size
  catalogName?: string;  // Exact name in the Google AI Edge catalog JSON (= directory name on disk)
}

export interface EnsureModelOptions {
  hfToken?: string;                          // HuggingFace access token (for gated models)
  onProgress?: DownloadProgressCallback;     // Download progress events
  onStatus?: (status: EnsureModelStatus) => void; // 'checking' | 'downloading' | 'initializing' | 'ready'
  catalogVersion?: string;                   // Override catalog version (default: '1_0_11')
}

export type EnsureModelStatus =
  | 'checking'
  | 'downloading'
  | 'initializing'
  | 'ready';

export interface DownloadProgressEvent {
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  remainingMs: number;
}

export type DownloadProgressCallback = (progress: DownloadProgressEvent) => void;

export interface ModelCatalogEntry {
  name: string;
  modelId: string;
  modelFile: string;
  commitHash: string;
  sizeInBytes: number;
  description?: string;
  minDeviceMemoryInGb?: number;
}

export interface DownloadedModel {
  name: string;
  commitHash: string;
  fileName: string;
  path: string;        // Absolute path — pass directly to initialize()
  sizeInBytes: number;
}

export interface StreamCallbacks {
  onToken:    (token: string, done: boolean) => void;
  onComplete: () => void;
  onError:    (error: AIError) => void;
}

export interface AIError {
  code:    string;
  message: string;
}

export interface AICoreConfig {
  inferenceTimeoutSec?: number; // [30–3600], default 420
  temperature?: number;         // [0.0–2.0], default 0.7
  topK?: number;                // [1–256], default 64
  maxContinuations?: number;    // [0–50], default 12
  enableVision?: boolean;       // Enable GPU vision backend (required for *WithImage methods)
}

export interface AICoreMarkdownProps {
  children: string;       // Markdown string to render
  streaming?: boolean;    // Show blinking cursor while streaming (default: false)
  textColor?: string;     // Base text color (default: '#e2e8f0')
  headingColor?: string;  // Heading color (default: '#f1f5f9')
}
```

---

## `AICoreConfig`

Passed to `configure()`. All fields are optional — omit any field (or pass `-1`) to keep the current value.

| Field | Type | Default | Range | Notes |
|---|---|---|---|---|
| `inferenceTimeoutSec` | `number` | `420` | 30–3600 | Seconds before inference is aborted. Increase for long-form responses (e.g. meal plans, code generation) |
| `temperature` | `number` | `0.7` | 0.0–2.0 | Sampling randomness. For **LiteRT-LM**: takes effect on the next `resetConversation()` or `initialize()` |
| `topK` | `number` | `64` | 1–256 | Top-K sampling. For **LiteRT-LM**: takes effect on the next `resetConversation()` or `initialize()` |
| `maxContinuations` | `number` | `12` | 0–50 | Maximum auto-continuation passes. Only applies to the `aicore` (Gemini Nano / ML Kit) engine |
| `enableVision` | `boolean` | `false` | — | Enable the GPU vision backend. Must be set **before** `ensureModel()`. Required for `generateResponseWithImage` and `generateResponseStreamWithImage` |

```typescript
// Increase timeout for a very long document summary
await AICore.configure({ inferenceTimeoutSec: 900 });

// More creative, less deterministic
await AICore.configure({ temperature: 1.2, topK: 80 });

// Mix — only the fields you pass are changed
await AICore.configure({ inferenceTimeoutSec: 600, temperature: 0.5 });
```

---

## `generateStructuredResponse` options

| Option | Type | Default | Description |
|---|---|---|---|
| `prompt` | `string` | — | Natural language instruction |
| `input` | `unknown` | — | Optional structured input object serialized to JSON before the prompt |
| `inputSchema` | `ZodType` | — | Optional Zod schema to validate `input` before generation |
| `output` | `ZodType` | — | **Required.** Schema to validate the model output |
| `strategy` | `'single' \| 'chunked'` | `'single'` | `'single'` generates all JSON in one call; `'chunked'` walks the schema field-by-field |
| `maxRetries` | `number` | `2` | Repair-prompt attempts when output fails schema validation |
| `maxContinuations` | `number` | `8` | Max continuation calls when JSON is truncated mid-output |
| `timeoutMs` | `number` | `300000` | Per-call timeout in ms |
| `onProgress` | `(field, done) => void` | — | Called per field during `'chunked'` strategy |
| `signal` | `AbortSignal` | — | Cancel mid-generation. Rejects with `Error { name: 'AbortError' }` |

Cancellation example:

```tsx
const ctrl = new AbortController();
const promise = generateStructuredResponse({ ..., signal: ctrl.signal });
ctrl.abort(); // cancel from a button handler
```

---

## Programmatic initialization example

For apps that manage the full lifecycle in code (e.g. background services, non-chat apps), `ensureModel()` provides a one-call solution:

```tsx
import AICore, { KnownModel } from 'react-native-ai-core';

await AICore.ensureModel(KnownModel.GEMMA3_1B, {
  onStatus: (s) => console.log(s),
  onProgress: ({ receivedBytes, totalBytes }) =>
    console.log(`${((receivedBytes / totalBytes) * 100).toFixed(0)}%`),
});

// Set a persistent persona
await AICore.setSystemPrompt(
  'You are a precise JSON extractor. Respond only with valid JSON, no markdown.'
);

// Estimate context budget
const tokens = await AICore.getTokenCount(myLargeDocument);
if (tokens > 3500) throw new Error('Document too large for context window');

// One-shot inference without polluting chat history
const json = await AICore.generateResponseStateless(
  `Extract invoice data from:\n${myLargeDocument}`
);

// Query what is currently loaded
const model = await AICore.getInitializedModel();
// { engine: 'litertlm', modelPath: '/data/user/0/...' }

await AICore.clearSystemPrompt();
await AICore.release();
```

---

## `useAICore` Hook

A ready-to-use React hook in the example app handles:

- Engine lifecycle (initialize / release)
- Streaming with incremental message updates
- Conversation history
- Error state management
- `stopGeneration()` to abort in-progress responses

See [`example/src/hooks/useAICore.ts`](example/src/hooks/useAICore.ts).

---

## Backends

### LiteRT-LM (`Engine.LITERTLM`)

Used when `modelPath` ends with `.litertlm`. Works on any Android ≥ 26. Models are downloaded from HuggingFace Hub (use `ensureModel()` or `fetchModelCatalog()` + `downloadModel()`) and stored in the app's private external directory — no special permissions required.

Dependency: `com.google.ai.edge.litertlm:litertlm-android:0.10.0`

### ML Kit AICore (`Engine.AICORE`)

Used when `modelPath = ''`. Requires a Pixel 9 or a device with [Android AICore](https://developer.android.com/ml/gemini-nano). Model is managed by Google via system updates — no file download needed.

Dependency: `com.google.mlkit:genai-prompt:1.0.0-beta2`

### MediaPipe Tasks GenAI (`Engine.MEDIAPIPE`)

Used when `modelPath` ends with `.bin`. Works on any Android ≥ 26.

```sh
adb push gemini-nano.bin /data/local/tmp/gemini-nano.bin
```

Dependency: `com.google.mediapipe:tasks-genai:0.10.22`

---

## Roadmap

- [x] LiteRT-LM backend — Gemma 4, Gemma 3n, Gemma 3, Qwen, DeepSeek and more
- [x] ML Kit AICore backend — Gemini Nano NPU (Pixel 9+)
- [x] MediaPipe Tasks GenAI backend
- [x] Model catalog + download from HuggingFace Hub
- [x] HuggingFace token stored securely (Android Keystore via `expo-secure-store`)
- [x] Abort/cancel streaming mid-generation
- [x] Structured JSON output with Zod validation and repair retries
- [x] `ensureModel()` — programmatic check → download → initialize lifecycle
- [x] `setSystemPrompt()` / `clearSystemPrompt()` — persistent session instruction
- [x] `getTokenCount()` — context-window budget estimation
- [x] `generateResponseStateless()` — one-shot inference without history pollution
- [x] `getInitializedModel()` — query what is currently loaded
- [x] `KnownModel` registry with `Engine` enum
- [x] `configure()` — tune timeout, temperature, topK and continuation passes at runtime
- [x] Vision (image + text) inference — `generateResponseWithImage` / `generateResponseStreamWithImage`
- [x] `AICoreMarkdown` — native zero-dependency markdown renderer with streaming cursor
- [x] `visionModels` — curated list of vision-capable model entries
- [ ] iOS support (Core ML / Apple Neural Engine)
- [ ] Model quantization options (INT4, INT8)
- [ ] Web support (WebGPU / WASM)
- [ ] Warm-up inference after `initialize()` to amortize JIT/page-cache cost

---

## Contributing

Contributions, issues and feature requests are welcome.

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

---

## License

MIT © [Alberto Fernandez](https://github.com/albertoroda)

---

<sub>Built with [react-native-builder-bob](https://github.com/callstack/react-native-builder-bob)</sub>


---