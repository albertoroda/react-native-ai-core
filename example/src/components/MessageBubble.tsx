/**
 * MessageBubble — Chat bubble with markdown rendering via AICoreMarkdown.
 */

import { StyleSheet, Text, View } from 'react-native';
import { AICoreMarkdown } from 'react-native-ai-core';
import type { Message } from '../hooks/useAICore';

// ── MessageBubble ─────────────────────────────────────────────────────────────

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <View style={styles.rowUser}>
        <View style={[styles.bubbleUser, message.error && styles.bubbleError]}>
          <Text style={styles.contentUser}>{message.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.rowAssistant}>
      {message.error ? (
        <View style={styles.bubbleErrorContainer}>
          <Text style={styles.contentError}>{message.content}</Text>
        </View>
      ) : (
        <AICoreMarkdown streaming={message.streaming}>
          {message.content}
        </AICoreMarkdown>
      )}
    </View>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // User message: pill alineada a la derecha
  rowUser: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  bubbleUser: {
    maxWidth: '78%',
    backgroundColor: '#6366f1',
    borderRadius: 20,
    borderBottomRightRadius: 5,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bubbleError: { backgroundColor: '#450a0a' },
  contentUser: { fontSize: 15, lineHeight: 22, color: '#ffffff' },

  // Assistant message: sin fondo, full width
  rowAssistant: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bubbleErrorContainer: {
    backgroundColor: '#450a0a',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  contentError: { fontSize: 15, lineHeight: 22, color: '#fca5a5' },
});
