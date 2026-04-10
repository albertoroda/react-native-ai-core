/**
 * NativeAICore — TurboModule Spec (New Architecture)
 *
 * High-performance JSI bridge to the Google AI Edge SDK (MediaPipe)
 * for running Gemini Nano on-device via the device NPU.
 */
import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * Initialises the LLM inference engine with the model at `modelPath`.
   * `maxContextLength` sets the KV cache size in tokens (input + output).
   * Defaults to 4096 if not provided.
   * Returns `true` on success.
   */
  initialize(modelPath: string, maxContextLength: number): Promise<boolean>;

  /**
   * Generates a complete response for the given prompt (non-streaming).
   */
  generateResponse(prompt: string): Promise<string>;

  /**
   * Generates a response without reading from or writing to the native conversation history.
   * Intended for internal tasks such as structured extraction or classification.
   */
  generateResponseStateless(prompt: string): Promise<string>;

  /**
   * Starts streaming generation.
   * Tokens are emitted via NativeEventEmitter events:
   *   - 'AICore_streamToken'    → { token: string, done: boolean }
   *   - 'AICore_streamComplete' → {}
   *   - 'AICore_streamError'    → { code: string, message: string }
   */
  generateResponseStream(prompt: string): void;

  /**
   * Checks Gemini Nano availability on the device.
   * Returns: 'AVAILABLE' | 'NEED_DOWNLOAD' | 'UNSUPPORTED'
   */
  checkAvailability(): Promise<string>;

  /**
   * Frees the model from NPU memory.
   * Should be called on component unmount to avoid memory leaks.
   */
  release(): Promise<void>;

  /**
   * Clears the conversation history without releasing the model.
   * The next message will start a fresh conversation.
   */
  resetConversation(): Promise<void>;

  /**
   * Cancels any generation currently in progress.
   * For streaming: the stream ends with the tokens generated so far.
   * For non-streaming: the pending promise rejects with code 'CANCELLED'.
   */
  cancelGeneration(): Promise<void>;

  /**
   * Downloads a model file from HuggingFace.
   * Progress events are emitted as 'AICore_downloadProgress'.
   * Returns the absolute path where the file was saved.
   */
  downloadModel(
    url: string,
    name: string,
    commitHash: string,
    fileName: string,
    totalBytes: number,
    hfToken: string
  ): Promise<string>;

  /**
   * Cancels a download currently in progress.
   */
  cancelDownload(): Promise<void>;

  /**
   * Returns a JSON-encoded array of previously downloaded models.
   */
  getDownloadedModels(): Promise<string>;

  /**
   * Sets a persistent system prompt that is prepended to every subsequent
   * generation (chat and stateless). Replaces any previously set prompt.
   */
  setSystemPrompt(prompt: string): Promise<void>;

  /**
   * Clears any previously set system prompt.
   */
  clearSystemPrompt(): Promise<void>;

  /**
   * Returns an approximate token count for the given text using the
   * active model's tokenization ratio (~3.5 chars/token for Gemma).
   */
  getTokenCount(text: string): Promise<number>;

  /**
   * Returns a JSON string describing the currently initialised engine and
   * model path, or an empty string if no model is loaded.
   * Shape: '{"engine":"litertlm","modelPath":"/absolute/path/model.litertlm"}'
   */
  getInitializedModel(): Promise<string>;

  /**
   * Updates runtime-configurable inference parameters without reinitialising the engine.
   * Pass -1 for any parameter to keep its current value.
   *
   * - `inferenceTimeoutSec` — seconds before inference is aborted [30 – 3600]. Default 420.
   * - `temperature`         — sampling temperature [0.0 – 2.0]. Default 0.7.
   *                          For LiteRT-LM: applies on the next `resetConversation()` or `initialize()`.
   * - `topK`               — top-K sampling [1 – 256]. Default 64.
   *                          For LiteRT-LM: applies on the next `resetConversation()` or `initialize()`.
   * - `maxContinuations`   — max MLKit continuation passes [0 – 50]. Default 12.
   * - `enableVision`       — 0 = disable, 1 = enable, -1 = no change.
   *                          Requires a multimodal model (Gemma 3n / Gemma 4).
   *                          Takes effect on the NEXT `initialize()` call.
   */
  configure(
    inferenceTimeoutSec: number,
    temperature: number,
    topK: number,
    maxContinuations: number,
    enableVision: number
  ): Promise<void>;

  /**
   * Sends a Base64-encoded image and a text prompt to the LiteRT-LM engine (vision/multimodal).
   * Returns the full response as a string.
   *
   * Prerequisites:
   *  - Call `configure({ enableVision: true })` BEFORE `initialize()`.
   *  - Use a multimodal model (e.g. Gemma 3n or Gemma 4).
   *
   * `imageBase64` is a plain Base64 string (no `data:image/...;base64,` prefix).
   * Does NOT read from or write to conversation history.
   */
  generateResponseWithImage(
    prompt: string,
    imageBase64: string
  ): Promise<string>;

  /**
   * Streaming variant of `generateResponseWithImage`.
   * Tokens are emitted via NativeEventEmitter:
   *   - 'AICore_streamToken'    → { token: string, done: boolean }
   *   - 'AICore_streamComplete' → {}
   *   - 'AICore_streamError'    → { code: string, message: string }
   *
   * Same prerequisites as `generateResponseWithImage`.
   */
  generateResponseStreamWithImage(prompt: string, imageBase64: string): void;

  // Required by NativeEventEmitter
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('AiCore');
