/**
 * InitTab.tsx
 *
 * Interactive playground for every new programmatic initialization API
 * added in react-native-ai-core v0.4.x.
 *
 * Exposes individual method buttons AND two composite flow buttons
 * (first-launch / subsequent-launch) so each API can be exercised in isolation
 * or as a realistic end-to-end sequence.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KnownModel } from 'react-native-ai-core';
import {
  listEngines,
  listKnownModels,
  checkIfDownloaded,
  queryInitializedModel,
  runEnsureModel,
  runSetSystemPrompt,
  runClearSystemPrompt,
  runGetTokenCount,
  runStatelessGeneration,
  runFirstLaunchFlow,
  runSubsequentLaunchFlow,
  type StepResult,
} from '../examples/modelInitExample';

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
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  dangerDim: '#450a0a',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface InitTabProps {
  /** HuggingFace token managed by the parent (App.tsx / SecureStore). */
  hfToken: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function valueToString(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

// ── Sub-component: result card ────────────────────────────────────────────────

function ResultCard({ result }: { result: StepResult }) {
  return (
    <View style={[s.resultCard, result.ok ? s.resultOk : s.resultFail]}>
      <View style={s.resultHeader}>
        <Text style={s.resultBadge}>{result.ok ? '✓' : '✗'}</Text>
        <Text style={s.resultStep} numberOfLines={2}>
          {result.step}
        </Text>
      </View>
      <ScrollView
        style={s.resultValueBox}
        nestedScrollEnabled
        horizontal={false}
      >
        <ScrollView horizontal nestedScrollEnabled>
          <Text style={s.resultValue}>
            {result.ok
              ? valueToString(result.value)
              : `Error: ${result.error ?? 'unknown'}`}
          </Text>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function InitTab({ hfToken }: InitTabProps) {
  const insets = useSafeAreaInsets();

  const [results, setResults] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);

  // ── Runner helpers ──────────────────────────────────────────────────────────

  const run = async (fn: () => Promise<StepResult | StepResult[]>) => {
    setRunning(true);
    setProgressLabel(null);
    setDownloadPct(null);
    try {
      const outcome = await fn();
      const arr = Array.isArray(outcome) ? outcome : [outcome];
      setResults((prev) => [...arr, ...prev]);
    } finally {
      setRunning(false);
      setProgressLabel(null);
      setDownloadPct(null);
    }
  };

  const onStep = (step: string) => setProgressLabel(step);

  const onProgress = (p: {
    receivedBytes: number;
    totalBytes: number;
    bytesPerSecond: number;
    remainingMs: number;
  }) => {
    if (p.totalBytes > 0) {
      setDownloadPct(Math.round((p.receivedBytes / p.totalBytes) * 100));
    }
  };

  // ── Section: individual methods ─────────────────────────────────────────────

  const individualMethods: Array<{
    label: string;
    description: string;
    fn: () => Promise<StepResult | StepResult[]>;
  }> = [
    {
      label: 'listEngines()',
      description: 'Engine enum values',
      fn: async () => listEngines(),
    },
    {
      label: 'listKnownModels()',
      description: 'All built-in model descriptors',
      fn: async () => listKnownModels(),
    },
    {
      label: 'isModelDownloaded(Gemma 4 2B)',
      description: 'Check if file exists on device',
      fn: () => checkIfDownloaded(KnownModel.GEMMA4_2B),
    },
    {
      label: 'isModelDownloaded(Gemma 3 1B)',
      description: 'Check smaller model on device',
      fn: () => checkIfDownloaded(KnownModel.GEMMA3_1B),
    },
    {
      label: 'getInitializedModel()',
      description: 'Query what is currently loaded',
      fn: () => queryInitializedModel(),
    },
    {
      label: 'ensureModel(Gemma 4 2B)',
      description: 'Download (if needed) + initialize',
      fn: () =>
        runEnsureModel(
          KnownModel.GEMMA4_2B,
          hfToken || undefined,
          onProgress,
          onStep
        ),
    },
    {
      label: 'setSystemPrompt(JSON extractor)',
      description: 'Inject persistent instruction',
      fn: () =>
        runSetSystemPrompt(
          'You are a precise JSON data extractor. ' +
            'Respond only with a valid JSON object, no markdown fences, no prose.'
        ),
    },
    {
      label: 'clearSystemPrompt()',
      description: 'Remove system instruction',
      fn: () => runClearSystemPrompt(),
    },
    {
      label: 'getTokenCount(short text)',
      description: 'Estimate tokens for ~80 chars',
      fn: () => runGetTokenCount('Hello, how are you? This is a short sample.'),
    },
    {
      label: 'getTokenCount(long document)',
      description: 'Detect context overflow risk',
      fn: () =>
        runGetTokenCount(
          'Invoice #INV-2026-0042\nDate: 2026-04-09\nCustomer: Acme Corp\n' +
            'Items:\n  - Widget A x3 @ $12.50 = $37.50\n  - Service fee = $15.00\n' +
            'Subtotal: $52.50  Tax (10%): $5.25  Total: $57.75\n'.repeat(50)
        ),
    },
    {
      label: 'generateResponseStateless()',
      description: 'One-shot inference, no history pollution',
      fn: () =>
        runStatelessGeneration(
          'Reply in exactly one sentence: what is React Native?'
        ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[
        s.scrollInner,
        { paddingBottom: 32 + insets.bottom },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header */}
      <Text style={s.pageTitle}>Init API Playground</Text>
      <Text style={s.pageSubtitle}>
        Exercise every new initialization method. Results appear below each
        button in reverse-chronological order.
      </Text>

      {/* Progress indicator */}
      {running && (
        <View style={s.progressRow}>
          <ActivityIndicator size="small" color={C.accent} />
          <Text style={s.progressText}>
            {downloadPct !== null
              ? `Downloading… ${downloadPct}%`
              : progressLabel
                ? `${progressLabel}…`
                : 'Running…'}
          </Text>
        </View>
      )}

      {/* ── Composite flows ─────────────────────────────────────────────────── */}
      <Text style={s.sectionLabel}>COMPOSITE FLOWS</Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>First-launch flow</Text>
        <Text style={s.cardDesc}>
          list engines → list models → check disk → ensureModel(Gemma 4 2B) →
          setSystemPrompt → tokenCount → statelessGeneration → clearSystemPrompt
          → verify engine
        </Text>
        <Pressable
          style={[s.btn, s.btnAccent, running && s.btnDisabled]}
          disabled={running}
          onPress={() =>
            run(() =>
              runFirstLaunchFlow(hfToken || undefined, onProgress, onStep)
            )
          }
        >
          <Text style={s.btnText}>▶ Run first-launch flow</Text>
        </Pressable>
      </View>

      <View style={[s.card, { marginTop: 8 }]}>
        <Text style={s.cardTitle}>Subsequent-launch flow</Text>
        <Text style={s.cardDesc}>
          getInitializedModel → if idle: isModelDownloaded → initialize from
          cache (no download). Simulates returning to the chat screen.
        </Text>
        <Pressable
          style={[s.btn, s.btnOutline, running && s.btnDisabled]}
          disabled={running}
          onPress={() =>
            run(() => runSubsequentLaunchFlow(KnownModel.GEMMA4_2B))
          }
        >
          <Text style={s.btnOutlineText}>▶ Run subsequent-launch flow</Text>
        </Pressable>
      </View>

      {/* ── Individual methods ───────────────────────────────────────────────── */}
      <Text style={[s.sectionLabel, { marginTop: 24 }]}>
        INDIVIDUAL METHODS
      </Text>

      {individualMethods.map((m) => (
        <Pressable
          key={m.label}
          style={[s.methodRow, running && s.btnDisabled]}
          disabled={running}
          onPress={() => run(m.fn)}
        >
          <View style={s.methodBody}>
            <Text style={s.methodLabel}>{m.label}</Text>
            <Text style={s.methodDesc}>{m.description}</Text>
          </View>
          <Text style={s.methodArrow}>›</Text>
        </Pressable>
      ))}

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {results.length > 0 && (
        <>
          <View style={s.resultsHeader}>
            <Text style={[s.sectionLabel, { marginTop: 24, marginBottom: 0 }]}>
              RESULTS ({results.length})
            </Text>
            <Pressable onPress={() => setResults([])}>
              <Text style={s.clearBtn}>Clear</Text>
            </Pressable>
          </View>

          {results.map((r, i) => (
            <ResultCard key={`${r.step}-${i}`} result={r} />
          ))}
        </>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  scrollInner: { padding: 16, paddingTop: 20, gap: 8 },

  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },

  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 6,
  },

  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 4,
  },
  progressText: { fontSize: 12, color: C.accentLight, flex: 1 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textPrimary,
  },
  cardDesc: {
    fontSize: 11,
    color: C.textSecondary,
    lineHeight: 16,
  },

  btn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnAccent: { backgroundColor: C.accent },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.border,
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnOutlineText: { color: C.textPrimary, fontWeight: '600', fontSize: 13 },

  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  methodBody: { flex: 1, gap: 2 },
  methodLabel: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: C.accentLight,
    fontWeight: '600',
  },
  methodDesc: { fontSize: 11, color: C.textSecondary },
  methodArrow: { color: C.textSecondary, fontSize: 18 },

  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 6,
  },
  clearBtn: {
    fontSize: 11,
    fontWeight: '700',
    color: C.danger,
  },

  resultCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 2,
  },
  resultOk: {
    backgroundColor: '#0a1a10',
    borderColor: '#166534',
  },
  resultFail: {
    backgroundColor: C.dangerDim,
    borderColor: C.danger,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  resultBadge: {
    fontSize: 13,
    fontWeight: '800',
    color: C.success,
    marginTop: 1,
  },
  resultStep: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: C.textPrimary,
    fontWeight: '600',
  },
  resultValueBox: { maxHeight: 180, paddingHorizontal: 12, paddingBottom: 10 },
  resultValue: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#7dd3fc',
    lineHeight: 17,
  },
});
