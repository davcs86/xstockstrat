# Context: watchlist-management

**Feature**: `docs/roadmap/features/058-watchlist-management/feature.md`
**Product Spec**: `docs/roadmap/features/058-watchlist-management/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/058-watchlist-management/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md.
- Feature 1 of 6 in the screener initiative (058 watchlist → 059 fundamentals-data → 060 screener →
  061 agent-tool → 062 fundamentals-signal-producer → 063 fundamentals-scoring-model).
- **Numbering note**: assigned `058` = max-existing(`057`)+1. The repo has duplicate numbers `020`
  and `052`, so the sdd-story count-based formula would have produced `059` and orphaned `058`; the
  number was assigned by max+1 instead to keep clean sequential numbering and match the design labels.
- Derived from a read-only screener gap-analysis exploration + multi-session design. Key decisions:
  watchlists mode-agnostic, hard-delete + ledger audit, owned by portfolio, universe resolved at the
  UI/agent layer (the screener RPC takes explicit symbols — decouples 058 from 060 at the RPC level).

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Blocker found and fixed: proposed migration `006_watchlists` collided with the already-applied
  `006_positions_day_pnl`; trunk migrations run 000–006. Renumbered to `007_watchlists` and corrected
  the stale "migrations 000–005" claim in Problem Statement to "000–006".
- Warnings: none.
- Overlap findings: no feature-vs-feature collisions with siblings 059–063 (disjoint protos, configs,
  migration dirs). The one feature-vs-trunk migration collision was resolved by the renumber (no
  merge-order row needed). Shared `xstockstrat-ui` insights parent dir with 060 is distinct files.

## Session 2026-06-27 — sdd-spec

- Generated implementation-spec.md with 10 steps. Status: spec-ready → implementation-ready.
- Delegated discovery to 3 codebase-discovery subagents (portfolio, ui-insights, config).
- Key codebase findings:
  - Portfolio last migration is `006_positions_day_pnl` → watchlists migration is `007` (confirmed).
  - Portfolio uses a Connect-handler + gRPC-adapter pattern: each new RPC needs a method on BOTH
    `PortfolioHandler` (internal/handler/portfolio_handler.go:21) and `grpcPortfolioAdapter` (:133).
  - `PortfolioRepo` pool is unexported with NO `Pool()` accessor (portfolio_repo.go:19-21) — the
    CLAUDE.md "TradingRepo.Pool()" note is about the trading service, not portfolio; Step 5 must add
    an accessor or keep WatchlistRepo in-package.
  - `PermissionDenied` is NOT yet used in portfolio (only InvalidArgument/NotFound/Internal mapped at
    portfolio_handler.go:212-223) — FR-2 ownership check introduces the first such path; adapter
    `toGRPCError` switch must be extended.
  - x-user-id via `middleware.FromContext(ctx).UserID` (:859); config via `s.cfg.GetInt(key, default)`
    (:531); ledger via `s.emitEvent(ctx, type, subject, data)` (:221, helper :627, non-fatal).
  - Insights BFF ALREADY wires PortfolioService (only listPortfolios) at insightsBff.ts:143-148 →
    watchlist RPCs need only new handler methods (no new gRPC transport). But the existing
    portfolioClient browser client is bound to `/trader/api`; a NEW `/insights/api`-bound
    `insightsPortfolioClient` must be added (mirror analysisClient.ts:5-6).
  - PORTFOLIO_ENDPOINT already set for xstockstrat-ui (compose:457, .do specs:423-424); no new env vars
    anywhere in the feature.
  - Config defaults are SQL-seed-migration only (no in-code map); next config migration is `006`;
    seed dev+production twins ending in ON CONFLICT (namespace,key,environment,trading_mode) DO NOTHING
    (template: 005_ingest_backfill_chunking.up.sql).
- All proto changes additive → no v2; buf breaking against feature branch.

## Session 2026-06-27 — sdd-review impl-spec (advisory)

- Impl-spec reviewed (spec-reviewer + feature-overlap). Verdict: PASS, 0 blockers. All cited symbols verified
  (PortfolioHandler+grpcPortfolioAdapter, unexported PortfolioRepo pool, toGRPCError first PermissionDenied path,
  insights BFF PortfolioService wiring). Advisory: Step 5 is a verbose multi-target step; Step 6 new logic lives
  in the CI-coverpkg-excluded service/ package (E2E + unit compensate — no real coverage hole).
- CONFIG-MIGRATION ORDERING (user-approved): 058 KEEPS `006_watchlist_config`. Three-way config-006 collision with
  059/062 resolved by pre-assigning ascending numbers (058=006, 059=007, 062=008). Because golang-migrate applies
  in numeric order, 058's config migration must merge BEFORE 059's and 062's. Recorded in merge-order.md.
- insightsBff.ts is shared with 060 (distinct router blocks) — rebase-only, no hard dep.

## Session 2026-06-29 — sdd-execute (all 10 steps)

Executed all 10 steps on `feature/watchlist-management` (branched from `main-dev`) as a single
feature branch (one integration PR, not per-step PRs). All verifications run locally.

- **Step 1 (proto)**: Added `Watchlist` message + 7 CRUD RPCs to `PortfolioService`. `buf lint` +
  `buf breaking` (against `main-dev`) pass — all additive.
- **Step 2 (proto-gen)**: Ran `./scripts/buf-gen.sh`. Toolchain pinned to the CI versions
  (`protoc-gen-go@v1.36.11`, `protoc-gen-go-grpc@v1.6.2`, `protoc-gen-connect-go@v1.19.2`,
  `grpcio-tools==1.80.0`, buf latest) so regen touches only the portfolio stubs. **Deviation**: two
  WKT files (`gen/ts/google/protobuf/timestamp.{ts,d.ts}`) also changed — a buf-bundled WKT-comment
  refresh surfaced by regeneration, unrelated to the feature. Committed because proto-freshness CI
  regenerates with the same buf and would otherwise flag them stale (see Deviation Log).
- **Step 3 (portfolio migration 007)**: Created `007_watchlists.{up,down}.sql`. Applied + rolled back
  on a real local Postgres 16 (full portfolio 000→007 chain) — tables created and dropped cleanly.
- **Step 4 (config migration 006)**: Created `006_watchlist_config.{up,down}.sql` (4 rows: 2 keys ×
  dev/production). Applied + rolled back on local Postgres — exactly 4 rows seeded/removed. Keeps the
  pre-assigned `006` (058→006, 059→007, 062→008 config-migration ordering).
- **Step 5 (service)**: `watchlist_repo.go` (reuses the existing pool via a new `PortfolioRepo.Pool()`
  accessor — no second pool, budget stays 2); watchlist methods + `WatchlistStore`/`watchlistConfig`
  interfaces + `normalizeSymbols` in `portfolio_service.go`; 7 handler + 7 adapter methods and a new
  `PermissionDenied` mapping in `toGRPCError`. `go build` + `golangci-lint` clean.
- **Step 6 (test)**: `watchlist_service_test.go` — AC-1 (round-trip + uppercase/dedupe), AC-2
  (ownership → PermissionDenied), AC-3 (symbol cap, per-user cap, lowered-cap honored next mutation),
  FR-6 (ledger failure non-fatal). New logic lives in the CI-coverpkg-excluded `service/` package;
  these unit tests + the Step 9 E2E provide behavioral verification. Tests + lint pass.
- **Step 7 (UI BFF)**: 7 watchlist handlers in the insights `PortfolioService` block (reuse
  `backendHeaders` for x-user-id/x-access-scope/x-trace-id) + new `/insights/api`-bound
  `insightsPortfolioClient.ts`. `tsc --noEmit` + `next lint` clean.
- **Step 8 (UI page+hooks)**: `useWatchlists.ts` (query + 5 mutation hooks, invalidate `['watchlists']`)
  and `insights/watchlists/page.tsx` (`'use client'`, AppShell). `next build` succeeds (35 routes).
- **Step 9 (E2E)**: `e2e/insights/watchlists.spec.ts` drives AC-5 (create → add 2 → remove 1 → delete)
  against a stateful `page.route` mock. Passed. (Env note: ran via a throwaway override config pointing
  Playwright at the pre-installed chromium-1194 — the image lacks the chrome-headless-shell build the
  pinned @playwright/test expects; override not committed.)
- **Step 10 (docs)**: Added `portfolio.watchlist.*` defaults to portfolio CLAUDE.md + a feature-058
  block in root CLAUDE.md § Config Governance Rules.

**Stopped at**: all complete → integration PR → `main-dev`.

## Session 2026-06-29 (CI: feature status automation)

- Promotion PR #729 merged to main
- Feature promoted and committed: e8742e4e4f4dd88cbbc6ed85151784c4434d4885
- Status updated: `code-completed` → `launched`
- Launched date: 2026-06-29
