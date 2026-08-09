import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';

// Minimal presence test (design.md: 5 primitives with no app-specific variant get a
// minimal test) — Checkbox has no app-specific variant.
describe('Checkbox', () => {
  it('exports Checkbox', () => {
    expect(Checkbox).toBeDefined();
  });
});
