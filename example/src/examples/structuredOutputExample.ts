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

const SupportTicketSchema = z.object({
  category: z.enum(['bug', 'billing', 'feature', 'question']),
  priority: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  needsHuman: z.boolean(),
});

export type SupportTicket = z.infer<typeof SupportTicketSchema>;

const ExerciseSchema = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.string(),
  restSeconds: z.number(),
});

const WorkoutDaySchema = z.object({
  day: z.enum(WEEK_DAYS),
  focus: z.string(),
  exercises: z.array(ExerciseSchema).min(0).max(4),
});

const WorkoutPlanSchema = z.object({
  goal: z.string(),
  durationWeeks: z.number(),
  days: z.array(WorkoutDaySchema).length(7),
  notes: z.string(),
});

export type WorkoutPlan = z.infer<typeof WorkoutPlanSchema>;

function defaultTrainingExercises() {
  return [
    { name: 'Back Squat', sets: 4, reps: '6-8', restSeconds: 120 },
    { name: 'Bench Press', sets: 4, reps: '6-8', restSeconds: 120 },
    { name: 'Romanian Deadlift', sets: 3, reps: '8-10', restSeconds: 90 },
  ];
}

function normalizeExercise(exercise: z.infer<typeof ExerciseSchema>) {
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

function buildFallbackDay(day: WeekDay): z.infer<typeof WorkoutDaySchema> {
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

function normalizeWorkoutPlan(plan: WorkoutPlan): WorkoutPlan {
  const firstByDay = new Map<WeekDay, z.infer<typeof WorkoutDaySchema>>();
  for (const dayPlan of plan.days) {
    if (!firstByDay.has(dayPlan.day)) {
      firstByDay.set(dayPlan.day, dayPlan);
    }
  }

  const days = WEEK_DAYS.map((day) => {
    const source = firstByDay.get(day) ?? buildFallbackDay(day);
    const weekend = day === 'Saturday' || day === 'Sunday';

    let exercises = source.exercises.map((exercise) =>
      normalizeExercise(exercise)
    );

    if (weekend) {
      exercises = [];
    } else {
      if (exercises.length > 4) exercises = exercises.slice(0, 4);
      if (exercises.length < 3) {
        const fallback = defaultTrainingExercises();
        for (let i = exercises.length; i < 3; i++) {
          exercises.push(fallback[i]!);
        }
      }
    }

    return {
      day,
      focus: weekend
        ? 'Rest'
        : source.focus.trim() || 'Strength + conditioning',
      exercises,
    };
  });

  return {
    goal: plan.goal.trim() || 'Strength + fat loss',
    durationWeeks: 1,
    notes: plan.notes.trim() || 'Progressively increase load week to week.',
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
    const generated = await generateStructuredResponse({
      prompt:
        'Create a coherent 1-week workout JSON. Constraints: exactly 7 unique days in this exact order Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. Monday-Friday are training days with 3 or 4 exercises each. Saturday and Sunday are rest days with exercises as empty array. Keep exercise names short (2-4 words).',
      output: WorkoutPlanSchema,
      strategy: 'chunked',
      maxRetries: 2,
      timeoutMs: 90000,
      onProgress,
      signal,
    });

    return normalizeWorkoutPlan(generated);
  } catch (err) {
    // Re-throw if user deliberately cancelled
    if ((err as { name?: string }).name === 'AbortError') throw err;
    // Never fail the example UX because of on-device timeout/quota.
    onProgress?.('fallback.localPlan', false);
    const fallback = buildDeterministicWorkoutPlan();
    onProgress?.('fallback.localPlan', true);
    return fallback;
  }
}
