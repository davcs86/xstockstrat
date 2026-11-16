/** Shared alert severity rendering — extracted from AlertStream.tsx (feature 203) for reuse
 *  across the notifications inbox and the trader bell badge. */

import type { JsonObject } from '@bufbuild/protobuf';
import { timestampToDate, type ProtoTimestamp } from '@/lib/protoTime';

// AlertSeverity enum: 1=INFO, 2=WARNING, 3=ERROR, 4=CRITICAL
export const severityLabel: Record<number, string> = {
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
  4: 'CRITICAL',
};

export const severityVariant: Record<number, 'info' | 'warning' | 'destructive'> = {
  1: 'info',
  2: 'warning',
  3: 'destructive',
  4: 'destructive',
};

export function formatWhen(createdAt: ProtoTimestamp | undefined): string {
  return timestampToDate(createdAt)?.toLocaleString() ?? '';
}

export function contextEntries(context: JsonObject | undefined): { key: string; value: string }[] {
  return Object.entries(context ?? {}).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}
