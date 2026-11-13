# xstockstrat-indicators — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious sandbox invariants (thread-pinning before numpy import, `RLIMIT_DATA` not `RLIMIT_AS`, `MessageToDict` not `dict()`, copy-into-fresh-builtins) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects and open questions in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Python gRPC service providing two capabilities:

1. **Built-in indicator engine** — vectorized computation of SMA, EMA, RSI, MACD, BB, ATR, VWAP, STOCH
   (`ATR` and `VWAP` are close-only approximations — the close-to-close mean of `|Δclose|` and the running
   mean of closes — not Wilder ATR or volume-weighted VWAP; the 1-D `values` input carries no high/low/volume, feature 268)
2. **Sandboxed Python formula execution** — user-defined formulas run in subprocess isolation with configurable timeout and memory headroom

**Formulas are private to their author (feature 224) — there is no public concept.** `is_public`
and `ListFormulas`' `include_public` are deprecated and ignored. No write path writes `is_public`;
the column keeps `DEFAULT FALSE` and is dropped by a later contract.

- **Identity gate.** Every owner-scoped RPC (all but `ComputeIndicator`/`ListIndicators`/
  `ListFundamentalMetrics`) rejects a call with no `x-user-id` `UNAUTHENTICATED` (feature 225
  `owner_scoped`), before the body runs.
- **Author = the `x-user-id` header only.** `RegisterFormula` stamps it (the body `author` is
  ignored). `UpdateFormula`/`DeleteFormula` check ownership against the `x-user-id` header only.
  There is **no** admin override for writes, and a `SYSTEM_AUTHOR` formula is read-only to every
  caller (`PERMISSION_DENIED`).
- **Reads (`_can_read_formula`).** `GetFormula`/`ExecuteFormula` serve a formula only to its author or
  when it is authored by `SYSTEM_AUTHOR` (`"system"`); otherwise `NOT_FOUND`, so the response does not
  reveal whether the id exists. `ListFormulas` returns own + system formulas.
- **Admin is audited read-only.** An ADMIN may `GetFormula` a foreign formula, or name another owner
  in `ListFormulas`' `author_filter`; each such read appends `audit.admin_read` to ledger
  (`app/admin_audit.py`) and fails closed `UNAVAILABLE` if the append fails. An ADMIN
  `ExecuteFormula` of a foreign formula → `PERMISSION_DENIED`.
- **Internal grants are SAN-bound.** An `x-internal-caller` grant counts only when the mTLS peer SAN
  is `xstockstrat-analysis` (`_internal_grant`, `peer_san_matches`). `x-user-id: system` needs the
  `analysis-fundsignal` grant, else `PERMISSION_DENIED`.
- **Templates.** `ListTemplates` / `ManageTemplate` (ADMIN only) / `InstantiateTemplate` over
  `indicators.formula_templates`. The strategy-template saga's batch copy and `ResolveTemplateIntent`
  require the dedicated `analysis-template-saga` grant; its copies stay hidden
  (`pending_intent_id` set) until the intent commits, and are hard-deleted on abort.

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

The image installs `libseccomp2` (runtime, kept) plus `libseccomp-dev`+`gcc` (build-only, purged after `uv sync`) so the `pyseccomp` binding compiles and loads — the formula sandbox loads a seccomp-BPF filter in each child (feature 209). Runs as root on purpose (INDICATORS-6). The single-stage `uv` pattern is otherwise unchanged.

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
- **System templates are read-only (PLAT-19).** If the seed's collision guard raises (a seeded id held
  by a non-system row): fix that row, `migrate force 7`, re-run.

## Config Keys Consumed

Namespace: `indicators`. Keys are listed and read as namespace-relative (`sandbox.timeout_ms`); logs and errors
may print the FQN `indicators.<key>`.

| Key | Type | Default | Description |
|---|---|---|---|
| `sandbox.timeout_ms` | int | `5000` | Max formula execution time in ms, on top of the `sandbox.startup_grace_ms` wall allowance for interpreter + numpy/pandas startup. `ExecuteFormula` clamps the effective timeout to the caller's remaining gRPC deadline minus the grace and a 500 ms margin (WARN when it clamps; refused without spawning below 100 ms). `ExecuteFormula`'s `timeout_ms_override` / `memory_bytes_override` can only **lower** this key and `memory_bytes` (`_clamp_override`); `≤ 0` means use the config value. A stored ≤ 0 reads as the default |
| `sandbox.memory_bytes` | int | `134217728` | Formula memory **headroom** (128 MiB) above the child's runtime-measured pre-lockdown `VmData` baseline; `RLIMIT_DATA` = baseline + this value (feature 228). A stored ≤ 0 reads as the default |
| `sandbox.allowed_imports` | string | `numpy,pandas,math,statistics` | Comma-separated allowed Python imports. A configured `""` is honoured: it denies all imports rather than reverting to this permissive default (feature 173) |
| `sandbox.max_concurrent` | int | `4` | Semaphore bound on concurrent off-loop sandbox `subprocess.run` spawns in `ExecuteFormula` (feature 176, FR-5). Read once in `IndicatorsServicer.__init__` via `ConfigWatcher.sandbox_max_concurrent()`, which clamps through `int_positive`: a stored ≤ 0 reads as the default. |
| `sandbox.startup_grace_ms` | int | `5000` | Wall-clock allowance (ms) added to the formula timeout for interpreter + numpy/pandas startup (feature 295; was the fixed `SANDBOX_STARTUP_GRACE_MS`). Read per `ExecuteFormula` via `ConfigWatcher.sandbox_startup_grace_ms()` (`int_positive`: a stored ≤ 0 reads as the default). Seeded by config migration `041` |

## Seeded Formulas

A built-in **system** "Value+Quality Composite" fundamentals formula (feature 063,
`app/formulas/fundamentals_value_quality.py`) is seeded idempotently at startup by
`app/services/seed_formulas.py` under a stable UUIDv5 `FORMULA_ID` referenced by
`analysis.fundsignal.scoring_formula_id`; seeding is non-fatal.

The seeded formula declares `FUNDAMENTAL_INPUTS` (`fundamentals_value_quality.py`) — the 6 metrics it
reads (`pe_ratio`, `pb_ratio`, `dividend_yield`, `roe`, `debt_to_equity`, `eps`) — set on the row via
the idempotent seed `upsert` (feature 200), never a raw DB backfill (C-10(c)). The template
`tpl-fundamentals_value_quality_composite_template` (migration `008`) carries a copy of this definition,
pinned by `tests/test_seed_formula_templates.py` — a change here needs a migration updating that
template in the same PR. This marks it a
fundamentals-only formula so `xstockstrat-analysis` feeds it fundamentals (PIT in a backtest, snapshot
on live) rather than OHLCV closes.

## Sandbox Security Model

OS-level containment (feature 209), applied in the child wrapper after the numeric-lib import and before
the untrusted `exec` (never `preexec_fn`): secret-free env, `setuid(nobody)` (INDICATORS-6), `NO_NEW_PRIVS`,
expanded rlimits (`RLIMIT_DATA`, not `RLIMIT_AS`), a seccomp-BPF allowlist (`_SECCOMP_ALLOW`), BLAS threads
pinned to 1. The order is load-bearing — mechanics in the `app/services/sandbox.py` module docstring and
`_SANDBOX_WRAPPER`, invariants in INDICATORS-1..11.

- **Deterministic termination**: `Popen(start_new_session=True)` + `killpg(SIGKILL)` **before the leader
  is reaped** — on timeout and on a watchdog breach — so a `fork()+sleep(∞)` grandchild cannot survive
  to hold an NPROC slot there. `_killpg` only kills while `proc.returncode is None`; after
  `communicate()` has reaped the leader the `finally` call is a no-op, so the success and
  non-zero-exit paths do **not** sweep survivors (findings; a real post-reap sweep is a separate
  design decision).
- **Memory watchdog (feature 300)**: `RLIMIT_DATA` is not trusted alone; a parent watchdog kills the
  process group on memory growth (INDICATORS-2). R1/R2 mechanics and residuals: this service's `docs/` folder (**`sandbox.md`**).
- **Container limit and sizing (feature 300)**: homelab runs indicators with `mem_limit` and
  `memswap_limit` of 2 GiB, matching the 2 GB DigitalOcean `basic-s`. Worst case is roughly
  `parent + max_concurrent × (baseline + memory_bytes + overshoot)` — about 1-1.4 GiB at the defaults.
  Re-check it whenever the live `sandbox.max_concurrent` or `sandbox.memory_bytes` change (owned
  follow-up; there is no sizing WARN).
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
- **Caps** (`MAX_PARAMETERS`, `MAX_OUTPUTS`) live in `app/services/parameters.py` — engine
  constants, not config keys.

## Declared Formula Outputs

Formulas may declare the output series they emit (`FormulaOutput`: `name`, `description`),
analogous to typed parameters. This lets the analysis service validate strategy rules that
reference a formula series as `<ref_name>.<series>` and lets the sandbox enforce the contract:

- **Implicit primary series**: every formula emits `value` (the `result` dict's `value` key).
  `value` is reserved and must **not** be declared in `outputs`.
- **Definition validation** (Register/Update, `app/services/parameters.py` `validate_outputs`):
  output names must be valid, unique Python identifiers.
- **Execution enforcement** (`ExecuteFormula`): when a stored formula declares outputs, the
  sandbox result dict must contain every declared series, else the run fails with
  `SANDBOX_EXIT_REASON_RUNTIME_ERROR` and an error naming the missing series. Inline
  `formula_source` runs have no stored definition, so no output enforcement applies.
- **No-output failure (feature 268)**: success requires the child's last `__OUTPUT__:` marker line to
  parse. Exit 0 with no marker fails `SANDBOX_EXIT_REASON_RUNTIME_ERROR` ("formula produced no output");
  an unparseable last marker fails the same way ("formula output could not be parsed: …"); a non-zero exit
  with empty stderr reports "formula exited with code N before producing output". The wrapper prints the
  marker on its own line, so a formula printing a valid marker then `SystemExit(0)` is an accepted
  author-controlled forgery of its own result, not an isolation breach.

## Observability (feature 294-signal-map-instrumentation)

- No `loop tick ok`: the config watcher is a reconnect loop, not a tick loop.
- Instruments: `indicators.sandbox.executions{exit_reason}` and `indicators.sandbox.duration{exit_reason}` (success|timeout|memory_exceeded|runtime_error|import_blocked|other; parameter errors are not counted), `indicators.sandbox.queue_wait`, gauge `indicators.config.snapshot_age`, `template.instantiate{service, outcome}`.
- Memory watchdog and startup probe (feature 300): label-free gauges `indicators.sandbox.memory_cap_enforced`
  (1 only when all three probe legs are refused) and `indicators.sandbox.memory_watchdog_observable` (0
  means R1 is blind). One INFO `sandbox memory probe` line at boot (uname, `/proc/version`, cgroup
  `memory.max`, inherited `RLIMIT_DATA`, cap set/read, VmData/RssAnon deltas, the three leg results,
  `enforced`, `observable`); ERRORs `sandbox memory cap not kernel-enforced`, `sandbox memory watchdog
  cannot observe child` (once per process) and `sandbox memory probe failed`; a DEBUG `sandbox watchdog
  peak` record per armed run with the peaks and both limits. The probe runs right after
  `init_telemetry()`, before the config wait, and never stops startup.
- Load-bearing logs: INFO `config stream ended cleanly`; watcher reconnect WARNs at the 1st and every 10th consecutive failure (`_RECONNECT_LOG_EVERY`, N=10); a non-success sandbox run WARNs with `exit_reason`. `executing formula` is DEBUG.

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — root `CLAUDE.md` § Environment Variable Naming Convention.

```text
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Tests

```bash
uv run pytest --cov=app --cov-fail-under=50  # with coverage
```

## Maintenance

`app.maintenance.legacy_authors` repairs non-UUID formula authors; follow `docs/runbooks/legacy-formula-authors.md` (INDICATORS-12).
