# xstockstrat-indicators — CLAUDE.md

## Role
Python gRPC service providing two capabilities:
1. **Built-in indicator engine** — vectorized computation of SMA, EMA, RSI, MACD, BB, ATR, VWAP, STOCH
2. **Sandboxed Python formula execution** — user-defined formulas run in subprocess isolation with configurable timeout and memory cap

## Language
Python 3.12 (asyncio, grpc.aio)

## gRPC Port
`50054`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | **Sandbox limits sourced from config** |
| xstockstrat-ledger | gRPC write | Emit formula execution events |
| xstockstrat-notify | gRPC write | Alert on sandbox limit breaches |

## Config Keys Consumed

Namespace: `indicators`

| Key | Type | Default | Description |
|---|---|---|---|
| `indicators.sandbox.timeout_ms` | int | `5000` | Max formula execution time in ms |
| `indicators.sandbox.memory_bytes` | int | `134217728` | Max memory (128 MiB) per formula |
| `indicators.sandbox.allowed_imports` | string | `numpy,pandas,math,statistics` | Comma-separated allowed Python imports |
| `indicators.sandbox.max_concurrent` | int | `4` | Max concurrent sandbox executions |

## Sandbox Security Model

- **Subprocess isolation**: formula runs in a fresh Python subprocess
- **Memory cap**: enforced via `resource.setrlimit(RLIMIT_AS)` in the child
- **Timeout**: enforced via `subprocess.run(timeout=...)` + SIGKILL
- **Import whitelist**: only `allowed_imports` config keys may be `import`ed
- **Builtin filter**: dangerous builtins (`open`, `exec`, `eval`, `__import__` override, etc.) removed
- **No network/filesystem**: `socket`, `urllib`, `requests`, `os.system` not in whitelist

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/compute-indicator` | POST | `{indicator, values, params, symbol}` | Computes built-in indicator |
| `/webhooks/n8n/execute-formula` | POST | `{formula_source, input_data, timeout_ms_override}` | Runs sandboxed formula |

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `indicators.formula.executed` | Sandbox execution completes |
| `indicators.sandbox.timeout` | Formula timed out |
| `indicators.sandbox.memory_exceeded` | Formula exceeded memory cap |
| `indicators.formula.registered` | New formula registered |

## Environment Variables

```
GRPC_PORT=50054
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
```

## Running Locally

```bash
pip install -r requirements.txt
python -m app.main
```
