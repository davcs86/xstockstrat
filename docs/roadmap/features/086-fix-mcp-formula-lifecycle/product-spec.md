# Product Spec: fix-mcp-formula-lifecycle

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-2, F-3, F-10 formula reads)
**Severity**: SEV-2
**Created**: 2026-08-02

---

## Problem Statement

The `manage_formula` MCP tool is unsafe and capability-crippled versus the indicators service:

- **Update wipes (F-2).** `UpdateFormula` is a full replace — the repo `UPDATE` sets
  `name, description, source, is_public, parameters, outputs, warmup_period` unconditionally, and
  the agent sends proto defaults for every omitted field. A one-field update destroys `source`,
  drops `parameters`, silently un-publishes (`is_public=false`), and zeroes `outputs`/`warmup_period`.
- **No read-back (F-2, F-10).** `GetFormula`/`ListFormulas` RPCs exist and `client.list_formulas`
  exists **unused**; no MCP tool exposes either, so safe read-modify-write is impossible.
- **Hard delete (F-2).** `DeleteFormula` is a hard `DELETE` with no check for strategies still
  referencing the formula; such strategies fail later at evaluation time.
- **Multi-series impossible (F-3).** The client never sends `RegisterFormulaRequest.outputs` /
  `warmup_period` (proto fields 8/9), so analysis fails closed to `{"value"}` — MCP-registered
  formulas can expose only the primary series, forcing one-formula-per-series workarounds.

Expected: a one-field update preserves the rest (AIP-161 partial merge, as `manage_strategy` already
does via feature 070); a formula can be read back before editing; delete is reference-checked; and a
formula can declare secondary output series and a warm-up period.

## Reproduction Steps

1. `manage_formula(operation="register", name="z", source=..., parameters=[...])` → note it works.
2. `manage_formula(operation="update", formula_id=<id>, description="tweak")` → `source`,
   `parameters`, `is_public` are wiped server-side. No `get_formula` tool exists to confirm/recover.
3. Register a formula whose `result` has extra keys → those series are not declared; a strategy rule
   referencing `<ref>.<series>` is rejected (analysis fails closed to `{"value"}`).

## Root Cause Hypothesis

RC-1 (hand-written dict→proto builder omits proto fields), RC-2 (partial-merge fix from feature 070
never propagated to `UpdateFormula`), RC-6 (hard delete, no referential check). See report F-2/F-3.

## Affected Services

`xstockstrat-indicators` (repo + servicer + proto `UpdateFormulaRequest`), `xstockstrat-agent`
(`app/client.py` `manage_formula` builders, `app/tools.py` `manage_formula` + new read tools).

## Fix Scope

- [x] Proto changes anticipated — `UpdateFormulaRequest.update_mask` (AIP-161); confirm `outputs`
      (field 8) / `warmup_period` (field 9) already on `RegisterFormulaRequest`/`UpdateFormulaRequest`.
- [ ] No database migrations anticipated.
- [ ] No config key changes anticipated.
- Agent: add `outputs`/`warmup_period` params to `manage_formula` + an `_build_output` helper
  (mirror `_build_parameter`); add `get_formula` client fn + `get_formula`/`list_formulas` read tools.
- Prevention: add a descriptor-parity test over the `RegisterFormulaRequest`/`UpdateFormulaRequest`
  builders, mirroring `tests/test_backtest_view.py::test_summary_key_set_covers_every_proto_field`.

## Acceptance Criteria

- [ ] A single-field `manage_formula update` preserves all omitted fields (RED test proves the
      current wipe; GREEN after `update_mask`).
- [ ] `get_formula`/`list_formulas` tools return the stored definition incl. `parameters`,
      `outputs`, `warmup_period`.
- [ ] A formula can declare `outputs`; a strategy rule referencing a declared secondary series
      validates; `warmup_period` is honored.
- [ ] `DeleteFormula` refuses (or soft-deletes) a formula referenced by a strategy.
- [ ] Descriptor-parity test present and green; existing tests pass.

## Out of Scope

- The close-only evaluator ceiling (custom formulas receive only `close`, so high/low/volume
  indicators remain inexpressible) — separate analysis roadmap item, noted in report F-3.
- Refactoring unrelated to these fixes.
