# xstockstrat-indicators — CLAUDE.md

## Role

Python gRPC service providing two capabilities:

1. **Built-in indicator engine** — vectorized computation of SMA, EMA, RSI, MACD, BB, ATR, VWAP, STOCH
2. **Sandboxed Python formula execution** — user-defined formulas run in subprocess isolation with configurable timeout and memory cap

## Language

Python 3.12 (asyncio, grpc.aio)

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50054` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`app/main.py` runs a single `grpc.aio` server). All callers —
internal services, the frontends, and the MCP agent — connect over gRPC `50054`. The former
HTTP/Connect-RPC server on `8054` was removed.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | **Sandbox limits sourced from config** |
| xstockstrat-ledger | gRPC write | Emit formula execution events |
| xstockstrat-notify | gRPC write | Alert on sandbox limit breaches |
| TimescaleDB | asyncpg pool | Persist formula definitions to `indicators.formulas` |

## Database

- Schema: `indicators`
- Table: `indicators.formulas` — stores formula definitions, scoped by `author`
  - `input_schema JSONB` — legacy advisory map (retained, not validated)
  - `parameters JSONB` (default `'[]'`) — ordered list of typed parameter definitions
    (`FormulaParameter`: `name`, `type`, `default_value`, `required`, `min`/`max`, `description`)
- Migrations: `migrations/001_formulas.*` (table); `migrations/002_formula_parameters.*` (adds the
  `parameters` JSONB column)
- Pool: `asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)` created in `app/main.py`

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

## Typed Formula Parameters

Formulas may declare typed parameters (`FormulaParameter`) with defaults, validation, and
descriptions. Distinct from the OHLCV/series `data` input:

- **Execution input**: parameter VALUES arrive in `ExecuteFormulaRequest.input_params` (a
  `google.protobuf.Struct`), separate from `input_data`. The sandbox exposes them to the formula as
  a dedicated `params` dict (read via `params["<name>"]`) — **never** merged into `data`.
- **Validation before execution**: `app/services/parameters.py` resolves defaults, coerces/type-checks
  values (int/float/bool/string), and enforces `min`/`max` (numeric only). Failures return a
  structured `ExecuteFormulaResponse.parameter_errors` (`{name, reason}`) with `success=false`, and the
  sandbox is never invoked.
- **Definition validation**: at Register/Update, names must be valid, unique Python identifiers; type
  must not be `UNSPECIFIED`; `min`/`max` apply to numeric params only.
- **Soft cap**: at most **32 parameters** per formula, hardcoded in `app/services/parameters.py`
  (`MAX_PARAMETERS`). **No new config key** — the cap is engine-enforced, not in `indicators.*`.

## Webhooks

_No webhooks. Call the gRPC RPCs on port 50054 directly._

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `indicators.formula.executed` | Sandbox execution completes |
| `indicators.sandbox.timeout` | Formula timed out |
| `indicators.sandbox.memory_exceeded` | Formula exceeded memory cap |
| `indicators.formula.registered` | New formula registered |

## Environment Variables

```text
GRPC_PORT=50054
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:devpassword@timescaledb:5432/xstockstrat?sslmode=disable
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Tests

```bash
uv sync --extra dev   # install deps (including dev) from uv.lock
uv run pytest         # run all tests
uv run pytest --cov=app --cov-fail-under=50  # with coverage
```

After any change to `pyproject.toml`, run `uv lock` and commit the updated `uv.lock`.

## Running Locally

```bash
uv sync
uv run python -m app.main
```
