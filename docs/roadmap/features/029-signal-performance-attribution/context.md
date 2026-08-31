# Context: signal-performance-attribution

**Feature**: `docs/roadmap/features/029-signal-performance-attribution/feature.md`
**Product Spec**: `docs/roadmap/features/029-signal-performance-attribution/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/029-signal-performance-attribution/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 029.
- Requires proto addition (GetAttribution RPC) and additive DB migration (signal_id column on orders).
- Key design decision: winner-takes-all attribution by highest-weight signal in V1; fractional multi-signal attribution deferred to V2.
- Practical dependency: needs 20+ closed paper trades before metrics are meaningful.

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated `product-spec.md` to the current template (section order, C-14 Consumer Surface checkboxes, split Acceptance Criteria) **in place** — kept feature number **029** and directory `029-signal-performance-attribution`; no new numbered dir created.
- Preserved all existing scope: 7 FRs unchanged, all affected services, the non-breaking proto change (`GetAttribution` RPC + additive `signal_id` field on order submission) and the additive DB migration (nullable `orders.signal_id` + composite index `orders(signal_id, status, closed_at)`) intact; both open questions carried forward.
- Moved the previously inlined `## Acceptance Criteria` numbered list out into new `acceptance.feature` (9 `@AC-*` scenarios, every FR-N covered); the spec section is now a C-15 pointer only.
- Added a "Known traps" block to Open Questions from the Ledger: attribution lives on the order not the position (exit-cooldown insight), owner-scope every attribution query (131 IDOR fail), ordinal conviction ≠ cardinal weight (mpt/023), source-enum-subset propagation (signal-source-registry), P&L parity across read paths (056/C-10(b)). Status left at `draft`.

## Session 2026-08-31 — sdd-review fixes (product-spec)

`/sdd-review product-spec` returned **FAIL**; applied every item. Status stays `draft` (number/slug unchanged).

- **Fractional-attribution reconciliation (BLOCKER).** Resolved the self-contradiction between Out-of-Scope and `@AC-5`. Committed **V1 = winner-takes-all by highest input weight, with an equal split ONLY on an exact tie**. FR-3 rewritten to say so; Out-of-Scope now reads "fractional attribution across *non-tied* multi-signal inputs is V2; the exact-tie equal split is the only V1 fractional case"; `@AC-5` renamed to flag it as the only V1 fractional case and cross-references AC-4 (winner-takes-all).
- **FR-1 phantom service.** Committed FR-1 to the analysis `GetAttribution` gRPC RPC; deleted the "insights service HTTP endpoint" alternative. Clarified everywhere that `/insights` is a **segment of `xstockstrat-ui`**, not a service.
- **FR-2 ↔ FR-3 modeling gap + 042 reuse (DRY).** Reframed FR-2 from a lone scalar `signal_id` (which can't carry a multi-source weight vector) to persisting the **signal-attribution inputs** (contributing source(s) + per-source input-weight vector) on the order at submission. Directed reuse of feature 042 (`042-order-snapshots-pnl-patterns`, **launched**) `SignalEntry { name, value, source }` / `OrderSnapshot` shape rather than a parallel one. Added a Design-Phase Decision to reconcile 029's `GetAttribution` with 042's existing `QueryPnLPatterns` / `FactorType.FACTOR_TYPE_SIGNAL` / `SignalEntry` / `OrderSnapshot` (reuse-vs-new RPC).
- **DB schema-name corrections (code-grounded against real migrations).**
  - Removed the phantom `orders(signal_id, status, closed_at)` index — **`closed_at` does not exist** on `trading.orders`. New candidate index over existing columns: `orders(user_id, signal_id, status)` + the real fill timestamp `filled_at` (added by trading migration `008`); exact index resolved at `/sdd-spec`.
  - Fixed `ingest.signals` → **`ingest.newsletter_signals`** (the real table); noted `ingest.signal_sources` has **no `id`** column — PK is `slug TEXT`, join is `newsletter_signals.source = signal_sources.slug`. Deleted the illegal three-way cross-schema raw SQL join (per-service ownership + gRPC-only); storage/composition (gRPC edges vs. single-service derived/materialized table) is a Design-Phase Decision.
  - Stated the paired `NNN_*.down.sql` is required (**C-07**); the nullable attribution-column migration continues from the last file `009_offline_position_baselines` → **`010`**.
- **Trading C-3 / C-5.** Added a "Trading Service Impact" note: C-3 — feature is mode-agnostic / paper-testable (changes no execution path); C-5 — attribution reads position-level realized P&L, so partial-vs-full fill status is unaffected.
- **Open Questions reorganization (criterion 9).** `## Open Questions` now reads "None — resolved or moved below" (no unchecked `- [ ]` remain). The fractional question is resolved inline; the storage-model and 042-reconciliation questions moved to a new `## Design-Phase Decisions (owned by /sdd-design)` section (plain bullets); the five Ledger known-traps moved to a new `## Design Guardrails` section.
- **Proto scope kept accurate.** `GetAttribution` + messages are additive to `analysis.proto` (new RPC/messages, no `Opportunity` field change → no field-number collision with 095/110); the trading order-submission attribution inputs are additive (`buf breaking` stays green).
- Consistency edits to `acceptance.feature`: `@AC-3` reworded from "signal_id" to "signal-attribution inputs"; `@AC-5` clarified as the exact-tie / only-V1-fractional case. All `@AC-*`/`@FR-*` tags and coverage preserved.
