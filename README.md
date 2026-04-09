# react-native-ai-core

[![npm version](https://img.shields.io/npm/v/react-native-ai-core.svg)](https://www.npmjs.com/package/react-native-ai-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform: Android](https://img.shields.io/badge/Platform-Android-green.svg)](https://developer.android.com)
[![New Architecture](https://img.shields.io/badge/New%20Architecture-TurboModule-blue.svg)](https://reactnative.dev/docs/the-new-architecture/landing-page)

> **⚠️ Development in Progress** — This library is under active development. APIs may change between minor versions. Not recommended for production use yet.

On-device LLM inference for React Native using Google's **AI Edge SDKs**. Runs entirely on-device — no internet connection required, full privacy.

Three backends, one API:
- **LiteRT-LM** (`litertlm-android`) — load any HuggingFace-compatible `.task` model: **Gemma 4**, Gemma 3, Phi-4, Mistral, Llama 3 and more (Android API ≥ 26)
- **ML Kit AICore** (`genai-prompt`) — hardware-accelerated Gemini Nano via device NPU (Pixel 9+, Android 14+, no model file needed)
- **MediaPipe Tasks GenAI** (`tasks-genai`) — file-based inference with a local `.bin` model (any Android API ≥ 26)

Built with TurboModules (New Architecture), JSI bridge, zero-overhead streaming via `NativeEventEmitter`.

---

## Requirements

| | Minimum |
|---|---|
| React Native | 0.76+ (New Architecture) |
| Android API | 26 (Android 8) |
| Kotlin | 1.9+ |

**For LiteRT-LM backend:** Any Android device API ≥ 26. Requires a `.task` model file downloaded from HuggingFace Hub (see [Compatible models](#compatible-models)).

**For ML Kit AICore backend:** Pixel 9 or any device with `Feature.AI_CORE` support (Android 14+, NPU required).

**For MediaPipe backend:** Any Android device API ≥ 26. Requires a downloaded Gemini Nano `.bin` model file on the device.

---

## Installation

```sh
npm install react-native-ai-core
# or
yarn add react-native-ai-core
```

### Android setup

Add to `android/gradle.properties`:

```properties
minSdkVersion=26
```

The native module is auto-linked. No manual permission declarations are needed — the library's `AndroidManifest.xml` is merged automatically into your app and includes:

- `FOREGROUND_SERVICE` — keeps the process alive during background generation
- `FOREGROUND_SERVICE_DATA_SYNC` — required foreground service type (Android 14+)

These permissions will appear in your compiled app manifest and may be visible in Play Store security reviews.

> **Note:** Testing requires a physical Android device. The Android emulator does not support NPU hardware or the AICore system service, so the ML Kit AICore backend will not function on it. The MediaPipe backend may run in an emulator but is not officially supported or tested in that environment.

---

## Quick Start

```tsx
import AICore from 'react-native-ai-core';

// 1. Check availability
const status = await AICore.checkAvailability();
// 'AVAILABLE' | 'AVAILABLE_NPU' | 'NEED_DOWNLOAD' | 'UNSUPPORTED'

// 2. Initialize the engine
// Pass an empty string '' to use the ML Kit AICore backend (Pixel 9+).
// Pass an absolute path to a .bin file to use the MediaPipe backend.
await AICore.initialize(''); // AICore native (NPU)

// 3. Generate a response
const answer = await AICore.generateResponse('What is React Native?');
console.log(answer);

// 4. Release resources when done
await AICore.release();
```

### Streaming

```tsx
const unsubscribe = AICore.generateResponseStream('Explain JSI in detail', {
  onToken: (token, done) => {
    process.stdout.write(token);
    if (done) console.log('\n[stream ended]');
  },
  onComplete: () => console.log('Done!'),
  onError: (err) => console.error(err.code, err.message),
});

// Cancel subscriptions when component unmounts
return () => unsubscribe();
```

### Multi-turn conversation

The native engine keeps a conversation history automatically. Each call to `generateResponse` / `generateResponseStream` includes previous turns as context.

To start a fresh conversation without releasing the model:

```tsx
await AICore.resetConversation();
```

### Structured output with runtime validation

For app-internal AI features such as extraction, classification, routing, or tool orchestration, use `generateStructuredResponse(...)`.

- Validates optional structured input before generation
- Forces JSON-only output
- Extracts JSON even if the model wraps it in extra text
- Validates the final payload with `zod`
- Retries automatically with a repair prompt when validation fails
- Uses a stateless native request so it does not pollute chat conversation history
- Supports an `AbortSignal` to cancel mid-generation

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
  prompt: 'Classify this support request and summarize it.',
  input: {
    message: 'The app crashes when I try to export a PDF invoice.',
  },
  output: TicketSchema,
  signal: ctrl.signal,
});

// Cancel mid-way
ctrl.abort();
```

Recommended for reliability on-device:
- Keep the prompt short and task-specific
- Keep `input` compact and validated before sending it
- Prefer small output schemas over deeply nested ones
- Use this API for internal app workflows, not long-form generation
- Repair retries are bounded and prompt size is trimmed internally to avoid hitting the same context limits as chat flows

There is also a concrete demo helper in [example/src/examples/structuredOutputExample.ts](example/src/examples/structuredOutputExample.ts).

### Cancelling generation

Both chat and structured generation can be stopped at any point.

**Chat / streaming:**

```tsx
import { cancelGeneration } from 'react-native-ai-core';

// Stop an ongoing generateResponse or generateResponseStream call
await cancelGeneration();
```

For streaming, the `onComplete` callback fires normally after cancellation — `onError` is not called.

**Structured output:**

Pass an `AbortSignal` from an `AbortController` to `generateStructuredResponse`. When you call `ctrl.abort()` the tree-walker stops at the next field boundary and rejects with an `Error` whose `name` is `'AbortError'`.

```tsx
const ctrl = new AbortController();

// Start generation
const promise = generateStructuredResponse({ ..., signal: ctrl.signal });

// Cancel from a button handler
ctrl.abort();

try {
  await promise;
} catch (err) {
  if (err.name === 'AbortError') {
    console.log('Cancelled by user');
  }
}
```

---

## API Reference

### `initialize(modelPath: string): Promise<boolean>`

Initializes the inference engine.

| Argument | Type | Description |
|---|---|---|
| `modelPath` | `string` | Pass `''` to use ML Kit AICore (native NPU). Pass an absolute path to a `.task` file to use LiteRT-LM. Pass an absolute path to a `.bin` file to use MediaPipe. |

Returns `true` on success. Throws on failure.

**Error codes:**
- `MODEL_NOT_FOUND` — file at `modelPath` does not exist
- `NPU_UNSUPPORTED` — device NPU is not compatible
- `INIT_FAILED` — engine failed to start

---

### `cancelGeneration(): Promise<void>`

Cancels the in-progress generation immediately.

- For **streaming** (`generateResponseStream`): stops the token stream and fires `onComplete` (not `onError`).
- For **blocking** (`generateResponse`): rejects the pending promise with code `CANCELLED`.
- Safe to call even when no generation is running.

```tsx
await AICore.cancelGeneration();
// or named export:
import { cancelGeneration } from 'react-native-ai-core';
await cancelGeneration();
```

---

### `generateResponse(prompt: string): Promise<string>`

Generates a complete response synchronously (waits for the full output).

```tsx
const response = await AICore.generateResponse('Tell me a joke');
```

**Error codes:**
- `NOT_INITIALIZED` — `initialize()` was not called first
- `GENERATION_ERROR` — model failed during inference

---

### `generateStructuredResponse(options): Promise<T>`

Generates stateless structured JSON and validates it against a user-defined `zod` schema.

```tsx
import { z } from 'zod';

const OutputSchema = z.object({
  intent: z.enum(['search', 'reply', 'ignore']),
  confidence: z.number(),
});

const ctrl = new AbortController();

const output = await generateStructuredResponse({
  prompt: 'Determine the next action for this message.',
  input: { message: 'Can you send me the invoice again?' },
  output: OutputSchema,
  signal: ctrl.signal,
});
```

Options:

| Option | Type | Description |
|---|---|---|
| `prompt` | `string` | Natural language instruction |
| `input` | `unknown` | Optional structured input object |
| `inputSchema` | `ZodType` | Optional schema to validate `input` before generation |
| `output` | `ZodType` | Required schema to validate the model output |
| `strategy` | `'single' \| 'chunked'` | `'single'` (default) generates the whole JSON in one call. `'chunked'` walks the schema field-by-field — use for large or complex schemas |
| `maxRetries` | `number` | Repair attempts when validation fails (default `2`) |
| `maxContinuations` | `number` | Max continuation calls when JSON is truncated (default `8`) |
| `timeoutMs` | `number` | Per-call timeout in ms (default `300000`) |
| `onProgress` | `(field, done) => void` | Called for each field during `'chunked'` generation |
| `signal` | `AbortSignal` | Pass a signal to cancel mid-generation. Rejects with `Error { name: 'AbortError' }` |

Throws `StructuredOutputError` if valid JSON matching the schema cannot be produced after retries.

---

### `generateResponseStream(prompt: string, callbacks: StreamCallbacks): () => void`

Generates a response token by token via streaming. Returns a cleanup function to remove event listeners.

```tsx
const StreamCallbacks = {
  onToken:    (token: string, done: boolean) => void,
  onComplete: () => void,
  onError:    (error: AIError) => void,
}
```

Events are delivered through `NativeEventEmitter`:
- `AICore_streamToken` → `{ token: string, done: boolean }`
- `AICore_streamComplete` → `{}`
- `AICore_streamError` → `{ code: string, message: string }`

---

### `checkAvailability(): Promise<AvailabilityStatus>`

Returns the current availability status of Gemini Nano on this device.

| Value | Meaning |
|---|---|
| `'AVAILABLE'` | Model is ready to use (file-based) |
| `'AVAILABLE_NPU'` | Model is ready and hardware-accelerated (AICore) |
| `'NEED_DOWNLOAD'` | Device is compatible but model needs to be downloaded |
| `'UNSUPPORTED'` | Device does not meet minimum requirements |

---

### `release(): Promise<void>`

Releases the model from NPU/CPU memory. Call this in your cleanup effect.

```tsx
useEffect(() => {
  AICore.initialize('');
  return () => { AICore.release(); };
}, []);
```

---

### `resetConversation(): Promise<void>`

Clears the conversation history in the native engine without releasing the model. The next call to `generateResponse` will start a new conversation.

---

## Types

```typescript
export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'AVAILABLE_NPU'
  | 'NEED_DOWNLOAD'
  | 'UNSUPPORTED';

export interface StreamCallbacks {
  onToken:    (token: string, done: boolean) => void;
  onComplete: () => void;
  onError:    (error: AIError) => void;
}

export interface AIError {
  code:    string;
  message: string;
}
```

---

## `useAICore` Hook

A ready-to-use React hook is available in the example app as a reference implementation. It handles:

- Availability check on mount
- Engine lifecycle (initialize / release)
- Streaming with incremental message updates
- Conversation history reset on clear
- Error state management
- `stopGeneration()` — calls `cancelGeneration()` to abort the in-progress response

See [`example/src/hooks/useAICore.ts`](example/src/hooks/useAICore.ts).

---

## Compatible models

The LiteRT-LM backend supports any model published on HuggingFace that provides a `.task` file compatible with the LiteRT-LM runtime. Models are downloaded from the Hub (optionally with a HuggingFace access token) and stored locally on the device.

| Model | Size | Context | Notes |
|---|---|---|---|
| **Gemma 4 2B** (`gemma-4-e2b-it`) | ~2.4 GB | 32 K tokens | Recommended. Strong instruction following, fast on CPU |
| **Gemma 3 1B** (`gemma-3-1b-it`) | ~1.1 GB | 8 K tokens | Fastest, lowest RAM |
| **Gemma 3 4B** (`gemma-3-4b-it`) | ~3.5 GB | 8 K tokens | Best quality in the Gemma 3 family |
| **Phi-4 Mini** (`phi-4-mini-instruct`) | ~2.5 GB | 16 K tokens | Strong reasoning |
| **Mistral 7B** | ~4.1 GB | 8 K tokens | Requires ≥ 6 GB RAM |
| **Llama 3.2 1B** | ~1.2 GB | 4 K tokens | Very fast |
| **Llama 3.2 3B** | ~2.1 GB | 4 K tokens | Good balance of size and quality |

> Models must be in LiteRT-LM `.task` format. Look for the `google-ai-edge` organisation on HuggingFace or use the model catalog built into the example app.

---

## Backends

### LiteRT-LM (file-based, any model)

Used when `modelPath` points to a valid `.task` file. Works on any Android device with API ≥ 26. Download the model from HuggingFace Hub (use the built-in catalog in the example app, or any HuggingFace download tool) and pass the local file path to `initialize()`.

The HuggingFace token (if required for gated models) is stored securely via the Android Keystore / iOS Keychain through `expo-secure-store`.

Dependency: `com.google.ai.edge.litertlm:litertlm-android:0.10.0`

### ML Kit AICore (native NPU)

Used when `modelPath = ''`. Requires a Pixel 9 or compatible device with Android's [AICore](https://developer.android.com/ml/gemini-nano) feature. The model runs fully on the device NPU with no file management needed — Google handles the model download automatically via system updates.

Dependency: `com.google.mlkit:genai-prompt:1.0.0-beta2`

### MediaPipe Tasks GenAI (file-based, `.bin`)

Used when `modelPath` points to a valid `.bin` file. Works on any Android device with API ≥ 26. You are responsible for placing the model file on the device (e.g., via `adb push` or a download manager).

```sh
adb push gemini-nano.bin /data/local/tmp/gemini-nano.bin
```

Dependency: `com.google.mediapipe:tasks-genai:0.10.22`

---

## Roadmap

- [ ] iOS support (Core ML / Apple Neural Engine)
- [x] LiteRT-LM backend — Gemma 4, Gemma 3, Phi-4, Mistral, Llama 3 and more
- [x] Model catalog + download from HuggingFace Hub
- [x] HuggingFace token stored securely (Android Keystore / iOS Keychain)
- [x] Abort/cancel streaming mid-generation
- [ ] Model quantization options (INT4, INT8)
- [ ] System prompt / persona configuration
- [ ] Token count estimation
- [ ] Web support (WebGPU / WASM)

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
