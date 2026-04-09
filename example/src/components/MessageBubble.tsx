/**
 * MessageBubble — Chat bubble with basic markdown rendering.
 *
 * Supports:
 *   • H1 / H2 / H3 headings
 *   • Bold, italic, bold-italic
 *   • Inline code and code blocks
 *   • Ordered and unordered lists
 *   • Horizontal rules
 *   • Blinking cursor while streaming
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Message } from '../hooks/useAICore';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type InlineSeg =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'bold-italic'; v: string }
  | { t: 'code'; v: string };

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'ordered'; text: string; n: number }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

// ── Inline parser ─────────────────────────────────────────────────────────────

function parseInline(text: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  const re =
    /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`\n]+)`|__(.+?)__|_(.+?)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1] !== undefined) segs.push({ t: 'bold-italic', v: m[1] });
    else if (m[2] !== undefined) segs.push({ t: 'bold', v: m[2] });
    else if (m[3] !== undefined) segs.push({ t: 'italic', v: m[3] });
    else if (m[4] !== undefined) segs.push({ t: 'code', v: m[4] });
    else if (m[5] !== undefined) segs.push({ t: 'bold', v: m[5] });
    else if (m[6] !== undefined) segs.push({ t: 'italic', v: m[6] });
    last = re.lastIndex;
  }
  if (last < text.length) segs.push({ t: 'text', v: text.slice(last) });
  return segs;
}

// ── Block parser ──────────────────────────────────────────────────────────────

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i]!;
    const t = raw.trim();

    if (t === '') {
      i++;
      continue;
    }

    // Code block (triple backtick)
    if (t.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        code.push(lines[i]!);
        i++;
      }
      i++;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }

    // Headers
    if (t.startsWith('### ')) {
      blocks.push({ kind: 'h3', text: t.slice(4) });
      i++;
      continue;
    }
    if (t.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: t.slice(3) });
      i++;
      continue;
    }
    if (t.startsWith('# ')) {
      blocks.push({ kind: 'h1', text: t.slice(2) });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(t)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*•+] /.test(t)) {
      blocks.push({ kind: 'bullet', text: t.slice(2) });
      i++;
      continue;
    }

    // Ordered list
    const om = t.match(/^(\d+)[.)]\s+(.+)/);
    if (om) {
      blocks.push({ kind: 'ordered', text: om[2]!, n: parseInt(om[1]!, 10) });
      i++;
      continue;
    }

    // Paragraph: accumulate consecutive normal lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^#{1,3} /.test(lines[i]!.trim()) &&
      !lines[i]!.trim().startsWith('```') &&
      !/^[-*•+] /.test(lines[i]!.trim()) &&
      !/^(\d+)[.)]\s/.test(lines[i]!.trim()) &&
      !/^[-*_]{3,}$/.test(lines[i]!.trim())
    ) {
      para.push(lines[i]!);
      i++;
    }
    if (para.length > 0)
      blocks.push({ kind: 'paragraph', text: para.join('\n') });
  }

  return blocks;
}

// ── Inline renderer ───────────────────────────────────────────────────────────

function renderInline(segs: InlineSeg[], cursor?: React.ReactNode) {
  return (
    <>
      {segs.map((s, idx) => {
        switch (s.t) {
          case 'bold':
            return (
              <Text key={idx} style={md.bold}>
                {s.v}
              </Text>
            );
          case 'italic':
            return (
              <Text key={idx} style={md.italic}>
                {s.v}
              </Text>
            );
          case 'bold-italic':
            return (
              <Text key={idx} style={md.boldItalic}>
                {s.v}
              </Text>
            );
          case 'code':
            return (
              <Text key={idx} style={md.inlineCode}>
                {s.v}
              </Text>
            );
          default:
            return <Text key={idx}>{s.v}</Text>;
        }
      })}
      {cursor}
    </>
  );
}

// ── StreamingCursor ───────────────────────────────────────────────────────────

function StreamingCursor() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return <Animated.Text style={[md.cursor, { opacity }]}>▌</Animated.Text>;
}

// ── MarkdownContent ───────────────────────────────────────────────────────────

function MarkdownContent({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  const blocks = parseBlocks(content);

  if (blocks.length === 0) {
    return (
      <Text style={md.paragraph}>{streaming ? <StreamingCursor /> : null}</Text>
    );
  }

  return (
    <View style={md.container}>
      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;
        const cursor = isLast && streaming ? <StreamingCursor /> : null;

        switch (block.kind) {
          case 'h1':
            return (
              <Text key={idx} style={[md.h1, idx > 0 && md.mt8]}>
                {block.text}
                {cursor}
              </Text>
            );
          case 'h2':
            return (
              <Text key={idx} style={[md.h2, idx > 0 && md.mt6]}>
                {block.text}
                {cursor}
              </Text>
            );
          case 'h3':
            return (
              <Text key={idx} style={[md.h3, idx > 0 && md.mt4]}>
                {block.text}
                {cursor}
              </Text>
            );

          case 'paragraph':
            return (
              <Text key={idx} style={[md.paragraph, idx > 0 && md.mt6]}>
                {renderInline(parseInline(block.text), cursor)}
              </Text>
            );

          case 'bullet':
            return (
              <View key={idx} style={[md.listItem, idx > 0 && md.mt2]}>
                <Text style={md.bullet}>•</Text>
                <Text style={md.listText}>
                  {renderInline(parseInline(block.text), cursor)}
                </Text>
              </View>
            );

          case 'ordered':
            return (
              <View key={idx} style={[md.listItem, idx > 0 && md.mt2]}>
                <Text style={md.bullet}>{block.n}.</Text>
                <Text style={md.listText}>
                  {renderInline(parseInline(block.text), cursor)}
                </Text>
              </View>
            );

          case 'code':
            return (
              <ScrollView
                key={idx}
                horizontal
                style={[md.codeBlock, idx > 0 && md.mt6]}
                showsHorizontalScrollIndicator={false}
              >
                <Text style={md.codeText}>{block.text}</Text>
              </ScrollView>
            );

          case 'rule':
            return <View key={idx} style={[md.rule, idx > 0 && md.mt6]} />;

          default:
            return null;
        }
      })}
    </View>
  );
}

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
        <MarkdownContent
          content={message.content}
          streaming={message.streaming}
        />
      )}
    </View>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** Estilos de markdown (usados dentro de burbujas de asistente) */
const md = StyleSheet.create({
  container: { gap: 2 },
  paragraph: { fontSize: 15, lineHeight: 23, color: '#e2e8f0' },
  h1: { fontSize: 20, fontWeight: '700', color: '#f1f5f9', lineHeight: 28 },
  h2: { fontSize: 17, fontWeight: '700', color: '#f1f5f9', lineHeight: 24 },
  h3: { fontSize: 15, fontWeight: '700', color: '#cbd5e1', lineHeight: 22 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  boldItalic: { fontWeight: '700', fontStyle: 'italic' },
  inlineCode: {
    fontFamily: mono,
    fontSize: 13,
    backgroundColor: '#1e293b',
    color: '#7dd3fc',
    borderRadius: 3,
    paddingHorizontal: 4,
  },
  listItem: { flexDirection: 'row', alignItems: 'flex-start' },
  bullet: {
    fontSize: 15,
    color: '#818cf8',
    marginRight: 8,
    lineHeight: 23,
    minWidth: 18,
  },
  listText: { flex: 1, fontSize: 15, lineHeight: 23, color: '#e2e8f0' },
  codeBlock: {
    backgroundColor: '#0d1117',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  codeText: {
    fontFamily: mono,
    fontSize: 13,
    color: '#e2e8f0',
    lineHeight: 20,
  },
  rule: { height: 1, backgroundColor: '#1e3148' },
  cursor: { color: '#818cf8', fontWeight: '200' },
  mt2: { marginTop: 2 },
  mt4: { marginTop: 4 },
  mt6: { marginTop: 6 },
  mt8: { marginTop: 8 },
});

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
