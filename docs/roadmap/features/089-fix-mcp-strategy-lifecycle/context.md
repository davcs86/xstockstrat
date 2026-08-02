# Context Log: fix-mcp-strategy-lifecycle

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-5, F-7
- Severity: SEV-2 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-analysis, xstockstrat-agent
- Root cause(s) from the report: RC-6
- Recommended design depth: full → `/sdd-design fix-mcp-strategy-lifecycle` (rationale: possible proto enum (STRATEGY_OPERATION_REACTIVATE) + ≥2 services)
- Development branch: feature/fix-mcp-strategy-lifecycle
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design

- Recon (analysis + agent) + design debate (2 rounds equivalent: draft design + adversary grill).
- Adversary fixes folded: (1) extract a shared `strategy_symbols` firing-predicate helper (live_loop + SetStrategyLive — no C-10 drift); (2) REACTIVATE re-validates the stored definition (AC-4, no inert reactivation); (3) register uses a `get_by_id` pre-check AND a `UniqueViolationError` catch (atomic — no TOCTOU INTERNAL leak); (4) name the TestManageStrategy + TestSetStrategyLive fixture updates (add get_by_id mocks).
- Chosen: STRATEGY_OPERATION_REACTIVATE=4 (additive); repo.reactivate; register ALREADY_EXISTS; SetStrategyLive enable-preconditions (active + shared strategy_symbols) → FAILED_PRECONDITION, disable always allowed; live-loop predicate unchanged; agent reactivate op + honest set_strategy_live docstring; same-PR docs (mcp-tools.md + strat-lab skill if it covers these verbs).
- Cross-feature: 086/087/088/089 all touch agent client.py/tools.py/mcp-tools.md/strat-lab skill — merge-order reconciliation noted.
- Constitution: C-04, C-08/P-06, C-09, C-10, F-01/F-06/F-07 (none). Floor breaches: none.
- Status: → design-approved.
