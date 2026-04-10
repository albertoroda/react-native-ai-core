/**
 * visionExample.ts
 *
 * Demonstrates multimodal (image + text) on-device inference using react-native-ai-core.
 * Engine: LiteRT-LM + Gemma 3n E2B (~3.4 GB, 4 K context window).
 *
 * Gemma 3n natively supports text, image, and audio input, making it ideal
 * for vision tasks like image description, scene analysis, and OCR.
 *
 * Quick-start:
 *   1. setupVisionModel({ hfToken })   // download + init (vision mode ON)
 *   2. analyzeImage(base64, prompt)    // returns string answer
 *      ── or ──
 *      analyzeImageStream(base64, prompt, { onToken, onComplete, onError })
 *
 * IMPORTANT: configure({ enableVision: true }) MUST be called before initialize().
 * setupVisionModel() handles this automatically.
 *
 * No network calls during inference · fully private · no token cost.
 */

import AICore, {
  KnownModel,
  visionModels,
  configure,
  generateResponseWithImage,
  generateResponseStreamWithImage,
  type KnownModelEntry,
  type EnsureModelOptions,
  type StreamCallbacks,
} from 'react-native-ai-core';

// ── Vision-capable model catalogue ────────────────────────────────────────────

/**
 * All models that support image/vision inference, ordered from smallest to largest.
 * Identical to `visionModels` from react-native-ai-core but re-exported here
 * so the UI can import from a single file.
 */
export { visionModels };
export type { KnownModelEntry };

/** Default model used when the caller does not specify one. */
export const DEFAULT_VISION_MODEL: KnownModelEntry = KnownModel.GEMMA3N_2B;

// ── Session-scoped vision-ready flag ─────────────────────────────────────────
//
// A plain getInitializedModel() check is NOT enough: vision requires
// configure({ enableVision: true }) BEFORE initialize(). If another tab
// loaded a model without vision config, the native streaming call fails
// silently with VISION_NOT_ENABLED and the user sees nothing.
//
// _visionConfigured is set to true ONLY when setupVisionModel() succeeds and
// reset to false on release or a failed setup attempt.
let _visionConfigured = false;

// ── Model helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true when a vision-capable model is initialised AND was properly
 * configured with vision support via setupVisionModel() in this JS session.
 */
export async function isVisionModelReady(): Promise<boolean> {
  if (!_visionConfigured) return false;
  try {
    const model = await AICore.getInitializedModel();
    return model !== null;
  } catch {
    return false;
  }
}

/**
 * Returns true when Gemma 3n 2B is present on the device (not necessarily initialised).
 */
export async function isVisionModelDownloaded(): Promise<boolean> {
  const result = await AICore.isModelDownloaded(KnownModel.GEMMA3N_2B);
  return result.downloaded;
}

/**
 * Downloads (if needed) and initialises the given vision-capable model.
 *
 * `model` must have `supportsVision: true`. Defaults to `GEMMA3N_2B`.
 *
 * Vision is activated by calling `configure({ enableVision: true })` immediately
 * before `ensureModel`, so the GPU vision backend is wired up during initialization.
 */
export async function setupVisionModel(
  model: KnownModelEntry = DEFAULT_VISION_MODEL,
  hfToken?: string,
  callbacks?: {
    onStatus?: EnsureModelOptions['onStatus'];
    onProgress?: EnsureModelOptions['onProgress'];
  }
): Promise<void> {
  _visionConfigured = false; // reset before attempt — prevents stale flag if init throws

  // Must come before initialize() (called inside ensureModel).
  await configure({ enableVision: true });

  await AICore.ensureModel(model, {
    hfToken,
    onStatus: callbacks?.onStatus,
    onProgress: callbacks?.onProgress,
  });

  _visionConfigured = true; // only reached when ensureModel() succeeded
}

/**
 * Releases the LiteRT-LM engine and frees GPU/CPU memory.
 */
export async function releaseVisionModel(): Promise<void> {
  _visionConfigured = false; // engine released — require re-setup before next inference
  await AICore.release();
}

// ── Inference helpers ─────────────────────────────────────────────────────────

/**
 * Sends a Base64-encoded image and a text question to Gemma 3n.
 * Returns the full answer as a string (non-streaming).
 *
 * @param imageBase64  Plain Base64 string — no `data:image/…;base64,` prefix.
 * @param prompt       Question or instruction about the image.
 *                     Defaults to a general description request.
 */
export async function analyzeImage(
  imageBase64: string,
  prompt: string = 'Describe what you see in this image in detail.'
): Promise<string> {
  return generateResponseWithImage(imageBase64, prompt);
}

/**
 * Streaming variant of analyzeImage.
 * Tokens arrive word-by-word through the `callbacks` interface.
 *
 * @returns Cleanup function — call it when the component unmounts.
 */
export function analyzeImageStream(
  imageBase64: string,
  prompt: string = 'Describe what you see in this image in detail.',
  callbacks: StreamCallbacks
): () => void {
  return generateResponseStreamWithImage(imageBase64, prompt, callbacks);
}
