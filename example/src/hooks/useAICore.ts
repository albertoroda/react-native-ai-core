/**
 * useAICore
 *
 * Reusable hook that encapsulates the full lifecycle of react-native-ai-core:
 * availability check, initialisation, response generation (normal and
 * streaming), and resource cleanup.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AICore, {
  type AvailabilityStatus,
  type AIError,
  cancelGeneration,
} from 'react-native-ai-core';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** true while streaming tokens are still arriving */
  streaming?: boolean;
  error?: boolean;
}

export type EngineStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'generating'
  | 'error';

export interface UseAICoreReturn {
  // Estado
  availability: AvailabilityStatus | null;
  engineStatus: EngineStatus;
  messages: Message[];
  isStreaming: boolean;
  errorMessage: string | null;

  // Acciones
  initialize: (modelPath: string) => Promise<void>;
  sendMessage: (prompt: string, stream?: boolean) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
  release: () => Promise<void>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL_PATH = '/data/local/tmp/gemini-nano.bin';

export function useAICore(
  modelPath: string = DEFAULT_MODEL_PATH
): UseAICoreReturn {
  const [availability, setAvailability] = useState<AvailabilityStatus | null>(
    null
  );
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const unsubscribeStream = useRef<(() => void) | null>(null);
  const streamingMsgId = useRef<string | null>(null);

  // ── Comprobar disponibilidad al montar ──────────────────────────────────────
  useEffect(() => {
    AICore.checkAvailability()
      .then(setAvailability)
      .catch(() => setAvailability('UNSUPPORTED'));

    return () => {
      unsubscribeStream.current?.();
      AICore.release().catch(() => {});
    };
  }, []);

  // ── initialize ──────────────────────────────────────────────────────────────
  const initialize = useCallback(
    async (path: string = modelPath) => {
      setEngineStatus('initializing');
      setErrorMessage(null);
      try {
        await AICore.initialize(path);
        setEngineStatus('ready');
        const status = await AICore.checkAvailability();
        setAvailability(status);
      } catch (e: any) {
        setEngineStatus('error');
        setErrorMessage(e?.message ?? 'Unknown initialisation error');
      }
    },
    [modelPath]
  );

  // ── Helpers de mensajes ─────────────────────────────────────────────────────
  const addMessage = (msg: Omit<Message, 'id'>): string => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((prev: Message[]) => [...prev, { ...msg, id }]);
    return id;
  };

  const updateMessage = (id: string, patch: Partial<Message>) => {
    setMessages((prev: Message[]) =>
      prev.map((m: Message) => (m.id === id ? { ...m, ...patch } : m))
    );
  };

  // ── sendMessage ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (prompt: string, stream: boolean = false) => {
      if (!prompt.trim()) return;

      // Cancelar streaming anterior si lo hubiera
      unsubscribeStream.current?.();
      unsubscribeStream.current = null;

      setErrorMessage(null);
      setEngineStatus('generating');

      addMessage({ role: 'user', content: prompt.trim() });

      // ── Modo streaming ────────────────────────────────────────────────────
      if (stream) {
        setIsStreaming(true);
        const assistantId = addMessage({
          role: 'assistant',
          content: '',
          streaming: true,
        });
        streamingMsgId.current = assistantId;

        unsubscribeStream.current = AICore.generateResponseStream(prompt, {
          onToken: (token, done) => {
            setMessages((prev: Message[]) =>
              prev.map((m: Message) =>
                m.id === assistantId
                  ? { ...m, content: m.content + token, streaming: !done }
                  : m
              )
            );
            if (done) {
              setIsStreaming(false);
              setEngineStatus('ready');
              streamingMsgId.current = null;
            }
          },
          onComplete: () => {
            updateMessage(assistantId, { streaming: false });
            setIsStreaming(false);
            setEngineStatus('ready');
            streamingMsgId.current = null;
          },
          onError: (err: AIError) => {
            updateMessage(assistantId, {
              content: `[Error: ${err.message}]`,
              streaming: false,
              error: true,
            });
            setIsStreaming(false);
            setEngineStatus('ready');
            setErrorMessage(err.message);
            streamingMsgId.current = null;
          },
        });

        return;
      }

      // ── Modo completo ─────────────────────────────────────────────────────
      try {
        const response = await AICore.generateResponse(prompt);
        addMessage({ role: 'assistant', content: response });
        setEngineStatus('ready');
      } catch (e: any) {
        if (e?.code === 'CANCELLED') {
          setEngineStatus('ready');
          return;
        }
        const msg = e?.message ?? 'Failed to generate response';
        addMessage({ role: 'assistant', content: `[Error: ${msg}]`, error: true });
        setEngineStatus('ready');
        setErrorMessage(msg);
      }
    },
    []
  );

  // ── stopGeneration ──────────────────────────────────────────────────────────
  const stopGeneration = useCallback(() => {
    cancelGeneration().catch(() => {});
  }, []);

  // ── clearMessages ───────────────────────────────────────────────────────────
  const clearMessages = useCallback(() => {
    unsubscribeStream.current?.();
    unsubscribeStream.current = null;
    setMessages([]);
    setIsStreaming(false);
    setErrorMessage(null);
    AICore.resetConversation().catch(() => {});
  }, []);

  // ── release ─────────────────────────────────────────────────────────────────
  const release = useCallback(async () => {
    unsubscribeStream.current?.();
    unsubscribeStream.current = null;
    setIsStreaming(false);
    await AICore.release();
    setEngineStatus('idle');
    setErrorMessage(null);
  }, []);

  return {
    availability,
    engineStatus,
    messages,
    isStreaming,
    errorMessage,
    initialize,
    sendMessage,
    stopGeneration,
    clearMessages,
    release,
  };
}
