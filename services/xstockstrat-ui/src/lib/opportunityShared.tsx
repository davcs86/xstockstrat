// Shared render maps for the feature-083 opportunity/readiness/risk/source-health enums.
// Single source of truth (DRY guard rail — docs/patterns/dry-guard-rail.md) and the
// exhaustive `Record<Enum,…>` maps the C-10(a/d) trap requires: adding a proto enum value
// without a map entry breaks `tsc` here (mirrors BacktestDiagnostics.tsx ACTION_LABEL).

import { OpportunityActionTag, ConditionState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { PositionRiskFlag } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { SourceHealthStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { Badge } from '../components/ui/badge';

/** Semantic color role, aligned to the Nocturne gain/loss/paper tokens + a neutral. */
export type SemanticRole = 'buy' | 'sell' | 'paper' | 'secondary';

export interface EnumRender {
  label: string;
  role: SemanticRole;
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

/** Render an EnumRender entry as a Badge (role is a valid Badge variant). */
export function EnumBadge({ render }: { render: EnumRender }) {
  return <Badge variant={render.role}>{render.label}</Badge>;
}
