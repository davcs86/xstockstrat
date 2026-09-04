// Shared render maps for the opportunity/readiness/risk/source-health enums (DRY). Exhaustive
// Record<Enum,…> maps — adding a proto enum value without a map entry breaks `tsc` here.

// Type-only phosphor import (erased at build) — this module is imported by server code (traderBff →
// copilot), and a runtime phosphor import there breaks the production build.
import type { Icon } from '@phosphor-icons/react';
import { OpportunityActionTag, ConditionState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { ConditionEval } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { PositionRiskFlag } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { SourceHealthStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { Badge } from '../components/ui/badge';

/** Semantic color role, aligned to the Nocturne gain/loss/paper tokens + a neutral + info. */
export type SemanticRole = 'buy' | 'sell' | 'paper' | 'secondary' | 'info';

export interface EnumRender {
  label: string;
  role: SemanticRole;
  /**
   * Optional leading icon — a component reference (Phosphor glyph), so the map stays pure data and
   * node-env unit-testable; `EnumBadge` renders it as a direct Badge child.
   */
  icon?: Icon;
}

// ENTER/ADD are gain (buy); REDUCE is loss (sell); UNSPECIFIED is neutral.
export const OPPORTUNITY_ACTION: Record<OpportunityActionTag, EnumRender> = {
  [OpportunityActionTag.UNSPECIFIED]: { label: '—', role: 'secondary' },
  [OpportunityActionTag.ENTER]: { label: 'Enter', role: 'buy' },
  [OpportunityActionTag.ADD]: { label: 'Add', role: 'buy' },
  [OpportunityActionTag.REDUCE]: { label: 'Reduce', role: 'sell' },
};

// PASS = gain, SOFT = paper, FAIL = loss, UNSPECIFIED = neutral.
export const CONDITION_STATE: Record<ConditionState, EnumRender> = {
  [ConditionState.UNSPECIFIED]: { label: '—', role: 'secondary' },
  [ConditionState.PASS]: { label: 'Pass', role: 'buy' },
  [ConditionState.SOFT]: { label: 'Soft', role: 'paper' },
  [ConditionState.FAIL]: { label: 'Fail', role: 'sell' },
};

export const POSITION_RISK_FLAG: Record<PositionRiskFlag, EnumRender> = {
  [PositionRiskFlag.UNSPECIFIED]: { label: '—', role: 'secondary' },
  [PositionRiskFlag.ADD_SIGNAL]: { label: 'Add signal', role: 'buy' },
  [PositionRiskFlag.REDUCE_SIGNAL]: { label: 'Reduce signal', role: 'sell' },
  [PositionRiskFlag.STOP_NEAR]: { label: 'Stop near', role: 'paper' },
};

// LIVE = gain, STALE = paper, DOWN = loss, UNSPECIFIED = neutral.
export const SOURCE_HEALTH: Record<SourceHealthStatus, EnumRender> = {
  [SourceHealthStatus.UNSPECIFIED]: { label: 'Unknown', role: 'secondary' },
  [SourceHealthStatus.LIVE]: { label: 'Live', role: 'buy' },
  [SourceHealthStatus.STALE]: { label: 'Stale', role: 'paper' },
  [SourceHealthStatus.DOWN]: { label: 'Down', role: 'sell' },
};

/**
 * Render an EnumRender as a Badge. Any icon is a leading direct-child svg (span-wrapping breaks the
 * Badge `[&>svg]` slot) with `role="img"` + an aria-label, since Phosphor svgs have no accessible name.
 */
export function EnumBadge({ render, testId }: { render: EnumRender; testId?: string }) {
  const Icon = render.icon;
  return (
    <Badge variant={render.role} data-testid={testId}>
      {Icon && <Icon weight="fill" role="img" aria-label={render.label} />}
      {render.label}
    </Badge>
  );
}

/**
 * The most-blocking traced condition leaf: first FAIL, else first SOFT, else first leaf; `undefined`
 * when none. Never recomputes — reads the emitted leaves.
 */
export function blockingCondition(conditions: ConditionEval[]): ConditionEval | undefined {
  return (
    conditions.find((c) => c.state === ConditionState.FAIL) ??
    conditions.find((c) => c.state === ConditionState.SOFT) ??
    conditions[0]
  );
}

/**
 * A compact chip for one traced condition leaf, colored by CONDITION_STATE. Renders the emitted
 * `refName fn threshold` verbatim (no client recompute).
 */
export function ConditionChip({ c, testId }: { c: ConditionEval; testId?: string }) {
  return (
    <Badge
      variant={CONDITION_STATE[c.state].role}
      className="font-mono text-[11px]"
      data-testid={testId}
    >
      {c.refName} {c.fn} {c.threshold}
    </Badge>
  );
}
