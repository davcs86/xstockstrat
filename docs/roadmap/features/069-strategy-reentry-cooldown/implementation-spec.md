# Implementation Spec: strategy-reentry-cooldown

**Status**: `pending`
**Created**: 2026-07-24
**Feature**: `docs/roadmap/features/069-strategy-reentry-cooldown/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/strategy-reentry-cooldown`

---

## Execution Summary

The change flows proto → migration → shared helper → both enforcement paths → reachability surfaces →
docs. Step 1 adds the additive `optional int32 cooldown_days = 9` field and regenerates stubs (proto +
stubs commit together, per the proto-freshness CI gate). Step 2 lands the durable `009_strategy_cooldowns`
table for the live path. Step 3 creates the single shared pure gate helper (`cooldown.py`) plus its
repository — the linchpin of the FR-4 backtest/live-parity requirement — with a paired unit test (Step 4)
that pins the tz-awareness guard. Steps 5–6 wire the ephemeral backtest path (FR-7) plus write-time
negative-value validation (FR-6) and the config default (FR-2); Steps 7–8 wire the durable live path
(FR-8) with best-effort persistence and boot hydration. Steps 9–10 make the field reachable through the
`manage_strategy` MCP tool (FR-10, including the recon-discovered `client.py` gap); Steps 11–12 make it
reachable through the `StrategyWizard` UI form (FR-11) with explicit-presence-honest semantics. Step 13
registers the config key in the two documentation surfaces (AC-6).

The design's superseded product-spec semantics are authoritative here: **unset → platform default (31),
explicit `0` → no cooldown, negative → rejected**. No test asserts the old `0 → 31` collapse.

## Step Dependencies

- Step 1 (proto) must land first — every later step consumes the generated `cooldown_days`/`cooldownDays`
  field. The `.proto` edit and the regenerated `packages/proto/gen/**` stubs MUST be committed in the
  **same** step/PR (proto-versioning runbook §"commit proto source + generated stubs together"; the CI
  `proto-freshness` job fails a proto-only PR).
- Step 3 (helper + repo) requires Step 1 (proto presence API `HasField`) and Step 2 (migration — the repo
  targets `analysis.strategy_cooldowns`).
- Step 4 [test] covers Step 3 [service]. Step 6 [test] covers Step 5 [service]. Step 8 [test] covers
  Step 7 [service]. Step 10 [test] covers Step 9 [service]. Step 12 [test] covers Step 11 [service].
- Steps 5 and 7 both require Step 3 (both import `cooldown.py`). They are independent of each other and
  may be executed in either order.
- Step 9 (agent) and Step 11 (UI) require Step 1 only (regenerated stubs). Step 13 (docs) requires the
  config key name introduced in Step 5; it may land in the same PR as Step 5 or separately.

---

### Step 1 — proto: add `cooldown_days` field + regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/gen/ts/**`, `packages/proto/gen/python/**`, `packages/proto/gen/go/**` — modify (generated; do not hand-edit)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, naming conventions; `xstockstrat-analysis` (service owner) — backtest reproducibility, scoring determinism; `xstockstrat-agent` (service owner) — `manage_strategy` tool accuracy; `xstockstrat-ui` (service owner) — strategy wizard form correctness, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via `Read packages/proto/analysis/v1/analysis.proto:233-242` — `message StrategyDefinition` has fields 1–8 (`strategy_id`=1 … `bool live_enabled = 8;`); field `9` is free.
- `signal_params = 6` is a `google.protobuf.Struct` — NOT the model to copy for a closed scalar; mirror the plain-scalar style of `bool active = 7;` / `bool live_enabled = 8;`.
- Root `CLAUDE.md` §Proto Contract Governance: additive optional field is non-breaking; C-04 (enum-over-string) is N/A — `cooldown_days` is a numeric scalar, not a closed value set.

**TDD**: `N/A (proto)` — contract change; behavior is exercised by the paired tests of the consuming service steps.

**Instructions**:
1. In `message StrategyDefinition` (analysis.proto:233-242), after `bool live_enabled = 8;` add:
   ```proto
   // Per-symbol re-entry cooldown in calendar days (feature 069). optional = explicit presence:
   // unset → platform default (analysis.strategy.default_cooldown_days); explicit 0 → no cooldown
   // (immediate re-entry allowed); negative → rejected at write time (INVALID_ARGUMENT).
   optional int32 cooldown_days = 9;
   ```
   `optional` is mandatory, not stylistic — `HasField("cooldown_days")` is only legal on an explicit-presence field and is the sole way to distinguish "unset → default" from "explicit 0 → no cooldown" (design.md §Proto).
2. Run `./scripts/buf-gen.sh` to regenerate TS/Python/Go stubs; stage `packages/proto/gen/**` in this same step.

**Verification**:
- `cd packages/proto && buf lint` — passes.
- `cd packages/proto && buf breaking --against ".git#branch=feature/strategy-reentry-cooldown"` — passes (additive field, non-breaking).
- `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` — the second run produces an **empty** diff (stubs committed match the proto); a non-empty first-run diff must show only the new `cooldownDays` (TS) / `cooldown_days` (py/go) field.

---

### Step 2 — migration: `009_strategy_cooldowns`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/009_strategy_cooldowns.up.sql` — create
- `services/xstockstrat-analysis/migrations/009_strategy_cooldowns.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness; `xstockstrat-analysis` (service owner) — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-analysis/migrations/` — last file is `008_backtest_details.{up,down}.sql`; next free number is `009` (C-07). `008` merged from main-dev via feature `068-backtest-results-visualization` (context.md collision-resolution note).
- Style model `Read services/xstockstrat-analysis/migrations/007_backtest_run_symbols.up.sql:8-23` — schema-prefixed `analysis.<table>`, `CREATE TABLE IF NOT EXISTS`, composite `PRIMARY KEY`, `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `CREATE INDEX IF NOT EXISTS idx_<short>_<purpose>`; symmetric `.down.sql` (`007_backtest_run_symbols.down.sql:14` `DROP TABLE IF EXISTS`).

**TDD**: `N/A (migration)`.

**Instructions**:
1. `009_strategy_cooldowns.up.sql` — mirror `007`'s header-comment + `IF NOT EXISTS` style:
   ```sql
   -- Live-loop re-entry cooldown state (feature 069).
   -- One durable last-exit timestamp per (strategy_id, symbol) so the live evaluation loop's
   -- per-symbol cooldown survives a service restart (FR-8). Hydrated once at boot into the loop's
   -- in-memory _last_exit_at, upserted on every live-loop exit. Backtests NEVER read/write this
   -- table (FR-7 — backtest cooldown state is ephemeral, per-RunBacktest, in-memory only).
   CREATE TABLE IF NOT EXISTS analysis.strategy_cooldowns (
       strategy_id  TEXT NOT NULL,
       symbol       TEXT NOT NULL,
       last_exit_at TIMESTAMPTZ NOT NULL,
       PRIMARY KEY (strategy_id, symbol)
   );
   ```
   No `cooldown_days` snapshot column — the live `StrategyDefinition.cooldown_days` is re-read at check time (design.md §Persistence — a cooldown edit takes effect immediately; FR-9 already treats it as a definition change). No secondary index — the only reads are `list_all()` at boot (full table scan) and PK upserts on exit.
2. `009_strategy_cooldowns.down.sql`:
   ```sql
   DROP TABLE IF EXISTS analysis.strategy_cooldowns;
   ```

**Verification**:
- `./scripts/db-migrate.sh up` applies `009` cleanly; `./scripts/db-migrate.sh down 1` drops it; re-`up` succeeds (idempotent `IF NOT EXISTS`).
- `psql -c "\d analysis.strategy_cooldowns"` shows the composite PK `(strategy_id, symbol)` and `last_exit_at TIMESTAMPTZ NOT NULL`.

---

### Step 3 — service: shared cooldown gate helper + `StrategyCooldownsRepository`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/cooldown.py` — create
- `services/xstockstrat-analysis/app/repositories/strategy_cooldowns.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Repo model `Read services/xstockstrat-analysis/app/repositories/strategy_scores.py:26-88` — `StrategyScoresRepository(db_pool)` upsert-on-PK via `self._db.fetchrow("INSERT … ON CONFLICT (strategy_id) DO UPDATE …")` and a `list()` reader; this is the "upsert-on-PK, single row per key" analog recon named (over the bulk-insert `backtest_run_symbols` shape).
- Pool reuse: `Read services/xstockstrat-analysis/app/main.py:47-49` — the single `asyncpg.create_pool(..., max_size=DB_POOL_MAX default 2)`. The new repo takes this same pool — **no new pool** (Constitution **F-06**; analysis stays at pool max 2).
- Helper contract from design.md §"Shared helper" (pure functions, no DB/gRPC/proto imports).

**TDD**: `red-green required`.

**Instructions**:
1. `app/services/cooldown.py` — pure module, no DB/gRPC/proto imports:
   - `effective_cooldown_days(cooldown_days: int | None, default_cooldown_days: int) -> int`: `None` (unset) → `default_cooldown_days`; any `int` **including 0** returned as-is (never remaps `0` → default).
   - `is_cooldown_active(last_exit_at: datetime | None, current_ts: datetime, cooldown_days: int) -> bool`:
     - `last_exit_at is None` → `False` (a never-exited pair is never gated).
     - else call an internal `_require_aware(dt)` on **both** `last_exit_at` and `current_ts` that raises `ValueError` on a naive datetime (`dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None`) — the tz-awareness invariant is enforced **inside the helper** (the chokepoint), not by a comment at each call site (ledger insight 2026-07-24, 069).
     - return `current_ts < last_exit_at + timedelta(days=cooldown_days)` — strict `<`, half-open window `[last_exit, last_exit + N days)`: re-entry exactly `N` days after exit is allowed; explicit `cooldown_days == 0` → `current < last_exit + 0` → always `False` → immediate re-entry.
2. `app/repositories/strategy_cooldowns.py` — `StrategyCooldownsRepository`, mirroring `StrategyScoresRepository`'s constructor + upsert-on-PK shape:
   - `__init__(self, db_pool)` → `self._db = db_pool`.
   - `async def upsert(self, strategy_id: str, symbol: str, last_exit_at: datetime) -> None`: `INSERT INTO analysis.strategy_cooldowns (strategy_id, symbol, last_exit_at) VALUES ($1, $2, $3) ON CONFLICT (strategy_id, symbol) DO UPDATE SET last_exit_at = EXCLUDED.last_exit_at`.
   - `async def list_all(self) -> list[dict]`: `SELECT strategy_id, symbol, last_exit_at FROM analysis.strategy_cooldowns` → `[dict(r) for r in rows]`. `asyncpg` returns `TIMESTAMPTZ` as an **aware** datetime, satisfying the helper's contract with no conversion at the hydration site.

**Verification**:
- Paired unit test Step 4 (coverage + behavior).
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 4 — test: cooldown helper unit tests (incl. tz-awareness guard)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_cooldown.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, scoring determinism

**Codebase Evidence**:
- Test dir confirmed via `ls services/xstockstrat-analysis/tests/` (contains `test_strategy_evaluator.py`, `test_live_loop.py`, etc.); a pure-logic module gets its own `test_cooldown.py`.
- The helper is pure `app/` logic → directly counts toward the analysis `--cov=app` measure (spec-template coverage table: analysis 40%).

**TDD**: `red-green required` — author to fail against the pre-Step-3 tree (module does not yet exist), pass after.

**Instructions**: assert, using `datetime(..., tzinfo=UTC)` aware timestamps:
- `effective_cooldown_days`: `None → default`; `0 → 0` (explicit no-cooldown, NOT default); `31 → 31`.
- `is_cooldown_active`: `last_exit_at=None → False`; a `current_ts` 5 days after a 31-day exit → `True`; a `current_ts` exactly 31 days after (`last_exit + timedelta(days=31)`) → `False` (half-open, re-entry allowed at boundary); `cooldown_days=0` with any `current_ts > last_exit` → `False`.
- Guard: `is_cooldown_active(naive_dt, aware_dt, 31)` and `is_cooldown_active(aware_dt, naive_dt, 31)` each raise `ValueError` (naive datetime rejected inside the helper).

**Verification**:
- `cd services/xstockstrat-analysis && pytest tests/test_cooldown.py -q` — all pass (fails before Step 3).
- `cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40` — threshold holds.
- `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 5 — service: backtest cooldown gate (FR-7) + write-time negative validation (FR-6) + config default (FR-2)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Backtest target `Read servicer.py:784-800` — `_backtest_symbol_evaluated(self, symbol, range_msg, definition, initial_equity, commission, slippage, propagation_meta=(), formula_warmup_cache=None)`; called **only** on the composable path at `servicer.py:311-323` (`if active_definition is not None: … _backtest_symbol_evaluated(… definition=active_definition …)`). The legacy SMA `_backtest_symbol` path (`servicer.py:527`) is explicitly Out of Scope.
- Trade loop `Read servicer.py:846-897` — locals `equity`/`position=0.0`/`entry_price=0.0`/`entry_time=None` init at `servicer.py:847-850`; entry gate `if position == 0.0 and decision.entry:` at **`servicer.py:863`**; exit branch `elif position > 0.0 and decision.exit:` at **`servicer.py:873`** (position closed, `entry_time = None` at `servicer.py:896`). `bar = bars[i]` at `servicer.py:854`; `bar.time` is a protobuf `Timestamp` (used at `servicer.py:878` `exit_ts.CopyFrom(bar.time)`). *(NB: these lines drifted ~+14 from recon's Codebase Map after feature 068 merged; the current values above are authoritative.)*
- Config read pattern `Read servicer.py:274` — `self._cfg.get_int("analysis.backtest.max_range_days", 730)`; same shape at `servicer.py:1096` (`shrinkage_days`, 250). Use it for `analysis.strategy.default_cooldown_days` default `31`.
- Validation site `Read evaluator.py:276-305` — `def _validate_definition(definition, formula_outputs=None)` raises `ValueError` on invalid definitions (e.g. `evaluator.py:290` `raise ValueError("Each component must have a non-empty ref_name")`). Wrapped at write time by `_validate_definition_proto` (`servicer.py:163-174`) → `except ValueError as e: await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))`. No pre-existing "reject negative scalar" precedent — this is a new `raise` reusing that wrapper.

**TDD**: `red-green required`.

**Instructions**:
1. Import the helper into `servicer.py`: `from app.services.cooldown import effective_cooldown_days, is_cooldown_active`; ensure `UTC` is importable (`from datetime import UTC`).
2. In `_backtest_symbol_evaluated`, before the trade loop (near the local init at `servicer.py:847-850`):
   - `cooldown_days = effective_cooldown_days(definition.cooldown_days if definition.HasField("cooldown_days") else None, self._cfg.get_int("analysis.strategy.default_cooldown_days", 31))`
   - add local `last_exit_time = None` alongside `entry_time = None`.
   This value is a **per-call local** — never read from or written to `analysis.strategy_cooldowns` (FR-7: backtest state is ephemeral, per-`RunBacktest`, same lifetime as `position`/`entry_price`).
3. At the entry gate (`servicer.py:863`), extend the condition to `if position == 0.0 and decision.entry and not is_cooldown_active(last_exit_time, bar.time.ToDatetime(tzinfo=UTC), cooldown_days):`.
4. In the exit branch (`servicer.py:873`), where the position is closed (alongside `entry_time = None` at `servicer.py:896`), add `last_exit_time = bar.time.ToDatetime(tzinfo=UTC)`.
5. In `evaluator.py` `_validate_definition` (after the component loop, before/after the rule-JSON block at `evaluator.py:307`), add:
   `if definition.HasField("cooldown_days") and definition.cooldown_days < 0: raise ValueError("cooldown_days must be >= 0")`. Unset never triggers it (no `HasField`); explicit `0` passes. The existing `_validate_definition_proto` wrapper (`servicer.py:163-174`) converts this to `INVALID_ARGUMENT`.
6. Trading-domain constraints (`step-constraints.md` §A): **not applicable** — analysis backtesting places no orders; `OrderType`/`BrokerType`/`OrderStatus`/`TRADING_MODE` gates are unaffected by this step.

**Verification**:
- Paired test Step 6.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 6 — test: backtest whipsaw suppression + negative-reject + reproducibility-isolation + fingerprint change

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Test files confirmed via `ls services/xstockstrat-analysis/tests/` — `test_analysis_servicer.py` (backtest + `ManageStrategy`), `test_strategy_evaluator.py` (`_validate_definition`).
- `_definition_fingerprint` `Read servicer.py:1754-1773` — sha256 over `definition_json` **excluding** `_FINGERPRINT_EXCLUDED_KEYS = frozenset({"display_name","active","live_enabled"})` (`servicer.py:1754`); `cooldown_days` is NOT excluded. `definition_json` is built by `MessageToDict(definition, preserving_proto_field_name=True)` at register/update (`servicer.py:1346-1348`, `1355-1357`) — an `optional` field appears in the dict only when set, so unset vs explicit-0 yield different fingerprints. FR-9 requires **no code change** beyond leaving the exclusion set alone.

**TDD**: `red-green required` — each assertion must fail against the pre-Step-5 tree.

**Instructions**:
- **AC-3 (whipsaw)**: drive `_backtest_symbol_evaluated` (or `RunBacktest`) over a synthetic bar/decision sequence where the entry condition is true again on the bar immediately after an exit; assert **no** new `TradeRecord` entry is recorded until the effective cooldown's worth of calendar days (by `bar.time`) has elapsed. Include a case with `cooldown_days` explicitly `0` → immediate re-entry **is** allowed.
- **AC-1 (negative reject)**: `_validate_definition` (in `test_strategy_evaluator.py`) raises `ValueError` for a definition with `cooldown_days = -1`; and `ManageStrategy` register/update (in `test_analysis_servicer.py`) aborts `INVALID_ARGUMENT`. Explicit `0` and unset both pass validation.
- **AC-8 (reproducibility isolation, FR-7)**: two separate `RunBacktest` calls for the same strategy/symbol produce identical trades/metrics — proving backtest cooldown state is a per-call local that never reads a shared/persisted store.
- **AC-9 (fingerprint change, FR-9)**: `_definition_fingerprint` differs across two otherwise-identical `definition_json` dicts that differ only in `cooldown_days` (e.g. absent vs `{"cooldown_days": 14}`).

**Verification**:
- `cd services/xstockstrat-analysis && pytest tests/test_analysis_servicer.py tests/test_strategy_evaluator.py -q` — pass (fail before Step 5).
- `cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40` — threshold holds.
- `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 7 — service: live-loop durable cooldown (FR-8) + boot hydration + main.py wiring

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest/live parity, no look-ahead bias, concurrent write safety

**Codebase Evidence**:
- `Read live_loop.py:36-56` — `LiveEvaluationLoop.__init__(self, config_watcher, db_pool, marketdata_stub, ingest_stub, notify_stub, ledger_stub, evaluator)` (7 params); `self._last_state: dict[tuple[str,str], bool]` at `live_loop.py:54`.
- `Read live_loop.py:109-144` — `_eval_pair`: `bars = list(bars_resp.bars)` at `:115`; `key = (definition.strategy_id, symbol)` at `:124`; entry transition `if not in_position and latest.entry:` at `:128`; exit transition `elif in_position and latest.exit:` at `:130-131`; **alert-throttle early return** at `:137-139` (records `self._last_state[key] = new_state` then returns — the exit transition is detected here too); normal state write `self._last_state[key] = new_state` at `:144`.
- Isolation model `Read live_loop.py:169-186` — `_emit_ledger` wraps its outbound call in its own `try/except → log.warning` so it never propagates; `_run_cycle`'s per-pair guard at `live_loop.py:85-93` only stops one pair from killing the cycle. `_write_cooldown` must mirror `_emit_ledger` (design.md §"`_write_cooldown` isolation").
- `Read main.py:84-106` — inside `if db_pool is not None:` the loop is built with 7 kwargs at `main.py:97-105`; `hydrate_scores()` is called best-effort at `main.py:88-92`. `hydrate_scores` model `Read servicer.py:1256-1267` (repo-`None` guard + `list()` → in-memory dict).
- `datetime`/`UTC`/`timedelta` already imported in `live_loop.py:20`.

**TDD**: `red-green required`.

**Instructions**:
1. `live_loop.py` `__init__`: add trailing kwarg `cooldowns_repo=None` (**default `None`** — no-op fallback, keeps the existing test fixture's constructor working); set `self._cooldowns_repo = cooldowns_repo` and `self._last_exit_at: dict[tuple[str, str], datetime] = {}` (parallel to `_last_state`).
2. Add `async def hydrate_cooldowns(self)` mirroring `hydrate_scores` (`servicer.py:1256-1267`): if `self._cooldowns_repo is None: return`; `for r in await self._cooldowns_repo.list_all(): self._last_exit_at[(r["strategy_id"], r["symbol"])] = r["last_exit_at"]`.
3. In `_eval_pair`, after `bars` is available (`live_loop.py:115`), compute `current_bar_dt = bars[-1].time.ToDatetime(tzinfo=UTC)` (**bar time — not `datetime.now(UTC)`** — so both call sites feed the shared helper the same time-source; rejected alternative in design.md) and `cooldown_days = effective_cooldown_days(definition.cooldown_days if definition.HasField("cooldown_days") else None, self._cfg.get_int("analysis.strategy.default_cooldown_days", 31))` (import `from app.services.cooldown import effective_cooldown_days, is_cooldown_active`).
4. Entry suppression: at the entry transition (`live_loop.py:128`), when `not in_position and latest.entry` but `is_cooldown_active(self._last_exit_at.get(key), current_bar_dt, cooldown_days)` is `True`, treat as steady state (fall through to the `else: return` at `:132-133` — no alert, no state change).
5. Exit persistence: when the exit transition is detected (`live_loop.py:130-131`), set `self._last_exit_at[key] = current_bar_dt` and `await self._write_cooldown(key, current_bar_dt)` **at the transition-detection point, before the alert-throttle check at `:137`** — the cooldown must persist even when the alert is throttled (design.md R1 "throttled-exit write-site gap"; the throttle governs alert cadence, not the exit fact).
6. Add `async def _write_cooldown(self, key, ts)` mirroring `_emit_ledger`'s isolation (`live_loop.py:176-186`): if `self._cooldowns_repo is None: return`; `try: await self._cooldowns_repo.upsert(key[0], key[1], ts) except Exception as e: log.warning("live_loop: cooldown write failed: %s", e)`. It must **never** propagate, so a DB hiccup can never prevent `self._last_state[key] = new_state` from executing (FR-8 best-effort).
7. `main.py`: import `from app.repositories.strategy_cooldowns import StrategyCooldownsRepository`; pass `cooldowns_repo=StrategyCooldownsRepository(db_pool)` into the `LiveEvaluationLoop(...)` constructor (`main.py:97-105`) — inside the existing `if db_pool is not None:` block, so whenever a DB exists the repo is wired (no silent durability loss). After constructing the loop, add a best-effort `await live_loop.hydrate_cooldowns()` (own `try/except → log.warning`, alongside the existing `hydrate_scores()` best-effort call at `main.py:88-92`). Reuses the existing `db_pool` — **no new pool** (F-06).
8. Header propagation (`step-constraints.md` §B): this step adds **no new outbound gRPC call** — the cooldown write is a DB upsert via the existing `db_pool`, not a service RPC. The loop's existing `GetBars`/`EmitAlert`/`AppendEvent` calls are unchanged. No new propagation surface.

**Verification**:
- Paired test Step 8.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 8 — test: live-loop suppression + restart durability + backtest/live parity + fixture updates

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest/live parity, concurrent write safety

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-analysis/tests/` — `test_live_loop.py` exists. Recon: shared `_make_loop()` fixture (`test_live_loop.py:24-32`) with 5 call sites (`:46,65,75,94,124`); the loop bar mock at `:33` must become a real `Timestamp`-backed `.time` once `_eval_pair` reads `bars[-1].time.ToDatetime(...)` (design.md Open Risk — same-step scope).

**TDD**: `red-green required`.

**Instructions**:
- **Fixture updates (same-step scope)**: update `_make_loop()` to pass `cooldowns_repo=None` (or a fake) — the `None` default means the existing 5 call sites need no change, but confirm; and ensure the bar mock the loop evaluates has a **real** `google.protobuf.Timestamp` `.time` (so `bars[-1].time.ToDatetime(tzinfo=UTC)` works), replacing any `object()`-style stub, or `:46/:75/:124` break.
- **AC-4 (live suppression)**: with `_last_exit_at[key]` set to a recent bar time and a `latest.entry` decision on a bar inside the window, assert `_eval_pair` emits **no** entry alert (`notify_stub.EmitAlert` not called) and no state flip; after the window elapses, entry is allowed.
- **AC-7 (restart durability)**: an exit `upsert`s to a fake `cooldowns_repo`; construct a **fresh** `LiveEvaluationLoop` with the same repo, call `hydrate_cooldowns()`, and assert the gate still suppresses an in-window entry — proving the cooldown is not reset by the restart.
- **Parity (FR-4 / C-10(b))**: assert `is_cooldown_active` returns the same verdict for the backtest call shape and the live call shape given identical `(last_exit_at, current_ts, cooldown_days)` — the single shared helper is the sole gate; both call sites feed it bar time.
- C-12 (frontend test-data inventory) does **not** apply — this is a backend (`xstockstrat-analysis`) test, not `xstockstrat-ui`.

**Verification**:
- `cd services/xstockstrat-analysis && pytest tests/test_live_loop.py -q` — pass (fails before Step 7).
- `cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40` — threshold holds.
- `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`

---

### Step 9 — service: `manage_strategy` MCP tool + client `cooldown_days` (FR-10)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — `manage_strategy` tool parameter/docstring accuracy, `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Tool `Read tools.py:289-347` — `manage_strategy(operation, strategy_id, display_name="", components=None, entry_rule="", exit_rule="", signal_params=None)` at `:290-298`; `definition` dict built at `:335-341`; the conditional-include precedent `if signal_params: definition["signal_params"] = signal_params` at `:342-343` (a **truthy** check — must NOT be copied for `cooldown_days`, since `0` is a valid explicit value); forwards `await client.manage_strategy(operation=operation, definition=definition)` at `:345`.
- Client `Read client.py:248-305` — `manage_strategy(operation, definition)` builds `pb_def = analysis_pb2.StrategyDefinition(strategy_id=…, display_name=…, components=…, entry_rule=…, exit_rule=…, active=…)` **field-by-field** at `:283-290` (NOT a dict spread), then merges `signal_params` as a `Struct` at `:291-295`. This is the recon-discovered gap: without a `cooldown_days` kwarg here, the tool's dict value is silently dropped before the RPC.
- Docs `Read docs/runbooks/mcp-tools.md:308-336` — `### manage_strategy` parameter table at `:314-322`, errors table at `:332-335`. FR-10 requires the tool docstring + this table updated in the **same PR**; a parameter addition (not a new tool) does **not** touch the agent `CLAUDE.md` tool table or `docs/runbooks/CLAUDE.md` index (context.md scope note; insights.md 2026-07-20).

**TDD**: `red-green required`.

**Instructions**:
1. `tools.py`: add `cooldown_days: int | None = None` to the `manage_strategy` signature (after `signal_params`, `:297`). After the `definition` dict is built (`:335-341`), add `if cooldown_days is not None: definition["cooldown_days"] = cooldown_days` — an **`is not None`** check (not the truthy `if signal_params:` pattern; `0` must not be dropped). Add a docstring line: `cooldown_days: optional per-symbol re-entry cooldown in calendar days — omit → platform default (31); 0 → no cooldown; negative → rejected (INVALID_ARGUMENT).`
2. `client.py`: add `cooldown_days=definition.get("cooldown_days"),` as an ordinary constructor kwarg inside `analysis_pb2.StrategyDefinition(...)` (`:283-290`). protobuf treats `field=None` as omitted for an `optional` field (no special-case post-construction assignment — the rejected round-2 alternative), so an unset key stays unset and an explicit `0` sets presence.
3. `docs/runbooks/mcp-tools.md`: add to the `manage_strategy` parameter table (`:314-322`): `| cooldown_days | int | No | Per-symbol re-entry cooldown in calendar days. Omit → platform default (31); 0 → no cooldown; negative rejected |`; add an errors-table note that a negative `cooldown_days` → `invalid argument` (INVALID_ARGUMENT).
4. Header propagation: no new outbound gRPC edge — `manage_strategy` already sends `_admin_metadata()` (`client.py:298`); unchanged.

**Verification**:
- Paired test Step 10.
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`

---

### Step 10 — test: agent `manage_strategy` cooldown round-trip

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — tool parameter accuracy

**Codebase Evidence**:
- Test files confirmed via `ls services/xstockstrat-agent/tests/` — `test_tools.py`, `test_client.py`. Recon: `TestManageStrategyTool` (`test_tools.py:336-361`) asserts on `client.manage_strategy` `call_args.kwargs["definition"]`; `TestManageStrategyClient` (`test_client.py:80-109`) mocks the gRPC stub and asserts on the constructed message.
- Agent CI coverage threshold **40%** (`services/xstockstrat-agent/CLAUDE.md` §Running Tests — `pytest --cov=app --cov-fail-under=40`).

**TDD**: `red-green required`.

**Instructions**:
- `test_tools.py`: call the `manage_strategy` tool with `cooldown_days=14` → assert the forwarded `definition["cooldown_days"] == 14`; with `cooldown_days=0` → assert the key is present and `== 0` (explicit no-cooldown not dropped); omitting the arg → assert `"cooldown_days"` **not in** the forwarded `definition`.
- `test_client.py`: with a mocked `AnalysisServiceStub`, assert the constructed `StrategyDefinition` round-trips presence — `HasField("cooldown_days")` true for `14` and for `0`, false when the `definition` dict has no `cooldown_days` key.

**Verification**:
- `cd services/xstockstrat-agent && pytest tests/test_tools.py tests/test_client.py -q` — pass (fail before Step 9).
- `cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40` — threshold holds.
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .`

---

### Step 11 — service: `StrategyWizard` cooldown input (FR-11)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — strategy wizard form correctness, Connect-RPC call safety

**Codebase Evidence**:
- `Read StrategyWizard.tsx` (full) — `handleSubmit` builds `definition` (`:116-128`) with `strategyId/displayName/components/entryRule/exitRule/signalParams` and no cooldown key; `mutate({ operation, definition }, …)` at `:129-135`. Step 1 "Identity" form at `:178-203` (`strategyId`/`displayName` inputs — strategy-level fields). `canAdvance` step-1 branch `idValid && displayName.trim() !== ''` at `:106-113`. `stepForError` heuristic at `:80-86` (`strategy_id`/`display` → step 1). Step-4 numeric-input pattern (`<Input type="number" …>`) at `:271-304`.
- Read-path parity (C-10(b)) — **confirmed no read-path edit needed**: `Read src/hooks/useStrategyDefinitions.ts:10` — `StrategyDefinitionInit = MessageInitShape<typeof StrategyDefinitionSchema>` is **proto-generated**, so `cooldownDays` flows through `useManageStrategy`/`useGetStrategy` automatically; the wizard imports the generated `StrategyDefinition` type (`StrategyWizard.tsx:4`). *(Insights list/detail page + `insightsBff.ts` forward-only parity: see the codebase-discovery digest folded into context.md.)*
- protobuf-es `optional int32` contract (design.md, Context7-grounded): generates `cooldownDays?: number | undefined`; `msg.cooldownDays = 0` sets presence **true** — so `0` in an init object is NOT the same as omitting the key.

**TDD**: `red-green required` (behavior proven by the Step 12 Playwright e2e).

**Instructions** (design.md §"UI reachability — presence handled honestly"):
1. Add state `const [cooldownDaysRaw, setCooldownDaysRaw] = useState(initial?.cooldownDays !== undefined ? String(initial.cooldownDays) : '')` — **not `?? 0`** (that collapses unset and explicit-0 and would silently write `cooldown_days: 0` onto a pre-existing unset strategy on the first unrelated edit).
2. Add a `parseCooldownDays(raw: string): { valid: true; value: number | undefined } | { valid: false; error: string }` helper: blank/whitespace → `{ valid: true, value: undefined }` (OMIT the key); `"0"` → `{ valid: true, value: 0 }`; a non-negative integer → `{ valid: true, value: n }`; negative or non-integer → `{ valid: false, error: 'cooldown days must be a non-negative integer' }`.
3. Add a numeric `<Input type="number" min={0} …>` in the Step-1 Identity block (`:178-203`, since `cooldown_days` is strategy-level like `strategy_id`/`display_name`), value `cooldownDaysRaw`, `placeholder="31 (default)"`, with an inline `text-destructive` message when `parseCooldownDays(cooldownDaysRaw).valid` is false.
4. Fold validity into `canAdvance`'s step-1 branch (`:106-113`): `idValid && displayName.trim() !== '' && parseCooldownDays(cooldownDaysRaw).valid` — a user cannot advance past step 1 with an invalid value.
5. In `handleSubmit` (`:116-128`), compute `const cd = parseCooldownDays(cooldownDaysRaw);` (defensive re-check) and add to the `definition` object literal `...(cd.valid && cd.value !== undefined ? { cooldownDays: cd.value } : {})` — blank omits the key (server applies the default); `"0"` sends `cooldownDays: 0`.
6. In `stepForError` (`:80-86`), add `if (m.includes('cooldown')) return 1;` before the fallback.

**Verification**:
- Paired e2e Step 12.
- Lint/build: `cd services/xstockstrat-ui && pnpm run lint` and `pnpm run build` (TS compile) — pass.

---

### Step 12 — test: `StrategyWizard` cooldown Playwright e2e (AC-11)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (per codebase-discovery digest — see Reviewers note)

**Reviewers**: `xstockstrat-ui` (service owner) — strategy wizard form correctness

**Codebase Evidence**:
- Recon: `e2e/insights/strategy-authoring.spec.ts` — full-wizard walkthrough (`:171-212`), edit pre-population test (`:243-252`); `e2e/mock-backend.ts` hosts the `ManageStrategy`/`GetStrategy` mock handlers. Whether the mock echoes arbitrary `StrategyDefinition` scalars (so `cooldownDays` round-trips automatically) or builds the echoed definition field-by-field (needing an explicit `cooldownDays` addition) is confirmed by the codebase-discovery digest folded into context.md.
- C-12 (frontend test-data inventory): mocks/fixtures come from `services/xstockstrat-ui/e2e/fixtures/` (auth from `e2e/helpers/auth.ts`); reuse the existing strategy fixture and add a scenario override rather than an inline literal.

**TDD**: `red-green required` — the assertions fail against the pre-Step-11 wizard.

**Instructions** (AC-11 + design.md — presence honest, no `0 → 31`):
- **Create, blank cooldown** → the payload **omits** `cooldownDays` (field stays unset → server default 31 drives the gate). Assert the wizard submits without the key.
- **Create, explicit `0`** → the payload sends `cooldownDays: 0` (present) → no cooldown. Assert the key is present and `0`.
- **Edit pre-population**: the `GetStrategy` mock fixture returns a strategy with `cooldownDays: 14` (non-zero, distinct from the 31 default) → assert the cooldown input pre-fills `"14"`.
- **Edit unset strategy, unrelated change**: editing a strategy whose `cooldownDays` is unset and saving an unrelated field must **NOT** write `cooldown_days: 0` (the input stays blank → key omitted). Assert the update payload has no `cooldownDays`.
- Do **NOT** assert `0 → 31` (the superseded collapse).
- Import the strategy fixture from `e2e/fixtures/` and auth from `e2e/helpers/auth.ts` (C-12); add the `cooldownDays: 14` variant as a scenario override, updating `e2e/fixtures/INVENTORY.md` if a new fixture module is introduced.

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts` — pass (fails before Step 11). No unit coverage threshold (e2e-only surface).
- `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — confirm fixture/auth imports (no inline domain literals).

---

### Step 13 — docs: register `analysis.strategy.default_cooldown_days` (AC-6)

**Status**: `pending`
**Service**: `docs/` (config governance)
**Files**:
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `Read docs/patterns/config-governance.md:28-75` — "Registering a new config key" (step 4: add a row to the "Per-Feature Registered Keys" log) + the append-only per-feature log (`:35-37`), with existing entries like `### feature 062 — fundamentals signal producer (xstockstrat-analysis)` (`:57`).
- `Read services/xstockstrat-analysis/CLAUDE.md` §"Config Keys Consumed" — the `analysis`-namespace table listing keys with the `get_int` zero-trap note precedent (`analysis.scoring.shrinkage_days … get_int zero-trap: a config value of 0 reads as the default 250`).
- No config **seed file** to edit — `grep` found no repo seed data for the existing `analysis.*` int keys; they resolve via the in-code `get_int` default and are set at runtime via `SetConfig` (`docs/runbooks/config-rollout.md`).

**TDD**: `N/A (docs)`.

**Instructions**:
1. `services/xstockstrat-analysis/CLAUDE.md` §"Config Keys Consumed" (namespace `analysis`): add a row
   `| analysis.strategy.default_cooldown_days | int | 31 | Per-strategy default re-entry cooldown in calendar days when StrategyDefinition.cooldown_days is unset (feature 069); 31 sits outside the IRS 30-day-each-side wash-sale window. get_int zero-trap: a platform-wide value of 0 reads back as the default 31 — a per-strategy explicit-0 (no cooldown) is unaffected because it travels via proto explicit presence, not this config read. |`
2. `docs/patterns/config-governance.md` "Per-Feature Registered Keys" log: add a newest entry
   `### feature 069 — strategy re-entry cooldown (xstockstrat-analysis)` with a one-line summary and the same key row (type `int`, default `31`, wash-sale-safe default; documents the `get_int` zero-trap, not fixed — matching the `analysis.scoring.shrinkage_days` precedent; per-strategy explicit-0 works via proto presence).

**Verification**:
- `grep -n "analysis.strategy.default_cooldown_days" docs/patterns/config-governance.md services/xstockstrat-analysis/CLAUDE.md` — appears in both, with default `31` and the zero-trap note.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
