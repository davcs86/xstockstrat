# Context: trigger-backfill-mcp-tool

**Feature**: `docs/roadmap/features/066-trigger-backfill-mcp-tool/feature.md`
**Product Spec**: `docs/roadmap/features/066-trigger-backfill-mcp-tool/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/066-trigger-backfill-mcp-tool/implementation-spec.md`

---

## Session 2026-07-20T15:40Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Recon during story phase: ingest proto already exposes `TriggerBackfill`,
  `GetBackfillStatus`, `ListBackfillJobs`, `CancelBackfill` (packages/proto/ingest/v1/ingest.proto:12-16)
  — no proto work. `TriggerBackfillRequest` carries `symbols`, deprecated `timeframe` string,
  `range`, `overwrite`, `timeframe_enum`, `fill_mode` (feature 054). Cancel/delete deliberately
  excluded (destructive-op guardrails are UI-only per feature 057 FR-5).
- Ledger scan: no agent/backfill fails entries; C-10(a) "register on shared surfaces" analog
  applied as FR-5 (mcp-tools.md + agent CLAUDE.md tool tables + counts).
- Reviewer registry has no `xstockstrat-agent` Service Owners row — flagged in Open Questions.
- **Branch deviation (user-approved workflow)**: this session is a harness session bound to branch
  `claude/custom-indicators-strategies-g38b18` (PR #769 → main-dev); the user asked to run the SDD
  pipeline and build the tool in-session, so artifacts and implementation land on that branch
  instead of `feature/trigger-backfill-mcp-tool`.

## Session 2026-07-20T16:10Z — sdd-review product-spec

- Round 1: FAIL on A3.9 (three unchecked Open Questions; P-03). Resolved: two-tool shape
  (`trigger_backfill` admin-scoped write, `get_backfill_status` secret-only read — chosen because
  auth scopes differ per operation), `fill_mode` exposed (`full`/`gaps_only`, omitted → server
  FULL), reviewer-registry agent row deferred as docs-only follow-up.
- Round 2: **PASS WITH WARNINGS** → status draft → spec-ready. Both advisory items fixed inline:
  - FR-6 reworded — ingest `TriggerBackfill` queues unconditionally (no synchronous
    `INVALID_ARGUMENT`; bad input → terminal `FAILED` job, per ingest servicer.py:142-167).
    Tests must not expect a synchronous trigger error.
  - FR-4 precedent corrected — admin-scope precedents are `manage_strategy`/
    `manage_signal_source`/`set_strategy_live`; `manage_formula` sends no admin scope.
- Overlap scan: CLEAN (no config/proto/migration collisions; no merge-order entry needed;
  065's agent edits already on main-dev and are base-code reality).
- Noted for design: ingest `TriggerBackfill` currently has no `_has_admin_scope` gate (only
  `CancelBackfill`/`ManageSignalSource` enforce it) — the tool still sends the admin bit
  defensively per FR-4.
