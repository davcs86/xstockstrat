# Context: config-dead-rows-prune

**Feature**: `docs/roadmap/features/305-config-dead-rows-prune/feature.md`
**Product Spec**: `docs/roadmap/features/305-config-dead-rows-prune/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/305-config-dead-rows-prune/implementation-spec.md`

---

## Session 2026-11-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the story text in `296-fix-config-keys-contract/design.md` §1.
- Number `305` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh`.
- **Provenance:** slice **C** of the four-way split of feature 296 (operator decisions, 296 `context.md` rounds 2–5); `Type: feature`; the `/sdd-story` bug guard (`SKILL.md:274`) is not triggered (planned slice created on the operator's explicit direction). FR-9 and AC-7/13/14 of 296 moved here (296's IDs are retired, never reused).
- Operator decisions inherited: cap of 5 signed tuples (`ledger/stream.notify_enabled` 1 staging tuple; `analysis/opportunity.sparkline_bars` 2; `marketdata/alpaca.paper` 2; hashes dedupe across the staging DB and fresh); `platform/log_level` and `trading/risk.daily_loss_limit` re-owned to feature 306; baseline owner string for the three entries is `feature 305`.
- Ledger read (`fails.md`): 295 test-blast-radius entry recorded as a Known trap in Open Questions.

## Session 2026-11-09 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (tree: main-dev @ 885297f; PR #1479 / feature 304 not yet merged — docs-only phases first).
- First pass FAIL (criterion 9: 3 open `- [ ]` questions). Resolved into `## Resolved Decisions`; added **FR-6** (remove `services/xstockstrat-indicators/app/maintenance/config_allow296.py` + test + CLAUDE.md paragraph + runbook note — the known gap carried from 304, operator-assigned, confirmed unowned elsewhere) and **FR-7** (stale refs: 3 service CLAUDE.md rows, ledger durable `fix-config-keys-drift.feature` @AC-15 "still exists", `configServiceImpl.ts:141` bounds entry); AC-9/AC-10 added; AC-6 "five", AC-8 Given named.
- Warnings carried:
  - [ ] C-05: name each key's seed migration (ledger/marketdata 001/002, analysis 028) in the spec or design.
  - [ ] FR-7: design must disposition the `configServiceImpl.ts:141` bounds entry (remove vs keep; must not read as a reader against FR-3).
  - [ ] AC-10: ledger @AC-15 supersession is a **C-16 CHANGE needing operator sign-off**; check the `@superseded-by-*` tag convention and record sign-off here.
- Overlap findings: no duplicate keys; baseline entries disjoint from 306. **Gap (needs operator confirmation, not written):** no `merge-order.md` row pairs 305↔306 (shared `check-config-wiring.mjs`, `config-wiring.test.mjs`, `config-wiring.json`) and nobody claims config migration 046 (305, 306, 280 all draw from it).
- Execute-time dependency: the Loki evidence export (FR-4) is an operator action; the sequential run must pause for it.
- Recommended design depth: full (config migration deleting prod/staging rows; overlap findings).
