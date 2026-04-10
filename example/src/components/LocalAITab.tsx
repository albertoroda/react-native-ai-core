/**
 * LocalAITab.tsx
 *
 * UI playground for fully on-device LLM inference examples.
 * Demonstrates three patterns from localAIExample.ts:
 *
 *  1. Ping        — plain free-text via generateResponseStateless
 *  2. Recipe      — free-text prompt + manual JSON extraction
 *  3. Day menu    — JSON template prompt, one call per day
 *
 * Requires Gemma 4 2B to be downloaded and initialised.
 * The tab handles model setup (ensureModel) internally.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  isModelReady,
  isModelDownloaded,
  setupModel,
  releaseModel,
  runPingExample,
  runRecipeExample,
  runDayMenuExample,
  runWeeklyMenuExample,
  runWeeklyMenuStreamExample,
  type RecipeResult,
  type DayMenuResult,
  type WeeklyMealDay,
} from '../examples/localAIExample';
import type { EnsureModelOptions } from 'react-native-ai-core';

// ── Design tokens (must match App.tsx) ────────────────────────────────────────

const C = {
  bg: '#08111f',
  surface: '#0f1d30',
  surfaceHigh: '#162338',
  border: '#1e3148',
  accent: '#6366f1',
  accentLight: '#818cf8',
  accentDim: '#1e1b4b',
  textPrimary: '#f1f5f9',
  textSecondary: '#64748b',
  textMuted: '#374151',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface LocalAITabProps {
  hfToken?: string;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ModelStatus = 'unknown' | 'not_downloaded' | 'ready' | 'loading' | 'error';
type RunningExample =
  | 'ping'
  | 'recipe'
  | 'menu'
  | 'weekly'
  | 'weeklyStream'
  | null;

// ── Component ─────────────────────────────────────────────────────────────────

export function LocalAITab({ hfToken }: LocalAITabProps) {
  const insets = useSafeAreaInsets();

  // Model state
  const [modelStatus, setModelStatus] = useState<ModelStatus>('unknown');
  const [setupLog, setSetupLog] = useState<string[]>([]);

  // Example state
  const [running, setRunning] = useState<RunningExample>(null);
  const [error, setError] = useState<string | null>(null);

  // Results
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [recipeResult, setRecipeResult] = useState<RecipeResult | null>(null);
  const [menuResult, setMenuResult] = useState<DayMenuResult | null>(null);
  const [weeklyDays, setWeeklyDays] = useState<WeeklyMealDay[]>([]);
  const [streamDays, setStreamDays] = useState<WeeklyMealDay[]>([]);
  const [streamTokenCount, setStreamTokenCount] = useState(0);
  const [streamRaw, setStreamRaw] = useState<string | null>(null);
  const streamScrollRef = useRef<ScrollView>(null);

  // Inputs
  const [dishName, setDishName] = useState('Spaghetti carbonara');
  const [menuDate, setMenuDate] = useState(
    new Date().toISOString().split('T')[0] ?? '2026-04-09'
  );
  const [menuDiet, setMenuDiet] = useState('omnivore');

  const abortRef = useRef(false);

  // ── Check model on mount ───────────────────────────────────────────────────

  const checkStatus = useCallback(async () => {
    setModelStatus('loading');
    try {
      if (await isModelReady()) {
        setModelStatus('ready');
      } else if (await isModelDownloaded()) {
        // Downloaded but not in memory — init it
        setModelStatus('loading');
        await setupModel(hfToken ?? undefined);
        setModelStatus('ready');
      } else {
        setModelStatus('not_downloaded');
      }
    } catch (e: any) {
      setModelStatus('error');
      setError(e?.message ?? 'Status check failed');
    }
  }, [hfToken]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // ── Model setup ────────────────────────────────────────────────────────────

  const handleSetup = async () => {
    setModelStatus('loading');
    setSetupLog([]);
    setError(null);
    abortRef.current = false;
    try {
      const progress: EnsureModelOptions['onProgress'] = (p) => {
        const pct =
          p.totalBytes > 0
            ? ((p.receivedBytes / p.totalBytes) * 100).toFixed(0)
            : '?';
        const mbps = (p.bytesPerSecond / 1024 / 1024).toFixed(1);
        setSetupLog((prev) => [
          `Downloading… ${pct}% · ${mbps} MB/s`,
          ...prev.slice(0, 4),
        ]);
      };
      const status: EnsureModelOptions['onStatus'] = (s) => {
        setSetupLog((prev) => [s, ...prev.slice(0, 4)]);
      };
      await setupModel(hfToken ?? undefined, {
        onStatus: status,
        onProgress: progress,
      });
      setModelStatus('ready');
      setSetupLog((prev) => ['Model ready ✓', ...prev]);
    } catch (e: any) {
      setModelStatus('error');
      setError(e?.message ?? 'Setup failed');
    }
  };

  const handleRelease = async () => {
    try {
      await releaseModel();
      setModelStatus('not_downloaded');
      setPingResult(null);
      setRecipeResult(null);
      setMenuResult(null);
      setWeeklyDays([]);
      setStreamDays([]);
      setStreamTokenCount(0);
      setStreamRaw(null);
      setSetupLog([]);
    } catch (e: any) {
      setError(e?.message ?? 'Release failed');
    }
  };

  // ── Example runners ────────────────────────────────────────────────────────

  const runPing = async () => {
    if (modelStatus !== 'ready' || running) return;
    setRunning('ping');
    setError(null);
    setPingResult(null);
    try {
      const result = await runPingExample();
      setPingResult(result);
    } catch (e: any) {
      setError(e?.message ?? 'Ping failed');
    } finally {
      setRunning(null);
    }
  };

  const runRecipe = async () => {
    if (modelStatus !== 'ready' || running || !dishName.trim()) return;
    setRunning('recipe');
    setError(null);
    setRecipeResult(null);
    try {
      const result = await runRecipeExample(dishName.trim());
      setRecipeResult(result);
    } catch (e: any) {
      setError(e?.message ?? 'Recipe generation failed');
    } finally {
      setRunning(null);
    }
  };

  const runMenu = async () => {
    if (modelStatus !== 'ready' || running) return;
    setRunning('menu');
    setError(null);
    setMenuResult(null);
    try {
      const result = await runDayMenuExample({
        date: menuDate,
        dietType: menuDiet.trim() || 'omnivore',
        budget: 'medium',
      });
      setMenuResult(result);
    } catch (e: any) {
      setError(e?.message ?? 'Menu generation failed');
    } finally {
      setRunning(null);
    }
  };

  const runWeekly = async () => {
    if (modelStatus !== 'ready' || running) return;
    setRunning('weekly');
    setError(null);
    setWeeklyDays([]);
    try {
      await runWeeklyMenuExample({
        startDate: menuDate,
        dietType: menuDiet.trim() || 'omnivore',
        budget: 'medium',
        // onDayComplete fires after each day is parsed — update UI incrementally
        onDayComplete: (day) => {
          setWeeklyDays((prev) => [...prev, day]);
        },
      });
    } catch (e: any) {
      setError(e?.message ?? 'Weekly menu generation failed');
    } finally {
      setRunning(null);
    }
  };

  const runWeeklyStream = async () => {
    if (modelStatus !== 'ready' || running) return;
    setRunning('weeklyStream');
    setError(null);
    setStreamDays([]);
    setStreamTokenCount(0);
    try {
      await runWeeklyMenuStreamExample({
        startDate: menuDate,
        dietType: menuDiet.trim() || 'omnivore',
        budget: 'medium',
        onTokenCount: (count) => setStreamTokenCount(count),
        onRawToken: (delta) => {
          setStreamRaw((prev) => (prev ?? '') + delta);
          streamScrollRef.current?.scrollToEnd({ animated: false });
        },
        onDayComplete: (day) => {
          setStreamDays((prev) => [...prev, day]);
        },
      });
    } catch (e: any) {
      setError(e?.message ?? 'Stream weekly menu failed');
    } finally {
      setRunning(null);
    }
  };

  // ── Helper renderers ───────────────────────────────────────────────────────

  const statusColor: Record<ModelStatus, string> = {
    unknown: C.textSecondary,
    not_downloaded: C.warning,
    ready: C.success,
    loading: C.accentLight,
    error: C.danger,
  };
  const statusLabel: Record<ModelStatus, string> = {
    unknown: 'Checking…',
    not_downloaded: 'Not downloaded',
    ready: 'Ready',
    loading: 'Loading…',
    error: 'Error',
  };

  const isReady = modelStatus === 'ready';
  const isLoading = modelStatus === 'loading';

  const renderRecipeCard = (r: RecipeResult) => (
    <View style={s.resultCard}>
      <Text style={s.resultTitle}>{r.name}</Text>
      <Text style={s.resultSub}>{r.description}</Text>
      <View style={s.macroRow}>
        <MacroPill label="kcal" value={r.kcal} />
        <MacroPill label="protein" value={r.protein} unit="g" />
        <MacroPill label="carbs" value={r.carbs} unit="g" />
        <MacroPill label="fat" value={r.fat} unit="g" />
        <MacroPill label="prep" value={r.prepMinutes} unit="min" />
      </View>
    </View>
  );

  const renderMealRow = (label: string, m: { name: string; kcal: number }) => (
    <View key={label} style={s.mealRow}>
      <Text style={s.mealLabel}>{label}</Text>
      <Text style={s.mealName} numberOfLines={1}>
        {m.name}
      </Text>
      <Text style={s.mealKcal}>{m.kcal} kcal</Text>
    </View>
  );

  const renderMenuCard = (r: DayMenuResult) => (
    <View style={s.resultCard}>
      {renderMealRow('Breakfast', r.breakfast)}
      {renderMealRow('Morning snack', r.morning_snack)}
      {renderMealRow('Lunch', r.lunch)}
      {renderMealRow('Afternoon snack', r.afternoon_snack)}
      {renderMealRow('Dinner', r.dinner)}
      <Text style={[s.resultSub, { marginTop: 6 }]}>
        Estimated cost: €{r.estimatedCostEur.toFixed(2)}
      </Text>
    </View>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.inner, { paddingBottom: 32 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Model status ── */}
      <Text style={s.sectionLabel}>MODEL · GEMMA 4 2B (LITERTLM)</Text>
      <View style={s.card}>
        <View style={s.row}>
          <View
            style={[s.pip, { backgroundColor: statusColor[modelStatus] }]}
          />
          <Text style={[s.statusText, { color: statusColor[modelStatus] }]}>
            {statusLabel[modelStatus]}
          </Text>
          {isLoading && (
            <ActivityIndicator
              size="small"
              color={C.accentLight}
              style={{ marginLeft: 8 }}
            />
          )}
        </View>
        {setupLog.length > 0 && (
          <View style={{ marginTop: 8, gap: 2 }}>
            {setupLog.map((line, i) => (
              <Text key={i} style={s.logLine}>
                {line}
              </Text>
            ))}
          </View>
        )}
        <View style={[s.row, { gap: 8, marginTop: 10 }]}>
          <Pressable
            style={[
              s.btn,
              s.btnAccent,
              { flex: 1 },
              (isLoading || isReady) && s.btnDisabled,
            ]}
            onPress={handleSetup}
            disabled={isLoading || isReady}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.btnText}>
                {modelStatus === 'not_downloaded'
                  ? 'Download & init'
                  : isReady
                    ? 'Ready ✓'
                    : 'Load model'}
              </Text>
            )}
          </Pressable>
          <Pressable
            style={[s.btn, s.btnDanger, { flex: 1 }, !isReady && s.btnDisabled]}
            onPress={handleRelease}
            disabled={!isReady}
          >
            <Text style={s.btnText}>Release</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Error banner ── */}
      {error && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>⚠ {error}</Text>
        </View>
      )}

      {/* ── Example 1: Ping ── */}
      <Text style={[s.sectionLabel, { marginTop: 20 }]}>
        EXAMPLE 1 · PING (FREE TEXT)
      </Text>
      <View style={s.card}>
        <Text style={s.exampleDesc}>
          Sends a trivial prompt using{' '}
          <Text style={s.code}>generateResponseStateless</Text> to verify the
          engine is responding. No conversation history.
        </Text>
        <Pressable
          style={[
            s.btn,
            s.btnOutline,
            { marginTop: 10 },
            (!isReady || !!running) && s.btnDisabled,
          ]}
          onPress={runPing}
          disabled={!isReady || !!running}
        >
          {running === 'ping' ? (
            <View style={s.row}>
              <ActivityIndicator size="small" color={C.accentLight} />
              <Text style={[s.btnOutlineText, { marginLeft: 8 }]}>
                Running…
              </Text>
            </View>
          ) : (
            <Text style={s.btnOutlineText}>Run ping</Text>
          )}
        </Pressable>
        {pingResult !== null && (
          <View style={[s.resultCard, { marginTop: 10 }]}>
            <Text style={s.resultTitle}>Response</Text>
            <Text style={s.resultBody}>{pingResult}</Text>
          </View>
        )}
      </View>

      {/* ── Example 2: Recipe ── */}
      <Text style={[s.sectionLabel, { marginTop: 20 }]}>
        EXAMPLE 2 · RECIPE (FREE TEXT + JSON PARSE)
      </Text>
      <View style={s.card}>
        <Text style={s.exampleDesc}>
          Sends a JSON template in the prompt. The model fills in values — no
          schema description overhead. Result is parsed with Zod.
        </Text>
        <TextInput
          style={[s.field, { marginTop: 10 }]}
          value={dishName}
          onChangeText={setDishName}
          placeholder="Dish name…"
          placeholderTextColor={C.textSecondary}
          autoCorrect={false}
        />
        <Pressable
          style={[
            s.btn,
            s.btnOutline,
            { marginTop: 8 },
            (!isReady || !!running || !dishName.trim()) && s.btnDisabled,
          ]}
          onPress={runRecipe}
          disabled={!isReady || !!running || !dishName.trim()}
        >
          {running === 'recipe' ? (
            <View style={s.row}>
              <ActivityIndicator size="small" color={C.accentLight} />
              <Text style={[s.btnOutlineText, { marginLeft: 8 }]}>
                Generating…
              </Text>
            </View>
          ) : (
            <Text style={s.btnOutlineText}>Generate recipe</Text>
          )}
        </Pressable>
        {recipeResult && renderRecipeCard(recipeResult)}
      </View>

      {/* ── Example 3: Day menu ── */}
      <Text style={[s.sectionLabel, { marginTop: 20 }]}>
        EXAMPLE 3 · DAY MENU (JSON TEMPLATE)
      </Text>
      <View style={s.card}>
        <Text style={s.exampleDesc}>
          Generates a full-day meal plan (5 meals) from a JSON template prompt.
          One <Text style={s.code}>generateResponseStateless</Text> call. Gemma
          4's 32 K context handles the full day in one shot.
        </Text>
        <View style={[s.row, { gap: 8, marginTop: 10 }]}>
          <TextInput
            style={[s.field, { flex: 1 }]}
            value={menuDate}
            onChangeText={setMenuDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C.textSecondary}
            autoCorrect={false}
          />
          <TextInput
            style={[s.field, { flex: 1 }]}
            value={menuDiet}
            onChangeText={setMenuDiet}
            placeholder="diet type"
            placeholderTextColor={C.textSecondary}
            autoCorrect={false}
          />
        </View>
        <Pressable
          style={[
            s.btn,
            s.btnOutline,
            { marginTop: 8 },
            (!isReady || !!running) && s.btnDisabled,
          ]}
          onPress={runMenu}
          disabled={!isReady || !!running}
        >
          {running === 'menu' ? (
            <View style={s.row}>
              <ActivityIndicator size="small" color={C.accentLight} />
              <Text style={[s.btnOutlineText, { marginLeft: 8 }]}>
                Generating…
              </Text>
            </View>
          ) : (
            <Text style={s.btnOutlineText}>Generate day menu</Text>
          )}
        </Pressable>
        {menuResult && renderMenuCard(menuResult)}
      </View>

      {/* ── Example 4: Weekly menu (optimized) ── */}
      <Text style={[s.sectionLabel, { marginTop: 20 }]}>
        EXAMPLE 4 · WEEKLY MENU (1 CALL · 7 DAYS)
      </Text>
      <View style={s.card}>
        <Text style={s.exampleDesc}>
          Generates all 7 days in a{' '}
          <Text style={{ color: C.success, fontWeight: '700' }}>
            single model call
          </Text>{' '}
          using an ultra-compact template (single-letter field names).
          {'\n'}Estimated time: <Text style={s.code}>30–60 s</Text> vs{' '}
          <Text style={s.code}>3–5 min</Text> for 7 separate calls.
        </Text>
        <View style={[s.row, { gap: 8, marginTop: 10 }]}>
          <TextInput
            style={[s.field, { flex: 1 }]}
            value={menuDate}
            onChangeText={setMenuDate}
            placeholder="start date YYYY-MM-DD"
            placeholderTextColor={C.textSecondary}
            autoCorrect={false}
          />
          <TextInput
            style={[s.field, { flex: 1 }]}
            value={menuDiet}
            onChangeText={setMenuDiet}
            placeholder="diet type"
            placeholderTextColor={C.textSecondary}
            autoCorrect={false}
          />
        </View>
        <Pressable
          style={[
            s.btn,
            s.btnAccent,
            { marginTop: 8 },
            (!isReady || !!running) && s.btnDisabled,
          ]}
          onPress={runWeekly}
          disabled={!isReady || !!running}
        >
          {running === 'weekly' ? (
            <View style={s.row}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={[s.btnText, { marginLeft: 8 }]}>
                Generating… day {weeklyDays.length}/7
              </Text>
            </View>
          ) : (
            <Text style={s.btnText}>Generate 7-day menu</Text>
          )}
        </Pressable>

        {weeklyDays.length > 0 && (
          <View style={{ marginTop: 10, gap: 6 }}>
            {weeklyDays.map((day, i) => (
              <View key={day.date} style={s.weekDayCard}>
                <View style={[s.row, { marginBottom: 4 }]}>
                  <Text style={s.weekDayLabel}>
                    Day {i + 1} · {day.date}
                  </Text>
                  <Text style={s.weekDayCost}>
                    €{day.estimatedCostEur.toFixed(2)}
                  </Text>
                </View>
                {dayMeals(day).map(([label, meal]) => (
                  <View key={label} style={s.weekMealRow}>
                    <Text style={s.weekMealLabel}>{label}</Text>
                    <Text style={s.weekMealName} numberOfLines={1}>
                      {meal.name}
                    </Text>
                    <Text style={s.weekMealKcal}>{meal.kcal}k</Text>
                  </View>
                ))}
              </View>
            ))}
            {running !== 'weekly' && (
              <Text
                style={[s.resultSub, { textAlign: 'center', marginTop: 4 }]}
              >
                Total:{' '}
                {weeklyDays
                  .reduce(
                    (s, d) =>
                      s +
                      d.breakfast.kcal +
                      d.morningSnack.kcal +
                      d.lunch.kcal +
                      d.afternoonSnack.kcal +
                      d.dinner.kcal,
                    0
                  )
                  .toLocaleString()}{' '}
                kcal · €
                {weeklyDays
                  .reduce((s, d) => s + d.estimatedCostEur, 0)
                  .toFixed(2)}{' '}
                total
              </Text>
            )}
          </View>
        )}
      </View>

      {/* ── Example 5: Weekly menu via full stream ── */}
      <Text style={[s.sectionLabel, { marginTop: 20 }]}>
        EXAMPLE 5 · WEEKLY MENU · FULL STREAM (PARSE AT END)
      </Text>
      <View style={s.card}>
        <Text style={s.exampleDesc}>
          Same 1-call approach but using{' '}
          <Text style={{ color: C.success, fontWeight: '700' }}>
            generateResponseStream
          </Text>{' '}
          — the same path as the chat tab. Tokens arrive in real time, we count
          them for progress, and parse the full JSON once complete.
        </Text>
        <Text style={[s.exampleDesc, { marginTop: 4, color: C.textMuted }]}>
          Uses date and diet inputs from Example 3.
        </Text>
        <Pressable
          style={[
            s.btn,
            s.btnAccent,
            { marginTop: 10 },
            (!isReady || !!running) && s.btnDisabled,
          ]}
          onPress={runWeeklyStream}
          disabled={!isReady || !!running}
        >
          {running === 'weeklyStream' ? (
            <View style={s.row}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={[s.btnText, { marginLeft: 8 }]}>
                Streaming… {streamTokenCount} tokens
              </Text>
            </View>
          ) : (
            <Text style={s.btnText}>Generate 7-day menu (stream)</Text>
          )}
        </Pressable>

        {/* Live raw text preview while streaming */}
        {streamRaw !== null && streamDays.length === 0 && (
          <ScrollView
            ref={streamScrollRef}
            style={s.streamBox}
            scrollEnabled
            nestedScrollEnabled
          >
            <Text style={s.streamText}>{streamRaw}</Text>
          </ScrollView>
        )}

        {streamDays.length > 0 && (
          <View style={{ marginTop: 10, gap: 6 }}>
            {streamDays.map((day, i) => (
              <View key={day.date} style={s.weekDayCard}>
                <View style={[s.row, { marginBottom: 4 }]}>
                  <Text style={s.weekDayLabel}>
                    Day {i + 1} · {day.date}
                  </Text>
                  <Text style={s.weekDayCost}>
                    €{day.estimatedCostEur.toFixed(2)}
                  </Text>
                </View>
                {dayMeals(day).map(([label, meal]) => (
                  <View key={label} style={s.weekMealRow}>
                    <Text style={s.weekMealLabel}>{label}</Text>
                    <Text style={s.weekMealName} numberOfLines={1}>
                      {meal.name}
                    </Text>
                    <Text style={s.weekMealKcal}>{meal.kcal}k</Text>
                  </View>
                ))}
              </View>
            ))}
            {running !== 'weeklyStream' && (
              <Text
                style={[s.resultSub, { textAlign: 'center', marginTop: 4 }]}
              >
                {streamTokenCount} tokens ·{' '}
                {streamDays
                  .reduce(
                    (acc, d) =>
                      acc +
                      d.breakfast.kcal +
                      d.morningSnack.kcal +
                      d.lunch.kcal +
                      d.afternoonSnack.kcal +
                      d.dinner.kcal,
                    0
                  )
                  .toLocaleString()}{' '}
                kcal · €
                {streamDays
                  .reduce((acc, d) => acc + d.estimatedCostEur, 0)
                  .toFixed(2)}{' '}
                total
              </Text>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

type Meal = WeeklyMealDay['breakfast'];
type DayMealRow = [string, Meal];
function dayMeals(day: WeeklyMealDay): DayMealRow[] {
  return [
    ['🌅 Breakfast', day.breakfast],
    ['🍎 Snack', day.morningSnack],
    ['☀️ Lunch', day.lunch],
    ['🫐 Snack', day.afternoonSnack],
    ['🌙 Dinner', day.dinner],
  ];
}

function MacroPill({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit?: string;
}) {
  return (
    <View style={s.macroPill}>
      <Text style={s.macroValue}>
        {Math.round(value)}
        {unit ?? ''}
      </Text>
      <Text style={s.macroLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  inner: { padding: 16, paddingTop: 20, gap: 8 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  row: { flexDirection: 'row', alignItems: 'center' },

  pip: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { fontSize: 14, fontWeight: '600' },
  logLine: { fontSize: 11, color: C.textSecondary, fontFamily: 'monospace' },

  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnAccent: { backgroundColor: C.accent },
  btnDanger: { backgroundColor: C.danger },
  btnOutline: { borderWidth: 1.5, borderColor: C.accent },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnOutlineText: { color: C.accentLight, fontWeight: '700', fontSize: 13 },

  field: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: C.textPrimary,
    fontSize: 13,
  },

  errorBanner: {
    backgroundColor: '#450a0a',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  errorText: { color: C.danger, fontSize: 12 },

  exampleDesc: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },
  code: { fontFamily: 'monospace', color: C.accentLight },

  resultCard: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    gap: 4,
  },
  resultTitle: { fontSize: 14, fontWeight: '700', color: C.textPrimary },
  resultSub: { fontSize: 12, color: C.textSecondary },
  resultBody: { fontSize: 13, color: C.textPrimary, marginTop: 4 },

  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  macroPill: {
    backgroundColor: C.accentDim,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    minWidth: 52,
  },
  macroValue: { fontSize: 13, fontWeight: '700', color: C.accentLight },
  macroLabel: { fontSize: 9, color: C.textSecondary, marginTop: 1 },

  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 8,
  },
  mealLabel: { fontSize: 10, color: C.textSecondary, width: 100 },
  mealName: { flex: 1, fontSize: 12, color: C.textPrimary },
  mealKcal: { fontSize: 11, color: C.accentLight, fontWeight: '600' },

  weekDayCard: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  weekDayLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: C.textPrimary,
  },
  weekDayCost: { fontSize: 11, color: C.success, fontWeight: '600' },
  weekMealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 6,
  },
  weekMealLabel: { fontSize: 10, color: C.textSecondary, width: 76 },
  weekMealName: { flex: 1, fontSize: 11, color: C.textPrimary },
  weekMealKcal: { fontSize: 10, color: C.accentLight, fontWeight: '600' },

  streamBox: {
    maxHeight: 200,
    marginTop: 10,
    backgroundColor: '#060e1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    padding: 8,
  },
  streamText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: C.accentLight,
    lineHeight: 14,
  },
});
