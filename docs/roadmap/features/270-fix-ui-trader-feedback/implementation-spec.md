# Implementation Spec: fix-ui-trader-feedback

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/270-fix-ui-trader-feedback/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/fix-ui-trader-feedback`

---

## Execution Summary

The fix is UI-only, in `services/xstockstrat-ui`. It follows design.md § Chosen Approach and its build order:
D-45 → D-64 (per-call handlers, then the export, then the global fallback) → D-17 → D-11 freshness → D-11
reconnect. Each `service` step has a `test` step right after it, and both carry red-green TDD (P-06). The
riskiest step, the stream reconnect and its e2e mock mechanics, lands last. It has no proto, migration,
config-key, env-var, port or backend change (recon.md § Dependencies). Analysis and trading are read-only:

- D-45 relies on the existing `strategy_id == strategy_id_ref` fingerprint gate
  (`services/xstockstrat-analysis/app/handlers/servicer.py:862-870`).
- D-17 relies on `resolveTradingMode` (`services/xstockstrat-trading/internal/service/trading.go:3573-3582`).
- No reconnect or other touched call opens a new outbound channel. All of them reuse `tradingClient`,
  `notifyClient` and `analysisClient` (`src/lib/browserClients/*.ts`, built on `makeBrowserTransport`). So
  `x-trace-id` keeps flowing through `src/middleware.ts` and the BFF. This follows the operator's 2026-10-21
  standing trace decision, with no C-03 waiver.

**Consumer surfaces (C-14).**

- `/trader`:
  - `/trader/orders` (Steps 11, 13): freshness, plus a disconnect indicator with reconnect.
  - The header `AlertStream` on every trader page (Step 13).
  - Dashboard, orders, positions, `positions/[symbol]` and portfolio (Step 9): no Paper default, and
    UNSPECIFIED is sent.
  - `positions/[symbol]` (Step 1): the backtest request shape.
  - Portfolio (Step 5): an error when the export fails.
  - The global fallback in the trader provider (Step 7).
- `/insights`:
  - Opportunities and signal-sources (Step 3).
  - The global fallback in the shared provider (Step 7).
  - `strategies/[id]` history now includes symbol-page runs, through the unchanged analysis read path (Step 1).
- The dashboard `OrderBook` (`src/components/trader/OrderBook.tsx:18-20`) reads `useOrders` only. It never
  consumes `useOrderUpdates`; `OrdersTable` is the stream's only consumer (`src/app/trader/orders/page.tsx:55`).
  So FR-1/FR-2 reach the dashboard only through Step 9's mode fix. This is a recorded finding, not an
  omitted surface.

No new routes are added, so no `PLATFORM_SUBNAV` change is needed (C-10(a)).

**Scenario coverage (C-15):**

| Scenario | Covered by |
|---|---|
| AC-1 | Step 12 (Vitest `pickFresherOrder`), Step 14 (e2e render) |
| AC-2 | Step 14 |
| AC-3 | Step 10 |
| AC-4 | Step 2 |
| AC-5 | Step 4 |
| AC-6 | Step 4 |
| AC-7 | Step 6 |
| AC-8 | Step 12 |
| AC-9 | Step 14 |
| AC-10 | Step 8 |
| AC-11 | Step 6 |
| AC-12 | Step 10 |

**Business rules (C-16).** No step changes an existing rule. Steps 9 and 10 preserve these guards:

- `@AC-10 @FR-5 @feature-095`: a known mode still maps to LIVE/PAPER.
- `@AC-5 @FR-5 @feature-202`: enums stay NAME-strings on the wire.
- The feature-110 auto-size routing: OrderForm's qty and sizing code is untouched.
- The feature-159 offline-account rules.

Step 13 preserves `@AC-6 @FR-5 @FR-6 @feature-203`: the bell-badge `listAlerts` effect stays mount-only. At
integration, `/sdd-execute` promotes AC-1..AC-12 into `services/xstockstrat-ui/acceptance/`.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 4 covers Step 3, Step 6 covers Step 5, Step 8 covers Step 7,
  Step 10 covers Step 9, Step 12 covers Step 11, and Step 14 covers Step 13. Each test step is written first
  and run RED against the pre-implementation tree (P-06).
- Step 7 requires Step 3. The per-call `onError` handlers on `act` and `handleToggle` must land before
  `useSetOpportunityAction` and `useManageSignalSource` carry `meta.errorHandled` (design.md: flagging a hook
  without its per-call handler was rejected because it silences AC-6).
- Step 7 requires Step 3's `src/lib/errMessage.ts`. `MutationErrorFallback` formats with it.
- Step 13 requires Step 11. Both edit `src/components/trader/OrdersTable.tsx`: Step 11 changes the merge at
  `:65-68`, and Step 13 changes the `useOrderUpdates` return shape consumed at `:59`.
- Step 13 requires Step 3's `src/lib/errMessage.ts`. The terminal indicator text formats the error with it.
- **Rebase-only overlaps** (sdd-review overlap scan; no config, proto or migration collision):
  - `src/app/trader/positions/[symbol]/page.tsx` (Steps 1, 9) is also edited by 215-block-fundamentals-strategy-on-etf
    (in-progress). 245-fix-screener-symbol-isolation only cites it as evidence; its files list does not modify it.
  - `src/app/insights/opportunities/page.tsx` (Step 3) is also edited by 215. 246-fix-fundsignal-neutral-score
    names it only in prose (low risk).
  - `e2e/trader/position-detail.spec.ts` (Step 2) is also edited by 215 and 245 (implementation-ready).
  - `e2e/insights/opportunities.spec.ts` (Step 4) is also edited by 215.
  - `e2e/mock-backend.ts` (Step 14) is also edited by 215.
  - `e2e/fixtures/INVENTORY.md` (Step 14) is also edited by 215, 245 and 249-fix-ibkr-request-signing
    (implementation-ready). Adjacent row edits conflict, so re-read the catalog after rebase.
  - Whichever lands second rebases; 215 is in-progress, so this feature most likely rebases after it. This
    feature does not edit `src/lib/traderBff.ts`, so it does not overlap with 263-fix-edge-owner-scope.

---

### Step 1 — service: D-45 symbol-page backtest sends `strategyId` with `strategyIdRef`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `grep -n "strategyIdRef: strategyId" 'src/app/trader/positions/[symbol]/page.tsx'` finds line 1151:
  - The call is `runBacktest({ strategyIdRef: strategyId, symbols: [symbol], initialCapital: 100000, range: … })`
    (`:1150-1155`).
  - Its `onSuccess` invalidates `['analysis-backtests', strategyId]` (`:1156-1159`).
  - `runBacktest` comes from `useRunBacktest()` at `:1109`.
- The reference runner is `src/app/insights/strategies/[id]/page.tsx:99-104`. It sends `strategyId: id`
  followed by `strategyIdRef: id`.
- Proto: `RunBacktestRequest` has `string strategy_id = 1;` and `string strategy_id_ref = 6;`
  (`packages/proto/analysis/v1/analysis.proto`, `grep -n "message RunBacktestRequest" -A12`).
- The analysis fingerprint gate requires `request.strategy_id == request.strategy_id_ref`
  (`services/xstockstrat-analysis/app/handlers/servicer.py:862-870`, recon.md).
- The run writes are keyed on `request.strategy_id` (`servicer.py:1268-1322`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In the `runBacktest(` request object at `[symbol]/page.tsx:1150`, add `strategyId: strategyId,` on the line
   before `strategyIdRef: strategyId,` (`:1151`). This mirrors the reference runner's pair at
   `insights/strategies/[id]/page.tsx:101-103`.
2. Change nothing else. `onSuccess`, the inline error at `:1141` and `:1187`, and the history filter at `:1111-1114`
   all stay as they are.
3. Analysis is unchanged (NC-D deferred by operator decision; FR-4's floor is this one-liner).
4. Trading-domain notes: the broker, order types and fill handling are unaffected by this step.

**Verification**:
```bash
grep -n "strategyId: strategyId," 'services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx'   # one hit, just above strategyIdRef
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
```

---

### Step 2 — test: AC-4 symbol-page RunBacktest carries both ids, and the run reaches history

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `e2e/trader/position-detail.spec.ts:688` already opens `/trader/positions/AMZN?strategy=strat-live-001`
  and (`:693`) waits for `getByRole('main').getByTestId('run-backtest')`, using a 30 s timeout during hydration.
- `analysisClient` uses `makeBrowserTransport('/insights/api')` (`src/lib/browserClients/analysisClient.ts:5`).
  So a `page.route('**/xstockstrat.analysis.v1.AnalysisService/RunBacktest', …)` glob intercepts the call.
  The same glob style is used at `e2e/trader/orders.spec.ts:99`.
- Fixture: `STRATEGY_DEF_LIVE` (`strat-live-001`, `e2e/fixtures/strategies.ts`, INVENTORY.md row "Strategy
  definitions"). The mock `runBacktest` is at `e2e/mock-backend.ts:977`.
- The history half of AC-4 is already pinned server-side by
  `services/xstockstrat-analysis/tests/test_analysis_servicer.py::TestRunBacktestCells::test_registered_own_run_stamps_fingerprint`
  (`:2044`, in `TestRunBacktestCells` at `:1991`; equal ids → fingerprinted). Its negative pair
  `test_id_mismatch_stamps_none` is at `:2075`.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. Add `test('@AC-4 symbol-page RunBacktest sends strategyId and strategyIdRef', …)` to
   `position-detail.spec.ts`:
   - Call `addAuthCookie(page)` from `e2e/helpers/auth.ts`.
   - Register a `page.route` on `**/xstockstrat.analysis.v1.AnalysisService/RunBacktest` that captures
     `route.request().postDataJSON()` and then `route.continue()`s to the mock.
   - Go to `/trader/positions/AMZN?strategy=strat-live-001` and click `getByRole('main').getByTestId('run-backtest')`.
   - Assert with `expect.poll` that the captured body has `strategyId === 'strat-live-001'` and
     `strategyIdRef === 'strat-live-001'`.
   - RED on the pre-fix tree: `strategyId` is absent.
2. C-12: the strategy id comes from the `STRATEGY_DEF_LIVE` fixture (import it; no inline literal). The
   captured request body is a scenario one-off, so it is exempt.
3. Do not edit analysis. The "appears in history" clause is covered by the existing analysis fingerprint test,
   which the verification re-runs. No new analysis test is needed (C-13: no new literal).
4. Coverage: none applies. The step adds Playwright e2e only, and the Vitest threshold covers `src/lib/**`,
   which this step does not touch. The re-run analysis tests are existing tests, not new coverage.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec playwright test e2e/trader/position-detail.spec.ts -g "@AC-4"
grep -n "from '../fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/trader/position-detail.spec.ts
cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py -k "stamps_fingerprint or id_mismatch_stamps_none" -q
```

---

### Step 3 — service: D-64 per-call error handlers on opportunities and signal-sources, plus the `errMessage` hoist

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/errMessage.ts` — create
- `services/xstockstrat-ui/src/app/insights/signal-sources/page.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- There are two identical local copies of
  `function errMessage(err: unknown): string { return err instanceof ConnectError ? err.rawMessage : (err as Error).message; }`:
  - `src/app/insights/signal-sources/page.tsx:137-139`.
  - `src/app/config-ui/[namespace]/NamespaceEditor.tsx:24-26`.
  - Opportunities becomes the third consumer, so DRY calls for the hoist (design.md).
- `signal-sources/page.tsx`:
  - `handleToggle` (`:254-263`) calls `manageMutate({ source: { slug: src.slug }, operation: … })` with no callbacks.
  - Its siblings pass per-call `onError`: `:226` (`setWeightError`), `:296` and `:332` (`setSaveError`).
  - **Finding:** `saveError` renders only at `:759`, inside the `{editingSlug !== null && (` edit card (`:548`).
    A toggle failure written to `saveError` would therefore be invisible while the form is closed.
  - The page-level `QueryStateMessages` sits at `:523-528`.
- `opportunities/page.tsx`:
  - `const setAction = useSetOpportunityAction();` is at `:122`.
  - `act` (`:155-156`) is `setAction.mutate({ opportunityKey: o.opportunityKey, action })` with no `onError`.
  - `useState` is already imported (`:2`).
- Error primitive (C-17): `src/components/shared/CardNotice.tsx:5-23`. `variant="error"` sets `role="alert"` and
  `text-destructive` (`docs/patterns/ui-ux-governance.md` §4).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/lib/errMessage.ts`. It exports `errMessage(err: unknown): string` with the exact body above, and
   imports `ConnectError` from `@connectrpc/connect`.
2. In `signal-sources/page.tsx` and `NamespaceEditor.tsx`:
   - Delete the local `errMessage` and add `import { errMessage } from '@/lib/errMessage';`.
   - Remove the `ConnectError` import only if nothing else in the file uses it.
3. `signal-sources/page.tsx`:
   - Add `const [toggleError, setToggleError] = useState<string | null>(null);` next to `saveError` (`:197`).
   - Change `handleToggle`'s call to:
     ```ts
     manageMutate(req, {
       onSuccess: () => setToggleError(null),
       onError: (e) => setToggleError(errMessage(e)),
     })
     ```
   - Render `{toggleError && <CardNotice variant="error">{toggleError}</CardNotice>}` directly after the
     `QueryStateMessages` block (`:523-528`), and import `CardNotice` from `@/components/shared/CardNotice`.
   - This is a dedicated state, not the `saveError` the design suggested, because `saveError` is invisible
     outside the edit card (finding above). The per-call `onError` + `errMessage` + `useState` pattern is the
     same one the page already uses.
4. `opportunities/page.tsx`:
   - Add `const [actionError, setActionError] = useState<string | null>(null);`.
   - Change `act` to:
     ```ts
     setAction.mutate(
       { opportunityKey: o.opportunityKey, action },
       { onSuccess: () => setActionError(null), onError: (e) => setActionError(errMessage(e)) },
     )
     ```
   - Render `{actionError && <CardNotice variant="error">{actionError}</CardNotice>}` once, above the opportunity
     list, so the desktop and mobile layouts share it.
5. Do **not** add `meta.errorHandled` here. Step 7 flags these hooks only after these handlers exist.

**Verification**:
```bash
grep -rn "function errMessage" services/xstockstrat-ui/src   # exactly one hit: src/lib/errMessage.ts
grep -n "setToggleError\|setActionError" services/xstockstrat-ui/src/app/insights/signal-sources/page.tsx services/xstockstrat-ui/src/app/insights/opportunities/page.tsx
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
```

---

### Step 4 — test: AC-5 and AC-6 failed opportunity action and failed source toggle show an error

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/errMessage.test.ts` — create
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Opportunities: `e2e/insights/opportunities.spec.ts:43-47` already has the per-page `page.route` pattern on
  `**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities` and SetOpportunityAction (`insights.md:1160`).
  Fixture: `OPPORTUNITIES` (`e2e/fixtures/opportunities.ts`).
- Signal sources:
  - `e2e/insights/signal-sources.spec.ts:22-23` defines
    `MANAGE_SOURCE_BFF = '/insights/api/xstockstrat.ingest.v1.IngestService/ManageSignalSource'` and `isManage`.
  - Fixtures: `SIGNAL_SOURCE_WEIGHTED` / `SIGNAL_SOURCE_NEUTRAL` (`e2e/fixtures/signalSources.ts`).
  - The toggle is wired through `onSelect: () => handleToggle(src)` (`signal-sources/page.tsx:457`).
- Connect unary error over JSON is HTTP non-2xx with `{"code":"unavailable","message":…}`. Precedent:
  `e2e/trader/order-form.spec.ts:124-140`, a failed PlaceOrder.
- Vitest runs in the node environment, includes `src/**/*.test.ts`, and measures coverage over `src/lib/**`
  (`vitest.config.ts`).

**TDD**: `red-green required`

**Covers**: `AC-5, AC-6`

**Instructions**:
1. `src/lib/errMessage.test.ts` checks two cases:
   - `errMessage(new ConnectError('boom', Code.Unavailable))` returns `'boom'` (the raw message).
   - `errMessage(new Error('x'))` returns `'x'`.
2. `opportunities.spec.ts` gets `test('@AC-5 a failed Snooze shows an error', …)`:
   - Route `SetOpportunityAction` to `route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'opportunity action unavailable' }) })`.
   - Click "Snooze" on the first `OPPORTUNITIES` row.
   - Assert `page.getByRole('alert').filter({ hasText: 'opportunity action unavailable' })` is visible. Scope by
     text: the Step 7 global fallback or another inline notice may also render a `role="alert"`, and a bare
     locator then breaks Playwright strict mode.
3. `signal-sources.spec.ts` gets `test('@AC-6 a failed deactivate shows an error', …)`:
   - Route `MANAGE_SOURCE_BFF` with the same 503 body (`'deactivate unavailable'`).
   - Deactivate `SIGNAL_SOURCE_WEIGHTED` through its row action.
   - Assert `page.getByRole('alert').filter({ hasText: 'deactivate unavailable' })` is visible while the edit
     form is closed.
4. C-12: rows come from the fixtures above. The error payloads are inline scenario one-offs, which is exempt.
5. Coverage: `test:coverage` must stay at or above the Vitest 40% lines/functions/statements threshold over
   `src/lib/**` (`vitest.config.ts`). The e2e specs carry no coverage threshold.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/opportunities.spec.ts e2e/insights/signal-sources.spec.ts -g "@AC-5|@AC-6"
grep -n "from '../fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/opportunities.spec.ts services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts
```

---

### Step 5 — service: D-64 ledger export shows an error on a non-OK response or a rejected request

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `onExportEvents` (`portfolio/page.tsx:106-122`) does
  `const res = await fetch('/trader/api/ledger/export?…'); if (!res.ok) return;`.
  - It has no try/catch, so a rejected `fetch` becomes an unhandled rejection (AC-11).
  - It is bound by `<Button variant="outline" size="sm" onClick={onExportEvents}>` at `:137`.
- `CardNotice` is already imported (`:10`) and used as `<CardNotice variant="error">Portfolio unavailable</CardNotice>`
  at `:147`.
- The `react` import at `:2` is `import { useMemo } from 'react';`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `useState` to the `react` import, then add `const [exportError, setExportError] = useState<string | null>(null);`.
2. Wrap the `onExportEvents` body in `try { … } catch (e) { setExportError(\`Export failed: ${(e as Error).message}\`); }`:
   - Call `setExportError(null)` at the start of the body.
   - Replace `if (!res.ok) return;` with
     `if (!res.ok) { setExportError(\`Export failed (HTTP ${res.status})\`); return; }`.
   - The success path (blob → anchor download) is unchanged (PRESERVE `@feature-021` AC-1/2/7/9).
3. Render `{exportError && <CardNotice variant="error">{exportError}</CardNotice>}` next to the existing
   `:146-147` notices.

**Verification**:
```bash
grep -n "setExportError" services/xstockstrat-ui/src/app/trader/portfolio/page.tsx
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
```

---

### Step 6 — test: AC-7 and AC-11 failed and rejected ledger export show an error with no unhandled rejection

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/ledger-export.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `e2e/trader/ledger-export.spec.ts:110` is the existing `AC-9` Book/Portfolio download test on `/trader/portfolio`.
  It is the success path, kept.
- Fixtures: `LEDGER_EXPORT_EVENTS` (`e2e/fixtures/ledgerEvents.ts`, INVENTORY.md row "Ledger export events").

**TDD**: `red-green required`

**Covers**: `AC-7, AC-11`

**Instructions**:
1. Add two tests, each collecting `page.on('pageerror', …)` into an array and asserting it ends empty (the
   "no unhandled promise rejection" clause):
   - **`@AC-7`:** route `**/trader/api/ledger/export**` → `route.fulfill({ status: 500, body: 'boom' })`. Click
     the export button. Expect `getByRole('alert').filter({ hasText: 'Export failed (HTTP 500)' })` to be visible.
   - **`@AC-11`:** route the same glob → `route.abort('failed')`. Click. Expect
     `getByRole('alert').filter({ hasText: 'Export failed' })` to be visible.
   - Scope the alert locators by text, as in Step 4, so another `role="alert"` on the page cannot trip strict mode.
2. RED on the pre-fix tree:
   - AC-7 shows no alert.
   - AC-11 shows no alert and records a pageerror for the unhandled rejection.
3. Coverage: none applies. The step adds Playwright e2e only, and `portfolio/page.tsx` sits outside the Vitest
   `src/lib/**` coverage scope.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec playwright test e2e/trader/ledger-export.spec.ts
```

---

### Step 7 — service: D-64 global mutation error fallback (MutationCache + single-slot store + meta-only opt-out)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/mutationErrorStore.ts` — create
- `services/xstockstrat-ui/src/lib/queryClient.ts` — modify
- `services/xstockstrat-ui/src/components/shared/MutationErrorFallback.tsx` — create
- `services/xstockstrat-ui/src/app/trader/providers.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/QueryProviders.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useInvalidatingMutation.ts` — modify
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSourceMutations.ts` — modify
- `services/xstockstrat-ui/src/hooks/useBacktest.ts` — modify
- `services/xstockstrat-ui/src/hooks/useScreenSymbols.ts` — modify
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSetConfig.ts` — modify
- `services/xstockstrat-ui/src/hooks/useLiveStrategies.ts` — modify
- `services/xstockstrat-ui/src/hooks/usePlaceOrder.ts` — modify
- `services/xstockstrat-ui/src/hooks/useReplaceOrder.ts` — modify
- `services/xstockstrat-ui/src/hooks/useConfirmOrder.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety

**Codebase Evidence**:
- `createQueryClient()` (`src/lib/queryClient.ts:11-17`) builds `new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } })`.
  It has no `mutations` options and no `MutationCache`. Its call sites are `src/app/trader/providers.tsx:9` and
  `src/components/shared/QueryProviders.tsx:12`, and each wraps children in `QueryClientProvider` +
  `QueryNormalizerProvider`. QueryProviders is re-exported by `src/app/{insights,config-ui,accounts}/providers.tsx`.
- `useInvalidatingMutation` (`src/hooks/useInvalidatingMutation.ts:14-31`):
  - Its options parameter at `:17` is `options?: { mutationKey?: QueryKey }`.
  - It passes `mutationKey: options?.mutationKey` at `:22` and no `meta`.
- These hooks are built on the factory (they need the passthrough):
  - `useSetOpportunityAction` (`src/hooks/useOpportunities.ts:65-66`).
  - `useManageSignalSource` (`src/app/config-ui/hooks/useSignalSourceMutations.ts:10-11`).
  - `usePlaceOrder` (`src/hooks/usePlaceOrder.ts:7-12`).
  - `useReplaceOrder` (`src/hooks/useReplaceOrder.ts:7-8`).
  - `useConfirmOrder` (`src/hooks/useConfirmOrder.ts:8-9`).
- No-op `onError` (`if (err instanceof ConnectError) return err; return err;`) appears in three hooks:
  - `src/hooks/useBacktest.ts:12-15` (`useRunBacktest`).
  - `src/hooks/useScreenSymbols.ts:13-16`.
  - `src/app/config-ui/hooks/useSetConfig.ts:15-18`. This third copy was found by `grep -rn "return err;" src`;
    the design named only the first two.
- `useSetStrategyLive` (`src/hooks/useLiveStrategies.ts:13-20`) is a plain `useMutation` with no `onError`.
- No `meta:` exists in any hook today (`grep -rn "meta:" src/hooks src/app/config-ui/hooks` finds nothing).
- `mutateAsync` has zero sites in `src` (design.md), so only `mutate()` is in scope.
- Primitives and constraints:
  - `Alert` with `variant: { destructive }` and `AlertDescription` (`src/components/ui/alert.tsx:6-25,77`).
  - There is no toast library, by design (`docs/patterns/ui-ux-governance.md` §4, backlog item f).
  - The header is `sticky top-0 z-40`, and the mobile `BottomTabBar` needs `pb-20` clearance
    (`ui-ux-governance.md:101-107`).
  - TanStack Query is `^5.62.0` (`package.json:39`).
- **Opt-out inventory** (P-03). A hook is flagged only when every call site handles errors. Each was audited by
  grep:

  | Hook | Call site(s) | How errors are handled |
  |---|---|---|
  | `useSetOpportunityAction` | `insights/opportunities/page.tsx:122` | Step 3 per-call `onError` |
  | `useManageSignalSource` | `insights/signal-sources/page.tsx:192` | every `manageMutate` call has `onError`: `:226`, `:296`, `:332`, and Step 3 `handleToggle` |
  | `useRunBacktest` | `trader/positions/[symbol]/page.tsx:1109` | inline `{errorMessage && …}` at `:1187` |
  | `useRunBacktest` | `insights/strategies/[id]/page.tsx:66` | inline `runErrorObj` at `:90-92` |
  | `useScreenSymbols` | `components/trader/SymbolScreening.tsx:43` | inline `symbol-screen-error` at `:230-234` |
  | `useScreenSymbols` | `insights/screener/page.tsx:67` | inline at `:485` |
  | `useSetConfig` | `config-ui/[namespace]/NamespaceEditor.tsx:250` | `Save error: {errMessage(saveError)}` at `:358` |
  | `useSetStrategyLive` | `components/trader/LiveStrategiesPanel.tsx:22` | `{setLive.isError && …}` at `:99` |
  | `usePlaceOrder` | `components/trader/OrderForm.tsx:111` | per-call `onError` at `:157-162` |
  | `useReplaceOrder` | `components/trader/EditOrderDialog.tsx:26` | per-call `onError` at `:66` |
  | `useConfirmOrder` | `components/trader/ConfirmFillDialog.tsx:21` | per-call `onError` at `:47` |

  Every other mutation hook stays **unflagged**, so the fallback reports its failures:
  - `src/hooks/{useWatchlists,useTemplates,useFormulas,useStrategyDefinitions,useBackfills}.ts`.
  - `useTriggerBackfill` and `useCancelOrder`.
  - `useRegisterMcpClientSource` / `useInstantiateMcpSourceTemplate`.
  - `useRunFundamentalsScan`.
  - The inline `useMutation`s in `config-ui/users/page.tsx:91-131`.

  `useCancelOrder` is unflagged because `OrdersTable.tsx:235` cancels with no handler. Where an unflagged hook's
  caller also renders inline (for example `trader/orders/[id]/page.tsx:71`, `insights/backfills/page.tsx:279`),
  the error is reported twice. That is the accepted cosmetic trade-off (design.md Open Risks). Flagging more
  hooks later needs the same every-call-site proof.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Store.** Create `src/lib/mutationErrorStore.ts`, a pure module with no React import (node-testable). It holds
   one slot, `let current: { message: string } | null = null`, plus a listener `Set`, and exports:
   - `reportMutationError(message: string)`: the newest error overwrites the slot.
   - `clearMutationError()`.
   - `getMutationError()`.
   - `getServerMutationError()`: returns `null`.
   - `subscribeMutationError(listener): () => void`.
   - `shouldReportMutationError(meta: Record<string, unknown> | undefined): boolean`. It returns
     `meta?.errorHandled !== true`. This is the **only** opt-out. Never infer "handled" from `onError`
     (rejected alternative, `fails.md:3038`).

   It has no keyHash matching and no clear-on-success (rejected alternatives).
2. **Wire it into the query client.** In `createQueryClient()`, add
   `mutationCache: new MutationCache({ onError: (error, _vars, _ctx, mutation) => { if (shouldReportMutationError(mutation.options.meta)) reportMutationError(errMessage(error)); } })`.
   - Import `MutationCache` from `@tanstack/react-query` and `errMessage` from `@/lib/errMessage` (Step 3).
   - Leave `defaultOptions.queries` unchanged.
3. **Fallback component.** Create `src/components/shared/MutationErrorFallback.tsx` (`'use client'`):
   - It reads the slot with `useSyncExternalStore(subscribeMutationError, getMutationError, getServerMutationError)`.
     The server snapshot is `null`, so SSR does not throw.
   - It clears the slot on pathname change: `usePathname()` from `next/navigation`, then
     `useEffect(() => clearMutationError(), [pathname])`.
   - When the slot is set, it renders
     `<div className="fixed inset-x-4 bottom-24 z-50 sm:bottom-4 sm:left-auto sm:w-96"><Alert variant="destructive" role="alert"><AlertDescription>{message}</AlertDescription><Button variant="ghost" size="sm" aria-label="Dismiss error" onClick={clearMutationError}>Dismiss</Button></Alert></div>`.
   - Placement (C-17, `ui-ux-governance.md:101-107`): `bottom-24` clears the mobile `BottomTabBar` (`pb-20`)
     on phones, `sm:bottom-4` applies on desktop, and it stays clear of the `sticky top-0 z-40` header. It uses
     design-role tokens only, through the `destructive` variant.
4. **Mount it** once in each provider. Render `<MutationErrorFallback />` as a sibling after `{children}`:
   - inside `AccountProvider` in `src/app/trader/providers.tsx:13`;
   - inside `QueryNormalizerProvider` in `src/components/shared/QueryProviders.tsx:15-17`.
5. **Factory passthrough.** In `useInvalidatingMutation.ts`:
   - Widen `:17` to `options?: { mutationKey?: QueryKey; meta?: Record<string, unknown> }`.
   - Add `meta: options?.meta,` beside `mutationKey` at `:22`.
   - Update the JSDoc `@param options` line to name `meta.errorHandled` as the fallback opt-out (one line).
6. **Flag the inventory hooks** with `{ errorHandled: true }`:
   - Factory-built hooks pass `{ meta: { errorHandled: true } }` as the factory's third `options` argument
     (merged with any existing `mutationKey`): `useSetOpportunityAction`, `useManageSignalSource`,
     `usePlaceOrder`, `useReplaceOrder`, `useConfirmOrder`.
   - Plain-`useMutation` hooks set `meta: { errorHandled: true }` in their options: `useRunBacktest`,
     `useScreenSymbols`, `useSetConfig`, `useSetStrategyLive`.
7. **Delete the no-op `onError` blocks** in `useBacktest.ts:12-15`, `useScreenSymbols.ts:13-16` and
   `useSetConfig.ts:15-18`. Remove each file's then-unused `ConnectError` import.
8. Add no toast library.
9. Accepted trade-off, recorded in the PR body: after a successful retry, the banner stays until it is
   dismissed or the user navigates.

**Verification**:
```bash
grep -rn "errorHandled: true" services/xstockstrat-ui/src/hooks services/xstockstrat-ui/src/app/config-ui/hooks   # exactly 9 hits: the 9 hooks in the inventory table
grep -rn "return err;" services/xstockstrat-ui/src           # no hits
grep -n "MutationCache\|shouldReportMutationError" services/xstockstrat-ui/src/lib/queryClient.ts
grep -n "MutationErrorFallback" services/xstockstrat-ui/src/app/trader/providers.tsx services/xstockstrat-ui/src/components/shared/QueryProviders.tsx
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
```

---

### Step 8 — test: AC-10 a mutation with no handler reaches the global fallback, and flagged ones do not

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/mutationErrorStore.test.ts` — create
- `services/xstockstrat-ui/src/lib/queryClient.test.ts` — create
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `e2e/trader/orders.spec.ts`:
  - `:111-118` routes `CancelOrder`.
  - `:188-199` drives `actions-ord-new` → `cancel-ord-new` → `cancel-ord-new-confirm`.
  - `OrdersTable.tsx:235` calls `cancelOrder({ orderId })` with no handler, so `useCancelOrder` is unflagged
    (Step 7 inventory).
- `@tanstack/react-query` ^5 re-exports `MutationObserver` from query-core. A node-environment Vitest can build
  `createQueryClient()` and run a mutation through `new MutationObserver(client, { mutationFn, meta }).mutate(vars, perCallOptions)`
  with no DOM.

**TDD**: `red-green required`

**Covers**: `AC-10`

**Instructions**:
1. `mutationErrorStore.test.ts` checks:
   - The newest report overwrites the slot.
   - `clearMutationError` empties it, and listeners fire on report and on clear.
   - `getServerMutationError()` returns `null`.
   - `shouldReportMutationError(undefined) === true`, `({}) === true`, `({ errorHandled: true }) === false`,
     and `({ errorHandled: 'yes' }) === true` (strict `=== true` only).
2. `queryClient.test.ts` uses `createQueryClient()`, `beforeEach(clearMutationError)`, and swallows the expected
   `.mutate()` rejection with `.catch(() => {})`:
   - **(a)** A mutation with no `onError` that rejects `new ConnectError('down', Code.Unavailable)` leaves
     `getMutationError()?.message === 'down'` (AC-10).
   - **(b)** The same mutation with hook-level `meta: { errorHandled: true }` leaves the slot `null`.
   - **(c)** A mutation **without** meta whose `mutate()` passes a per-call `onError` still reports. This pins
     the TanStack v5 assumption that `MutationCache` sees hook-level options only (design Open Risk), and it is
     why flagging needs a call-site audit.
3. `orders.spec.ts` gets `test('@AC-10 a failed cancel with no per-call handler shows the global error', …)`:
   - Inside the test, override `CancelOrder` with `route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'cancel unavailable' }) })`.
   - Confirm the cancel of `ord-new`.
   - Assert `getByRole('alert').filter({ hasText: 'cancel unavailable' })` is visible (text-scoped, as in Step 4).
     Click `getByRole('button', { name: 'Dismiss error' })` and assert that filtered alert is gone.
   - Collect `pageerror` and assert it is empty.
4. Coverage: `test:coverage` must stay at or above the Vitest 40% lines/functions/statements threshold over
   `src/lib/**`. The two new tests cover `mutationErrorStore.ts` and `queryClient.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/orders.spec.ts -g "@AC-10"
grep -rn "errorHandled: true" services/xstockstrat-ui/src/hooks services/xstockstrat-ui/src/app/config-ui/hooks | wc -l   # 9 (inventory pin, P-03; scoped so this step's *.test.ts literals are not counted)
```

---

### Step 9 — service: D-17 unknown environment shows no Paper default and sends `TRADING_MODE_UNSPECIFIED`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/tradingMode.ts` — create
- `services/xstockstrat-ui/src/app/trader/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/orders/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/OrderBook.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useOrders.ts` — modify
- `services/xstockstrat-ui/src/hooks/usePortfolio.ts` — modify
- `services/xstockstrat-ui/src/hooks/usePositionLineage.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, environment (`production`/`staging`) scope correctness, Connect-RPC call safety

**Codebase Evidence**:
- `grep -rn "?? 'paper'" src` finds five display defaults:
  - `app/trader/page.tsx:19`.
  - `orders/page.tsx:16`.
  - `positions/page.tsx:48`.
  - `positions/[symbol]/page.tsx:110`.
  - `portfolio/page.tsx:27`.
- Mode types: `app/trader/page.tsx:12` exports `type TradingMode = 'paper' | 'live'`. It is imported by
  `orders/page.tsx:10`, `OrderForm.tsx:4` and `OrderBook.tsx:6`. Local copies sit at `positions/page.tsx:38` and
  `positions/[symbol]/page.tsx:84`.
- `EnvironmentMode = 'paper' | 'live'` is defined at `src/context/AccountContext.tsx:11`, and `environmentMode`
  is `EnvironmentMode | null` (`:27`).
- `grep -rn "toPbMode\|PbTradingMode" src` finds the mappings:
  - `OrderForm.tsx:139`: `tradingMode: mode === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER`.
  - `useOrders.ts:31-32` (used `:37`).
  - `usePortfolio.ts:8-9` (`:14`), `:44-45` (`:51`) and `:68-69` (`:75`).
- `usePositionLineage.ts:10,21` has a fifth mapping that recon did not list: a string form
  `mode === 'live' ? 'TRADING_MODE_LIVE' : 'TRADING_MODE_PAPER'`, filtering ledger payloads at `:27`. It is
  called from `positions/page.tsx:110-114`.
- Request fields carrying `tradingMode` (verified against proto, per `fails.md:358`):
  - `PlaceOrderRequest.trading_mode = 12` and `ListOrdersRequest.trading_mode = 6`, where UNSPECIFIED means all
    modes (`packages/proto/trading/v1/trading.proto:128`, `:175`).
  - `GetPortfolioRequest.trading_mode = 2`, `GetPositionRequest.trading_mode = 3` and
    `ListPositionsRequest.trading_mode = 3` (`packages/proto/portfolio/v1/portfolio.proto:177-192`).
- Server handling of UNSPECIFIED:
  - Trading `resolveTradingMode` (`trading.go:3573-3582`) maps UNSPECIFIED to the environment's mode, and is
    called by `PlaceOrder` at `:456`.
  - Read filters skip UNSPECIFIED: `trading_repo.go:239`, `trading.go:1599`, `portfolio_repo.go:146`,
    `portfolio_service.go:775,820`.
- Copy strings that interpolate `mode`:
  - `orders/page.tsx:59` `` `No ${mode} orders` ``.
  - `OrderBook.tsx:88` `No {mode} orders`.
  - `positions/page.tsx:509` `` `No open ${mode} positions` ``.
  - `positions/[symbol]/page.tsx:580` `No {mode} position in …`.
- The design asked for `OrderForm.tsx` to be read in full (all 322 lines): `mode` is used **only** at `:139`, in
  the request. OrderForm renders no paper/live label. The trader-page labels are the null-safe
  `TradingModeBadge` (`src/components/shared/TradingModeBadge.tsx:13` returns `null`) and the
  `environmentMode &&` guards (`AccountsModule.tsx:55`, `AccountManagementPanel.tsx:15`).
- Trading-mode gate (step-constraints §A): paper vs live is enforced server-side by `resolveTradingMode`. The UI
  sends no new mode, and a known mode is still sent explicitly.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Helper.** Create `src/lib/tradingMode.ts`:
   ```ts
   export function toPbTradingMode(mode: EnvironmentMode | null): PbTradingMode {
     return mode === 'live' ? PbTradingMode.LIVE : mode === 'paper' ? PbTradingMode.PAPER : PbTradingMode.UNSPECIFIED;
   }
   ```
   - Import the type from `@/context/AccountContext` and `TradingMode as PbTradingMode` from
     `@xstockstrat/proto/common/v1/common_pb`.
   - A known mode maps exactly as before (PRESERVE `@feature-095`).
2. **Widen the types.** Change `app/trader/page.tsx:12` to `export type TradingMode = EnvironmentMode | null;`
   and replace the local types at `positions/page.tsx:38` and `positions/[symbol]/page.tsx:84` the same way.
3. **Remove the defaults.** At all five sites, `?? 'paper'` becomes `const mode: TradingMode = environmentMode;`
   (portfolio: `const mode = environmentMode;`).
4. **Request mapping.**
   - In `OrderForm.tsx:139`, set `tradingMode: toPbTradingMode(mode)` and drop the now-unused `PbTradingMode`
     name from the `:13` import (keep `BrokerType`).
   - In `useOrders.ts` and `usePortfolio.ts`, widen every `mode: 'paper' | 'live'` param to
     `EnvironmentMode | null`, delete the four local `toPbMode` lambdas, use `toPbTradingMode(mode)`, and drop
     the unused `PbTradingMode` imports.
   - The `queryKey`s keep `mode`, so a later known mode refetches.
5. **Lineage filter.** In `usePositionLineage.ts`, widen `mode` to `EnvironmentMode | null`. When `mode === null`,
   skip the trading-mode clause at `:27` (all modes, matching the UNSPECIFIED reads). Otherwise keep `:21` as is.
6. **Copy.** With a `null` mode, the four copy strings render without the word:
   - `No orders`.
   - `No open positions`.
   - `No position in {symbol}`.

   Use `` `No ${mode ? `${mode} ` : ''}orders` `` style. Never print `null`.
7. **Leave alone:**
   - `AccountContext.tsx:59` (any non-LIVE → `'paper'`; the server always resolves a concrete mode; recon
     marks it low-risk).
   - The `orders/[id]/page.tsx:174` order-own-mode label.
8. Trading-domain notes:
   - Order types and broker routing are unaffected (all five `OrderType` values and ALPACA/IBKR/OFFLINE take the
     unchanged OrderForm path).
   - Fill handling is unaffected by this step.
   - OrderForm's qty and auto-sizing routing is untouched (PRESERVE feature-110).

**Verification**:
```bash
grep -rn "?? 'paper'" services/xstockstrat-ui/src            # no hits
grep -rn "toPbMode" services/xstockstrat-ui/src              # no hits
grep -n "toPbTradingMode\|TradingMode" services/xstockstrat-ui/src/components/trader/OrderForm.tsx
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
```

---

### Step 10 — test: AC-3 and AC-12 unknown environment sends UNSPECIFIED and shows no Paper label on any trader page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/tradingMode.test.ts` — create
- `services/xstockstrat-ui/e2e/trader/order-form.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, environment scope correctness

**Codebase Evidence**:
- The mock `getTradingEnvironment` returns `{ tradingMode: 1 }`, which is PAPER (`e2e/mock-backend.ts:333-335`).
  A per-page `page.route('**/xstockstrat.trading.v1.TradingService/GetTradingEnvironment', …)` 503 makes the
  mode unknown.
- `e2e/trader/order-form.spec.ts:83-122` already captures the PlaceOrder body (`:87`) and asserts a
  NAME-string `timeInForce` (`@feature-202` AC-5, PRESERVE).
- `TradingModeBadge` renders the literal mode text (`TradingModeBadge.tsx:20`, uppercase), so the "no Paper
  label" assertion is `page.getByText(/^paper$/i)` with count 0.
- Proto3 JSON omits zero-valued enum fields by default. On the wire, `TRADING_MODE_UNSPECIFIED` is therefore
  absent or the NAME-string `TRADING_MODE_UNSPECIFIED`, never the old `TRADING_MODE_PAPER`. This sharpens the
  design's "UNSPECIFIED serializes as TRADING_MODE_UNSPECIFIED".

**TDD**: `red-green required`

**Covers**: `AC-3, AC-12`

**Instructions**:
1. `tradingMode.test.ts` checks:
   - `toPbTradingMode('live') === PbTradingMode.LIVE`.
   - `toPbTradingMode('paper') === PbTradingMode.PAPER` (PRESERVE `@feature-095`).
   - `toPbTradingMode(null) === PbTradingMode.UNSPECIFIED` (AC-3).
2. `order-form.spec.ts` gets `test.describe('@AC-3 @AC-12 environment unknown', …)` with a `beforeEach` that
   routes `GetTradingEnvironment` to
   `fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'env down' }) })`.
3. **`@AC-3`:** on `/trader`, capture the PlaceOrder body and submit a buy of 1 `AAPL` market order.
   - Assert `body.tradingMode === undefined || body.tradingMode === 'TRADING_MODE_UNSPECIFIED'`.
   - Assert `body.tradingMode !== 'TRADING_MODE_PAPER'`.
   - Assert `getByText(/^paper$/i)` has count 0.
4. **`@AC-12`:** loop over `['/trader', '/trader/orders', '/trader/positions', '/trader/positions/AAPL', '/trader/portfolio']`.
   For each page, go to it, wait for its main heading, and assert `getByText(/^paper$/i)` has count 0.
5. RED on the pre-fix tree: the body carries `TRADING_MODE_PAPER`. The badge is already null-safe, so AC-12 is a
   regression guard. `@AC-12` stays GREEN-only and is recorded as such in the step PR.
6. C-12: auth comes from `addAuthCookie`. The error payload is a one-off.
7. Coverage: `test:coverage` must stay at or above the Vitest 40% lines/functions/statements threshold over
   `src/lib/**`; `tradingMode.test.ts` covers `src/lib/tradingMode.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/order-form.spec.ts
```

---

### Step 11 — service: D-11 freshness, where the order record with the strictly newer `updatedAt` wins

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/orderFreshness.ts` — create
- `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- The merge at `OrdersTable.tsx:65-68` is `useMemo(() => orders.map((o) => liveUpdates[o.orderId] ?? o), [orders, liveUpdates])`,
  so the streamed record always wins.
- `timestampToMillis(ts: ProtoTimestamp | undefined): number | undefined` is at `src/lib/protoTime.ts:11-14`.
  It returns `undefined` for an absent timestamp.
- `Order.updated_at` is field 14 (`packages/proto/trading/v1/trading.proto:60`). The server stamps it on every
  mutation (`trading.go:632, :698, :722, :825, :941, :1359, :1546`).
- `insights.md:1551` says an absent Timestamp takes a neutral fallback, never epoch arithmetic.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/lib/orderFreshness.ts` exporting `pickFresherOrder(streamed: Order | undefined, polled: Order): Order`:
   - When there is no streamed record, return `polled`.
   - Otherwise compare `timestampToMillis(x.updatedAt) ?? Number.NEGATIVE_INFINITY` for both, so an absent
     timestamp counts as oldest.
   - Return `polled` only when its value is **strictly** greater. Otherwise (a tie, or an absent poll) return
     `streamed`.
   - Import `Order` as a type only.
2. In `OrdersTable.tsx:65-68`, change the merge to `orders.map((o) => pickFresherOrder(liveUpdates[o.orderId], o))`.
   Step 13 renames `liveUpdates` and keeps this call.
3. Fill state: the comparison is status-agnostic, so PARTIALLY_FILLED → FILLED and NEW → CANCELED both resolve
   by `updatedAt`. Step 12 tests a partial-fill case and a terminal case. Broker and order types are unaffected.

**Verification**:
```bash
grep -n "pickFresherOrder" services/xstockstrat-ui/src/components/trader/OrdersTable.tsx
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
```

---

### Step 12 — test: AC-1 and AC-8 freshness rules

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/orderFreshness.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- Sibling-test precedent: `src/lib/protoTime.test.ts`.
- Coverage scope is `src/lib/**` with a 40% line threshold (`vitest.config.ts`).
- The `ORDER_WORKING` fixture (`mock-order-002`, `status: 1`) is in `e2e/fixtures/orders.ts:36`. Unit tests may
  spread it (C-12 allows `{ ...FIXTURE, override }`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-8`

**Instructions**:
1. Build the timestamps with `timestampFromDate` from `@bufbuild/protobuf/wkt`. Cases:
   - **AC-1 (partial fill):** streamed PARTIALLY_FILLED @10:00:00Z vs polled FILLED @10:00:05Z → FILLED.
   - **AC-8 (tie):** streamed CANCELED @10:00:05Z vs polled NEW @10:00:05Z → CANCELED.
   - **Older poll:** streamed FILLED @10:00:05 vs polled NEW @10:00:00 → FILLED.
   - **Absent poll timestamp:** keeps the streamed record.
   - **Absent streamed timestamp, present poll:** the poll wins.
   - **No streamed record:** returns the poll.
2. Build the orders as `{ ...ORDER_WORKING, status, updatedAt }`. Import from `../../e2e/fixtures/orders` if the
   Vitest alias/include allows it; otherwise build `create(OrderSchema, …)` objects, the proto-shaped one-offs
   that C-12 permits.
3. Coverage: `test:coverage` must stay at or above the Vitest 40% lines/functions/statements threshold over
   `src/lib/**`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage
```

---

### Step 13 — service: D-11 streams reconnect with backoff and show a disconnected indicator (orders and alerts)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/streamBackoff.ts` — create
- `services/xstockstrat-ui/src/hooks/useReconnectingStream.ts` — create
- `services/xstockstrat-ui/src/hooks/useOrderUpdates.ts` — modify
- `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `useOrderUpdates.ts:8-34`:
  - A `useEffect` keyed on `filterKey = JSON.stringify(statusFilter)` (`:12`) opens
    `tradingClient.streamOrderUpdates({ statusFilter }, { signal: ctrl.signal })`.
  - It ends in a silent `catch {}` (`:25-27`) and returns `Record<string, Order>`.
  - Its only consumer is `OrdersTable.tsx:59` (`const liveUpdates = useOrderUpdates();`).
- `AlertStream.tsx`:
  - The `streamAlerts` effect (`:33-48`) has the same pattern with a silent `catch {}` (`:44`).
  - The merge `setAlerts((prev) => [alert, ...prev].slice(0, 50))` (`:42`) does **not** dedupe. The design's
    "still dedupes on `alertId`" is inaccurate: `alertId` is only the React `key` (`:96`).
  - The bell `listAlerts` count effect is mount-only (`:18-31`).
  - The icon-only bell `Button` (`:57`) has no accessible name.
- Server behavior:
  - Trading `StreamOrderUpdates` (`trading.go:1667-1686`) sends a snapshot and then blocks until the context is
    done. A reconnect therefore replays the snapshot, which is idempotent under keyed state plus
    `pickFresherOrder`.
  - Notify `streamAlerts` (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:120-140`) registers a
    subscriber with no backlog.
  - Both streams are meant to run forever.
- Transport: `makeBrowserTransport` (`src/lib/browserClients/transport.ts:56-57`) wraps streams in `guardStream`
  (`:18-29`). On a mid-stream `Unauthenticated` it calls `handleUnauthorized()` (refresh, or redirect on failure)
  and rethrows. Its comment says "The stream is NOT replayed on refresh — it recovers on the next reconnect"
  (`:16`). So `Unauthenticated` is classified as retryable here.
- Precedent for UI-local timing constants: `useScreenSymbols.ts:24-27` (`POLL_INTERVAL_MS`, `MAX_POLL_ATTEMPTS`;
  F-07 does not apply).
- Error primitive: `Alert variant="destructive"` (`ui/alert.tsx`). The `BellOff` icon comes from `lucide-react`,
  already a dependency (`AlertStream.tsx:5` imports `Bell`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Backoff and classification.** Create `src/lib/streamBackoff.ts` (pure, node-testable). It exports:
   - `STREAM_STABLE_MS = 3_000`, `BACKOFF_BASE_MS = 1_000`, `BACKOFF_MAX_MS = 30_000`.
   - `nextBackoffMs(attempt: number): number`, which returns `Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)`.
     There is no jitter (YAGNI; two streams per tab).
   - `isRetryableStreamError(err: unknown): boolean`:
     - A non-`ConnectError`, such as a fetch `TypeError` on a network drop, is retryable.
     - `ConnectError` codes `Unavailable`, `Unknown`, `Internal`, `DeadlineExceeded`, `ResourceExhausted`,
       `Aborted`, `Canceled` and `Unauthenticated` are retryable.
     - Every other code is **terminal**: `InvalidArgument`, `NotFound`, `AlreadyExists`, `PermissionDenied`,
       `FailedPrecondition`, `OutOfRange`, `Unimplemented` and `DataLoss`.
2. **Reconnecting hook.** Create `src/hooks/useReconnectingStream.ts`:
   - Signature:
     ```ts
     useReconnectingStream<T>(
       key: string,
       open: (signal: AbortSignal) => AsyncIterable<T>,
       onItem: (item: T) => void,
     ): { disconnected: boolean; terminal: string | null }
     ```
   - Hold `open` and `onItem` in refs, and key the effect on `key` only.
   - The effect creates one `AbortController` and loops while the controller is not aborted:
     1. Arm a `STREAM_STABLE_MS` timer that clears `disconnected` and resets `attempt = 0`.
     2. Run `for await (const item of open(ctrl.signal))`. On each item, clear `disconnected`, reset `attempt`
        and call `onItemRef.current(item)`.
     3. On a throw: if aborted, return silently. Otherwise, if `!isRetryableStreamError(err)`, set `terminal` to
        `errMessage(err)` and `disconnected` to true, then return.
     4. In `finally`, clear the timer.
     5. After any non-abort end, whether a clean end or a retryable error, set `disconnected` to true and wait
        `nextBackoffMs(attempt++)` with an abort-aware sleep, then loop.
   - Cleanup aborts the controller, so unmount or abort never reconnects.
   - The indicator shows immediately on a drop, with **no show-side debounce**. Recorded decision: AC-2 and AC-9
     require it visible on drop, and a debounce would add a timer only to hide short drops. This resolves the
     design's optional debounce.
   - The indicator never clears on `onHeader` (rejected alternative: the BFF opens the backend stream lazily).
3. **Orders.** Rewrite `useOrderUpdates` on the hook:
   - `open = (signal) => tradingClient.streamOrderUpdates({ statusFilter }, { signal })`.
   - `onItem = (order) => setUpdates((prev) => ({ ...prev, [order.orderId]: order }))`.
   - The key stays `filterKey`.
   - It returns `{ updates, disconnected, terminal }`.
   - Delete the silent catch and its comment.
4. **Orders table.** In `OrdersTable.tsx`:
   - Change `:59` to `const { updates: liveUpdates, disconnected, terminal } = useOrderUpdates();` and keep the
     Step 11 merge.
   - Under the `QueryStateMessages` at `:203`, render
     `{disconnected && <Alert variant="destructive" role="alert" data-testid="order-stream-disconnected"><AlertDescription>{terminal ? \`Live order updates stopped: ${terminal}\` : 'Live order updates disconnected — reconnecting…'}</AlertDescription></Alert>}`.
5. **Alerts.** Move the `AlertStream.tsx:33-48` `streamAlerts` effect onto the hook with key `'alerts'`:
   - `open = (signal) => notifyClient.streamAlerts({ categories: [], severities: [], includeAcknowledged: false }, { signal })`.
   - `onItem` dedupes before prepending: `setAlerts((prev) => prev.some((a) => a.alertId === alert.alertId) ? prev : [alert, ...prev].slice(0, 50))`.
     This is needed because a reconnect may re-deliver an alert, and React keys must stay unique.
   - When `disconnected`, the bell `Button` renders `BellOff` in place of `Bell`. Give the button an accessible
     name (C-17): `aria-label={disconnected ? 'Alerts — live alerts disconnected' : 'Alerts'}`.
   - Add a visible `<span data-testid="alert-stream-disconnected" className="sr-only sm:not-sr-only text-xs text-destructive">Live alerts disconnected</span>`
     beside it.
   - Keep the mount-only `listAlerts` effect at `:18-31` untouched (PRESERVE `@feature-203`). A reconnect never
     re-runs it.
6. **Trace (operator 2026-10-21 decision).** Reconnects call the same `tradingClient` / `notifyClient` (BFF
   `/trader/api`), so `src/middleware.ts` keeps injecting `x-trace-id` and the BFF `backendHeaders` keeps
   forwarding it. No side channel is added. The step adds no new outbound gRPC call, so the header-propagation
   constraint is satisfied by reuse.
7. **Edge idle timeout (Open Risk).** A quiet stream closed by Cloudflare reconnects through the clean-end path
   and replays the snapshot. This is harmless given keyed orders, alert dedupe and freshness. The step PR must
   record a dev-environment observation: watch `/trader/orders` idle for 5 minutes and note any reconnect churn.

**Verification**:
```bash
grep -rn "silent stop" services/xstockstrat-ui/src          # no hits
grep -n "useReconnectingStream" services/xstockstrat-ui/src/hooks/useOrderUpdates.ts services/xstockstrat-ui/src/components/trader/AlertStream.tsx
grep -n "tradingClient\|notifyClient" services/xstockstrat-ui/src/hooks/useOrderUpdates.ts services/xstockstrat-ui/src/components/trader/AlertStream.tsx   # reconnects reuse the propagating clients
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
```

---

### Step 14 — test: AC-2, AC-9 and AC-1 streams disconnect, show the indicator, reconnect and recover without a reload

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/streamBackoff.test.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/orders.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/stream-reconnect.spec.ts` — create
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `e2e/mock-backend.ts`:
  - `router.service(TradingService, {…})` (`:269-341`) has **no** `streamOrderUpdates` handler. Under Step 13
    the client would get `Unimplemented`, which is terminal, and the indicator would show permanently on every
    `/trader/orders` spec. (A second `router.service(TradingService, …)` at `:1353` serves the insights mock
    server with `listBrokerAccounts`/`listPortfolios` only — also no `streamOrderUpdates`; leave it untouched.)
  - `streamAlerts` (`:530-535`) yields `ALERT_STREAM_ALL` and then ends cleanly ("no hang in tests"). Under
    Step 13 that would reconnect every second.
  - `timestampFromDate` is already imported (`:18`).
- `e2e/trader/orders.spec.ts:127-137` fulfils `StreamOrderUpdates` with a 400 `unavailable` body. Its comment
  "Fail the live stream fast so useOrderUpdates stops silently" goes stale under Step 13: the hook now retries
  with backoff and shows the indicator. No existing test asserts the indicator is absent.
- The `application/connect+json` stream fulfil precedent is `orders.spec.ts:134` and `order-parity.spec.ts:124`.
- Connect streaming framing: each frame is a 1-byte flag (`0x00` message, `0x02` end-stream), a 4-byte
  big-endian length, then a JSON payload. The end-stream payload is `{"error":{"code":"unavailable","message":…}}`.
  `createConnectTransport` uses JSON by default (`transport.ts:57` sets no `useBinaryFormat`).
- Fixtures: `ORDERS` and `ORDER_WORKING` (`mock-order-002`, `status: 1`, no `updatedAt`; `e2e/fixtures/orders.ts:36-80`),
  and `ALERT_STREAM_001..003` (`e2e/fixtures/alerts.ts:9-33`). INVENTORY rows are "Orders (shared mock set)" and
  "Alerts (feature 203)".
- `insights.md:1160` says the stateful mocks must be per-page `page.route`.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-9, AC-1`

**Instructions**:
1. **`streamBackoff.test.ts`:**
   - Assert `nextBackoffMs(0..6)` gives `1000, 2000, 4000, 8000, 16000, 30000, 30000`.
   - Assert `isRetryableStreamError` is true for `TypeError` and for `Unavailable`, `Unknown`, `Internal`,
     `DeadlineExceeded` and `Unauthenticated`.
   - Assert it is false for `PermissionDenied`, `InvalidArgument` and `Unimplemented`.
2. **Mock backend.**
   - Add a `streamOrderUpdates` to the trader `TradingService` that yields nothing and holds open until
     `ctx.signal` aborts:
     `await new Promise<void>((r) => ctx.signal.addEventListener('abort', () => r(), { once: true }))`.
   - Change `streamAlerts(_req, ctx)` to hold open the same way after yielding `ALERT_STREAM_ALL`, replacing the
     clean end.
   - Update the `:534` comment to say the stream stays open until the client aborts.
3. **Order fixture (C-12).**
   - In `e2e/fixtures/orders.ts`, add `ORDER_WORKING_STREAMED_AT = '2026-10-21T10:00:00Z'` and
     `ORDER_WORKING_FILLED_AT = '2026-10-21T10:00:05Z'`. These are the AC timestamps for `mock-order-002`.
   - Extend the INVENTORY "Orders (shared mock set)" row with the two symbols and their consumer,
     `e2e/trader/stream-reconnect.spec.ts`.
   - Frames are spreads of `ORDER_WORKING` (status overrides) and the alerts are `ALERT_STREAM_*`. Both are
     exempt one-offs.
4. **Frame helper.** `stream-reconnect.spec.ts` gets a local helper `connectStreamBody(messages: object[], error?: { code: string; message: string }): Buffer`
   that builds the frames. It is single-consumer, so it stays inline (C-13 lazy rule).
5. **`@AC-2 @AC-1` on `/trader/orders`:**
   - Route `ListOrders` to `{ orders: [{ ...ORDER_WORKING, updatedAt: ORDER_WORKING_STREAMED_AT }], page: { totalCount: 1, nextPageToken: '' } }`.
   - Route `StreamOrderUpdates` with a per-page counter:
     - **Attempt 1:** fulfil `contentType: 'application/connect+json'` with one frame
       `{ ...ORDER_WORKING, status: 'ORDER_STATUS_PARTIALLY_FILLED', updatedAt: ORDER_WORKING_STREAMED_AT }`
       followed by the end-stream error `unavailable`.
     - **Attempt 2:** `await` a test-controlled gate promise, then fulfil one frame
       `{ ...ORDER_WORKING, status: 'ORDER_STATUS_FILLED', updatedAt: ORDER_WORKING_FILLED_AT }` with no
       end-stream frame. Hold the body open by delaying, or else end it. If it ends, the next attempt waits
       about 2 s of backoff, which the assertions do not depend on.
   - Assert `getByTestId('order-stream-disconnected')` is visible.
   - Release the gate and assert:
     - The indicator is hidden (it clears on the first item).
     - `getByTestId('order-row-mock-order-002')` shows `FILLED` and not `PARTIALLY_FILLED`, with no `page.reload()`.
     - The newer streamed `updatedAt` beat the older poll (AC-1 render path).
6. **`@AC-9` on `/trader`:**
   - Route `**/xstockstrat.notify.v1.NotifyService/StreamAlerts`:
     - **Attempt 1:** a frame for `ALERT_STREAM_001`, then end-stream `unavailable`.
     - **Attempt 2:** behind a gate, `route.continue()` to the held-open mock, which yields `ALERT_STREAM_ALL`.
   - Assert `getByTestId('alert-stream-disconnected')` is attached and the bell's accessible name contains
     `disconnected`.
   - Release the gate and assert the name returns to `Alerts`.
   - Open the sheet and assert `ALERT_STREAM_002.title` is visible, and `ALERT_STREAM_001.title` appears exactly
     once (dedupe), with no reload.
7. **Existing orders spec.** In `orders.spec.ts:127-137`, update only the stale comment so it says the stream
   failure now retries with backoff behind the disconnected indicator. The stub stays.
8. **Regression run.** Run the existing `e2e/trader/alert-stream.spec.ts` unchanged. It must stay green with the
   held-open mock: the badge count and `Clear all` are PRESERVE `@feature-203`.
9. **Fallback (Open Risk).** If `page.route` cannot hold a fulfilled stream open, keep attempt 2 a complete body
   (frame and no error). The client then sees a clean end and reconnects after the backoff. The indicator
   assertions still hold because they target the first item. Record whichever variant ran in the Deviation Log.
10. Coverage: `test:coverage` must stay at or above the Vitest 40% lines/functions/statements threshold over
    `src/lib/**`; `streamBackoff.test.ts` covers `src/lib/streamBackoff.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/stream-reconnect.spec.ts e2e/trader/alert-stream.spec.ts e2e/trader/orders.spec.ts e2e/trader/order-parity.spec.ts
grep -n "from '../fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/trader/stream-reconnect.spec.ts
grep -n "ORDER_WORKING_FILLED_AT" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 1 — 2026-10-28

- **TDD RED harness (not a code deviation).** Step 1's paired test lives in Step 2's **Files**, so the RED/GREEN
  cycle ran a throwaway probe spec (`e2e/trader/zz-tdd-probe-step1.spec.ts`, Step 2's AC-4 assertions verbatim)
  that was deleted before commit; Step 2 authors the real test. The probe ran under `CI=1 E2E_PREBUILT=1`
  against a `pnpm build` because the local `pnpm dev` harness timed out in `warmup.setup.ts` (10 s cold compile).
  **Disposition**: CI-equivalent fallback.
- **Pre-existing `tsc --noEmit` failure, out of scope.** The Verification's `pnpm exec tsc --noEmit` exits 1 on
  `e2e/insights/backfills.spec.ts:135-136` (`Property 'dataKind'/'timeframeEnum' does not exist on type 'never'`),
  a file this step does not touch (last changed by feature 198). The `src/` tree type-checks clean and
  `pnpm build` (Next type-check) passes. **Disposition**: not fixed here; handed to `/sdd-qa defect`.

### Step 2 — 2026-10-28

- **Verification run against a prebuilt app.** The Playwright command ran as `CI=1 E2E_PREBUILT=1` against a
  `pnpm build`, the same harness Step 1 used (local `pnpm dev` cold compile times out in `warmup.setup.ts`).
  **Disposition**: CI-equivalent fallback.
- **One `expect.poll(...).toMatchObject({ strategyId, strategyIdRef })` instead of two field asserts.** Same
  assertion, but the RED output now prints the captured body. That proves the request was intercepted and only
  `strategyId` was missing. **Disposition**: test-shape refinement inside the step's **Files**; no scope change.
- **Evidence citation drift (no code impact).** `e2e/trader/orders.spec.ts:99` is a TradingService glob, not
  AnalysisService. The AnalysisService `RunBacktest` glob precedent is `e2e/insights/sector-overrides.spec.ts:76`.
  **Disposition**: noted only; step body not edited (F-09).

### Step 3 — 2026-10-29

- **TDD RED harness (not a code deviation).** Step 3's paired test lives in Step 4's **Files**. The RED/GREEN
  cycle therefore ran throwaway probes, appended to `e2e/insights/opportunities.spec.ts` and
  `e2e/insights/signal-sources.spec.ts`. They contain Step 4's `@AC-5`/`@AC-6` 503-route plus
  `getByRole('alert').filter({ hasText })` assertions verbatim, and were reverted before commit (`git checkout`).
  Step 4 authors the real tests. The probes ran under `CI=1 E2E_PREBUILT=1` against a `pnpm build`, the same
  harness Steps 1-2 used. **Disposition**: CI-equivalent fallback.
- **Pre-existing `tsc --noEmit` failure, out of scope (unchanged since Step 1).** The failure is still only
  `e2e/insights/backfills.spec.ts:135-136`, and `src/` type-checks clean (`pnpm build` passes).
  **Disposition**: not fixed here; already handed to `/sdd-qa defect`.

### Step 4 — 2026-10-29

- **"Deactivate" is the `Disable` menu item.** The step says to deactivate `SIGNAL_SOURCE_WEIGHTED` through its row
  action. The page labels that action `Disable` for an active source (`signal-sources/page.tsx:455`), and the
  fixture is `active: true`, so the test clicks `getByRole('menuitem', { name: 'Disable' })`. **Disposition**:
  selector wording only; same behavior, no scope change.
- **The "edit form is closed" assertion is `getByPlaceholder('Display name')` with count 0.** This is the edit
  form's own field, as used by the existing Edit test. **Disposition**: test-shape choice inside the step's
  **Files**.
- **TDD RED ran against the pre-Step-3 tree.** Step 3 had already landed, so the three Step-3 source files were
  temporarily checked out from `HEAD~1` and `src/lib/errMessage.ts` was moved aside for the RED run, then all four
  were restored from `HEAD` before GREEN. Playwright ran under `CI=1 E2E_PREBUILT=1` against a `pnpm build`, the
  same harness Steps 1-3 used. **Disposition**: CI-equivalent fallback.
- **The `-g "@AC-5|@AC-6"` filter also matches two pre-existing tests** (feature 185 `@AC-6` and feature 161
  `@AC-5`). They passed both in RED and GREEN. **Disposition**: noted only. GREEN ran both spec files in full.

### Step 5 — 2026-10-29

- **TDD RED harness (not a code deviation).** Step 5's paired test lives in Step 6's **Files**. The RED/GREEN
  cycle therefore ran a throwaway probe spec (`e2e/trader/zz-tdd-probe-step5.spec.ts`) holding Step 6's `@AC-7`
  (500 fulfill) and `@AC-11` (`route.abort('failed')`) assertions verbatim, plus the `pageerror` collection. It
  was deleted before commit; Step 6 authors the real tests. The probe ran under `CI=1 E2E_PREBUILT=1` against a
  `pnpm build`, the same harness Steps 1-4 used. **Disposition**: CI-equivalent fallback.
- **Evidence line drift (no code impact).** `onExportEvents` sat at `portfolio/page.tsx:108-123` (cited `:106-122`;
  the comment starts at `:106`). **Disposition**: noted only; step body not edited (F-09).
- **Pre-existing `tsc --noEmit` failure, out of scope (unchanged since Step 1).** The failure is still only
  `e2e/insights/backfills.spec.ts:135-136`; `src/` type-checks clean and `pnpm build` passes.
  **Disposition**: not fixed here; already handed to `/sdd-qa defect`.

### Step 6 — 2026-10-29

- **Verification run against a prebuilt app.** The Playwright command ran as `CI=1 E2E_PREBUILT=1` against a
  `pnpm build`, the same harness Steps 1-5 used. **Disposition**: CI-equivalent fallback.
- **TDD RED ran against the pre-Step-5 tree.** Step 5 had already landed, so `portfolio/page.tsx` was temporarily
  checked out from `HEAD~1` for the RED build, then restored from `HEAD` before GREEN. **Disposition**:
  CI-equivalent fallback.
- **AC-11 RED failed on the alert assertion, before the `pageerror` check.** The missing alert (`element(s) not
  found`) is the first failing assertion, so the RED output does not separately show the unhandled-rejection
  `pageerror` the step predicted. **Disposition**: noted only; GREEN asserts the `pageerror` array is empty.

### Step 7 — 2026-10-29

- **TDD RED harness (not a code deviation).** Step 7's paired test lives in Step 8's **Files**, so the RED/GREEN
  cycle ran a throwaway Vitest probe (`src/lib/zzProbeStep7.test.ts`, Step 8's `queryClient.test.ts` cases (a) and
  (b) through `MutationObserver`). It was deleted before commit; Step 8 authors the real tests. `mutationErrorStore.ts`
  was written first so that RED failed on the assertion (`getMutationError()?.message` was `undefined`), not on a
  missing import. **Disposition**: CI-equivalent fallback.
- **The `useInvalidatingMutation` JSDoc names the opt-out as `meta.errorHandled === true`.** Writing the literal
  `{ errorHandled: true }` would add a tenth hit to the Verification grep, which must count exactly the 9 flagged
  hooks (Step 8 pins the same count). **Disposition**: wording choice inside the step's **Files**.
- **Prettier wrapped the `MutationCache` `onError` body onto two lines.** Behavior is unchanged.
  **Disposition**: formatting only.
- **Pre-existing `tsc --noEmit` failure, out of scope (unchanged since Step 1).** The failure is still only
  `e2e/insights/backfills.spec.ts:135-136`; `src/` type-checks clean and `pnpm build` passes.
  **Disposition**: not fixed here; already handed to `/sdd-qa defect`.
