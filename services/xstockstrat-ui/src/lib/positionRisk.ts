// Shared position-risk display helpers for the Book → Exposure surface (the Exposure list and the
// single-Position page). Single source of truth (DRY guard rail).

import { PositionRiskFlag } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import type { Position } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

/** Long / Short from the signed quantity (qty < 0 is short). */
export function sideLabel(qty: number | undefined | null): string {
  return Number(qty ?? 0) < 0 ? 'Short' : 'Long';
}

/**
 * Open R = unrealized P&L expressed in units of the position's risk-at-stop (R-multiple).
 * Null when there is no stop-risk to normalize against.
 */
export function openR(p: Position): number | null {
  const r = Number(p.riskAtStop ?? 0);
  if (!r) return null;
  return Number(p.unrealizedPnl ?? 0) / r;
}

/** `+0.8R` / `-1.2R`, or `—` when Open R is undefined (no stop). */
export function fmtR(r: number | null): string {
  if (r === null) return '—';
  return `${r >= 0 ? '+' : ''}${r.toFixed(1)}R`;
}

/**
 * Exit-flag positions (Exposure → "N exit flags in queue"): a reduce/trim or a stop-near signal.
 */
export function isExitFlag(p: Position): boolean {
  return p.flag === PositionRiskFlag.REDUCE_SIGNAL || p.flag === PositionRiskFlag.STOP_NEAR;
}
