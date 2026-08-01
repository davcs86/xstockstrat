import { describe, it, expect } from 'vitest';
import { OpportunityActionTag } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import {
  copilotStreamKey,
  buildQueueSummary,
  buildConcentrationFlag,
  COPILOT_STREAM_PREFIX,
  type QueueLike,
} from './copilot';

const opp = (symbol: string, action: OpportunityActionTag, conviction: number): QueueLike => ({
  symbol,
  action,
  conviction,
});

describe('copilotStreamKey', () => {
  it('scopes the thread to the user with the copilot prefix', () => {
    const key = copilotStreamKey('user-42');
    expect(key.startsWith(COPILOT_STREAM_PREFIX)).toBe(true);
    expect(key).toBe('copilot:user-42:default');
  });
});

describe('buildQueueSummary', () => {
  it('reports empty queue copy when there are no opportunities', () => {
    expect(buildQueueSummary([])).toMatch(/empty/i);
  });

  it('tallies actions and names the highest-conviction symbol', () => {
    const summary = buildQueueSummary([
      opp('AAPL', OpportunityActionTag.ENTER, 0.9),
      opp('MSFT', OpportunityActionTag.ENTER, 0.4),
      opp('TSLA', OpportunityActionTag.REDUCE, 0.2),
    ]);
    expect(summary).toContain('3 opportunities');
    expect(summary).toContain('2 Enter');
    expect(summary).toContain('1 Reduce');
    expect(summary).toContain('AAPL'); // highest conviction
  });

  it('uses the singular form for a single opportunity', () => {
    expect(buildQueueSummary([opp('AAPL', OpportunityActionTag.ADD, 0.5)])).toContain(
      '1 opportunity',
    );
  });
});

describe('buildConcentrationFlag', () => {
  it('is ok on an empty queue', () => {
    expect(buildConcentrationFlag([]).level).toBe('ok');
  });

  it('flags a repeated single name as watch', () => {
    const flag = buildConcentrationFlag([
      opp('AAPL', OpportunityActionTag.ENTER, 0.9),
      opp('AAPL', OpportunityActionTag.ADD, 0.6),
      opp('MSFT', OpportunityActionTag.ENTER, 0.5),
    ]);
    expect(flag.level).toBe('watch');
    expect(flag.text).toContain('AAPL');
    expect(flag.text).toContain('2');
  });

  it('is ok when every symbol is distinct', () => {
    const flag = buildConcentrationFlag([
      opp('AAPL', OpportunityActionTag.ENTER, 0.9),
      opp('MSFT', OpportunityActionTag.ENTER, 0.5),
    ]);
    expect(flag.level).toBe('ok');
    expect(flag.text).toContain('2 distinct symbols');
  });
});
