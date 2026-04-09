/**
 * modelInitExample.ts
 *
 * Exercises every new programmatic initialization method added in v0.4.x:
 *
 *   Engine enum        — type-safe backend selector
 *   KnownModel         — static model registry
 *   isModelDownloaded  — quick local check
 *   getInitializedModel— query what is currently loaded
 *   ensureModel        — full lifecycle (check → download → init)
 *   setSystemPrompt    — persistent instruction injection
 *   clearSystemPrompt  — remove system instruction
 *   getTokenCount      — estimate tokens before sending large input
 *   generateResponseStateless — one-shot inference without polluting chat history
 *
 * Each function is self-contained. Call them individually from the UI or run
 * them sequentially via runAllModelInitExamples().
 */

import AICore, {
  Engine,
  KnownModel,
  type KnownModelEntry,
  type DownloadProgressCallback,
} from 'react-native-ai-core';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StepResult {
  step: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type ProgressCallback = (step: string, detail?: string) => void;

// ── 1. Engine enum ─────────────────────────────────────────────────────────────

/**
 * Shows the available Engine values.
 * No network or device calls — purely informational.
 */
export function listEngines(): StepResult {
  const engines = Object.entries(Engine).map(
    ([key, value]) => `${key} = '${value}'`
  );
  return {
    step: 'Engine enum',
    ok: true,
    value: engines,
  };
}

// ── 2. KnownModel registry ─────────────────────────────────────────────────────

/**
 * Lists all statically known models with their engine and size.
 * No network or device calls.
 */
export function listKnownModels(): StepResult {
  const models = Object.entries(KnownModel).map(([key, m]) => ({
    key,
    name: m.name,
    engine: m.engine,
    sizeGb: m.sizeGb,
    modelId: m.modelId || '(native — no download needed)',
  }));
  return {
    step: 'KnownModel registry',
    ok: true,
    value: models,
  };
}

// ── 3. isModelDownloaded ───────────────────────────────────────────────────────

/**
 * Checks whether a specific model is already present on the device.
 *
 * @example
 * const result = await checkIfDownloaded(KnownModel.GEMMA4_2B);
 */
export async function checkIfDownloaded(
  model: KnownModelEntry
): Promise<StepResult> {
  try {
    const result = await AICore.isModelDownloaded(model);
    return {
      step: `isModelDownloaded("${model.catalogName ?? model.name}")`,
      ok: true,
      value: result,
    };
  } catch (e: any) {
    return {
      step: `isModelDownloaded("${model.catalogName ?? model.name}")`,
      ok: false,
      error: e?.message ?? String(e),
    };
  }
}

// ── 4. getInitializedModel ─────────────────────────────────────────────────────

/**
 * Queries what model (if any) is currently loaded in the native engine.
 * Returns null when the engine is idle.
 */
export async function queryInitializedModel(): Promise<StepResult> {
  try {
    const model = await AICore.getInitializedModel();
    return {
      step: 'getInitializedModel()',
      ok: true,
      value: model ?? '(none — engine is idle)',
    };
  } catch (e: any) {
    return {
      step: 'getInitializedModel()',
      ok: false,
      error: e?.message ?? String(e),
    };
  }
}

// ── 5. ensureModel ─────────────────────────────────────────────────────────────

/**
 * Full lifecycle in one call: check → download if needed → initialize.
 *
 * For Engine.AICORE (Gemini Nano) the download step is skipped — the model
 * is already on the NPU.
 *
 * @param model      A KnownModelEntry (use KnownModel.GEMMA4_2B etc.)
 * @param hfToken    HuggingFace access token (required for gated models)
 * @param onProgress Download progress callback
 * @param onStep     UI status callback for 'checking' | 'downloading' | 'initializing'
 */
export async function runEnsureModel(
  model: KnownModelEntry,
  hfToken?: string,
  onProgress?: DownloadProgressCallback,
  onStep?: ProgressCallback
): Promise<StepResult> {
  try {
    await AICore.ensureModel(model, {
      hfToken,
      onProgress,
      onStatus: (status) => onStep?.(status),
    });
    // Confirm what actually got loaded
    const loaded = await AICore.getInitializedModel();
    return {
      step: `ensureModel("${model.name}")`,
      ok: true,
      value: loaded,
    };
  } catch (e: any) {
    return {
      step: `ensureModel("${model.name}")`,
      ok: false,
      error: e?.message ?? String(e),
    };
  }
}

// ── 6. setSystemPrompt ─────────────────────────────────────────────────────────

/**
 * Injects a persistent system instruction that is prepended to every
 * subsequent generateResponse / generateResponseStateless call.
 *
 * Useful for locking the model into a specific role or output format
 * without repeating it in every user message.
 */
export async function runSetSystemPrompt(prompt: string): Promise<StepResult> {
  try {
    await AICore.setSystemPrompt(prompt);
    return {
      step: 'setSystemPrompt()',
      ok: true,
      value: `System prompt set: "${prompt.slice(0, 60)}${prompt.length > 60 ? '…' : ''}"`,
    };
  } catch (e: any) {
    return {
      step: 'setSystemPrompt()',
      ok: false,
      error: e?.message ?? String(e),
    };
  }
}

// ── 7. clearSystemPrompt ───────────────────────────────────────────────────────

/**
 * Removes any system prompt set with setSystemPrompt().
 * Subsequent calls will use the model's default behavior.
 */
export async function runClearSystemPrompt(): Promise<StepResult> {
  try {
    await AICore.clearSystemPrompt();
    return {
      step: 'clearSystemPrompt()',
      ok: true,
      value: 'System prompt cleared.',
    };
  } catch (e: any) {
    return {
      step: 'clearSystemPrompt()',
      ok: false,
      error: e?.message ?? String(e),
    };
  }
}

// ── 8. getTokenCount ───────────────────────────────────────────────────────────

/**
 * Estimates the token count for a piece of text before sending it to the model.
 * Useful to detect documents that would overflow the 4 096-token context window.
 *
 * The implementation uses ~3.5 chars/token (Gemma average for English/code).
 */
export async function runGetTokenCount(text: string): Promise<StepResult> {
  try {
    const tokens = await AICore.getTokenCount(text);
    const withinBudget = tokens <= 3500;
    return {
      step: 'getTokenCount()',
      ok: true,
      value: {
        chars: text.length,
        estimatedTokens: tokens,
        withinBudget,
        note: withinBudget
          ? '✓ Fits within the 4 096-token context window'
          : '⚠ Exceeds recommended 3 500-token input limit — consider chunking',
      },
    };
  } catch (e: any) {
    return {
      step: 'getTokenCount()',
      ok: false,
      error: e?.message ?? String(e),
    };
  }
}

// ── 9. generateResponseStateless ──────────────────────────────────────────────

/**
 * Runs a one-shot inference that does NOT read from or write to the
 * conversation history. Safe to use alongside a live chat session.
 *
 * Typical use cases: JSON extraction, classification, summarization.
 */
export async function runStatelessGeneration(
  prompt: string
): Promise<StepResult> {
  try {
    const response = await AICore.generateResponseStateless(prompt);
    return {
      step: 'generateResponseStateless()',
      ok: true,
      value: response,
    };
  } catch (e: any) {
    return {
      step: 'generateResponseStateless()',
      ok: false,
      error: e?.message ?? String(e),
    };
  }
}

// ── Composite: end-to-end first-launch flow ────────────────────────────────────

/**
 * Simulates the recommended first-launch experience:
 *
 *  1. List available engines and models (offline, instant)
 *  2. Check if Gemma 4 2B is already on the device
 *  3. If not → ensureModel() : download + initialize
 *  4. If yes → initialize from local cache
 *  5. Set a JSON-focused system prompt
 *  6. Count tokens on a sample document
 *  7. Run a stateless JSON extraction
 *  8. Clear the system prompt
 *  9. Confirm engine state with getInitializedModel()
 *
 * @param hfToken    HuggingFace token for the download step
 * @param onProgress Download progress updates
 * @param onStep     Status updates for each step ('checking' | 'downloading' | 'initializing')
 */
export async function runFirstLaunchFlow(
  hfToken?: string,
  onProgress?: DownloadProgressCallback,
  onStep?: ProgressCallback
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  // Step 1 — Engine enum
  results.push(listEngines());

  // Step 2 — KnownModel registry
  results.push(listKnownModels());

  // Step 3 — Check if Gemma 4 2B is already downloaded
  const downloadCheck = await checkIfDownloaded(KnownModel.GEMMA4_2B);
  results.push(downloadCheck);

  // Step 4 — ensureModel (download if needed, then initialize)
  const ensureResult = await runEnsureModel(
    KnownModel.GEMMA4_2B,
    hfToken,
    onProgress,
    onStep
  );
  results.push(ensureResult);

  if (!ensureResult.ok) {
    // Can't proceed without a loaded model
    return results;
  }

  // Step 5 — Confirm what is loaded
  results.push(await queryInitializedModel());

  // Step 6 — Set a system prompt for JSON extraction mode
  results.push(
    await runSetSystemPrompt(
      'You are a precise JSON data extractor. ' +
        'Respond only with a valid JSON object, no markdown fences, no prose.'
    )
  );

  // Step 7 — Token count on a sample document
  const sampleDocument =
    'Invoice #INV-2026-0042\n' +
    'Date: 2026-04-09\n' +
    'Customer: Acme Corp\n' +
    'Items:\n' +
    '  - Widget A x3 @ $12.50 = $37.50\n' +
    '  - Service fee = $15.00\n' +
    'Subtotal: $52.50  Tax (10%): $5.25  Total: $57.75';

  results.push(await runGetTokenCount(sampleDocument));

  // Step 8 — Stateless JSON extraction (won't pollute chat history)
  results.push(
    await runStatelessGeneration(
      `Extract the following fields from this invoice as JSON:\n` +
        `invoiceNumber, date, customer, totalAmount\n\n` +
        `Invoice:\n${sampleDocument}`
    )
  );

  // Step 9 — Clear system prompt (restore default behavior for chat)
  results.push(await runClearSystemPrompt());

  // Step 10 — Verify engine is still ready
  results.push(await queryInitializedModel());

  return results;
}

// ── Composite: subsequent-launch flow ─────────────────────────────────────────

/**
 * Simulates the recommended flow for every launch AFTER the first:
 *
 *  1. Check if the engine is already initialized (e.g. persisted across
 *     tab switches without a full release)
 *  2. If yes → skip initialization, go straight to chat
 *  3. If no  → check if model file is on the device
 *             → if yes: initialize directly (no download)
 *             → if no:  return instructions to call runFirstLaunchFlow()
 */
export async function runSubsequentLaunchFlow(
  preferredModel: KnownModelEntry = KnownModel.GEMMA4_2B
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  // Step 1 — Is something already running?
  const currentModel = await queryInitializedModel();
  results.push(currentModel);

  if (currentModel.ok && currentModel.value !== '(none — engine is idle)') {
    results.push({
      step: 'Launch decision',
      ok: true,
      value:
        'Engine already initialized — skipping init, chat is ready immediately.',
    });
    return results;
  }

  // Step 2 — Engine is idle. Is the file already on disk?
  const diskCheck = await checkIfDownloaded(preferredModel);
  results.push(diskCheck);

  const onDisk =
    diskCheck.ok &&
    typeof diskCheck.value === 'object' &&
    diskCheck.value !== null &&
    (diskCheck.value as { downloaded: boolean }).downloaded;

  if (onDisk) {
    // File is local — initialize without downloading
    const path = (diskCheck.value as { path?: string }).path ?? '';
    results.push({
      step: 'Launch decision',
      ok: true,
      value: `Model file found at ${path} — initializing from cache.`,
    });
    try {
      await AICore.initialize(path);
      results.push({
        step: 'initialize(cachedPath)',
        ok: true,
        value: 'Engine ready.',
      });
    } catch (e: any) {
      results.push({
        step: 'initialize(cachedPath)',
        ok: false,
        error: e?.message ?? String(e),
      });
    }
  } else {
    results.push({
      step: 'Launch decision',
      ok: false,
      value:
        'Model not found on device. Call runFirstLaunchFlow() to download and initialize.',
    });
  }

  return results;
}
