# Recon: ensure-signals-watchlist-on-read

**Created**: 2026-11-16
**From**: product-spec.md
**Tree**: ccr-1305a9de-7x1t7v@184c742 ≡ origin/ccr-1305a9de-7x1t7v (main-dev bd97b83 merged-in ancestor)
**Affected services**: xstockstrat-portfolio (code), xstockstrat-agent (docs/docstring only), xstockstrat-analysis (unchanged callers), xstockstrat-ui (consumer, C-14 recon pass)

---

## Objective

Make `PortfolioService.ListWatchlists` idempotently ensure the caller's single system-managed "Signals" watchlist on first-page calls (empty `page_token`), fail-open, so every user — including those who never ingested a watchlist-direction signal (Homelab staging) — has it. The ensure reuses the existing `EnsureSystemManaged` path; no proto, config or schema change.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - `ListWatchlists` (thin read: `requireUserID` → `ListByUser`): `services/xstockstrat-portfolio/internal/service/portfolio_service.go:2246-2265`; page token read at `:2253-2256`; error → `CodeInternal` at `:2259`.
  - Identity: `requireUserID` `portfolio_service.go:2143-2149` (empty → `InvalidArgument "missing user identity"`).
  - Handlers: connect `internal/handler/portfolio_handler.go:182-188`; gRPC adapter `:339-345` (`toGRPCError`).
  - Store interface `WatchlistStore` `portfolio_service.go:1987-2012` (`ListByUser` 1990, `EnsureSystemManaged` 2005); impl `internal/repository/watchlist_repo.go:65-84` (single `INSERT … ON CONFLICT (user_id) WHERE system_managed DO NOTHING RETURNING`, fallback `SELECT`, then `GetByID` → `listBindings`; pool-based, no tx, 2–3 round trips + bindings query even when the list already exists).
  - `ListByUser` `watchlist_repo.go:107-156`: keyset on `watchlist_id` ASC (random uuid order, **not** creation order); `pageSize` ≤0 or >500 → 100; batch bindings via `bindingsByWatchlist` `:162`.
  - `EnsureSignalWatchlist` `portfolio_service.go:2206-2216`; `signalWatchlistDefaultName = "Signals"` `:1982`; **max_per_user not enforced on this path** (enforced only in `CreateWatchlist` `:2186-2193`, default 50 `:1978`).
  - Delete guard `portfolio_service.go:2421-2423` (`FAILED_PRECONDITION`).
  - Last migration: `018_watchlist_signal_expiry` → next would be 019 (not needed).
  - Only in-service caller of `ListByUser`/`ListWatchlists` is `ListWatchlists` itself.
- **`xstockstrat-agent`** (Python) — docs only
  - "(read-only)" wording ×3: `services/xstockstrat-agent/app/tools.py:33` (header), `:2153-2161` (tool docstring → MCP/`/api/tools` description via `app/main.py:124-143`), `docs/runbooks/mcp-tools.md:1380-1396` (heading `### \`list_watchlists\`` must stay — `tests/test_tools_endpoint.py:141-144`). Sibling `get_watchlist` also says "(read-only)" (`tools.py:34,2171`, runbook `:1402`) but is not changed by this feature.
  - No test asserts the docstring text; the "six inventory surfaces" are tool-*count* surfaces and are untouched by a rewording.
  - `client.list_watchlists` `app/client.py:416-432` — no change.
- **`xstockstrat-analysis`** (Python) — unchanged callers
  - `app/engine/live_loop.py:592-623` `_drain_watchlist` (owner's `x-user-id` via `owner_metadata`, `app/identity.py:6-10`, never `system`); `app/handlers/servicer.py:5995-6027` `_drain_watchlist_bindings` (forwarded `propagation_meta`, or `owner_metadata(uid)` on daily refresh/materializer). An empty list adds no `(symbol, strategy)` pairs; no test asserts a list count (only stub `await_count`).
- **`xstockstrat-ui`** (Next.js) — consumer
  - Hook `src/hooks/useWatchlists.ts:33` (`listWatchlists({ page: { pageSize: 50 } })`, no pagination, key `['watchlists']`); BFF passthrough `src/lib/insightsBff.ts:138`.
  - **Behavior changes with an always-present empty Signals list** (not in the product spec):
    1. `/insights/watchlists` auto-select effect `src/app/insights/watchlists/page.tsx:41-55` picks `watchlists[0]`; for a user with no other list Signals is auto-selected (and its position is uuid-order, backend-defined).
    2. Empty state `page.tsx:136` ("No watchlists yet…") becomes unreachable in production.
    3. Screener "Add top N to…" picker `src/app/insights/screener/page.tsx:545` has **no `systemManaged` filter**; `handleAddTopN` `:168-171` would write MANUAL entries into the system list.
  - `trader/positions/[symbol]/page.tsx:174-183` scans bindings — no-op for an empty list. No client sort/cap. `pageSize: 50` with no pagination: with 50 user lists + Signals, one list lands on page 2 unseen (backend decision).
  - e2e: `e2e/insights/watchlists.spec.ts:57-61` asserts the empty state against a mock seeded `[]`; mock `e2e/helpers/watchlistMock.ts:108-110` never injects Signals itself; specs seeding a system list: `watchlists.spec.ts:331-401`. No vitest touches watchlists.

## Patterns to REUSE

- Ensure on read → reuse `WatchlistStore.EnsureSystemManaged` (`portfolio_service.go:2005`, impl `watchlist_repo.go:65`), exactly as `EnsureSignalWatchlist` does (`portfolio_service.go:2206-2216`); no new store method, so the interface and both implementers (`WatchlistRepo`, `fakeWatchlistStore`) are unchanged.
- Fail-open WARN → reuse the `refuseUnservable` pattern: `slog.WarnContext(ctx, "<RPC>: …", "error", err)` and continue (`portfolio_service.go:568-581`; read-path analog `:794`). Existing convention: WARN-only, no telemetry counter for watchlist degradations.
- Unit test scaffolding → `newSvc`/`ctxWithUser`/`fakeWatchlistStore` `internal/service/watchlist_service_test.go:329,334,32`; wire-test pattern `portfolio_grpc_wire_test.go:77` (`TestWire_DeleteSystemManagedWatchlist_F127AC7`) with `NewWireTestService` `export_test.go:19`. Gap: the fake has no error-injection hook for `EnsureSystemManaged`/`ListByUser` (add an `ensureErr` field — no other file affected) and its `ListByUser` ignores page token/size and iterates a map (unordered).
- Doc edits → follow the runbook's existing sentence on system lists ("An emptied system-managed list remains", `docs/runbooks/mcp-tools.md:1414`).
- UI (if a filter/empty-state change is chosen) → reuse the existing `systemManaged` field already typed at `src/components/insights/WatchlistDetail.tsx:48`; e2e state via `e2e/helpers/watchlistMock.ts` (C-12).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-6 @FR-2 @FR-7 @feature-127` "EnsureSignalWatchlist is idempotent and coexists with a same-named manual list" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`) — ensure is flag-based, idempotent, one system list per user; must hold under concurrent first-page calls and the ingest auto-add.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-127` "A watchlist-direction signal adds the symbol to the caller's system-managed watchlist" (`docs/sdd/business-rules/platform.feature`) — lands in the same ensured list, no duplicate list (282 @AC-5 supersession for unservable symbols stays).
- **PRESERVE** `@AC-2 @FR-6 @feature-127`, `@AC-3 @FR-4 @feature-127` (`docs/sdd/business-rules/platform.feature`) — the ensure creates an empty list, never a binding.
- **PRESERVE** `@AC-7 @FR-8 @FR-9 @feature-127` "A system-managed watchlist cannot be deleted via API or UI" (`docs/sdd/business-rules/platform.feature`) — ensured list is `system_managed=true`; rename/add/remove stay enabled.
- **PRESERVE** `@AC-6 @FR-3 @feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — `manage_watchlist` delete of the signals list still raises `FAILED_PRECONDITION`.
- **EXTEND** `@AC-1 @FR-1 @FR-5 @feature-148` "list_watchlists returns only the caller's own lists, paginated" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — adds the case "a user with no Signals list sees one on first-page calls"; RPC args, `watchlists`/`next_page_token` shape and caller-only scope unchanged. Becomes **CHANGE** if page boundaries/`next_page_token` round-trip break with `limit 1`.
- **PRESERVE** `@AC-2 @FR-2 @FR-4 @feature-178` "Watchlist bindings resolve in one query" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`) — the ensure adds no per-list or N+1 query.
- **PRESERVE** `@AC-2 @FR-2 @feature-167` (portfolio) and `@AC-6 @FR-5 @feature-167` (ui) `watchlist-single-strategy-update.feature` — `system_managed` flag stable; UI adds no refetch/invalidation of `['watchlists']` to surface the list.
- **PRESERVE** `@AC-8 @FR-10 @feature-127` (`services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — provenance badge only for SIGNAL entries, with an always-present (possibly empty) list.
- **PRESERVE** `@AC-18 @FR-2 @feature-281`, `@AC-4 @FR-3`, `@AC-5 @FR-4` (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`) — provenance validation only on the system list; the prune never deletes or special-cases the (empty) list.
- **PRESERVE** `@AC-4 @FR-3 @feature-148` `manage_watchlist create` owned by caller, no body `user_id`; `@AC-4 @FR-3 @feature-127` (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`) — fail-open precedent (WARN carrying the original gRPC code).
- **PRESERVE** `@AC-2 @FR-2 @feature-180`, `@AC-6 @FR-4 @feature-191` (analysis), `@AC-1 @FR-1`/`@AC-3 @FR-3 @feature-154` (portfolio+analysis fundsignal universe) — an empty list contributes no symbols/bindings.
- No CHANGE identified.
- **Unguarded (no @AC exists)**: per-user cap behavior of the ensure; the `/insights/watchlists` empty state and screener picker contents; the agent/UI "zero watchlists" state. Residual blind spot: `docs/sdd/business-rules/platform.feature` (~2,600 lines) was keyword-grepped, not read in full.

## Dependencies

- Proto/RPC: none (`ListWatchlistsRequest.page` already carries `page_size`/`page_token`; `Watchlist.system_managed` exists).
- Migration: none (`011` partial unique index `watchlists_user_system_uidx` is the race-safe conflict target); next number would be 019.
- Config keys: none (`portfolio.watchlist.max_per_user` is read only by `CreateWatchlist`; the ensure bypasses it by existing design).
- Inter-service edges: none new. Callers of `ListWatchlists`: agent (`app/client.py:416`), analysis (×2), UI BFF (`insightsBff.ts:138`) — all forward the user's own `x-user-id` (C-03 holds).
- New env vars / ports: none.
- CI: Go jobs 40% threshold, but `service/` and `repository/` are excluded from coverage (`docs/patterns/ci-overview.md:19,87`); `portfolio-db-test` (`dbtest` tag) covers `internal/repository/` — no dbtest exists for `EnsureSystemManaged`/`ListByUser`.

## Risks / Not-found

- **Not found**: any existing `ListWatchlists` unit/handler/wire test; any telemetry counter for watchlist fail-open outcomes (pattern is WARN-only); a dbtest for `EnsureSystemManaged`/`ListByUser`; an error-injection hook in `fakeWatchlistStore`; any UI pagination, sort, max-count, or `systemManaged` filter in the screener picker; any per-user-cap scenario.
- **Pagination/ordering trap**: random-uuid `ORDER BY watchlist_id` means a freshly created system list lands anywhere in the keyset. If ensure runs *after* `ListByUser` on page 1 the list is absent from that response; if *before*, it appears only if its uuid falls within the first page. The design must pick the ordering and a deterministic way for the first response to contain it (spec FR-1 requires "returned in the result"; FR-6 only relaxes *placement*, not presence — **spec tension to resolve**).
- **Cost on the hot read path**: `EnsureSystemManaged` always runs `INSERT…ON CONFLICT` (a write attempt) + `SELECT` + `GetByID` (+ `listBindings`) even when the list exists — 3+ round trips per first-page call, on a read RPC the UI polls and analysis drains per owner per cycle. A cheaper existence check (e.g. an ensure that skips the full load, or detecting `system_managed` in the already-loaded page) is a design question.
- **Write in a read RPC**: `ListWatchlists` is idempotent but no longer side-effect free; PgBouncer transaction pooling is fine for a single statement. No read-only DB role found in portfolio (only the backfill subcommand, `signal_expiry_backfill.go:203`).
- **Spec gap — UI consequences (3 above)** contradict the product spec's "UI: no code change" claim: auto-select Signals, unreachable empty state, screener picker writes into the system list. Needs an explicit decision (accept / filter picker / adjust auto-select), and corresponding AC scenarios if UI changes.
- **Page size**: UI requests `pageSize: 50` unpaginated; Signals counts toward the page.
- **fails.md trap (feature 127)**: `CreateWatchlist` collapses `UNIQUE(user_id,name)` to `CodeInternal`; ensure via `EnsureSystemManaged` only and log the **original** error; `normalizeBindings` silent field-drop is irrelevant here (no new binding field).
- **Overlap (rebase-only)** in `portfolio_service.go`: 311, 312, 315, 317, 323, 326 — design must check 326 (`CreateWatchlist` duplicate-name mapping), 312 (read-path identity — ensure must use the same `userID` as `ListByUser`), 323 (must not delete `EnsureSystemManaged`/repo helpers).
- **Rubric note**: `design-depth-rubric.md` escalates to full when ≥2 services (named consumer surfaces count) or any overlap finding fires; both do here, and the review recommended `quick`. Offered to the operator at the Phase 0 gate.

## Recommended Scope

1. portfolio `service`: in `ListWatchlists`, when `pageToken == ""`, ensure the caller's system list (reusing `EnsureSystemManaged`), fail-open WARN; resolve the presence/ordering/cost questions above.
2. portfolio `test`: first `ListWatchlists` unit tests (AC-1..AC-8) incl. an `ensureErr` hook on `fakeWatchlistStore`; one wire test; optional dbtest only if the repo contract changes.
3. agent `docs`: reword "(read-only)" at `tools.py:33,2154` and `mcp-tools.md:1382` (FR-7); keep heading and tool counts.
4. ui (decision-dependent): screener picker `systemManaged` filter and/or auto-select/empty-state handling + e2e/mock updates (C-12, C-17).
5. promote `@AC-*` scenarios into `services/xstockstrat-portfolio/acceptance/` at integration (C-16); extend agent `mcp-watchlist-tools.feature` @AC-1 via signed note if the pagination guarantee changes.
