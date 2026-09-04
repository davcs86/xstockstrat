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
