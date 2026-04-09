/**
 * react-native-ai-core
 *
 * JS abstraction layer over the native TurboModule.
 * Provides a clean, typed API for running Gemini Nano on-device
 * via the Google AI Edge SDK (MediaPipe).
 *
 * @example
 * import AICore from 'react-native-ai-core';
 *
 * await AICore.initialize('/data/local/tmp/gemini-nano.bin');
 * const answer = await AICore.generateResponse('What is JSI?');
 */

import { NativeEventEmitter, Platform } from 'react-native';
import NativeAiCore from './NativeAiCore';
import { generateStructuredResponse } from './structured';
export {
  generateStructuredResponse,
  StructuredOutputError,
  type StructuredGenerateOptions,
  type StructuredSchema,
  type StructuredValidationIssue,
} from './structured';

// ── Public types ────────────────────────────────────────────────────────────────

/** Availability status of Gemini Nano on the device */
export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'AVAILABLE_NPU'
  | 'NEED_DOWNLOAD'
  | 'UNSUPPORTED';

/** Streaming response callbacks */
export interface StreamCallbacks {
  /**
   * Called for each received token.
   * @param token  Partial text fragment.
   * @param done   `true` when the model has finished generating.
   */
  onToken: (token: string, done: boolean) => void;
  /** Called when the full generation has completed. */
  onComplete: () => void;
  /** Called if an error occurs during streaming. */
  onError: (error: AIError) => void;
}

/** Normalised error structure */
export interface AIError {
  code: string;
  message: string;
}

// ── Event names (must match the Kotlin module constants) ───────────────────────
const EVENT_STREAM_TOKEN = 'AICore_streamToken';
const EVENT_STREAM_COMPLETE = 'AICore_streamComplete';
const EVENT_STREAM_ERROR = 'AICore_streamError';
const EVENT_DOWNLOAD_PROGRESS = 'AICore_downloadProgress';

const emitter =
  NativeAiCore != null ? new NativeEventEmitter(NativeAiCore) : null;

function assertAvailable(): void {
  if (!NativeAiCore) {
    throw new Error(
      `react-native-ai-core: native module unavailable on ${Platform.OS}. ` +
        'This module requires Android with NPU support.'
    );
  }
}

// ── Public API ───────────────────────────────────────────────────────────────────

/**
 * Initialises the LLM inference engine with the given model.
 *
 * @param modelPath  Absolute path to the `.bin` model file on the device.
 *                   Pass an empty string to use ML Kit AICore (Gemini Nano NPU).
 * @returns          `true` on success.
 *
 * @throws `MODEL_NOT_FOUND`  if the file does not exist at `modelPath`.
 * @throws `NPU_UNSUPPORTED`  if the device NPU is incompatible.
 * @throws `INIT_FAILED`      if the engine could not start for another reason.
 *
 * @example
 * const ok = await initialize('/data/local/tmp/gemini-nano.bin');
 */
export async function initialize(modelPath: string): Promise<boolean> {
  assertAvailable();
  return NativeAiCore!.initialize(modelPath);
}

/**
 * Generates a complete (non-streaming) response for the given prompt.
 *
 * @param prompt  Input text for the model.
 * @returns       Full response as a string.
 *
 * @throws `NOT_INITIALIZED`  if `initialize()` was not called first.
 * @throws `GENERATION_ERROR` if the model fails during inference.
 *
 * @example
 * const response = await generateResponse('Explain TurboModules');
 */
export async function generateResponse(prompt: string): Promise<string> {
  assertAvailable();
  return NativeAiCore!.generateResponse(prompt);
}

/**
 * Generates a response token-by-token via streaming.
 * Tokens are delivered in real time through the callbacks.
 *
 * @param prompt     Input text for the model.
 * @param callbacks  `{ onToken, onComplete, onError }`.
 * @returns          Cleanup function — call it to remove the event subscriptions.
 *
 * @example
 * const unsubscribe = generateResponseStream('What is MediaPipe?', {
 *   onToken:    (token, done) => console.log(token),
 *   onComplete: ()            => console.log('Done!'),
 *   onError:    (err)         => console.error(err),
 * });
 *
 * // On component unmount:
 * unsubscribe();
 */
export function generateResponseStream(
  prompt: string,
  callbacks: StreamCallbacks
): () => void {
  if (!NativeAiCore || !emitter) {
    callbacks.onError({
      code: 'UNAVAILABLE',
      message: `react-native-ai-core is not available on ${Platform.OS}.`,
    });
    return () => {};
  }

  const tokenSub = emitter.addListener(
    EVENT_STREAM_TOKEN,

    (event: any) => {
      callbacks.onToken(
        (event as { token: string; done: boolean }).token,
        (event as { token: string; done: boolean }).done
      );
    }
  );

  const completeSub = emitter.addListener(EVENT_STREAM_COMPLETE, () => {
    callbacks.onComplete();
  });

  const errorSub = emitter.addListener(
    EVENT_STREAM_ERROR,

    (error: any) => {
      callbacks.onError(error as AIError);
    }
  );

  NativeAiCore.generateResponseStream(prompt);

  return () => {
    tokenSub.remove();
    completeSub.remove();
    errorSub.remove();
  };
}

/**
 * Checks whether Gemini Nano is available on this device.
 *
 * @returns
 *  - `'AVAILABLE'`     → Model is ready to use.
 *  - `'NEED_DOWNLOAD'` → Device is compatible but the model is not yet downloaded.
 *  - `'UNSUPPORTED'`   → Device does not meet the minimum requirements.
 *
 * @example
 * const status = await checkAvailability();
 * if (status === 'NEED_DOWNLOAD') {
 *   // show model download UI
 * }
 */
export async function checkAvailability(): Promise<AvailabilityStatus> {
  if (!NativeAiCore) return 'UNSUPPORTED';
  return NativeAiCore.checkAvailability() as Promise<AvailabilityStatus>;
}

/**
 * Releases the model from NPU memory.
 * **Recommended**: call in the root component's `useEffect` cleanup.
 *
 * @example
 * useEffect(() => {
 *   initialize(MODEL_PATH);
 *   return () => { release(); };
 * }, []);
 */
export async function release(): Promise<void> {
  if (!NativeAiCore) return;
  return NativeAiCore.release();
}

/**
 * Clears the conversation history in the native engine without releasing the model.
 * The next `generateResponse` call will start without any previous context.
 *
 * @example
 * await resetConversation(); // new conversation, same engine
 */
export async function resetConversation(): Promise<void> {
  if (!NativeAiCore) return;
  return NativeAiCore.resetConversation();
}

/**
 * Cancels any generation currently in progress.
 *
 * - **Streaming**: the stream ends immediately with tokens generated so far.
 * - **Non-streaming**: the pending `generateResponse` promise rejects with code `'CANCELLED'`.
 *
 * Safe to call when no generation is running.
 */
export async function cancelGeneration(): Promise<void> {
  if (!NativeAiCore) return;
  return NativeAiCore.cancelGeneration();
}

// ── Engine enum ──────────────────────────────────────────────────────────────

/**
 * The inference backend used to run a model.
 *
 * - `'aicore'`    – Google ML Kit AICore (Gemini Nano, NPU, Pixel 9+).
 * - `'litertlm'`  – Google LiteRT-LM (CPU, `.litertlm` files).
 * - `'mediapipe'` – Google MediaPipe LLM Inference (GPU/CPU, `.bin` files).
 */
export const Engine = {
  AICORE: 'aicore',
  LITERTLM: 'litertlm',
  MEDIAPIPE: 'mediapipe',
} as const;
export type Engine = (typeof Engine)[keyof typeof Engine];

// ── KnownModel registry ───────────────────────────────────────────────────────

/**
 * A statically-typed model descriptor used with `ensureModel()`.
 * For AICore (Gemini Nano), `modelId` and `sizeGb` are empty / 0.
 */
export interface KnownModelEntry {
  /** Human-readable display name. */
  name: string;
  engine: Engine;
  /**
   * HuggingFace repository ID used to look up the model in the catalog.
   * Empty string for `Engine.AICORE` (no file download required).
   */
  modelId: string;
  /** Approximate model size in GB (for UI display). */
  sizeGb: number;
  /**
   * The exact `name` field from the Google AI Edge catalog JSON.
   * Used internally to locate the file on disk after a catalog download,
   * since the directory is named after the catalog entry, not the display name.
   * Leave `undefined` for models that are not in the catalog (e.g. AICORE).
   */
  catalogName?: string;
}

/**
 * Catalogue of well-known on-device models.
 * Use with `ensureModel()` or as a type-safe reference to model identifiers.
 *
 * @example
 * await ensureModel(KnownModel.GEMMA4_2B, { hfToken, onProgress });
 */
export const KnownModel = {
  /** Gemini Nano — Google's native NPU model on Pixel 9+. No file download needed. */
  GEMINI_NANO: {
    name: 'Gemini Nano',
    engine: Engine.AICORE,
    modelId: '',
    sizeGb: 0,
  },
  /** Gemma 4 E2B Instruct — LiteRT-LM backend (~2.4 GB). Pixel 9+ recommended. */
  GEMMA4_2B: {
    name: 'Gemma 4 2B',
    engine: Engine.LITERTLM,
    modelId: 'litert-community/gemma-4-E2B-it-litert-lm',
    catalogName: 'Gemma-4-E2B-it',
    sizeGb: 2.4,
  },
  /** Gemma 4 E4B Instruct — LiteRT-LM backend (~3.4 GB). */
  GEMMA4_4B: {
    name: 'Gemma 4 4B',
    engine: Engine.LITERTLM,
    modelId: 'litert-community/gemma-4-E4B-it-litert-lm',
    catalogName: 'Gemma-4-E4B-it',
    sizeGb: 3.4,
  },
  /** Gemma 3n E2B Instruct — LiteRT-LM backend (~3.4 GB). Multimodal (text/image/audio). */
  GEMMA3N_2B: {
    name: 'Gemma 3n 2B',
    engine: Engine.LITERTLM,
    modelId: 'google/gemma-3n-E2B-it-litert-lm',
    catalogName: 'Gemma-3n-E2B-it',
    sizeGb: 3.4,
  },
  /** Gemma 3n E4B Instruct — LiteRT-LM backend (~4.6 GB). Multimodal (text/image/audio). */
  GEMMA3N_4B: {
    name: 'Gemma 3n 4B',
    engine: Engine.LITERTLM,
    modelId: 'google/gemma-3n-E4B-it-litert-lm',
    catalogName: 'Gemma-3n-E4B-it',
    sizeGb: 4.6,
  },
  /** Gemma 3 1B Instruct — LiteRT-LM backend (~0.55 GB). Fast, low-memory. */
  GEMMA3_1B: {
    name: 'Gemma 3 1B',
    engine: Engine.LITERTLM,
    modelId: 'litert-community/Gemma3-1B-IT',
    catalogName: 'Gemma3-1B-IT',
    sizeGb: 0.55,
  },
  /** Qwen 2.5 1.5B Instruct — LiteRT-LM backend (~1.5 GB). */
  QWEN25_1B5: {
    name: 'Qwen 2.5 1.5B',
    engine: Engine.LITERTLM,
    modelId: 'litert-community/Qwen2.5-1.5B-Instruct',
    catalogName: 'Qwen2.5-1.5B-Instruct',
    sizeGb: 1.5,
  },
  /** DeepSeek R1 Distill Qwen 1.5B — LiteRT-LM backend (~1.7 GB). */
  DEEPSEEK_R1_1B5: {
    name: 'DeepSeek R1 1.5B',
    engine: Engine.LITERTLM,
    modelId: 'litert-community/DeepSeek-R1-Distill-Qwen-1.5B',
    catalogName: 'DeepSeek-R1-Distill-Qwen-1.5B',
    sizeGb: 1.7,
  },
} as const satisfies Record<string, KnownModelEntry>;

export type KnownModelKey = keyof typeof KnownModel;

// ── Model-state helpers ───────────────────────────────────────────────────────

/**
 * Quickly checks whether a model is already present on the device.
 *
 * @param model  A `KnownModelEntry` (preferred) or a raw directory name string.
 * @returns      `{ downloaded: true, path }` or `{ downloaded: false }`.
 */
export async function isModelDownloaded(
  model: KnownModelEntry | string
): Promise<{ downloaded: boolean; path?: string }> {
  const models = await getDownloadedModels();
  // Build the list of names to check: display name + catalog directory name.
  const namesToCheck =
    typeof model === 'string'
      ? [model]
      : ([model.name, model.catalogName].filter(Boolean) as string[]);
  const found = models.find((m) => namesToCheck.includes(m.name));
  return found ? { downloaded: true, path: found.path } : { downloaded: false };
}

/**
 * Returns the engine and model path of the currently initialised model,
 * or `null` if the engine is idle.
 */
export async function getInitializedModel(): Promise<{
  engine: Engine;
  modelPath: string;
} | null> {
  if (!NativeAiCore) return null;
  const raw = await NativeAiCore.getInitializedModel();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { engine: Engine; modelPath: string };
  } catch {
    return null;
  }
}

/**
 * Options for `ensureModel()`.
 */
export interface EnsureModelOptions {
  /** HuggingFace access token for gated models. */
  hfToken?: string;
  /** Called with download progress updates. */
  onProgress?: DownloadProgressCallback;
  /**
   * Called at each step of the setup flow so you can show status in the UI.
   * - `'checking'`     — looking up downloaded models
   * - `'downloading'`  — file is being downloaded from HuggingFace
   * - `'initializing'` — loading the model into the inference engine
   */
  onStatus?: (status: 'checking' | 'downloading' | 'initializing') => void;
  /** Allowlist catalog version to use (default: `'1_0_11'`). */
  catalogVersion?: string;
}

/**
 * High-level helper that handles the **full model lifecycle** in one call:
 * check if downloaded → download if needed → initialize.
 *
 * For `Engine.AICORE` (Gemini Nano) no file is needed and the download step
 * is skipped automatically.
 *
 * @example
 * // First-launch experience: download Gemma 4 and start chatting
 * await ensureModel(KnownModel.GEMMA4_2B, {
 *   hfToken: storedToken,
 *   onStatus: (s) => setStatus(s),
 *   onProgress: (p) => setProgress(p.receivedBytes / p.totalBytes),
 * });
 */
export async function ensureModel(
  model: KnownModelEntry,
  options?: EnsureModelOptions
): Promise<void> {
  const { hfToken, onProgress, onStatus, catalogVersion } = options ?? {};

  // AICore (Gemini Nano) — no file needed, initialize directly
  if (model.engine === Engine.AICORE) {
    onStatus?.('initializing');
    await initialize('');
    return;
  }

  // File-based models — check if the file is already on the device
  onStatus?.('checking');
  const { downloaded, path: existingPath } = await isModelDownloaded(model);

  let modelPath: string;

  if (downloaded && existingPath) {
    modelPath = existingPath;
  } else {
    // Not found locally — fetch catalog and download
    onStatus?.('downloading');
    const catalog = await fetchModelCatalog(catalogVersion);
    // Match by catalogName first (exact catalog entry name), then modelId as fallback.
    const entry =
      (model.catalogName &&
        catalog.find((e) => e.name === model.catalogName)) ||
      catalog.find((e) => e.modelId === model.modelId);
    if (!entry) {
      throw new Error(
        `ensureModel: "${model.name}" (modelId: ${model.modelId}) was not found ` +
          `in the model catalog. Try updating the catalogVersion or use ` +
          `fetchModelCatalog() to browse available models.`
      );
    }
    modelPath = await downloadModel(entry, hfToken, onProgress);
  }

  onStatus?.('initializing');
  await initialize(modelPath);
}

// ── System prompt ─────────────────────────────────────────────────────────────

/**
 * Sets a persistent system prompt that is prepended to **every** subsequent
 * `generateResponse`, `generateResponseStream`, and `generateResponseStateless`
 * call until cleared.
 *
 * Useful for setting a stable persona or JSON-output instruction across an
 * entire session without repeating it in every user message.
 *
 * @example
 * await setSystemPrompt('You are a JSON data extractor. Respond only with valid JSON.');
 */
export async function setSystemPrompt(prompt: string): Promise<void> {
  assertAvailable();
  return NativeAiCore!.setSystemPrompt(prompt);
}

/**
 * Clears any system prompt previously set with `setSystemPrompt()`.
 */
export async function clearSystemPrompt(): Promise<void> {
  if (!NativeAiCore) return;
  return NativeAiCore.clearSystemPrompt();
}

// ── Token counting ────────────────────────────────────────────────────────────

/**
 * Returns an approximate token count for the given text.
 *
 * Uses the active model's tokenization ratio (~3.5 chars/token for Gemma).
 * Useful for checking whether a document fits within the model's context
 * window before sending it to `generateResponse`.
 *
 * @example
 * const tokens = await getTokenCount(longDocument);
 * if (tokens > 3500) { /* chunk the document *\/ }
 */
export async function getTokenCount(text: string): Promise<number> {
  assertAvailable();
  return NativeAiCore!.getTokenCount(text);
}

// ── Stateless generation ──────────────────────────────────────────────────────

/**
 * Generates a response **without** reading from or writing to the native
 * conversation history.
 *
 * Use this for one-shot tasks (JSON extraction, classification, summarisation)
 * that must not pollute the chat history.
 *
 * @throws `NOT_INITIALIZED`  if `initialize()` was not called first.
 * @throws `GENERATION_ERROR` if the model fails during inference.
 *
 * @example
 * const json = await generateResponseStateless(
 *   'Extract the invoice amount from: "Total due: $1,234.56"'
 * );
 */
export async function generateResponseStateless(
  prompt: string
): Promise<string> {
  assertAvailable();
  return NativeAiCore!.generateResponseStateless(prompt);
}

// ── Model download API ────────────────────────────────────────────────────────

const ALLOWLIST_BASE_URL =
  'https://raw.githubusercontent.com/google-ai-edge/gallery/main/model_allowlists';

/** An entry from the Google AI Edge model catalog. */
export interface ModelCatalogEntry {
  name: string;
  modelId: string;
  modelFile: string;
  commitHash: string;
  sizeInBytes: number;
  description?: string;
  minDeviceMemoryInGb?: number;
}

/** A model that has already been downloaded to the device. */
export interface DownloadedModel {
  name: string;
  commitHash: string;
  fileName: string;
  path: string;
  sizeInBytes: number;
}

/** Progress callback for `downloadModel`. */
export type DownloadProgressCallback = (progress: {
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  remainingMs: number;
}) => void;

/**
 * Fetches the list of available LLM models from the Google AI Edge gallery.
 *
 * @param version  Allowlist version, e.g. `'1_0_11'`. Defaults to `'1_0_11'`.
 */
export async function fetchModelCatalog(
  version = '1_0_11'
): Promise<ModelCatalogEntry[]> {
  const url = `${ALLOWLIST_BASE_URL}/${version}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch model catalog: HTTP ${response.status}`);
  }
  const json = (await response.json()) as { models?: ModelCatalogEntry[] };
  return (json.models ?? []).filter((m) => m.commitHash && m.modelFile);
}

/**
 * Downloads a model to the device's external files directory.
 *
 * The file is saved under:
 * `<ExternalFilesDir>/ai-core-models/<name>/<commitHash>/<fileName>`
 *
 * Pass the returned path directly to `initialize()`.
 *
 * @param entry       A `ModelCatalogEntry` from `fetchModelCatalog()`.
 * @param onProgress  Optional callback receiving download progress.
 * @returns           Absolute path to the downloaded model file.
 */
export function downloadModel(
  entry: ModelCatalogEntry,
  hfToken?: string,
  onProgress?: DownloadProgressCallback
): Promise<string> {
  assertAvailable();
  const url = `https://huggingface.co/${entry.modelId}/resolve/${entry.commitHash}/${entry.modelFile}?download=true`;

  let sub: ReturnType<NonNullable<typeof emitter>['addListener']> | null = null;
  if (onProgress && emitter) {
    sub = emitter.addListener(EVENT_DOWNLOAD_PROGRESS, (e: any) => {
      onProgress({
        receivedBytes: e.receivedBytes,
        totalBytes: e.totalBytes,
        bytesPerSecond: e.bytesPerSecond,
        remainingMs: e.remainingMs,
      });
    });
  }

  return NativeAiCore!
    .downloadModel(
      url,
      entry.name,
      entry.commitHash,
      entry.modelFile,
      entry.sizeInBytes,
      hfToken ?? ''
    )
    .finally(() => {
      sub?.remove();
    });
}

/**
 * Cancels a download started with `downloadModel()`.
 */
export async function cancelDownload(): Promise<void> {
  if (!NativeAiCore) return;
  return NativeAiCore.cancelDownload();
}

/**
 * Returns a list of models already downloaded to the device.
 */
export async function getDownloadedModels(): Promise<DownloadedModel[]> {
  assertAvailable();
  const raw = await NativeAiCore!.getDownloadedModels();
  if (Array.isArray(raw)) return raw as DownloadedModel[];
  return JSON.parse(raw as unknown as string) as DownloadedModel[];
}

// ── Default export (API object) ───────────────────────────────────────────────

const AICore = {
  initialize,
  generateResponse,
  generateResponseStream,
  generateResponseStateless,
  generateStructuredResponse,
  checkAvailability,
  release,
  resetConversation,
  cancelGeneration,
  // Model management
  fetchModelCatalog,
  downloadModel,
  cancelDownload,
  getDownloadedModels,
  isModelDownloaded,
  getInitializedModel,
  ensureModel,
  // System prompt
  setSystemPrompt,
  clearSystemPrompt,
  // Token counting
  getTokenCount,
};

export default AICore;
