// Shared render maps for the feature-083 opportunity/readiness/risk/source-health enums.
// Single source of truth (DRY guard rail — docs/patterns/dry-guard-rail.md) and the
// exhaustive `Record<Enum,…>` maps the C-10(a/d) trap requires: adding a proto enum value
// without a map entry breaks `tsc` here (mirrors BacktestDiagnostics.tsx ACTION_LABEL).

// Type-only phosphor import (erased at build) — the icon *values* live in `readinessCue.ts`, kept
// out of this module because it is transitively imported by server code (traderBff → copilot), and a
// runtime phosphor import there breaks the production build (createContext in the server bundle).
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
   * Optional leading icon (feature 155). A component *reference* (a Phosphor glyph), so the map
   * stays pure data and node-env unit-testable; `EnumBadge` renders it as a direct Badge child.
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
 * Render an EnumRender entry as a Badge (role is a valid Badge variant). When the render carries an
 * `icon` (the readiness/queue cues, feature 155), it is drawn as a leading **direct child** svg —
 * never `<span>`-wrapped, which would break the Badge `[&>svg]` icon slot. The icon carries
 * `role="img"` + a distinct `aria-label` (the cue label) and an optional `data-testid` so the e2e
 * has a queryable hook (Phosphor svgs have no accessible name by default).
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
 * feature 095 — the single most-blocking traced condition leaf to surface on a compact card: the
 * first FAIL, else the first SOFT, else the first leaf; `undefined` when there are none (an
 * unattributed row → render nothing, AC-6). Never recomputes — reads the emitted leaves (AC-5).
 */
export function blockingCondition(conditions: ConditionEval[]): ConditionEval | undefined {
  return (
    conditions.find((c) => c.state === ConditionState.FAIL) ??
    conditions.find((c) => c.state === ConditionState.SOFT) ??
    conditions[0]
  );
}

/**
 * feature 095 — a compact chip for one traced condition leaf, colored by CONDITION_STATE. Renders
 * the emitted `refName fn threshold` verbatim (no client recompute, AC-5).
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
