/**
 * localAIExample.ts
 *
 * Demonstrates fully on-device LLM inference using react-native-ai-core.
 * Engine: LiteRT-LM + Gemma 4 2B (≈2.4 GB, 32 K context window).
 * No network · No token cost · Full privacy.
 *
 * Four patterns shown:
 *  1. Ping        — free-text via generateResponseStateless
 *  2. Recipe      — free-text prompt + manual JSON extraction
 *  3. Day menu    — JSON template prompt, one call per day
 *  4. Weekly menu — ONE call for 7 days with ultra-compact format (6-7x faster)
 *
 * Performance notes (Gemma 4 2B, ~15-20 tok/s):
 *  Pattern 3 (7 separate calls): ~3-5 min total
 *  Pattern 4 (1 call, compact):  ~30-60 s total  ← use this one
 */

import AICore, {
  KnownModel,
  generateResponseStateless,
  generateResponseStream,
  subscribeToStatelessTokens,
  type EnsureModelOptions,
} from 'react-native-ai-core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas — used only to validate / parse the model's JSON output
// ---------------------------------------------------------------------------

const RecipeRawSchema = z.object({
  name: z.string(),
  description: z.string(),
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  prepMinutes: z.number(),
});

export type RecipeResult = z.infer<typeof RecipeRawSchema>;

const MealRawSchema = z.object({
  name: z.string(),
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

const DayMenuRawSchema = z.object({
  breakfast: MealRawSchema,
  morning_snack: MealRawSchema,
  lunch: MealRawSchema,
  afternoon_snack: MealRawSchema,
  dinner: MealRawSchema,
  estimatedCostEur: z.number(),
});

export type DayMenuResult = z.infer<typeof DayMenuRawSchema>;

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

/**
 * Extracts the first balanced JSON object from a free-text model response.
 * The model sometimes wraps JSON in markdown or adds prose before/after it.
 */
function extractJSON(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error('Unbalanced JSON braces in response');
  return JSON.parse(text.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// Model lifecycle helpers (exported so the UI tab can call them)
// ---------------------------------------------------------------------------

export async function isModelReady(): Promise<boolean> {
  try {
    const model = await AICore.getInitializedModel();
    return model !== null;
  } catch {
    return false;
  }
}

export async function isModelDownloaded(): Promise<boolean> {
  const result = await AICore.isModelDownloaded(KnownModel.GEMMA4_2B);
  return result.downloaded;
}

export async function setupModel(
  hfToken?: string,
  callbacks?: {
    onStatus?: EnsureModelOptions['onStatus'];
    onProgress?: EnsureModelOptions['onProgress'];
  }
): Promise<void> {
  await AICore.ensureModel(KnownModel.GEMMA4_2B, {
    hfToken,
    onStatus: callbacks?.onStatus,
    onProgress: callbacks?.onProgress,
  });
  await AICore.setSystemPrompt(
    'You are a helpful on-device assistant. Always respond concisely and accurately.'
  );
}

export async function releaseModel(): Promise<void> {
  await AICore.release();
}

// ---------------------------------------------------------------------------
// Example 1 — Ping (plain free-text)
// ---------------------------------------------------------------------------

/**
 * Sends a trivial prompt to verify the engine is alive and responding.
 * Uses generateResponseStateless so it never touches conversation history.
 */
export async function runPingExample(): Promise<string> {
  const response = await generateResponseStateless('Reply with exactly: pong');
  return response.trim();
}

// ---------------------------------------------------------------------------
// Example 2 — Single recipe (free-text + manual JSON parse)
// ---------------------------------------------------------------------------

/**
 * Asks the model to fill a compact JSON template for a given dish.
 * Returns a validated RecipeResult or throws if the model output is malformed.
 *
 * Strategy: embed the template directly in the prompt so the model
 * only needs to replace placeholder values — no schema description overhead.
 */
export async function runRecipeExample(
  dishName: string
): Promise<RecipeResult> {
  const template = JSON.stringify({
    name: '...',
    description: '...',
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    prepMinutes: 0,
  });

  const prompt =
    `Fill this JSON for a recipe of "${dishName}". ` +
    `Return ONLY the JSON, no other text:\n${template}`;

  const raw = await generateResponseStateless(prompt);
  return RecipeRawSchema.parse(extractJSON(raw));
}

// ---------------------------------------------------------------------------
// Example 3 — Day meal plan (free-text + JSON template per day)
// ---------------------------------------------------------------------------

export interface DayMenuRequest {
  date: string; // ISO "YYYY-MM-DD"
  budget?: 'low' | 'medium' | 'high';
  dietType?: string; // e.g. "vegetarian", "omnivore"
  extraInstructions?: string;
}

/**
 * Generates a full-day meal plan (5 meals) for the given date.
 *
 * Uses a JSON template prompt so the model fills values rather than
 * inventing structure. One generateResponseStateless call per day —
 * fast enough for Gemma 4 with its 32 K context window.
 */
export async function runDayMenuExample(
  req: DayMenuRequest
): Promise<DayMenuResult> {
  const template = JSON.stringify({
    breakfast: { name: '...', kcal: 0, protein: 0, carbs: 0, fat: 0 },
    morning_snack: { name: '...', kcal: 0, protein: 0, carbs: 0, fat: 0 },
    lunch: { name: '...', kcal: 0, protein: 0, carbs: 0, fat: 0 },
    afternoon_snack: { name: '...', kcal: 0, protein: 0, carbs: 0, fat: 0 },
    dinner: { name: '...', kcal: 0, protein: 0, carbs: 0, fat: 0 },
    estimatedCostEur: 0,
  });

  const lines = [
    `Fill this JSON meal plan for ${req.date}.`,
    `Budget: ${req.budget ?? 'medium'}.`,
    `Diet: ${req.dietType ?? 'omnivore'}.`,
    req.extraInstructions ?? 'Use simple, everyday ingredients.',
    `Return ONLY the JSON:\n${template}`,
  ];

  const raw = await generateResponseStateless(lines.join(' '));
  return DayMenuRawSchema.parse(extractJSON(raw));
}

// ---------------------------------------------------------------------------
// Example 4 — Weekly menu, ultra-compact (ONE call for 7 days)
// ---------------------------------------------------------------------------
//
// Why it's much faster than 7 × runDayMenuExample:
//
//   Pattern 3 (7 calls): each call pays the KV-cache warm-up cost and generates
//   ~500 output tokens. Total: ~3500 tokens output + 7x prompt overhead.
//
//   Pattern 4 (1 call): one warm-up, ~2500 output tokens in one shot using
//   Gemma 4's full 32K context window. Total time ≈ 30-60 s vs 3-5 min.
//
// Compact format:
//   Field names are single letters (n/k/p/c/f) so the model does NOT repeat
//   "breakfast", "morning_snack", etc. 35× — saving ~40% of output tokens.
//   Meal types are positional: [bf, ms, lu, as, di] in a fixed array.
// ---------------------------------------------------------------------------

/**
 * Compact single-meal schema — only name + kcal.
 * Macros (protein/carbs/fat) dropped: halves per-meal token count and are not
 * shown in the UI anyway.
 */
const CMeal = z.object({
  n: z.string(),
  k: z.number(),
});

/** Compact single-day schema */
const CDay = z.object({
  d: z.string(),
  bf: CMeal,
  ms: CMeal,
  lu: CMeal,
  as: CMeal,
  di: CMeal,
  cost: z.number(),
});

const CWeek = z.object({ days: z.array(CDay) });

export interface WeeklyMealDay {
  date: string;
  breakfast: { name: string; kcal: number };
  morningSnack: { name: string; kcal: number };
  lunch: { name: string; kcal: number };
  afternoonSnack: { name: string; kcal: number };
  dinner: { name: string; kcal: number };
  estimatedCostEur: number;
}

export interface WeeklyMenuRequest {
  startDate: string;
  dietType?: string;
  budget?: 'low' | 'medium' | 'high';
  extraInstructions?: string;
  /** Called after each day is parsed from the single model response. */
  onDayComplete?: (day: WeeklyMealDay, index: number) => void;
}

function expandCDay(d: z.infer<typeof CDay>): WeeklyMealDay {
  const meal = (m: z.infer<typeof CMeal>) => ({ name: m.n, kcal: m.k });
  return {
    date: d.d,
    breakfast: meal(d.bf),
    morningSnack: meal(d.ms),
    lunch: meal(d.lu),
    afternoonSnack: meal(d.as),
    dinner: meal(d.di),
    estimatedCostEur: d.cost,
  };
}

// ---------------------------------------------------------------------------
// Incremental JSON day extractor
//
// Scans the raw text streaming from the model for complete CDay objects inside
// the {"days":[…]} array. Uses a string-aware brace counter so stray brackets
// inside meal names never cause a false positive.
//
// Returns the newly complete CDay entries (those with index ≥ alreadyEmitted).
// ---------------------------------------------------------------------------
// Regex handles any whitespace: "days":[ or "days": [ or "days" : [
const DAYS_MARKER_RE = /"days"\s*:\s*\[/;

function extractStreamingDays(
  text: string,
  alreadyEmitted: number
): z.infer<typeof CDay>[] {
  const match = DAYS_MARKER_RE.exec(text);
  if (!match) return [];

  let pos = match.index + match[0].length;
  let dayIndex = 0;
  const newDays: z.infer<typeof CDay>[] = [];

  while (pos < text.length) {
    // skip commas / whitespace between day objects
    while (pos < text.length && /[\s,]/.test(text[pos]!)) pos++;
    if (pos >= text.length || text[pos] !== '{') break;

    // Walk the day object with a string-aware brace counter
    const dayStart = pos;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let found = false;

    for (let j = pos; j < text.length; j++) {
      const ch = text[j]!;
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            // Complete day object
            if (dayIndex >= alreadyEmitted) {
              try {
                newDays.push(
                  CDay.parse(JSON.parse(text.slice(dayStart, j + 1)))
                );
              } catch {
                // Malformed — skip silently; final parse will catch it
              }
            }
            dayIndex++;
            pos = j + 1;
            found = true;
            break;
          }
        }
      }
    }

    if (!found) break; // Day still incomplete — wait for more tokens
  }

  return newDays;
}

/**
 * Generates a full 7-day meal plan in a **single model call** using Gemma 4's
 * 32K context window and an ultra-compact JSON template.
 *
 * Days appear in the UI in **real time** as the model generates them —
 * no artificial delay. `onDayComplete` fires the moment a day's JSON object
 * closes in the token stream.
 *
 * Typical time: 30–60 s vs 3–5 min for 7 separate calls.
 */
export async function runWeeklyMenuExample(
  req: WeeklyMenuRequest
): Promise<WeeklyMealDay[]> {
  // Build date list (no bulky template — just the dates the model must fill)
  const start = new Date(req.startDate);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().split('T')[0]!;
  });

  // Compact prompt: format described once, no repeated placeholder JSON.
  // Each meal needs only name + kcal → halves per-meal token count vs 5 fields.
  const prompt = [
    `Create a 7-day meal plan. Diet: ${req.dietType ?? 'omnivore'}. Budget: ${req.budget ?? 'medium'}.`,
    req.extraInstructions ??
      'Short meal names (2-5 words). Varied, simple everyday food.',
    `Output ONLY a JSON object with this exact structure (no extra text, no markdown):`,
    `{"days":[{"d":"DATE","bf":{"n":"NAME","k":KCAL},"ms":{"n":"NAME","k":KCAL},"lu":{"n":"NAME","k":KCAL},"as":{"n":"NAME","k":KCAL},"di":{"n":"NAME","k":KCAL},"cost":EUR},...]}`,
    `Use these 7 dates in order: ${dates.join(', ')}.`,
  ].join(' ');

  // Subscribe to stateless tokens BEFORE starting the call so we never miss
  // the first chunk. We parse incrementally and fire onDayComplete in real time
  // as each day's JSON object closes in the stream.
  let accumulated = '';
  let emittedDayCount = 0;

  const unsub = subscribeToStatelessTokens((token) => {
    accumulated += token;
    if (!req.onDayComplete || emittedDayCount >= 7) return;

    const newDays = extractStreamingDays(accumulated, emittedDayCount);
    for (const compactDay of newDays) {
      req.onDayComplete(expandCDay(compactDay), emittedDayCount);
      emittedDayCount++;
    }
  });

  try {
    const raw = await generateResponseStateless(prompt);
    const parsed = CWeek.parse(extractJSON(raw));
    const result = parsed.days.map(expandCDay);

    // Safety net: emit any days the streaming parser may have missed
    // (e.g. if onDayComplete was not provided, or a parse glitch mid-stream)
    if (req.onDayComplete) {
      for (let i = emittedDayCount; i < result.length; i++) {
        req.onDayComplete(result[i]!, i);
      }
    }

    return result;
  } finally {
    unsub();
    // LiteRT-LM shares a single KV cache between stateless and chat calls.
    // Reset after the stateless call so the weekly-menu tokens don't consume
    // the chat's context window on the next message.
    try {
      await AICore.resetConversation();
    } catch {
      // ignore — reset is best-effort
    }
  }
}

/**
 * Example 5 — Weekly menu via FULL STREAM (chat mode).
 *
 * Uses `generateResponseStream` exactly like the chat tab — tokens arrive in
 * real time, we count them for progress feedback, and once `onComplete` fires
 * we parse the full accumulated text as a compact JSON week.
 *
 * Advantages over Example 4:
 *  • Zero custom infra — reuses the same proven streaming path
 *  • No incremental parser needed — parse once at the end
 *  • Token count visible during generation for progress bar / ETA
 *
 * Trade-off: saves to conversation history → we reset after.
 */
export async function runWeeklyMenuStreamExample(
  req: WeeklyMenuRequest & {
    /** Called after each token with the running total token count. */
    onTokenCount?: (count: number) => void;
    /** Called after each token with the full accumulated text so far. */
    onRawToken?: (delta: string) => void;
  }
): Promise<WeeklyMealDay[]> {
  // Clear history so the huge JSON doesn't bleed into future prompts
  await AICore.resetConversation();

  const start = new Date(req.startDate);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().split('T')[0]!;
  });

  const prompt = [
    `Create a 7-day meal plan. Diet: ${
      req.dietType ?? 'omnivore'
    }. Budget: ${req.budget ?? 'medium'}.`,
    req.extraInstructions ??
      'Short meal names (2-5 words). Varied, simple everyday food.',
    `Output ONLY a JSON object (no markdown):`,
    `{"days":[{"d":"DATE","bf":{"n":"NAME","k":KCAL},"ms":{"n":"NAME","k":KCAL},"lu":{"n":"NAME","k":KCAL},"as":{"n":"NAME","k":KCAL},"di":{"n":"NAME","k":KCAL},"cost":EUR},...]}`,
    `Use these 7 dates in order: ${dates.join(', ')}.`,
  ].join(' ');

  return new Promise<WeeklyMealDay[]>((resolve, reject) => {
    let accumulated = '';
    let tokenCount = 0;

    const unsub = generateResponseStream(prompt, {
      onToken: (token) => {
        accumulated += token;
        tokenCount++;
        req.onTokenCount?.(tokenCount);
        req.onRawToken?.(token);
      },
      onComplete: async () => {
        unsub();
        try {
          const parsed = CWeek.parse(extractJSON(accumulated));
          const result = parsed.days.map(expandCDay);

          if (req.onDayComplete) {
            for (let i = 0; i < result.length; i++) {
              req.onDayComplete(result[i]!, i);
              // Small yield between setState calls so React can batch renders
              await new Promise<void>((r) => setTimeout(r, 50));
            }
          }

          // Clean the huge JSON response from history
          await AICore.resetConversation();
          resolve(result);
        } catch (e: any) {
          reject(new Error(`Parse failed: ${e?.message ?? e}`));
        }
      },
      onError: (error) => {
        unsub();
        reject(new Error(`${error.code}: ${error.message}`));
      },
    });
  });
}
