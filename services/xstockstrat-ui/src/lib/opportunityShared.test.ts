import { describe, it, expect } from 'vitest';
import { READINESS_CUE, IN_QUEUE_CUE } from './readinessCue';
import type { ReadinessState } from './readinessRollup';
import { UnservableReason } from '@xstockstrat/proto/common/v1/common_pb';
import { UNSERVABLE_REASON, delistedMarker, opportunityChipLabel } from './opportunityShared';

// Data-only contract for the shared readiness/queue cue maps (feature 155, FR-1). The rendered
// icon + a11y/testid hooks are asserted by the Playwright e2e steps; here we prove the map data.

describe('READINESS_CUE', () => {
  const states: ReadinessState[] = ['firing', 'watching', 'quiet', 'nodata', 'unreadable'];

  it('has exactly one entry per readiness state', () => {
    expect(Object.keys(READINESS_CUE).sort()).toEqual([...states].sort());
  });

  it('each entry carries a non-empty label, a valid role, and a defined icon', () => {
    for (const state of states) {
      const cue = READINESS_CUE[state];
      expect(cue.label.length).toBeGreaterThan(0);
      expect(['buy', 'sell', 'paper', 'secondary', 'info']).toContain(cue.role);
      expect(cue.icon).toBeDefined();
    }
  });

  it('unreadable reads "formula not readable" with its own icon, distinct from quiet and no data', () => {
    expect(READINESS_CUE.unreadable.label).toBe('formula not readable');
    expect(READINESS_CUE.unreadable.icon).toBeDefined();
    expect(READINESS_CUE.unreadable.icon).not.toBe(READINESS_CUE.quiet.icon);
    expect(READINESS_CUE.unreadable.icon).not.toBe(READINESS_CUE.nodata.icon);
  });

  it('firing is a buy cue and watching is a paper cue', () => {
    expect(READINESS_CUE.firing.role).toBe('buy');
    expect(READINESS_CUE.watching.role).toBe('paper');
  });
});

describe('IN_QUEUE_CUE', () => {
  it('is an info cue with a defined icon and label', () => {
    expect(IN_QUEUE_CUE.role).toBe('info');
    expect(IN_QUEUE_CUE.icon).toBeDefined();
    expect(IN_QUEUE_CUE.label.length).toBeGreaterThan(0);
  });
});

describe('UNSERVABLE_REASON', () => {
  const reasons = Object.values(UnservableReason).filter(
    (v): v is UnservableReason => typeof v === 'number',
  );

  it('has exactly one non-empty entry per UnservableReason value', () => {
    expect(Object.keys(UNSERVABLE_REASON).map(Number).sort()).toEqual([...reasons].sort());
    for (const reason of reasons) {
      expect(UNSERVABLE_REASON[reason].length).toBeGreaterThan(0);
    }
  });

  it('OTC and NOT_TRADABLE texts differ', () => {
    expect(UNSERVABLE_REASON[UnservableReason.OTC]).not.toBe(
      UNSERVABLE_REASON[UnservableReason.NOT_TRADABLE],
    );
  });
});

describe('delistedMarker', () => {
  it('returns null without a delisted state', () => {
    expect(delistedMarker(undefined)).toBeNull();
  });

  it('carries the reason text for NOT_TRADABLE and for OTC', () => {
    expect(
      delistedMarker({ reason: UnservableReason.NOT_TRADABLE, firstUnservableDate: '2026-11-09' })
        ?.text,
    ).toBe('not an active, tradable US equity');
    expect(
      delistedMarker({ reason: UnservableReason.OTC, firstUnservableDate: '2026-11-09' })?.text,
    ).toBe(UNSERVABLE_REASON[UnservableReason.OTC]);
  });

  it('returns the date exactly as given, never a shifted day', () => {
    for (const date of ['2026-11-09', '2026-01-01', '2026-12-31']) {
      expect(
        delistedMarker({ reason: UnservableReason.NOT_TRADABLE, firstUnservableDate: date })?.date,
      ).toBe(date);
    }
  });

  it('drops a malformed date', () => {
    for (const date of ['', '2026-11-09T00:00:00Z', '11/09/2026', '2026-1-9']) {
      const marker = delistedMarker({
        reason: UnservableReason.NOT_TRADABLE,
        firstUnservableDate: date,
      });
      expect(marker?.text).toBe('not an active, tradable US equity');
      expect(marker?.date).toBeUndefined();
    }
  });
});

describe('opportunityChipLabel', () => {
  it('uses the strategy id when present, over the source', () => {
    expect(opportunityChipLabel({ strategyId: 'dip_buyer_vol_stop', source: 'fundamentals' })).toBe(
      'dip_buyer_vol_stop',
    );
  });

  it('humanizes the source when the strategy id is empty', () => {
    expect(opportunityChipLabel({ strategyId: '', source: 'fundamentals' })).toBe('Fundamentals');
    expect(opportunityChipLabel({ strategyId: '', source: 'unusual_whales' })).toBe(
      'Unusual whales',
    );
  });

  it('falls back to "No strategy" when both are empty', () => {
    expect(opportunityChipLabel({ strategyId: '', source: '' })).toBe('No strategy');
  });
});
