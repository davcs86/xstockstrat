# Context: quote-fanout-batching

**Feature**: `docs/roadmap/features/178-quote-fanout-batching/feature.md`
**Product Spec**: `docs/roadmap/features/178-quote-fanout-batching/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/178-quote-fanout-batching/implementation-spec.md`

---

## Session 2026-09-04 — sdd-story

- Created from performance-audit Track C (`docs/reports/2026-09-04-performance-bottlenecks-audit.md`,
  findings 3.4, 2.5, 3.7).
- Lower-risk than 176/177: adopts an existing batch RPC (`GetLatestQuotesMulti`) and rewrites two
  query/loop shapes; no new proto, no new schema (unless the batch-RPC-field contingency fires).
- Known trap folded into Open Questions: the null-not-zero discipline (2026-08-16 defects) — a
  batched partial result must map an absent symbol to the same missing outcome the serial path
  produced, never a silent zero price/P&L.
- Independent of 176/177 and can be sequenced in parallel; grouped separately to keep the Go portfolio
  /marketdata diff distinct from the Python analysis work.

## Session 2026-09-04 — sdd-review product-spec

- FIRST PASS: FAIL. Blocker: spec claimed marketdata "already exposes a batch GetLatestQuotesMulti" — false. Verified: marketdata.proto exposes only singular GetLatestQuote (:23); GetLatestQuotesMulti is an internal Go MultiSymbolSource helper (internal/source/source.go:26, internal/alpaca/client.go), used by the warm poller, NOT a gRPC RPC.
- FIX: reworked to require a NEW additive GetLatestQuotes batch RPC on marketdata (wraps the internal helper). Updated Problem Statement, FR-1, Out of Scope, Proto Contract Changes (additive gate: buf lint + buf-gen + Proto Reviewer + marketdata owner), approval gates, acceptance AC-1 naming, feature.md summary/reviewers. Also corrected the source audit report's false claim (finding 3.4, priority list, Track C).
- RE-REVIEW: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings (advisory, to close in /sdd-design): exact GetLatestQuotes field set/message shape vs GetLatestQuote; single-flight keying consistency with the stale-refetch rate-limiter.
- Overlap: soft/rebase with feature 172 (fix-portfolio-max-drawdown-unenforced) on portfolio_service.go — different functions; not FAIL-class, no migration/proto/config clash. Flag at /sdd-spec so 178's read-path edits reconcile against 172's landed enforcement code. No merge-order entry required.
