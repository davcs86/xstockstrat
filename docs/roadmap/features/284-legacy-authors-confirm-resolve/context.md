# Context: legacy-authors-confirm-resolve

**Feature**: `docs/roadmap/features/284-legacy-authors-confirm-resolve/feature.md`
**Product Spec**: `docs/roadmap/features/284-legacy-authors-confirm-resolve/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/284-legacy-authors-confirm-resolve/implementation-spec.md`

---

## Session 2026-11-02 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Follow-up to `276-fix-legacy-formula-authors` (launched); extends `app/maintenance/legacy_authors_ops.py` only.
- Operator decisions (AskUserQuestion, 2026-11-02): mechanism = both `--map` and interactive picker; scope = unmappable + ambiguous; targets = active users in users.json only; process = full SDD (story + `/sdd-design quick`), not a 276 amendment.
- Next feature number computed as max(283)+1 = 284.
- Ledger read: no `fails.md` entry covers operator maintenance CLIs; nothing to carry.

## Session 2026-11-02 — open questions resolved

- Operator accepted all proposed defaults (OQ-1..OQ-4): ambiguous rows accept only matched candidates for both `--map` and the picker; `--map --yes` skips the second y/N; `--map` matches `old_author` exactly; no new PII exposure beyond `format_plan`.
- FR-2 amended to state the ambiguous-candidate rule; `@AC-6` already covers the picker side, `@AC-13` added for the `--map` side.
