# Product Spec: fix-analysis-evidence-dry

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md, docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Evidence fingerprint ignores referenced formula content

- **Observed**: the evidence-eligibility fingerprint hashes only the strategy's `definition_json`. A
  CUSTOM_FORMULA component references its formula by id, so editing that formula in indicators
  (source, params, `fundamental_inputs`) leaves the fingerprint unchanged and evidence cells from the
  old formula keep contributing to the derived headline grade.
- **Expected**: a change in a referenced formula's behaviour invalidates (or re-fingerprints) the
  strategy's evidence base — e.g. include the formula id plus an updated_at/version in the hash.
- Report: [docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md](../../../reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md)

### Entry-backfill re-types the live-enabled gate SQL instead of importing it

- **Observed**: ANALYSIS-7 requires the live gate (`active AND live_enabled`) never to diverge between
  sites. `entry_backfill.py` hard-codes the SQL literal while `live_loop.py` and
  `StrategiesRepository.list_live_enabled` use `LIVE_ENABLED_PREDICATE_SQL`; an edit to the constant
  would silently leave the boot entry-time backfill on the old gate.
- **Expected**: `entry_backfill.py` uses `LIVE_ENABLED_PREDICATE_SQL` (lazy import if a cycle exists)
  or calls `list_live_enabled`.
- Report: [docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md](../../../reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md)

## Reproduction Steps

1. Fingerprint: register a strategy with a CUSTOM_FORMULA component on formula F and backtest several
   symbols; `UpdateFormula` F with materially different source; `ScoreStrategy` — the grade still
   aggregates the pre-edit cells.
2. Live gate: compare `app/engine/entry_backfill.py` (literal) with `app/repositories/strategies.py:19`
   (constant).

## Root Cause Hypothesis

- Fingerprint: formula definitions live in another service (indicators), outside `definition_json`.
  Current sites: `services/xstockstrat-analysis/app/handlers/servicer.py:7281`
  (`_FINGERPRINT_EXCLUDED_KEYS`), `:7297` (the `definition_json` filter feeding the hash).
  `FormulaDefinition` already carries `updated_at = 7` (`packages/proto/indicators/v1/indicators.proto:169`).
- Live gate: the literal was likely duplicated to avoid an import cycle through `servicer.py`. Current
  sites: `services/xstockstrat-analysis/app/engine/entry_backfill.py:65` (literal),
  `services/xstockstrat-analysis/app/repositories/strategies.py:19` (constant).

## Affected Services

- xstockstrat-analysis
- xstockstrat-indicators (source of the referenced formula's content/version)

## Fix Scope

- Proto changes anticipated: **no** — `FormulaDefinition.updated_at` already exists; confirm in recon that it moves on every `UpdateFormula`.
- DB migrations anticipated: **no** — the fingerprint is computed in code and the live gate is a code constant; revisit if Open Question 2 chooses a stored re-fingerprint.
- Config key changes anticipated: **no** — neither report touches a config key.

## Open Questions

1. On a referenced-formula change, should the strategy's evidence base be **invalidated** or
   **re-fingerprinted** (the report offers both)?
2. Widening the fingerprint input changes the fingerprint of every existing strategy with a
   CUSTOM_FORMULA component on rollout — accept that one-time evidence reset, or carry existing
   evidence forward?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
