# xstockstrat-indicators — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious sandbox invariants (thread-pinning before numpy import, `RLIMIT_DATA` not `RLIMIT_AS`, `MessageToDict` not `dict()`, copy-into-fresh-builtins) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (⚠ sandbox env inheritance) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Python gRPC service providing two capabilities:

1. **Built-in indicator engine** — vectorized computation of SMA, EMA, RSI, MACD, BB, ATR, VWAP, STOCH
2. **Sandboxed Python formula execution** — user-defined formulas run in subprocess isolation with configurable timeout and memory cap

**Formulas are private to their author (feature 224) — there is no public concept.** `is_public`
and `ListFormulas`' `include_public` are deprecated and ignored; every write stores `is_public=false`.

- **Author = the `x-user-id` header only.** `RegisterFormula` stamps it (the body `author` is ignored;
  no header → `INVALID_ARGUMENT`). `UpdateFormula`/`DeleteFormula` check ownership via
  `_caller_user_id` (header, falling back to the deprecated body `user_id` only when no header is
  present — release N only). There is **no** admin override for writes, and a `SYSTEM_AUTHOR`
  formula is read-only to every caller (`PERMISSION_DENIED`).
- **Reads (`_can_read_formula`).** `GetFormula`/`ExecuteFormula` serve a formula only to its author or
  when it is authored by `SYSTEM_AUTHOR` (`"system"`); otherwise `NOT_FOUND`, so the response does not
  reveal whether the id exists. `ListFormulas` returns own + system formulas.
- **Admin is audited read-only.** An ADMIN may `GetFormula` a foreign formula, or name another owner
  in `ListFormulas`' `author_filter`; each such read appends `audit.admin_read` to ledger
  (`app/admin_audit.py`) and fails closed `UNAVAILABLE` if the append fails. An ADMIN
  `ExecuteFormula` of a foreign formula → `PERMISSION_DENIED`.
- **Internal grants are SAN-bound.** An `x-internal-caller` grant counts only when the mTLS peer SAN
  is `xstockstrat-analysis` (`_internal_grant`, `peer_san_matches`). `x-user-id: system` needs the
  `analysis-fundsignal` grant, else `PERMISSION_DENIED`. `_INTERNAL_FORMULA_READERS` (`analysis`)
  is a **release-N-only** bypass that lets N-1 analysis read any formula; the follow-up
  "224 enforce + contract" removes it.
- **Templates.** `ListTemplates` / `ManageTemplate` (ADMIN only) / `InstantiateTemplate` over
  `indicators.formula_templates`. The strategy-template saga's batch copy and `ResolveTemplateIntent`
  require the dedicated `analysis-template-saga` grant; its copies stay hidden
  (`pending_intent_id` set) until the intent commits, and are hard-deleted on abort.

## Language

Python 3.13 (asyncio, grpc.aio)

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

The image installs `libseccomp2` (runtime, kept) plus `libseccomp-dev`+`gcc` (build-only, purged after `uv sync`) so the `pyseccomp` binding compiles and loads — the formula sandbox loads a seccomp-BPF filter in each child (feature 209). No `USER` directive: the container runs as **root** so the sandbox child can `setuid` down to nobody. The single-stage `uv` pattern is otherwise unchanged.

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
| xstockstrat-ledger | gRPC write | `audit.admin_read` events for ADMIN foreign formula reads (feature 224) |
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
  - `fundamental_inputs JSONB` (default `'[]'`) — ordered list of `FundamentalMetric` enum ints a
    formula declares as its fundamentals inputs (feature 200). A **non-empty** value marks the formula
    **fundamentals-only**: the analysis evaluator feeds it only these metrics (never OHLCV closes) and
    broadcasts its scalar output. Validated at Register/Update (`validate_fundamental_inputs` rejects
    `FUNDAMENTAL_METRIC_UNSPECIFIED`, the only invalid value for the closed enum).
- Migrations: `migrations/001_formulas.*` (table); `migrations/002_formula_parameters.*` (adds the
  `parameters` JSONB column); `migrations/003_formula_outputs.*` (adds the `outputs` JSONB column);
  `migrations/004_formula_warmup.*` (adds the `warmup_period` INTEGER column);
  `migrations/005_add_formula_soft_delete.*` (adds `deleted_at`; `DeleteFormula` soft-deletes);
  `migrations/006_add_formula_fundamental_inputs.*` (adds the `fundamental_inputs` JSONB column);
  `migrations/007_private_formulas_templates.*` (feature 224: sets every `is_public` false and drops
  its partial index; adds `origin_template_id`/`origin_template_version`/`pending_intent_id` and the
  `indicators.formula_templates` table)
- Pool: `asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=int(os.environ.get("DB_POOL_MAX", "2")), statement_cache_size=…)` in `app/main.py`. `DB_POOL_MAX` is **not** set in the deploy specs for this service — it connects through the DigitalOcean transaction-mode pool (`:25061`), where the client-pool size is not a backend-slot budget, so `max_size` falls back to the code default (2). `statement_cache_size` is `0` when `DB_PGBOUNCER` is set (cached prepared statements are unsafe under transaction pooling — see `docs/patterns/database.md` § Connection pooling); otherwise asyncpg's default (100).

## Config Keys Consumed

Namespace: `indicators`

| Key | Type | Default | Description |
|---|---|---|---|
| `indicators.sandbox.timeout_ms` | int | `5000` | Max formula execution time in ms |
| `indicators.sandbox.memory_bytes` | int | `134217728` | Max memory (128 MiB) per formula |
| `indicators.sandbox.allowed_imports` | string | `numpy,pandas,math,statistics` | Comma-separated allowed Python imports. Read via `get_str_present` (never `get_str`): a configured `""` denies all imports rather than reverting to this permissive default (feature 173) |
| `indicators.sandbox.max_concurrent` | int | `4` | Semaphore bound on concurrent off-loop sandbox `subprocess.run` spawns in `ExecuteFormula` (feature 176, FR-5). Read once in `IndicatorsServicer.__init__` via a new `ConfigWatcher.sandbox_max_concurrent()` accessor with a `max(1, …)` clamp. |

## Seeded Formulas

A built-in **system** (`author = SYSTEM_AUTHOR`, readable by every caller, editable by none) "Value+Quality Composite" fundamentals formula (feature 063) is seeded at
startup by `app/services/seed_formulas.py` (called from `app/main.py` after the DB pool is created,
before serving). The definition lives in `app/formulas/fundamentals_value_quality.py` — source,
typed `params` (band endpoints + weights), declared outputs (`quality`, `composite`; `value` is the
implicit primary series), and a **deterministic well-known** `FORMULA_ID`
(`d1ff5e6b-6d9c-589d-b95e-defd862c702b`, a UUIDv5). Seeding is **idempotent**: it upserts on the
`formula_id` PK (`FormulasRepository.upsert`, `ON CONFLICT`), so re-seeding on every restart is safe
and a band/param/source change takes effect on the next deploy. Feature 062 references the formula by
this stable id (`analysis.fundsignal.scoring_formula_id`, 062-owned). Seeding is non-fatal — a
failure is logged and never blocks startup.

The seeded formula declares `FUNDAMENTAL_INPUTS` (`fundamentals_value_quality.py`) — the 6 metrics it
reads (`pe_ratio`, `pb_ratio`, `dividend_yield`, `roe`, `debt_to_equity`, `eps`) — set on the row via
the idempotent seed `upsert` (feature 200), never a raw DB backfill (C-10(c)). This marks it a
fundamentals-only formula so `xstockstrat-analysis` feeds it fundamentals (PIT in a backtest, snapshot
on live) rather than OHLCV closes.

## Sandbox Security Model

OS-level containment (feature 209): even a `().__class__.__base__.__subclasses__()` language-guard
escape reaches no network, no secrets, no writable FS, and no file reads. The lockdown runs **in the child wrapper,
after** the numeric-lib import and **before** the untrusted `exec` (never `preexec_fn` — unsafe in
this multithreaded service), in this order: eager-import allowed modules and resolve their lazy
attributes (numpy's `fft`/`rec`/`ma`/… load on first access) → `setuid(65534)` (when the
parent is root) → `PR_SET_NO_NEW_PRIVS` → expanded rlimits → seccomp `.load()` → `exec(source)`.

- **Subprocess isolation + secret-free env**: formula runs in a fresh subprocess whose env
  (`_sandbox_env`) strips every service secret and adds `PYTHONDONTWRITEBYTECODE=1` +
  `HOME`/`TMPDIR=/nonexistent` (no `.pyc`/cache writes).
- **Distinct UID** (load-bearing): the child drops to `nobody` (65534) so a same-UID
  `process_vm_readv` / `/proc/<parent>/environ` read of the parent's in-memory secrets is
  blocked cross-UID. Requires the container to run as **root** — do **not** add a `USER` line.
- **seccomp-BPF allowlist** (`pyseccomp`, `ERRNO(EPERM)` default, native arch only): only the
  compute+teardown syscalls are allowed; the whole network family, `execve`/`execveat`,
  `io_uring_*`, `ptrace`, `process_vm_*`, `pidfd_*`, every file-open syscall (`open`/`openat`/
  `openat2`) and write-creating FS ops are absent → `EPERM`. `openat` stays out because the import
  guard is bypassable: attribute traversal from an allowed module reaches the real `os` (e.g.
  `numpy.lib._datasource.os`), so the OS layer has to be what denies file reads. Lazy imports after
  the filter loads therefore fail, which is why the lazy-attribute warm-up exists.
  Fails **closed** on compat ABIs and unknown syscalls. `_SECCOMP_ALLOW` is the audited set;
  `NO_NEW_PRIVS` must stay set (pyseccomp sets it on load — never disable).
- **Expanded rlimits**: `RLIMIT_DATA` (memory; `RLIMIT_AS` would reject numpy's virtual reservations
  — INDICATORS-2), `RLIMIT_CPU` = `ceil(timeout_ms/1000)+2`, `RLIMIT_NPROC` = `max_concurrent*16`
  (fork-bomb bound, derived from config — F-07), `RLIMIT_FSIZE=0`, `RLIMIT_NOFILE=64`.
- **BLAS/OMP threads pinned to 1** (`_THREAD_LIMIT_ENV`): numeric libs otherwise spawn one
  buffer-reserving thread per core and overflow the cap.
- **Deterministic termination**: `Popen(start_new_session=True)` + `killpg(SIGKILL)` on timeout **and
  every exit** — a `fork()+sleep(∞)` grandchild cannot survive to hold an NPROC slot.
- **Import whitelist + builtin filter** (unchanged): only `allowed_imports` may be imported; `open`/
  `exec`/`eval`/`__import__`-override removed via a fresh `__builtins__` (INDICATORS-4).

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

## Environment Variables

> **Inter-service mTLS (feature 210):** this service also requires `MTLS_CERT` / `MTLS_KEY` / `MTLS_CA_CERT` — boot-time PEM strings (its own leaf, private key, and the platform CA). The gRPC server binds mutual TLS and every outbound gRPC dial presents the leaf; **fail-closed** — the service refuses to start if any is absent. `MTLS_KEY` is a `SECRET` in `.do/app*.yaml`. Contract → `docs/patterns/inter-service-mtls.md`; rollout → `docs/runbooks/inter-service-mtls-rollout.md`.

```text
GRPC_PORT=50054
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
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
