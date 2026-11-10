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

## Session 2026-11-09 — cross-feature note from 305 design (docs-only)

- Operator decision recorded in `305-config-dead-rows-prune/context.md` (design gate, AskUserQuestion, davcs86, 2026-11-09): the `seeded-unread` baseline entry `ledger` / `stream.notify_enabled` is **re-owned from feature 305 to this feature**. 305 keeps the row (the operator declined the C-16 CHANGE of 295 @AC-15 / 304 @AC-12), so 305 can never close the entry.
- Edited here (docs-only, before this feature's `/sdd-review`): FR-6 (two → three entries), the Open Questions line, `acceptance.feature` @AC-6 Given/Then, `feature.md` summary. No code or baseline change; the owner string in `scripts/config-wiring.json` flips to `feature 306` in 305's step S2.
- Ordering: 305 merges before FR-6 closes here (otherwise 305's AC-8/AC-10 "still present / still exists" would go red). A delete of this row is a C-16 CHANGE of 295 @AC-15 and 304 @AC-12 and needs fresh operator sign-off. `membership()`'s `/^feature (305|306)\b/` regex and the baseline-3 `/^feature (305|306)$/` exemption already cover 306; once 305 has no entries the `305` branch is live only through the gate-7 fixture — a cleanup that fits this feature (it edits the same files).

## Session 2026-11-10 — operator decisions at /sdd-review product-spec (first pass FAIL, fixes applied)

- First `/sdd-review product-spec` pass: FAIL on criterion 9 (3 open questions) and criterion 8 (@AC-5 malformed). No lifecycle change.
- Operator decisions (AskUserQuestion, davcs86, 2026-11-10): FR-6 = **delete all three rows** (`platform`/`log_level`, `trading`/`risk.daily_loss_limit`, `ledger`/`stream.notify_enabled`). Deleting `stream.notify_enabled` is a C-16 CHANGE of 295 @AC-15 and 304 @AC-12: the operator chose delete, but the exact scenario edits still need a fresh sign-off before any step touches those scenarios. `platform`/`log_level` has a UI surface to check at design.
- Spec fixes applied: @AC-5/@AC-1/@AC-2 rewritten as observable outcomes, @AC-6 extended, FR-3 now owns the WARN-free evidence (@AC-7), FR-1/FR-5 made testable, anchors refreshed, deletion-migration strategy stated (next free config number, 047 as of today, shared with 280), the done ledger-parenthetical task dropped, open questions closed or moved to design.
- Overlap note (feature-overlap): merge-order row 305/306/280 does not yet name `dormantAlias.test.ts` or the `047` owner; not edited (operator decision pending).

## Session 2026-11-10 — sdd-review product-spec (second pass)

- Product spec approved. Status: draft → spec-ready. Warnings: UI surface for the deleted `platform`/`log_level` row (design); update the trading `CLAUDE.md` `risk.daily_loss_limit` row (added to FR-5's file list); anchors refreshed (`tools.py:1833-1838`, `trading.go:2270-2277`); poller exception sites `configServiceImpl.ts:703-710,:751,:786` and `canonical` still used at `:183,:189` to be reconciled at design/spec.
- Overlap findings: no key/proto collision; config migration `047` is contended with 280 (first to merge takes it); `dormantAlias.test.ts` and the owner-string hand-off are not named in the merge-order row (operator decision pending); 304 is `code-completed`, so the earliest-start gate is unmet (execute precondition).
- Recommended design depth: full (3 services, reversible data migration, C-16 CHANGE, shared gate files).
