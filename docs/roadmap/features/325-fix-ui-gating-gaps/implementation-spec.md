# Implementation Spec: fix-ui-gating-gaps

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/325-fix-ui-gating-gaps/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-ui-gating-gaps`

---

## Execution Summary

One UI-only PR in `services/xstockstrat-ui`, following `design.md` § Chosen Approach (D-1 to D-10).
Unit 1 (Steps 1+2) gates the config-ui namespace editor on the session's admin bit. Unit 2
(Steps 3+4) replaces the watchlist's page-1 queue read with one bounded membership drain. Step 5
records the operator-accepted warm-set cost and closes the two UI findings rows. Each unit is test
first, then code, and commits as one atomic unit because a RED test cannot pass its own
verification alone. No proto, migration, config key, env var or port changes (recon.md:76-80).

**Evidence tree.** Every `path:line` below was read on `origin/main-dev@fb52065c` (detached).
`origin/feature/fix-ui-gating-gaps@20742720` is 168 commits behind `main-dev` and holds only docs
commits of its own, so `/sdd-execute` BRANCH SYNC merges `main-dev` before Step 1 and the executor
sees the cited tree. Lines moved since recon (`c4fd48b0`): `WatchlistDetail.tsx` `:74`→`:72`,
`:93-95`→`:91-93`, `:369`→`:367`; `WatchlistReadiness.tsx` `:223`→`:249`, `:299`→`:329`,
`:344`→`:377`. Re-check anchors after any further `main-dev` merge.

**Consumer surfaces (C-14).** UI `/config-ui/<namespace>` is reached by Step 2; UI
`/insights/watchlists` (watchlist detail) by Step 4. No Agent MCP tool changes.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` a non-admin sees no working Edit affordance in the namespace editor | Step 1 (cases 1a, 1b; 1c and 1d guard the fail-open path) |
| `@AC-2` a watchlisted symbol ranked below the first opportunity page shows as in queue | Step 3 (Case A; Cases B and C cover the pager, the cap and a failed drain) |

## Step Dependencies

- Steps 1+2 land together: Step 1 adds tests that are RED until Step 2 changes `NamespaceEditor`,
  so Step 1 cannot pass its own Verification alone (`step-constraints.md` §C, F-05).
- Steps 3+4 land together: Step 3 adds tests that are RED until Step 4 adds the drain and swaps
  the consumer. Step 4 also removes the `inQueue` prop from `WatchlistReadiness` and edits its only
  caller, `WatchlistDetail.tsx:367`, in the same step (§C: signature change plus caller).
- Step 3 requires Steps 1+2 only by order; the two units touch disjoint files.
- Step 5 requires Step 4: the findings rows describe behaviour that exists only after it.
- Post-deploy checks on dev are **not** an execute step, because they cannot be verified in-tree
  (F-05). They are listed in § Post-Deploy Verification and run after the `main-dev` deploy.
- Follow-up feature (out of scope here): a marketdata warm-set TTL prune, proposed slug
  `marketdata-warm-set-ttl-prune`. Its number is **not reserved**. design.md asks for it to be
  numbered at spec time, but the allocator writes the `sdd/feature-cursor` ref and this run may
  push only `feature/fix-ui-gating-gaps`. Reserve it with `/sdd-story marketdata-warm-set-ttl-prune`.
- File overlap with other in-flight specs (impl-spec review 2026-11-20, rebase-only, no
  `merge-order.md` entry needed): Step 3's `e2e/fixtures/opportunities.ts` and
  `e2e/fixtures/INVENTORY.md` are also edited by feature 308 (its spec `:911-912`, adds
  `MYSZ_EVALUATION_FAILED_OPPORTUNITY` and a row after `INVENTORY.md:44`); features 345 (`:2130`)
  and 360 (`:625`) also add `INVENTORY.md` rows. The exports are disjoint. Whichever lands second
  re-places its catalog row by neighbouring symbol, not by line number.

## Accepted Cost (O-5) — operator ruling 2026-11-20

Operator ruling, recorded 2026-11-20 ("I accept the bound"): the warm-set cost is accepted at
**|W_new| × (2,880 + 288) per calendar day**, a union since the last marketdata restart, with the
caveats below. O-5 is closed, P-1 is declined and the 15 s cadence stands (D-2, D-9). The cites
were re-read at `origin/main-dev@fb52065c`.

**(a) Baseline (D-8).** `ListOpportunities` enriches only the returned window
(`services/xstockstrat-analysis/app/handlers/servicer.py:4744-4749`; page size is not clamped,
`:4688`). Today's page-1 read (`WatchlistDetail.tsx:72`) already warms ranks 1 to 50, and the drain
replaces that read. New warm entries are at most the rows ranked 51 and lower. New distinct symbols
are at most that many, minus symbols already warm under D-7.

**(b) Per-recompute snapshot.** Per viewer u the term is max(0, Q_u − 50), with
Q_u ≤ max(`opportunity.max_universe_size`, |curated_u| + |muted_only_u|). The cut is at
`servicer.py:5627-5639` (`max_universe` `:5629`, `signal_axis` sort `:5637`, selection `:5639`). At
the default of 100, with a curated set below 100, the term is 50.

**(c) Bound over time.** |W_new| is a union since the last marketdata restart over every tail any
viewer has drained. V is distinct viewers since boot.

- `markWarm` only adds (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1171-1177`);
  the enrichment path adds through `markWarmIfServable` (`internal/service/asset_servability.go:93-104`).
- Removals: the first-load unservable prune (`asset_servability.go:148-157`), the feature-352
  flagged-delisting removal (`internal/service/delisting.go:63-67`), or a restart.
- The ceiling is the servable symbols that, since boot, carried an active signal for, or were
  curated or muted by, any watchlist viewer. There is no structural bound below that until restart.

**(d) Cost per newly warm symbol per calendar day.** Both pollers run 24/7 with no market-hours
gate (`marketdata_service.go:1194-1231`, `:1306-1332`), on marketdata's 2-connection PgBouncer
client pool.

1. Quote upserts: **2,880 upsert statements per day**, one `cacheQuote` per symbol per 30 s cycle
   (`:1246-1252`). `InsertQuote` is `ON CONFLICT (symbol, time) DO UPDATE`
   (`internal/repository/marketdata_repo.go:299-304`). Retained rows are at most 2,880 × 90 per
   symbol; in practice the distinct vendor quote timestamps (O-18).
2. Bar cycles: **288 transactions per day** (O-19). The 288 counts bar-cycle transactions, not
   statements. Each 5-minute cycle adds one symbol to `GetBarsMulti` and, when bars come back, one
   `InsertBars` call (`:1382-1383`, `:1425-1432`). `InsertBars` is one transaction with one INSERT
   per bar (`marketdata_repo.go:78-111`), about 2 to 3 daily bars per cycle
   (`minIngestLookback`, `marketdata_service.go:1372`), so about 576 to 864 row upserts into
   `marketdata.ohlcv`. Real statement volume is therefore about 3,456 to 3,744 per symbol per day,
   9 to 18% above the accepted 3,168 headline. This is a relabel, not a changed bound. Feature 291's
   dead-symbol hold (`internal/service/bar_hold.go:47-77`) drops symbols that keep returning nothing.
3. FMP classification: 0 while `marketdata.classification.enabled=false`. When true, one
   `FetchSector` per warm symbol per 24 h against the shared 250/day cap
   (`internal/service/classification_service.go:82`, `:199`), which is |W_new|/250 of the budget.

The figures scale linearly with `stream.warm_interval_ms` and `stream.bar_ingest_interval_ms`. Each
extra `stream.bar_ingest_timeframe` entry adds another 288 (`marketdata_service.go:1392-1403`).

**(e) Caveats, as listed in the ruling.**

- `GetBarsMulti` paginates once one cycle returns more bars than the request limit. The limit is
  `barsLimit()` (`internal/alpaca/client.go:413-418`, used at `:672-674`, token loop `:708-711`),
  which is `marketdata.backfill.batch_size` (default 1000, `cmd/server/main.go:93`), capped at
  10,000 (`client.go:29`). At the default and about 3 bars per symbol the threshold is about 330
  warm symbols in total. This re-derives the round-5 figure; the earlier cite read the limit as a
  literal 1000.
- The FMP 250/day cap is a tripwire.
- `GetSymbolServability` and `markWarmIfServable` fail open before the first asset load
  (`asset_servability.go:96-99`, `:107-124`), so unservable symbols can warm in that window.
- O-9 residual: if the multi-quote call fails (`marketdata_service.go:1246-1259`), the fallback
  makes one vendor call per warm symbol every 30 s (`:1262-1280`).

**(f) Tripwires.** Re-check the bound before changing either key:

- `marketdata.classification.enabled = true`;
- `opportunity.max_universe_size` (namespace `analysis`) > 100. It is SetConfig-bounded to
  [1,1000], and at 1000 the per-viewer term is about 950. This is the only name this spec uses for
  the key (O-20).

**(g) Watch signals, checked on dev after deploy.** `marketdata.db.pool.{acquired,empty_acquire_wait}`
and `marketdata.ohlcv.out_of_memory_errors{op=insert_bars}` (`docs/runbooks/ohlcv-lock-budget-tuning.md`).

**(h) Records and follow-up.** Step 5 adds the row to
`services/xstockstrat-marketdata/docs/context-constitution-findings.md`. The structural fix is the
follow-up TTL-prune feature named in § Step Dependencies.

### Observed on staging at spec time (an observation; it does not change the accepted bound)

Read through the staging agent's `list_opportunities` tool (the same `ListOpportunities` RPC) on
2026-11-20, with `page_size` 1000, for one account:

- The queue held **487 rows over 396 distinct symbols** in one page, with
  `opportunity.max_universe_size = 100` and `marketdata.classification.enabled = false` (staging
  config, read the same day). The curated term dominates: Q_u = 487, so the per-viewer snapshot
  term (b) is **437 rows, not 50**.
- 380 distinct symbols rank below row 50. Of those, 188 are neither strategy-attributed nor held
  anywhere in the queue, so 188 is the estimate of |W_new| for this one viewer under D-7. At the
  accepted figures that is 188 × 2,880 = 541,440 quote upserts and 188 × 288 = 54,144 bar
  transactions per day (595,584 headline).
- 396 symbols is above the about-330 `GetBarsMulti` pagination threshold in (e).
- **Side effect of this measurement.** That read ran the full-window enrichment once, so it may
  have added up to those symbols to staging marketdata's warm set until its next restart. This is
  the same effect the feature will have for every watchlist viewer.

The operator accepted the formula, and this spec does not reopen it. The observation is recorded
because the design's worked example ("at the default the term is 50") understates a real account
by about 9×.

## Payload (O-11)

Bytes per 15 s poll are rows × B_row, per open watchlist detail.

- **B_row ≈ 921 bytes** (mean; median 934; range 490 to 2,501), from the compact JSON of the 487
  staging rows above. `ListOpportunities` sets no `sparkline`
  (`grep -n sparkline services/xstockstrat-analysis/app/handlers/servicer.py` → no hits), so rows
  carry the scalar fields plus about one `ConditionEval`.
- **About 448 KB per poll** for that account (487 rows), against about 46 KB for today's top-50
  read: roughly 10×, or about 1.8 MB per minute uncompressed.
- **Not measured as design.md asked.** The figure comes from the agent's snake_case JSON of the
  same RPC, not from a dev BFF Connect-JSON body, because this run had no browser session on dev.
  Field names differ in length (camelCase), so treat it as ±10%. § Post-Deploy Verification takes
  the BFF figure. O-11 stays open until then.

---

### Step 1 — test: Namespace editor admin gate (AC-1 e2e)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/namespace-editor-admin-gate.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness

**Codebase Evidence**:
- Auth helpers: `e2e/helpers/auth.ts:83` (`addAuthCookie`, no roles) and `:88` (`addAdminCookie`);
  both imported together at `e2e/config-ui/namespace-editor-rows.spec.ts:3`.
- Non-admin notice model: `e2e/config-ui/sources.spec.ts` "a non-admin sees the admin-only notice,
  not the table" (`addAuthCookie`, then `getByText('Admin only')`).
- Edit-driving selectors: `e2e/config-ui/namespace-editor-rows.spec.ts:98-103`
  (`row.getByRole('button', { name: 'Actions' })`, `getByRole('menuitem', { name: 'Edit' })`,
  `getByPlaceholder('Reason for this change')`, `getByRole('button', { name: 'Save' })`).
- Row fixtures and stub bodies: `CONFIG_KEY_STUB_ROWS`, `listKeysStubBody`, `setConfigStubBody`
  from `e2e/fixtures` (`namespace-editor-rows.spec.ts:5,10-14,90-93`).
- `/api/auth/me` is the real Next route in e2e (`src/app/api/auth/me/route.ts:6-15`); no spec
  mocks it today (`grep -rn "api/auth/me" e2e` → two comments in `e2e/insights/backfills.spec.ts`).
- The BFF denial text is `Admin scope required` (`src/lib/bffShared.ts:64-68`), rendered as
  `Save error: …` (`NamespaceEditor.tsx:357-359`); the non-admin denial is already asserted at the
  API level in `e2e/config-ui/api-smoke.spec.ts:194`.
- Break radius, grepped: every spec that clicks the namespace editor's Edit already uses
  `addAdminCookie` (`value-persists-after-save`, `reason-capture`, `edit-focus`, `env-gate`,
  `secret-editing`, `notify-commsgun-keys`, `namespace-nav.spec.ts:81`,
  `namespace-editor-rows.spec.ts:94,130,163`). The `addAuthCookie` tests in `namespace-nav.spec.ts`
  and `namespace-editor-rows.spec.ts` assert read-only display only.
- **Not found**: any e2e test asserting a non-admin sees no Edit in the namespace editor.

**Lands with**: `Step 2`

**TDD**: `red-green required`. Reds on today's code: 1a (the Actions button exists and no notice is
shown) and 1b (the trigger is enabled while `/api/auth/me` is pending). 1c and 1d are
"red N/A — characterization" (they pass today and must keep passing).

**Covers**: `AC-1`

**Instructions**:
1. Create the spec with `test.describe('Config-ui namespace editor admin gate (feature 325)')`.
   Stub `ListKeys` with `listKeysStubBody([CONFIG_KEY_STUB_ROWS.tradingState, CONFIG_KEY_STUB_ROWS.example])`
   and open `/config-ui/platform?env=staging`, as `namespace-editor-rows.spec.ts:47-53` does.
2. Case 1a `@AC-1` (non-admin, `addAuthCookie`): the `tradingState` row is visible with its value;
   `page.getByRole('button', { name: 'Actions' })` has count 0;
   `page.getByText('Admin only: read-only view')` is visible exactly once; no
   `Save error` text is on the page.
3. Case 1b (loading): `addAdminCookie`, and hold `**/api/auth/me` with a `page.route` handler that
   awaits a promise the test resolves. While held, the row's Actions button is disabled. After
   release (`route.continue()`), it is enabled and the Edit menu item opens the editor.
4. Case 1c (fail-open, admin): `addAdminCookie`, `page.route('**/api/auth/me', …)` fulfilling
   status 500. The Actions button is enabled, Edit opens the editor, and a save with a stubbed
   `SetConfig` (`setConfigStubBody()`) closes the form, as at `namespace-editor-rows.spec.ts:98-110`.
   No `Admin only` notice is shown.
5. Case 1d (fail-open, non-admin, legibility): `addAuthCookie`, `/api/auth/me` fulfilling 500, no
   `SetConfig` stub so the real BFF answers. Edit → fill value and reason → Save shows
   `Save error: Admin scope required`. This is the accepted fail-open path (D-1, R-2): AC-1's Given
   is a settled non-admin identity, which 1a covers.
6. Test data (C-12): rows and stub bodies come from `e2e/fixtures`, auth from `e2e/helpers/auth`.
   The 500 body and the held-route promise are scenario one-offs and stay inline. No new fixture,
   so `INVENTORY.md` is unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec playwright test e2e/config-ui/namespace-editor-admin-gate.spec.ts   # 4 cases executed, 0 skipped
pnpm run lint && pnpm exec tsc --noEmit
grep -n "from '../fixtures'\|helpers/auth" e2e/config-ui/namespace-editor-admin-gate.spec.ts
pnpm run test:coverage        # vitest floor (≥ 40% on src/lib/**) still holds
```
No coverage threshold applies to `xstockstrat-ui` e2e (spec-template table: n/a). This unit
touches no file under `src/lib/**`, so the vitest floor is expected to be unchanged.

---

### Step 2 — service: Gate the namespace editor's Edit action on the admin bit

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness

**Codebase Evidence**:
- `NamespaceEditor.tsx:38-52` (`EditState`, with `isNativeEnv: boolean` at `:48`), `:54-60`
  (`EditContext`, `useEditContext`), `:143-191` (`ActionsCell`: reads the context at `:144-145`,
  trigger `:149-167`, the ungated Edit item `:164`, Save disabled off-native-env `:174`).
- `COLUMNS` at module scope with its constraint comment: `:193-223` (AC-11 `@feature-219`).
- Component: `:232-233` (`isNativeEnv`), `:244` (`useConfigKeys`), `:249` (`useSetConfig`),
  `editState` `:293-316` (`isNativeEnv` at `:303`), provider `:319`, the off-native-env notice
  `:336-343`, the table card `:361-372`.
- `useIsAdmin()` and `useCurrentUserId()` share the `['auth-me']` query:
  `src/hooks/useLiveStrategies.ts:42-54` (non-ok `/me` → `{}`, `staleTime` 5 min), `:61-64`, `:67-70`.
  Neither is imported in `NamespaceEditor.tsx` today.
- The config-ui segment has a `QueryClientProvider` (recon.md:30).
- Sibling gate shape: `src/app/config-ui/sources/page.tsx:51,61-62`
  (`const { data: isAdmin, isLoading: adminLoading } = useIsAdmin(); … <CardNotice>Admin only</CardNotice>`).
- `CardNotice`: `src/components/shared/CardNotice.tsx:5-11` (C-17 primitive, `variant` default `muted`).
- Server authority, unchanged: `src/lib/configUiBff.ts:39` (`requireAdminScope(claims)`).

**Lands with**: `Step 1`

**TDD**: `red-green required` (green = the Step 1 cases passing against this step)

**Covers**: —

**Instructions**:
1. Add `type EditGate = 'loading' | 'edit' | 'readonly';` and an `editGate: EditGate` field to
   `EditState`, beside `isNativeEnv` (`:48`).
2. In `NamespaceEditor`, import `useIsAdmin` and `useCurrentUserId` from
   `@/hooks/useLiveStrategies` and derive the gate (D-1):
   - `loading` while the `['auth-me']` query has not settled (`isLoading`);
   - `readonly` when it settled with a user id and `isAdmin` is false;
   - `edit` otherwise: an admin, or a settled query with no user id (`/me` failed, fail-open).
   Put `editGate` into `editState` beside `isNativeEnv` (`:303`).
3. `ActionsCell` (`:143-167`): read `editGate` from the context. `readonly` renders no trigger;
   `loading` renders the trigger with `disabled`; `edit` is today's markup. Leave the Save/Cancel
   branch (`:168-188`) as it is.
4. When `editGate === 'readonly'`, render one
   `<CardNotice>Admin only: read-only view</CardNotice>` above the table card (`:361`). Import
   `CardNotice` from `@/components/shared/CardNotice`. No new color, component or variant (C-17).
5. Keep `COLUMNS` and every cell at module scope (`:193-195`). Do not gate anything for admins:
   secret rows, the off-native-env Save rule and the per-user scope behave as today (R-2,
   fails.md 2026-08-21 `config-secrets-and-scoping`).
6. Do not change `configUiBff.ts`; `requireAdminScope` stays the authority.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint && pnpm exec tsc --noEmit
pnpm exec playwright test e2e/config-ui     # the new spec plus every existing namespace-editor spec
grep -n "const COLUMNS" "src/app/config-ui/[namespace]/NamespaceEditor.tsx"   # still one module-scope declaration
grep -n "requireAdminScope" src/lib/configUiBff.ts                            # unchanged, line 39
```

---

### Step 3 — test: Watchlist queue-membership drain (AC-2 e2e) and its queue fixture

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlist-queue-membership.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- The shared mock never paginates and returns no `page`: `e2e/mock-backend.ts:964-1037`
  (`listOpportunities`; symbol filter `:980-986`; response `:1030-1037`). It must stay single-page
  (`e2e/insights/opportunities.spec.ts:107-111`).
- Per-test paging route precedent: `e2e/insights/opportunities.spec.ts:112-136`
  (`mockOpportunitiesPaged`: reads `req.page?.pageToken` as an integer offset, emits
  `page.nextPageToken`). The server pages the same way
  (`services/xstockstrat-analysis/app/handlers/servicer.py:4687-4691`, `:4744-4745`).
- Raw `page.route` bodies must be Connect-JSON; rows without `validUntil` avoid the BigInt and
  Timestamp traps: `e2e/fixtures/opportunities.ts:95-122` (`LYFT_SOURCE_LABEL_OPPORTUNITIES`),
  `opportunities.spec.ts:22-30` (`toJson`), fails.md 2026-08-31 (feature 167).
- Seeded watchlist with bound rows: `e2e/insights/watchlist-readiness-list.spec.ts:14-34`
  (`mockWatchlists(page, seed)` with `strategyId: 'strat-live-001'`); helper
  `e2e/helpers/watchlistMock.ts:62-67`. Its `GetWatchlistReadiness` route resolves any symbol
  (`watchlistMock.ts:270`).
- Request-body matching: `e2e/trader/position-detail.spec.ts:1139-1143` (`req.postDataJSON()`).
  The browser transport sends JSON (`src/lib/browserClients/transport.ts:56-58`).
- Fake clock precedent: `e2e/insights/watchlists.spec.ts:704-752` (`page.clock.install()`,
  `page.clock.fastForward(10_000)`).
- In-queue badge selector: `data-testid="in-queue"` inside `readiness-row-<SYMBOL>`
  (`src/components/insights/WatchlistReadiness.tsx:337,377`; used at `watchlists.spec.ts:457-461`).
- `TEST_USER_ID`: `e2e/fixtures/users.ts:9`. Fixture barrel: `e2e/fixtures/index.ts:22`.
- Inventory: the opportunity rows are at `e2e/fixtures/INVENTORY.md:42-47`.
- **Not found**: a queue fixture above 50 rows, and any test for a symbol ranked beyond page 1 in
  the watchlist (recon.md:87, 95).

**Lands with**: `Step 4`

**TDD**: `red-green required`. Reds on today's code: Case A (the page-1 read sends `pageSize` 50,
so index 60 is absent and no badge renders), Case B (same, and no request carries `pageSize`
1000) and Case C (the badge never appears). Each is an assertion failure, not an import error:
the spec imports nothing Step 4 creates.

**Covers**: `AC-2`

**Instructions**:
1. `e2e/fixtures/opportunities.ts`: export `membershipQueueRows(count, placed = {})`, returning
   `count` Connect-JSON-safe `Opportunity` rows in rank order. Filler symbols are generated
   (`Q0000`, `Q0001`, …); `placed` maps a row index to the symbol to put there. Each row has
   descending `conviction`, `strategyId: ''`, `source: 'watchlist'`, `provenance: ['watchlist']`,
   `opportunityKey` `u1|<SYMBOL>|`, and no `validUntil`, following
   `LYFT_SOURCE_LABEL_OPPORTUNITIES`. It is **not** added to `OPPORTUNITIES`.
2. `e2e/fixtures/INVENTORY.md`: add a canonical row after the `LYFT_SOURCE_LABEL_OPPORTUNITIES`
   row (`:45` on `fb52065c`; place by symbol if the line moved) (symbol `membershipQueueRows`,
   module `e2e/fixtures/opportunities.ts`, shape `xstockstrat.analysis.v1.Opportunity`
   Connect-JSON for `page.route` bodies only, consumer the new spec).
3. Create the spec. A local helper routes
   `**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities`: it reads `page.pageSize`
   (default 50) and an integer-offset `page.pageToken` from the JSON body, slices the rows, and
   returns `{ opportunities, page: { nextPageToken } }` with the next offset or `''` (D-5). It
   records every request body. Each case seeds one watchlist through `mockWatchlists` whose
   bindings use `strategyId: 'strat-live-001'` and `userId: TEST_USER_ID`, and opens
   `/insights/watchlists` with `addAuthCookie`.
4. Case A `@AC-2`: `page.clock.install()` first. A 70-row queue with the target symbol at index
   60. The target's `readiness-row` shows `in-queue` with the text `in queue`. Then count only the
   recorded requests whose body has `page.pageSize === 1000` (O-12): exactly 1 before any clock
   advance. `page.clock.fastForward(15_000)` then yields a second one (the 15 s cadence, D-2).
5. Case B: a 3,500-row queue with one bound symbol at index 2,400 and another at index 3,200. The
   first shows `in-queue`; the second does not. Exactly 3 requests carry `pageSize` 1000, with
   `pageToken` absent or `''`, then `'1000'`, then `'2000'` (D-3: token following and
   `MAX_MEMBERSHIP_PAGES`).
6. Case C: `page.clock.install()`. Start as Case A and wait for the badge. Switch the route to
   answer `{ opportunities: [], computing: true }`, `fastForward(15_000)` and wait for the next
   `pageSize` 1000 request. The badge is still visible and the readiness rows still render
   (previous data kept; PRESERVE `@AC-2`/`@AC-3` `@feature-181`). Drive the refetch in place, never
   with `reload()` (fails.md 2026-08-25).
7. Test data (C-12): queue rows come from `membershipQueueRows`; the target symbols, row counts
   and the `computing` body are scenario one-offs and stay inline. Use target symbols that are in
   neither `OPPORTUNITIES` nor the reserved sentinels (`INVENTORY.md:72-91`).

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec playwright test e2e/insights/watchlist-queue-membership.spec.ts   # 3 cases executed, 0 skipped
pnpm run lint && pnpm exec tsc --noEmit
grep -n "from '../fixtures'\|helpers/auth\|helpers/watchlistMock" e2e/insights/watchlist-queue-membership.spec.ts
grep -n "membershipQueueRows" e2e/fixtures/opportunities.ts e2e/fixtures/INVENTORY.md
pnpm run test:coverage        # vitest floor (≥ 40% on src/lib/**) still holds
```
No coverage threshold applies to `xstockstrat-ui` e2e (spec-template table: n/a). This unit
touches no file under `src/lib/**`, so the vitest floor is expected to be unchanged. The flake
check for the fake-clock cases runs in Step 4's Verification, where they are green.

---

### Step 4 — service: Derive watchlist in-queue from a bounded queue-membership drain

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useOpportunities.ts` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- `src/hooks/useOpportunities.ts:25-51`: parameter defaults `:26-29` (`minConviction = 0`,
  `sources = []`, `OpportunityActionTag.UNSPECIFIED`, `OpportunitySort.CONVICTION`), key `:33`,
  request `:35-42` (`pageSize: 50`), stop rule `:44-48`, `refetchInterval: 15_000` `:49`.
  `useQuery` is already imported (`:1`). `['opportunities']` invalidation after
  Take/Dismiss/Snooze: `:65-71`.
- Callers of `useOpportunities` (grepped): `src/components/copilot/CopilotRail.tsx:38`,
  `src/components/insights/WatchlistDetail.tsx:72`, `src/components/insights/SignalReadiness.tsx:33`,
  `src/app/trader/positions/[symbol]/page.tsx:201`, `src/app/insights/opportunities/page.tsx:126`.
  None changes signature.
- `WatchlistDetail.tsx`: import `:32`, stale docstring `:51-54` ("The opportunity queue hook is
  called above any early return"), `useOpportunities()` `:72`, the Set `:91-93`,
  `inQueue={inQueue}` `:367`. `oppData` has no other use in the file.
- `WatchlistReadiness.tsx`: React import `:2`, prop `inQueue?: Set<string>` `:191,201`,
  `bound`/`unbound` `:241-242`, `pageBound` `:249`, `useWatchlistReadiness` call `:254-259`, the
  early return `:273`, `queued` `:329`, badge `:376-378`. Unbound rows (`:407-435`) render no badge.
- `WatchlistReadiness` has one caller: `WatchlistDetail.tsx:364`
  (`grep -rn "<WatchlistReadiness" src`). `inQueue` appears in no test
  (`grep -rn inQueue e2e src` → only these two files).
- Default query options: `staleTime: 5_000, retry: 1` (`src/lib/queryClient.ts:22`). The normy
  normalizer rewrites objects keyed by `strategyId` (`queryClient.ts:5-11`), so the query data
  must be a `string[]` (R-5).
- No cache writer assumes a shape under `['opportunities']`:
  `grep -rn "setQueriesData\|getQueriesData\|setQueryData" src` → only
  `src/hooks/useWatchlists.ts:140,180` on `WATCHLISTS_KEY` (O-2, re-grepped).
- BFF route, unchanged: `src/lib/insightsBff.ts:63` (`listOpportunities: forward(…)`). No new
  outbound RPC, so header propagation is unaffected.
- The Copilot rail renders nothing unless toggled on (`CopilotRail.tsx:101`), so its
  `useOpportunities(0)` (`:38`) is the only other queue read on this page (D-6).
- Server behaviour the drain relies on: no `page_size` clamp (`servicer.py:4688`), full read then
  slice (`:4743-4745`), every no-rows branch kicks a recompute (`:4792`).

**Lands with**: `Step 3`

**TDD**: `red-green required` (green = the Step 3 cases passing against this step). The
`QUEUE_DEFAULT_FILTERS` hoist is "red N/A — no behavior change"; its characterization is the
existing `e2e/insights/opportunities.spec.ts` suite in this step's Verification.

**Covers**: —

**Instructions**:
1. `useOpportunities.ts`, hoist (D-4): export `QUEUE_DEFAULT_FILTERS` (`as const`) holding the
   four defaults at `:26-29`, and make `useOpportunities` take its parameter defaults from it. No
   caller changes and the query key at `:33` stays byte-identical for every existing call. Spread
   the readonly `sources` where a mutable `string[]` is required.
2. `useOpportunities.ts`, hook (D-2, D-3): add `useQueueMembership(enabled: boolean)`, a plain
   `useQuery<string[], Error>`:
   - key `['opportunities', 'membership']`;
   - the query function calls `analysisClient.listOpportunities` with `QUEUE_DEFAULT_FILTERS`,
     `symbol: ''` and `page: { pageSize: 1000, pageToken }`, and follows
     `page.nextPageToken` until it is empty or `MAX_MEMBERSHIP_PAGES = 3` pages have been read;
   - if any page has `computing` or `computeFailed`, throw, so the previous data is kept;
   - return the symbols upper-cased, unique and sorted;
   - `enabled`, `retry: false`, `refetchInterval: 15_000`.
   Name the two request-shape constants in the file (`MEMBERSHIP_PAGE_SIZE`,
   `MAX_MEMBERSHIP_PAGES`); they are not operator settings (F-07). Add a ≤2-line comment stating
   the constraint: past 3,000 queue rows the badge is silently absent, and the badge is a cue, not
   an authority.
3. `WatchlistReadiness.tsx`: remove the `inQueue` prop (`:191,201`). Call
   `useQueueMembership(bound.length > 0)` beside `useWatchlistReadiness` (`:254`), above the early
   return at `:273`. Derive `queued` (`:329`) from the returned list; build the lookup once per
   data change, not per row. The badge markup (`:376-378`) is unchanged.
4. `WatchlistDetail.tsx`: delete the `useOpportunities` import (`:32`), the call (`:72`), the Set
   (`:91-93`) and the `inQueue` prop (`:367`), and drop the docstring sentence at `:53` that the
   deletion orphans.
5. Refetch triggers, intended (O-3): the 15 s interval (paused in hidden tabs), refocus or mount
   once stale (5 s), and the `['opportunities']` invalidation at `:68`. Mounts dedupe on the one key.
6. RPC delta (D-6): the watchlist page issues 2 `ListOpportunities` per poll only while the
   Copilot rail is toggled on; otherwise 1, because the drain replaces the page-1 read.
7. Do not touch `CopilotRail.tsx`, `SignalReadiness.tsx`, the Opportunities page or the
   symbol-filtered read (R-1, R-3; PRESERVE `@feature-187`, `@feature-213`, `@AC-15 @feature-215`).

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint && pnpm exec tsc --noEmit
pnpm run test:coverage        # vitest floor (≥ 40% on src/lib/**) still holds
pnpm exec playwright test e2e/insights/watchlist-queue-membership.spec.ts \
  e2e/insights/watchlists.spec.ts e2e/insights/watchlist-readiness-list.spec.ts \
  e2e/insights/opportunities.spec.ts e2e/copilot.spec.ts e2e/trader/position-detail.spec.ts
pnpm exec playwright test e2e/insights/watchlist-queue-membership.spec.ts --repeat-each=10   # 30 runs, 0 failed, 0 flaky
grep -rn "inQueue\|useOpportunities" src/components/insights/WatchlistDetail.tsx   # expect no output
grep -rn "setQueriesData\|getQueriesData\|setQueryData" src                        # only useWatchlists.ts
```
The repeat run is the flake check for Cases A and C, which count `pageSize` 1000 requests under a
fake clock (impl-spec review 2026-11-20). The sibling specs are in the run because a data-source
swap reddened `watchlists.spec.ts` once before (fails.md 2026-09-16, feature 181); its in-queue
cases are at `:84` and `:448-465`.

---

### Step 5 — docs: Record the accepted warm-set cost and close the two UI findings

**Status**: `pending`
**Service**: `services/xstockstrat-marketdata/docs/`, `services/xstockstrat-ui/docs/`
**Files**:
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ui/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Marketdata findings: `## Latent bugs` table at
  `services/xstockstrat-marketdata/docs/context-constitution-findings.md:20-29` (columns Issue,
  Impact, Evidence). `grep -n "warm" …` finds only an unrelated open question at `:44`.
- UI findings: the namespace-editor row at
  `services/xstockstrat-ui/docs/context-constitution-findings.md:25` and the watchlist in-queue
  row at `:27`. The resolved-row form is strike-through plus
  `**RESOLVED <date> (feature NNN)**` (`:22`, `:23`, `:26`).
- Cost evidence: § Accepted Cost (O-5) above.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Marketdata findings, `## Latent bugs`: add one row. Issue: the warm set only grows between
   restarts, and since feature 325 a watchlist viewer's full-queue read warms every queued symbol.
   Impact: per newly warm symbol per day, 2,880 quote upsert statements and 288 bar transactions
   (about 2 to 3 row upserts each) on the 2-connection pool; with
   `marketdata.classification.enabled = true`, one FMP call per warm symbol per day against the
   250/day cap; `opportunity.max_universe_size` (namespace `analysis`) above 100 raises the
   per-viewer term. Name the operator ruling of 2026-11-20 and the proposed follow-up
   `marketdata-warm-set-ttl-prune`. Evidence: the `markWarm`, `markWarmIfServable`,
   `warmQuotesOnce`, `ingestRecentBars` and `InsertBars` symbols, cited by symbol name as the
   table's other rows do.
2. UI findings: mark the rows at `:25` and `:27` resolved in the file's strike-through form, with
   the date the step lands and `(feature 325)`. For `:27`, state that membership now comes from
   `useQueueMembership`.

**Verification**:
```bash
grep -n "feature 325" services/xstockstrat-ui/docs/context-constitution-findings.md          # two rows
grep -n "warm set\|max_universe_size" services/xstockstrat-marketdata/docs/context-constitution-findings.md
git diff --stat -- services/   # only the two findings files
```

---

## Post-Deploy Verification (dev) — not an execute step

Run after the `main-dev` deploy and record the results in `context.md`.

1. As a non-admin, open `/config-ui/platform`: no Actions menu, one "Admin only: read-only view"
   notice. As an admin: Edit and Save work.
2. Open a watchlist that holds a symbol ranked below row 50 of the same user's queue: its row
   shows "in queue".
3. O-11: in the browser network panel, record the transferred and uncompressed size of one
   `ListOpportunities` response with `page.pageSize` 1000, and the row count. Replace the estimate
   in § Payload.
4. Watch signals (g): `marketdata.db.pool.acquired`, `marketdata.db.pool.empty_acquire_wait` and
   `marketdata.ohlcv.out_of_memory_errors{op=insert_bars}`, before and 24 h after the deploy.
5. Confirm the two tripwire keys (f) are unchanged: `marketdata.classification.enabled = false`
   and `opportunity.max_universe_size` (namespace `analysis`) ≤ 100.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
