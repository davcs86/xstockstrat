import { describe, expect, it } from 'vitest';
import { badgeVariants } from './badge';

// Regression guard (feature 119, product-spec AC-6): buy/sell/paper are app-specific functional
// variants (order-side + paper-trading coloring) layered on top of the shadcn-CLI-regenerated
// badgeVariants. A future `shadcn add badge --overwrite` that drops these keys must fail this
// test loudly rather than silently losing the visual signal.
describe('badgeVariants', () => {
  it('buy variant renders the buy color token', () => {
    expect(badgeVariants({ variant: 'buy' })).toContain('bg-buy/20');
  });

  it('sell variant renders the sell color token', () => {
    expect(badgeVariants({ variant: 'sell' })).toContain('bg-sell/20');
  });

  it('paper variant renders the paper color token', () => {
    expect(badgeVariants({ variant: 'paper' })).toContain('bg-paper/20');
  });
});
