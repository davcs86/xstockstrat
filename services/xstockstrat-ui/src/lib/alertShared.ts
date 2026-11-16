/** Shared alert severity rendering — extracted from AlertStream.tsx (feature 203) for reuse
 *  across the notifications inbox and the trader bell badge. */

import type { JsonObject } from '@bufbuild/protobuf';
import type { QueryClient } from '@tanstack/react-query';
import { timestampToDate, type ProtoTimestamp } from './protoTime';

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

export interface UnreadLike {
  alertId: string;
  createdAt?: ProtoTimestamp;
}

/** Every alert read model lives under this prefix; a mark-read invalidates it. */
export const ALERTS_QUERY_KEY = ['alerts'] as const;
/** Holds the stored-unread list, not a number: the badge is the merged list's length (339). */
export const ALERT_UNREAD_COUNT_KEY = ['alerts', 'unread-count'] as const;

export async function invalidateAlertReadModels(
  queryClient: Pick<QueryClient, 'cancelQueries' | 'invalidateQueries'>,
): Promise<void> {
  // invalidateQueries reuses an in-flight fetch that has no data yet, and that fetch predates the mark.
  await queryClient.cancelQueries({ queryKey: ALERTS_QUERY_KEY });
  await queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY });
}

/** The unread list limit, the streamed-buffer cap and the drain page size. */
export const UNREAD_PAGE_SIZE = 50;

// Raising this means revisiting the notify single-connection load (feature 339 design.md § Load note).
const MAX_DRAIN_BATCHES = 20;

/** Newest first; a missing timestamp sorts first. */
function compareCreatedAt(a: UnreadLike, b: UnreadLike): number {
  if (!a.createdAt || !b.createdAt) return (a.createdAt ? 1 : 0) - (b.createdAt ? 1 : 0);
  return Number(b.createdAt.seconds) - Number(a.createdAt.seconds);
}

export function mergeUnread<T extends UnreadLike>(
  stored: T[],
  streamed: T[],
  readIds: ReadonlySet<string>,
): T[] {
  const byId = new Map<string, T>();
  for (const alert of [...stored, ...streamed]) {
    if (!readIds.has(alert.alertId) && !byId.has(alert.alertId)) byId.set(alert.alertId, alert);
  }
  return [...byId.values()].sort(compareCreatedAt);
}

export function pruneStreamed<E extends { alert: UnreadLike; seq: number }>(
  streamed: E[],
  resultIds: ReadonlySet<string>,
  fetchSeq: number,
): E[] {
  return streamed.filter((e) => resultIds.has(e.alert.alertId) || e.seq >= fetchSeq);
}

export interface DrainResult {
  markedIds: string[];
  outcome: 'done' | 'capped' | 'error';
  error?: unknown;
}

/** Marks every unread alert not newer than `cutoff` (ties included), one page per batch. */
export async function drainUnread<T extends UnreadLike>({
  list,
  mark,
  cutoff,
  maxBatches = MAX_DRAIN_BATCHES,
}: {
  list: (req: { unreadOnly: true; limit: number }) => Promise<{ alerts: T[] }>;
  mark: (req: { alertIds: string[] }) => Promise<unknown>;
  cutoff: T;
  maxBatches?: number;
}): Promise<DrainResult> {
  const markedIds: string[] = [];
  const marked = new Set<string>();
  for (let batch = 0; batch < maxBatches; batch++) {
    let page: { alerts: T[] };
    try {
      page = await list({ unreadOnly: true, limit: UNREAD_PAGE_SIZE });
    } catch (error) {
      return { markedIds, outcome: 'error', error };
    }
    const eligible = page.alerts
      .filter((a) => !marked.has(a.alertId) && compareCreatedAt(a, cutoff) >= 0)
      .map((a) => a.alertId);
    if (eligible.length > 0) {
      try {
        await mark({ alertIds: eligible });
      } catch (error) {
        return { markedIds, outcome: 'error', error };
      }
      for (const id of eligible) {
        marked.add(id);
        markedIds.push(id);
      }
    }
    if (page.alerts.length < UNREAD_PAGE_SIZE) return { markedIds, outcome: 'done' };
    if (eligible.length === 0) return { markedIds, outcome: 'capped' };
  }
  return { markedIds, outcome: 'capped' };
}
