import { describe, expect, it } from 'vitest';
import { alertVariants } from './alert';

// Regression guard (feature 120, mirroring badge.test.ts): warning is an app-specific
// functional variant (the watch/concentration-flag tone) layered onto the shadcn-CLI-regenerated
// alertVariants. A future `shadcn add alert --overwrite` that drops this key must fail this test
// loudly rather than silently losing the tone.
describe('alertVariants', () => {
  it('warning variant renders the watch-tone color tokens', () => {
    expect(alertVariants({ variant: 'warning' })).toContain('bg-yellow-500/5');
  });
});
