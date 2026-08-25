import { describe, it, expect } from 'vitest';
import { READINESS_CUE, IN_QUEUE_CUE } from './readinessCue';
import type { ReadinessState } from './readinessRollup';

// Data-only contract for the shared readiness/queue cue maps (feature 155, FR-1). The rendered
// icon + a11y/testid hooks are asserted by the Playwright e2e steps; here we prove the map data.

describe('READINESS_CUE', () => {
  const states: ReadinessState[] = ['firing', 'watching', 'quiet', 'nodata'];

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
