import { generateStructuredResponse } from 'react-native-ai-core';
import { z } from 'zod';

const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

type WeekDay = (typeof WEEK_DAYS)[number];

const TRAINING_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
] as const;

const SupportTicketSchema = z.object({
  category: z.enum(['bug', 'billing', 'feature', 'question']),
  priority: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  needsHuman: z.boolean(),
});

export type SupportTicket = z.infer<typeof SupportTicketSchema>;

// ── Internal schema (minimal tokens) ─────────────────────────────────────────
// Only Mon–Fri, exactly 3 exercises, no redundant fields.
// "rest" instead of "restSeconds" saves tokens on every exercise.

const InternalExerciseSchema = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.string(),
  rest: z.number(),
});

const InternalDaySchema = z.object({
  day: z.enum(TRAINING_DAYS),
  focus: z.string(),
  exercises: z.array(InternalExerciseSchema).length(3),
});

const InternalPlanSchema = z.object({
  days: z.array(InternalDaySchema).length(5),
});

// ── Public types ──────────────────────────────────────────────────────────────

type Exercise = {
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
};

type WorkoutDay = {
  day: (typeof WEEK_DAYS)[number];
  focus: string;
  exercises: Exercise[];
};

export type WorkoutPlan = {
  goal: string;
  durationWeeks: number;
  days: WorkoutDay[];
  notes: string;
};

function defaultTrainingExercises() {
  return [
    { name: 'Back Squat', sets: 4, reps: '6-8', restSeconds: 120 },
    { name: 'Bench Press', sets: 4, reps: '6-8', restSeconds: 120 },
    { name: 'Romanian Deadlift', sets: 3, reps: '8-10', restSeconds: 90 },
  ];
}

function normalizeExercise(exercise: Exercise) {
  const name = exercise.name.trim() || 'Accessory Lift';
  const sets = Number.isFinite(exercise.sets)
    ? Math.min(6, Math.max(2, Math.round(exercise.sets)))
    : 3;
  const restSeconds = Number.isFinite(exercise.restSeconds)
    ? Math.min(240, Math.max(30, Math.round(exercise.restSeconds)))
    : 90;
  const reps = exercise.reps.trim() || '8-12';
  return { name, sets, reps, restSeconds };
}

function buildFallbackDay(day: WeekDay): WorkoutDay {
  const weekend = day === 'Saturday' || day === 'Sunday';
  if (weekend) {
    return { day, focus: 'Rest', exercises: [] };
  }
  return {
    day,
    focus: 'Strength + conditioning',
    exercises: defaultTrainingExercises(),
  };
}

function expandInternalPlan(
  internal: z.infer<typeof InternalPlanSchema>
): WorkoutPlan {
  const byDay = new Map(internal.days.map((d) => [d.day, d]));

  const days = WEEK_DAYS.map((day): WorkoutDay => {
    const weekend = day === 'Saturday' || day === 'Sunday';
    if (weekend) return { day, focus: 'Rest', exercises: [] };

    const src = byDay.get(day as (typeof TRAINING_DAYS)[number]);
    if (!src) return buildFallbackDay(day);

    const exercises = src.exercises.map((e) =>
      normalizeExercise({ ...e, restSeconds: e.rest })
    );

    return {
      day,
      focus: src.focus.trim() || 'Strength + conditioning',
      exercises,
    };
  });

  return {
    goal: 'Strength + fat loss',
    durationWeeks: 1,
    notes: 'Progressively increase load week to week.',
    days,
  };
}

function buildDeterministicWorkoutPlan(): WorkoutPlan {
  return {
    goal: 'Strength + fat loss',
    durationWeeks: 1,
    notes:
      'Fallback plan generated locally due to on-device timeout. Progressively increase load week to week.',
    days: WEEK_DAYS.map((day) => buildFallbackDay(day)),
  };
}

export async function classifySupportMessage(
  message: string,
  signal?: AbortSignal
) {
  return generateStructuredResponse({
    prompt:
      'Classify the user message for an internal support workflow. Keep the summary concise.',
    input: {
      message,
    },
    inputSchema: z.object({
      message: z.string().min(1).max(700),
    }),
    output: SupportTicketSchema,
    maxRetries: 2,
    timeoutMs: 180000,
    signal,
  });
}

export async function buildWeeklyWorkoutPlan(
  onProgress?: (field: string, done: boolean) => void,
  signal?: AbortSignal
) {
  try {
    // Use the minimal internal schema with single strategy — 1 inference call
    // instead of 20+ chunked calls. Gemma 4 handles the full JSON in one shot.
    const internal = await generateStructuredResponse({
      prompt:
        'Output a 5-day strength workout plan for Monday to Friday. ' +
        'Each day: unique day name, short focus label, exactly 3 exercises. ' +
        'Each exercise: short name (2-4 words), sets, reps as string (e.g. "8-10"), rest in seconds.',
      output: InternalPlanSchema,
      strategy: 'single',
      maxRetries: 2,
      timeoutMs: 180000,
      onProgress,
      signal,
    });

    return expandInternalPlan(internal);
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    onProgress?.('fallback.localPlan', false);
    const fallback = buildDeterministicWorkoutPlan();
    onProgress?.('fallback.localPlan', true);
    return fallback;
  }
}
