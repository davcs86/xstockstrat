# Context: config-keys-alias-removal

**Feature**: `docs/roadmap/features/306-config-keys-alias-removal/feature.md`
**Product Spec**: `docs/roadmap/features/306-config-keys-alias-removal/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/306-config-keys-alias-removal/implementation-spec.md`

---

## Session 2026-11-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the story text in `296-fix-config-keys-contract/design.md` §1.
- Number `306` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh`.
- **Provenance:** slice **D** of the four-way split of feature 296 (operator decisions, 296 `context.md` rounds 2–5); `Type: feature`; the `/sdd-story` bug guard (`SKILL.md:274`) is not triggered (planned slice created on the operator's explicit direction). This is 296's FR-8 / AC-12 "named follow-up": its product spec removes the alias, the write tolerance and the internal-caller exception and declares `Depends on` feature 296 (and 304).
- Baseline entries re-owned here (operator decision, 296 round 4/5): `platform` / `log_level` (UI reader, never provably dead) and `trading` / `risk.daily_loss_limit` (documented future key — a product decision). Owner string `feature 306`.
- Ledger read (`fails.md`): 295 test-blast-radius entry recorded as a Known trap in Open Questions.
