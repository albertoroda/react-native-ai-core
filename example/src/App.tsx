/**
 * react-native-ai-core — Demo App
 *
 * Full usage example of the library:
 *   • Gemini Nano availability check
 *   • LLM engine initialisation
 *   • Chat with full response and token-by-token streaming
 *   • NPU resource release
 */

import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBadge } from './components/StatusBadge';
import { MessageBubble } from './components/MessageBubble';
import { useAICore, type Message } from './hooks/useAICore';
import {
  buildWeeklyWorkoutPlan,
  classifySupportMessage,
} from './examples/structuredOutputExample';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Model path. Empty string = native Gemini Nano via AICore (Pixel 8+).
 * With path = loads a local .bin file via MediaPipe (any Android 10+).
 */
const DEFAULT_MODEL_PATH = ''; // empty → native AICore

// ── Main component ───────────────────────────────────────────────────────────

export default function App() {
  const insets = useSafeAreaInsets();
  const [modelPath, setModelPath] = useState(DEFAULT_MODEL_PATH);
  const [prompt, setPrompt] = useState('');
  const [streamMode, setStreamMode] = useState(true);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [structuredResult, setStructuredResult] = useState<string | null>(null);
  const [structuredError, setStructuredError] = useState<string | null>(null);
  const [structuredProgress, setStructuredProgress] = useState<string | null>(null);
  const [runningStructuredExample, setRunningStructuredExample] = useState<
    'support' | 'complex' | null
  >(null);

  const flatListRef = useRef<FlatList<Message>>(null);

  const {
    availability,
    engineStatus,
    messages,
    isStreaming,
    errorMessage,
    initialize,
    sendMessage,
    clearMessages,
    release,
  } = useAICore(modelPath);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleInitialize = () => {
    initialize(modelPath);
  };

  const handleSend = async () => {
    if (!prompt.trim() || engineStatus === 'generating') return;
    const text = prompt.trim();
    setPrompt('');
    await sendMessage(text, streamMode);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleRelease = async () => {
    await release();
    clearMessages();
  };

  const runStructuredSupportExample = async () => {
    if (engineStatus !== 'ready' || runningStructuredExample) return;
    setConfigExpanded(true);
    setStructuredError(null);
    setStructuredResult(null);
    setStructuredProgress(null);
    setRunningStructuredExample('support');
    try {
      const result = await classifySupportMessage(
        'The app crashes every time I try to export a PDF invoice from the billing screen.'
      );
      setStructuredResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      setStructuredError(error?.message ?? 'Structured example failed');
    } finally {
      setRunningStructuredExample(null);
      setStructuredProgress(null);
    }
  };

  const runStructuredComplexExample = async () => {
    if (engineStatus !== 'ready' || runningStructuredExample) return;
    setConfigExpanded(true);
    setStructuredError(null);
    setStructuredResult(null);
    setStructuredProgress(null);
    setRunningStructuredExample('complex');
    try {
      const result = await buildWeeklyWorkoutPlan((field, done) => {
        setStructuredProgress(done ? `✓ ${field}` : `⏳ ${field}`);
      });
      setStructuredResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      setStructuredError(error?.message ?? 'Complex structured example failed');
    } finally {
      setRunningStructuredExample(null);
      setStructuredProgress(null);
    }
  };

  const engineLabel: Record<typeof engineStatus, string> = {
    idle:         'Not initialised',
    initializing: 'Initialising…',
    ready:        'Engine ready',
    generating:   'Generating…',
    error:        'Error',
  };

  const engineColor: Record<typeof engineStatus, string> = {
    idle:         '#64748b',
    initializing: '#d97706',
    ready:        '#15803d',
    generating:   '#2563eb',
    error:        '#dc2626',
  };

  const canSend =
    engineStatus === 'ready' && !isStreaming && prompt.trim().length > 0;

  const canInit =
    engineStatus === 'idle' || engineStatus === 'error';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>AI Core</Text>
          <Text style={styles.headerSub}>Gemini Nano · MediaPipe</Text>
        </View>
        <StatusBadge status={availability} />
      </View>

      {/* ── Config panel (collapsible) ───────────────────────────────────────── */}
      <Pressable
        style={styles.configToggle}
        onPress={() => setConfigExpanded((v) => !v)}
      >
        <Text style={styles.configToggleText}>
          {configExpanded ? '▲ Settings' : '▼ Settings'}
        </Text>
        <View
          style={[
            styles.engineDot,
            { backgroundColor: engineColor[engineStatus] },
          ]}
        />
        <Text style={[styles.engineLabel, { color: engineColor[engineStatus] }]}>
          {engineLabel[engineStatus]}
        </Text>
      </Pressable>

      {configExpanded && (
        <ScrollView
          style={styles.configPanel}
          contentContainerStyle={styles.configContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Inference engine selector */}
          <Text style={styles.label}>Inference engine</Text>
          <View style={styles.modeSelector}>
            <Pressable
              style={[styles.modeBtn, modelPath === '' && styles.modeBtnActive]}
              onPress={() => setModelPath('')}
            >
              <Text style={[styles.modeBtnText, modelPath === '' && styles.modeBtnTextActive]}>
                ⚡ Native AICore
              </Text>
              <Text style={[styles.modeBtnSub, modelPath === '' && styles.modeBtnTextActive]}>
                Gemini Nano (Pixel 8+)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, modelPath !== '' && styles.modeBtnActive]}
              onPress={() => setModelPath('/data/local/tmp/gemini-nano.bin')}
            >
              <Text style={[styles.modeBtnText, modelPath !== '' && styles.modeBtnTextActive]}>
                📁 Local file
              </Text>
              <Text style={[styles.modeBtnSub, modelPath !== '' && styles.modeBtnTextActive]}>
                .bin / MediaPipe
              </Text>
            </Pressable>
          </View>

          {/* Model path (only in file mode) */}
          {modelPath !== '' && (
            <>
              <Text style={styles.label}>Model path (.bin)</Text>
              <TextInput
                style={styles.pathInput}
                value={modelPath}
                onChangeText={setModelPath}
                placeholder="/data/local/tmp/gemini-nano.bin"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </>
          )}

          {/* Streaming toggle */}
          <View style={styles.switchRow}>
            <Text style={styles.label}>Streaming mode (token by token)</Text>
            <Switch
              value={streamMode}
              onValueChange={setStreamMode}
              trackColor={{ true: '#6366f1', false: '#cbd5e1' }}
              thumbColor="#fff"
            />
          </View>

          {/* Control buttons */}
          <View style={styles.controlRow}>
            <Pressable
              style={[styles.btn, styles.btnPrimary, !canInit && styles.btnDisabled]}
              onPress={handleInitialize}
              disabled={!canInit}
            >
              {engineStatus === 'initializing' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnTextLight}>Initialise</Text>
              )}
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnDanger, engineStatus === 'idle' && styles.btnDisabled]}
              onPress={handleRelease}
              disabled={engineStatus === 'idle'}
            >
              <Text style={styles.btnTextLight}>Release NPU</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnSecondary, messages.length === 0 && styles.btnDisabled]}
              onPress={clearMessages}
              disabled={messages.length === 0}
            >
              <Text style={styles.btnTextDark}>Clear</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Structured examples</Text>
          <View style={styles.controlRow}>
            <Pressable
              style={[
                styles.btn,
                styles.btnSecondary,
                (engineStatus !== 'ready' || runningStructuredExample !== null) &&
                  styles.btnDisabled,
              ]}
              onPress={runStructuredSupportExample}
              disabled={engineStatus !== 'ready' || runningStructuredExample !== null}
            >
              <Text style={styles.btnTextDark}>
                {runningStructuredExample === 'support'
                  ? 'Classifying…'
                  : 'Simple JSON'}
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.btn,
                styles.btnSecondary,
                (engineStatus !== 'ready' || runningStructuredExample !== null) &&
                  styles.btnDisabled,
              ]}
              onPress={runStructuredComplexExample}
              disabled={engineStatus !== 'ready' || runningStructuredExample !== null}
            >
              <Text style={styles.btnTextDark}>
                {runningStructuredExample === 'complex'
                  ? 'Generating…'
                  : 'Complex JSON'}
              </Text>
            </Pressable>
          </View>

          {(structuredResult || structuredError) && (
            <View style={styles.structuredBox}>
              <Text style={styles.structuredTitle}>Structured output result</Text>
          )}
        </ScrollView>
      )}

      {(runningStructuredExample !== null || structuredResult || structuredError) && (
        <View style={styles.structuredPreviewBox}>
          <Text style={styles.structuredTitle}>Structured output result</Text>
          {runningStructuredExample !== null ? (
            <>
              <Text style={styles.structuredPendingText}>
                {runningStructuredExample === 'support'
                  ? 'Classifying…'
                  : 'Generating workout…'}
              </Text>
              {structuredProgress ? (
                <Text style={styles.structuredProgressText}>{structuredProgress}</Text>
              ) : null}
            </>
          ) : structuredError ? (
            <Text style={styles.errorText}>{structuredError}</Text>
          ) : (
            <ScrollView
              style={styles.structuredCodeViewport}
              nestedScrollEnabled
            >
              <ScrollView horizontal nestedScrollEnabled>
                <Text style={styles.structuredCode}>{structuredResult}</Text>
              </ScrollView>
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Message list + Input wrapped in KAV to keep input above keyboard */}
      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* ── Lista de mensajes ─────────────────────────────────────────────── */}
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🤖</Text>
            <Text style={styles.emptyTitle}>Gemini Nano on-device</Text>
            <Text style={styles.emptySubtitle}>
              {engineStatus === 'idle'
                ? 'Configure the model path and initialise the engine to start.'
                : engineStatus === 'ready'
                ? 'Engine ready. Type a message to begin.'
                : engineLabel[engineStatus]}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: true })
            }
          />
        )}

        {/* ── Chat input ───────────────────────────────────────────────────── */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={prompt}
            onChangeText={setPrompt}
            placeholder={
              engineStatus !== 'ready'
                ? 'Initialise the engine first…'
                : streamMode
                ? 'Type a prompt (streaming)…'
                : 'Type a prompt…'
            }
            placeholderTextColor="#94a3b8"
            multiline
            editable={engineStatus === 'ready' && !isStreaming}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!canSend}
          >
            {engineStatus === 'generating' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendIcon}>↑</Text>
            )}
          </Pressable>
        </View>

        {/* Active mode indicator */}
        <View style={[styles.modeBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
          <Text style={styles.modeText}>
            {streamMode ? '⚡ Streaming enabled' : '📄 Full response'}
            {isStreaming ? '  •  Receiving tokens…' : ''}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  chatArea: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  headerLeft: { gap: 2 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 11,
    color: '#64748b',
  },

  modeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  modeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    gap: 2,
  },
  modeBtnActive: {
    borderColor: '#6366f1',
    backgroundColor: '#eef2ff',
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  modeBtnSub: {
    fontSize: 10,
    color: '#94a3b8',
  },
  modeBtnTextActive: {
    color: '#4338ca',
  },

  // Config panel
  configToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    gap: 6,
  },
  configToggleText: {
    fontSize: 13,
    color: '#475569',
    flex: 1,
  },
  engineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  engineLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  configPanel: {
    maxHeight: 280,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  configContent: {
    padding: 16,
    gap: 10,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 4,
  },
  pathInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: '#6366f1' },
  btnDanger:  { backgroundColor: '#ef4444' },
  btnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  btnDisabled: { opacity: 0.4 },
  btnTextLight: { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnTextDark:  { color: '#475569', fontWeight: '600', fontSize: 13 },

  // Error
  errorBox: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
  },
  structuredBox: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  structuredTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  structuredCode: {
    fontSize: 12,
    color: '#0f172a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  structuredCodeViewport: {
    maxHeight: 220,
  },
  structuredPreviewBox: {
    backgroundColor: '#e2e8f0',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 6,
  },
  structuredPendingText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  structuredProgressText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
  },

  // Message list
  messageList: {
    paddingVertical: 12,
    flexGrow: 1,
  },

  // Input
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 15,
    color: '#0f172a',
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#c7d2fe',
  },
  sendIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  modeBar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 2,
    backgroundColor: '#fff',
  },
  modeText: {
    fontSize: 11,
    color: '#94a3b8',
  },
});

