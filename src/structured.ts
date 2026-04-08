import { Platform } from 'react-native';
import { z, type ZodTypeAny } from 'zod';
import NativeAiCore from './NativeAiCore';

export type StructuredSchema<T> = z.ZodType<T>;

export interface StructuredGenerateOptions<
  TOutputSchema extends ZodTypeAny,
  TInput = unknown,
> {
  prompt: string;
  output: TOutputSchema;
  input?: TInput;
  inputSchema?: z.ZodType<TInput>;
  maxRetries?: number;
  maxContinuations?: number;
  timeoutMs?: number;
  /**
   * 'single'  — generate the entire JSON in one call (default).
   * 'chunked' — generate each top-level field separately and assemble the object.
   *             Recommended for schemas with many fields or long responses.
   */
  strategy?: 'single' | 'chunked';
  /**
   * Called at each step of chunked generation.
   * @param field  JSON path of the field being generated, e.g. "days.0.exercises"
   * @param done   true when the field has just been completed
   */
  onProgress?: (field: string, done: boolean) => void;
}

export interface StructuredValidationIssue {
  path: string;
  message: string;
}

export class StructuredOutputError extends Error {
  issues: StructuredValidationIssue[];
  rawResponse: string;

  constructor(
    message: string,
    rawResponse: string,
    issues: StructuredValidationIssue[] = []
  ) {
    super(message);
    this.name = 'StructuredOutputError';
    this.rawResponse = rawResponse;
    this.issues = issues;
  }
}

const STRUCTURED_PROMPT_BUDGET = 2600;
const STRUCTURED_REPAIR_RESPONSE_BUDGET = 1200;
const STRUCTURED_ISSUES_BUDGET = 600;
const STRUCTURED_CONTINUATION_BUDGET = 1400;
const DEFAULT_MAX_STRUCTURED_CONTINUATIONS = 8;
const CONTINUATION_OVERLAP_WINDOW = 160;
const DEFAULT_STRUCTURED_TIMEOUT_MS = 300000; // 5 min default
const QUOTA_ERROR_CODE = 9;
const QUOTA_RETRY_DELAY_MS = 1800;
const MAX_QUOTA_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function readNumericErrorCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null) {
    const directCode = (error as { errorCode?: unknown }).errorCode;
    if (typeof directCode === 'number') return directCode;

    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') return code;
    if (typeof code === 'string') {
      const parsed = Number.parseInt(code, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  const message = toErrorMessage(error);
  const match = message.match(/error\s*code\s*[:=]?\s*(\d+)/i);
  if (!match) return null;
  const capturedCode = match[1];
  if (!capturedCode) return null;
  const parsed = Number.parseInt(capturedCode, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isQuotaError(error: unknown): boolean {
  const code = readNumericErrorCode(error);
  if (code === QUOTA_ERROR_CODE) return true;
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes('out of quota') ||
    message.includes('quota exceeded') ||
    message.includes('error code: 9')
  );
}

function truncateStart(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function truncateEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stringifyInput(value: unknown, maxChars: number): string {
  return truncateStart(JSON.stringify(value, null, 2), maxChars);
}

function fitStructuredPrompt(parts: string[]): string {
  return truncateStart(
    parts.filter(Boolean).join('\n'),
    STRUCTURED_PROMPT_BUDGET
  );
}

function fitContinuationPrompt(parts: string[]): string {
  return truncateStart(
    parts.filter(Boolean).join('\n'),
    STRUCTURED_CONTINUATION_BUDGET
  );
}

function zodTypeToDescription(schema: ZodTypeAny): string {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodNull) return 'null';
  if (schema instanceof z.ZodEnum) {
    return `enum(${schema.options
      .map((value: string) => JSON.stringify(value))
      .join(', ')})`;
  }
  if (schema instanceof z.ZodLiteral) {
    return `literal(${JSON.stringify(schema.value)})`;
  }
  if (schema instanceof z.ZodArray) {
    return `Array<${zodTypeToDescription(schema.element as unknown as ZodTypeAny)}>`;
  }
  if (schema instanceof z.ZodOptional) {
    return `${zodTypeToDescription(schema.unwrap() as unknown as ZodTypeAny)} | undefined`;
  }
  if (schema instanceof z.ZodNullable) {
    return `${zodTypeToDescription(schema.unwrap() as unknown as ZodTypeAny)} | null`;
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options
      .map((option: unknown) => zodTypeToDescription(option as ZodTypeAny))
      .join(' | ');
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const entries = Object.entries(shape).map(
      ([key, value]) => `  ${key}: ${zodTypeToDescription(value as ZodTypeAny)}`
    );
    return `{
${entries.join(',\n')}
}`;
  }

  return 'unknown';
}

function formatIssues(error: z.ZodError): StructuredValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '$',
    message: issue.message,
  }));
}

function extractFencedJson(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}

function extractBalancedJson(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) start = index;
      depth++;
      continue;
    }

    if (char === '}' || char === ']') {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenced = extractFencedJson(trimmed);
  if (fenced) return fenced;
  const balanced = extractBalancedJson(trimmed);
  if (balanced) return balanced;
  return trimmed;
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

function mergeStructuredFragments(existing: string, incoming: string): string {
  const normalizedIncoming = stripCodeFences(incoming).trimStart();
  if (!normalizedIncoming) return existing;
  if (!existing) return normalizedIncoming;

  const maxOverlap = Math.min(
    CONTINUATION_OVERLAP_WINDOW,
    existing.length,
    normalizedIncoming.length
  );

  for (let size = maxOverlap; size > 0; size--) {
    if (existing.endsWith(normalizedIncoming.slice(0, size))) {
      return existing + normalizedIncoming.slice(size);
    }
  }

  return existing + normalizedIncoming;
}

function looksLikeIncompleteJson(text: string): boolean {
  const candidate = extractJsonPayload(text).trim();
  if (!candidate) return false;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index++) {
    const char = candidate[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth++;
      continue;
    }

    if (char === '}' || char === ']') {
      depth = Math.max(0, depth - 1);
    }
  }

  const lastChar = candidate[candidate.length - 1];
  return inString || depth > 0 || lastChar === ',' || lastChar === ':';
}

function buildStructuredContinuationPrompt<TInput>(
  prompt: string,
  outputSchema: ZodTypeAny,
  partialResponse: string,
  input?: TInput
): string {
  const schemaDescription = truncateEnd(
    zodTypeToDescription(outputSchema),
    700
  );
  const normalizedPrompt = truncateEnd(compactWhitespace(prompt), 500);
  const serializedInput =
    input === undefined ? '' : `Input JSON:\n${stringifyInput(input, 500)}`;
  const partialTail = truncateStart(stripCodeFences(partialResponse), 900);

  return fitContinuationPrompt([
    'Continue the same JSON value from the next character.',
    'Do not restart, repeat, explain, summarize, or wrap in markdown.',
    'Output only the missing suffix needed to complete the same valid JSON.',
    'Schema:',
    schemaDescription,
    `Task:\n${normalizedPrompt}`,
    serializedInput,
    'Current partial JSON tail:',
    partialTail,
  ]);
}

function buildJsonParseIssues(error: unknown): StructuredValidationIssue[] {
  if (error instanceof z.ZodError) {
    return formatIssues(error);
  }

  if (error instanceof Error) {
    return [{ path: '$', message: error.message }];
  }

  return [{ path: '$', message: 'Unknown structured output error' }];
}

async function generateStructuredRawResponse<
  TOutputSchema extends ZodTypeAny,
  TInput = unknown,
>(
  prompt: string,
  output: TOutputSchema,
  input: TInput | undefined,
  maxContinuations: number,
  timeoutMs: number
): Promise<string> {
  let combined = await generateStatelessWithQuotaRetry(
    buildStructuredPrompt(prompt, output, input),
    timeoutMs
  );

  for (let attempt = 0; attempt < maxContinuations; attempt++) {
    try {
      JSON.parse(extractJsonPayload(combined));
      return combined;
    } catch {
      if (!looksLikeIncompleteJson(combined)) {
        return combined;
      }
    }

    const continuationPrompt = buildStructuredContinuationPrompt(
      prompt,
      output,
      combined,
      input
    );
    const continuation = await tryGenerateWithQuotaTolerance(
      continuationPrompt,
      timeoutMs
    );
    if (continuation === null) {
      break;
    }
    const merged = mergeStructuredFragments(combined, continuation);
    if (merged === combined) {
      break;
    }
    combined = merged;
  }

  return combined;
}

function buildStructuredPrompt<TInput>(
  prompt: string,
  outputSchema: ZodTypeAny,
  input?: TInput
): string {
  const schemaDescription = truncateEnd(
    zodTypeToDescription(outputSchema),
    900
  );
  const normalizedPrompt = truncateEnd(compactWhitespace(prompt), 900);
  const serializedInput =
    input === undefined ? '' : `Input JSON:\n${stringifyInput(input, 900)}`;

  return fitStructuredPrompt([
    'Return only valid JSON.',
    'Do not include markdown, code fences, comments, prose, or explanations.',
    'The JSON must match this exact TypeScript-like schema:',
    schemaDescription,
    `Task:\n${normalizedPrompt}`,
    serializedInput,
  ]);
}

function buildRepairPrompt(
  prompt: string,
  outputSchema: ZodTypeAny,
  invalidResponse: string,
  issues: StructuredValidationIssue[]
): string {
  const issueText = issues
    .map((issue) => `- ${issue.path}: ${issue.message}`)
    .join('\n');
  const normalizedIssues = truncateEnd(issueText, STRUCTURED_ISSUES_BUDGET);
  const normalizedInvalidResponse = truncateStart(
    compactWhitespace(extractJsonPayload(invalidResponse)),
    STRUCTURED_REPAIR_RESPONSE_BUDGET
  );

  return fitStructuredPrompt([
    buildStructuredPrompt(prompt, outputSchema),
    'Your previous response was invalid.',
    'Fix it and return only corrected JSON.',
    'Validation errors:',
    normalizedIssues,
    'Previous response:',
    normalizedInvalidResponse,
  ]);
}

async function generateStateless(prompt: string): Promise<string> {
  if (!NativeAiCore) {
    throw new Error(
      `react-native-ai-core: native module unavailable on ${Platform.OS}. This feature requires Android.`
    );
  }

  if (NativeAiCore?.generateResponseStateless) {
    return NativeAiCore.generateResponseStateless(prompt);
  }

  return NativeAiCore.generateResponse(prompt);
}

async function generateStatelessWithTimeout(
  prompt: string,
  timeoutMs: number
): Promise<string> {
  if (timeoutMs <= 0) {
    return generateStateless(prompt);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Structured generation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([generateStateless(prompt), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateStatelessWithQuotaRetry(
  prompt: string,
  timeoutMs: number
): Promise<string> {
  let quotaRetries = 0;
  while (true) {
    try {
      return await generateStatelessWithTimeout(prompt, timeoutMs);
    } catch (error) {
      if (!isQuotaError(error) || quotaRetries >= MAX_QUOTA_RETRIES) {
        throw error;
      }
      quotaRetries += 1;
      await sleep(QUOTA_RETRY_DELAY_MS);
    }
  }
}

async function tryGenerateWithQuotaTolerance(
  prompt: string,
  timeoutMs: number
): Promise<string | null> {
  try {
    return await generateStatelessWithQuotaRetry(prompt, timeoutMs);
  } catch (error) {
    if (isQuotaError(error)) {
      return null;
    }
    throw error;
  }
}

// ── Chunked strategy — tree-walker ───────────────────────────────────────────
//
// Walks the schema recursively choosing the optimal call granularity:
//
//   • Leaf (string/number/bool/enum) → 1 call with coercion
//   • Object/array whose schema fits in MAX_COMPACT_SCHEMA_CHARS → 1 walkCompact
//     call (with continuation if truncated)
//   • Array of compact elements → askCount + 1 walkCompact per element
//   • Complex object → per-field walkLeaf/walkCompact
//
// This minimises the total number of calls without exceeding the token limit.

const INTER_CALL_DELAY_MS = 100;
const DEFAULT_ARRAY_COUNT = 5;
const MAX_ARRAY_COUNT = 7;
const MAX_WHOLE_ARRAY_COMPACT_ITEMS = 2;
const LEAF_TIMEOUT_CAP_MS = 15000;
const COMPACT_TIMEOUT_CAP_MS = 30000;
const ARRAY_COUNT_TIMEOUT_CAP_MS = 8000;
const LEAF_MAX_RETRIES_CAP = 1;
// Schema description length threshold below which a single compact call is used.
const MAX_COMPACT_SCHEMA_CHARS = 500;

interface WalkContext {
  taskPrompt: string;
  input: unknown;
  timeoutMs: number;
  maxRetries: number;
  /** Current JSON path for model context, e.g. "days.0.exercises" */
  path: string[];
  /** Extra context hint when iterating an array element */
  itemHint?: string;
  /** Label for onProgress — overrides the computed path when set */
  progressLabel?: string;
  onProgress?: (field: string, done: boolean) => void;
}

interface ArrayCountBounds {
  min: number;
  max: number;
  preferred: number;
}

function readZodLengthValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && value !== null) {
    const maybe = (value as { value?: unknown }).value;
    if (typeof maybe === 'number' && Number.isFinite(maybe)) return maybe;
  }
  return null;
}

function getArrayBounds(
  arraySchema: z.ZodArray<ZodTypeAny>,
  fieldName: string
): ArrayCountBounds {
  const def = (arraySchema as unknown as { _def?: Record<string, unknown> })
    ._def;
  const exact = readZodLengthValue(def?.exactLength);
  const minLen = readZodLengthValue(def?.minLength);
  const maxLen = readZodLengthValue(def?.maxLength);

  if (exact !== null) {
    const fixed = Math.max(0, Math.round(exact));
    return { min: fixed, max: fixed, preferred: fixed };
  }

  let min = minLen !== null ? Math.max(0, Math.round(minLen)) : 1;
  let max =
    maxLen !== null ? Math.max(min, Math.round(maxLen)) : MAX_ARRAY_COUNT;

  // Domain heuristics when schema does not constrain lengths explicitly.
  const name = fieldName.toLowerCase();
  if (name === 'days') {
    min = Math.max(min, 7);
    max = Math.min(max, 7);
  }
  if (name === 'exercises') {
    min = Math.max(min, 3);
    max = Math.min(max, 4);
  }

  const preferred = Math.max(min, Math.min(max, DEFAULT_ARRAY_COUNT));
  return { min, max, preferred };
}

function unwrapModifiers(schema: ZodTypeAny): ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapModifiers(schema.unwrap() as ZodTypeAny);
  }
  return schema;
}

function isLeafSchema(schema: ZodTypeAny): boolean {
  const inner = unwrapModifiers(schema);
  return (
    inner instanceof z.ZodString ||
    inner instanceof z.ZodNumber ||
    inner instanceof z.ZodBoolean ||
    inner instanceof z.ZodEnum ||
    inner instanceof z.ZodLiteral ||
    inner instanceof z.ZodNull
  );
}

// A schema is "compact" if its description fits within MAX_COMPACT_SCHEMA_CHARS.
// Arrays are always excluded because their output can multiply by N.
function isCompactSchema(schema: ZodTypeAny): boolean {
  const inner = unwrapModifiers(schema);
  if (isLeafSchema(inner)) return true;
  if (inner instanceof z.ZodArray) return false;
  if (hasNestedArray(inner)) return false;
  return zodTypeToDescription(inner).length <= MAX_COMPACT_SCHEMA_CHARS;
}

// Returns true if each array element can be generated in a single compact call.
function isCompactElement(schema: ZodTypeAny): boolean {
  const inner = unwrapModifiers(schema);
  if (isLeafSchema(inner)) return true;
  if (hasNestedArray(inner)) return false;
  return zodTypeToDescription(inner).length <= MAX_COMPACT_SCHEMA_CHARS;
}

// Returns true if the schema contains arrays at any depth.
// Such schemas are never compacted to avoid exceeding the 256-token output limit.
function hasNestedArray(schema: ZodTypeAny): boolean {
  const inner = unwrapModifiers(schema);

  if (inner instanceof z.ZodArray) return true;

  if (inner instanceof z.ZodObject) {
    const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
    return Object.values(shape).some((value) =>
      hasNestedArray(value as ZodTypeAny)
    );
  }

  if (inner instanceof z.ZodUnion) {
    return inner.options.some((option: unknown) =>
      hasNestedArray(option as unknown as ZodTypeAny)
    );
  }

  return false;
}

function isStringSchema(schema: ZodTypeAny): boolean {
  return unwrapModifiers(schema) instanceof z.ZodString;
}

function isNumberSchema(schema: ZodTypeAny): boolean {
  return unwrapModifiers(schema) instanceof z.ZodNumber;
}

function isBooleanSchema(schema: ZodTypeAny): boolean {
  return unwrapModifiers(schema) instanceof z.ZodBoolean;
}

function getEnumOptions(schema: ZodTypeAny): string[] | null {
  const inner = unwrapModifiers(schema);
  if (inner instanceof z.ZodEnum) {
    return [...inner.options];
  }
  return null;
}

function getLiteralValue(schema: ZodTypeAny): unknown | null {
  const inner = unwrapModifiers(schema);
  if (inner instanceof z.ZodLiteral) {
    return inner.value;
  }
  return null;
}

function synthesizeLeafFallback(schema: ZodTypeAny, path: string[]): unknown {
  const inner = unwrapModifiers(schema);
  const field = (path[path.length - 1] ?? '').toLowerCase();

  if (inner instanceof z.ZodLiteral) {
    return inner.value;
  }

  if (inner instanceof z.ZodEnum) {
    // For paths like days.0.day, map index -> weekday to improve coherence.
    if (field === 'day' && path.length >= 2) {
      const maybeIndex = Number.parseInt(path[path.length - 2] ?? '', 10);
      if (Number.isFinite(maybeIndex)) {
        const idx = Math.max(0, Math.min(inner.options.length - 1, maybeIndex));
        return inner.options[idx];
      }
    }
    return inner.options[0] ?? null;
  }

  if (inner instanceof z.ZodString) {
    if (field === 'goal') return 'Strength + fat loss';
    if (field === 'focus') return 'Strength + conditioning';
    if (field === 'notes') return 'Progressively increase load week to week.';
    if (field === 'reps') return '8-12';
    if (field === 'name') return 'Accessory Lift';
    return 'TBD';
  }

  if (inner instanceof z.ZodNumber) {
    if (field === 'durationweeks') return 1;
    if (field === 'sets') return 3;
    if (field === 'restseconds') return 90;
    return 0;
  }

  if (inner instanceof z.ZodBoolean) {
    return false;
  }

  if (inner instanceof z.ZodNull) {
    return null;
  }

  return null;
}

function coercePrimitiveField(raw: string, schema: ZodTypeAny): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```[\w]*\n?|```$/g, '')
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    /* sigue */
  }

  if (isStringSchema(schema)) return trimmed;

  if (isNumberSchema(schema)) {
    const n = Number(trimmed.replace(/[^\d.-]/g, ''));
    if (!Number.isNaN(n)) return n;
  }

  if (isBooleanSchema(schema)) {
    if (/^true$/i.test(trimmed)) return true;
    if (/^false$/i.test(trimmed)) return false;
  }

  const enumOptions = getEnumOptions(schema);
  if (enumOptions) {
    const normalized = trimmed.replace(/^"|"$/g, '').trim();
    const direct = enumOptions.find((opt) => opt === normalized);
    if (direct) return direct;
    const ci = enumOptions.find(
      (opt) => opt.toLowerCase() === normalized.toLowerCase()
    );
    if (ci) return ci;
  }

  const literalValue = getLiteralValue(schema);
  if (literalValue !== null) {
    const normalized = trimmed.replace(/^"|"$/g, '').trim();
    if (String(literalValue) === normalized) return literalValue;
  }

  return null;
}

async function walkLeaf(
  schema: ZodTypeAny,
  ctx: WalkContext
): Promise<unknown> {
  const fieldPath = ctx.progressLabel ?? (ctx.path.join('.') || 'root');
  const fieldName = ctx.path[ctx.path.length - 1] ?? 'value';
  ctx.onProgress?.(fieldPath, false);
  const fieldType = truncateEnd(zodTypeToDescription(schema), 200);
  const itemCtx = ctx.itemHint ? `Context: ${ctx.itemHint}.` : '';
  const isStr = isStringSchema(schema);
  const enumOptions = getEnumOptions(schema);
  const literalValue = getLiteralValue(schema);

  const valueInstruction = enumOptions
    ? `one of: ${enumOptions.join(' | ')}. Reply exact value only, no key.`
    : literalValue !== null
      ? `exact literal value: ${JSON.stringify(literalValue)}.`
      : isStr
        ? 'a plain phrase — no quotes, no JSON'
        : 'raw JSON value only — no key, no markdown';

  const prompt = fitStructuredPrompt([
    `"${fieldName}" (${fieldType}): output ${valueInstruction}.`,
    `Task: ${truncateEnd(compactWhitespace(ctx.taskPrompt), 250)}`,
    ctx.input !== undefined ? `Input: ${stringifyInput(ctx.input, 150)}` : '',
    itemCtx,
  ]);

  const leafTimeoutMs = Math.min(ctx.timeoutMs, LEAF_TIMEOUT_CAP_MS);
  const leafMaxRetries = Math.min(ctx.maxRetries, LEAF_MAX_RETRIES_CAP);
  let lastRaw = '';
  let lastErrorMessage = '';
  for (let attempt = 0; attempt <= leafMaxRetries; attempt++) {
    if (attempt > 0) await sleep(INTER_CALL_DELAY_MS);
    try {
      lastRaw = await generateStatelessWithQuotaRetry(prompt, leafTimeoutMs);
      const coerced = coercePrimitiveField(lastRaw, schema);
      const validated = schema.safeParse(coerced);
      if (validated.success) {
        ctx.onProgress?.(fieldPath, true);
        return validated.data;
      }
    } catch (error) {
      lastErrorMessage = toErrorMessage(error);
    }
  }

  const fallbackFromRaw = isStr ? lastRaw.trim() : null;
  const fallbackSynth = synthesizeLeafFallback(schema, ctx.path);
  const fallback = fallbackFromRaw ?? fallbackSynth;
  const fallbackValidated = schema.safeParse(fallback);
  if (fallbackValidated.success) {
    ctx.onProgress?.(fieldPath, true);
    return fallbackValidated.data;
  }
  throw new StructuredOutputError(
    `Could not generate leaf "${ctx.path.join('.')}"`,
    lastRaw || lastErrorMessage,
    [
      {
        path: ctx.path.join('.'),
        message: (
          lastRaw ||
          lastErrorMessage ||
          'leaf generation failed'
        ).slice(0, 120),
      },
    ]
  );
}

async function walkCompact(
  schema: ZodTypeAny,
  ctx: WalkContext
): Promise<unknown> {
  const fieldPath = ctx.progressLabel ?? (ctx.path.join('.') || 'root');
  const fieldName = ctx.path[ctx.path.length - 1] ?? 'value';
  ctx.onProgress?.(fieldPath, false);
  const typeDesc = truncateEnd(zodTypeToDescription(schema), 400);
  const itemCtx = ctx.itemHint ? `Context: ${ctx.itemHint}.` : '';

  const prompt = fitStructuredPrompt([
    `"${fieldName}" (${typeDesc}): return JSON value only — no key, no markdown.`,
    `Task: ${truncateEnd(compactWhitespace(ctx.taskPrompt), 250)}`,
    ctx.input !== undefined ? `Input: ${stringifyInput(ctx.input, 150)}` : '',
    itemCtx,
  ]);

  const compactTimeoutMs = Math.min(ctx.timeoutMs, COMPACT_TIMEOUT_CAP_MS);
  let combined = await generateStatelessWithQuotaRetry(
    prompt,
    compactTimeoutMs
  );

  for (let cont = 0; cont < 6; cont++) {
    try {
      const result = JSON.parse(extractJsonPayload(combined));
      ctx.onProgress?.(fieldPath, true);
      return result;
    } catch {
      if (!looksLikeIncompleteJson(combined)) break;
    }
    await sleep(INTER_CALL_DELAY_MS);
    const extra = await tryGenerateWithQuotaTolerance(
      buildStructuredContinuationPrompt(
        ctx.taskPrompt,
        schema,
        combined,
        ctx.input
      ),
      compactTimeoutMs
    );
    if (!extra) break;
    const merged = mergeStructuredFragments(combined, extra);
    if (merged === combined) break;
    combined = merged;
  }

  const finalResult = JSON.parse(extractJsonPayload(combined));
  ctx.onProgress?.(fieldPath, true);
  return finalResult;
}

async function askArrayCount(
  arraySchema: z.ZodArray<ZodTypeAny>,
  fieldName: string,
  ctx: WalkContext
): Promise<number> {
  const bounds = getArrayBounds(arraySchema, fieldName);
  const prompt = fitContinuationPrompt([
    `"${fieldName}" array count (${bounds.min}-${bounds.max}). Reply: single integer only.`,
    `Task: ${truncateEnd(compactWhitespace(ctx.taskPrompt), 150)}`,
  ]);

  try {
    await sleep(INTER_CALL_DELAY_MS);
    const countTimeoutMs = Math.min(ctx.timeoutMs, ARRAY_COUNT_TIMEOUT_CAP_MS);
    const raw = await generateStatelessWithQuotaRetry(prompt, countTimeoutMs);
    const n = parseInt(raw.trim().replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n >= bounds.min && n <= bounds.max) return n;
  } catch {
    /* usa defecto */
  }
  return bounds.preferred;
}

async function walkSchema(
  schema: ZodTypeAny,
  ctx: WalkContext
): Promise<unknown> {
  const inner = unwrapModifiers(schema);

  if (isLeafSchema(inner)) {
    await sleep(INTER_CALL_DELAY_MS);
    return walkLeaf(inner, ctx);
  }

  if (inner instanceof z.ZodArray) {
    const elementSchema = unwrapModifiers(inner.element as ZodTypeAny);
    const fieldName = ctx.path[ctx.path.length - 1] ?? 'items';
    const arrayLabel = ctx.path.join('.') || fieldName;
    const count = await askArrayCount(
      inner as z.ZodArray<ZodTypeAny>,
      fieldName,
      ctx
    );

    // Fast path: if each element fits in a compact call and the array is small,
    // generate the entire array in one walkCompact call instead of per-element.
    if (
      isCompactElement(elementSchema) &&
      count <= MAX_WHOLE_ARRAY_COMPACT_ITEMS
    ) {
      ctx.onProgress?.(arrayLabel, false);
      await sleep(INTER_CALL_DELAY_MS);
      const result = await walkCompact(inner, {
        ...ctx,
        progressLabel: arrayLabel,
      });
      ctx.onProgress?.(arrayLabel, true);
      return result;
    }

    // Slow path: non-compact elements → generate one by one
    ctx.onProgress?.(arrayLabel, false);
    const items: unknown[] = [];

    for (let i = 0; i < count; i++) {
      await sleep(INTER_CALL_DELAY_MS);
      const elemLabel = `${arrayLabel}[${i + 1}/${count}]`;
      const elemCtx: WalkContext = {
        ...ctx,
        path: [...ctx.path, String(i)],
        itemHint: `item ${i + 1} of ${count}`,
        progressLabel: elemLabel,
      };
      items.push(await walkSchema(elementSchema, elemCtx));
    }

    ctx.onProgress?.(arrayLabel, true);
    return items;
  }

  // Compact object: single call (except at root where per-field gives better progress).
  if (isCompactSchema(inner) && ctx.path.length > 0) {
    await sleep(INTER_CALL_DELAY_MS);
    return walkCompact(inner, ctx);
  }

  if (inner instanceof z.ZodObject) {
    const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
    const entries = Object.entries(shape);
    const result: Record<string, unknown> = {};

    const compactEntries = entries.filter(([, s]) =>
      isCompactSchema(s as ZodTypeAny)
    );
    const complexEntries = entries.filter(
      ([, s]) => !isCompactSchema(s as ZodTypeAny)
    );

    if (compactEntries.length > 0) {
      for (const [key, fieldSchema] of compactEntries) {
        const fieldCtx: WalkContext = {
          ...ctx,
          path: [...ctx.path, key],
          progressLabel: [...ctx.path, key].join('.'),
        };
        if (isLeafSchema(unwrapModifiers(fieldSchema as ZodTypeAny))) {
          await sleep(INTER_CALL_DELAY_MS);
          result[key] = await walkLeaf(fieldSchema as ZodTypeAny, fieldCtx);
        } else {
          await sleep(INTER_CALL_DELAY_MS);
          result[key] = await walkCompact(fieldSchema as ZodTypeAny, fieldCtx);
        }
      }
    }

    for (const [key, fieldSchema] of complexEntries) {
      result[key] = await walkSchema(fieldSchema as ZodTypeAny, {
        ...ctx,
        path: [...ctx.path, key],
      });
    }

    return result;
  }

  await sleep(INTER_CALL_DELAY_MS);
  return walkLeaf(inner, ctx);
}

async function generateChunked<TOutputSchema extends ZodTypeAny, TInput>(
  prompt: string,
  schema: TOutputSchema,
  input: TInput | undefined,
  timeoutMs: number,
  maxRetries: number,
  onProgress?: (field: string, done: boolean) => void
): Promise<unknown> {
  return walkSchema(schema, {
    taskPrompt: prompt,
    input,
    timeoutMs,
    maxRetries,
    path: [],
    onProgress,
  });
}

export async function generateStructuredResponse<
  TOutputSchema extends ZodTypeAny,
  TInput = unknown,
>(
  options: StructuredGenerateOptions<TOutputSchema, TInput>
): Promise<z.infer<TOutputSchema>> {
  const {
    prompt,
    output,
    input,
    inputSchema,
    maxRetries = 2,
    maxContinuations = DEFAULT_MAX_STRUCTURED_CONTINUATIONS,
    timeoutMs = DEFAULT_STRUCTURED_TIMEOUT_MS,
    strategy = 'single',
    onProgress,
  } = options;

  if (inputSchema && input !== undefined) {
    inputSchema.parse(input);
  }

  if (strategy === 'chunked') {
    const assembled = await generateChunked(
      prompt,
      output,
      input,
      timeoutMs,
      maxRetries,
      onProgress
    );
    return output.parse(assembled);
  }

  let lastRawResponse = '';
  let lastIssues: StructuredValidationIssue[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastRawResponse =
      attempt === 0
        ? await generateStructuredRawResponse(
            prompt,
            output,
            input,
            maxContinuations,
            timeoutMs
          )
        : await generateStatelessWithQuotaRetry(
            buildRepairPrompt(prompt, output, lastRawResponse, lastIssues),
            timeoutMs
          );

    try {
      const parsed = JSON.parse(extractJsonPayload(lastRawResponse));
      return output.parse(parsed);
    } catch (error) {
      lastIssues = buildJsonParseIssues(error);

      if (attempt === maxRetries) break;
    }
  }

  throw new StructuredOutputError(
    'Unable to produce valid structured output after retries.',
    lastRawResponse,
    lastIssues
  );
}
