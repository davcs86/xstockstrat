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

## Session 2026-10-02 — sdd-design

- Phase 0 Recon: wrote recon.md for xstockstrat-config, xstockstrat-ui and packages/proto.
  - Key reuse patterns: `ScopeControl` basePath + `router.push`; `protoTime.timestampToDate`;
    the `listKeysWire` / SQL-capture test harnesses.
- Phase 1 Grilling: 3 rounds. Quick mode mandates 1; the user asked for 2 more.
- Chosen approach:
  - a shared server `ConfigNamespaceView` on both routes, with `/config-ui` rendering platform
    directly (no redirect);
  - module-level DataTable cells reading an `EditContext` (the focus fix);
  - `NamespaceEditor` keyed by namespace|env|user, so a draft can't save into a different scope;
  - `ConfigKeyMeta.updated_at = 10` taken from the same `DISTINCT ON` row;
  - nav `aliases` so namespace pages highlight Settings › Config.
- Rejected:
  - redirecting to `/config-ui/platform` (breaks the exact-match nav highlight and AC-1);
  - refs/useMemo columns, a dialog editor, a mock namespace filter, shared-mock timestamp stamping;
  - hand-written Connect-JSON fixtures.
- User decisions:
  - timestamp semantics = **row last modified** (no `value_changed_at` migration);
  - breadcrumb = **plain-span branch in PageBreadcrumb**;
  - **nav aliases fix included** (not deferred).
- AC-2 wording amended to use the caller's own id (`test-user-001`), keeping the same ID, because
  `resolveConfigScope` clamps foreign ids.
- Constitution rules touched: C-09, C-10, C-12/13, C-14, C-15, C-16, C-17, C-18; F-01/04/06/07
  honored. Floor breaches: none.
- Status: spec-ready → design-approved.

## Open Threads

- [ ] Guard against inline cell arrows reintroducing the remount: module-scope comment + AC-11
  probe test (editor refactor step).
- [ ] AC-6/AC-13 are proven by SQL shape only; no DB harness (backend step).
- [ ] Feature 217 also regenerates `packages/proto/gen`; re-run `buf-gen.sh` if it merges first
  (proto step / merge).
