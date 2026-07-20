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

## Session 2026-07-20T17:05Z — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-agent; key reuse patterns:
  manage_signal_source write-path + list_signal_sources read-path client recipes,
  _iso_to_timestamp, MessageToDict run_backtest variant, test mock recipes).
- Phase 1 Grilling: 1 round (quick). Proposer's two-thin-layer approach survived; adversary
  (NEEDS WORK, **no Floor breach**) raised 9 objections — ALL accepted as design fixes:
  page_token param (pagination dead-end), fail-fast validation extended to empty symbols /
  inverted range / >50-symbol cost cap, timeframe alias parity with ingest _TF_ALIASES
  (strict-reject rejected — 053 trap), `{"job": ...}` envelope (no dual top-level shape),
  5th docs surface (historical-backfill.md runbook), friendly enum error messages, tests assert
  generic AioRpcError mapping (not UNAVAILABLE-exhaustive), default not_found message on trigger,
  _admin_metadata() extraction + refactor of the 3 inline sites.
- Chosen approach: 2 client fns + 2 @server.tool() wrappers, dual-mode get_backfill_status,
  discriminated one-key envelopes. Rejected: single operation-param tool; strict alias reject;
  always-list shape; no-refactor fallback; bare job dict.
- Constitution rules touched: C-01, C-04, C-08, C-10, C-11, P-01–P-04, P-06, F-04, F-08.
  Floor breaches: none.
- **P-04 gate handling**: the user's explicit instruction "run the SDD pipeline and build
  trigger_backfill" (2026-07-20 session message) is recorded as the standing approval for this
  quick-mode gate; no contested trade-off survived synthesis (all objections resolved, not
  waived), so no per-gate prompt was raised. Sign-off recorded here per Constitution override
  rules.
- Open Threads (from design.md Open Risks):
  - [ ] Alias tables mirrored from ingest may drift — target: service step docstring.
  - [ ] Admin "7" scope now covers a cost-incurring op; 50-symbol client cap is the mitigation —
        target: service step; future ingest-side gate noted.
  - [ ] historical-backfill.md:105 stale 8055 webhook — pre-existing; fix in docs step if
        trivial, else flag.
- Status: spec-ready → design-approved.

## Session 2026-07-20T18:30Z — sdd-spec

- Generated implementation-spec.md with 5 steps (1 client service + test pair, 1 tools service +
  test pair, 1 docs step across the five surfaces). Status → implementation-ready.
- Consumed recon.md + design.md as authoritative; only sub-dossier detail re-discovered (exact
  proto field numbers, docs-surface line anchors, test helper locations).
- Key codebase findings (beyond recon):
  - `common_pb2` is NOT yet imported anywhere in `app/client.py` — the new `trigger_backfill` /
    `get_backfill_status` add the agent's first `gen.common.v1` import (function-local, safe:
    `ingest.proto:8` already imports common/v1 so the stub module ships with the package).
  - `tests/test_tools.py:299-302` has an existing `_rpc_error(code, details)` AioRpcError fake —
    reuse it for the tool error-mapping tests (no new helper needed).
  - **Pre-existing docs gap found (out of scope, flagged in Step 5 evidence)**: `set_strategy_live`
    has no `###` section in `docs/runbooks/mcp-tools.md` despite the "eleven tools" header count —
    feature-048 debt; this feature only appends its two sections and bumps counts to thirteen.
  - `tests/test_tools.py:1` module docstring still says "all six MCP tool definitions" — Step 4
    fixes it to a countless form while the file is already staged (avoids recurring count drift).
  - Ingest `ListBackfillJobs` pagination confirmed real (servicer.py:514-540: offset-token,
    page_size<=0 → 100) — `limit`/`page_token` params are wired through as designed.
- Resolution of design Open Risks: Risk 1 (alias drift) → mirrored-map comment in Step 1 +
  docstring enumeration in Step 3; Risk 2 (admin "7" on cost-incurring op) → 50-symbol client cap
  (`_BACKFILL_MAX_SYMBOLS`) in Step 1; Risk 3 (stale 8055 webhook block) → Step 5 replaces
  `### Via Webhook` (historical-backfill.md:103-115) with a `### Via MCP tool (AI agents)` section.
- Reviewers snapshot finalized in feature.md (agent owner steps 1–4, ingest owner step 1, docs none).

## Session 2026-07-20T18:40Z — pipeline routing note

- Skipping the advisory `/sdd-review impl-spec` pass (non-gating by definition): the impl spec was
  generated minutes ago from the twice-reviewed product spec + adversarially-debated design, and
  `/sdd-execute` re-verifies each step's codebase evidence via mandatory discovery before writing.
  Recorded here per P-03 (no silent deviation).
- Branch deviation continues per the sdd-story session note: steps execute directly on
  `claude/custom-indicators-strategies-g38b18` (PR #769 → main-dev), no per-step branches/PRs.
