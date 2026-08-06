# Context: open-positions-ui  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped a paginated/filterable positions page with symbol/side server-side filters, price/P&L enrichment on `ListPositions` (previously only `GetPortfolio`/`GetPosition` had it), and a read-only FR-4 lineage drill-in that queries ledger `order.filled`/`order.partially_filled` events client-filtered by symbol/account/mode — no new "slot" entity, no proto RPC for lineage (context.md:33-41, 203-214).
**Why (irrecoverable rationale)**: The product spec's premise (`trade.filled` event) was fictional — grepping the codebase never surfaces an event that doesn't exist, only a person re-verifying against the emitter catches it. It was caught twice independently (sdd-spec then again at formal sdd-review), which is itself the signal that this class of error survives a first review pass (context.md:47-51, 80-84). The account_id-forwarding fix was deliberately deferred to execute-time user approval rather than silently fixed at spec time, because it changed observable filter behavior beyond the stated feature scope (context.md:117-118, implementation-spec.md:156-160).
**Rejected alternatives**:
- Modeling "position slot" as a first-class entity — lost because FR-4 only needed a read-only join; a new entity was unwarranted scope for a lineage-viewing feature (product-spec.md:102-104).
- Adding a P&L-sign filter field to `ListPositionsRequest`/SQL — lost in favor of client-side filtering over the now-enriched `unrealizedPnl`, since enrichment already had to happen in the service (implementation-spec.md:140-141).
**Scars & gotchas**:
- Portfolio CI coverage excludes `repository`/`service`/`handler`/`cmd`/`telemetry` packages entirely (ci.yml:229) — new filter/SQL logic there is invisible to the coverage gate; the only way to get real signal is extracting pure helpers (`sideOf`, `enrichPosition`) into a measured surface (context.md:62-65, implementation-spec.md:195-202).
- Adding a helper function before it has a production caller trips `golangci-lint unused` — forced `sideOf` out of Step 3 into Step 4 alongside its test, purely to keep each stacked PR independently lint-green (implementation-spec.md:463-473).
- Playwright dev-server cold-compile can exceed 320s and time out locally, unrelated to the feature itself — CI's production-bundle run is the real gate, not local `pnpm test:e2e` (implementation-spec.md:475-479).
- Docker daemon unavailable in the execute session — host-toolchain codegen pinned to CI's `proto-freshness` versions is the sanctioned fallback, but host `buf`'s bundled descriptors introduce unrelated diff noise (`timestamp.ts` doc comments) that must be manually reverted before commit (context.md:123-124, implementation-spec.md:457-461).
**Permanent deviations**:
- design said "add predicates to each of 4 SQL variants" -> shipped one dynamic predicate builder -> because 4 hardcoded variants combinatorially explode once symbol/side become optional (implementation-spec.md:463-467). [DUP:docs/roadmap/ledger/fails.md:36]
- design said mirror `GetPortfolio`'s enrichment inline -> shipped a separate `enrichPosition` helper duplicating that math rather than a shared extraction -> because Step 3 needed a testable, measured-package surface given the coverage exclusion (implementation-spec.md:161-166). [DUP:docs/roadmap/ledger/fails.md:36]
**Cross-feature signal**: - Merge-order coordination on shared `traderBff.ts`/`connectClients.ts` (with 055) worked as designed — 056 waited for 055's merge, confirmed no stale evidence at execute time (context.md:107-108, 119-121).
**Deferred follow-ons**: - A first-class "position slot" abstraction, if ever wanted, is explicitly out of scope here and left for a future feature (product-spec.md:103-104).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
