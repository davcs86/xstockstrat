# Defect: Formulas authored under a legacy username cannot be read by their owner

**Recorded**: 2026-10-22
**Severity**: SEV-2
**Impact type**: silent-failure / data-ownership
**Environment**: dev (staging app `xstockstrat-staging`); production not yet checked
**Affected service(s)**: xstockstrat-indicators
**Config-only fix possible**: no

## Observed

On staging, six custom formulas store `author = "davcs86"`, a legacy username, instead of the owner's user id
(`80880990-2b79-4d85-8761-d8d9102c2efb`). All six were created on 2026-07-20, before ownership was keyed on user id:

| formula_id | name |
|---|---|
| `67139be6-27ff-4e03-b57f-a5398e7ea9a6` | Momentum Quality (Clenow) |
| `31bb8ea6-0f3e-4cf7-8844-ec8294cebf85` | Bollinger Squeeze Percentile |
| `7f595658-2a7f-4ddb-a83a-5fc3d625472d` | Volatility Trailing Stop Direction |
| `60c5b411-a7b7-4b5c-beb5-fdcb12ec83d1` | Kaufman Efficiency Ratio |
| `127e7b0d-ab8e-461a-af7b-da3bb9739204` | Mean-Reversion Z-Score |
| `4a82bce9-db58-4efb-b2ae-37a90889e255` | probe_test_formula |

- `list_formulas` for the owner does not return them; they appear only with the admin selector `author_filter="davcs86"`.
- Indicators' read guard (`_can_read_formula`) answers PERMISSION_DENIED to the owner, so any strategy that uses them
  fails formula evaluation. This is the root trigger of the 2026-10-15 backtest silent-skip defect:
  `squeeze_breakout_trend` uses `31bb8ea6…` and `7f595658…`, and both symbols were silently dropped.

## Expected

Every formula's `author` is the owning user id. The owner can list, read and execute their formulas, and strategies
that reference them evaluate normally.

## Reproduction

1. On staging, as the owner, call `list_formulas()`: the six formulas above are absent.
2. As admin, call `list_formulas(author_filter="davcs86")`: all six are returned with `author: "davcs86"`.
3. `run_backtest` on a strategy referencing `31bb8ea6…` (e.g. `squeeze_breakout_trend`) evaluates no symbols.

## Evidence

- Staging MCP `list_formulas(author_filter="davcs86")` on 2026-10-22: six rows, `author: "davcs86"`.
- Staging MCP `list_formulas()` as the owner on 2026-10-22: those six absent; the owner's other formulas carry
  `author: "80880990-2b79-4d85-8761-d8d9102c2efb"`.
- `services/xstockstrat-indicators/app/handlers/servicer.py` `_can_read_formula` and the read path that returns
  PERMISSION_DENIED (cited in `docs/roadmap/features/275-fix-backtest-silent-symbol-skip/context.md`).

## Root cause hypothesis

Rows created before formula ownership moved from username to user id were never backfilled. A data fix (rewrite
`author` from username to the matching user id) plus a check that no other legacy-username authors remain is likely
needed; production must be checked for the same rows before choosing the fix shape.

## Confidence

high
