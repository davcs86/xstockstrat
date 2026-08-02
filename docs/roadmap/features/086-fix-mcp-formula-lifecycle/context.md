# Context Log: fix-mcp-formula-lifecycle

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-2, F-3, F-10 (get_formula/list_formulas)
- Severity: SEV-2 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-indicators, xstockstrat-agent
- Root cause(s) from the report: RC-1, RC-2, RC-6
- Recommended design depth: full → `/sdd-design fix-mcp-formula-lifecycle` (rationale: proto change (UpdateFormulaRequest update_mask) + ≥2 services)
- Development branch: feature/fix-mcp-formula-lifecycle
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design

- Phase 0 Recon: wrote recon.md (services: indicators, agent — then expanded to +analysis, +ui per user steer). Key reuse patterns: feature-070 `ManageStrategy` update_mask/`_guard_erasure`; `_build_parameter`→`_build_output`; descriptor-parity `test_backtest_view.py`.
- Phase 1 Grilling: 2 rounds (full). R1 adversary closed 3 objections — derive-mask-from-dict-keys re-creates the wipe (→ None-sentinel + derived mask, the actual manage_strategy mechanism), plain soft-delete dishonest vs AC-4 (→ surfaced `deleted` flag), narrow erasure guard. R2 adversary added: `is_public` needs the None-sentinel too; verify next-free field/migration numbers vs remote (done, clean).
- **User steer at the design gate**: soft-delete accepted only if strategy runs detect and flag a referenced formula's deletion. Pulled analysis (write-time binding refusal + backtest-run warning via the existing `_declared_formula_warmup` GetFormula prefetch → new `BacktestResult.warnings=16`) and ui (edit-gate on `deleted` + render the warning) into scope.
- Chosen approach: AIP-161 partial update (UpdateFormulaRequest.update_mask=10) + honest soft-delete (FormulaDefinition.deleted=13, migration 005 deleted_at) + agent read tools/full builders/parity test + analysis refusal & backtest flag + ui gate/render + same-PR docs.
- Rejected: hard reference-checked delete via indicators→analysis edge (dependency-cycle risk, ledger 083); explicit tool-level update_mask param (set-but-unmasked silent-drop); adding `deleted` to ExecuteFormulaResponse (3-site blast radius).
- Constitution rules touched: C-01/F-04, C-04, C-07/F-01, C-08/P-06, C-09, C-10, C-13, F-06, F-07. Floor breaches: none.
- Open threads: (1) live-strategy continuous deletion flagging deferred to a follow-up (backtest run-flagging covers the discrete user-invoked run) — target: follow-up feature; (2) maskless-path residual (guard covers `source` only) — target: docstring step; (3) re-verify field/migration numbers at /sdd-spec (ledger 081).
- Status: draft → design-approved.
