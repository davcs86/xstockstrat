# Implementation Spec: backtest-next-bar-fill

**Status**: `pending`
**Created**: 2026-08-23
**Feature**: `docs/roadmap/features/151-backtest-next-bar-fill/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/backtest-next-bar-fill`

---

## Execution Summary

Order: **proto → codegen → migration → engine (service+test) → agent (service+test) → strat-lab
docs → UI (service+test)**. The proto lands the additive `FillModel` enum + three fields; codegen
regenerates stubs; the migration adds the nullable `fill_model` column the engine persists. The
engine step is the core: one shared `_apply_fill` **deferred-execution** state machine over an
explicit `SimState`, called from **both** simulators, that **returns** the fill-bar action and
**never writes `diags`** — the loop stays the sole writer of `diags[...].action` and the sole
appender to `daily_equity`, so the `daily_equity[j]↔diags[j]` 1:1 assert (`servicer.py:3291`) stays
trivially true. The effective fill model is resolved once at `RunBacktest` entry (mirroring
commission/slippage at `servicer.py:383-384`), threaded to both simulators and `_persist_backtest_run`,
and echoed on the result/summary. Consumer surfaces (C-14): the agent `run_backtest` tool + the
strat-lab skill (same PR), and the `/insights` UI label + its exhaustive `Record<FillModel>` map
(ledger 067, same PR as the proto change).

**Scenario Coverage (C-15):**

- `AC-1` (entry fills at next-bar open) → Step 5
- `AC-2` (exit + vts stop fills at next-bar open) → Step 5
- `AC-3` (last-bar signal, no look-ahead, no position opened) → Step 5
- `AC-4` (legacy same-bar-close default byte-for-byte unchanged) → Step 5 (golden parity test over BOTH simulators)
- `AC-5` (fill model recorded on the run + returned) → Step 5 (persist + echo) — surfaced also by Steps 7/10
- `AC-6` (per-bar diagnostics aligned with the fill bar; `daily_equity` 1:1) → Step 5
- `AC-7` (n-2 entry fills, cross-mode trade-count symmetry) → Step 5
- `AC-8` (fill-to-fill cooldown spacing at a next-bar boundary) → Step 5
- `AC-9` (effective fill model resolved once + round-trips through persist/echo) → Step 5 (resolve + persist) — surfaced also by Steps 7/10
- `AC-10` (unspecified request + no config override = byte-for-byte legacy) → Step 5 (golden parity test, config fixture asserts `default_fill_model` absent)
- `AC-11` (fill-row action reflects prior-bar signal while conviction is current-bar; grade unaffected) → Step 5

**Design confirm-items resolved here** (design.md § Open Risks):

- **Cooldown reference-bar** → pinned to **fill-bar** (the recommendation). The gate moves into
  `_apply_fill`, reading `bars[fill_idx].time` against `entry_time`/`last_exit_time` (which are the
  fill-bar times). Byte-identical in legacy mode (`signal==fill`). Covered by a Step 5 assertion.
- **Config zero-trap** → `analysis.backtest.default_fill_model` read via `get_int` is safe because
  both absent and a configured `0` resolve to `FILL_MODEL_UNSPECIFIED` → legacy `SAME_BAR_CLOSE`.
  Documented in the CLAUDE.md key row (Step 4) and asserted in Step 5.
- **Pending-above-warm-up** → `_apply_fill` runs **before** the SMA warm-up `continue` branches
  (`servicer.py:970-972,979-981`); stated as an invariant in Step 4 and asserted in Step 5.
- **Action/conviction decouple** → in next-bar mode `diags[i+1].action` reflects bar `i`'s signal
  while `diags[i+1].conviction` reflects bar `i+1`'s own decision; display-only (grade math never
  reads conviction). Documented in Step 4 (code comment) and Step 8 (strat-lab skill); covered by
  first-class scenario **AC-11**.

## Note on acceptance coverage

`acceptance.feature` now carries **AC-1..AC-11**: the six original next-bar scenarios plus AC-7
(n-2-entry symmetry), AC-8 (fill-to-fill cooldown), AC-9 (effective-model resolution/round-trip),
AC-10 (unspecified-request-with-no-config-override = byte-for-byte legacy), and AC-11
(action/conviction decouple) — appended 2026-08-23 to make the design's referenced behaviors
first-class, traceable scenarios (append-only IDs, C-15). Every scenario is covered by the Step 5
test body (AC-9 also by Steps 7/10). The design-confirm behaviors are no longer tag-less assertions.

## Step Dependencies

- Steps 4–10 require **Step 2** (generated stubs: `FillModel`, `RunBacktestRequest.fill_model`,
  `BacktestResult.fill_model`, `BacktestRunSummary.fill_model`).
- Step 4 (engine persist) requires **Step 3** (the `fill_model` column must exist before
  `_persist_backtest_run` writes it and `_row_to_backtest_summary` reads it).
- Step 5 [test] covers Step 4 [service]. Step 7 [test] covers Step 6 [service]. Step 10 [test]
  covers Step 9 [service].
- Step 8 (strat-lab skill) MUST land in the **same PR** as Step 6 (the `run_backtest` tool change) —
  root CLAUDE.md § strat-lab plugin.
- Step 9 (UI enum map) MUST land in the **same PR** as Step 1 (the `FillModel` proto enum) — ledger
  067 enum↔UI-exhaustive-map coupling.
- **Cross-feature (merge-order.md 150↔151 row) — re-derive at execute time.** This spec uses the
  reserved split: **151** takes `RunBacktestRequest.fill_model = 9`, `BacktestResult.fill_model = 20`,
  `BacktestRunSummary.fill_model = 18`, migration **`018`**; **150** takes `sizing_mode = 8`,
  `BacktestResult` 17/18/19, `BacktestRunSummary.sizing_mode = 17`, migration `017`. Confirmed on the
  current tree: `RunBacktestRequest` occupies 1–7 (`analysis.proto:52-62`), `BacktestResult` 1–16
  (`:84-107`), `BacktestRunSummary` 1–16 (`:203-221`), latest analysis migration `016`
  (`services/xstockstrat-analysis/migrations/`). Neither 150 nor 151 is merged yet; 150 is
  `implementation-ready` and its `implementation-spec.md` claims exactly the reserved lower numbers.
  **Proto fields**: the split is fixed regardless of merge order (proto tolerates a gap; `buf
  breaking` is additive-clean either way). **Migration NNN is order-sensitive**: golang-migrate
  applies in numeric order and will **not** backfill a lower version once a higher one is applied.
  This spec plans the expected order (150 → `017` first, 151 → `018` second). **If 151 lands before
  150**, renumber this migration to the next-free NNN (`017`) and 150 renumbers to `018` — re-verify
  the next-free NNN across all remote branches, not just the local tree (ledger 081).

---

### Step 1 — proto: FillModel enum + additive fill_model fields

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking`; xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- `RunBacktestRequest` occupies fields 1–7 (`analysis.proto:52-62`; last is `inline_definition = 7`).
- `BacktestResult` occupies 1–16 (`analysis.proto:84-107`; last is `warnings = 16`); the message
  carries the persisted-verbatim warning: "wire bytes are persisted verbatim in
  `analysis.backtest_details` … Additive changes only" (`:80-83`).
- `BacktestRunSummary` occupies 1–16 (`analysis.proto:203-221`; last is `range_end = 16`).
- Enum-with-`_UNSPECIFIED=0` precedent: `BacktestStatus` (`:64-68`), `SizingMode` reserved by 150.
- Reserved split (merge-order.md 150↔151): 151 → request `9`, result `20`, summary `18`.

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Add a `FillModel` enum near `BacktestStatus` (`analysis.proto:64`):
   ```proto
   // Which bar/price a backtest fills a signal at (feature 151). Closed set → enum (C-04).
   enum FillModel {
     FILL_MODEL_UNSPECIFIED = 0;    // caller/config did not choose → resolves to SAME_BAR_CLOSE (legacy)
     FILL_MODEL_SAME_BAR_CLOSE = 1; // legacy: fill at bar i's close ± slippage (optimistically biased)
     FILL_MODEL_NEXT_BAR_OPEN = 2;  // bias-free: fill a bar-i signal at bar (i+1)'s open ± slippage
   }
   ```
   `UNSPECIFIED=0` is the request/config "not chosen" sentinel; the servicer normalizes it to
   `SAME_BAR_CLOSE` for both routing and the recorded value (AC-4/AC-5).
2. Add to `RunBacktestRequest` (after `inline_definition = 7`):
   `FillModel fill_model = 9;` with a comment: unset/`UNSPECIFIED` → server default (config, else
   legacy). (Field `8` is reserved for feature 150's `sizing_mode`.)
3. Add to `BacktestResult` (after `warnings = 16`):
   `FillModel fill_model = 20;` — the **effective** model the run actually used (never `UNSPECIFIED`
   on a completed run). (17/18/19 reserved for 150.)
4. Add to `BacktestRunSummary` (after `range_end = 16`):
   `FillModel fill_model = 18;`. (17 reserved for 150.)

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev"
```
Both pass (additive-only; the baseline is **`main-dev`** — the merge target — so the check proves the
change is additive against trunk, not merely against the last feature-branch commit; diff against the
current merge base at execute time if `main-dev` has moved). Confirm no field number collides with
150's reserved 8/17/18/19.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; do not hand-edit)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking`; xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias
(inherited from Step 1)

**Codebase Evidence**:
- Codegen script: `./scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs) — generates TS,
  Python, Go and compiles the TS package.
- Python consumers import `from gen.analysis.v1 import analysis_pb2` (`client.py:522`); UI imports
  `from @xstockstrat/proto/analysis/v1/analysis_pb` (`page.tsx:20`, `BacktestDiagnostics.tsx:8`).

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Commit only the regenerated `packages/proto/gen/**` output — the only diff must be the new
   `FillModel` enum and the three new fields (`RunBacktestRequest.fill_model`,
   `BacktestResult.fill_model`, `BacktestRunSummary.fill_model`).

**Verification**:
```
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ | grep -q . && echo "stubs regenerated"
```
Then `git diff packages/proto/gen/` shows only the new enum/fields (no unrelated churn).

---

### Step 3 — migration: 018 fill_model column on analysis.backtest_runs

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/018_backtest_runs_fill_model.up.sql` — create
- `services/xstockstrat-analysis/migrations/018_backtest_runs_fill_model.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, additive-only; xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- Last migration on disk is `016_order_snapshots_pnl_patterns` (`ls
  services/xstockstrat-analysis/migrations/`); 150 reserves `017` (its `implementation-spec.md`
  Step 3 `017_backtest_runs_sizing`), so 151 takes `018` per the reserved split.
- `backtest_runs` is the summary table (migration `006`); feature 133 added a **nullable** attribution
  column via migration `015` (`BacktestRunsRepository` comment `backtest_runs.py:39` — "NULLABLE …
  migration 015 left the column nullable"). The additive-nullable pattern is the precedent.
- The column stores the effective enum **name** (mirrors `status`, stored as
  `BacktestStatus.Name(...)` at `servicer.py:1562`, read back via `BacktestStatus.Value(...)` at
  `servicer.py:3429`).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `018_backtest_runs_fill_model.up.sql` — one additive nullable column (legacy rows keep NULL):
   ```sql
   ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS fill_model TEXT;
   ```
2. `018_backtest_runs_fill_model.down.sql` — reverse exactly:
   ```sql
   ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS fill_model;
   ```
3. Never edit an applied migration (F-01) — this is a new numbered pair.
4. **Execute-time NNN check** (see § Step Dependencies): if 151 lands before 150, renumber to the
   next-free NNN (`017`) so golang-migrate never has to backfill a lower version behind a higher one.

**Verification** (offline, no DB):
```
ls services/xstockstrat-analysis/migrations/018_backtest_runs_fill_model.up.sql \
   services/xstockstrat-analysis/migrations/018_backtest_runs_fill_model.down.sql
```
Read both: the `.up` `ADD COLUMN` is inverted by the `.down` `DROP COLUMN` (one column, additive,
nullable).

---

### Step 4 — service: shared _apply_fill deferred state machine + fill_model routing + persist

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/backtest_runs.py` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify (config key row + Fill Model section)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, **no look-ahead bias**

**Codebase Evidence**:
- `RunBacktest` resolves commission/slippage once at entry via `get_float` (`servicer.py:383-384`) —
  the resolution site the effective `fill_model` mirrors.
- Config helper `get_int` zero-traps `0`→default (`app/config/watcher.py:95-101`); `get_int_present`
  exists for keys where `0` is meaningful (`:103-114`). For `default_fill_model`, `get_int` is
  **correct** — `0` (`UNSPECIFIED`) intentionally means legacy.
- Both simulators are called from the per-symbol loop: `_backtest_symbol_evaluated(...)`
  (`servicer.py:525-538`) and `_backtest_symbol(...)` (`:540-551`), both keyword-args.
- **SMA path `_backtest_symbol`** (`:845`): `price = bar.close` (`:967`); warm-up `continue` branches
  that append equity and skip (`:970-972`, `:979-981`); entry fill `fill_price = price*(1+slippage)`
  + size (`:1004-1015`); exit fill `price*(1-slippage)` (`:1017-1044`); the **single loop-writer**
  of the action `diags[i - trade_start_idx].action = bar_action` (`:1046`) and the **single append**
  `daily_equity.append(portfolio_value)` (`:1048`); default action set at `:998-1002`; forced close
  at last bar (`:1050-1075`, `last_bar.close*(1-slippage)`, `daily_equity[-1] = equity`, `diags[-1]`).
- **Evaluated path `_backtest_symbol_evaluated`** (`:1080`): `price = bar.close` (`:1175`);
  `decision = decisions[i]` (`:1176`); default action `:1177-1181`; entry incl. re-entry cooldown
  `is_cooldown_active(last_exit_time, bar.time, cooldown_days)` (`:1183-1198`); exit incl. exit
  cooldown against `entry_time` (`:1199-1232`), sets `last_exit_time = bar.time.ToDatetime(UTC)`
  (`:1231`); loop-writer `diags[i - trade_start_idx].action = bar_action` (`:1234`); single append
  `daily_equity.append(...)` (`:1235`); forced close (`:1237-1261`).
- Cooldown clocks key off `bar.time` at the fill site today (`:1187,1196,1203,1231`), so pinning
  cooldown to the **fill-bar** is a no-op rename in legacy mode.
- Alignment assert: `_finalize_symbol_diagnostics` asserts `n == len(daily_equity)`
  (`servicer.py:3291`), then stamps `diags[i].equity = daily_equity[i]` (`:3295-3296`).
- Result build (`servicer.py:631-646`), status gate (`:654-657`), persist call
  `_persist_backtest_run(result, list(request.symbols), score, range_start, range_end)` (`:702-708`).
- `_persist_backtest_run` inserts summary metrics via `self._backtest_runs_repo.insert(...)`
  (`servicer.py:1558-1577`); the repo `insert` signature + `INSERT` column list
  (`backtest_runs.py:25-68`); `list_by_strategy` does `SELECT *` (`:70-81`).
- Row→summary mapping `_row_to_backtest_summary` maps `status` via `BacktestStatus.Value(row.get(...))`
  (`servicer.py:3428-3446`) — the name→enum pattern `fill_model` reuses.
- Config declaration home: `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed
  (`analysis.backtest.*` rows) — C-05 requires the default declared here; no config seed migration
  exists for analysis keys (150's spec confirmed 001–016 are all schema).
- **§B header propagation: N/A** — no new outbound gRPC edge; both simulators already receive
  `propagation_meta`.
- **§B test data (C-13): N/A here** — this is a `service` step; fixtures/parity oracle land in Step 5.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **The invariant everything rests on (design.md § "The single thing /sdd-spec must not get
   wrong"):** the **loop remains the sole writer** of `diags[...].action` (`:1046` SMA / `:1234`
   evaluated) and the sole appender to `daily_equity` (`:1048`/`:1235`). `_apply_fill` **returns**
   the fill-bar upgrade action (`BAR_ACTION_ENTER_LONG`/`BAR_ACTION_EXIT_LONG`, or `None`) and
   mutates `SimState`; it **never touches `diags`**. Do not mutate `diags` inside `_apply_fill`.
2. Introduce an explicit `SimState` holding
   `equity / position / entry_price / entry_time / last_exit_time / trades` and a `pending` fill
   descriptor (`fill_idx`, side, and the signal-time inputs needed to size/close), plus one shared
   `_apply_fill(state, bars, fill_idx, mode, commission, slippage, ...) -> BarAction | None`
   **deferred-execution** state machine. Deferred, not price-swap: a signal detected on bar `i` sets
   `state.pending` with `fill_idx = i` (same-bar mode) or `fill_idx = i+1` (next-bar mode); the loop
   calls `_apply_fill` at the **top of iteration `fill_idx`**, filling at `bars[fill_idx].close`
   (same-bar) or `bars[fill_idx].open` (next-bar), each ± slippage with today's signs
   (`*(1+slippage)` buy, `*(1-slippage)` sell). Keep slippage symmetric with today's convention
   (design confirm: `open*(1±slippage)`).
3. Call `_apply_fill` from both `_backtest_symbol` and `_backtest_symbol_evaluated`, replacing the
   inline entry/exit blocks (`:1004-1044` SMA, `:1183-1232` evaluated). **Run `_apply_fill` BEFORE
   the SMA warm-up `continue` branches** (`:970-972,979-981`) so a pending fill from a prior bar is
   never skipped (design Open Risk — practically unreachable since a post-signal bar has resolved
   SMAs, but state it as an invariant in a comment). The loop applies the returned action over its
   default (`HOLD_LONG if position>0 else HOLD_FLAT`) at the existing stamp site, then appends
   `daily_equity` exactly once per iteration — unchanged count and site, so the `:3291` 1:1 assert
   stays trivially true.
4. **Last-bar rule (FR-2/AC-3):** a signal on bar `n-2` sets `fill_idx = n-1`, fills at
   `bars[n-1].open`, then is force-closed at `bars[n-1].close` by the existing forced-close block —
   the same single-bar round-trip legacy already produces (trade counts stay symmetric across modes).
   A signal on the **absolute last bar `n-1`** sets `fill_idx = n`; iteration `n` never runs, so
   `_apply_fill` is never called → the loop's default `HOLD_FLAT` stands, no `TradeRecord`, no equity
   step, **no reference to any bar outside the window**. Document the symmetric front edge (a bar-0
   signal never fills because iteration 0 doesn't run) — both mirror legacy's own bar-0 handling.
5. **Cooldown pinned to the fill-bar (design confirm):** move the cooldown gate into `_apply_fill`,
   reading `bars[fill_idx].time` against `state.entry_time`/`state.last_exit_time` (the fill-bar
   anchors). Byte-identical in same-bar mode (`signal==fill`). Preserve both the re-entry cooldown
   (`is_cooldown_active(last_exit_time, ..., cooldown_days)`, `:1186`) and the exit cooldown against
   `entry_time` (`:1202-1206`).
6. **Action/conviction decouple:** in next-bar mode the ENTER/EXIT lands on `diags[i+1]` while that
   row's `conviction` is bar `i+1`'s own value — leave conviction as the loop computes it per bar and
   add a code comment noting the decouple is display-only (grade math reads only
   sharpe/drawdown/win_rate via `_score_from_metrics`, `:3310-3336` — never conviction).
7. **Resolve the effective fill model once at `RunBacktest` entry** (beside `:383-384`):
   `effective_fill_model = request.fill_model if request.fill_model != FILL_MODEL_UNSPECIFIED else
   self._cfg.get_int("analysis.backtest.default_fill_model", 0)`, then normalize `UNSPECIFIED(0)` →
   `FILL_MODEL_SAME_BAR_CLOSE(1)`. Thread `effective_fill_model` into both simulator calls
   (`:525-538`, `:540-551`) and into `_persist_backtest_run`. Set `result.fill_model =
   effective_fill_model` on the built `BacktestResult` (`:631-646`) so the echoed value always equals
   what routed the sim (AC-5).
8. **Persist the effective model:** add a `fill_model: str | None = None` param to
   `BacktestRunsRepository.insert` (`backtest_runs.py:25-38`), add `fill_model` to the `INSERT`
   column list + `VALUES` placeholders (`:43-67`), and pass
   `fill_model=analysis_pb2.FillModel.Name(effective_fill_model)` from `_persist_backtest_run`
   (`servicer.py:1558-1577`). Map it back in `_row_to_backtest_summary` (`servicer.py:3428-3446`)
   via the `status` name→enum pattern: `analysis_pb2.FillModel.Value(row.get("fill_model") or "")`
   guarded by `try/except ValueError → FILL_MODEL_UNSPECIFIED`, set on the summary (AC-5 for the
   history/summary surface).
9. **Config declaration (C-05/F-07):** add an `analysis.backtest.default_fill_model` row to the
   § Config Keys Consumed table in `services/xstockstrat-analysis/CLAUDE.md` (int, default `0` =
   `FILL_MODEL_UNSPECIFIED` → legacy same-bar-close; note the `get_int` zero-trap is **intentional**
   here — both absent and configured `0` mean legacy, so a future reader must not "fix" it to
   `get_int_present`). Add a short "Backtest Fill Model (feature 151)" subsection documenting the
   opt-in next-bar-open mode, the last-bar rule, the fill-to-fill cooldown, and the display-only
   action/conviction decouple.

**Verification**: covered by Step 5.

---

### Step 5 — test: engine golden parity + next-bar behavior + alignment

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/` — add/modify backtest engine test module(s)
- `services/xstockstrat-analysis/tests/conftest.py` — modify (only if a `Bar`/`BarDiagnostic`
  fixture gains a **second** consumer — C-13; otherwise keep inline and say so)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, **no look-ahead bias**

**Codebase Evidence**:
- Coverage threshold **40%** for `xstockstrat-analysis` (spec-template § table; service CLAUDE.md
  § Running Tests: `pytest --cov=app --cov-fail-under=40`).
- Real-proto test discipline (design.md C-08/P-06): every `@AC` pairs a RED-first test using real
  `Bar`/`BarDiagnostic` protos (ledger fails.md:725). Bars carry `open`/`high`/`low`/`close`
  (`BarDiagnostic` proto `analysis.proto:142-160`; simulators read `bar.close`/`bar.open`).
- Golden anchors: legacy fills at `bar.close` (`servicer.py:967,1006,1019,1053`); the 1:1 assert
  (`servicer.py:3291`); grade blend reads only sharpe/drawdown/win_rate (`_score_from_metrics`
  `:3310-3336`).
- §B test data (C-13): domain `Bar`/`BarDiagnostic` literals stay inline while single-consumer;
  centralize into `tests/conftest.py` only on a **second** consumer, in this same step.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11`

**Instructions**:
1. **AC-4 golden parity (both simulators) — the mandated pre-refactor byte-for-byte guard.** Build
   fixed synthetic bar series that produce a known entry+exit in **both** paths (SMA
   `_backtest_symbol` and evaluated `_backtest_symbol_evaluated`, incl. a series that exercises the
   SMA warm-up `continue` branches, ledger-056). Assert an unset-`fill_model` run's `total_return`
   (and `trades[*].entry_price/exit_price`, `daily_equity`, `diags[*].action`) is **byte-for-byte**
   the legacy result. This assertion must be **green before and after** the Step 4 refactor (capture
   the oracle values from the pre-refactor tree; the extraction must not move a single byte in legacy
   mode). Also assert an explicit `FILL_MODEL_SAME_BAR_CLOSE` request equals the unset run.
2. **AC-1 (entry at next-bar open).** With `fill_model=FILL_MODEL_NEXT_BAR_OPEN`, a strategy whose
   entry becomes true on bar `i` fills `entry_price == bars[i+1].open * (1 + slippage)`, and **not**
   `bars[i].close * (1 + slippage)`. Cover both simulators.
3. **AC-2 (exit + vts stop at next-bar open).** An open position whose exit (and separately the `vts
   crosses_below 0` stop, evaluated path) becomes true on bar `i` fills `exit_price ==
   bars[i+1].open * (1 - slippage)`, not `bars[i].close * (1 - slippage)`.
4. **AC-3 (last-bar signal, no look-ahead).** An entry signal true on the **absolute last** bar
   `n-1` opens **no** position (no `TradeRecord`, no equity step) and references no price outside the
   window. Separately assert the `n-2` signal DOES fill at `bars[n-1].open` then force-closes at
   `bars[n-1].close` (cross-mode trade-count symmetry).
5. **AC-5 (model recorded + returned).** A next-bar run → `result.fill_model ==
   FILL_MODEL_NEXT_BAR_OPEN`; a legacy/unset run → `result.fill_model == FILL_MODEL_SAME_BAR_CLOSE`
   (never `UNSPECIFIED`). If the no-DB persist path is exercised, assert `_persist_backtest_run`
   passes `FillModel.Name(effective)` and `_row_to_backtest_summary` round-trips it onto
   `BacktestRunSummary.fill_model`.
6. **AC-6 (diagnostics aligned with the fill bar).** For a next-bar run opening from a bar-`i`
   signal, assert `diags[i+1].action == BAR_ACTION_ENTER_LONG` (ENTER on the **fill** bar) and
   `len(daily_equity) == len(diags)` (the `:3291` invariant holds).
7. **Design confirm-item assertions (no `@AC-*` tag — see § Note on acceptance coverage):**
   (a) cooldown is fill-to-fill: a re-entry blocked by cooldown keys off `bars[fill_idx].time`;
   (b) config zero-trap: `default_fill_model` absent AND configured `0` both → legacy byte-for-byte;
   a configured `2` with an unset request routes next-bar; a request value always overrides config;
   (c) action/conviction decouple: in next-bar mode `diags[i+1].action == ENTER_LONG` while
   `diags[i+1].conviction` is bar `i+1`'s own value (grade unchanged vs. the same run's cells).
8. **Red-before-green (P-06):** the AC-1/2/3/5/6 + confirm-item assertions fail against the
   pre-Step-4 tree; name each `@AC-*` id in the test. The AC-4 golden assertions are the regression
   guard (green before and after).

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```
Confirm ≥ 40% and every new assertion passes.

---

### Step 6 — service: agent run_backtest fill_model arg + summary surfacing

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/backtest_view.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify (run_backtest tool row / arg note)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) + `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `client.run_backtest(user_id, strategy_id, symbols, initial_capital, start, end)` builds
  `RunBacktestRequest(strategy_id, strategy_id_ref, symbols, initial_capital)` (`client.py:534-543`),
  threads a one-sided `range` (`:544-551`), forwards `x-user-id` (`:555`), returns
  `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`
  (`:561-565`) — so a new proto field arrives in the dict as `fill_model` automatically.
- Tool wrapper `run_backtest(ctx, strategy_id, symbols, initial_capital=100000.0, start=None,
  end=None)` (`tools.py:456-462`), calls `client.run_backtest(...)` (`:500-507`), summarizes via
  `backtest_view.summarize(result)` (`:512`).
- Presentation split: `_HEAD_KEYS` (`backtest_view.py:35`), `_METRIC_KEYS` (`:38-47`),
  `_INTENTIONALLY_DROPPED = frozenset({"trades"})` (`:33`), `summarize()` (`:54-82`).
- Agent already forwards the propagation trio on every outbound gRPC (agent CLAUDE.md § edge) — the
  `fill_model` arg reuses the existing `client.run_backtest` call; **§B header propagation: N/A**
  (no new edge).
- Tool count is documented as "twenty-eight tools" (agent CLAUDE.md § MCP Tools) — this change adds
  an **arg**, not a tool; the count stays 28.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `client.run_backtest`: add an optional `fill_model: str | None = None` param; map to the proto
   enum (`"next_bar_open"` → `FillModel.FILL_MODEL_NEXT_BAR_OPEN`;
   `"same_bar_close"`/`"legacy"`/None → leave `req.fill_model` unset so the server defaults to
   legacy). Set `req.fill_model` only when a non-None value is given. Keep the return `MessageToDict`
   unchanged (the new field flows through as `fill_model`).
2. `tools.py run_backtest`: add an optional `fill_model: str | None = None` arg; document
   `"next_bar_open"` opts into bias-free next-bar-open fills (the standard convention), default/omitted
   = legacy same-bar-close (an optimistically-biased fill). Thread it to `client.run_backtest`. Note
   the display-only action/conviction decouple in the docstring so a caller reading diagnostics is not
   surprised.
3. `backtest_view.py`: add `"fill_model"` to `_HEAD_KEYS` (`:35`) so the effective model always
   reaches the caller in the compact block (even with no attachment). Confirm the descriptor-parity
   guard still balances — if `test_backtest_view.py`'s `kept | _INTENTIONALLY_DROPPED ==
   fields_by_name` assertion exists, `fill_model` must be accounted for on the `kept` side (Step 7).
4. Update the `run_backtest` row in `services/xstockstrat-agent/CLAUDE.md` § MCP Tools and the tool
   docstring to name the `fill_model` arg and that the summary reports the effective model. Leave the
   tool count ("twenty-eight") unchanged.

**Verification**: covered by Step 7.

---

### Step 7 — test: agent run_backtest fill_model + summary

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_backtest_view.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability + `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Agent coverage threshold **40%** (spec-template § table; agent CLAUDE.md § Running Tests).
- `test_backtest_view.py` holds the descriptor-parity guard + summary field assertions;
  `test_client.py` holds request-builder tests; `test_tools.py` holds tool-level tests (referenced by
  150's spec Step 10 `test_backtest_view.py:157-173`, `:96`).
- §B test data (C-13): agent tests use inline proto literals; keep inline unless a **second**
  consumer forces `conftest.py` centralization (say which).

**TDD**: `red-green required`

**Covers**: `AC-5` (the agent consumer surface reports the effective fill model)

**Instructions**:
1. `test_client.py`: assert `client.run_backtest(..., fill_model="next_bar_open")` sets
   `req.fill_model == FILL_MODEL_NEXT_BAR_OPEN`, and that omitting it (or `"same_bar_close"`/`None`)
   leaves the field unset/legacy.
2. `test_tools.py`: assert the tool passes `fill_model` through to `client.run_backtest` and that the
   inline summary carries `fill_model` for a next-bar result.
3. `test_backtest_view.py`: assert `summarize(result)` includes `fill_model` in the compact block;
   if the descriptor-parity assertion exists, update its `kept` expectation for the new
   `BacktestResult.fill_model` field so it stays balanced.
4. Red-before-green (P-06) for each new assertion.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```
Confirm ≥ 40% and the new assertions pass.

---

### Step 8 — docs: strat-lab backtest skill (same PR as Step 6)

**Status**: `done`
**Service**: `plugins/strat-lab`
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/verification.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- Root CLAUDE.md § strat-lab plugin: a change to `run_backtest` MUST update the `strat-lab`
  `backtest` skill in the **same PR**.
- The skill's Scope lists the MCP tools it drives incl. `run_backtest` (`SKILL.md:15`); Phase 2 is
  "Run, and handle the oversized output" (`SKILL.md:86`); Phase 3 is basket aggregation
  (`SKILL.md:94-100`). `verification.md:24` pulls the real per-bar `close` as an oracle — the exact
  place the same-bar-vs-next-bar fill distinction matters.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In `SKILL.md` (Phase 2 or a new short "Fill model" note), document the `run_backtest(...,
   fill_model="next_bar_open")` option: legacy same-bar-close (the default) fills at the signal
   bar's own close and is optimistically biased (a mild look-ahead); `"next_bar_open"` fills a
   bar-`i` signal at bar `(i+1)`'s open, the standard bias-free convention. State that a next-bar run
   is **not** directly comparable to a legacy run (label which mode a report used).
2. Add the display-only **action/conviction decouple** caveat: in next-bar mode a diagnostics row can
   show an ENTER/EXIT on a bar whose `conviction` reads hold, because the action lands on the fill
   bar while conviction stays that bar's own value — the grade is unaffected (grade math ignores
   conviction).
3. In `reference/verification.md`, note that an offline oracle must fill at `bars[i+1].open` when
   verifying a `next_bar_open` run (the `close`-based oracle at `:24` is the same-bar-close case).

**Verification**:
```
grep -n "next_bar_open" plugins/strat-lab/skills/backtest/SKILL.md \
  plugins/strat-lab/skills/backtest/reference/verification.md
```
Both files mention `next_bar_open`.

---

### Step 9 — service: UI fill-model label + Past Runs column + exhaustive enum map

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` — modify (add the
  exhaustive `Record<FillModel, …>` — ledger 067)
- `services/xstockstrat-ui/e2e/fixtures/backtests.ts` — modify (add a `fillModel` to the backtest
  fixture(s))

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, enum→TS exhaustive-map coupling (ledger 067)

**Codebase Evidence**:
- Results surface renders `result.*` metrics via `MetricCard` (`page.tsx:508-538`, guarded by
  `result.status !== BacktestStatus.INSUFFICIENT_DATA`); `Badge` is imported (`page.tsx:8`);
  `BacktestStatus` from `@xstockstrat/proto/analysis/v1/analysis_pb` (`page.tsx:20`).
- Past Runs table renders `BacktestRun` rows via `pastRunsColumns` (`page.tsx:124`, table `:560-564`).
- Exhaustive-`Record` precedent (ledger 067): `ACTION_LABEL: Record<BarAction,string>` and
  `NO_TRADE_MESSAGE: Record<NoTradeReason,string>` (`BacktestDiagnostics.tsx:10-28`), importing the
  enums from `@xstockstrat/proto/analysis/v1/analysis_pb` (`:8`). A shared enum-render home also
  exists at `src/lib/opportunityShared.tsx` (UI CLAUDE.md § Enum render maps).
- BFF forwards `runBacktest`/`getBacktest`/`listBacktests` unchanged (UI CLAUDE.md § Auth+BFF;
  `src/lib/insightsBff.ts`) — the full message flows to the typed browser client; **no BFF change**.
- Backtest fixture home: `e2e/fixtures/backtests.ts` (`backtestId: 'bt-e2e-1'`, `:52`) + its
  `INVENTORY.md` catalog (C-12).
- §B test data (C-12): the fixture change lands with an `INVENTORY.md` row update.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add an **exhaustive** `FILL_MODEL_LABEL: Record<FillModel, string>` beside the existing enum maps
   in `BacktestDiagnostics.tsx` (or `src/lib/opportunityShared.tsx`): `UNSPECIFIED` → "—"/"Legacy",
   `SAME_BAR_CLOSE` → "Same-bar close", `NEXT_BAR_OPEN` → "Next-bar open". Net-new, so it does not
   break `tsc` on regeneration — but it MUST be exhaustive so a future enum value fails `tsc` here
   (ledger 067).
2. On the results surface (`page.tsx:508-538`), render a fill-model `Badge`/`MetricCard` from
   `result.fillModel` via `FILL_MODEL_LABEL`, so a next-bar-open run is never silently compared
   against a legacy same-bar-close one (product-spec C-14 comparability guard).
3. Add a "Fill model" column to `pastRunsColumns` (`page.tsx:124`) reading `run.fillModel` via
   `FILL_MODEL_LABEL`, so cross-mode history rows are visibly distinguished.
4. Update `e2e/fixtures/backtests.ts` (+ `INVENTORY.md`) so the fixture carries a `fillModel` for the
   Step 10 assertion.

**Verification**: covered by Step 10 (plus `cd services/xstockstrat-ui && pnpm run lint`).

---

### Step 10 — test: UI fill-model label e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/` — add/modify a backtest-result spec
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (return `fillModel` on the mocked
  `RunBacktest`/`ListBacktests` response) if not already fixture-driven

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, enum→TS exhaustive-map coupling (ledger 067)

**Codebase Evidence**:
- `xstockstrat-ui` has **no unit coverage threshold** for e2e (spec-template § table: use
  `pnmp test:e2e`; UI CLAUDE.md § Testing — Playwright, `e2e/insights/`).
- Existing insights specs: `e2e/insights/backtest-coverage.spec.ts`,
  `strategy-authoring.spec.ts` (`ls e2e/insights/`).
- §B test data (C-12): the spec imports the backtest fixture from `e2e/fixtures/`
  (`e2e/fixtures/backtests.ts`) and auth from `e2e/helpers/auth.ts` — no inline domain literals.

**TDD**: `red-green required`

**Covers**: `AC-5` (the UI consumer surface labels the effective fill model)

**Instructions**:
1. Add/extend an `e2e/insights` spec asserting the strategy-detail results surface renders the
   fill-model label ("Next-bar open" for a `FILL_MODEL_NEXT_BAR_OPEN` result; "Same-bar close" /
   "Legacy" for a legacy result) and that the Past Runs table shows the "Fill model" column.
2. Ensure the mock backend returns a `fillModel` on the backtest result/summary (from the fixture),
   so the label has a value to render.
3. Import the fixture from `e2e/fixtures/backtests.ts` and auth helpers from `e2e/helpers/auth.ts`
   (C-12) — no inline domain literals.
4. Red-before-green (P-06): the assertion fails before Step 9's label/column land.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- insights
```
The fill-model label + Past Runs "Fill model" column render; lint passes.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
