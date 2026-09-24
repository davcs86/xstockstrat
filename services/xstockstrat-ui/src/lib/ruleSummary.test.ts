import { describe, it, expect } from 'vitest';
import { parseRuleTree, summarizeRule, ruleHasConditions } from './ruleSummary';

describe('parseRuleTree', () => {
  it('treats an empty/blank string as an empty AND tree', () => {
    expect(parseRuleTree('')).toEqual({ op: 'AND', conditions: [] });
    expect(parseRuleTree('   ')).toEqual({ op: 'AND', conditions: [] });
  });

  it('parses a valid condition tree', () => {
    const tree = parseRuleTree(
      JSON.stringify({
        op: 'AND',
        conditions: [{ fn: 'crosses_above', lhs: 'macd', rhs: 'macd.signal' }],
      }),
    );
    expect(tree).toEqual({
      op: 'AND',
      conditions: [{ lhs: 'macd', fn: 'crosses_above', rhs: 'macd.signal' }],
    });
  });

  it('normalizes the op case and coerces a numeric rhs to a string', () => {
    const tree = parseRuleTree(
      JSON.stringify({ op: 'or', conditions: [{ fn: '>', lhs: 'rsi', rhs: 70 }] }),
    );
    expect(tree?.op).toBe('OR');
    expect(tree?.conditions[0].rhs).toBe('70');
  });

  it('tolerates the legacy cmp key and an unknown fn falls back to >', () => {
    const tree = parseRuleTree(
      JSON.stringify({ op: 'AND', conditions: [{ cmp: 'bogus', lhs: 'a', rhs: 'b' }] }),
    );
    expect(tree?.conditions[0].fn).toBe('>');
  });

  it('returns null for unparseable input or a non-tree shape', () => {
    expect(parseRuleTree('{not json')).toBeNull();
    expect(parseRuleTree(JSON.stringify({ foo: 'bar' }))).toBeNull();
  });
});

describe('summarizeRule', () => {
  it('renders a human-readable phrase per condition', () => {
    const summary = summarizeRule(
      JSON.stringify({
        op: 'OR',
        conditions: [
          { fn: '>', lhs: 'rsi', rhs: 70 },
          { fn: 'crosses_below', lhs: 'macd', rhs: 'macd.signal' },
        ],
      }),
    );
    expect(summary).toEqual({
      op: 'OR',
      parts: ['rsi is greater than 70', 'macd crosses below macd.signal'],
    });
  });

  it('summarizes an empty rule as an empty part list', () => {
    expect(summarizeRule('')).toEqual({ op: 'AND', parts: [] });
  });

  it('returns null for a non-tree shape', () => {
    expect(summarizeRule(JSON.stringify({ foo: 1 }))).toBeNull();
  });
});

describe('ruleHasConditions', () => {
  it('is true only when at least one condition exists', () => {
    expect(ruleHasConditions('')).toBe(false);
    expect(ruleHasConditions(JSON.stringify({ op: 'AND', conditions: [] }))).toBe(false);
    expect(
      ruleHasConditions(JSON.stringify({ op: 'AND', conditions: [{ fn: '>', lhs: 'a', rhs: 1 }] })),
    ).toBe(true);
  });
});
