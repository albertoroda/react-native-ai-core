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
export type AvailabilityStatus = 'AVAILABLE' | 'AVAILABLE_NPU' | 'NEED_DOWNLOAD' | 'UNSUPPORTED';

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
const EVENT_STREAM_TOKEN    = 'AICore_streamToken';
const EVENT_STREAM_COMPLETE = 'AICore_streamComplete';
const EVENT_STREAM_ERROR    = 'AICore_streamError';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// ── Default export (API object) ───────────────────────────────────────────────

const AICore = {
  initialize,
  generateResponse,
  generateResponseStream,
  generateStructuredResponse,
  checkAvailability,
  release,
  resetConversation,
  cancelGeneration,
};

export default AICore;
