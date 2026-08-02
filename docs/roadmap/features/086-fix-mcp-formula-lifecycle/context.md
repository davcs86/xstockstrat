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

---

## Session 2026-08-02 — sdd-execute (all 13 steps)

- Environment: provisioned the codegen toolchain on the host (buf 1.72.0 + Go proto plugins pinned to Dockerfile.codegen + grpcio-tools==1.80.0 + pnpm TS plugins); validated buf-gen reproduces committed stubs byte-for-byte before any proto edit (ledger codegen-toolchain-host-setup runbook).
- Step 1-2 (proto+gen): indicators UpdateFormulaRequest.update_mask=10, FormulaDefinition.deleted=13; analysis BacktestResult.warnings=16, StrategyDefinition.warnings=10. buf lint+breaking pass (additive). Commit fe9a191.
- Step 3-5 (indicators): migration 005 deleted_at + partial index (validated up/down on throwaway PG); repo soft-delete + list filter + deleted-agnostic get_by_id; servicer AIP-161 partial merge (update_mask), source-only erasure guard, FAILED_PRECONDITION on deleted; _row_to_formula deleted. 115 tests, ruff clean, 81% cov. Commit 586b1d7.
- Step 6-7 (analysis): write-time _refuse_deleted_bindings (register+update, request components only); backtest warnings captured on the warmup prefetch's single GetFormula (no extra fetch — the once-per-run invariant test still passes); GetStrategy populates StrategyDefinition.warnings (live status); shared _deleted_formula_warning() message. 385 tests, ruff clean, 83% cov. Commit 2045200.
- Step 8-9 (agent): client _build_output, outputs/warmup on both builders, update_mask FieldMask, get_formula fn; tool None-sentinel params + derived update_mask (never a maskless wipe; empty->error), honest docstring, get_formula/list_formulas read tools (catalog 17->19); run_backtest projection surfaces warnings; descriptor-parity tests over both builders. 150 tests, ruff clean. Commit 41e3a82.
- Step 10-11 (ui): FormulaWorkspace deleted -> read-only + Deleted badge; strategy detail renders StrategyDefinition.warnings + BacktestResult.warnings banners; FORMULA_DELETED fixture + INVENTORY; formula-deletion.spec.ts (3 tests) pass; tsc + eslint clean. Commit 61ee410.
- Step 13 (docs): mcp-tools.md manage_formula partial-merge + soft-delete + read-tool sections; 17->19 across tools.py docstring, agent/runbook CLAUDE.md. strat-lab needs no change (describes manage_strategy, not manage_formula). Commit ec51a7c.
- Deviation: dropped the design's `clear_fields` param on manage_formula — every formula field's "clear" is expressible by value ([]/""/0/false) under the None-sentinel, so clear_fields is redundant (source is protected by the erasure guard regardless). Minimum-that-solves-it.
- Status: implementation-ready -> code-completed.

## Session 2026-08-02 (CI: feature status automation)

- Promotion PR #844 merged to main
- Feature promoted and committed: a76237080a282abac145b7f88a6044869132ba5f
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-02
