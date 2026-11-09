# Defect: Evidence fingerprint ignores referenced formula content

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: stale-grade
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis, xstockstrat-indicators
**Config-only fix possible**: no
**Source**: services/xstockstrat-analysis/docs/context-constitution.md — ANALYSIS-3 "Fingerprint blind spot"

## Observed
The evidence-eligibility fingerprint hashes only the strategy's `definition_json`. A custom-formula
component references its formula by id. Editing that formula in indicators (source, params,
`fundamental_inputs`) leaves the fingerprint unchanged, so evidence cells produced by the old
formula keep contributing to the derived headline grade.

## Expected
A change in the behaviour of a referenced formula invalidates (or re-fingerprints) the strategy's
evidence base. For example, include the formula id plus an updated_at/version in the hash.

## Reproduction
1. Register a strategy with a CUSTOM_FORMULA component on formula F and backtest several symbols.
2. `UpdateFormula` F with materially different source.
3. `ScoreStrategy`: the grade still aggregates the pre-edit cells.

## Evidence
`services/xstockstrat-analysis/app/handlers/servicer.py:7132`
> k: v for k, v in (definition_json or {}).items() if k not in _FINGERPRINT_EXCLUDED_KEYS

`services/xstockstrat-analysis/app/handlers/servicer.py:7134`
> canonical = json.dumps(filtered, sort_keys=True, separators=(",", ":"))

## Root cause hypothesis
Formula definitions live in another service, outside `definition_json`.

## Confidence
high
