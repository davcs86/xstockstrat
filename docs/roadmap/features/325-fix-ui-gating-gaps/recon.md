# Recon: fix-ui-gating-gaps

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: main-dev@c4fd48b0 ≡ origin/main-dev (detached; no `feature/fix-ui-gating-gaps` branch on origin yet)
**Affected services**: xstockstrat-ui

---

## Objective

Close two `xstockstrat-ui` display gaps where the client does not reflect server truth. First, the
config-ui namespace editor offers the per-row Edit/Save to non-admins, who only learn at submit time
from the BFF's `requireAdminScope` ("Save error: Admin scope required"). Second, the watchlist "in queue"
badge is derived from the shared page-1 opportunity cache, so a queued symbol ranked below row 50 shows as
not queued. Both are UI-only. The server stays the authority, and no proto, migration or config change is needed.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - **Defect 1: namespace editor admin gate**
    - Edit item is ungated, and `useIsAdmin` is never imported in the file: `src/app/config-ui/[namespace]/NamespaceEditor.tsx:164`
      (`<DropdownMenuItem onClick={() => startEdit(k)}>Edit</DropdownMenuItem>`)
    - Module-scope `ActionsCell`, which reads `EditContext`: `NamespaceEditor.tsx:143-144`
    - `EditState` type: `NamespaceEditor.tsx:38` (already carries `isNativeEnv: boolean` at `:48`)
    - Save is already disabled off-native-env via the context flag: `NamespaceEditor.tsx:174`
    - `COLUMNS` must stay at module scope. An inline `cell` remounts the edit inputs on every keystroke (AC-11): `NamespaceEditor.tsx:193-195`
    - Component and provider value: `NamespaceEditor({ namespace, env, user, nativeEnv })` at `:232`, `editState` built at `:293-316`, `EditContext.Provider` at `:319`
    - Data hooks (react-query) already used in-file: `useConfigKeys` `:244`, `useSetConfig` `:249`
    - Config-ui segment has a `QueryClientProvider`: `src/app/config-ui/providers.tsx:2` re-exports `src/components/shared/QueryProviders.tsx:15`
    - Server gate (authoritative, unchanged): `src/lib/configUiBff.ts:39` `requireAdminScope(claims)` → `src/lib/bffShared.ts:64` → `hasAdminScope` `src/lib/auth.ts:100` (`rolesToAccessScope`, `:86-97`; only role `admin` sets `ADMIN_SCOPE`)
  - **Defect 2: watchlist in-queue flag**
    - Unfiltered, unpaged read: `src/components/insights/WatchlistDetail.tsx:74` (`useOpportunities()`)
    - Membership set from loaded pages only: `WatchlistDetail.tsx:93-95`. Passed down as `inQueue={inQueue}` at `:369`
    - Consumer: `src/components/insights/WatchlistReadiness.tsx:165,175` (prop `inQueue?: Set<string>`), `:299` (`inQueue?.has(binding.symbol.toUpperCase())`), `:344` (`<EnumBadge render={IN_QUEUE_CUE} testId="in-queue" />`)
    - Visible page bound computed inside the consumer: `WatchlistReadiness.tsx:223` (`afterCursor.slice(0, WATCHLIST_READINESS_PAGE_SIZE)`), with page size 25 at `src/hooks/useWatchlistReadiness.ts:12`
    - Hook: `src/hooks/useOpportunities.ts:25-51`. `useInfiniteQuery`, page size 50, `refetchInterval: 15_000`, key `['opportunities', minConviction, sorted sources, actionFilter, sort, symbol]`, 5th arg `symbol=''` (feature 215). `getNextPageParam` stops on `computing`/`computeFailed` (feature 185)
    - Shared page-1 cache consumer: `src/components/copilot/CopilotRail.tsx:38` (`useOpportunities(0)`)
    - Per-symbol precedent (feature 215): `src/app/trader/positions/[symbol]/page.tsx:189`, `src/components/insights/SignalReadiness.tsx:33`
  - Last migration: n/a (UI only, no migration)
  - Config-read pattern: n/a (no config key read or added)
  - Unit layer: vitest, node env, `src/**/*.test.ts`, coverage scoped to `src/lib/**` (no jsdom/component tests). An extractable pure helper would go under `src/lib/`.

## Patterns to REUSE

- UI admin check → `useIsAdmin()` at `src/hooks/useLiveStrategies.ts:61-63`. It returns `{ data: data?.isAdmin ?? false, ...rest }`, and `isLoading` is available. It reads `/api/auth/me` (`src/app/api/auth/me/route.ts:13`, `isAdmin = roles.includes('admin')`). That is equivalent to the BFF's `hasAdminScope`, because only `admin` sets `ADMIN_SCOPE` (`src/lib/auth.ts:94`).
- Sibling admin-gate shape → `src/app/config-ui/sources/page.tsx:51,62` (`const { data: isAdmin, isLoading: adminLoading } = useIsAdmin(); … if (!isAdmin) return <CardNotice>Admin only</CardNotice>;`). The same shape is in `src/app/config-ui/templates/page.tsx:342,400`.
- Gating a row action from module-scope cells → extend `EditState` the same way `isNativeEnv` is threaded (`NamespaceEditor.tsx:48` → `:303` → `:144`/`:174`). Do not move `COLUMNS` inline (`:193-195`, AC-11).
- "Admin only" notice primitive → `CardNotice` (C-17 state primitive, as used at `sources/page.tsx:62`).
- Per-symbol queue lookup → `useOpportunities`'s `symbol` argument and `ListOpportunitiesRequest.symbol = 6` (feature 215; `packages/proto/analysis/v1/analysis.proto:704-712`, comment "empty = all symbols; exact (normalized) symbol filter"). If many symbols are needed at once, the call reuses `analysisClient.listOpportunities` and the `['opportunities', …, symbol]` key family, so the existing `useSetOpportunityAction` invalidation of `['opportunities']` (`useOpportunities.ts:68-72`) still covers it.
- e2e auth helpers → `addAuthCookie` (no roles, non-admin) and `addAdminCookie` from `e2e/helpers/auth` (used together in `e2e/config-ui/namespace-editor-rows.spec.ts:3`).
- Non-admin "Admin only" regression model → `e2e/config-ui/sources.spec.ts:140`. BFF non-admin denial model → `e2e/config-ui/api-smoke.spec.ts:194` ("SetConfig is denied for a non-admin session").
- Opportunity mock already honours the symbol filter → `e2e/mock-backend.ts:942` `listOpportunities(req)`, where `pool` filters `OPPORTUNITIES` by `req.symbol` (`:957-963`, plus the SCHD/MYSZ symbol-only rows). Fixtures live in `e2e/fixtures/opportunities.ts` and are cataloged in `e2e/fixtures/INVENTORY.md` (C-12/C-13). Watchlist mocks are in `e2e/helpers/watchlistMock.ts`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @FR-1 @feature-155` "The in-queue marker is icon-coded consistently on watchlists and opportunities" (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`). Guarantees the watchlist readiness row for a queued symbol carries the shared in-queue badge, icon and info color. The fix changes only how membership is derived.
- **PRESERVE** `@AC-15 @FR-3 @feature-215` "Signal-detail shows the fundamentals-unavailable state regardless of queue rank" (`services/xstockstrat-ui/acceptance/block-fundamentals-strategy-on-etf.feature`). Guarantees the Signal-detail page uses the symbol-filtered `ListOpportunities`, independent of rank. This is the precedent for the watchlist fix, and that page must not regress.
- **PRESERVE** `@AC-2 @FR-2 @FR-5 @feature-187` "UI hook exposes Load More for manual progressive retrieval" (`services/xstockstrat-ui/acceptance/opportunities-pagination-drain.feature`). Guarantees the `useOpportunities` default issues 1 page request of 50, with `hasNextPage` and Load More.
- **PRESERVE** `@AC-3 @FR-5 @feature-187` "UI poll interval refetches all loaded pages" (same file). Guarantees the 15 s poll refetches all loaded pages.
- **PRESERVE** `@AC-5 @FR-2 @feature-187` "Small queue returns in a single page without Load More" (same file). Guarantees a small queue takes exactly 1 request.
- **PRESERVE** `@AC-7 @FR-7 @feature-187` "CopilotRail uses shared hook instead of direct RPC" (same file). Guarantees `useOpportunities(0)` shares the page-1 cache, and the watchlist fix must not change that cache key.
- **PRESERVE** `@AC-1 @regression @feature-213` "the Opportunities page issues a single ListOpportunities RPC for page 1" (`services/xstockstrat-ui/acceptance/fix-copilotrail-duplicate-rpc.feature`). Guarantees no extra page-1 `ListOpportunities` RPC and a shared cache.
- **PRESERVE** `@AC-14 @FR-7 @feature-190` and `@AC-15 @FR-7 @feature-190` "Changing a filter in place refetches without remounting" / "The client does not re-filter or re-sort the server result" (`services/xstockstrat-ui/acceptance/opportunities-server-side-filters.feature`). Guarantees the client does not re-filter the server result, so prefer server-side per-symbol filtering for watchlist membership.
- **PRESERVE** `@AC-1 @FR-1 @feature-181`, `@AC-2 @FR-1 @FR-5 @feature-181`, `@AC-3 @FR-2 @FR-6 @feature-181`, `@AC-4 @FR-3 @feature-181`, `@AC-6 @FR-7 @feature-181`, `@AC-7 @FR-2 @FR-3 @feature-289` (`services/xstockstrat-ui/acceptance/watchlist-readiness-list-ux.feature`). Guarantees the readiness list renders immediately and degrades per row. It also keeps page-bounded inline decoration with no client per-strategy fan-out, 25-row pagination, the C-17 skeleton and a11y, and the "formula not readable" state. Any new in-queue lookup must stay page-bounded and must not blank the list on failure.
- **PRESERVE** `@AC-9 @feature-156` "The config-ui trigger control is admin-gated" (`services/xstockstrat-ui/acceptance/fix-fundamentals-signal-producer.feature`). Guarantees non-admin requests are rejected at the admin-forwarding BFF gate. The UI gate must be additive, and `requireAdminScope` / `forwardAdmin` stay authoritative.
- **PRESERVE** `@AC-1 @FR-1`, `@AC-2 @FR-2`, `@AC-3 @FR-2`, `@AC-14 @FR-2` `@feature-219` (`services/xstockstrat-ui/acceptance/config-ui-usability.feature`). Guarantees namespace landing, combobox navigation with env and user preserved, deep link, env switcher, scope control and breadcrumb. All of these must still work for non-admins viewing read-only.
- **PRESERVE** `@AC-4 @FR-3`, `@AC-5 @FR-3`, `@AC-8 @FR-5`, `@AC-9 @FR-5` `@feature-219` (same file). Guarantees the per-row description, last-updated and tooltip display is unchanged.
- **PRESERVE** `@AC-10 @FR-6`, `@AC-11 @FR-6`, `@AC-12 @FR-7` `@feature-219` (same file). Guarantees the admin edit form keeps focus, and that Save refreshes the row and closes the form. The gating must not regress the admin edit path.
- **PRESERVE** `@AC-6 @FR-5 @feature-161` "the decay half-life key is registered and visible in config-ui with bounds" (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature:21-22`). Read-only key visibility stays for all users.
- **EXTEND**: this feature's own `@AC-1` (non-admin sees no Edit affordance, or an "Admin only" notice) and `@AC-2` (a watchlisted symbol ranked below the first page shows as in queue) add net-new regression cases. They promote at launch into `config-ui-usability.feature` and `watchlist-opportunity-signal-cues.feature` respectively.
- No CHANGE identified. `platform.feature` holds no rule on the namespace-editor admin gate or the watchlist in-queue flag. (`@AC-7 @FR-8 @FR-9 @feature-127` is the system-watchlist delete guard, which is unaffected.)

## Dependencies

- Proto/RPC: none. The fix reads the existing `ListOpportunitiesRequest.symbol = 6` (`packages/proto/analysis/v1/analysis.proto:711`), a single exact symbol. There is no multi-symbol `symbols` filter. Adding one would be a proto change, would touch `services/xstockstrat-analysis/acceptance/` (not read by this recon), and would escalate design depth.
- Migration: none
- Config keys: none
- Inter-service edges: none new (browser → ui BFF → analysis `ListOpportunities` already exists)
- New env vars / ports: none

## Risks / Not-found

- **Per-symbol fan-out vs the feature-181 "no client fan-out" guarantee.** N watchlist symbols means N `ListOpportunities` calls. `useOpportunities` cannot be called in a loop (hooks rule), so the fix needs `useQueries` or a new wrapper. That is a new pattern with no current `useQueries` use in `src/` (only historical comments in `src/hooks/useWatchlistReadiness.ts:9,31`). Feature 181 deliberately removed a per-strategy `useQueries` fan-out (fails.md 2026-09-16 `watchlist-readiness-list-ux`). Any per-symbol lookup should be bounded to the visible 25-row page, which is computed inside `WatchlistReadiness.tsx:223`, not in `WatchlistDetail`. It should degrade per row. The alternative, paging the whole queue with `fetchNextPage`, is unbounded and inherits the feature-185 computing/failed stop conditions. Design must pick one.
- **Shared cache key.** The empty-symbol key is the page-1 cache shared with CopilotRail (`@AC-7 @feature-187`, `@AC-1 @feature-213`). Per-symbol queries must use distinct keys. Whether `WatchlistDetail`'s unfiltered `useOpportunities()` (`:74`) can be removed or must stay is unknown (grep shows `oppData` used only at `:93-95`; verify in design).
- **Polling cost.** `useOpportunities` polls every 15 s. N per-symbol infinite queries at 15 s multiply the request rate, so design should decide the poll cadence for the per-symbol reads.
- **e2e sibling-spec fallout (fails.md 2026-09-16).** `e2e/insights/watchlists.spec.ts:84` and `:448-460` assert `in-queue` today against the unfiltered mock. When the derivation switches to per-symbol reads, those tests must still pass. The mock already filters by `req.symbol` (`e2e/mock-backend.ts:957-963`). AC-2 needs a >50-row queue, or a symbol absent from the unfiltered page-1 response but present under `symbol=` (for example a per-test `page.route` override or a symbol-only pool row like SCHD/MYSZ). The mock has no pagination support and no >50-row fixture today. New fixtures must be registered in `INVENTORY.md` (C-13).
- **Loading flash for admins.** `useIsAdmin` defaults `data` to `false` while `/api/auth/me` loads, so a naive gate hides Edit for admins on first paint. Existing admin e2e specs click Edit right after load (`namespace-nav.spec.ts:85-86`, `namespace-editor-rows.spec.ts:99-100,135-136,172-173`). Playwright auto-wait should absorb this, but the design should follow the `isLoading` handling in `sources/page.tsx:51`.
- **Existing Edit-driving specs already use `addAdminCookie`.** These are value-persists-after-save, reason-capture, edit-focus, env-gate, secret-editing, namespace-nav `:81`, and namespace-editor-rows `:94,130,163`. Non-admin (`addAuthCookie`) tests in `namespace-nav.spec.ts` and `namespace-editor-rows.spec.ts` assert read-only display only, so the gate should not break them. Re-verify in spec.
- **Stale comment.** `src/components/shared/PlatformHeader.tsx:43` claims `useIsAdmin` is "unavailable in /accounts and /config-ui". That contradicts `config-ui/providers.tsx` and the in-segment `useIsAdmin` uses in sources/templates. It is likely true only for the header's mount point. It is not a blocker, and it is out of scope unless design touches it.
- **Ledger trap (fails.md 2026-08-21 `config-secrets-and-scoping`).** A client-side write refusal duplicated server authz and blocked legitimate admin writes. The gate here must key on the same admin bit as the BFF (it does: `/api/auth/me` `roles.includes('admin')` ≡ `hasAdminScope`) and must not suppress anything for admins, including secret rows and off-native-env behaviour.
- Ledger reminder (fails.md 2026-08-25, feature 155): to prove RED on a refetch-dependent state, trigger the refetch in place, never with `reload()`.
- Findings log already records the defect 2 latent bug: `services/xstockstrat-ui/docs/context-constitution-findings.md:23`. Resolve that row at launch.
- Not read: `services/xstockstrat-analysis/acceptance/` (relevant only if a multi-symbol proto filter is chosen); `e2e/mock-backend.ts` beyond `:963`.
- Not found: no e2e test asserting a non-admin sees no Edit in the namespace editor, and no test for a symbol ranked beyond page 1 in the watchlist.

## Recommended Scope

Advisory and not binding. Both steps are UI-only, and both can ship in one PR.

1. **Namespace editor admin gate.** Call `useIsAdmin()` in `NamespaceEditor`, thread a `canEdit`/`isAdmin` flag through `EditState`, and gate the Actions/Edit item in `ActionsCell`. OQ1 decides between hiding the item and showing a `CardNotice`-style "Admin only" cue. Keep `COLUMNS` module-scoped. The e2e RED: a non-admin opens `/config-ui/marketdata?env=staging`, and no Edit menuitem is offered, or an "Admin only" cue is shown instead (AC-1).
2. **Watchlist in-queue by server truth.** Derive `inQueue` from per-symbol `ListOpportunities` reads bounded to the visible readiness page, using distinct `['opportunities', …, symbol]` keys and per-row degradation. Leave the empty-symbol page-1 key untouched. OQ2 is the alternative of paging the full queue. A multi-symbol proto filter escalates to full design. The e2e RED: a symbol absent from the unfiltered page-1 mock response but returned under `symbol=` renders `in-queue` (AC-2). Re-run `watchlists.spec.ts` in-queue cases.
