/**
 * AICoreMarkdown
 *
 * Zero-dependency markdown renderer for AI model responses.
 * Handles the typical output of LLMs: headings, bold/italic, lists,
 * inline code, code blocks, and horizontal rules.
 *
 * @example
 * import { AICoreMarkdown } from 'react-native-ai-core';
 *
 * <AICoreMarkdown streaming={isStreaming}>{answer}</AICoreMarkdown>
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';

// ── Types ─────────────────────────────────────────────────────────────────────

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

export interface AICoreMarkdownProps {
  /** Markdown string to render */
  children: string;
  /** Show a blinking cursor — pass `true` while streaming tokens */
  streaming?: boolean;
  /** Override the base text color. Defaults to `'#e2e8f0'` (light, dark-bg). */
  textColor?: string;
  /** Override heading color. Defaults to `'#f1f5f9'`. */
  headingColor?: string;
}

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

function renderInline(
  segs: InlineSeg[],
  styles: ReturnType<typeof makeStyles>,
  cursor?: React.ReactNode
) {
  return (
    <>
      {segs.map((s, idx) => {
        switch (s.t) {
          case 'bold':
            return (
              <Text key={idx} style={styles.bold}>
                {s.v}
              </Text>
            );
          case 'italic':
            return (
              <Text key={idx} style={styles.italic}>
                {s.v}
              </Text>
            );
          case 'bold-italic':
            return (
              <Text key={idx} style={styles.boldItalic}>
                {s.v}
              </Text>
            );
          case 'code':
            return (
              <Text key={idx} style={styles.inlineCode}>
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

function StreamingCursor({ color }: { color: string }) {
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
  return (
    <Animated.Text style={{ opacity, color, fontWeight: '200' }}>
      ▌
    </Animated.Text>
  );
}

// ── Style factory ─────────────────────────────────────────────────────────────

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

function makeStyles(textColor: string, headingColor: string) {
  return StyleSheet.create({
    container: { gap: 2 },
    paragraph: { fontSize: 15, lineHeight: 23, color: textColor } as TextStyle,
    h1: {
      fontSize: 20,
      fontWeight: '700',
      color: headingColor,
      lineHeight: 28,
    } as TextStyle,
    h2: {
      fontSize: 17,
      fontWeight: '700',
      color: headingColor,
      lineHeight: 24,
    } as TextStyle,
    h3: {
      fontSize: 15,
      fontWeight: '700',
      color: headingColor,
      lineHeight: 22,
    } as TextStyle,
    bold: { fontWeight: '700' } as TextStyle,
    italic: { fontStyle: 'italic' } as TextStyle,
    boldItalic: { fontWeight: '700', fontStyle: 'italic' } as TextStyle,
    inlineCode: {
      fontFamily: mono,
      fontSize: 13,
      backgroundColor: '#1e293b',
      color: '#7dd3fc',
      borderRadius: 3,
      paddingHorizontal: 4,
    } as TextStyle,
    listItem: { flexDirection: 'row', alignItems: 'flex-start' },
    bullet: {
      fontSize: 15,
      color: '#818cf8',
      marginRight: 8,
      lineHeight: 23,
      minWidth: 18,
    } as TextStyle,
    listText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 23,
      color: textColor,
    } as TextStyle,
    codeBlock: {
      backgroundColor: '#0d1117',
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    codeText: {
      fontFamily: mono,
      fontSize: 13,
      color: textColor,
      lineHeight: 20,
    } as TextStyle,
    rule: { height: 1, backgroundColor: '#1e3148' },
    mt2: { marginTop: 2 },
    mt4: { marginTop: 4 },
    mt6: { marginTop: 6 },
    mt8: { marginTop: 8 },
  });
}

// ── AICoreMarkdown ────────────────────────────────────────────────────────────

export function AICoreMarkdown({
  children,
  streaming = false,
  textColor = '#e2e8f0',
  headingColor = '#f1f5f9',
}: AICoreMarkdownProps) {
  const s = makeStyles(textColor, headingColor);
  const blocks = parseBlocks(children);
  const cursor = streaming ? <StreamingCursor color="#818cf8" /> : null;

  if (blocks.length === 0) {
    return <Text style={s.paragraph}>{cursor}</Text>;
  }

  return (
    <View style={s.container}>
      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;
        const blockCursor = isLast ? cursor : null;

        switch (block.kind) {
          case 'h1':
            return (
              <Text key={idx} style={[s.h1, idx > 0 && s.mt8]}>
                {block.text}
                {blockCursor}
              </Text>
            );
          case 'h2':
            return (
              <Text key={idx} style={[s.h2, idx > 0 && s.mt6]}>
                {block.text}
                {blockCursor}
              </Text>
            );
          case 'h3':
            return (
              <Text key={idx} style={[s.h3, idx > 0 && s.mt4]}>
                {block.text}
                {blockCursor}
              </Text>
            );

          case 'paragraph':
            return (
              <Text key={idx} style={[s.paragraph, idx > 0 && s.mt6]}>
                {renderInline(parseInline(block.text), s, blockCursor)}
              </Text>
            );

          case 'bullet':
            return (
              <View key={idx} style={[s.listItem, idx > 0 && s.mt2]}>
                <Text style={s.bullet}>•</Text>
                <Text style={s.listText}>
                  {renderInline(parseInline(block.text), s, blockCursor)}
                </Text>
              </View>
            );

          case 'ordered':
            return (
              <View key={idx} style={[s.listItem, idx > 0 && s.mt2]}>
                <Text style={s.bullet}>{block.n}.</Text>
                <Text style={s.listText}>
                  {renderInline(parseInline(block.text), s, blockCursor)}
                </Text>
              </View>
            );

          case 'code':
            return (
              <ScrollView
                key={idx}
                horizontal
                style={[s.codeBlock, idx > 0 && s.mt6]}
                showsHorizontalScrollIndicator={false}
              >
                <Text style={s.codeText}>{block.text}</Text>
              </ScrollView>
            );

          case 'rule':
            return <View key={idx} style={[s.rule, idx > 0 && s.mt6]} />;

          default:
            return null;
        }
      })}
    </View>
  );
}
