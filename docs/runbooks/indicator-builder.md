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

### Formula Interface Contract

Your Python formula receives a `data` dict and must assign its output to a `result` variable.

```python
# data: dict passed from ExecuteFormulaRequest.input_data
# result: must be set before formula ends

import numpy as np

prices = data["close"]       # list of closing prices
period = int(data.get("period", 20))

arr = np.array(prices, dtype=float)
sma = np.convolve(arr, np.ones(period) / period, mode='valid')
stdev = [np.std(arr[i:i+period]) for i in range(len(arr) - period + 1)]

result = {
    "sma": sma.tolist(),
    "std": stdev,
    "upper_2std": (sma + 2 * np.array(stdev)).tolist(),
    "lower_2std": (sma - 2 * np.array(stdev)).tolist(),
}
```

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
