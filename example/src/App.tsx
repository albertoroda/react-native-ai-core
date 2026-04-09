/**
 * react-native-ai-core — Demo App
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { MessageBubble } from './components/MessageBubble';
import { useAICore, type Message } from './hooks/useAICore';
import {
  buildWeeklyWorkoutPlan,
  classifySupportMessage,
} from './examples/structuredOutputExample';
import AICore, {
  type ModelCatalogEntry,
  type DownloadedModel,
} from 'react-native-ai-core';
import * as SecureStore from 'expo-secure-store';

const HF_TOKEN_KEY = 'hf_token';

// ── Design tokens ─────────────────────────────────────────────────────────────
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

type Tab = 'chat' | 'models';

// ── Main component ─────────────────────────────────────────────────────────────

export default function App() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('chat');
  const [modelPath, setModelPath] = useState('');
  const [selectedModelName, setSelectedModelName] = useState('Gemini Nano');
  const [prompt, setPrompt] = useState('');
  const [streamMode, setStreamMode] = useState(true);

  // Structured output
  const [structuredResult, setStructuredResult] = useState<string | null>(null);
  const [structuredError, setStructuredError] = useState<string | null>(null);
  const [structuredProgress, setStructuredProgress] = useState<string | null>(
    null
  );
  const [runningStructuredExample, setRunningStructuredExample] = useState<
    'support' | 'complex' | null
  >(null);
  const [showStructured, setShowStructured] = useState(false);
  const structuredAbortRef = useRef<AbortController | null>(null);

  const flatListRef = useRef<FlatList<Message>>(null);

  // Download
  const [hfToken, setHfToken] = useState('');

  // Load saved token on mount
  useEffect(() => {
    SecureStore.getItemAsync(HF_TOKEN_KEY)
      .then((saved) => {
        if (saved) setHfToken(saved);
      })
      .catch(() => {});
  }, []);

  const handleHfTokenChange = (value: string) => {
    setHfToken(value);
    if (value.trim()) {
      SecureStore.setItemAsync(HF_TOKEN_KEY, value.trim()).catch(() => {});
    } else {
      SecureStore.deleteItemAsync(HF_TOKEN_KEY).catch(() => {});
    }
  };
  const [showToken, setShowToken] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [downloadingName, setDownloadingName] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    received: number;
    total: number;
    kbps: number;
  } | null>(null);
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>(
    []
  );
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [showCustomPath, setShowCustomPath] = useState(false);

  const {
    engineStatus,
    messages,
    isStreaming,
    errorMessage,
    initialize,
    sendMessage,
    stopGeneration,
    clearMessages,
    release,
  } = useAICore(modelPath);

  useEffect(() => {
    loadDownloadedModels();
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const loadDownloadedModels = async () => {
    setLocalModelsLoading(true);
    try {
      setDownloadedModels(await AICore.getDownloadedModels());
    } catch {}
    setLocalModelsLoading(false);
  };

  const selectModel = (path: string, name: string) => {
    setModelPath(path);
    setSelectedModelName(name);
  };

  const handleInitialize = () => initialize(modelPath);

  const handleSend = async () => {
    if (!prompt.trim() || engineStatus === 'generating') return;
    const text = prompt.trim();
    setPrompt('');
    Keyboard.dismiss();
    await sendMessage(text, streamMode);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleRelease = async () => {
    await release();
    clearMessages();
  };

  const handleStop = () => {
    stopGeneration();
    structuredAbortRef.current?.abort();
  };

  const handleLoadCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setCatalog(await AICore.fetchModelCatalog());
    } catch (e: any) {
      setCatalogError(e?.message ?? 'Failed to load catalog');
    } finally {
      setCatalogLoading(false);
    }
  };

  const handleDownload = async (entry: ModelCatalogEntry) => {
    if (downloadingName) return;
    setDownloadingName(entry.name);
    setDownloadProgress(null);
    try {
      const path = await AICore.downloadModel(
        entry,
        hfToken || undefined,
        (p) => {
          setDownloadProgress({
            received: p.receivedBytes,
            total: p.totalBytes,
            kbps: Math.round(p.bytesPerSecond / 1024),
          });
        }
      );
      await loadDownloadedModels();
      selectModel(path, entry.name);
    } catch (e: any) {
      if (e?.code !== 'CANCELLED')
        setCatalogError(e?.message ?? 'Download failed');
    } finally {
      setDownloadingName(null);
      setDownloadProgress(null);
    }
  };

  const runStructuredSupportExample = async () => {
    if (engineStatus !== 'ready' || runningStructuredExample) return;
    setStructuredError(null);
    setStructuredResult(null);
    setStructuredProgress(null);
    setShowStructured(true);
    setRunningStructuredExample('support');
    const ctrl = new AbortController();
    structuredAbortRef.current = ctrl;
    try {
      const result = await classifySupportMessage(
        'The app crashes every time I try to export a PDF invoice from the billing screen.',
        ctrl.signal
      );
      setStructuredResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      if (error?.code !== 'CANCELLED' && error?.name !== 'AbortError')
        setStructuredError(error?.message ?? 'Failed');
    } finally {
      structuredAbortRef.current = null;
      setRunningStructuredExample(null);
      setStructuredProgress(null);
    }
  };

  const runStructuredComplexExample = async () => {
    if (engineStatus !== 'ready' || runningStructuredExample) return;
    setStructuredError(null);
    setStructuredResult(null);
    setStructuredProgress(null);
    setShowStructured(true);
    setRunningStructuredExample('complex');
    const ctrl = new AbortController();
    structuredAbortRef.current = ctrl;
    try {
      const result = await buildWeeklyWorkoutPlan(
        (field, done) =>
          setStructuredProgress(done ? `✓ ${field}` : `⏳ ${field}`),
        ctrl.signal
      );
      setStructuredResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      if (error?.code !== 'CANCELLED' && error?.name !== 'AbortError')
        setStructuredError(error?.message ?? 'Failed');
    } finally {
      structuredAbortRef.current = null;
      setRunningStructuredExample(null);
      setStructuredProgress(null);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const engineColor: Record<typeof engineStatus, string> = {
    idle: C.textSecondary,
    initializing: C.warning,
    ready: C.success,
    generating: C.accentLight,
    error: C.danger,
  };
  const engineLabel: Record<typeof engineStatus, string> = {
    idle: 'Not initialised',
    initializing: 'Loading…',
    ready: 'Ready',
    generating: 'Generating…',
    error: 'Error',
  };

  const canSend =
    engineStatus === 'ready' && !isStreaming && prompt.trim().length > 0;
  const canInit = engineStatus === 'idle' || engineStatus === 'error';

  // ── Models tab ─────────────────────────────────────────────────────────────

  const renderModelsTab = () => (
    <ScrollView
      style={s.tabScroll}
      contentContainerStyle={s.tabScrollInner}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.sectionLabel}>SELECT MODEL</Text>

      {/* Gemini Nano native */}
      <Pressable
        style={[s.modelCard, modelPath === '' && s.modelCardActive]}
        onPress={() => selectModel('', 'Gemini Nano')}
      >
        <View style={[s.modelIcon, { backgroundColor: '#1e1b4b' }]}>
          <Text style={s.modelIconText}>⚡</Text>
        </View>
        <View style={s.modelCardBody}>
          <Text style={s.modelCardName}>Gemini Nano</Text>
          <Text style={s.modelCardMeta}>Native AICore · Pixel 9+ NPU</Text>
        </View>
        {modelPath === '' && <View style={s.activePip} />}
      </Pressable>

      {/* Downloaded models */}
      {localModelsLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginVertical: 14 }} />
      ) : downloadedModels.length > 0 ? (
        downloadedModels.map((m) => {
          const active = modelPath === m.path;
          return (
            <Pressable
              key={m.path}
              style={[s.modelCard, active && s.modelCardActive]}
              onPress={() => selectModel(m.path, m.name)}
            >
              <View style={[s.modelIcon, { backgroundColor: C.accentDim }]}>
                <Text style={s.modelIconText}>🤖</Text>
              </View>
              <View style={s.modelCardBody}>
                <Text style={s.modelCardName}>{m.name}</Text>
                <Text style={s.modelCardMeta}>
                  {(m.sizeInBytes / 1_073_741_824).toFixed(1)} GB ·{' '}
                  {m.fileName.split('.').pop()}
                </Text>
              </View>
              {active && <View style={s.activePip} />}
            </Pressable>
          );
        })
      ) : (
        <View style={s.emptyCard}>
          <Text style={s.emptyCardText}>No local models yet</Text>
        </View>
      )}

      {/* Custom path */}
      <Pressable
        style={s.expandRow}
        onPress={() => setShowCustomPath((v) => !v)}
      >
        <Text style={s.expandRowText}>
          {showCustomPath ? '▲' : '▼'} Custom file path
        </Text>
      </Pressable>
      {showCustomPath && (
        <View style={s.expandBody}>
          <TextInput
            style={s.textField}
            value={customPath}
            onChangeText={setCustomPath}
            placeholder="/storage/emulated/0/Download/model.bin"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[s.btn, s.btnAccent, { marginTop: 8 }]}
            onPress={() => {
              if (customPath.trim())
                selectModel(
                  customPath.trim(),
                  customPath.trim().split('/').pop() ?? 'Custom'
                );
            }}
          >
            <Text style={s.btnText}>Use this path</Text>
          </Pressable>
        </View>
      )}

      {/* Engine card */}
      <Text style={[s.sectionLabel, { marginTop: 24 }]}>ENGINE</Text>
      <View style={s.card}>
        <View style={s.row}>
          <View
            style={[s.pip, { backgroundColor: engineColor[engineStatus] }]}
          />
          <Text
            style={[s.engineStatusText, { color: engineColor[engineStatus] }]}
          >
            {engineLabel[engineStatus]}
          </Text>
          <Text style={s.engineModelText} numberOfLines={1}>
            {' '}
            · {selectedModelName}
          </Text>
        </View>
        <View style={[s.row, { gap: 8, marginTop: 10 }]}>
          <Pressable
            style={[s.btn, s.btnAccent, { flex: 1 }, !canInit && s.btnDisabled]}
            onPress={handleInitialize}
            disabled={!canInit}
          >
            {engineStatus === 'initializing' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.btnText}>
                {engineStatus === 'ready' ? 'Reinitialise' : 'Initialise'}
              </Text>
            )}
          </Pressable>
          <Pressable
            style={[
              s.btn,
              s.btnDanger,
              { flex: 1 },
              engineStatus === 'idle' && s.btnDisabled,
            ]}
            onPress={handleRelease}
            disabled={engineStatus === 'idle'}
          >
            <Text style={s.btnText}>Release</Text>
          </Pressable>
        </View>
        <View
          style={[s.row, { justifyContent: 'space-between', marginTop: 10 }]}
        >
          <Text style={s.switchLabel}>Token streaming</Text>
          <Switch
            value={streamMode}
            onValueChange={setStreamMode}
            trackColor={{ true: C.accent, false: C.border }}
            thumbColor={streamMode ? '#fff' : C.textSecondary}
          />
        </View>
        {errorMessage ? (
          <View style={s.errorBanner}>
            <Text style={s.errorBannerText}>⚠ {errorMessage}</Text>
          </View>
        ) : null}
      </View>

      {/* Structured output */}
      <Text style={[s.sectionLabel, { marginTop: 24 }]}>STRUCTURED OUTPUT</Text>
      <View style={s.card}>
        <View style={[s.row, { gap: 8 }]}>
          <Pressable
            style={[
              s.btn,
              s.btnOutline,
              { flex: 1 },
              (engineStatus !== 'ready' || !!runningStructuredExample) &&
                s.btnDisabled,
            ]}
            onPress={runStructuredSupportExample}
            disabled={engineStatus !== 'ready' || !!runningStructuredExample}
          >
            <Text style={s.btnOutlineText}>
              {runningStructuredExample === 'support'
                ? 'Classifying…'
                : 'Simple JSON'}
            </Text>
          </Pressable>
          <Pressable
            style={[
              s.btn,
              s.btnOutline,
              { flex: 1 },
              (engineStatus !== 'ready' || !!runningStructuredExample) &&
                s.btnDisabled,
            ]}
            onPress={runStructuredComplexExample}
            disabled={engineStatus !== 'ready' || !!runningStructuredExample}
          >
            <Text style={s.btnOutlineText}>
              {runningStructuredExample === 'complex'
                ? 'Generating…'
                : 'Complex JSON'}
            </Text>
          </Pressable>
        </View>
        {showStructured &&
          (runningStructuredExample ? (
            <View style={[s.row, { gap: 8, marginTop: 10 }]}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={s.mutedText}>
                {structuredProgress ?? 'Running…'}
              </Text>
            </View>
          ) : structuredError ? (
            <View style={[s.errorBanner, { marginTop: 10 }]}>
              <Text style={s.errorBannerText}>{structuredError}</Text>
            </View>
          ) : structuredResult ? (
            <ScrollView style={s.codeBox} nestedScrollEnabled>
              <ScrollView horizontal nestedScrollEnabled>
                <Text style={s.code}>{structuredResult}</Text>
              </ScrollView>
            </ScrollView>
          ) : null)}
      </View>

      {/* Download */}
      <Text style={[s.sectionLabel, { marginTop: 24 }]}>DOWNLOAD FROM HUB</Text>
      <View style={s.card}>
        <View style={[s.row, { gap: 8 }]}>
          <TextInput
            style={[s.textField, { flex: 1 }]}
            value={hfToken}
            onChangeText={handleHfTokenChange}
            placeholder="HuggingFace token (hf_…)"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showToken}
          />
          <Pressable style={s.iconBtn} onPress={() => setShowToken((v) => !v)}>
            <Text style={{ fontSize: 18 }}>{showToken ? '🙈' : '👁'}</Text>
          </Pressable>
        </View>
        {catalog === null ? (
          <Pressable
            style={[
              s.btn,
              s.btnAccent,
              { marginTop: 10 },
              catalogLoading && s.btnDisabled,
            ]}
            onPress={handleLoadCatalog}
            disabled={catalogLoading}
          >
            {catalogLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={s.btnText}>Load model catalog</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={{ marginTop: 8 }}
            onPress={handleLoadCatalog}
            disabled={catalogLoading}
          >
            <Text style={s.linkText}>
              {catalogLoading ? 'Refreshing…' : '↻  Refresh catalog'}
            </Text>
          </Pressable>
        )}
      </View>
      {catalogError ? (
        <View style={s.errorBanner}>
          <Text style={s.errorBannerText}>⚠ {catalogError}</Text>
        </View>
      ) : null}

      {catalog &&
        catalog.map((entry) => {
          const isDl = downloadingName === entry.name;
          const hasIt = downloadedModels.some(
            (m) => m.name === entry.name && m.commitHash === entry.commitHash
          );
          const gb = (entry.sizeInBytes / 1_073_741_824).toFixed(1);
          const pct =
            isDl && downloadProgress && downloadProgress.total > 0
              ? Math.round(
                  (downloadProgress.received / downloadProgress.total) * 100
                )
              : 0;
          return (
            <View key={entry.name} style={s.catalogCard}>
              <View style={[s.row, { gap: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.catalogName}>{entry.name}</Text>
                  <Text style={s.mutedText}>
                    {gb} GB · {entry.modelFile.split('.').pop()}
                    {hasIt ? (
                      <Text style={{ color: C.success }}> · ✓ Downloaded</Text>
                    ) : null}
                  </Text>
                </View>
                {isDl ? (
                  <Pressable
                    style={[s.btn, s.btnDanger, { paddingHorizontal: 14 }]}
                    onPress={() => AICore.cancelDownload()}
                  >
                    <Text style={s.btnText}>Cancel</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[
                      s.btn,
                      hasIt ? s.btnOutline : s.btnAccent,
                      { paddingHorizontal: 16 },
                      !!downloadingName && s.btnDisabled,
                    ]}
                    onPress={() => handleDownload(entry)}
                    disabled={!!downloadingName}
                  >
                    <Text style={hasIt ? s.btnOutlineText : s.btnText}>
                      {hasIt ? '↓ Re-dl' : '↓'}
                    </Text>
                  </Pressable>
                )}
              </View>
              {isDl && (
                <View style={{ marginTop: 8, gap: 4 }}>
                  <View style={s.progressBg}>
                    <View
                      style={[s.progressFill, { width: `${pct}%` as any }]}
                    />
                  </View>
                  <Text style={s.mutedText}>
                    {pct}% · {downloadProgress?.kbps ?? 0} KB/s
                  </Text>
                </View>
              )}
            </View>
          );
        })}

      <View style={{ height: 32 + insets.bottom }} />
    </ScrollView>
  );

  // ── Chat tab ───────────────────────────────────────────────────────────────

  const renderChatTab = () => (
    <View style={{ flex: 1 }}>
      {/* Model bar */}
      <Pressable style={s.modelBar} onPress={() => setTab('models')}>
        <View style={[s.pip, { backgroundColor: engineColor[engineStatus] }]} />
        <Text style={s.modelBarName} numberOfLines={1}>
          {selectedModelName}
        </Text>
        <Text style={[s.modelBarStatus, { color: engineColor[engineStatus] }]}>
          {engineLabel[engineStatus]}
        </Text>
        {messages.length > 0 && (
          <Pressable onPress={clearMessages} hitSlop={12}>
            <Text style={{ fontSize: 11, color: C.danger, fontWeight: '600' }}>
              Clear
            </Text>
          </Pressable>
        )}
        <Text style={s.modelBarChevron}>›</Text>
      </Pressable>

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={s.emptyChat}>
          <Text style={s.emptyChatGlyph}>✦</Text>
          <Text style={s.emptyChatTitle}>On-device AI</Text>
          <Text style={s.emptyChatSub}>
            {engineStatus === 'idle'
              ? 'Go to Models tab to select and initialise a model.'
              : engineStatus === 'ready'
                ? 'Start chatting.'
                : engineLabel[engineStatus]}
          </Text>
          {engineStatus === 'idle' && (
            <Pressable
              style={[s.btn, s.btnAccent, { marginTop: 20 }]}
              onPress={() => setTab('models')}
            >
              <Text style={s.btnText}>Configure model →</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={s.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
      )}

      {/* Input */}
      <View
        style={[s.inputBar, { paddingBottom: Math.max(12, insets.bottom) }]}
      >
        <View style={s.inputRow}>
          <TextInput
            style={s.chatInput}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            placeholder={
              engineStatus !== 'ready'
                ? 'Initialise a model first…'
                : 'Message…'
            }
            placeholderTextColor={C.textMuted}
            onSubmitEditing={handleSend}
            blurOnSubmit={true}
          />
          {engineStatus === 'generating' || isStreaming ? (
            <Pressable style={s.sendBtn} onPress={handleStop}>
              <View style={s.stopSquare} />
            </Pressable>
          ) : (
            <Pressable
              style={[s.sendBtn, !canSend && s.sendBtnOff]}
              onPress={handleSend}
              disabled={!canSend}
            >
              <Text style={s.sendArrow}>↑</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );

  // ── Root ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={{ flex: 1 }}>
          {tab === 'chat' ? renderChatTab() : renderModelsTab()}
        </View>
      </KeyboardAvoidingView>
      <View style={[s.tabBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
        {(['chat', 'models'] as Tab[]).map((t) => (
          <Pressable key={t} style={s.tabBtn} onPress={() => setTab(t)}>
            <Text style={[s.tabIcon, tab === t && s.tabIconOn]}>
              {t === 'chat' ? '💬' : '🤖'}
            </Text>
            <Text style={[s.tabLabel, tab === t && s.tabLabelOn]}>
              {t === 'chat' ? 'Chat' : 'Models'}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: -0.5,
  },
  headerSub: { fontSize: 11, color: C.textSecondary },

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.surface,
    paddingTop: 8,
  },
  tabBtn: { flex: 1, alignItems: 'center', gap: 2 },
  tabIcon: { fontSize: 22, opacity: 0.35 },
  tabIconOn: { opacity: 1 },
  tabLabel: { fontSize: 10, fontWeight: '600', color: C.textSecondary },
  tabLabelOn: { color: C.accentLight },

  tabScroll: { flex: 1, backgroundColor: C.bg },
  tabScrollInner: { padding: 16, paddingTop: 20, gap: 8 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 2,
  },

  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    gap: 12,
  },
  modelCardActive: { borderColor: C.accent },
  modelIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelIconText: { fontSize: 20 },
  modelCardBody: { flex: 1 },
  modelCardName: { fontSize: 14, fontWeight: '700', color: C.textPrimary },
  modelCardMeta: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  activePip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.accent,
  },

  emptyCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyCardText: { color: C.textSecondary, fontSize: 13 },

  expandRow: { paddingVertical: 10 },
  expandRowText: { fontSize: 12, fontWeight: '600', color: C.accentLight },
  expandBody: { gap: 4 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 0,
  },

  row: { flexDirection: 'row', alignItems: 'center' },

  pip: { width: 8, height: 8, borderRadius: 4 },
  engineStatusText: { fontSize: 13, fontWeight: '700', marginLeft: 6 },
  engineModelText: {
    fontSize: 12,
    color: C.textSecondary,
    flex: 1,
    marginLeft: 2,
  },
  switchLabel: { fontSize: 13, color: C.textPrimary },

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
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.border,
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnOutlineText: { color: C.textPrimary, fontWeight: '600', fontSize: 13 },

  textField: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: C.textPrimary,
    borderWidth: 1,
    borderColor: C.border,
  },

  errorBanner: {
    backgroundColor: C.dangerDim,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: C.danger,
    marginTop: 8,
  },
  errorBannerText: { color: '#fca5a5', fontSize: 12 },

  mutedText: { fontSize: 11, color: C.textSecondary },
  linkText: { fontSize: 12, fontWeight: '600', color: C.accentLight },

  codeBox: {
    backgroundColor: '#020617',
    borderRadius: 8,
    padding: 10,
    maxHeight: 200,
    marginTop: 10,
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#7dd3fc',
  },

  iconBtn: {
    backgroundColor: C.surfaceHigh,
    borderRadius: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },

  catalogCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  catalogName: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
  progressBg: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: C.accent, borderRadius: 2 },

  modelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 8,
  },
  modelBarName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: C.textPrimary,
  },
  modelBarStatus: { fontSize: 11, fontWeight: '600' },
  modelBarChevron: { color: C.textSecondary, fontSize: 20, marginLeft: 2 },

  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyChatGlyph: { fontSize: 38, color: C.accentLight },
  emptyChatTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: -0.3,
  },
  emptyChatSub: {
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  messageList: { paddingTop: 8, paddingBottom: 16, flexGrow: 1 },

  inputBar: {
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  chatInput: {
    flex: 1,
    backgroundColor: C.surfaceHigh,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingTop: 10,
    fontSize: 15,
    color: C.textPrimary,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: C.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: C.accentDim },
  sendArrow: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  stopSquare: {
    width: 14,
    height: 14,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
});
