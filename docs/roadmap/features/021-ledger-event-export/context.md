# Context: ledger-event-export

**Feature**: `docs/roadmap/features/021-ledger-event-export/feature.md`
**Product Spec**: `docs/roadmap/features/021-ledger-event-export/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/021-ledger-event-export/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 021.
- No proto changes required; HTTP-only addition to ledger service.
- Two open questions deferred to /sdd-spec: nginx proxy vs. direct port, and which UI hosts the download button.

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated product-spec.md to the current C-14/C-15 template (added Consumer Surface, Proto/Config/DB checkboxes, Feature Workflow Notes; moved the inline acceptance list out to acceptance.feature and left only the pointer).
- Authored acceptance.feature with 9 `@AC-*` scenarios; every FR (FR-1…FR-8) is covered by ≥1 tagged scenario.
- Preserved all existing scope verbatim — every FR, both config keys, affected services, out-of-scope items, and both original open questions carried over unchanged; no requirements invented or dropped.
- Added two "Known trap" open questions from the ledger (config-key native type off WatchConfig; ledger global-sequence ordering). Kept feature number 021 and status `draft`.
