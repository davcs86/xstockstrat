# Context: config-ui-usability

**Feature**: `docs/roadmap/features/218-config-ui-usability/feature.md`
**Product Spec**: `docs/roadmap/features/218-config-ui-usability/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/218-config-ui-usability/implementation-spec.md`

---

## Session 2026-10-02 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (asked up front, recorded verbatim in intent):
  - Last-updated timestamp: **do the proto change now** (`ConfigKeyMeta.updated_at`). The
    audit-log-derived and skip alternatives were rejected.
  - Namespace selection: **replace the landing grid with a dropdown**; `/config-ui/[namespace]`
    is kept for deep links.
  - Description: **under the key, clamped**; the separate column is dropped.
  - Process: **full SDD pipeline** requested (no C-11 override).
- Focus-bug root cause found during intake: `NamespaceEditor`'s `columns` `useMemo` depends on
  `editValue`/`editReason`/`handleSave` (and `handleSave` is re-created every render). The
  tanstack `flexRender` treats each new `cell` function as a new component type, so both `Input`s
  remount on every keystroke and the value input's `autoFocus` re-fires.

- Development happens on the harness-assigned branch `ccr-8a11e328-8tlo4j` (PR #1207 → `main-dev`),
  not `feature/config-ui-usability`. This is a session constraint: the harness pushes only to that branch.

## Session 2026-10-02 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Pass 1 FAILED on criterion 9 (unchecked Open Questions, P-03). Fixed: decisions recorded, and
  ledger traps moved to a Known Traps section. Also fixed: FR-2 now specifies the shared header and
  the non-link breadcrumb; AC-6 is split (AC-13 added); AC-8 checks the visible text; AC-14 was added.
- Pass 2 PASS WITH WARNINGS. Both warnings were folded in: AC-12 now has a before/after `updatedAt`
  so the refresh assertion can fail, and FR-2 covers relabelling the audit-page breadcrumb (C-10).
- Overlap findings: none (CLEAN). Field 10 is free. Feature 217 also regenerates `packages/proto/gen`,
  so whichever merges second re-runs `./scripts/buf-gen.sh`.
