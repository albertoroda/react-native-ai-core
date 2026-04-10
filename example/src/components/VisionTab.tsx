/**
 * VisionTab.tsx
 *
 * Demo UI for multimodal (image + text) on-device inference.
 *
 * Features:
 *  - Model selector — only shows vision-capable models (Gemma 3n, Gemma 4)
 *  - Pick a photo from the gallery (expo-image-picker)
 *  - Type a custom prompt or tap a quick-question chip
 *  - Non-streaming (full answer) and streaming (word-by-word) modes
 *  - Automatic model download + init with live progress feedback
 *  - Release button to free GPU memory
 *
 * configure({ enableVision: true }) is called inside setupVisionModel().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  isVisionModelReady,
  setupVisionModel,
  releaseVisionModel,
  analyzeImage,
  analyzeImageStream,
  visionModels,
  DEFAULT_VISION_MODEL,
  type KnownModelEntry,
} from '../examples/visionExample';
import { AICoreMarkdown } from 'react-native-ai-core';
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
  dangerDim: '#450a0a',
};

// ── Quick-prompt chips ────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  'Describe what you see in detail.',
  'What text is visible in this image?',
  'Identify the main objects and their colors.',
  'What is the mood or atmosphere of this image?',
  'Are there any people? If so, what are they doing?',
  'What could be improved in this image?',
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface VisionTabProps {
  hfToken?: string;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ModelStatus = 'unknown' | 'not_downloaded' | 'ready' | 'loading' | 'error';

// ── Component ─────────────────────────────────────────────────────────────────

export function VisionTab({ hfToken }: VisionTabProps) {
  const insets = useSafeAreaInsets();

  // Selected model
  const [selectedModel, setSelectedModel] =
    useState<KnownModelEntry>(DEFAULT_VISION_MODEL);
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Model state
  const [modelStatus, setModelStatus] = useState<ModelStatus>('unknown');
  const [setupPhase, setSetupPhase] = useState<string>('');
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Image state
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  // Inference state
  const [prompt, setPrompt] = useState(QUICK_PROMPTS[0]!);
  const [streamMode, setStreamMode] = useState(true);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [inferenceError, setInferenceError] = useState<string | null>(null);

  // Debug log
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const addLog = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[VisionTab] ${msg}`);
    setDebugLog((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 30));
  };

  // Streaming accumulator
  const streamBuffer = useRef('');
  const cleanupStream = useRef<(() => void) | null>(null);

  // ── Model lifecycle ────────────────────────────────────────────────────────

  const checkModelStatus = useCallback(async () => {
    setModelStatus('loading');
    setSetupError(null);
    try {
      const ready = await isVisionModelReady();
      addLog(`checkModelStatus: isVisionModelReady=${ready}`);
      if (ready) {
        setModelStatus('ready');
      } else {
        setModelStatus('not_downloaded');
      }
    } catch (e: any) {
      setSetupError(e?.message ?? 'Failed to check model status');
      setModelStatus('error');
    }
  }, []);

  useEffect(() => {
    checkModelStatus();
    return () => {
      cleanupStream.current?.();
    };
  }, [checkModelStatus]);

  // Diagnostic: log every time `answer` state changes
  useEffect(() => {
    if (answer !== null) {
      addLog(
        `[state] answer updated len=${answer.length} "${answer.slice(0, 30)}"`
      );
    }
  }, [answer]);

  const handleSetup = async () => {
    setModelStatus('loading');
    setSetupError(null);
    setDownloadPct(null);
    try {
      const onStatus: EnsureModelOptions['onStatus'] = (phase) => {
        const labels: Record<string, string> = {
          checking: 'Checking local storage…',
          downloading: 'Downloading Gemma 3n…',
          initializing: 'Initialising engine…',
        };
        setSetupPhase(labels[phase] ?? phase);
      };
      const onProgress: EnsureModelOptions['onProgress'] = (p) => {
        if (p.totalBytes > 0)
          setDownloadPct(Math.round((p.receivedBytes / p.totalBytes) * 100));
      };
      await setupVisionModel(selectedModel, hfToken ?? undefined, {
        onStatus,
        onProgress,
      });
      setModelStatus('ready');
      setSetupPhase('');
      setDownloadPct(null);
    } catch (e: any) {
      setSetupError(e?.message ?? 'Setup failed');
      setModelStatus('error');
      setSetupPhase('');
      setDownloadPct(null);
    }
  };

  const handleRelease = async () => {
    await releaseVisionModel();
    setModelStatus('not_downloaded');
  };

  // ── Image picking ──────────────────────────────────────────────────────────

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setInferenceError(
        'Gallery permission denied. Please allow access in Settings.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      base64: true,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0]!;
    if (!asset.base64) {
      setInferenceError('Could not read image data. Please try another image.');
      return;
    }

    setImageUri(asset.uri);
    setImageBase64(asset.base64);
    setAnswer(null);
    setInferenceError(null);
  };

  // ── Inference ──────────────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!imageBase64 || running || modelStatus !== 'ready') {
      addLog(
        `BLOCKED: imageBase64=${!!imageBase64} running=${running} status=${modelStatus}`
      );
      return;
    }

    // Clean up any leaked listeners from previous calls before adding new ones.
    cleanupStream.current?.();
    cleanupStream.current = null;

    setRunning(true);
    setAnswer(null);
    setInferenceError(null);

    addLog(
      `Analyse started — stream=${streamMode} base64len=${imageBase64.length} prompt="${prompt.slice(0, 40)}"`
    );

    if (streamMode) {
      streamBuffer.current = '';
      try {
        addLog('Calling analyzeImageStream...');
        const cleanup = analyzeImageStream(imageBase64, prompt, {
          onToken: (token, done) => {
            if (!done) {
              if (streamBuffer.current.length === 0)
                addLog(`First token received: "${token.slice(0, 20)}"`);
              streamBuffer.current += token;
              setAnswer(streamBuffer.current);
            } else {
              addLog(`onToken done=true received`);
            }
          },
          onComplete: () => {
            addLog('onComplete fired');
            cleanupStream.current?.();
            cleanupStream.current = null;
            setRunning(false);
          },
          onError: (err) => {
            addLog(`onError: ${err.code} — ${err.message}`);
            cleanupStream.current?.();
            cleanupStream.current = null;
            setInferenceError(`${err.code}: ${err.message}`);
            setRunning(false);
          },
        });
        addLog(
          'analyzeImageStream returned (listeners registered, waiting for tokens...)'
        );
        cleanupStream.current = cleanup;
      } catch (e: any) {
        addLog(`analyzeImageStream threw: ${e?.message}`);
        setInferenceError(e?.message ?? 'Failed to start streaming');
        setRunning(false);
      }
    } else {
      try {
        addLog('Calling analyzeImage (non-streaming)...');
        const result = await analyzeImage(imageBase64, prompt);
        addLog(`analyzeImage done, len=${result.length}`);
        setAnswer(result);
      } catch (e: any) {
        addLog(`analyzeImage error: ${e?.message}`);
        setInferenceError(e?.message ?? 'Inference error');
      } finally {
        setRunning(false);
      }
    }
  };

  const handleStop = () => {
    cleanupStream.current?.();
    cleanupStream.current = null;
    setRunning(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const engineColor: Record<ModelStatus, string> = {
    unknown: C.textSecondary,
    not_downloaded: C.textSecondary,
    loading: C.warning,
    ready: C.success,
    error: C.danger,
  };
  const engineLabel: Record<ModelStatus, string> = {
    unknown: 'Checking…',
    not_downloaded: 'Not downloaded',
    loading: setupPhase || 'Loading…',
    ready: 'Ready',
    error: 'Error',
  };

  const canAnalyze =
    modelStatus === 'ready' && !!imageBase64 && prompt.trim().length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.content, { paddingBottom: 32 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Model selector ── */}
      <Text style={s.sectionLabel}>MODEL</Text>
      <Pressable
        style={[s.card, s.modelPickerBtn]}
        onPress={() =>
          modelStatus !== 'loading' && setShowModelPicker((v) => !v)
        }
      >
        <View style={s.modelPickerRow}>
          <Text style={s.modelPickerName}>{selectedModel.name}</Text>
          <Text style={s.modelPickerMeta}>{selectedModel.sizeGb} GB</Text>
          <Text style={s.modelPickerChevron}>
            {showModelPicker ? '▲' : '▼'}
          </Text>
        </View>
      </Pressable>

      {showModelPicker && (
        <View style={s.modelPickerList}>
          {visionModels.map((m) => {
            const isActive = m.modelId === selectedModel.modelId;
            return (
              <Pressable
                key={m.modelId}
                style={[s.modelPickerItem, isActive && s.modelPickerItemActive]}
                onPress={() => {
                  if (!isActive) {
                    setSelectedModel(m);
                    // Reset engine state so user re-initialises with new model
                    setModelStatus('not_downloaded');
                    setSetupError(null);
                    setAnswer(null);
                  }
                  setShowModelPicker(false);
                }}
              >
                <View style={s.modelPickerItemBody}>
                  <Text
                    style={[
                      s.modelPickerItemName,
                      isActive && s.modelPickerItemNameActive,
                    ]}
                  >
                    {m.name}
                  </Text>
                  <Text style={s.mutedText}>
                    {m.sizeGb} GB
                    {m.modelId.includes('gemma-3n') ? ' · 3n generation' : ''}
                    {m.modelId.includes('gemma-4') ? ' · 4th generation' : ''}
                  </Text>
                </View>
                {isActive && (
                  <View style={s.modelPickerCheck}>
                    <Text style={{ color: C.accent, fontWeight: '700' }}>
                      ✓
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ── Engine status card ── */}
      <Text style={s.sectionLabel}>ENGINE</Text>
      <View style={s.card}>
        <View style={s.row}>
          <View
            style={[s.pip, { backgroundColor: engineColor[modelStatus] }]}
          />
          <Text style={[s.statusText, { color: engineColor[modelStatus] }]}>
            {engineLabel[modelStatus]}
          </Text>
          <Text style={s.mutedText}> · {selectedModel.name} · LiteRT-LM</Text>
        </View>

        {modelStatus === 'loading' && downloadPct !== null && (
          <View style={{ marginTop: 10, gap: 4 }}>
            <View style={s.progressBg}>
              <View
                style={[s.progressFill, { width: `${downloadPct}%` as any }]}
              />
            </View>
            <Text style={s.mutedText}>{downloadPct}% · ~3.4 GB</Text>
          </View>
        )}

        {(modelStatus === 'not_downloaded' ||
          modelStatus === 'error' ||
          modelStatus === 'unknown') && (
          <Pressable
            style={[
              s.btn,
              s.btnAccent,
              { marginTop: 10 },
              modelStatus === 'loading' && s.btnDisabled,
            ]}
            onPress={handleSetup}
            disabled={modelStatus === 'loading'}
          >
            <Text style={s.btnText}>
              {modelStatus === 'error'
                ? 'Retry setup'
                : `Download & initialise (~${selectedModel.sizeGb} GB)`}
            </Text>
          </Pressable>
        )}

        {modelStatus === 'ready' && (
          <Pressable
            style={[
              s.btn,
              s.btnDanger,
              { marginTop: 10, alignSelf: 'flex-start' },
            ]}
            onPress={handleRelease}
          >
            <Text style={s.btnText}>Release engine</Text>
          </Pressable>
        )}

        {setupError && (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>⚠ {setupError}</Text>
          </View>
        )}
      </View>

      {/* ── Image picker ── */}
      <Text style={[s.sectionLabel, { marginTop: 20 }]}>IMAGE</Text>
      <Pressable style={s.imagePicker} onPress={handlePickImage}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={s.pickedImage}
            resizeMode="contain"
          />
        ) : (
          <View style={s.imagePlaceholder}>
            <Text style={s.imagePlaceholderIcon}>🖼</Text>
            <Text style={s.imagePlaceholderText}>Tap to pick an image</Text>
            <Text style={s.mutedText}>PNG · JPG · WEBP</Text>
          </View>
        )}
      </Pressable>
      {imageUri && (
        <Pressable style={s.changePhotoBtn} onPress={handlePickImage}>
          <Text style={s.linkText}>↺ Choose a different image</Text>
        </Pressable>
      )}

      {/* ── Prompt ── */}
      <Text style={[s.sectionLabel, { marginTop: 20 }]}>PROMPT</Text>

      {/* Quick chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipsScroll}
        contentContainerStyle={s.chipsContent}
      >
        {QUICK_PROMPTS.map((p) => (
          <Pressable
            key={p}
            style={[s.chip, prompt === p && s.chipActive]}
            onPress={() => setPrompt(p)}
          >
            <Text style={[s.chipText, prompt === p && s.chipTextActive]}>
              {p}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <TextInput
        style={s.textField}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="Ask anything about the image…"
        placeholderTextColor={C.textSecondary}
        multiline
        numberOfLines={3}
      />

      {/* ── Options + run ── */}
      <View style={[s.row, { marginTop: 12, justifyContent: 'space-between' }]}>
        <View style={s.row}>
          <Text style={s.switchLabel}>Streaming</Text>
          <Switch
            value={streamMode}
            onValueChange={setStreamMode}
            trackColor={{ true: C.accent, false: C.border }}
            thumbColor={streamMode ? '#fff' : C.textSecondary}
          />
        </View>

        {running ? (
          <Pressable style={[s.btn, s.btnDanger]} onPress={handleStop}>
            <Text style={s.btnText}>■ Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[s.btn, s.btnAccent, !canAnalyze && s.btnDisabled]}
            onPress={handleAnalyze}
            disabled={!canAnalyze}
          >
            <Text style={s.btnText}>Analyse ↑</Text>
          </Pressable>
        )}
      </View>

      {/* Error banner — directly below the action row so it's always visible */}
      {inferenceError && (
        <View style={[s.errorBanner, { marginTop: 8 }]}>
          <Text style={s.errorText}>⚠ {inferenceError}</Text>
        </View>
      )}

      {!imageBase64 && modelStatus === 'ready' && !inferenceError && (
        <Text style={[s.mutedText, { marginTop: 6 }]}>
          Pick an image above to enable analysis.
        </Text>
      )}

      {/* ── Answer ── */}
      {(answer !== null || running) && (
        <>
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>ANSWER</Text>
          <View style={s.answerBox}>
            {running && !answer ? (
              <View style={[s.row, { gap: 8, padding: 4 }]}>
                <ActivityIndicator size="small" color={C.accent} />
                <Text style={s.mutedText}>Analysing image…</Text>
              </View>
            ) : (
              <AICoreMarkdown streaming={running}>
                {answer ?? ''}
              </AICoreMarkdown>
            )}
          </View>
        </>
      )}

      {/* ── Debug log panel ── */}
      {debugLog.length > 0 && (
        <>
          <View
            style={[s.row, { marginTop: 20, justifyContent: 'space-between' }]}
          >
            <Text style={s.sectionLabel}>DEBUG LOG</Text>
            <Pressable onPress={() => setDebugLog([])}>
              <Text style={[s.linkText, { fontSize: 10 }]}>CLEAR</Text>
            </Pressable>
          </View>
          <View style={s.debugBox}>
            {debugLog.map((line, i) => (
              <Text key={i} style={s.debugLine}>
                {line}
              </Text>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 20, gap: 8 },

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
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  pip: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '700' },
  mutedText: { fontSize: 11, color: C.textSecondary },

  progressBg: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: C.accent, borderRadius: 2 },

  btn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  btnAccent: { backgroundColor: C.accent },
  btnDanger: { backgroundColor: C.danger },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  errorBanner: {
    backgroundColor: C.dangerDim,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: C.danger,
    marginTop: 8,
  },
  errorText: { color: '#fca5a5', fontSize: 12 },

  imagePicker: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.border,
    borderStyle: 'dashed',
    overflow: 'hidden',
    minHeight: 200,
  },
  pickedImage: {
    width: '100%',
    height: 260,
  },
  imagePlaceholder: {
    flex: 1,
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imagePlaceholderIcon: { fontSize: 40 },
  imagePlaceholderText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },

  changePhotoBtn: { marginTop: 4, alignSelf: 'center' },
  linkText: { fontSize: 12, fontWeight: '600', color: C.accentLight },

  chipsScroll: { marginBottom: 8 },
  chipsContent: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 50,
    backgroundColor: C.surfaceHigh,
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: 220,
  },
  chipActive: { borderColor: C.accent, backgroundColor: C.accentDim },
  chipText: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: { color: C.accentLight, fontWeight: '600' },

  textField: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: C.textPrimary,
    borderWidth: 1,
    borderColor: C.border,
    textAlignVertical: 'top',
    ...(Platform.OS === 'ios' ? { minHeight: 80 } : {}),
  },

  switchLabel: { fontSize: 13, color: C.textPrimary, marginRight: 6 },

  answerBox: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  answerText: {
    fontSize: 14,
    color: C.textPrimary,
    lineHeight: 22,
  },

  // ── Model picker ──
  modelPickerBtn: { padding: 14 },
  modelPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelPickerName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: C.textPrimary,
  },
  modelPickerMeta: { fontSize: 12, color: C.textSecondary },
  modelPickerChevron: { fontSize: 11, color: C.textSecondary, marginLeft: 4 },

  modelPickerList: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.accent,
    overflow: 'hidden',
    marginTop: -4,
  },
  modelPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modelPickerItemActive: { backgroundColor: C.accentDim },
  modelPickerItemBody: { flex: 1, gap: 2 },
  modelPickerItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.textPrimary,
  },
  modelPickerItemNameActive: { color: C.accentLight },
  modelPickerCheck: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  debugBox: {
    backgroundColor: '#020617',
    borderRadius: 10,
    padding: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: '#1e3a5f',
  },
  debugLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: '#7dd3fc',
    lineHeight: 16,
  },
});
