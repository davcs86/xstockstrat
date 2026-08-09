import { describe, expect, it } from 'vitest';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';
import { toggleVariants } from './toggle';

// Regression guard (feature 120, mirroring button.test.ts / badge.test.ts): buy/sell are
// app-specific functional variants (order-side coloring) layered onto the shadcn-CLI-regenerated
// toggleVariants (shared by Toggle and ToggleGroupItem). A future `shadcn add toggle` that drops
// these keys must fail this test loudly rather than silently losing the order-side visual signal.
describe('ToggleGroup', () => {
  it('exports ToggleGroup and ToggleGroupItem', () => {
    expect(ToggleGroup).toBeDefined();
    expect(ToggleGroupItem).toBeDefined();
  });

  it('buy variant renders the buy color token', () => {
    expect(toggleVariants({ variant: 'buy' })).toContain('bg-buy');
  });

  it('sell variant renders the sell color token', () => {
    expect(toggleVariants({ variant: 'sell' })).toContain('bg-sell');
  });
});
