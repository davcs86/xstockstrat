// Copilot rail — shared constants + pure, no-LLM summary helpers. Notes persist in the ledger
// append-only store (F-06: no agent DB, LLM, or new pool); these helpers only template fetched
// queue data, kept pure for the vitest unit layer.

import { OpportunityActionTag } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { OPPORTUNITY_ACTION } from './opportunityShared';

/** Ledger stream-key prefix + event type for the copilot thread. */
export const COPILOT_STREAM_PREFIX = 'copilot:';
export const COPILOT_EVENT_TYPE = 'copilot.message';
export const COPILOT_THREAD = 'default';
/** Number of MCP tools surfaced in the beta footer (read-only unless confirmed). */
export const COPILOT_MCP_TOOL_COUNT = 32;

/**
 * Per-user append-only thread key. The BFF forces this key server-side from the verified session, so
 * the browser never learns another user's id and can't write outside its own thread.
 */
export function copilotStreamKey(userId: string): string {
  return `${COPILOT_STREAM_PREFIX}${userId}:${COPILOT_THREAD}`;
}

/** Minimal structural slice of `Opportunity` the summaries need (keeps helpers proto-light). */
export interface QueueLike {
  symbol: string;
  action: OpportunityActionTag;
  conviction: number;
}

/** Templated (no-LLM) "read of the queue" — action tallies + highest-conviction name. */
export function buildQueueSummary(opps: QueueLike[]): string {
  if (opps.length === 0) {
    return 'The queue is empty — nothing has cleared its conditions right now.';
  }
  const byAction = new Map<OpportunityActionTag, number>();
  for (const o of opps) byAction.set(o.action, (byAction.get(o.action) ?? 0) + 1);
  const parts = [...byAction.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([action, n]) => `${n} ${OPPORTUNITY_ACTION[action]?.label ?? '—'}`);
  const top = [...opps].sort((a, b) => b.conviction - a.conviction)[0];
  const n = opps.length;
  return (
    `${n} opportunit${n === 1 ? 'y' : 'ies'} in the queue (${parts.join(' · ')}). ` +
    `Highest conviction: ${top.symbol}.`
  );
}

export interface ConcentrationFlag {
  level: 'ok' | 'watch';
  text: string;
}

/**
 * Client-side concentration heuristic over the queue: flags when a single symbol recurs across
 * queued signals. Queue-only — not portfolio exposure (no position-book fold-in).
 */
export function buildConcentrationFlag(opps: QueueLike[]): ConcentrationFlag {
  if (opps.length === 0) {
    return { level: 'ok', text: 'No concentration to flag — the queue is empty.' };
  }
  const bySymbol = new Map<string, number>();
  for (const o of opps) bySymbol.set(o.symbol, (bySymbol.get(o.symbol) ?? 0) + 1);
  const [topSymbol, topCount] = [...bySymbol.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCount >= 2) {
    return {
      level: 'watch',
      text: `${topSymbol} appears in ${topCount} queued signals — watch single-name concentration.`,
    };
  }
  return {
    level: 'ok',
    text: `${bySymbol.size} distinct symbol${bySymbol.size === 1 ? '' : 's'} — no single-name concentration in the queue.`,
  };
}
