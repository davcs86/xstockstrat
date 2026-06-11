# Indicator Builder Runbook

## Overview

This runbook covers creating, testing, registering, and deploying custom technical indicators using the `xstockstrat-indicators` formula engine. Built-in indicators (SMA, EMA, RSI, MACD, BB, ATR, VWAP, STOCH) require no registration. Custom indicators use the sandboxed Python executor.

---

## Built-in Indicators

Available via `ComputeIndicator` RPC without registration.

| Indicator | Required Params | Optional Params | Output Fields |
|---|---|---|---|
| `SMA` | `period` | — | `value` |
| `EMA` | `period` | — | `value` |
| `RSI` | `period` | — | `value` |
| `MACD` | `fast`, `slow`, `signal` | — | `value`, `signal`, `histogram` |
| `BB` | `period`, `std_dev` | — | `value` (mid), `upper`, `lower` |
| `ATR` | `period` | — | `value` |
| `VWAP` | — | — | `value` |
| `STOCH` | `period` | — | `value` (K), `d` (D) |

### Example: Compute RSI via gRPC
```python
import grpc
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc

channel = grpc.insecure_channel('xstockstrat-indicators:50054')
stub = indicators_pb2_grpc.IndicatorsServiceStub(channel)

resp = stub.ComputeIndicator(indicators_pb2.ComputeIndicatorRequest(
    indicator="RSI",
    values=[44.5, 44.3, 44.8, 45.1, 44.9, 45.5, 46.0, 45.8, 46.2, 46.5,
            45.9, 46.1, 46.8, 47.0, 46.5],
    params={"period": 14},
    symbol="AAPL",
    timeframe="1d",
))
for point in resp.result:
    print(f"RSI: {point.value:.2f}")
```

---

## Custom Formula Development

### Authoring in the UI (recommended)

The fastest way to write, test, and register a formula is the notebook-style
workspace in `xstockstrat-ui` at **Insights → Formulas**:

- **Formulas list** (`/insights/formulas`) — search by name/description/author and
  filter by Public/Private to see what already exists. Each row opens the editor.
- **Workspace** (`/insights/formulas/new` or `/insights/formulas/<id>`) reads top to
  bottom like a notebook:
  1. **Metadata cell** — name, description, and the Public toggle.
  2. **Code cell** — a Python editor that receives `data` and must assign `result`.
  3. **Run cell** — edit the input JSON (or click **Load sample data** for an OHLCV
     bundle) and press **Run**. This executes the *current, unsaved* editor buffer via
     inline `formula_source`, so you can iterate before saving. Output renders the
     `result` keys (with sparklines for numeric series), `stdout`/`stderr`, the exit
     reason, and execution time.
- A built-in **Reference** panel (toggle in the action bar) documents the
  `data → result` contract, the available libraries (numpy, pandas, math, statistics)
  with copy-ready examples, the sandbox limits, the blocked modules, and one-click
  **starter templates** (Blank, SMA, RSI, Bollinger Bands, MACD).

Clicking **Create formula** / **Save** registers the formula (author is set from your
JWT, server-side). The gRPC path below remains available for automation.

### Formula Interface Contract

Your Python formula receives two dicts already in scope — `data` (the series input) and
`params` (typed scalar parameters) — and must assign its output to a `result` variable. The
primary series is `result["value"]`; any additional keys are **declared outputs** (see below).

```python
# data:   series input from ExecuteFormulaRequest.input_data   (e.g. data["close"])
# params: validated scalar parameters from ExecuteFormulaRequest.input_params
# result: must be set before the formula ends; result["value"] is the primary series

import numpy as np

arr = np.array(data["close"], dtype=float)   # series stay in `data`
period = int(params["period"])               # scalars come from `params`, never `data`

mid = np.convolve(arr, np.ones(period) / period, mode="valid")
stdev = np.array([np.std(arr[i:i + period]) for i in range(len(arr) - period + 1)])

result = {
    "value": mid.tolist(),                   # primary series (implicit "value")
    "upper": (mid + 2 * stdev).tolist(),     # declared output series
    "lower": (mid - 2 * stdev).tolist(),     # declared output series
}
```

### Typed Parameters

Beyond the `data` series input, a formula can declare **typed parameters** — named scalar
knobs with defaults, validation, and descriptions. Parameter *values* arrive separately from
the OHLCV series and are exposed to the formula as a dedicated `params` dict (never merged into
`data`):

```python
# data:   series input from ExecuteFormulaRequest.input_data  (e.g. data["close"])
# params: validated scalar values from ExecuteFormulaRequest.input_params
import numpy as np

prices = np.array(data["close"], dtype=float)   # series stays in `data`
period = params["period"]                        # typed scalar from `params`

result = {"sma": np.convolve(prices, np.ones(period) / period, mode="valid").tolist()}
```

Declare parameters when registering/updating a formula (UI **Parameters** cell, the
`manage_formula` MCP tool's `parameters` argument, or `RegisterFormulaRequest.parameters`). Each
parameter has:

| Field | Meaning |
|---|---|
| `name` | Python identifier; the key in `params["<name>"]` |
| `type` | `PARAMETER_TYPE_INT` / `_FLOAT` / `_BOOL` / `_STRING` |
| `default_value` | applied when the value is omitted at execution |
| `required` | reject execution if omitted and no value supplied |
| `min` / `max` | inclusive bounds, **numeric params only** |
| `description` | human-readable doc |

The engine validates supplied `input_params` **before** running the sandbox: unknown keys,
missing-required, type mismatches, and out-of-range values are returned as a structured
`parameter_errors` list (`{name, reason}`) on the response with `success=false`, and the formula
body never runs. Omitted optional parameters fall back to their declared `default_value`.

A saved formula (`formula_id`) validates against its stored definitions. An **inline**
`ExecuteFormula` run (`formula_source`, e.g. the authoring **Run** with an unsaved buffer) has no
stored formula, so it validates against the definitions passed on
`ExecuteFormulaRequest.parameters` — letting authors test typed parameters before registering.

**Engine-enforced soft cap**: a formula may declare at most **32 parameters** (hardcoded in the
indicators engine — `app/services/parameters.py`). This cap is **not** a config key; there is no
new `indicators.*` key for it. Parameter names must be valid Python identifiers and unique within
a formula.

Strategy components (`COMPONENT_KIND_CUSTOM_FORMULA`) may set the **numeric** (int/float)
parameters per component via `StrategyComponent.params`; bool/string parameters are usable only in
standalone formula runs, not per strategy component.

### Sandbox Constraints

All values are sourced from `xstockstrat-config` namespace `indicators`:

| Constraint | Config Key | Default |
|---|---|---|
| Execution timeout | `indicators.sandbox.timeout_ms` | `5000` ms |
| Memory cap | `indicators.sandbox.memory_bytes` | `128 MiB` |
| Allowed imports | `indicators.sandbox.allowed_imports` | `numpy,pandas,math,statistics` |

**Forbidden**: `os`, `sys`, `subprocess`, `socket`, `urllib`, `requests`, `open`, `exec`, `eval`, `__import__` (overrides), filesystem access, network access.

---

## Registering a Custom Formula

### Via gRPC (preferred)
```python
resp = stub.RegisterFormula(indicators_pb2.RegisterFormulaRequest(
    name="Custom Bollinger",
    description="Bollinger Bands with custom std multiplier",
    source=formula_source_string,
    is_public=True,
    input_schema={
        "close": "list[float]",
        "period": "int",
        "multiplier": "float",
    },
))
formula_id = resp.formula_id
print(f"Registered: {formula_id}")
```

### Via Connect-RPC
The webhook endpoint `execute-formula` was removed in feature-011. Use `ExecuteFormula` RPC on port 8054 directly:

```bash
curl -X POST http://xstockstrat-indicators:8054/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula \
  -H 'Content-Type: application/json' \
  -d '{
    "formula_source": "...",
    "input_data": { "close": [...], "period": 20 }
  }'
```

---

## Testing a Formula Locally

### Step 1 — Write and lint the formula
```bash
python3 -c "
data = {'close': [44.5, 44.3, 44.8, 45.1, 44.9], 'period': 3}
# paste your formula here
print(result)
"
```

### Step 2 — Test via ExecuteFormula RPC with short timeout
```python
resp = stub.ExecuteFormula(indicators_pb2.ExecuteFormulaRequest(
    formula_source=your_source,
    input_data=Struct(fields={"close": ListValue(...), "period": Value(number_value=3)}),
    timeout_ms_override=2000,  # short timeout for testing
    memory_bytes_override=32 * 1024 * 1024,  # 32 MiB for testing
))
print("success:", resp.success)
print("output:", dict(resp.output))
print("exit_reason:", resp.exit_reason)
print("execution_ms:", resp.execution_ms)
```

### Step 3 — Check exit reasons
| Exit Reason | Cause | Fix |
|---|---|---|
| `TIMEOUT` | Exceeded `timeout_ms` | Optimise algorithm or increase limit via config |
| `MEMORY_EXCEEDED` | Exceeded `memory_bytes` | Reduce data size or increase limit via config |
| `IMPORT_BLOCKED` | Blocked import used | Use only allowed imports |
| `RUNTIME_ERROR` | Python exception | Fix formula logic |

---

## Changing Sandbox Limits

To adjust sandbox limits for all formulas, use the config rollout process (`docs/runbooks/config-rollout.md`):

```json
{
  "changes": [
    { "namespace": "indicators", "key": "sandbox.timeout_ms", "value": { "int_val": 10000 } },
    { "namespace": "indicators", "key": "sandbox.memory_bytes", "value": { "int_val": 268435456 } }
  ],
  "author": "platform-team",
  "reason": "Increase limits for complex ML formulas"
}
```

Changes take effect immediately — no service restart needed.

---

## Formula Lifecycle

```
Develop → Test (local) → ExecuteFormula (inline source) → RegisterFormula → Use by formula_id
```

Registered formulas are persisted in the `indicators.formulas` table. For persistence across restarts, register the formula via `RegisterFormula` and reference it by `formula_id` in a `StrategyDefinition` stored in `xstockstrat-analysis` (see the `manage_strategy` MCP tool).

## Using Indicators in a Strategy Definition

A **StrategyDefinition** (feature 047-strategy-engine, stored in `xstockstrat-analysis`) composes one or
more **components** with explicit **entry/exit rules**. Each component is either a built-in indicator or
a custom formula:

- `kind: COMPONENT_KIND_BUILTIN_INDICATOR` — uses an `indicator` name from the built-in registry:
  `SMA`, `EMA`, `RSI`, `MACD`, `BB`, `ATR`, `VWAP`, `STOCH`.
- `kind: COMPONENT_KIND_CUSTOM_FORMULA` — uses a `formula_id` returned by `RegisterFormula`.

Components are referenced by `ref_name` in the `entry_rule` / `exit_rule` JSON condition trees. Leaf
nodes use a function (`crosses_above`, `crosses_below`, `>`, `<`, `>=`, `<=`) over a `lhs` ref_name and
a numeric or ref_name `rhs`; `AND`/`OR` nodes compose them.

Example `StrategyDefinition` (two components + an entry rule):

```json
{
  "strategy_id": "rsi_sma_combo",
  "display_name": "RSI + SMA",
  "components": [
    { "ref_name": "sma_fast", "kind": "COMPONENT_KIND_BUILTIN_INDICATOR", "indicator": "SMA", "params": { "period": 20 } },
    { "ref_name": "rsi", "kind": "COMPONENT_KIND_CUSTOM_FORMULA", "formula_id": "f-abc123" }
  ],
  "entry_rule": "{\"op\":\"AND\",\"conditions\":[{\"lhs\":\"sma_fast\",\"fn\":\"crosses_above\",\"rhs\":\"rsi\"}]}",
  "exit_rule": "{\"fn\":\"crosses_below\",\"lhs\":\"sma_fast\",\"rhs\":\"rsi\"}"
}
```

Register a strategy via the `manage_strategy` MCP tool (admin-scoped) or the `ManageStrategy` gRPC RPC
on `xstockstrat-analysis`. The shared evaluator lives at
`services/xstockstrat-analysis/app/services/evaluator.py` and is reused by both `RunBacktest`
(feature 047) and the live strategy→alert runtime (feature 048), guaranteeing backtest/live parity.
