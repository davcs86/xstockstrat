# Implementation Spec: exit-cooldown

**Status**: `pending`
**Created**: 2026-08-07
**Feature**: `docs/roadmap/features/116-exit-cooldown/feature.md`
**Total Steps**: 21
**Feature Branch**: `feature/exit-cooldown`

---

## Execution Summary

Land the proto field and generated stubs first (Steps 1–2), since every later step reads
`definition.exit_cooldown_days`. Then build the analysis-service backend bottom-up: schema
(Step 3) → shared pure-gate/repository generalization (Steps 4–5) → the backtest engine's
ephemeral gate (Steps 6–7) → write-time validation/maskable-paths/config (Steps 8–9) → the
live loop's shared transition core, replay, and the skip-until-known correctness fix, all in
one cohesive change to `live_loop.py` (Steps 10–11) → the boot-time Order-based backfill for
positions older than the 365-day replay window (Steps 12–13). Once the backend is complete,
wire the two consumer surfaces required by product-spec's `## Consumer Surface(s)`: the
`manage_strategy`/`get_strategy` MCP tools (Steps 14–16, docs bundled per root `CLAUDE.md`'s
same-PR rule) and the `StrategyWizard` UI form (Steps 17–18). Step 19 is a repo-wide
cross-cutting confirmation (fingerprint participation — already proven by Step 7's test, so
this step is a grep-verify, not new code). Steps 20–21 close the two Open Risks design.md
left as required-but-deferred: a standalone defect report for the pre-existing
`max_strategies_per_cycle` starvation risk, and a final full-suite regression run.

## Step Dependencies

- Step 2 requires Step 1 (proto-gen needs the proto change committed first).
- Steps 6, 8, 10, 12, 14, 17 all require Step 2 (`definition.exit_cooldown_days` / generated
  stub only exists after `buf-gen.sh` runs).
- Step 4 requires Step 3 (the repository's new `upsert_entry`/`list_all` column reference
  presumes the `last_entry_at` column Step 3 adds — the column and the repo code should land
  in dependency order even though the migration itself does not require the repo to compile).
- Step 5 requires Step 4 (tests the renamed/added repo methods).
- Step 7 requires Step 6; Step 9 requires Step 8; Step 11 requires Step 10; Step 13 requires
  Step 12; Step 16 requires Steps 14–15; Step 18 requires Step 17.
- Step 12 (boot-time backfill) requires Step 10 (`live_loop._last_entry_at` /
  `_write_entry_cooldown` must exist before backfill can write into them).
- Step 15 (`docs/runbooks/mcp-tools.md` + `strat-lab` skill) must land in the **same PR** as
  Step 14 per root `CLAUDE.md`'s "a change to `manage_strategy` must update the strat-lab
  skill in the same PR" rule — do not split across separate merges.
- Step 20 (defect report for the pre-existing `max_strategies_per_cycle` starvation risk) has
  no code dependency; it documents a design.md Open Risk explicitly marked "not this feature's
  scope to fix" — file it, do not attempt the fix here.
- Step 21 (final regression run) runs last, after every other step's own verification passed.

---

### Step 1 — proto: add `exit_cooldown_days` field

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, naming
conventions; `xstockstrat-analysis` (service owner) — backtest reproducibility, no look-ahead
bias.

**Codebase Evidence**:
- `StrategyDefinition` message, `packages/proto/analysis/v1/analysis.proto:249-267` — fields
  1–10 all in use; `cooldown_days = 9` (`:258-261`) is `optional int32` with an explicit-
  presence doc comment; `warnings = 10` (`:262-266`) is the last field → next free number is
  **11**.
- `ManageStrategyRequest.update_mask` allowed-paths doc comment, `:277-293`, specifically
  `:291`: `// Allowed paths: display_name, components, entry_rule, exit_rule, signal_params,
  cooldown_days.`

**TDD**: `N/A (proto schema change — no test framework runs against a .proto file directly;
verified by buf lint/breaking below and by every downstream step that reads the new field)`

**Instructions**:
1. In `StrategyDefinition` (`analysis.proto:249-267`), add a new field immediately after
   `warnings = 10`:
   ```proto
   // Per-strategy minimum holding period in calendar days before exit_rule may fire a sell
   // (feature 116 — exit cooldown; mirrors cooldown_days but gates the exit transition).
   // optional = explicit presence: unset → platform default
   // (analysis.strategy.default_exit_cooldown_days); explicit 0 → no minimum hold (exit
   // permitted immediately, current behavior); negative → rejected at write time
   // (INVALID_ARGUMENT).
   optional int32 exit_cooldown_days = 11;
   ```
2. Update the `update_mask` comment at `:291` to append the new field name:
   `// Allowed paths: display_name, components, entry_rule, exit_rule, signal_params,
   cooldown_days, exit_cooldown_days.`

**Verification**:
```bash
cd packages/proto
buf lint
buf breaking --against ".git#branch=feature/exit-cooldown"
```
Both must pass — this is a non-breaking additive field (new optional field, no renumbering).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/analysis/v1/` — modify (generated)
- `packages/proto/gen/python/analysis/v1/` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/` — modify (generated)

**Reviewers**: inherited from Step 1 — Proto Reviewer, `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `docs/runbooks/proto-versioning.md` § "Verifying the generated stubs match the protos" —
  `./scripts/buf-gen.sh` then `git diff packages/proto/gen/` must be empty of drift once run
  twice; root `CLAUDE.md` § Generating Proto Stubs — run after any `.proto` change.

**TDD**: `N/A (codegen output — not hand-written, no red/green cycle applies)`

**Instructions**: Run `./scripts/buf-gen.sh` from repo root. Commit the regenerated Go/Python/TS
stubs in the **same commit** as Step 1's proto source change (per proto-versioning.md, "commit
proto source + generated stubs together").

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/
grep -rn "exit_cooldown_days\|ExitCooldownDays\|exitCooldownDays" packages/proto/gen/python/analysis/v1/ packages/proto/gen/go/analysis/v1/ packages/proto/gen/ts/analysis/v1/
```
Confirm the new field appears in all three generated targets and no unrelated file changed.

---

### Step 3 — migration: `012_strategy_cooldowns_last_entry_at`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/012_strategy_cooldowns_last_entry_at.up.sql` — create
- `services/xstockstrat-analysis/migrations/012_strategy_cooldowns_last_entry_at.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, index correctness;
`xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-analysis/migrations/ | sort` → last file is
  `011_opportunities.{up,down}.sql` → next free `NNN` is **`012`**.
- Table this migration extends: `009_strategy_cooldowns.up.sql:6-11` —
  `analysis.strategy_cooldowns(strategy_id TEXT, symbol TEXT, last_exit_at TIMESTAMPTZ NOT
  NULL, PRIMARY KEY(strategy_id, symbol))`.
- `ADD COLUMN`/`DROP COLUMN` pattern precedent: `002_strategy_live_enabled.up.sql:1`
  (`ALTER TABLE analysis.strategies ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL
  DEFAULT FALSE;`) / `002_strategy_live_enabled.down.sql:1` (`... DROP COLUMN IF EXISTS
  live_enabled;`).

**TDD**: `N/A (migration — no red/green; verified offline per spec-template's migration rule, never against a live DB)`

**Instructions**:

`012_strategy_cooldowns_last_entry_at.up.sql`:
```sql
-- Live-loop exit-cooldown state (feature 116). Extends the table feature 069 created — the
-- same (strategy_id, symbol) key now carries both the re-entry gate's last-exit anchor and
-- the exit-cooldown gate's last-entry anchor. NULL for a pair with no known entry time yet
-- (see app/engine/entry_backfill.py). Migration 009 itself is NOT edited (F-01).
ALTER TABLE analysis.strategy_cooldowns ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMPTZ NULL;
```

`012_strategy_cooldowns_last_entry_at.down.sql`:
```sql
ALTER TABLE analysis.strategy_cooldowns DROP COLUMN IF EXISTS last_entry_at;
```

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/012_strategy_cooldowns_last_entry_at.up.sql \
   services/xstockstrat-analysis/migrations/012_strategy_cooldowns_last_entry_at.down.sql
git diff --stat services/xstockstrat-analysis/migrations/009_strategy_cooldowns.up.sql services/xstockstrat-analysis/migrations/009_strategy_cooldowns.down.sql
```
Read both new files by hand: confirm the up's single `ADD COLUMN` has an exact inverse `DROP
COLUMN` in down (offline, no-DB check per the migration-step verification rule); confirm the
`git diff` on migration `009` is empty (F-01 — never edit an applied migration).

---

### Step 4 — service: generalize `cooldown.py` + dual-purpose `strategy_cooldowns.py`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/cooldown.py` — modify
- `services/xstockstrat-analysis/app/repositories/strategy_cooldowns.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify (one call-site rename)

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `cooldown.py` (51 lines, full read) — module docstring line 1: `"""Shared re-entry cooldown
  gate (feature 069)."""`; `is_cooldown_active(last_exit_at: datetime | None, current_ts:
  datetime, cooldown_days: int) -> bool` at `:36-50`.
- Both current call sites invoke it **positionally**: `servicer.py:1068-1071`
  (`is_cooldown_active(last_exit_time, bar.time.ToDatetime(tzinfo=UTC), cooldown_days)`) and
  `live_loop.py:166` (`is_cooldown_active(self._last_exit_at.get(key), current_bar_dt,
  cooldown_days)`) — confirmed no caller uses the `last_exit_at=` keyword, so renaming the
  parameter is source-compatible.
- `strategy_cooldowns.py` (37 lines, full read) — `upsert(strategy_id, symbol, last_exit_at)`
  `:20-31` (single `ON CONFLICT ... DO UPDATE SET last_exit_at = EXCLUDED.last_exit_at`),
  `list_all()` `:33-37` (`SELECT strategy_id, symbol, last_exit_at FROM
  analysis.strategy_cooldowns`).
- `live_loop.py:241` — the one caller of `.upsert(...)`, inside `_write_cooldown`
  (`await self._cooldowns_repo.upsert(key[0], key[1], ts)`).

**TDD**: `red-green required` (renamed/added symbols; paired test in Step 5)

**Instructions**:
1. In `cooldown.py`: rename `is_cooldown_active`'s first parameter from `last_exit_at` to
   `gate_start_at` (direction-neutral — the function already only cares "is `current_ts`
   inside `[gate_start_at, gate_start_at + cooldown_days)`", regardless of whether the anchor
   is a last-exit or a last-entry timestamp). Update the function's docstring to describe both
   directions ("re-entry" → generic "gated"). Generalize the module docstring (line 1) from
   `"""Shared re-entry cooldown gate (feature 069)."""` to describe both consumers (the
   re-entry gate, anchored on last-exit, AND the exit-cooldown gate added by feature 116,
   anchored on last-entry). Do **not** touch `effective_cooldown_days` or `_require_aware` —
   both are already direction-agnostic.
2. In `strategy_cooldowns.py`:
   - Rename `upsert` → `upsert_exit` (body unchanged — still targets the `last_exit_at`
     column).
   - Add a new method `upsert_entry(self, strategy_id: str, symbol: str, last_entry_at:
     datetime) -> None` mirroring `upsert_exit`'s shape exactly but targeting the new column:
     `ON CONFLICT (strategy_id, symbol) DO UPDATE SET last_entry_at = EXCLUDED.last_entry_at`.
   - Update `list_all()`'s query to also select `last_entry_at`:
     `SELECT strategy_id, symbol, last_exit_at, last_entry_at FROM
     analysis.strategy_cooldowns`.
   - Update the module/class docstrings ("Durable per-(strategy_id, symbol) last-exit
     timestamp..." → describe the table's now-dual purpose, re-entry AND exit cooldown state,
     citing migration `012`).
3. Update `live_loop.py:241`'s `_write_cooldown` body from `self._cooldowns_repo.upsert(...)`
   to `self._cooldowns_repo.upsert_exit(...)` — the one caller of the renamed method (no other
   call sites; confirmed via the grep in Codebase Evidence above).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_cooldown.py -v
grep -n "def upsert\|def upsert_exit\|def upsert_entry\|def list_all" app/repositories/strategy_cooldowns.py
grep -n "cooldowns_repo\.upsert" app/engine/live_loop.py
```
`test_cooldown.py`'s existing 9 tests must stay green (call sites are positional — the rename
is source-compatible, no behavior change); confirm the repo file shows all three methods;
confirm `live_loop.py` no longer calls the bare `.upsert(` (only `.upsert_exit(`).

---

### Step 5 — test: paired with Step 4

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_cooldowns_repo.py` — create
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- No existing direct repo test for `StrategyCooldownsRepository` — confirmed via `Glob
  services/xstockstrat-analysis/tests/*repositor*` (no match) and `Grep
  "StrategyCooldownsRepository" services/xstockstrat-analysis` (only the repo file itself and
  `main.py`'s construction, no test file). Sibling repo tests exist and are the template:
  `tests/test_strategy_scores_repo.py:16-43` — `AsyncMock()` `db_pool` with `.fetchrow`/
  `.execute` stubbed, asserting the SQL string and positional bind args from `call_args`.
- `test_live_loop.py:230-243,246-259,262-274` (`TestLiveEvaluationLoopCooldown`) — three tests
  reference `repo.upsert.assert_awaited_once()` / `repo.upsert.await_args.args`
  (`test_exit_persists_cooldown_via_repo`, `test_exit_persists_even_when_alert_throttled`,
  `test_write_cooldown_failure_never_propagates` at `repo.upsert = AsyncMock(...)`) — these
  three lines must track Step 4's `upsert` → `upsert_exit` rename or they will fail against
  the renamed repo (this is the RED before Step 4/5 land together, GREEN after).

**TDD**: `red-green required`

**Instructions**:
1. Create `test_strategy_cooldowns_repo.py` mirroring `test_strategy_scores_repo.py`'s
   `AsyncMock`-pool pattern:
   - `test_upsert_exit_uses_on_conflict_and_targets_last_exit_at` — `db_pool.execute =
     AsyncMock()`; call `repo.upsert_exit("s1", "AAPL", <a tz-aware datetime>)`; assert the SQL
     string (`db_pool.execute.call_args.args[0]`) contains `"ON CONFLICT (strategy_id, symbol)
     DO UPDATE SET"` and `"last_exit_at = EXCLUDED.last_exit_at"`; assert positional args are
     `("s1", "AAPL", <the datetime>)`.
   - `test_upsert_entry_uses_on_conflict_and_targets_last_entry_at` — mirror, asserting
     `"last_entry_at = EXCLUDED.last_entry_at"`.
   - `test_list_all_returns_both_timestamps` — `db_pool.fetch = AsyncMock(return_value=[{...
     "last_exit_at": ..., "last_entry_at": ...}])`; assert `list_all()`'s returned dict carries
     both keys.
2. In `test_live_loop.py`, update the three `repo.upsert`/`repo.upsert.assert_awaited_once()`/
   `repo.upsert.await_args` references (lines ~241, ~259, ~265 per Codebase Evidence) to
   `upsert_exit` — the mechanical follow-through of Step 4's rename.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_strategy_cooldowns_repo.py tests/test_live_loop.py -v
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 6 — service: backtest engine exit-cooldown gate

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, no
look-ahead bias.

**Codebase Evidence**:
- `_backtest_symbol_evaluated`, `servicer.py:969-1138`. `entry_time` local: initialized `None`
  at `:1039`, assigned on entry fill at `:1078`, cleared on exit fill at `:1104` — already
  ephemeral, per-run, never touches a repo (FR-5/FR-7 precedent).
- Re-entry cooldown resolution, `:1049-1052`:
  ```python
  cooldown_days = effective_cooldown_days(
      definition.cooldown_days if definition.HasField("cooldown_days") else None,
      self._cfg.get_int("analysis.strategy.default_cooldown_days", 31),
  )
  ```
- Entry-fill gate, `:1065-1071` — `if (position == 0.0 and decision.entry and not
  is_cooldown_active(last_exit_time, bar.time.ToDatetime(tzinfo=UTC), cooldown_days)):`.
- Exit-fill branch, `:1081` — `elif position > 0.0 and decision.exit:` — currently ungated.
- `effective_cooldown_days`/`is_cooldown_active` already imported at `servicer.py:45`.
- `get_int_present` precedent: `app/config/watcher.py:76-87` — presence-aware int read that
  does not collapse a configured `0` into the default (unlike `get_int`'s `v.int_val or
  default` zero-trap).

**TDD**: `red-green required` (paired test in Step 7)

**Instructions**:
1. Immediately after the existing `cooldown_days = effective_cooldown_days(...)` block
   (`:1049-1052`), add the exit-cooldown resolution:
   ```python
   # Exit cooldown (feature 116) — minimum holding period. Ephemeral per-RunBacktest state
   # (FR-5/FR-7), symmetric to the re-entry cooldown above. get_int_present (not get_int) —
   # a configured 0 is a legitimate, meaningful default and must not be zero-trapped.
   exit_cooldown_days = effective_cooldown_days(
       definition.exit_cooldown_days if definition.HasField("exit_cooldown_days") else None,
       self._cfg.get_int_present("analysis.strategy.default_exit_cooldown_days", 0),
   )
   ```
2. Gate the exit branch at `:1081` using the already-tracked `entry_time` local as the anchor:
   ```python
   elif (
       position > 0.0
       and decision.exit
       and not is_cooldown_active(
           entry_time, bar.time.ToDatetime(tzinfo=UTC), exit_cooldown_days
       )
   ):
   ```
   `entry_time` is read here (not written) — it is already set on entry fill and cleared on
   exit fill by the existing code at `:1078`/`:1104`; no new state variable needed.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py -k TestBacktestCooldown -v
```
(This step's own run only exercises the pre-existing re-entry-side tests; Step 7 adds the
exit-side red/green pair.)

---

### Step 7 — test: paired with Step 6

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `TestBacktestCooldown` class, `test_analysis_servicer.py:2439-2531` — direct templates:
  `_cooldown_bar(close, day)` (`:2393-2401`, daily-incrementing tz-aware bar), `_decisions(n,
  entries=, exits=)` (`:2427-2436`), `_run_evaluated(svc, definition, decisions, n_bars)`
  (`:2404-2424`), `_valid_definition()` (`:558`).
- `test_whipsaw_reentry_suppressed_by_default_cooldown` (`:2441-2451`) — the exact mirror-image
  case for the re-entry side; `test_fingerprint_changes_with_cooldown_days` (`:2492-2499`) —
  fingerprint-inclusion template.

**TDD**: `red-green required` — write these against the pre-Step-6 tree first (they fail — the
exit branch is ungated), then confirm green after Step 6 lands.

**Instructions**: Add to `TestBacktestCooldown`:
1. `test_exit_platform_default_zero_is_a_noop` — with `exit_cooldown_days` left unset
   (platform default `0`), `decisions = _decisions(40, entries=(1,), exits=(2,))`; assert the
   trade closes at bar 2 (no regression — AC-2, "field unset behaves exactly as before").
2. `test_exit_suppressed_while_min_hold_active` — `definition = _valid_definition();
   definition.exit_cooldown_days = 5`; `decisions = _decisions(40, entries=(1,), exits=(2,
   10))` (an exit signal at bar 2 — 1 day after entry@1, inside the 5-day minimum hold — then
   another exit signal at bar 10, after the window elapses); assert exactly 1 trade, and that
   its `exit_time.seconds` corresponds to bar 10 (day-2's exit signal was gated).
3. `test_exit_allowed_once_min_hold_elapses` — `definition.exit_cooldown_days = 5`; `decisions
   = _decisions(40, entries=(1,), exits=(6,))` (exit exactly 5 days after entry — half-open
   boundary, per `is_cooldown_active`'s existing boundary semantics — allowed); assert 1 trade
   closing at bar 6.
4. `test_fingerprint_changes_with_exit_cooldown_days` (mirrors `:2492-2499`) —
   `_definition_fingerprint({**base, "exit_cooldown_days": 14}) !=
   _definition_fingerprint(base)` (proves FR-9 — the new field participates in the
   fingerprint, since it is NOT in `_FINGERPRINT_EXCLUDED_KEYS`).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_analysis_servicer.py -k "TestBacktestCooldown" -v
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 8 — service: write-time validation, maskable paths, config doc

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `evaluator.py:351-354` — `if definition.HasField("cooldown_days") and
  definition.cooldown_days < 0: raise ValueError("cooldown_days must be >= 0")`, inside
  `_validate_definition` — the write-time gate `ManageStrategy` calls and translates
  `ValueError` → `INVALID_ARGUMENT` (confirmed by
  `test_manage_strategy_rejects_negative_cooldown`, `test_analysis_servicer.py:2502-2516`).
- `_MASKABLE_PATHS`, `servicer.py:2856-2858` — `frozenset({"display_name", "components",
  "entry_rule", "exit_rule", "signal_params", "cooldown_days"})`.
- `_FINGERPRINT_EXCLUDED_KEYS`, `servicer.py:2925`, — `frozenset({"display_name", "active",
  "live_enabled"})`; `exit_cooldown_days` deliberately stays **absent** from this set (no code
  change here — Step 7's fingerprint test already proves inclusion by omission).
- `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed — the
  `analysis.strategy.default_cooldown_days` row is the template for the new row's format.

**TDD**: `red-green required` (paired test in Step 9)

**Instructions**:
1. In `evaluator.py`, immediately after the existing negative-`cooldown_days` check
   (`:353-354`), add the mirror check:
   ```python
   # Exit cooldown (feature 116, FR-2): a negative value is rejected at write time. Unset
   # never triggers this (no HasField); an explicit 0 (no minimum hold) passes.
   if definition.HasField("exit_cooldown_days") and definition.exit_cooldown_days < 0:
       raise ValueError("exit_cooldown_days must be >= 0")
   ```
2. In `servicer.py`, add `"exit_cooldown_days"` to `_MASKABLE_PATHS` (`:2856-2858`):
   ```python
   _MASKABLE_PATHS = frozenset(
       {
           "display_name",
           "components",
           "entry_rule",
           "exit_rule",
           "signal_params",
           "cooldown_days",
           "exit_cooldown_days",
       }
   )
   ```
3. In `services/xstockstrat-analysis/CLAUDE.md`'s Config Keys Consumed table, add a new row
   directly after the `analysis.strategy.default_cooldown_days` row:
   ```
   | `analysis.strategy.default_exit_cooldown_days` | int | `0` | Per-strategy default minimum holding period (calendar days) before `exit_rule` may fire a sell, when `StrategyDefinition.exit_cooldown_days` is unset (feature 116); mirrors `default_cooldown_days` but gates the exit transition. Default `0` (no minimum hold — no wash-sale-style rationale exists for a non-zero default here, unlike the 31-day re-entry default). Read via `get_int_present` (**not** `get_int`) — a configured `0` is a legitimate value and `get_int`'s zero-trap would silently collapse it. |
   ```

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "exit_cooldown_days" app/services/evaluator.py app/handlers/servicer.py
grep -n "default_exit_cooldown_days" CLAUDE.md
```

---

### Step 9 — test: paired with Step 8

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `test_manage_strategy_rejects_negative_cooldown` (`:2502-2516`) and
  `test_manage_strategy_accepts_zero_cooldown` (`:2518-2531`) — direct templates.
- `_masked_req(strategy_id="s1", paths=(), **fields)` (`:2566-2572`) — accepts arbitrary
  `StrategyDefinition` kwargs via `**fields`, so `exit_cooldown_days=5` passes through with
  **no helper change needed**.
- `test_cooldown_only_update_preserves_components_and_rules` (`:2580-2591` region) and
  `test_cooldown_days_can_be_cleared_back_to_platform_default` (`:2623-2632`) — templates for
  the maskable-paths tests.

**TDD**: `red-green required`

**Instructions**: Add to `TestBacktestCooldown` (validation cases) and `TestPartialStrategyUpdate`
(mask cases):
1. `test_manage_strategy_rejects_negative_exit_cooldown` — mirrors
   `test_manage_strategy_rejects_negative_cooldown` with `definition.exit_cooldown_days = -1`;
   assert `INVALID_ARGUMENT`.
2. `test_manage_strategy_accepts_zero_exit_cooldown` — mirrors the zero-cooldown acceptance
   test.
3. `test_exit_cooldown_only_update_preserves_components_and_rules` — `_masked_req(paths=
   ["exit_cooldown_days"], exit_cooldown_days=5)`; assert the stored `components`/
   `entry_rule`/`exit_rule` survive untouched (mirrors `:2580-2591`).
4. `test_exit_cooldown_days_can_be_cleared_back_to_platform_default` — mirrors `:2623-2632`
   for `exit_cooldown_days`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_analysis_servicer.py -v
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 10 — service: live-loop shared transition core + entry-cooldown state + replay

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- Full file read (244 lines). `__init__` `:50-76`; `hydrate_cooldowns` `:78-83`; `_run_cycle`
  `:99-120`; `_eval_pair` `:133-187` (gating+transition block `:150-187`); `_write_cooldown`
  `:231-243`.
- `_LOOKBACK_DAYS = 365` (`:34`) — the existing bar window `_recent_range` (`:126-131`)
  already fetches for every cycle regardless of this feature (no new RPC needed for replay).
- design.md § "Live loop — shared transition core" and § "Live loop — bar-replay for the
  common case" (full text, both sections) — the authoritative architecture for this step:
  one free function `_apply_transition(in_position, entry_time, last_exit_at, decision,
  bar_dt, cooldown_days, exit_cooldown_days) -> (new_in_position, new_entry_time,
  new_last_exit_at, trigger_or_None)`, called by both the live bar (`_eval_pair`) and a new
  pure `_replay_state(bars, decisions, cooldown_days, exit_cooldown_days)` that folds the same
  function over historical bars — replay-then-read ordering (populate state **before** the
  existing `in_position = self._last_state.get(key, False)` line executes), so live/replay
  parity is structural, not two hand-synchronized copies.
- The skip-until-known correctness fix (design.md § "The one required correctness fix"): when
  `in_position` is `True` but the entry-time anchor is still unknown, treat it as "known open,
  cooldown status unknown, do not permit an ungated exit" — implemented as part of
  `_apply_transition`'s exit branch itself in this step (see Instructions point 1 — this is a
  **new** function being written for the first time in this PR, so there is no "before the
  fix" version of it to patch later).
- Required throttled diagnostic (design.md § "Required diagnostic"): an unresolved
  `last_entry_at` while `in_position=True` must log once per key (not every 60s cycle forever)
  — reuses the per-key throttle-dict shape already established by `_last_alert_ts`
  (`:178-186`).

**TDD**: `red-green required` (paired tests in Step 11)

**Instructions**:
1. Add a new module-level free function `_apply_transition`, placed after `strategy_symbols`
   (`:37-47`) and before the `LiveEvaluationLoop` class:
   ```python
   def _apply_transition(
       in_position: bool,
       entry_time: datetime | None,
       last_exit_at: datetime | None,
       decision,
       bar_dt: datetime,
       cooldown_days: int,
       exit_cooldown_days: int,
   ) -> tuple[bool, datetime | None, datetime | None, str | None]:
       """Pure edge-triggered transition step — the ONE shared core for both the live bar
       (_eval_pair) and historical replay (_replay_state), so live/replay parity is
       structural (feature 116 design.md § Live loop — shared transition core). Returns
       (new_in_position, new_entry_time, new_last_exit_at, trigger_or_None). `trigger` is
       "entry"/"exit" only on an actual transition; None on steady state OR a gated
       (cooldown-suppressed) transition attempt — including the "known open, entry time
       unknown" skip (design.md round-4 correctness fix): a None entry_time while in_position
       is treated as an active gate, never as "never entered"."""
       if not in_position and decision.entry:
           if is_cooldown_active(last_exit_at, bar_dt, cooldown_days):
               return in_position, entry_time, last_exit_at, None
           return True, bar_dt, last_exit_at, "entry"
       if in_position and decision.exit:
           if entry_time is None or is_cooldown_active(entry_time, bar_dt, exit_cooldown_days):
               return in_position, entry_time, last_exit_at, None
           return False, None, bar_dt, "exit"
       return in_position, entry_time, last_exit_at, None
   ```
2. Add a second free function `_replay_state`, directly below it:
   ```python
   def _replay_state(
       bars, decisions, cooldown_days: int, exit_cooldown_days: int
   ) -> tuple[bool, datetime | None, datetime | None]:
       """Fold _apply_transition over historical (bar, decision) pairs to seed state for a
       key reached for the first time since restart (feature 116). Pure — plain data in,
       plain data out; cannot emit an alert or ledger write by construction."""
       in_position, entry_time, last_exit_at = False, None, None
       for bar, decision in zip(bars, decisions, strict=True):
           bar_dt = bar.time.ToDatetime(tzinfo=UTC)
           in_position, entry_time, last_exit_at, _trigger = _apply_transition(
               in_position, entry_time, last_exit_at, decision, bar_dt,
               cooldown_days, exit_cooldown_days,
           )
       return in_position, entry_time, last_exit_at
   ```
3. In `__init__` (`:69-76`): add `self._last_entry_at: dict[tuple[str, str], datetime] = {}`
   alongside the existing `_last_exit_at` dict; add `self._replayed: set[tuple[str, str]] =
   set()` (tracks which keys have run their one-time-since-restart replay) and
   `self._logged_unresolved: set[tuple[str, str]] = set()` (the required diagnostic's
   log-once-per-key tracker).
4. Extend `hydrate_cooldowns` (`:78-83`) to also populate `_last_entry_at` from the repo's now
   dual-column rows: `if r["last_entry_at"] is not None: self._last_entry_at[(r["strategy_id"],
   r["symbol"])] = r["last_entry_at"]` (guarded — rows written before migration `012` carry
   `NULL`).
5. Rewrite `_eval_pair`'s gating+transition block (`:150-187`) to use the shared core. Before
   the existing `in_position = self._last_state.get(key, False)` line, insert the
   replay-then-read step for a key seen for the first time since restart:
   ```python
   key = (definition.strategy_id, symbol)
   current_bar_dt = bars[-1].time.ToDatetime(tzinfo=UTC)
   cooldown_days = effective_cooldown_days(
       definition.cooldown_days if definition.HasField("cooldown_days") else None,
       self._cfg.get_int("analysis.strategy.default_cooldown_days", 31),
   )
   exit_cooldown_days = effective_cooldown_days(
       definition.exit_cooldown_days if definition.HasField("exit_cooldown_days") else None,
       self._cfg.get_int_present("analysis.strategy.default_exit_cooldown_days", 0),
   )

   if key not in self._replayed:
       # bars[:-1]/decisions[:-1] — all but the current cycle's own bar, so replay never
       # double-processes what this call is about to evaluate (design.md's "replay-then-read,
       # never read-then-replay" ordering).
       replayed_in_pos, replayed_entry, replayed_exit = _replay_state(
           bars[:-1], decisions[:-1], cooldown_days, exit_cooldown_days
       )
       self._last_state[key] = replayed_in_pos
       self._last_entry_at[key] = replayed_entry
       self._last_exit_at[key] = replayed_exit
       self._replayed.add(key)

   in_position = self._last_state.get(key, False)
   new_in_position, new_entry_time, new_last_exit_at, trigger = _apply_transition(
       in_position,
       self._last_entry_at.get(key),
       self._last_exit_at.get(key),
       latest,
       current_bar_dt,
       cooldown_days,
       exit_cooldown_days,
   )

   if trigger is None:
       if in_position and self._last_entry_at.get(key) is None and key not in self._logged_unresolved:
           self._logged_unresolved.add(key)
           log.warning(
               "live_loop: (%s,%s) in position with unresolved entry time — exit-cooldown "
               "gate is skipping this pair until app.engine.entry_backfill resolves it "
               "(feature 116)", key[0], key[1],
           )
       self._last_state[key] = new_in_position
       return
   if trigger == "exit":
       self._last_exit_at[key] = new_last_exit_at
       await self._write_cooldown(key, new_last_exit_at)
   else:  # "entry"
       self._last_entry_at[key] = new_entry_time
       await self._write_entry_cooldown(key, new_entry_time)
   new_state = new_in_position
   ```
   The existing alert-throttle block below this (currently `:178-186`) is unchanged — it still
   reads the local `trigger`/`new_state` names, which this rewrite preserves.
6. Add `_write_entry_cooldown`, mirroring `_write_cooldown` (`:231-243`) exactly but calling
   `self._cooldowns_repo.upsert_entry(...)` (Step 4's new repo method) and logging
   `"live_loop: entry cooldown write failed: %s"` on a swallowed exception.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_live_loop.py -v
```
(All pre-existing `TestLiveEvaluationLoopCooldown`/`TestLiveEvaluationLoopStateTracking` tests
must stay green — they exercise the re-entry side only, which `_apply_transition`'s first
branch reproduces byte-for-byte from the prior inline code. Step 11 adds the new exit-side and
parity tests.)

---

### Step 11 — test: paired with Step 10 (the three required tests + parity)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify (comment-only: the
  Verification's final instruction adds a code comment at the guard site referencing this
  step's test names by name, so it must land after those names are decided here, not in Step
  10 where the guard code itself is written — sdd-review impl-spec, 2026-08-07)

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `_make_loop(cooldowns_repo=None)` (`:35-53`), `_bar_at(dt)` (`:28-32`), `_decision(entry,
  exit_, conviction=1.0)` (`:56-57`) — direct templates already covering the mocked
  `_marketdata`/`_notify`/`_ledger` shape.
- design.md § "Open Risks" — item 2 explicitly requires **three** paired tests
  "non-skippable in CI": (a) suppression — `in_position=True`, `_last_entry_at` absent, an
  exit decision that would otherwise fire → zero alert/ledger/state-change; (b) resolution —
  same pair once `_last_entry_at` becomes known and the cooldown has elapsed → exit fires
  normally; (c) isolation — the sibling entry/re-entry-cooldown branch is unaffected by this
  guard.

**TDD**: `red-green required` — write against the pre-Step-10 tree (the shared core/replay/
guard do not exist yet, so these fail), confirm green after Step 10.

**Instructions**: Add a new `TestLiveEvaluationLoopExitCooldown` class:
1. `test_exit_suppressed_while_min_hold_active` — seed `loop._last_state[key] = True`,
   `loop._last_entry_at[key] = entry_dt`; feed a bar 1 day after `entry_dt` with an exit
   decision and `definition.exit_cooldown_days = 5`; assert no alert, `_last_state[key]`
   unchanged.
2. `test_exit_allowed_once_min_hold_elapses` — same seed, bar 35 days after `entry_dt`; assert
   the exit fires (one alert, `_last_state[key] is False`).
3. **Required (a) suppression** — `test_exit_suppressed_when_entry_time_unresolved` —
   `loop._last_state[key] = True`, `loop._last_entry_at` has **no** entry for `key` (simulates
   an in-position pair whose entry time backfill hasn't resolved yet); feed a bar with an exit
   decision; assert **zero** `EmitAlert`/`AppendEvent` calls and `_last_state[key]` stays
   `True` (the skip, not a false exit).
4. **Required (b) resolution** — `test_exit_fires_once_entry_time_resolves` — same setup as
   (3), then set `loop._last_entry_at[key] = <a time > exit_cooldown_days ago>` and re-run
   `_eval_pair`; assert the exit now fires normally.
5. **Required (c) isolation** — `test_unresolved_entry_time_does_not_suppress_reentry_gate` —
   with `_last_state[key]` absent/`False` (not in position) and `_last_entry_at[key]` absent,
   feed an entry decision with `_last_exit_at[key]` set inside the re-entry cooldown window;
   assert the **existing** re-entry suppression still fires exactly as
   `test_entry_suppressed_inside_cooldown_window` (`:204-227`) already proves — i.e. the new
   guard on the exit branch has zero effect on the sibling entry branch, anchored on a
   different dict.
6. `test_replay_state_matches_sequential_apply_transition` (fold-equivalence / FR-4 parity) —
   build a small deterministic `bars`/`decisions` sequence (entry@1, exit-attempt@2 gated,
   exit@10 allowed); call `_replay_state(bars, decisions, cooldown_days, exit_cooldown_days)`
   directly, and separately fold `_apply_transition` over the same sequence by hand in the
   test; assert the two computations agree bit-for-bit on final `(in_position, entry_time,
   last_exit_at)`.
7. `test_replay_seeded_steady_state_emits_no_alert` — a historical window that is "already in
   position, no crossing" (all decisions steady) feeding into the replay-then-read path on a
   key's first-seen-since-restart cycle, followed by a steady-state current-bar decision;
   assert zero `EmitAlert` calls (proves replay's seeding doesn't itself fire a spurious
   transition alert).
8. `test_replay_only_runs_once_per_key` — call `_eval_pair` twice for the same key across two
   cycles; assert `key in loop._replayed` after the first call and that a second call does not
   re-run `_replay_state` (spy/patch it and assert `call_count == 1`).

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_live_loop.py -v
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```
Add a code comment at the `_apply_transition`/`_eval_pair` guard site (Step 10) referencing
these three required tests by name, per design.md's explicit instruction ("reference them
directly in a code comment... so a future editor sees the constraint before breaking it").

---

### Step 12 — service: boot-time Order-based entry-time backfill

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — create
- `services/xstockstrat-analysis/app/main.py` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `AnalysisServicer.__init__`, `servicer.py:116-140` — `self._trading =
  trading_pb2_grpc.TradingServiceStub(trading_channel) if trading_channel else None` (`:138-
  140`) — the **existing** analysis→trading edge (feature 083), already wired via
  `TRADING_ENDPOINT` in `main.py:35,68` — no new channel, no new env var, no new pool.
- Existing `ListOrders` call precedent, `servicer.py:2438-2447` (inside
  `GetStrategyAnalytics`): `orders_resp = await self._trading.ListOrders(
  trading_pb2.ListOrdersRequest(strategy_id=strategy_id), metadata=propagation_meta)` — status
  **unfiltered** (zero-value `ORDER_STATUS_UNSPECIFIED`), the exact precedent design.md cites
  for why this feature must NOT filter `status=ORDER_STATUS_FILLED`.
- `trading.proto` `Order` message (`packages/proto/trading/v1/trading.proto:32-53`): `side =
  4` (`OrderSide`), `status = 6`, `filled_qty = 8` (double), `updated_at = 14`
  (`google.protobuf.Timestamp`), `strategy_id = 15`. `ListOrdersRequest`
  (`:119-127`): `strategy_id = 2`, `status = 3` (`OrderStatus`, `0 = UNSPECIFIED` = no filter),
  `symbol = 7`.
- `normalizeFilledQty`, `services/xstockstrat-trading/internal/service/trading.go:1373-1387` —
  confirms `filled_qty` is only coerced-on-read for `ORDER_STATUS_FILLED`; partial/canceled/
  expired orders' `filled_qty` is left untouched and already correct — the basis for reading
  **all** terminal orders, not FILLED-only.
- Semaphore fan-out precedent: `app/services/screener.py:76-78` (`self._sem =
  asyncio.Semaphore(max(1, cfg.get_int("analysis.screener.max_concurrent_formula_evals",
  4)))`) and `:297` (`async with self._sem:`).
- Boot-time no-metadata precedent: `app/engine/fundsignal_loop.py:100` (`run_once(force=False,
  dry_run=False, override_symbols=None, metadata=())`) — the same implicit-empty-metadata
  default this new boot-time module must use (no fabricated `x-user-id`/`x-trace-id`).
- `main.py:91-148` — the existing pattern for registering a new boot-time asyncio task
  alongside `live_loop.run_forever()` and `fundsignal_loop.run_forever()`, all inside `if
  db_pool is not None:`, each its own `asyncio.get_event_loop().create_task(...)` — **not**
  inline/blocking in the `hydrate_cooldowns()` → `run_forever()` chain.
- `_run_cycle`'s live-pair enumeration, `live_loop.py:99-111` — the same `SELECT * FROM
  analysis.strategies WHERE live_enabled = TRUE AND active = TRUE` + `strategy_symbols(...)`
  shape this module reuses to determine which `(strategy_id, symbol)` pairs to backfill.

**TDD**: `red-green required` (paired test in Step 13)

**Instructions**:
1. Create `app/engine/entry_backfill.py`:
   ```python
   """Boot-time-only Order-based entry-time backfill (feature 116).

   Closes the >365-day-position gap bar-replay cannot reach (live_loop.py's own replay only
   sees the fetched 365-day bar window). Runs ONCE at boot, concurrently with (not blocking)
   the other boot-time tasks. Reads xstockstrat-trading's ListOrders — the ONLY RPC this
   module calls — never portfolio (Position carries no strategy_id) and never anything else.
   This module is imported ONLY by main.py, never by live_loop.py (preserving the literal
   truth of live_loop.py's own FR-6 docstring: "this module never imports or calls any
   trading/portfolio RPC").
   """

   import asyncio
   import logging
   from datetime import UTC

   from gen.trading.v1 import trading_pb2

   log = logging.getLogger(__name__)


   def _infer_open_entry_time(orders):
       """Pure: walk a running signed balance (BUY +filled_qty, SELL -filled_qty, skipping
       filled_qty == 0) over `orders` sorted by updated_at. Records a candidate entry time on
       every 0 → nonzero crossing, clears it on every nonzero → 0 crossing. Returns the last
       recorded crossing time iff the pair is currently non-flat, else None. Single-boolean-
       per-pair semantics — matches live_loop._last_state's own model, not a FIFO/multi-lot
       ledger."""
       ordered = sorted(orders, key=lambda o: o.updated_at.ToDatetime(tzinfo=UTC))
       balance = 0.0
       candidate = None
       for o in ordered:
           if o.filled_qty == 0:
               continue
           signed = o.filled_qty if o.side == trading_pb2.ORDER_SIDE_BUY else -o.filled_qty
           was_flat = balance == 0.0
           balance += signed
           if was_flat and balance != 0.0:
               candidate = o.updated_at.ToDatetime(tzinfo=UTC)
           elif not was_flat and balance == 0.0:
               candidate = None
       return candidate if balance != 0.0 else None


   async def run_once(live_loop, db_pool, trading_stub, cfg_watcher):
       """One-shot boot pass: for every live (strategy, symbol) pair still missing a durable
       last_entry_at, infer it from real Order history and seed live_loop's in-memory state
       (+ best-effort durable write). Never raises — a per-pair failure is logged and skipped,
       matching the FR-8 per-pair isolation the live loop itself already guarantees."""
       if trading_stub is None:
           return
       sem = asyncio.Semaphore(
           max(1, cfg_watcher.get_int("analysis.strategy.max_concurrent_entry_backfill", 4))
       )
       rows = await db_pool.fetch(
           "SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE"
       )

       async def _backfill_pair(strategy_id, symbol):
           key = (strategy_id, symbol)
           if live_loop._last_entry_at.get(key) is not None:
               return
           async with sem:
               try:
                   resp = await trading_stub.ListOrders(
                       trading_pb2.ListOrdersRequest(strategy_id=strategy_id, symbol=symbol)
                   )
               except Exception as e:
                   log.warning("entry_backfill: (%s,%s) ListOrders failed: %s", *key, e)
                   return
           entry_time = _infer_open_entry_time(list(resp.orders))
           if entry_time is None:
               return
           live_loop._last_state[key] = True
           live_loop._last_entry_at[key] = entry_time
           await live_loop._write_entry_cooldown(key, entry_time)

       from app.engine.live_loop import _row_to_strategy_definition  # noqa: PLC0415
       from app.engine.live_loop import strategy_symbols  # noqa: PLC0415

       tasks = []
       for row in rows:
           definition = _row_to_strategy_definition(dict(row))
           for symbol in strategy_symbols(definition):
               tasks.append(_backfill_pair(definition.strategy_id, symbol))
       await asyncio.gather(*tasks, return_exceptions=True)
       log.info("entry_backfill: boot pass complete (%d pairs considered)", len(tasks))
   ```
   NOTE for `/sdd-execute`'s own discovery: `_row_to_strategy_definition` is actually imported
   into `live_loop.py` from `app.handlers.servicer` (`live_loop.py:29`), not defined there —
   import it the same way (`from app.handlers.servicer import _row_to_strategy_definition`) in
   this module rather than through `live_loop`.
2. In `main.py`, inside the `if db_pool is not None:` block, **after** the existing
   `await live_loop.hydrate_cooldowns()` try/except (`:117-123`) and **before** the fundsignal
   loop section, add:
   ```python
   # ── Boot-time entry-time backfill for exit-cooldown (feature 116) ────────
   # Non-blocking — runs concurrently with run_forever(), never delays server start.
   from app.engine.entry_backfill import run_once as backfill_entry_times

   asyncio.get_event_loop().create_task(
       backfill_entry_times(live_loop, db_pool, servicer._trading, cfg_watcher)
   )
   log.info("entry-time backfill task started")
   ```
3. In `services/xstockstrat-analysis/CLAUDE.md`'s Config Keys Consumed table, add a row after
   the new `default_exit_cooldown_days` row (Step 8):
   ```
   | `analysis.strategy.max_concurrent_entry_backfill` | int | `4` | Semaphore bound on concurrent `ListOrders` calls during the boot-time entry-time backfill pass (feature 116, `app/engine/entry_backfill.py`) — mirrors `analysis.screener.max_concurrent_formula_evals`'s shape. |
   ```

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "entry_backfill" app/main.py
grep -n "max_concurrent_entry_backfill" CLAUDE.md
ruff check app/engine/entry_backfill.py
```

---

### Step 13 — test: paired with Step 12

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_entry_backfill.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- `_bar_at`/`AsyncMock` patterns from `test_live_loop.py` — template for constructing a fake
  `trading_stub`/`live_loop`/`db_pool`.
- design.md § Open Risks item 3 — "a strategy pair with unusual real-world order patterns
  (manual partial adds/trims outside the strategy's own signals, multiple simultaneous lots)
  is not modeled... should be called out in the impl-spec's test cases (a multi-crossing order
  history fixture, not just a single clean round-trip)."
- Rejected-alternative note (design.md): a FILLED-only status filter would silently drop
  orders that were partially filled then CANCELED/EXPIRED — a required negative test.

**TDD**: `red-green required`

**Instructions**:
1. `test_infer_open_entry_time_single_round_trip` — one BUY (filled_qty=10) then no SELL;
   assert the returned time equals the BUY's `updated_at` (still open).
2. `test_infer_open_entry_time_flat_after_round_trip` — BUY then a fully-offsetting SELL;
   assert `None` (flat, no open entry).
3. `test_infer_open_entry_time_multi_crossing` (Open Risk 3) — BUY, SELL (flat), BUY again;
   assert the returned time is the **second** BUY's `updated_at`, not the first (the running
   balance correctly re-arms the candidate on the second 0→nonzero crossing).
4. `test_infer_open_entry_time_skips_zero_fill_orders` — includes an order with
   `filled_qty=0` (e.g. a still-open/expired-unfilled order); assert it does not perturb the
   running balance.
5. `test_infer_open_entry_time_counts_canceled_partial_fill` — a `CANCELED` order with a
   nonzero `filled_qty` (the FILLED-only-filter rejection case) followed by nothing else;
   assert the partial fill is still counted toward the open balance (proves `status` must stay
   unfiltered — a regression here would silently reproduce the rejected FILLED-only bug).
6. `test_run_once_seeds_live_loop_state_and_persists` — `live_loop` a real
   `LiveEvaluationLoop` instance (or a `SimpleNamespace` with `_last_state`/`_last_entry_at`
   dicts + a mocked `_write_entry_cooldown`); `trading_stub.ListOrders` returns an open
   position; `db_pool.fetch` returns one live-enabled strategy row; assert `_last_state[key]
   is True`, `_last_entry_at[key]` set, and `_write_entry_cooldown` awaited once.
7. `test_run_once_skips_pairs_with_known_entry_time` — pre-seed `live_loop._last_entry_at[key]`
   with a value; assert `ListOrders` is **not** called for that pair (avoids redundant RPCs).
8. `test_run_once_swallows_per_pair_rpc_failure` — `trading_stub.ListOrders` raises; assert
   `run_once` does not raise and other pairs are still processed (FR-8-style isolation).
9. `test_run_once_noop_without_trading_stub` — `trading_stub=None`; assert `run_once` returns
   immediately without touching `db_pool`.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest tests/test_entry_backfill.py -v
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 14 — service: `manage_strategy`/`get_strategy` MCP tool + client builder

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability,
`docs/runbooks/mcp-tools.md` parity.

**Codebase Evidence**:
- `manage_strategy` tool, `tools.py:442-563` — signature includes `cooldown_days: int | None =
  None` (`:451`); docstring documents semantics at `:490-494`; `supplied` dict `:521-529`;
  `mask = [name for name, value in supplied.items() if value is not None]` (`:530`);
  `clear_fields` joins mask at `:537-539`.
- `get_strategy` tool, `:893-906` — docstring field list at `:897-899`
  ("display_name, every component..., entry_rule/exit_rule, signal_params, cooldown_days, and
  the active/live_enabled flags").
- `client.py manage_strategy`, `:396-454` — `pb_def = analysis_pb2.StrategyDefinition(...,
  cooldown_days=definition.get("cooldown_days"), ...)` at `:436` (bare dict `.get`, presence-
  safe — returns `None` when absent, which protobuf treats as omitted for an `optional`
  field).
- `client.py get_strategy`, `:457-479` — thin passthrough using `MessageToDict(...,
  preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`; no code
  change needed (an unset `optional` field stays absent under this flag, confirmed by the
  existing `:465-467` comment).
- `tests/test_strategy_builders.py:96-102` — **`test_manage_strategy_definition_covers_every_
  proto_field`**, a descriptor-parity test: `assert set_fields | _STRATEGY_INTENTIONALLY_UNSET
  == set(analysis_pb2.StrategyDefinition.DESCRIPTOR.fields_by_name)`. This test **will fail**
  once Step 2's regenerated `StrategyDefinition` gains `exit_cooldown_days` unless
  `client.py`'s builder is updated in this step (Step 16 updates the test's fixture to supply
  the new field, closing the loop) — the exact "RC-1" antidote `insights.md` 2026-08-02
  documents.

**TDD**: `red-green required` (paired test in Step 15; the descriptor-parity test above is
also RED the moment Step 2 lands, until this step's `client.py` change).

**Instructions**:
1. In `tools.py`'s `manage_strategy` signature (`:442-452`), add a new parameter directly
   after `cooldown_days`:
   ```python
   exit_cooldown_days: int | None = None,
   ```
2. Add it to the `supplied` dict (`:521-529`), directly after `"cooldown_days":
   cooldown_days,`:
   ```python
   "exit_cooldown_days": exit_cooldown_days,
   ```
3. Extend the docstring (`:490-494`) with a new line mirroring the `cooldown_days` line:
   ```
   exit_cooldown_days: optional per-symbol minimum holding period in calendar days before
       exit_rule may fire a sell — omit → platform default (0, no minimum hold); 0 → no
       minimum hold (immediate exit permitted); negative → rejected (INVALID_ARGUMENT).
   ```
   Also update the "Note: changing any scoring-relevant field..." line (`:503-505`) to list
   `exit_cooldown_days` alongside `cooldown_days`.
4. In `client.py`'s `manage_strategy` (`:425-437`), add the new field to the `pb_def`
   construction, directly after `cooldown_days=definition.get("cooldown_days"),`:
   ```python
   exit_cooldown_days=definition.get("exit_cooldown_days"),
   ```
5. Update `get_strategy`'s docstring field list in `tools.py` (`:897-899`) to add
   `exit_cooldown_days` alongside `cooldown_days`.

**Verification**:
```bash
cd services/xstockstrat-agent
grep -n "exit_cooldown_days" app/tools.py app/client.py
uv run pytest tests/test_strategy_builders.py -k manage_strategy_definition -v
```

---

### Step 15 — test: paired with Step 14

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_strategy_builders.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner).

**Codebase Evidence**:
- `test_forwards_cooldown_days`, `test_tools.py:779-802` (spec originally cited `:646-670`;
  location drifted from unrelated content added earlier in the file since this spec was
  written — content/shape unchanged; re-verified 2026-08-07 re-spec gate) — direct template
  (non-zero forwarded `:789`, explicit-0 survives `:796`, omitted → key absent `:802`).
- **Correction (2026-08-07 re-spec gate)**: the spec originally attributed
  `test_cooldown_only_update_sends_only_cooldown` / `test_explicit_zero_cooldown_still_survives`
  to a class `TestManageStrategyUpdateMask` in `test_tools.py:1019-1043` — that class does not
  exist in this file (it exists, correctly, only in `test_client.py` — see below). The actual
  class is **`TestManageStrategyPartialUpdate`**, `test_tools.py:1182`, with
  `test_cooldown_only_update_sends_only_cooldown` at `:1191` and
  `test_explicit_zero_cooldown_still_survives` at `:1206` — both direct templates, content
  matches the spec's original description verbatim.
- `test_cooldown_days_round_trips_presence`, `test_client.py:108-132` — direct template, exact
  lines unchanged (`d14.HasField("cooldown_days")`/`d0.HasField(...)`/`not
  d_unset.HasField(...)`).
- `TestManageStrategyUpdateMask.test_mask_is_attached_and_absent_when_not_given`,
  `test_client.py:582` (class at `:578`; spec originally cited `:559-585` — small drift,
  content/class name confirmed correct here) — direct template.
- `_capture_manage_strategy_request`, `test_strategy_builders.py:41-71` — the fixture the
  descriptor-parity test (`:96-103`) drives; its `definition` dict (`:53-69`) currently omits
  `exit_cooldown_days`, which is why Step 14's `client.py` change alone still leaves the
  descriptor-parity test failing until this fixture is updated.

**TDD**: `red-green required`

**Instructions**:
1. In `test_tools.py`, extend `test_forwards_cooldown_days` (or add a sibling
   `test_forwards_exit_cooldown_days`) mirroring the three assertions (non-zero forwarded,
   explicit-0 survives, omitted → absent) for `exit_cooldown_days`.
2. In **`TestManageStrategyPartialUpdate`** (`test_tools.py:1182`), add
   `test_exit_cooldown_only_update_sends_only_exit_cooldown` and
   `test_explicit_zero_exit_cooldown_still_survives`, mirroring `:1191`/`:1206`.
3. In `test_client.py`, add `test_exit_cooldown_days_round_trips_presence` mirroring
   `:108-132` (14/0/unset presence cases for `exit_cooldown_days`).
4. In `TestManageStrategyUpdateMask` (`test_client.py`), add a case asserting
   `exit_cooldown_days` reaches the wire under `update_mask=["exit_cooldown_days"]`, mirroring
   `:559-585`.
5. In `test_strategy_builders.py`, update `_capture_manage_strategy_request`'s `definition`
   dict (`:53-69`) to include `"exit_cooldown_days": 3` alongside the existing
   `"cooldown_days": 5` — this is the fixture the mandatory descriptor-parity test consumes;
   without it, `test_manage_strategy_definition_covers_every_proto_field` fails the moment
   Step 2's regenerated proto lands (RED), and passes once both this fixture and Step 14's
   `client.py` builder carry the field (GREEN).

**Verification**:
```bash
cd services/xstockstrat-agent
uv run pytest tests/test_tools.py tests/test_client.py tests/test_strategy_builders.py -v
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 16 — docs: `mcp-tools.md` + `strat-lab` skill

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: none (docs category, per reviewer-registry.md's Step Category → Reviewer Roles
table).

**Codebase Evidence**:
- `mcp-tools.md:462-474` (parameter table), `:474` last row is `clear_fields` — insert the new
  `exit_cooldown_days` row directly after the existing `cooldown_days` row (`:473`).
- `mcp-tools.md:486-491` (Errors table) — the `Negative cooldown_days` row (`:487`) is the
  template for a mirrored `exit_cooldown_days` row.
- `mcp-tools.md:493-496` ("Effect on the derived grade") — lists the scoring-relevant fields;
  add `exit_cooldown_days`.
- `mcp-tools.md:530-531` (`get_strategy`'s presence-honest description of `cooldown_days`) —
  mirror for `exit_cooldown_days`.
- `plugins/strat-lab/skills/backtest/SKILL.md:44-54`, specifically `:48` — the **only**
  `cooldown_days` mention in the strat-lab skill; per root `CLAUDE.md`'s requirement, this
  must be updated in the **same PR** as Step 14/15 (this step bundles with them, not a
  separate merge).
- `plugins/strat-lab/README.md` — confirmed absent of any `cooldown_days` mention (recon) — no
  edit needed there.

**TDD**: `N/A (docs)`

**Instructions**:
1. In `mcp-tools.md`'s `manage_strategy` parameter table (`:462-474`), add a row after
   `cooldown_days`:
   ```
   | `exit_cooldown_days` | `int` | No | Per-symbol minimum holding period in calendar days before `exit_rule` may fire a sell. Omit → platform default (0, no minimum hold); `0` → no minimum hold (current behavior); negative rejected |
   ```
2. In the Errors table (`:482-491`), add a row after the negative-`cooldown_days` row:
   ```
   | Negative `exit_cooldown_days` | `invalid argument` (INVALID_ARGUMENT) |
   ```
3. Update the "Effect on the derived grade" paragraph (`:493-496`) to list
   `exit_cooldown_days` alongside `cooldown_days`, `components`, rules, `signal_params`.
4. In `get_strategy`'s section (`:530-531`), extend the `cooldown_days` presence sentence to
   also cover `exit_cooldown_days`.
5. In `plugins/strat-lab/skills/backtest/SKILL.md`'s mutation-guard section (`:44-54`), add one
   sentence noting `exit_cooldown_days` behaves identically to `cooldown_days` under the
   partial-merge contract (send only what changes; use `clear_fields` to revert to the
   platform default).

**Verification**:
```bash
grep -n "exit_cooldown_days" docs/runbooks/mcp-tools.md plugins/strat-lab/skills/backtest/SKILL.md
```
Confirm all five insertion points above are present.

---

### Step 17 — service: `StrategyWizard.tsx` exit-cooldown field

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — strategy wizard form correctness,
Connect-RPC call safety.

**Codebase Evidence**:
- `parseCooldownDays`, `StrategyWizard.tsx:30-39` — direct template (blank→`undefined`;
  non-negative int→value; else→error).
- State seed, `:56-58` — `initial?.cooldownDays !== undefined ? String(initial.cooldownDays) :
  ''` (presence-honest, avoids `?? 0`).
- `canAdvance` gate, `:103-105` — `step === 1 ? idValid && displayName.trim() !== '' &&
  cooldownParsed.valid : ...`.
- `stepForError`, `:75-82` — `if (m.includes('cooldown')) return 1;` — already matches both
  "cooldown_days" and "exit_cooldown_days" server error strings (substring match), **no change
  needed here**.
- `handleSubmit`'s spread, `:112-127` — `...(cd.valid && cd.value !== undefined ? {
  cooldownDays: cd.value } : {})`.
- Step-1 JSX field, `:192-206` — the "Re-entry cooldown (days)" `<Input type="number" min={0}
  ... placeholder="31 (default)" .../>` block — the new field is inserted directly after this
  block, inside the same `step === 1` div (`:169-207`).
- `StrategyDefinitionInit` type derives automatically from the regenerated proto schema
  (`useStrategyDefinitions.ts:1-10`, `MessageInitShape<typeof StrategyDefinitionSchema>`) —
  Step 2's `buf-gen.sh` run is what surfaces `exitCooldownDays` in TypeScript; no hand-written
  interface edit needed.

**TDD**: `red-green required` (paired e2e test in Step 18)

**Instructions**:
1. Add a `parseExitCooldownDays` function directly after `parseCooldownDays` (`:30-39`),
   identical shape but with the error message `'exit cooldown days must be a non-negative
   integer'`.
2. Add state, directly after `cooldownDaysRaw` (`:56-58`):
   ```tsx
   const [exitCooldownDaysRaw, setExitCooldownDaysRaw] = useState(
     initial?.exitCooldownDays !== undefined ? String(initial.exitCooldownDays) : '',
   );
   ```
3. Compute `const exitCooldownParsed = parseExitCooldownDays(exitCooldownDaysRaw);` alongside
   `cooldownParsed` (`:102`), and add `&& exitCooldownParsed.valid` to the `step === 1` branch
   of `canAdvance` (`:105`).
4. In `handleSubmit` (`:112-127`), add a mirrored presence-honest spread directly after the
   `cooldownDays` spread:
   ```tsx
   ...(cd2.valid && cd2.value !== undefined ? { exitCooldownDays: cd2.value } : {}),
   ```
   (introduce `const cd2 = parseExitCooldownDays(exitCooldownDaysRaw);` alongside the existing
   `const cd = parseCooldownDays(cooldownDaysRaw);` at the top of `handleSubmit`, `:113`).
5. In the Step-1 JSX (`:169-207`), add a new field block directly after the existing "Re-entry
   cooldown (days)" block (`:192-206`), before the closing `</div>` at `:207`:
   ```tsx
   <div>
     <label className="mb-1 block text-xs text-muted-foreground">
       Exit cooldown (days)
     </label>
     <Input
       type="number"
       min={0}
       value={exitCooldownDaysRaw}
       placeholder="0 (default)"
       onChange={(e) => setExitCooldownDaysRaw(e.target.value)}
     />
     {!exitCooldownParsed.valid && (
       <p className="mt-1 text-xs text-destructive">{exitCooldownParsed.error}</p>
     )}
   </div>
   ```
   Note the placeholder text differs deliberately from the re-entry field's `"31 (default)"` —
   the exit-cooldown platform default is `0` (Step 8), not `31`.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec tsc --noEmit
pnpm run lint
grep -n "exitCooldownDays\|parseExitCooldownDays" src/components/insights/StrategyWizard.tsx
```

---

### Step 18 — test: paired with Step 17

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` (service owner).

**Codebase Evidence**:
- `test.describe('Strategy authoring — re-entry cooldown (feature 069)', ...)`,
  `strategy-authoring.spec.ts:256-382` (spec originally cited the block as `:256-358` — the
  block actually runs through `:382`; a later, unrelated feature 097 test
  `'editing a strategy preserves signal_params.symbols on save'` was added inside it at
  `:360-381`, before the block's real closing `});` at `:382`; re-verified 2026-08-07 re-spec
  gate) — the block through `:358` is still the correct template: `captureManageStrategy`
  helper (`:258-269`), `fillToReview(page, id, display, cooldown)` (`:271-293`, fills the
  `'31 (default)'` placeholder), and the 5 test cases (blank-omits `:295-305`,
  explicit-0-sends-0 `:307-317`, negative-blocks-step-1 `:319-329`, edit-prepopulates
  `:331-337` using sentinel id `strat-cooldown-14`, unrelated-edit-preserves-unset `:339-358`).
  **The new block must be inserted after `:382` (the block's actual end), not after `:358`** —
  inserting at `:358` would land it inside the existing block, before the unrelated feature-097
  test and before the closing `});`.
- `mock-backend.ts`'s `getStrategy` handler, `:782-809` (spec originally cited `:735-761` — the
  file grew ~47-50 lines from unrelated content earlier in the file since this spec was
  written; content/shape unchanged; re-verified 2026-08-07) — the `cooldownDays` conditional at
  `:801`: `...(req.strategyId === 'strat-cooldown-14' ? { cooldownDays: 14 } : {})` — the
  sentinel-id pattern this step's edit-prepopulation test reuses (a **reserved sentinel id**,
  per C-12's exemption for scenario one-offs — not a new fixture module).
- `manageStrategy` handler, `:772-780` (spec originally cited `:725-733` — same line-drift
  cause) — `return req.definition ?? {};` (echoes the request verbatim; **no change needed** —
  `exitCooldownDays` round-trips automatically once present on the request, exactly as
  `cooldownDays` does today).
- **Correction (2026-08-07 re-spec gate)**: the spec's claim that `strat-cooldown-14` "is
  registered in" `INVENTORY.md`'s "Recurring sentinel ids" section is **false as currently
  written** — that section exists at `INVENTORY.md:28-41`, but contains no `cooldown`-related
  row at all (grep confirms zero matches); `strat-cooldown-14` was apparently never backfilled
  into this table when feature 069 shipped it. This is a **pre-existing gap in another
  feature's cleanup, out of this step's scope to fix** — Instruction 2 below adds only
  `strat-exit-cooldown-7` as a new row (not "mirroring" a nonexistent one), formatted to match
  the table's existing row shape (see the 8 present rows, e.g. `strat-diag-001`).

**TDD**: `red-green required`

**Instructions**:
1. In `mock-backend.ts`'s `getStrategy` handler (`:782-809`), add a second sentinel-id
   conditional directly after the `strat-cooldown-14` one (`:801`):
   ```ts
   // Feature 116: only this id carries a non-default exit cooldown (edit-prepopulation e2e);
   // every other id leaves exitCooldownDays unset so the "edit unset strategy" case stays honest.
   ...(req.strategyId === 'strat-exit-cooldown-7' ? { exitCooldownDays: 7 } : {}),
   ```
2. In `e2e/fixtures/INVENTORY.md`'s "Recurring sentinel ids" section (`:28-41`), add a new row
   for `strat-exit-cooldown-7` formatted to match the table's existing rows — reserved,
   `mock-backend.ts`-pattern-matched, do not rename or reuse for another meaning. (Do not
   backfill the missing `strat-cooldown-14` row here — that is feature 069's gap, not this
   step's scope; flag it in `context.md` if worth a future doc-completeness follow-up.)
3. In `strategy-authoring.spec.ts`, add a new `test.describe('Strategy authoring — exit
   cooldown (feature 116)', ...)` block directly after the existing feature-069 block's actual
   closing `});` at `:382` (**not** at `:358` — see Codebase Evidence correction above),
   reusing the same `captureManageStrategy`/`fillToReview` helpers extended with an
   `exitCooldown` parameter (fills the `'0 (default)'` placeholder from Step 17), with the
   same 5 cases:
   - `create with a blank exit cooldown omits exitCooldownDays from the payload`
   - `create with an explicit 0 sends exitCooldownDays: 0`
   - `a negative exit cooldown blocks advancing past Step 1`
   - `edit pre-populates a non-default exit cooldown` — navigates to
     `/insights/strategies/strat-exit-cooldown-7/edit`, asserts the exit-cooldown input has
     value `'7'`.
   - `editing an unset strategy on an unrelated field does not write exitCooldownDays`

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm exec tsc --noEmit
pnpm run lint
grep -n "strat-exit-cooldown-7" e2e/mock-backend.ts e2e/fixtures/INVENTORY.md e2e/insights/strategy-authoring.spec.ts
pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts
```
No coverage threshold applies to `xstockstrat-ui` (Playwright e2e, per
`reference/spec-template.md`'s coverage table) — the e2e run above is the verification.

---

### Step 19 — test: cross-cutting fingerprint/parity confirmation sweep

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**: none (verification-only step — no source changes)

**Reviewers**: `xstockstrat-analysis` (service owner).

**Codebase Evidence**:
- Step 7's `test_fingerprint_changes_with_exit_cooldown_days` already proves FR-9
  (fingerprint participation) — this step is a **confirmation**, not new code.
- Step 11's `test_replay_state_matches_sequential_apply_transition` already proves the FR-4
  parity requirement structurally (one shared core, not two hand-synchronized copies).

**TDD**: `N/A (verification-only — no new production code; re-runs the full suite assembled by prior steps)`

**Instructions**: Run the full `xstockstrat-analysis` test suite once all of Steps 1–13 have
landed, to catch any cross-step interaction the per-step runs (each scoped with `-k`) could
miss.

**Verification**:
```bash
cd services/xstockstrat-analysis
uv run pytest --cov=app --cov-fail-under=40 -v
ruff check . && ruff format --check .
```
All tests green; coverage ≥ 40%.

---

### Step 20 — docs: file the pre-existing `max_strategies_per_cycle` starvation defect

**Status**: `pending`
**Service**: `docs/reports/`
**Files**:
- `docs/reports/2026-08-07-exit-cooldown-max-strategies-per-cycle-starvation.md` — create

**Reviewers**: none (docs category).

**Codebase Evidence**:
- design.md § Open Risks, item 1 (verbatim): `_run_cycle` (`live_loop.py:99-120`) selects live
  pairs with no `ORDER BY` and returns once `processed >= max_pairs` (default 50 via
  `analysis.engine.max_strategies_per_cycle`) — any live pair beyond the cap is never reached
  by `_eval_pair`, ever, silently starving **both** the entry-side re-entry cooldown (feature
  069, already shipped) and this feature's exit-side gate for that pair. Design explicitly
  scopes this **out** of the feature ("Not this feature's scope to fix — touches feature 069's
  shared code path") and requires "a standalone defect report under `docs/reports/` for
  `/sdd-triage --from-report` — to be addressed at implementation-spec time or as a follow-up,
  not silently absorbed into this feature's step list." This step satisfies that requirement.

**TDD**: `N/A (docs)`

**Instructions**: Write a defect report at
`docs/reports/2026-08-07-exit-cooldown-max-strategies-per-cycle-starvation.md` following the
existing `docs/reports/` defect-report shape (see any prior dated report in that directory for
the header/section convention), describing: the symptom (a live pair beyond the
`max_strategies_per_cycle` cap — default 50 — is never evaluated, silently starving both the
069 re-entry gate and this feature's exit gate for that pair), the root cause (`_run_cycle`'s
unordered `SELECT` + early-return at the cap, `live_loop.py:99-120`), severity assessment, and
that it predates this feature (discovered during 116's design phase, not introduced by it).
Do **not** attempt a fix in this feature — file only.

**Verification**:
```bash
ls docs/reports/2026-08-07-exit-cooldown-max-strategies-per-cycle-starvation.md
```

---

### Step 21 — test: final full-suite regression run

**Status**: `pending`
**Service**: multi (`xstockstrat-analysis`, `xstockstrat-agent`, `xstockstrat-ui`)
**Files**: none (verification-only step)

**Reviewers**: `xstockstrat-analysis`, `xstockstrat-agent`, `xstockstrat-ui` (all three
service owners).

**Codebase Evidence**: N/A — this step re-runs every prior step's own verification command as
a single final gate before `/sdd-review impl-spec`.

**TDD**: `N/A (verification-only)`

**Instructions**: Run every affected service's full test suite + lint one final time, after
all 20 prior steps have landed, to confirm no cross-service regression (e.g. a stale generated
stub, a missed rename) slipped through the per-step scoped runs.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/exit-cooldown"
```

---

## Deviation Log
### Deviation: Step 6 — service: backtest engine exit-cooldown gate
**Spec said**: gate the exit branch with
`is_cooldown_active(entry_time, bar.time.ToDatetime(tzinfo=UTC), exit_cooldown_days)`, treating
`entry_time` as already a Python `datetime` (mirroring how `last_exit_time` is used at the
entry-side gate).
**Actual**: `entry_time` is actually a raw `google.protobuf.Timestamp` at this point in the
function (`entry_time = bar.time`, not `.ToDatetime(...)`) — unlike `last_exit_time`, which the
existing code explicitly converts (`last_exit_time = bar.time.ToDatetime(tzinfo=UTC)`). Passing
the raw Timestamp into `is_cooldown_active` crashed with `AttributeError: tzinfo` inside
`_require_aware`. Fixed by converting at the call site:
`entry_time.ToDatetime(tzinfo=UTC) if entry_time is not None else None` — `entry_time` itself is
left untouched everywhere else in the function (it is still needed as a raw `Timestamp` for
`entry_ts.CopyFrom(entry_time)` later).
**Reason**: the spec's Codebase Evidence cited `entry_time` as already ephemeral/tracked but did
not verify its exact Python type at the exit-branch call site — a `path:line` citation confirmed
the variable's existence and lifecycle, not its type. Caught immediately by the paired test's RED
run turning into a crash instead of a clean pass/fail on the assertion.

### Deviation: Step 7 — test: paired with Step 6
**Spec said**: the new tests reuse the existing `make_servicer()` helper unchanged.
**Actual**: added `cfg.get_int_present = MagicMock(side_effect=lambda key, default: default)` to
`make_servicer()` (`tests/test_analysis_servicer.py`), alongside the existing `get_float`/
`get_str`/`get_int` stubs.
**Reason**: `make_servicer()`'s mock `cfg` only stubbed `get_int`/`get_float`/`get_str` — it
predates `get_int_present` (introduced by feature 097). Without stubbing it, `self._cfg.
get_int_present(...)` returned an unconfigured `MagicMock`, and `timedelta(days=MagicMock)`
raised `TypeError`. In scope: `make_servicer()` lives in `tests/test_analysis_servicer.py`,
already this step's own `**Files**` entry.


### Deviation: Step 1 — proto: add `exit_cooldown_days` field
**Spec said**: `buf breaking --against ".git#branch=feature/exit-cooldown"`
**Actual**: `buf breaking --against "/home/user/xstockstrat/.git#branch=feature/exit-cooldown,subdir=packages/proto"`
**Reason**: the literal spec'd command fails when run from `packages/proto/` (`.git` doesn't
exist there — the repo root's `.git` is two levels up) with "does not appear to be a git
repository." `scripts/buf-gen.sh:41` already establishes the correct invocation (repo-root
`.git` + `subdir=packages/proto`) for exactly this reason; used the same form. `buf lint` and
`buf breaking` both pass clean with the corrected command — this is a command-syntax fix, not a
change to what the step verifies.

### Deviation: Step 4 — service: generalize `cooldown.py` + dual-purpose `strategy_cooldowns.py`
**Spec said**: `upsert_entry` INSERTs `(strategy_id, symbol, last_entry_at)` only, "touching only
the `last_entry_at` column" (design.md § Chosen Approach).
**Actual**: also expanded migration **012** (Step 3, already `done` at the time this was found)
to `ALTER TABLE analysis.strategy_cooldowns ALTER COLUMN last_exit_at DROP NOT NULL` (and the
inverse `SET NOT NULL` in `.down.sql`), and updated `strategy_cooldowns.py`'s module docstring to
document both columns as nullable.
**Reason**: migration `009`'s `last_exit_at TIMESTAMPTZ NOT NULL` was a safe invariant when the
only writer (`upsert`/now `upsert_exit`) always supplied a real timestamp on INSERT. `upsert_entry`
(this step) can INSERT a brand-new row for a pair that has **never exited** — an entry-first
upsert, e.g. from the boot-time backfill (Step 12) or a live entry on a pair with no prior exit
history — and PostgreSQL rejects an INSERT that omits a NOT NULL column with no DEFAULT. This
was not caught by any of the 6 design-debate rounds (design.md's `upsert_entry` description
assumed UPDATE-only semantics and never traced the INSERT branch against the column's
constraint). Rejected fixing it by supplying a sentinel `last_exit_at` value on insert instead —
a fake timestamp would be silently misread as a real anchor by `is_cooldown_active`, which is
strictly worse than relaxing a constraint that was never semantically required (a pair that has
never exited legitimately has no `last_exit_at`, exactly mirroring the already-established
"NULL anchor = never gated" semantics `is_cooldown_active` already implements for the entry-side
gate). Migration 012 had not yet been applied to any real database (still on a feature branch,
never merged) when this was caught, so revising it is not an F-01 violation — only an already-
`main-dev`-committed migration is immutable. Ledger-worthy: see the `insights.md`/`fails.md`
write-up planned for this feature's archival.

### Deviation: Step 10 — service: live-loop shared transition core + entry-cooldown state + replay
**Spec said**: `_replay_state(bars, decisions, cooldown_days, exit_cooldown_days)` folds
`_apply_transition` starting unconditionally from `(False, None, None)` for any key reached for
the first time since restart.
**Actual**: added two optional keyword parameters, `initial_entry_time` / `initial_last_exit_at`
(both default `None`), and start the fold from those instead of a hardcoded `None, None`. The
`_eval_pair` call site seeds them from `self._last_entry_at.get(key)` /
`self._last_exit_at.get(key)` — i.e. whatever `hydrate_cooldowns()` already loaded (or a prior
cycle already resolved) for this key — before the replay runs.
**Reason**: an unconditional blank fold silently regresses an already-known anchor back to `None`
whenever the replay window itself shows no crossing — the common case for a short/empty replay
window (a restart moments after boot, before `_LOOKBACK_DAYS` worth of bars accumulate any
transition) or a real transition that predates the 365-day lookback entirely. Concretely: a pair
hydrated with a real `last_exit_at` from the DB would have that anchor wiped back to `None` on the
very first `_eval_pair` call after restart, re-opening the re-entry-cooldown gate a full cycle
early. Caught while implementing (not surfaced by design.md or any of the 6 design-debate rounds,
which described the fold only in terms of the replay window's own bars, never in terms of what the
loop already knows going in). `in_position` itself is *not* seeded this way and still always starts
`False` — only the durable timestamp anchors have a pre-restart source of truth to protect;
`in_position` is exactly the restart-durability gap bar-replay exists to close. Confirmed via
`test_replay_seeded_steady_state_emits_no_alert` (Step 11) and the general fold-equivalence proof
in `test_replay_state_matches_sequential_apply_transition`.

### Deviation: Step 10/11 — pre-existing `TestLiveEvaluationLoopCooldown` tests broke under replay
**Spec said**: Step 10/11 only add new code/tests; the existing `TestLiveEvaluationLoopCooldown`
class (feature 069) is untouched.
**Actual**: 4 of those pre-existing tests required fixes once `_eval_pair`'s replay-then-read block
landed:
- `test_entry_suppressed_inside_cooldown_window` — assertion `assert key not in loop._last_state`
  no longer holds, because replay now explicitly writes `_last_state[key]` for any first-seen key
  (even a no-op replay writes `False`). Changed to `assert loop._last_state.get(key) is False`
  (same behavior under test — suppression — asserted the way the new code actually expresses it).
- `test_exit_persists_cooldown_via_repo`, `test_exit_persists_even_when_alert_throttled` — each
  manually set `loop._last_state[key] = True` without seeding `loop._replayed`, so on the next
  `_eval_pair` call the (empty, single-mock-bar) replay window would run and reset `in_position`
  back to `False` before the exit branch could fire. Fixed by seeding `loop._replayed.add(key)` in
  each test (simulating "already resolved this cycle," which is what the test's manual `_last_state`
  seed was already trying to represent).
- `test_write_cooldown_failure_never_propagates` — same root cause as the two above, but this one
  was a **false-positive green**: it passed even before the fix, because the reset-to-`False`
  meant the exit branch (and thus `upsert_exit`, the very call the test claims to exercise) never
  ran at all — the test was asserting "no exception propagates" against code that was never
  reached. Fixed with the same `_replayed.add(key)` seed, and added a new
  `repo.upsert_exit.assert_awaited_once()` assertion so a future regression that silently
  short-circuits the exit branch again fails loudly instead of passing vacuously.
- All three of the above also needed `loop._last_entry_at[key]` seeded to a time before the test's
  bar — without it, the new skip-until-known guard (Step 10) correctly treats the pair as gated
  (entry anchor unresolved) even with `_replayed` seeded, which is new-and-correct behavior these
  069-era tests had no way to anticipate.
**Reason**: none of these are spec defects — Step 10's replay mechanism is new, cross-cutting
state-machine behavior that the 069-era tests' hand-seeded mock state didn't account for. Caught by
running the full `test_live_loop.py` suite (not just the new class) immediately after Step 10's
implementation, per this session's TDD-gate discipline. The false-positive-green case in
`test_write_cooldown_failure_never_propagates` is the more general, ledger-worthy lesson: seeding
mock state that mimics an old code path's *outcome* (here, `_last_state[key] = True`) instead of the
state the *new* code path actually needs to reach the same outcome can leave a test silently
exercising nothing — see `docs/roadmap/ledger/fails.md` ("2026-08-07 — exit-cooldown —
test-infra").

### Deviation: Step 10 — `_make_loop()` missing `get_int_present` stub
**Spec said**: `_make_loop()` (`tests/test_live_loop.py`) needs no change for Step 10/11 beyond
adding the new test class.
**Actual**: added `cfg.get_int_present = MagicMock(side_effect=lambda key, default: default)` to
`_make_loop()`, the same fix Step 7 already made to `make_servicer()` in
`tests/test_analysis_servicer.py`.
**Reason**: identical root cause to the Step 7 deviation above — `_make_loop()`'s mock `cfg`
predates `get_int_present` (feature 097) and only stubbed `get_int`/`get_float`/`get_str`. Once
`_eval_pair` started calling `self._cfg.get_int_present("analysis.strategy.default_exit_cooldown_days",
0)` (Step 10), the unconfigured `MagicMock` return value hit `timedelta(days=MagicMock)` inside
`effective_cooldown_days` → `TypeError`, exactly as it did in Step 7. In scope: `_make_loop()` lives
in `tests/test_live_loop.py`, already Step 11's own `**Files**` entry.

### Deviation: Step 12 — service: boot-time Order-based entry-time backfill
**Spec said**: `entry_backfill.py`'s `run_once` imports `strategy_symbols` and
`_row_to_strategy_definition` as function-local deferred imports inside `run_once` (each with a
`# noqa: PLC0415`), per the spec's literal code block — with an inline NOTE already correcting the
`_row_to_strategy_definition` import source from `app.engine.live_loop` to `app.handlers.servicer`.
**Actual**: both imported at module top level instead (`from app.engine.live_loop import
strategy_symbols`; `from app.handlers.servicer import _row_to_strategy_definition`), no deferral,
no `noqa` needed.
**Reason**: verified no import cycle exists — `servicer.py` does not import `live_loop.py` or
`entry_backfill.py`, and `live_loop.py` does not import `entry_backfill.py` (confirmed by grep
before writing the file). The spec's deferred-import pattern appears to be a defensive habit
carried over rather than a proven necessity for this specific module graph; top-level imports are
simpler, pass `ruff check` clean with no suppression comment, and match this module's own stated
constraint ("imported ONLY by main.py, never by live_loop.py") without needing runtime deferral to
enforce it. Purely a style choice — no behavior difference; `ruff check`/`ruff format` both clean.
