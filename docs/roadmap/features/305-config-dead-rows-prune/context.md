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
