// Shared render maps for the feature-083 opportunity/readiness/risk/source-health enums.
// Single source of truth (DRY guard rail — docs/patterns/dry-guard-rail.md) and the
// exhaustive `Record<Enum,…>` maps the C-10(a/d) trap requires: adding a proto enum value
// without a map entry breaks `tsc` here (mirrors BacktestDiagnostics.tsx ACTION_LABEL).

import { Lightning, Eye, Moon, Question, Stack, type Icon } from '@phosphor-icons/react';
import { OpportunityActionTag, ConditionState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { PositionRiskFlag } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { SourceHealthStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { Badge } from '../components/ui/badge';
import type { ReadinessState } from './readinessRollup';

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
 * The shared readiness-state cue map (feature 155, FR-1). Keyed by the `readinessState()`
 * discriminant so firing/watching/quiet/no-data render an identical icon + color everywhere
 * (Watchlists panel, Opportunities desktop/mobile, "Why this fired"). `label` is a fallback — the
 * Watchlists panel overrides it with the dynamic `"N away"` text. Exhaustive over `ReadinessState`
 * (the C-10(a/d) map-completeness guard this file's header describes).
 */
export const READINESS_CUE: Record<ReadinessState, EnumRender> = {
  firing: { label: 'firing', role: 'buy', icon: Lightning },
  watching: { label: 'watching', role: 'paper', icon: Eye },
  quiet: { label: 'quiet', role: 'secondary', icon: Moon },
  nodata: { label: 'no data', role: 'secondary', icon: Question },
};

/** The shared "in queue" cue (feature 155, FR-1) — info color + a queue-stack glyph. */
export const IN_QUEUE_CUE: EnumRender = { label: 'in queue', role: 'info', icon: Stack };

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
