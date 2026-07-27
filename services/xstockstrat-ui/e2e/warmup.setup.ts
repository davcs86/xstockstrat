import { test } from '@playwright/test';
import { signTestJwt, BASE_URL } from './helpers/auth';

/**
 * Pre-warms Next.js SSR routes before the real test suite runs.
 *
 * Each fetch triggers Node.js module loading and V8 JIT compilation for the
 * page's server-side rendering path, so the first real browser navigation
 * (page.goto) doesn't pay the cold-start penalty.
 *
 * Responses are intentionally ignored — even a 500 warms the code path.
 */

const ROUTES = [
  '/auth/login',
  '/trader',
  '/trader/orders',
  '/trader/accounts',
  '/insights',
  '/insights/strategies',
  '/insights/strategies/new',
  '/insights/strategies/strat-high-001',
  '/insights/strategies/strat-edit-001/edit',
  '/insights/screener',
  '/insights/formulas',
  '/insights/formulas/new',
  '/insights/formulas/sys-001',
  '/insights/backfills',
  '/insights/watchlists',
  '/config-ui',
  '/config-ui/sources',
  '/accounts/authorized-apps',
  '/accounts/mcp-tools',
];

test('pre-warm SSR routes', async () => {
  const token = await signTestJwt();
  const cookie = `access_token=${token}`;
  const t0 = Date.now();

  const results = await Promise.allSettled(
    ROUTES.map((route) =>
      fetch(`${BASE_URL}${route}`, {
        headers: { cookie },
        redirect: 'follow',
      }),
    ),
  );

  const ok = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`[warmup] Pre-warmed ${ok}/${ROUTES.length} SSR routes in ${Date.now() - t0}ms`);
});
