/**
 * StatusBadge — Muestra visualmente el estado de disponibilidad de Gemini Nano
 */

import { StyleSheet, Text, View } from 'react-native';
import type { AvailabilityStatus } from 'react-native-ai-core';

interface Props {
  status: AvailabilityStatus | null;
}

const CONFIG: Record<
  NonNullable<AvailabilityStatus> | 'loading',
  { label: string; color: string; bg: string }
> = {
  loading: { label: 'Comprobando…', color: '#64748b', bg: '#f1f5f9' },
  AVAILABLE: { label: '✓ Disponible', color: '#15803d', bg: '#dcfce7' },
  AVAILABLE_NPU: { label: '⚡ NPU Tensor', color: '#6d28d9', bg: '#ede9fe' },
  NEED_DOWNLOAD: { label: '↓ Descargar', color: '#b45309', bg: '#fef3c7' },
  UNSUPPORTED: { label: '✕ No soportado', color: '#b91c1c', bg: '#fee2e2' },
};

export function StatusBadge({ status }: Props) {
  const cfg = CONFIG[status ?? 'loading'];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
