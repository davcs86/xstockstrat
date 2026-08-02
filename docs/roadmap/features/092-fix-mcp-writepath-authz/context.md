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
