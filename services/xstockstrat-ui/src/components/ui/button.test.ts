import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';

// Regression guard (feature 119, product-spec AC-6): buy/sell are app-specific functional
// variants (order-side coloring) layered on top of the shadcn-CLI-regenerated buttonVariants.
// A future `shadcn add button --overwrite` that drops these keys must fail this test loudly
// rather than silently losing the order-side visual signal.
describe('buttonVariants', () => {
  it('buy variant renders the buy color token', () => {
    expect(buttonVariants({ variant: 'buy' })).toContain('bg-buy');
  });

  it('sell variant renders the sell color token', () => {
    expect(buttonVariants({ variant: 'sell' })).toContain('bg-sell');
  });
});
