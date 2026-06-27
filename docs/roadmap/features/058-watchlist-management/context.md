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
