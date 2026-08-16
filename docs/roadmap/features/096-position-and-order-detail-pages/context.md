# Context: position-and-order-detail-pages  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: Completed the two dedicated high-fidelity detail pages the Nocturne handoff specified that feature 083 left as a row-click Sheet and a read-only card: a new `/trader/positions/[symbol]` page (risk-framed header, stat grid, candlestick with avg-cost/stop overlays, per-symbol orders table, risk sidebar) and an upgraded `/trader/orders/[id]` ticket page (ticket-grammar layout, functional Replace/Cancel for working orders). Every rendered value was sourced from data the platform already returned; handoff fields with no backend source (thesis, target, R:R, realized-P&L) were deliberately omitted and deferred to feature 095. All six steps were written and shipped in a single session via one integration PR (#855 to `main-dev`).

**Why (irrecoverable rationale)**: `GetPosition` was wired through the trader BFF (additive handler) rather than filtering `listPositions` client-side for two reasons: `listPositions` returns a paged response with edge cases, and reading a different RPC than the parity source would muddy C-10(b) valuation parity (both surfaces must read the same authoritative RPC). The Exposure row-click Sheet was kept as a quick peek alongside the new page because it serves a fundamentally different interaction pattern — the Sheet can't be linked, bookmarked, or accommodate the Manage/chart layout at fidelity. The owning strategy field was derived from the most-frequent `strategyId` across the position's orders because `Position` carries no `strategy_id` field, degrading to "—" gracefully.

**Rejected alternatives**: Filter `listPositions` client-side by symbol (paging edge cases; different RPC muddies C-10(b) parity). Keep Position as a Sheet only (can't be linked or bookmarked). Second mobile `SectionRenderer` tree (DRY violation). Fabricate thesis/target/R:R to match mockup 1:1 (rejected on P-03; deferred to feature 095).

**Scars & gotchas**: Implementing all steps and shipping a single integration PR in the same session that authored the spec bypassed the per-step status-flip flow. CI's `ci-validate-feature-status.yml` auto-promote skipped this feature silently. Fix: flip step statuses to `done` and `status.md` to `code-completed` BEFORE pushing any integration PR. `GetPosition` existed in `portfolio.proto:11` but had no handler in `traderBff.ts` and no mock in `e2e/mock-backend.ts` — every new BFF RPC needs a mock added in the same step. Chart overlays (avg-cost line, stop-price line) use `Position.avg_cost` and `Position.stop_price` — fields from the authoritative `GetPosition` RPC, NOT derived from the marketdata quote path. Feature 095's "no real-time price source for the chart" risk applies to the live price tick overlay, NOT to the avg-cost/stop overlays. A future developer must not conflate these two distinct overlay types.

**Permanent deviations**: design implied per-step PRs → shipped as single-session integration PR #855. No code diverged; only process/tracking docs deviated.

**Cross-feature signal**: A follow-up feature was explicitly spawned on 2026-08-10 to consolidate the two 096 pages (`/trader/positions/[symbol]` and `/trader/orders/[id]`) into a unified per-symbol page. Feature 096's code shipped under the narrower two-page scope per user decision — the consolidation is a named planned follow-on, not a missed AC.

**Deferred follow-ons**: Thesis/target/R:R/realized-P&L fields (require feature 095 backend sources). Consolidation of the two detail pages into a unified per-symbol page (spawned 2026-08-10).

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-08-16 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: none beyond what was already captured in prior features.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at e91d40029e7d114e5d52c8c6d2ebdf9ea357a9fc.
