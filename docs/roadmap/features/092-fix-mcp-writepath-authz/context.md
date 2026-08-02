# Context Log: fix-mcp-writepath-authz

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-11
- Severity: SEV-2 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-ingest, xstockstrat-notify, xstockstrat-agent
- Root cause(s) from the report: —
- Recommended design depth: full → `/sdd-design fix-mcp-writepath-authz` (rationale: security-invariant change (AGENT-3/4) across ≥2 services)
- Development branch: feature/fix-mcp-writepath-authz
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design

- Phase 0 Recon: wrote recon.md (ingest, notify, agent). Corrected the premise — `manage_formula`
  is ownership-based (plain `_metadata()`), so exactly FOUR tools carry the hardcoded
  `x-access-scope=7`: manage_strategy, manage_signal_source, set_strategy_live, trigger_backfill.
  Confirmed ingest TriggerBackfill ungated; notify EmitAlert has no authz infra at all.
- Phase 1 Grilling: 2 rounds (full). R1 adversary NEEDS-WORK, no Floor breach; ruled EmitAlert
  option (a) correct. R2 folded in all six fixes.
- Chosen approach: (1) ingest copies CancelBackfill's `_has_admin_scope` gate into TriggerBackfill;
  (2) notify EmitAlert = explicit internal-service-caller contract (NO gate — admin gate breaks all
  internal callers; x-mcp-secret enforcement inverts the trust boundary since only the external
  agent sends it); (3) agent flips the 4 tools to the set_config caller-derived-scope template and
  deletes the now-orphaned `_admin_metadata()`; (4) same-PR docs.
- **Design-gate resolution (standing "continue" directive).** Two calls surfaced, not blocked on a
  live gate: (i) EmitAlert stays ungated (adversary-ruled; residual = an authenticated user can spam
  alerts, a nuisance not a privilege escalation); (ii) the intended access change — post-flip,
  non-admin OAuth operators (trader=11, viewer=1) lose the four tools (backends require ADMIN 0x04).
  Both recorded in design.md Open Risks + a product-spec call-out. Reopen if the user wants EmitAlert
  gated or the non-admin access preserved.
- Binding condition (074 trap): the notify AC2 test MUST execute — switch notify to config's
  compile-first `tsc && node --test dist/...` (tsconfig `include: ["src/**/*"]` emits tests →
  verified safe), hard-assert the import, demonstrate a deliberate red via a stub gate.
- Verified: all four backends gate on ADMIN 0x04 (`analysis/ingest _has_admin_scope`), incl.
  SetStrategyLive (analysis servicer.py:1699-1701, NOT TRADING 0x08).
- Constitution rules touched: F-11/F-04, C-08/P-06, C-13, C-10, C-11/P-03, C-03. Floor breaches: none.
- Status: draft → design-approved.

### Open Threads
- EmitAlert ungated (internal contract) — resolved; reopen only if a per-call gate is required.
- Non-admin access change — intended; product-spec call-out; target /sdd-spec.
- notify compile-first switch — verify tests emit to dist at execute (tsconfig include confirmed).
- Per-tool ctx SDK-wiring — prove with the paired ctx-injection guard at execute.

---

## Session 2026-08-02 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status → implementation-ready.
- Step map: (1) ingest service — TriggerBackfill admin gate; (2) ingest test — gate test + migrate
  bare-MagicMock cases + centralize `_ctx` into conftest.py (C-13 second consumer); (3) notify test —
  compile-first harness switch + EmitAlert internal-caller contract test + demonstrated red (074
  backstop; NO code gate); (4) agent service — flip 4 tools to caller-derived scope, delete
  `_admin_metadata()`, update scopes.py docstring; (5) agent test — per-tool scope-forwarding +
  ctx-injection tests, rewrite the invariant test, flip the `"7"` assertions; (6) docs — AGENT-3/4,
  F-11 finding, 3 service CLAUDE.md, mcp-tools.md, strat-lab (verify), product-spec call-out.
- Key codebase findings (all recon line refs re-verified accurate, unlike the stale AGENT-3 refs):
  - ingest `_has_admin_scope` at `servicer.py:146-159`; `CancelBackfill` gate to copy at `:587-588`;
    `TriggerBackfill` ungated at `:169-203` (only `_db is None` at `:170-172`). Gate inserts after
    the `_db is None` block, before `job_id =` (`:173`).
  - ingest `_ctx(access_scope="4")` builder lives in `test_cancel_backfill.py:34-45`; `conftest.py`
    exists but holds only `_setup_gen_path` — the C-13 second consumer moves `_ctx` there.
  - notify: emitAlert reads only `call.request` (`notifyServiceImpl.ts:30-31`), no metadata anywhere;
    074 trap live (try/catch import skip `:24-31` + per-case `if(!X)return`). Config's compile-first
    scripts (`config/package.json:12-13`) are the verified-safe template; notify tsconfig
    `include:["src/**/*"]` emits tests to dist.
  - agent set_config template: tools.py `:786-872` (ctx first param, `_claims_from_context`→
    `roles_to_access_scope`, access_scope=), client.py `:916-960` (access_scope param, forwards
    `("x-access-scope",str(access_scope))`). Four tools to flip: tools.py `:392/579/621/643`,
    client.py `:343/520/662/767`. `manage_formula` (tools.py:508) is ownership-based — OUT.
  - `_admin_metadata()` deletion absence-claim verified via `grep -rn`: after flip, only the
    definition (`client.py:30`), two set_config comments (`:929,959`), scopes.py:10 docstring, and
    two test refs (`test_config_tools.py:264`, `test_streamable_http_auth.py:99`) remain — all handled.
  - strat-lab verified to contain NO authz text for the 3 tools (only partial-merge guidance) →
    same-PR mandate satisfied by verification, no change expected.

### Decisions
- Reviewers snapshot written to feature.md: ingest owner (steps 1-2), notify owner (step 3), agent
  owner (steps 4-5), docs none (step 6) — per the governance matrix (service/test → service owner).

### Open Threads
- notify compile-first switch: prove tests emit to `dist/__tests__/` at execute (tsconfig include
  confirmed) and the deliberate-red actually reddens the no-metadata contract test.
- Per-tool ctx SDK-wiring: prove with the paired ctx-injection guard per tool at execute.
- F-05 split: Step 4 deletes `_admin_metadata()` (breaks existing tests); carry green-making minimum
  in Step 4's commit, full assertion rewrites in Step 5.

---

## Session 2026-08-02 — sdd-review impl-spec (advisory)

- Criteria pass (spec-reviewer): PASS — 0 failures, 2 advisory notes (Step 4 "live" substring
  trading-domain false-positive; Step 3 unpaired-by-design test/harness step, not a C-08 miss). Every
  spot-checked path:line verified; load-bearing gate-before-flip order confirmed (Step 1 ingest gate <
  Step 4 agent flip); notify Step 3 genuinely defeats the 074 trap (compile-first + hard import assert
  + demonstrated red). No Floor breach — F-11 is resolved, not breached.
- Overlap pass (feature-overlap): CLEAN. No migration/proto/config (structurally impossible). Soft
  coordination note: 088 (fix-mcp-signal-source-verbs, still draft) also rewrites `manage_signal_source`
  in client.py/tools.py — whichever lands second rebases that function; no blocking merge-order row.
  091's set_config edits are disjoint (092 only rewrites two set_config comments); 093/094 disjoint.
- Proceeding to implementation on the feature branch (one PR per feature).

---

## Session 2026-08-02 — sdd-execute (implementation)

All 6 steps implemented on feature/fix-mcp-writepath-authz (one PR into main-dev), TDD gates honored.

- **Step 1-2 (ingest)**: `_has_admin_scope` gate added to `TriggerBackfill` after the `_db is None`
  check (mirrors CancelBackfill). Centralized `_ctx(access_scope)` into `tests/conftest.py` (C-13 —
  test_ingest_servicer became the second consumer). RED demonstrated (gate removed → the NOT_FOUND
  case fails "DID NOT RAISE"); GREEN 152 tests, coverage 76%. Migrated the 2 bare-MagicMock
  TriggerBackfill cases + added the gate/queues pair; imported `grpc` into test_ingest_servicer.
- **Step 3 (notify)**: EmitAlert left ungated (internal-service-caller contract). Switched
  package.json to compile-first (`tsc && node --test dist/...`), replaced the lazy try/catch import
  with a STATIC import + hard "import succeeded" harness assertion, removed all silent-skip guards
  (incl. the serialization test's optional proto import). Added the metadata-less EmitAlert contract
  test. RED demonstrated (stub admin gate → contract test + 2 metadata-less tests fail); GREEN 16
  tests, 0 skipped, coverage 84.6%. Fixed a latent type error the strip-types mode never caught.
- **Step 4-5 (agent)**: added a shared `_caller_access_scope(ctx, tool)` helper (DRY — avoids 5
  copies of the claims block); flipped manage_strategy/manage_signal_source/set_strategy_live/
  trigger_backfill to `ctx` + caller-derived scope; refactored set_config onto the helper (fail-fast
  preserved); DELETED `_admin_metadata()`; updated scopes.py docstring + set_config comments.
  Centralized `_ctx`/ADMIN/TRADER/VIEWER into the agent conftest (C-13 — test_tools became a 2nd
  consumer); rewrote `test_other_management_tools...` → `test_all_management_tools_forward_the_callers_
  derived_scope` (also the ctx-injection guard for all 5); added per-tool scope-forwarding +
  None-claims tests; flipped the test_client.py "7" assertions to "15"; injected ctx into 15
  test_tools.py call sites; reworded the streamable_http_auth comment. GREEN 150 tests, coverage 68%,
  ruff clean.
- **Step 6 (docs, C-10)**: re-forged AGENT-3/AGENT-4 + the CLAUDE.md constitution-header pointer;
  marked F-11 finding RESOLVED; agent CLAUDE.md § Management-tool authorization (corrected the
  manage_formula grouping, added the EmitAlert contract); ingest CLAUDE.md (TriggerBackfill gated);
  notify CLAUDE.md (EmitAlert contract + compile-first harness); mcp-tools.md (trigger_backfill/
  manage_strategy/manage_signal_source/emit_alert authz + set_config no-longer-exception framing);
  product-spec behavior-change call-out. strat-lab verified authz-text-free (no edit). context-forge
  plugin unavailable — teardown scan not run; noted in PR.
- Verified: all four backends gate on ADMIN 0x04 (incl. SetStrategyLive). Non-admins lose the four
  tools (intended F-11 fix).
- Status: implementation-ready → code-completed.

## Session 2026-08-02 (CI: feature status automation)

- Promotion PR #844 merged to main
- Feature promoted and committed: a76237080a282abac145b7f88a6044869132ba5f
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-02
