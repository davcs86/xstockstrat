# UI End-to-End (Playwright) Harness Internals

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). Load when working in `e2e/` or `playwright.config.ts`.

**SSR pre-warming.** A `setup` project (`e2e/warmup.setup.ts`) runs before the browser projects and
fetches every unique route with an authenticated cookie. This forces Node.js to load each page's
server-side module and triggers V8 JIT compilation, so the first real `page.goto()` in each test
doesn't pay the cold-start penalty. Responses are ignored — even a 500 warms the code path. When
adding a new E2E route, add it to the `ROUTES` array in `warmup.setup.ts`.

**Page reuse (future optimization).** The dominant per-test cost is full `page.goto()` → SSR →
React hydration (~50s/test in CI). Tests that share a route can eliminate repeated navigations by
grouping into `test.describe` blocks with a shared `beforeAll` that navigates once:

```typescript
// BEFORE — each test navigates independently (~50s × N)
test('shows list', async ({ page }) => {
  await addAuthCookie(page);
  await page.goto('/insights/strategies');
  // ...assertions...
});
test('filters by status', async ({ page }) => {
  await addAuthCookie(page);
  await page.goto('/insights/strategies');
  // ...assertions...
});

// AFTER — single navigation shared across tests (~50s + fast interactions)
test.describe('strategies list', () => {
  let page: Page;
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await addAuthCookie(page);
    await page.goto('/insights/strategies');
  });
  test.afterAll(async () => { await page.close(); });
  test('shows list', async () => { /* use shared page */ });
  test('filters by status', async () => { /* use shared page */ });
});
```

Tradeoff: tests within a group share page state and must run serially (`mode: 'serial'`), so
side effects from one test can leak into the next. Apply only to groups where tests on the same
route outnumber the isolation risk. Good candidates: `orders.spec.ts` (5 tests, same route),
`formulas.spec.ts` (4 tests, 2 routes), `strategy-authoring.spec.ts` (5 tests, 3 routes).

**Browser resolution.** `@playwright/test` is pinned to an **exact** version (no `^`) so the
managed browser build never drifts out from under a pre-baked sandbox. `playwright.config.ts`
adapts to environments that pre-install browsers and block downloads (`PLAYWRIGHT_BROWSERS_PATH`
with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`): it points chromium's `launchOptions.executablePath`
(NOT a top-level `use.executablePath`, which Playwright silently ignores) at the pre-installed
Chromium and drops the Firefox project when no Firefox build is present, so the suite runs on
whatever is actually installed instead of failing at launch. `global-setup.ts` runs a browser
preflight check that fails fast with a clear message if Chromium is not launchable.
When bumping the pinned version, run `pnpm exec playwright install chromium` (CI does
this in the `frontend-e2e` job) so the matching build is fetched.

