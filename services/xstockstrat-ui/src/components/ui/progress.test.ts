import { describe, expect, it } from 'vitest';
import { progressIndicatorVariants } from './progress';

// Regression guard (feature 120, mirroring badge.test.ts): buy/paper/sell/muted are
// app-specific functional variants (the firing-state taxonomy) layered onto the shadcn-CLI-
// regenerated progressIndicatorVariants. A future `shadcn add progress --overwrite` that drops
// these keys must fail this test loudly rather than silently losing the state signal.
describe('progressIndicatorVariants', () => {
  it('buy variant renders the buy color token', () => {
    expect(progressIndicatorVariants({ variant: 'buy' })).toContain('bg-buy');
  });

  it('paper variant renders the paper color token', () => {
    expect(progressIndicatorVariants({ variant: 'paper' })).toContain('bg-paper');
  });

  it('sell variant renders the sell color token', () => {
    expect(progressIndicatorVariants({ variant: 'sell' })).toContain('bg-sell');
  });

  it('muted variant renders the muted color token', () => {
    expect(progressIndicatorVariants({ variant: 'muted' })).toContain('bg-muted-foreground/40');
  });
});
