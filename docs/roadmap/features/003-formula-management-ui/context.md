# Context: formula-management-ui

**Feature**: `docs/roadmap/features/003-formula-management-ui/feature.md`
**Product Spec**: `docs/roadmap/features/003-formula-management-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/003-formula-management-ui/implementation-spec.md`

---

## Session 2026-05-10T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Story: persist in-memory indicator formulas to TimescaleDB, scope to user identity, add CRUD UI in xstockstrat-insights.
- Identified affected services: `xstockstrat-indicators`, `xstockstrat-insights`, `packages/proto`.
- Proto changes are additive only (new RPCs + messages) — non-breaking.
- New DB table `indicators.formulas` requires DBA review gate.
- `author`/`user_id` treated as plain string in this phase; JWT integration deferred.

## Session 2026-05-10T00:01:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: `packages/proto` removed from Affected Services (advisory only — proto changes documented in Proto Contract Changes section).
- Overlap findings: `broker-accounts-ui` also modifies `xstockstrat-insights` — confirmed already merged/done, no merge-order action required.
- Open questions resolved:
  - OQ-1: `user_id` via `X-User-Id` header; fallback `'dev-user'` when absent in dev.
  - OQ-2: offset+limit pagination added to `ListFormulas` (`page_size`, `page_offset`, `total_count`).
  - OQ-3: Monaco Editor (`@monaco-editor/react`) chosen for formula source — richer custom `CompletionItemProvider` support over CodeMirror.
