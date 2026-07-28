# xstockstrat-indicators — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious sandbox invariants (thread-pinning before numpy import, `RLIMIT_DATA` not `RLIMIT_AS`, `MessageToDict` not `dict()`, copy-into-fresh-builtins) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (fictional ledger/notify deps, ⚠ sandbox env inheritance) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

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
| TimescaleDB | asyncpg pool | Persist formula definitions to `indicators.formulas` |

## Database

- Schema: `indicators`
- Table: `indicators.formulas` — stores formula definitions, scoped by `author`
  - `input_schema JSONB` — legacy advisory map (retained, not validated)
  - `parameters JSONB` (default `'[]'`) — ordered list of typed parameter definitions
    (`FormulaParameter`: `name`, `type`, `default_value`, `required`, `min`/`max`, `description`)
  - `outputs JSONB` (default `'[]'`) — ordered list of declared output series
    (`FormulaOutput`: `name`, `description`); the primary `value` series is implicit
  - `warmup_period INTEGER` (default `0`) — bars this formula needs before its outputs are valid
    (feature 064); read by `xstockstrat-analysis` for the Option-C backtest warm-up length
- Migrations: `migrations/001_formulas.*` (table); `migrations/002_formula_parameters.*` (adds the
  `parameters` JSONB column); `migrations/003_formula_outputs.*` (adds the `outputs` JSONB column);
  `migrations/004_formula_warmup.*` (adds the `warmup_period` INTEGER column)
- Pool: `asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DB_POOL_MAX", "2")))` created in `app/main.py:49-50` (max 2 keeps the 20-connection budget)

## Config Keys Consumed

Namespace: `indicators`

| Key | Type | Default | Description |
|---|---|---|---|
| `indicators.sandbox.timeout_ms` | int | `5000` | Max formula execution time in ms |
| `indicators.sandbox.memory_bytes` | int | `134217728` | Max memory (128 MiB) per formula |
| `indicators.sandbox.allowed_imports` | string | `numpy,pandas,math,statistics` | Comma-separated allowed Python imports |
| `indicators.sandbox.max_concurrent` | int | `4` | **Documented, not yet enforced** — intended concurrency cap; no `Semaphore`/limit reads it |

## Seeded Formulas

A built-in **public** "Value+Quality Composite" fundamentals formula (feature 063) is seeded at
startup by `app/services/seed_formulas.py` (called from `app/main.py` after the DB pool is created,
before serving). The definition lives in `app/formulas/fundamentals_value_quality.py` — source,
typed `params` (band endpoints + weights), declared outputs (`quality`, `composite`; `value` is the
implicit primary series), and a **deterministic well-known** `FORMULA_ID`
(`d1ff5e6b-6d9c-589d-b95e-defd862c702b`, a UUIDv5). Seeding is **idempotent**: it upserts on the
`formula_id` PK (`FormulasRepository.upsert`, `ON CONFLICT`), so re-seeding on every restart is safe
and a band/param/source change takes effect on the next deploy. Feature 062 references the formula by
this stable id (`analysis.fundsignal.scoring_formula_id`, 062-owned). Seeding is non-fatal — a
failure is logged and never blocks startup.

## Sandbox Security Model

- **Subprocess isolation**: formula runs in a fresh Python subprocess
- **Memory cap**: enforced via `resource.setrlimit(RLIMIT_DATA)` in the child (heap +
  anonymous mmap; `RLIMIT_AS` would reject numpy/pandas over their large virtual-memory
  reservations before any real memory is used)
- **BLAS/OMP threads pinned to 1**: numeric libs spawn one buffer-reserving thread per core
  on import, which overflows the cap (`OpenBLAS error: Memory allocation still failed after
  10 retries`); the subprocess env pins `OPENBLAS/OMP/MKL/NUMEXPR/VECLIB` thread counts to 1
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
- **Definition source per run**: a saved formula (`formula_id`) validates `input_params` against its
  stored definitions. An inline `formula_source` run (the authoring "Run" with an unsaved buffer) has
  no stored formula, so it validates against the definitions supplied on
  `ExecuteFormulaRequest.parameters` — letting authors test typed params before registering.
- **Definition validation**: at Register/Update, names must be valid, unique Python identifiers; type
  must not be `UNSPECIFIED`; `min`/`max` apply to numeric params only.
- **Soft cap**: at most **32 parameters** per formula, hardcoded in `app/services/parameters.py`
  (`MAX_PARAMETERS`). **No new config key** — the cap is engine-enforced, not in `indicators.*`.

## Declared Formula Outputs

Formulas may declare the output series they emit (`FormulaOutput`: `name`, `description`),
analogous to typed parameters. This lets the analysis service validate strategy rules that
reference a formula series as `<ref_name>.<series>` and lets the sandbox enforce the contract:

- **Implicit primary series**: every formula emits `value` (the `result` dict's `value` key).
  `value` is reserved and must **not** be declared in `outputs`.
- **Definition validation** (Register/Update, `app/services/parameters.py` `validate_outputs`):
  output names must be valid, unique Python identifiers; at most **16** outputs (`MAX_OUTPUTS`).
- **Execution enforcement** (`ExecuteFormula`): when a stored formula declares outputs, the
  sandbox result dict must contain every declared series, else the run fails with
  `SANDBOX_EXIT_REASON_RUNTIME_ERROR` and an error naming the missing series. Inline
  `formula_source` runs have no stored definition, so no output enforcement applies.

## Webhooks

_No webhooks. Call the gRPC RPCs on port 50054 directly._

## Environment Variables

```text
GRPC_PORT=50054
CONFIG_ENDPOINT=xstockstrat-config:50060
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

## Running Locally

```bash
uv sync
uv run python -m app.main
```
