import { describe, expect, it } from 'vitest';
import { isInteractiveTarget } from './data-table';

// Duck-typed stub matching the minimal interface isInteractiveTarget accepts — no jsdom needed.
// Each case asserts the guard passes the *right* selector string to .closest(), not just that it
// returns whatever the stub always returns (per design.md's row-click interaction safety section).
function stubReturning(token: string) {
  return {
    closest: (selectors: string) => (selectors.includes(token) ? ({} as Element) : null),
  };
}

describe('isInteractiveTarget', () => {
  it('returns true for a target inside an <a>', () => {
    expect(isInteractiveTarget(stubReturning('a'))).toBe(true);
  });

  it('returns true for a target inside a <button>', () => {
    expect(isInteractiveTarget(stubReturning('button'))).toBe(true);
  });

  it('returns true for a target inside a [role="button"]', () => {
    expect(isInteractiveTarget(stubReturning('[role="button"]'))).toBe(true);
  });

  it('returns true for a target inside a [data-row-click-ignore]', () => {
    expect(isInteractiveTarget(stubReturning('[data-row-click-ignore]'))).toBe(true);
  });

  it('returns false when .closest() finds no interactive ancestor', () => {
    const target = { closest: () => null };
    expect(isInteractiveTarget(target)).toBe(false);
  });
});
