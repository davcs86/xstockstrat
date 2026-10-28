# Defect: Indicators returns silent empty formula success, misnamed ATR/VWAP values, and lets owners mutate hidden saga copies

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: wrong-indicator-output
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-indicators, xstockstrat-analysis (consumer of ATR/VWAP and formula output)
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-10, D-18, D-54. Re-verified against main-dev @ a053b0e.

## Observed

### D-10 — Formula sandbox: `SystemExit(0)` or a missing/garbled output line returns `success=True, output={}`

The sandbox exposes every `BaseException` subclass to formula code, `SystemExit` included. A formula
that runs `raise SystemExit(0)` (or `exit`-equivalent via the exposed class) ends the child with
return code 0 before the wrapper prints its `__OUTPUT__:` line. The parent then finds no output line,
keeps `output = {}`, sees return code 0, and returns `success=True` with an empty output. A formula that
prints its own malformed `__OUTPUT__:` line hits `except json.JSONDecodeError: pass` and also returns
`success=True, output={}`. Downstream, strategies score on an empty series instead of failing.

### D-18 — `ATR` / `VWAP` do not compute the indicators they are named for

`ComputeIndicator("ATR")` returns the rolling mean of absolute close-to-close differences, not the
Average True Range (which needs high, low and previous close). `ComputeIndicator("VWAP")` returns the
cumulative mean of the input values, not a volume-weighted average price (it never sees volume). The
registry advertises both as "Average True Range" and "Volume Weighted Average Price". Analysis uses
both in strategy evaluation, warm-up sizing, screening and the P&L-pattern consumer, so strategy
scoring is silently skewed. Fixing this changes the output of historical backtests that use these
indicators.

### D-54 — `UpdateFormula` / `DeleteFormula` act on hidden saga copies

`_load_formula` treats a row with a non-null `pending_intent_id` (an uncommitted template-instantiation
copy) as not found on every read path. `UpdateFormula` and `DeleteFormula` instead load the row with
raw `get_by_id`, so the owner can update or soft-delete a copy that every read says does not exist.
The surveyor rated this finding one tier lower on its own; it is grouped here as an indicators
formula-correctness defect.

## Expected

- D-10: a formula run that does not reach the wrapper's output print, or whose output line does not
  parse, returns `success=False` with a clear error and an exit reason, never `success=True` with `{}`.
  `SystemExit` (and other non-`Exception` `BaseException` types that end the interpreter) is not usable
  to bypass output emission.
- D-18: `ATR` and `VWAP` either compute the true indicators from OHLC(V) input, or are renamed /
  re-described so their names and descriptions match what they compute. Design decides which, and
  states the backtest-history impact.
- D-54: `UpdateFormula` and `DeleteFormula` return `NOT_FOUND` for a pending-hidden row, consistent with
  `_load_formula`.

## Reproduction

1. D-10: `ExecuteFormula` with source `raise SystemExit(0)` (no `result` assignment needed). Observe
   `success=True`, `output={}`, `exit_reason="success"`. Then source
   `print("__OUTPUT__:{")` followed by `raise SystemExit(0)`: the only output line fails to parse, the
   decode error is swallowed, and the result is again `success=True, output={}`.
2. D-18: `ComputeIndicator(indicator="ATR", values=[10, 12, 11, 13], params={"period": 2})` returns the
   rolling mean of `|diff|` = `[None, None, 1.5, 1.5]`, which is not an ATR (no high/low input exists).
   `ComputeIndicator(indicator="VWAP", values=[10, 20, 30])` returns `[10, 15, 20]`, the running mean.
3. D-54: create a formula row with `pending_intent_id` set (as `InstantiateTemplate` does before the saga
   commits). `GetFormula` returns `NOT_FOUND`. `UpdateFormula` on the same id as its author succeeds, and
   `DeleteFormula` soft-deletes it.

## Evidence

### D-10 — Formula sandbox silent empty success

`services/xstockstrat-indicators/app/services/sandbox.py:247-254` (restricted builtins keep every `BaseException` subclass)
> or (isinstance(_obj, type) and issubclass(_obj, BaseException))

`services/xstockstrat-indicators/app/services/sandbox.py:310-312` (output print runs only after the formula returns)
> _output = _formula_globals.get('result', {{}})
> print("__OUTPUT__:" + json.dumps(...))

`services/xstockstrat-indicators/app/services/sandbox.py:394-400` and `:419-427`
> output = {}
> except json.JSONDecodeError:
>     pass
> ...
> return SandboxResult(success=True, output=output, ...

Lines `:252` and `:399` are unchanged from the scan.

### D-18 — ATR / VWAP misnamed

`services/xstockstrat-indicators/app/services/indicators_engine.py:103-116`
> def _atr(...): """ATR requires high, low, close. If only 1D array, approximates using range."""
> atr = s.diff().abs().rolling(window=period).mean()
> def _vwap(...): """VWAP approximation without volume data — returns cumulative average."""

`services/xstockstrat-indicators/app/services/indicators_engine.py:141-142` (registry)
> "ATR": {"description": "Average True Range", ...},
> "VWAP": {"description": "Volume Weighted Average Price", ...},

`packages/proto/indicators/v1/indicators.proto:54-61`: `ComputeIndicatorRequest` carries only
`repeated double values`, so a true ATR/VWAP needs either a contract change (OHLCV input) or a rename.

Analysis consumers: `services/xstockstrat-analysis/app/services/evaluator.py:141`, `:196-197`;
`app/services/screener.py:279-284` (already comments "ATR is a close-only approximation");
`app/services/warmup.py:86`, `:108`; `app/engine/pnl_pattern_consumer.py:50` (`DEFAULT_INDICATORS = ("RSI", "ATR")`).

### D-54 — Update/Delete on hidden saga copies

`services/xstockstrat-indicators/app/handlers/servicer.py:150-157` (`_load_formula`)
> row = await self._repo.get_by_id(formula_id)
> if row is not None and row.get("pending_intent_id") is None:

`services/xstockstrat-indicators/app/handlers/servicer.py:490` (`UpdateFormula`; scan cited `:483`) and `:593` (`DeleteFormula`; scan cited `:586`)
> row = await self._repo.get_by_id(request.formula_id)

`services/xstockstrat-indicators/app/services/formulas_repository.py:183-188`: `get_by_id` has no
`pending_intent_id` predicate.

## Root cause hypothesis

- D-10: success is inferred from return code 0 alone; the absence of a parsed output line is not treated
  as failure, and the builtins filter admits interpreter-exiting exceptions.
- D-18: the 1-D `values` contract cannot carry high/low/volume, and the approximations kept the real
  indicators' names.
- D-54: the mutating RPCs predate (or bypassed) the pending-hidden read helper.

## Confidence

high
