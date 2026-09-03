# Context: watchlist-bulk-default-strategy

**Feature**: `docs/roadmap/features/170-watchlist-bulk-default-strategy/feature.md`
**Product Spec**: `docs/roadmap/features/170-watchlist-bulk-default-strategy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/170-watchlist-bulk-default-strategy/implementation-spec.md`

---

## Session 2026-09-03T18:14Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user story.
- **Grounding (pre-story codebase-discovery):** Watchlists are owned by `xstockstrat-portfolio` (Go,
  feature 058) — NOT analysis. All watchlist protos live in `packages/proto/portfolio/v1/portfolio.proto`.
  A per-**symbol** `strategy_id` binding already exists (`WatchlistBinding.strategy_id`,
  `watchlist_symbols.strategy_id` col from migration 008). `RemoveWatchlistSymbols` /
  `AddWatchlistSymbols` already accept `repeated` symbols, so bulk add/remove exists at the wire level;
  only a bulk **strategy-assignment** RPC and a watchlist-**level** default strategy are genuinely new.
  Highest portfolio migration = `014` → next is `015`. Strategy is a bare string (owned by
  `xstockstrat-analysis`) with no cross-service FK.
- **Requester decisions locked (via up-front questions before story):**
  1. Default strategy = **add-time only** (binds new bare symbols; no retroactive rebind; no read-time fallback).
  2. Bulk strategy assignment = **new atomic `UpdateWatchlistBindings` (plural) RPC** (transactional, single `updated_at`).
  3. Bulk delete = **symbols within a watchlist only** (reuses `RemoveWatchlistSymbols`); whole-watchlist bulk delete out of scope.
  4. Surfaces = **Insights UI + agent MCP tools** (`manage_watchlist`, `manage_watchlist_symbols`).
- **Ledger traps folded into product-spec Open Questions:** fails.md:1147 (ownership scoping on the
  bulk write), fails.md:37/056 (add-time default applied in *every* insert path, not one), fails.md:1372/112
  (bulk-selection state must reset on watchlist switch). Nav-reachability trap (058/060) is satisfied —
  this extends the already-registered `/insights/watchlists` page.

## Session 2026-09-03T18:20Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (spec-reviewer). Warning: criterion 9 — three resolved Ledger
  traps were mis-formatted as unchecked Open-Questions boxes. Reclassified them into a
  "## Design Must Address" block (each already covered by an @AC scenario), leaving one genuine open
  fork (agent bulk-assign: new operation vs dedicated tool) deferred to /sdd-design.
- Verified against code: proto next-free field numbers (Watchlist=10, CreateWatchlistRequest=5,
  UpdateWatchlistRequest=6), migration 015 free, plural `UpdateWatchlistBindings` ≠ singular
  `UpdateWatchlistBinding` (portfolio.proto:39, launched feature 167).
- Overlap findings: CLEAN (feature-overlap). Only in-flight peer is 084-droplet-compose-deploy
  (infra-only, no resource overlap). No merge-order row required.
