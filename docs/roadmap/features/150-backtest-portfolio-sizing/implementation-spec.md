# Implementation Spec: backtest-portfolio-sizing

**Status**: `pending`
**Created**: 2026-08-23
**Feature**: `docs/roadmap/features/150-backtest-portfolio-sizing/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/backtest-portfolio-sizing`

---

## Execution Summary

Add an **opt-in, versioned portfolio sizing model** to the `xstockstrat-analysis` backtest engine,
selected by a single new proto field `RunBacktestRequest.sizing_mode` (`SizingMode` enum,
`SIZING_MODE_UNSPECIFIED=0` → the legacy serial-compounding path). The build order is
proto → codegen → migration → config-declaration → engine (in two service/test pairs) →
consumer surfaces (agent, strat-lab skill, UI). The legacy per-symbol serial loop
(`servicer.py:522-572`) and the per-symbol evidence cells (`servicer.py:558`) run **unchanged in
both modes**, so the feature-065 derived grade stays byte-for-byte identical (FR-4/AC-5) — the
grade guarantee is free because cell metrics are computed relative to each symbol's own
`daily_eq[0]` (scale-invariant, order-independent). Portfolio mode is strictly additive behind the
enum default.

The engine work is split into two service/test pairs so the load-bearing invariant — the legacy
default path must stay **byte-for-byte identical** (BacktestResult bytes are persisted verbatim,
feature 068, `analysis.proto:80-83`) — is guarded by a RED test before any routing change:
Step 5/6 add the additive per-bar intent return + the pure `_simulate_portfolio` helper (not yet
routed) and test them in isolation; Step 7/8 route `RunBacktest` by `sizing_mode` and prove the
legacy default is unchanged end-to-end.

**Consumer surfaces (C-14).** Both surfaces named in the product spec earn steps: the Agent
`run_backtest` tool gains a `sizing_mode` arg and surfaces the mode + capital-skip count
(Steps 9/10), and its `strat-lab` `backtest` skill is updated **in the same PR** (Step 11, per root
CLAUDE.md § strat-lab plugin). The UI `/insights` strategy-detail page labels the mode and plots the
portfolio equity curve (Steps 12/13).

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` (portfolio aggregate, order-independent, not the serial parlay) | Step 6 (unit: order-independence over a mid-series-gap fixture) |
| `@AC-2` (concurrent positions share one pool; per-bar equity = cash + Σ MTM) | Step 6 (unit: shared-pool + per-bar equity) |
| `@AC-3` (legacy default unchanged, byte-for-byte) | Step 6 (legacy simulator return unchanged) + **Step 8** (RunBacktest legacy default byte-for-byte, primary) |
| `@AC-4` (sizing mode recorded on run + returned) | Step 8 (persisted + returned mode) |
| `@AC-5` (derived grade unchanged by portfolio mode) | Step 8 (grade parity) |
| `@AC-6` (insufficient capital skips an entry, recorded as a PortfolioCapitalSkip; lower trade count) | Step 6 (capital-skip record) |
| `@AC-7` (portfolio mode honors the strategy's cooldown windows against portfolio-local times — FR-6) | Step 6 (cooldown-parity unit) |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Steps 4–13 require Step 2: they reference generated symbols (`SizingMode`, new fields/messages).
- Step 3 (migration 017) is independent of the proto steps but must land before Step 7 (the engine
  writes the new columns) — declare it early.
- Step 6 (test) covers Step 5 (service). Step 8 (test) covers Step 7 (service).
- Step 7 requires Step 5 (routes into the `_simulate_portfolio` helper Step 5 adds) and Step 3
  (writes the migration-017 columns) and Step 4 (reads the declared config keys).
- Step 10 (test) covers Step 9 (service). Step 11 (docs) rides Step 9's PR (root CLAUDE.md § strat-lab).
- Step 13 (test) covers Step 12 (service).
- **Cross-feature (merge-order.md 150↔151 row):** field/migration numbers below were re-derived from
  the merged `main-dev` tree at spec time and honor the reserved split — 150 owns
  `RunBacktestRequest.sizing_mode=8`, `BacktestResult` 17/18/19, `BacktestRunSummary.sizing_mode=17`,
  migration `017`. If 151 lands first, re-run `/sdd-spec` and take the next-free numbers.

---

### Step 1 — proto: add SizingMode enum + additive fields for portfolio sizing

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field-number uniqueness + no breaking change; xstockstrat-analysis owner — backtest reproducibility; xstockstrat-agent owner — MCP contract stability; xstockstrat-ui owner — enum→TS exhaustive-map coupling (ledger 067)

**Codebase Evidence**:
- `RunBacktestRequest` occupies fields 1–7 (`analysis.proto:52-62`) → **next free = 8**.
- `BacktestResult` occupies fields 1–16 (`analysis.proto:84-107`) → **next free = 17**; the message
  carries the explicit renumber warning `analysis.proto:80-83` ("wire bytes persisted verbatim …
  additive changes only").
- `BacktestRunSummary` occupies fields 1–16 (`analysis.proto:203-221`) → **next free = 17**.
- Existing enum shape to mirror: `BacktestStatus` (`analysis.proto:64-68`) — a top-level enum with a
  `*_UNSPECIFIED = 0` sentinel (C-04).
- Existing `NoTradeReason.NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3` (`analysis.proto:137`) is marked
  "reserved; not emitted this version" — this feature does **not** repurpose it (per-symbol
  diagnostics stay per-symbol); portfolio capital skips get their own `capital_skips` message so the
  skip carries symbol/timestamp/weight/available-cash context the enum cannot.

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Add a top-level enum after `BacktestStatus` (`analysis.proto:68`), mirroring its shape (C-04):
   ```proto
   // Backtest capital-allocation model (feature 150). Closed set → enum (C-04).
   enum SizingMode {
     SIZING_MODE_UNSPECIFIED = 0;  // request default → the legacy serial per-symbol path
     SIZING_MODE_LEGACY = 1;       // serial per-symbol compounding (the aggregate is Π(1+rᵢ)−1)
     SIZING_MODE_PORTFOLIO = 2;    // one shared cash pool, concurrent positions, one equity curve
   }
   ```
   Contract to state in the comment: a completed run records `SIZING_MODE_LEGACY` or
   `SIZING_MODE_PORTFOLIO` (never `UNSPECIFIED`); `UNSPECIFIED` is a request-side "unset → legacy"
   default only.
2. Add to `RunBacktestRequest` (after field 7, `analysis.proto:61`):
   `SizingMode sizing_mode = 8;` with a comment: unset/`UNSPECIFIED` → legacy (no behavior change for
   existing callers).
3. Add two new messages (near `BacktestResult`, additive):
   ```proto
   // One entry that portfolio mode could not open because the shared pool was fully committed
   // at the policy weight (feature 150, FR-5). Emitted instead of a silent zero-sized fill.
   message PortfolioCapitalSkip {
     string symbol = 1;
     google.protobuf.Timestamp timestamp = 2;
     double intended_weight = 3;   // position_weight × initial_capital the entry would have needed
     double available_cash = 4;    // cash on hand in the shared pool at that bar
   }
   // One point of the portfolio-level daily equity curve (cash + Σ marked-to-market positions).
   message EquityPoint {
     google.protobuf.Timestamp timestamp = 1;
     double equity = 2;
   }
   ```
4. Add to `BacktestResult` (after field 16, `analysis.proto:106`):
   ```proto
   SizingMode sizing_mode = 17;                          // the mode actually used (feature 150)
   repeated PortfolioCapitalSkip capital_skips = 18;     // portfolio mode only; empty in legacy
   repeated EquityPoint portfolio_equity_curve = 19;     // portfolio mode only; empty in legacy
   ```
5. Add to `BacktestRunSummary` (after field 16, `analysis.proto:220`):
   `SizingMode sizing_mode = 17;`
6. Do **not** renumber or retype any existing field (F-01-adjacent; the verbatim-bytes warning).

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev"
```
Both must pass (additive-only; `buf breaking` green — C-09). The baseline is **`main-dev`** (the
merge target) so the check proves the change is additive against trunk, not merely against the last
feature-branch commit. At execute time, diff against the current merge base if `main-dev` has moved.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/ts/**` — modify (generated; TS package recompiled)

**Reviewers**: Proto Reviewer — field-number uniqueness + no breaking change; xstockstrat-analysis owner; xstockstrat-agent owner; xstockstrat-ui owner (inherited from Step 1)

**Codebase Evidence**:
- `./scripts/buf-gen.sh` generates TS, Python, Go stubs and compiles the TS package
  (root CLAUDE.md § Generating Proto Stubs); the CI `proto-freshness` job enforces an empty diff.

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root (or provision the host toolchain per
   `docs/runbooks/codegen-toolchain-host-setup.md` if Docker/GitHub-releases egress is blocked).
2. Stage the regenerated `packages/proto/gen/**`. Do not hand-edit generated files.

**Verification**:
```
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen
```
The only diff must be the new `SizingMode` enum, the two new messages, and the four new fields
(re-run leaves no further diff — the freshness invariant). Never Read/Grep the generated stubs to
verify — trust the empty-rerun-diff (root CLAUDE.md § Key File Paths).

---

### Step 3 — migration: 017 sizing columns on analysis.backtest_runs

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/017_backtest_runs_sizing.up.sql` — create
- `services/xstockstrat-analysis/migrations/017_backtest_runs_sizing.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, additive-only; xstockstrat-analysis owner — backtest reproducibility

**Codebase Evidence**:
- Last migration on disk is `016_order_snapshots_pnl_patterns` (`ls services/xstockstrat-analysis/migrations/`)
  → **next NNN = 017** (C-07).
- ALTER-add pattern to mirror: `015_backtest_runs_user_id.up.sql:7`
  (`ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS user_id TEXT;`) — nullable add, no
  PK change (PK is `backtest_id`, `006_backtest_runs.up.sql:6`).
- Column set matches the resolved sizing params the run records (design § footprint): `sizing_mode`,
  `position_weight`, `max_concurrent`.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `017_backtest_runs_sizing.up.sql` — three additive nullable columns (legacy rows keep NULL):
   ```sql
   -- Feature 150: record the sizing model + resolved allocation params each run used, so a run is
   -- reproducible despite WatchConfig drift. All NULLABLE: pre-150 rows legitimately have no value.
   ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS sizing_mode TEXT;
   ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS position_weight DOUBLE PRECISION;
   ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS max_concurrent INTEGER;
   ```
2. `017_backtest_runs_sizing.down.sql` — reverse exactly:
   ```sql
   ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS max_concurrent;
   ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS position_weight;
   ALTER TABLE analysis.backtest_runs DROP COLUMN IF EXISTS sizing_mode;
   ```
3. Never edit an applied migration (F-01) — this is a new numbered pair.

**Verification** (offline, no DB — never bring up a database):
```
ls services/xstockstrat-analysis/migrations/017_backtest_runs_sizing.up.sql \
   services/xstockstrat-analysis/migrations/017_backtest_runs_sizing.down.sql
```
Then read both: confirm each `ADD COLUMN` in `.up.sql` has a matching `DROP COLUMN IF EXISTS` in
`.down.sql`. The real apply/rollback runs in CI/deploy against the managed DB, not here.

---

### Step 4 — config: declare the two portfolio sizing keys

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (§ Config Keys Consumed table)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)

**Reviewers**: xstockstrat-analysis owner — config key naming (`<service>.<category>.<key>`), defaults declared in service CLAUDE.md

**Codebase Evidence**:
- Existing `analysis.backtest.*` keys are consumed with **in-code defaults** via
  `get_float`/`get_int`, declared only in the CLAUDE.md § Config Keys Consumed table (e.g.
  `analysis.backtest.default_commission_pct` read at `servicer.py:383`, declared in
  `services/xstockstrat-analysis/CLAUDE.md`). No config seed migration exists for analysis keys — the
  config service serves whatever an operator `SetConfig`s and unset keys fall through to the code
  default. The two new keys follow the same pattern (no `services/xstockstrat-config/migrations/`
  change required — verified: analysis migrations 001–016 are all schema, none seed config).
- Zero-trap discipline (`app/config/watcher.py:95-143`): `get_int`/`get_float` zero-trap (a stored
  `0` reads back as the default); `get_int_present`/`get_float_present` use `HasField`. Both new keys
  intentionally want the **zero-trap** helper — a configured `0` is meaningless (disables the
  portfolio) so remapping to the default is the desired guard (design § Sizing parameters).

**TDD**: `N/A (config)`

**Covers**: —

**Instructions**:
1. Add two rows to the § Config Keys Consumed table in `services/xstockstrat-analysis/CLAUDE.md`
   (namespace `analysis`):
   | Key | Type | Default | Description |
   |---|---|---|---|
   | `analysis.backtest.portfolio_position_weight` | float | `0.10` | Fraction of **initial** capital committed per concurrent position in portfolio mode (feature 150). Read via `get_float` (zero-trap intended: a configured `0` disables the portfolio → default 0.10). Fixed fraction of initial capital, not live equity, so aggregates stay order-independent. |
   | `analysis.backtest.portfolio_max_concurrent` | int | `9` | Max concurrently-held positions in portfolio mode (feature 150). Read via `get_int` (zero-trap intended). At the 0.10 weight this leaves a ≥10% cash buffer. |
2. Append a Per-Feature Registered Keys entry for feature 150 in `docs/patterns/config-governance.md`
   listing both keys, their types, defaults, and that they are code-default (no seed row).
3. State in both places that a configured `0` is a no-op (zero-trap → default), matching the existing
   `analysis.scoring.shrinkage_days` precedent.

**Verification**:
```
grep -n "analysis.backtest.portfolio_position_weight\|analysis.backtest.portfolio_max_concurrent" \
  services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
```
Both keys present in both files.

---

### Step 5 — service: additive per-bar intent return + `_simulate_portfolio` helper

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias, scoring determinism

**Codebase Evidence**:
- `_backtest_symbol` (SMA) computes per-bar intent **before** the position/capital gate: the signal
  mapping `combined = tech_signal * 0.5 + 0.5` (`servicer.py:995`), entry test `combined >= buy_threshold`
  (`servicer.py:1004`), exit test `combined <= sell_threshold` (`servicer.py:1017`). Returns
  `(trades, equity, daily_equity, symbol_diag)` (`servicer.py:1078`).
- `_backtest_symbol_evaluated` computes intent from the evaluator: `decision.entry` (`servicer.py:1185`),
  `decision.exit` (`servicer.py:1201`), `decisions[i].conviction` (`servicer.py:1140`). Returns the
  same 4-tuple (`servicer.py:1264`).
- Both loop over in-window bars `for i in range(max(1, trade_start_idx), n)` with `bar = bars[i]`,
  `price = bar.close`, `bar.time` (`servicer.py:965`, `:1173-1175`).
- Shared cooldown gate to reuse: `effective_cooldown_days` + `is_cooldown_active`
  (`app/services/cooldown.py:24-33,42-63`) — pure functions, tz-aware-UTC invariant enforced inside
  (`_require_aware`, `cooldown.py:36-39`). The serial path anchors re-entry on last-exit and exit on
  last-entry (`servicer.py:1160-1171,1187,1203`).
- No shared time index across symbols exists today: each symbol is fetched independently via
  `_resolve_prefixed_bars`→`_fetch_bars_paged` (`servicer.py:805,749`). The portfolio path builds one.
- Metrics reuse target: `_compute_metrics(daily_equity, trades, initial_equity, period_years)`
  (`servicer.py:3617`) — the portfolio path feeds it the portfolio curve (do not fork it, DRY;
  insights.md 2026-07-09).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Additive intent return (both simulators).** Extend each simulator to also build and return a
   per-in-window-bar intent list, as a new **5th** tuple element — never change the existing 4
   elements or the legacy control flow (the byte-for-byte invariant). Each intent item is a small
   dataclass/namedtuple `BarIntent(timestamp, close, entry_intent: bool, exit_intent: bool, conviction: float)`:
   - In `_backtest_symbol`, compute intent from the same `combined` already computed at
     `servicer.py:995`: `entry_intent = combined >= buy_threshold`, `exit_intent = combined <= sell_threshold`,
     `conviction = combined`, `timestamp = bar.time`, `close = price`. Warm-up bars (where a SMA is
     unavailable, `servicer.py:970,979`) yield an intent with `entry_intent=False, exit_intent=False`.
   - In `_backtest_symbol_evaluated`, compute intent from `decision.entry` / `decision.exit` /
     `decision.conviction` (`servicer.py:1176,1185,1201,1140`).
   - The intent is computed **independent of position/cooldown/capital** — it is signal intent, not
     realized execution (design § Rejected Alternatives: the `BarDiagnostic.action` stream is the
     wrong source because a capital-skipped entry has no action to replay).
   - Update both `return` statements (`servicer.py:1078,1264`) to append the intent list. Update the
     two call sites in `RunBacktest` (`servicer.py:525,540`) to unpack the 5th value (bind it to a
     local, e.g. `sym_intent`; it is only consumed by the portfolio path added in Step 7 — in Step 5
     the legacy path simply ignores it, keeping legacy output identical).
2. **`_simulate_portfolio(...)` (new method).** Add a dedicated coroutine that takes the per-symbol
   intent lists (from step 1), `initial_capital`, `position_weight`, `max_concurrent`, `commission`,
   `slippage`, and per-symbol `cooldown_days`/`exit_cooldown_days`, and returns
   `(portfolio_equity_curve: list[EquityPoint], capital_skips: list[PortfolioCapitalSkip], portfolio_trades: list[TradeRecord])`:
   - **Shared calendar:** union of all symbols' intent timestamps, ascending. Per symbol keep a
     `timestamp → close` map; on a date where a symbol has no bar, mark to market at its
     **last-known** close using **only on-or-before-today** closes (forward-fill; provably past-only,
     no look-ahead). A terminal bar freezes the price (never a synthetic sell).
   - **Shared pool:** seed `cash = initial_capital`; hold a `positions` dict (concurrent holdings).
     Per union date, ascending: process **exits first** (free cash), then entry-intent symbols not
     held, ordered by **symbol ASC** (deterministic tiebreak; documented-arbitrary given binary
     conviction — design § Rejected Alternatives), opening each while `len(positions) < max_concurrent`
     **and** `cash >= position_weight * initial_capital`; else append a `PortfolioCapitalSkip`
     (symbol, this bar's timestamp, `intended_weight = position_weight * initial_capital`,
     `available_cash = cash`) and open nothing (FR-5/AC-6 — never a zero-sized fill).
   - **Cooldown parity (FR-6):** reuse `effective_cooldown_days` + `is_cooldown_active`
     (`cooldown.py`) against **portfolio-local** ephemeral `dict[symbol → last_exit_time]` /
     `dict[symbol → entry_time]` (mirroring the serial locals but keyed by symbol since many are held
     concurrently; never touches `analysis.strategy_cooldowns`). Gate order: cooldown first, capital
     second; mutate anchors only on an actual fill.
   - **Per-bar equity:** after processing each union date, append an `EquityPoint(timestamp, equity)`
     where `equity = cash + Σ (shares × marked-to-market close)` over open positions (AC-2).
   - **Terminal policy:** on the final union date, force-close every open position at its last-known
     close (realized semantics, matching the serial forced-close `servicer.py:1051-1073,1238-1261`),
     recording a `TradeRecord` per close.
   - Keep this method pure of new gRPC/DB calls — it consumes intent already returned in-process; it
     adds **no new outbound edge** and reuses the bars the simulators already fetched (§B header
     propagation: N/A — no new outbound gRPC call; feature 141's `max_concurrent_bars_fetches`
     hazard is avoided because there is no second `GetBars`).
   - Document as inline caveats (design Open Risks): forward-filling a halted/missing symbol holds
     equity flat then jumps (understates mid-gap `max_drawdown` — a v1 caveat, legacy-realized parity
     chosen over gap fidelity); the symbol-ASC tiebreak is a systematic bias, not neutral.
3. Do not wire `_simulate_portfolio` into `RunBacktest` yet — that is Step 7. In Step 5 it is exercised
   only by the Step 6 unit tests.

**Verification**: covered by Step 6 (paired test) — includes the ruff lint gate. Also confirm the
legacy call sites still unpack correctly:
```
cd services/xstockstrat-analysis && ruff check app/handlers/servicer.py && ruff format --check app/handlers/servicer.py
```

---

### Step 6 — test: intent return + `_simulate_portfolio` (AC-1, AC-2, AC-6, legacy-unchanged)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (or a new
  `tests/test_portfolio_sizing.py` — create)
- `services/xstockstrat-analysis/tests/conftest.py` — modify only if a second consumer of a new
  domain literal appears (C-13; see Instructions)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias

**Codebase Evidence**:
- Existing analysis test harness + fixtures live in `services/xstockstrat-analysis/tests/conftest.py`
  and `test_analysis_servicer.py` (the servicer's canonical suite; `_canonical` determinism helper
  precedent, insights.md 2026-07-27).
- Coverage threshold for `xstockstrat-analysis` is **40%** (spec-template § coverage table).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-6, AC-7, AC-3` (the legacy-simulator-return-unchanged half of AC-3)

**Instructions**:
1. **Look-ahead RED (design Open Risk — the most dangerous bug):** the AC-1/AC-2 fixtures MUST use a
   **mid-series gap** (a symbol missing a bar on a date other symbols have), not merely ragged
   start/end dates — otherwise the forward-fill look-ahead ships green. Assert the marked-to-market
   value on a gap date uses the symbol's **last on-or-before** close, never a future close.
2. **AC-1 (order-independence, not the parlay):** run `_simulate_portfolio` over 3 symbols'
   intent, then again with the symbol list reversed; assert both aggregate `total_return`
   (via `_compute_metrics` over the returned portfolio curve) are equal within `1e-9`, and assert it
   is **not** the serial parlay `Π(1+rᵢ)−1` of the per-symbol returns (compute the parlay explicitly
   and assert inequality on a fixture where they genuinely differ).
3. **AC-2 (shared pool + per-bar equity):** two symbols both signaling entry on the same bar — assert
   combined committed capital never exceeds the pool, and that each `EquityPoint.equity` equals
   `cash + Σ marked-to-market` (recompute independently in the test).
4. **AC-6 (capital skip):** a fixture where the pool is fully committed to concurrent holdings when
   another symbol signals entry — assert **no** position opens for it that bar, a
   `PortfolioCapitalSkip` is recorded with the symbol + reason context (not a zero-sized fill), and
   the run's total trade count is strictly lower than the same fixture run with `portfolio_max_concurrent`
   raised so nothing is skipped.
4b. **AC-7 (cooldown parity, FR-6):** a fixture where a symbol exits and re-signals entry inside its
   31-day re-entry cooldown — assert `_simulate_portfolio` opens **no** re-entry inside the window and
   that the gate reads the portfolio's own per-symbol exit/entry times (ephemeral locals), never
   `analysis.strategy_cooldowns` (assert no read of that table).
5. **AC-3 (legacy simulators unchanged):** assert `_backtest_symbol` and `_backtest_symbol_evaluated`
   still return their original 4 values identically (the 5th intent element is additive) — capture a
   fixture run's `trades`/`equity`/`daily_equity`/`diagnostics` and assert unchanged vs a pre-change
   golden (the end-to-end byte-for-byte guard is Step 8).
6. **Red-before-green (P-06):** each assertion must fail against the pre-Step-5 tree (the intent
   return and `_simulate_portfolio` do not exist yet). Name the `@AC-*` id in each test's docstring.
7. **C-13:** any domain literal (a synthetic bar/intent series) reused by a **second** test moves to
   `conftest.py`; a single-consumer literal stays inline — record which verdict applies.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```
All new tests pass; coverage ≥ 40%.

---

### Step 7 — service: route RunBacktest by sizing_mode; populate result + persist

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/backtest_runs.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `RunBacktest` seed + serial loop + aggregate-metrics site: seed `equity`/`daily_equity`
  (`servicer.py:501-503`), per-symbol serial threading (`servicer.py:522-551`, one running `equity`
  threaded symbol→symbol), per-symbol curve concatenation (`servicer.py:571`), evidence-cell buffer
  (`servicer.py:557-569`), aggregate `_compute_metrics(daily_equity, all_trades, initial_equity, _period_years)`
  (`servicer.py:626`), `BacktestResult(...)` construction (`servicer.py:631-646`), status gate
  (`servicer.py:654-657`).
- Persist call: `_persist_backtest_run(result, list(request.symbols), score, range_start, range_end)`
  (`servicer.py:702-708`) → `BacktestRunsRepository.insert(...)` (`backtest_runs.py:25-68`, INSERT
  column list `:43-47`).
- Summary projection: `_row_to_backtest_summary(row)` (`servicer.py:3422-3452`) maps a
  `backtest_runs` row to `BacktestRunSummary`, mirroring the `status` name→enum pattern
  (`servicer.py:3428-3431`) — the model for `sizing_mode`.
- Config helpers already used in this handler: `self._cfg.get_float(...)` / `self._cfg.get_int(...)`
  (`servicer.py:383,477`), zero-trap helpers `app/config/watcher.py:95-130`.
- Per-symbol evidence cells (`servicer.py:557-569`) and `_score_from_metrics` (`servicer.py:3310`)
  are the derived grade's inputs — leave them **untouched in both modes** (FR-4/AC-5).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Resolve the requested mode near the top of `RunBacktest` (after the range-defaulting block,
   `servicer.py:499`): `request.sizing_mode == SIZING_MODE_PORTFOLIO` → portfolio path; anything else
   (incl. `UNSPECIFIED`/`LEGACY`) → the existing legacy path **unchanged**.
2. Resolve config sizing params once (portfolio path only), via the keys declared in Step 4:
   `position_weight = self._cfg.get_float("analysis.backtest.portfolio_position_weight", 0.10)`,
   `max_concurrent = max(1, self._cfg.get_int("analysis.backtest.portfolio_max_concurrent", 9))`
   (clamp guards a stored negative from reaching the sim; the zero-trap gives the default on `0`).
3. **Legacy path stays byte-for-byte** (the single thing not to get wrong): do not alter
   `servicer.py:501-503,522-571,626,631-657` for the legacy branch. The only additive change on the
   legacy branch is setting `result.sizing_mode = SIZING_MODE_LEGACY` (new field 17; does not touch
   `total_return` or any existing field — additive, and old persisted runs simply lack it).
4. **Portfolio branch:** the per-symbol loop still runs `_backtest_symbol[_evaluated]` **unchanged**
   (so per-symbol evidence cells at `servicer.py:557-569` and the grade are identical — FR-4/AC-5),
   but additionally collects each symbol's returned intent list (Step 5). After the loop, call
   `_simulate_portfolio(...)` with the collected intents + resolved params + per-symbol cooldown days
   (resolved as in `servicer.py:1160-1170`). Then:
   - Feed the returned portfolio equity curve into the **existing** `_compute_metrics` (do not fork
     it) to produce the aggregate `total_return`/`max_drawdown`/`sharpe_ratio`. For `period_years`,
     reuse the real-window span already computed at `servicer.py:624-625` (order-independent, FR-2).
   - Populate `result.sizing_mode = SIZING_MODE_PORTFOLIO`, `result.capital_skips.extend(...)`, and
     `result.portfolio_equity_curve.extend(...)` from the sim output. Aggregate `trades` in portfolio
     mode are the sim's realized trades; keep per-symbol `diagnostics` and evidence cells as-is
     (`BarDiagnostic.equity` field 15 stays per-symbol — documented in the message comment so a UI
     consumer does not misread it; design Open Risk).
5. **Persist the resolved params (AC-4).** Extend `_persist_backtest_run` (`servicer.py:1546`) to pass
   `sizing_mode` (the enum **name**, e.g. `SizingMode.Name(result.sizing_mode)`), `position_weight`,
   and `max_concurrent` (None on the legacy branch) into `BacktestRunsRepository.insert`. Extend the
   repo `insert` (`backtest_runs.py:25-68`) to accept those three kwargs and add them to the INSERT
   column list + `VALUES` (mirror the nullable `user_id` add at `backtest_runs.py:37,66`).
6. **Return the mode on the summary (AC-4).** In `_row_to_backtest_summary` (`servicer.py:3432`), set
   `sizing_mode` from `row.get("sizing_mode")` via the name→enum pattern used for `status`
   (`servicer.py:3428-3431`), defaulting to `SIZING_MODE_UNSPECIFIED` on a null/legacy row.
7. No new outbound gRPC call is introduced (portfolio sim is in-process) — §B header propagation:
   N/A; state this in the step.

**Verification**: covered by Step 8 (paired test), which includes the ruff lint gate and the
coverage threshold.

---

### Step 8 — test: RunBacktest legacy byte-for-byte + mode recorded + grade parity (AC-3, AC-4, AC-5)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_backtest_runs_repo.py` — modify (the new insert kwargs)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, scoring determinism

**Codebase Evidence**:
- Existing servicer tests: `services/xstockstrat-analysis/tests/test_analysis_servicer.py`
  (RunBacktest coverage; `_canonical` message-clearing determinism helper precedent, insights.md
  2026-07-27 — clear `backtest_id`/`completed_at` before a byte comparison).
- Existing repo test: `services/xstockstrat-analysis/tests/test_backtest_runs_repo.py` (insert/read
  round-trip for `BacktestRunsRepository`).

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5`

**Instructions**:
1. **AC-3 (legacy default byte-for-byte):** run a `RunBacktest` with `sizing_mode` **unset** and
   assert its `total_return` and the other aggregate metrics + per-symbol curve equal a golden
   captured from the pre-feature engine for the same fixed inputs. Use the `_canonical` pattern to
   normalize the always-varying `backtest_id`/`completed_at`, **and also clear the three fields this
   feature adds** (`sizing_mode`, `capital_skips`, `portfolio_equity_curve`) before the compare — a
   legacy run now stamps `sizing_mode = SIZING_MODE_LEGACY` (field 17), which a pre-feature golden
   lacks, so a naive full-message equality would false-fail on the new field alone. The compare must
   still cover the full metrics set + per-symbol curve + `trades` + `diagnostics` (i.e. it is the
   whole message *minus the four additive/volatile fields*, not a hand-picked metric subset). Add a
   companion assertion that the portfolio branch **does** move the numbers (a "teeth" test, insights.md
   2026-07-27) so an inert routing patch cannot masquerade as a pass.
2. **AC-4 (mode recorded + returned):** a portfolio-mode run → `result.sizing_mode == SIZING_MODE_PORTFOLIO`;
   the persisted `backtest_runs` row stores `"SIZING_MODE_PORTFOLIO"`; `_row_to_backtest_summary`
   returns `SIZING_MODE_PORTFOLIO`. A legacy run → records/returns `SIZING_MODE_LEGACY`. Extend
   `test_backtest_runs_repo.py` for the three new insert kwargs (round-trip `sizing_mode`/
   `position_weight`/`max_concurrent`, including the NULL-on-legacy case).
3. **AC-5 (grade unchanged):** for a strategy with banked per-symbol evidence cells, assert a
   portfolio-mode run computes the per-symbol evidence cells identically to legacy mode (the
   `symbol_cells` buffer at `servicer.py:557-569` is byte-identical between modes) and the derived
   headline grade (`_score_from_metrics`/`_recompute_headline`) is unchanged.
4. **Red-before-green (P-06):** each assertion fails against the pre-Step-7 tree. Name the `@AC-*` id.

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 9 — service: agent run_backtest sizing_mode arg + mode/skip surfacing

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/backtest_view.py` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify (run_backtest tool row / summary note)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) + mcp-tools.md parity

**Codebase Evidence**:
- `client.run_backtest(...)` builds `RunBacktestRequest(strategy_id, strategy_id_ref, symbols, initial_capital)`
  (`client.py:534-543`), threads a one-sided `range` (`client.py:544-551`), forwards `x-user-id`
  (`client.py:555`), returns `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`
  (`client.py:561-565`) — so a new proto field arrives in the dict as `sizing_mode` automatically.
- Tool wrapper `run_backtest` (`tools.py:455-509`): signature `(ctx, strategy_id, symbols,
  initial_capital=100000.0, start=None, end=None)` (`tools.py:456-462`), calls `client.run_backtest`
  (`tools.py:500-507`).
- Presentation split (`backtest_view.py`): `_HEAD_KEYS` (`:35`), `_METRIC_KEYS` (`:38-47`),
  `_INTENTIONALLY_DROPPED = frozenset({"trades"})` (`:33`), `summarize()` (`:54-82`),
  `build_blocks()` (`:85-114`).
- **Descriptor-parity guard (built-in red):** `test_backtest_view.py:157-173` asserts
  `kept | _INTENTIONALLY_DROPPED == BacktestResult.DESCRIPTOR.fields_by_name`, where
  `kept = _HEAD_KEYS | _METRIC_KEYS | {"coverage_gaps","diagnostics","warnings"}` (`:168`). The three
  new `BacktestResult` fields (`sizing_mode`, `capital_skips`, `portfolio_equity_curve`) make this
  test fail until `backtest_view.py` accounts for each — this is the C-10 fail-closed guard
  (insights.md 2026-08-02).
- Agent already forwards the propagation trio on every outbound gRPC (agent CLAUDE.md § edge) — the
  `sizing_mode` arg reuses the existing `client.run_backtest` call; §B header propagation: N/A (no new
  edge).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `client.run_backtest`: add an optional `sizing_mode: str | None = None` param; map it to the proto
   enum (`"portfolio"` → `SizingMode.SIZING_MODE_PORTFOLIO`, `"legacy"`/None → leave unset so the
   server defaults to legacy) and set `req.sizing_mode` when provided. Keep the return `MessageToDict`
   unchanged (the new fields flow through as `sizing_mode` / `capital_skips` / `portfolio_equity_curve`).
2. `tools.py run_backtest`: add an optional `sizing_mode: str | None = None` arg (document
   `"portfolio"` opts into shared-capital mode; default/omitted = legacy per-symbol compounding — the
   exact footgun the strat-lab skill Phase 3 warns about). Thread it to `client.run_backtest`.
3. `backtest_view.py`: surface the mode + a portfolio capital-skip **count** in the inline summary
   (`summarize`) — add `"sizing_mode"` to `_HEAD_KEYS` (it belongs in the compact block, always
   reaches the caller even with no attachment). Decide `capital_skips` / `portfolio_equity_curve`:
   surface a `capital_skips` **count** inline (small, diagnostic) and route the full
   `portfolio_equity_curve` into the attachment (O(bars), like `trades`) — add
   `portfolio_equity_curve` to `_INTENTIONALLY_DROPPED` (dropped from the inline summary) and handle
   `capital_skips` explicitly in `summarize` (mirror the `coverage_gaps` guard at `backtest_view.py:68`).
   The exact keys chosen must satisfy the descriptor-parity assertion (`kept | dropped ==
   fields_by_name`).
4. Update the `run_backtest` row in `services/xstockstrat-agent/CLAUDE.md` § MCP Tools and the tool
   docstring to name the `sizing_mode` arg and the mode/skip-count in the summary.

**Verification**: covered by Step 10.

---

### Step 10 — test: agent run_backtest sizing_mode + descriptor-parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_backtest_view.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability + mcp-tools.md parity

**Codebase Evidence**:
- `test_backtest_view.py:157-173` (descriptor-parity), summary field assertions (`:96`).
- `test_client.py` (client request-builder tests), `test_tools.py` (tool-level tests). Agent coverage
  threshold **40%** (spec-template § table; agent CLAUDE.md § Running Tests).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Update the descriptor-parity test's `kept`/`_INTENTIONALLY_DROPPED` expectation for the three new
   `BacktestResult` fields (it goes RED the moment Step 1's proto lands and stays red until Step 9's
   `backtest_view.py` accounts for them — this is the intended fail-closed sequence).
2. `test_client.py`: assert `client.run_backtest(..., sizing_mode="portfolio")` sets
   `req.sizing_mode == SIZING_MODE_PORTFOLIO`, and that omitting it leaves the field unset (legacy).
3. `test_tools.py`: assert the tool passes `sizing_mode` through and that `summarize` surfaces the
   mode + capital-skip count for a portfolio result.
4. Red-before-green (P-06) for each new assertion.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 11 — docs: strat-lab backtest skill (same PR as the tool change)

**Status**: `pending`
**Service**: `plugins/strat-lab`
**Files**:
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/aggregation.md` — modify

**Reviewers**: none (docs)

**Codebase Evidence**:
- Root CLAUDE.md § strat-lab plugin: a change to `run_backtest` MUST update the `strat-lab` `backtest`
  skill in the **same PR**.
- The skill's Phase 3 already documents the exact problem this feature fixes: "The multi-symbol
  `run_backtest` … **compounds capital sequentially** — a different thing from the
  per-symbol-independent basket most reports mean" (`SKILL.md:94-100`); the two-basket framing in
  `reference/aggregation.md:5-18` ("Sequential-capital basket … This is the 'real' portfolio backtest").
- The skill's own description enumerates "a multi-symbol run compounding capital sequentially instead
  of as an independent basket" as a failure mode it exists to handle (`SKILL.md:3`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In `SKILL.md` Phase 3, add the **third** basket option: portfolio mode via
   `run_backtest(..., sizing_mode="portfolio")` — a real shared-capital portfolio (concurrent
   positions, one equity curve, order-independent aggregate), distinct from both the legacy
   sequential-compounding call and the independent-per-symbol aggregation. State that the aggregate
   metrics from a portfolio-mode run are directly comparable and need no manual per-symbol
   aggregation, and that legacy (default) remains the sequential-parlay footgun.
2. In `reference/aggregation.md`, add portfolio mode alongside the sequential/independent split:
   explain that `sizing_mode="portfolio"` replaces the old "sequential is the only in-engine
   portfolio" caveat — the engine now produces a genuine order-independent portfolio curve — while
   the independent-per-symbol method stays the choice for isolating each symbol's response.
3. Keep the mutation-guard and ownership sections unchanged.

**Verification**:
```
grep -n "sizing_mode" plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/aggregation.md
```
Both files mention `sizing_mode="portfolio"`.

---

### Step 12 — service: UI mode label + portfolio equity curve + Past Runs mode

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` — modify (or a small
  shared render-map module) — add the exhaustive `Record<SizingMode, …>` (ledger 067)

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, enum→TS exhaustive-map coupling (ledger 067)

**Codebase Evidence**:
- Metrics grid + results surface render a `BacktestResult` (`result.*`) at
  `strategies/[id]/page.tsx:508-554`; Past Runs render `BacktestRunSummary` rows via `pastRunsColumns`
  (`page.tsx:124-194`, table `:557-582`). `BacktestStatus` is imported from
  `@xstockstrat/proto/analysis/v1/analysis_pb` (`page.tsx:20`).
- Exhaustive-`Record` precedent: `BacktestDiagnostics.tsx:10-27` (`ACTION_LABEL: Record<BarAction,…>`,
  `NO_TRADE_MESSAGE: Record<NoTradeReason,…>`) — the ledger-067 pattern; a shared enum-render home
  also exists at `src/lib/opportunityShared.tsx` (UI CLAUDE.md § Enum render maps).
- BFF forwards `runBacktest`/`getBacktest`/`listBacktests` unchanged (`src/lib/insightsBff.ts:35,38,40`)
  — the full message flows to the typed browser client; **no BFF change needed**.
- `useRunBacktest` types its result as `Awaited<ReturnType<typeof analysisClient.runBacktest>>`
  (`src/hooks/useBacktest.ts:6-7`) — the new fields are already on the regenerated type.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add an exhaustive `SIZING_MODE_LABEL: Record<SizingMode, string>` (covering `UNSPECIFIED` →
   "—"/"Legacy", `LEGACY` → "Legacy", `PORTFOLIO` → "Portfolio") — placing it beside the existing
   enum maps in `BacktestDiagnostics.tsx` (or `src/lib/opportunityShared.tsx`). This is net-new (no
   pre-existing exhaustive map over `SizingMode`), so it does not break `tsc` on regeneration — but it
   MUST be exhaustive so a future enum value fails `tsc` here (ledger 067).
2. On the results surface (`page.tsx:508-545`), render a mode `Badge`/`MetricCard` from
   `result.sizingMode` so a portfolio-mode return is never silently compared against a legacy one.
3. Add a "Mode" column to `pastRunsColumns` (`page.tsx:124-194`) reading `run.sizingMode` via
   `SIZING_MODE_LABEL`, so cross-mode rows are visibly distinguished (the product spec's minimum
   comparability guard — labeling, not blocking).
4. When `result.sizingMode === SizingMode.PORTFOLIO` and `result.portfolioEquityCurve` is non-empty,
   plot the portfolio equity curve (reuse `EquityCurveChart` or a sibling) — the per-symbol
   `EquityCurveChart` at `page.tsx:549` stays for legacy/per-symbol context (`BarDiagnostic.equity` is
   per-symbol; the portfolio curve is the new source in portfolio mode).

**Verification**: covered by Step 13 (e2e + lint + tsc via `pnpm build`/`pnpm lint`).

---

### Step 13 — test: UI e2e mode label + fixtures + mock-backend branch

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify (or a new
  `e2e/insights/backtest-sizing.spec.ts` — create)
- `services/xstockstrat-ui/e2e/fixtures/backtests.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`runBacktest` branch)

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, test-data inventory (C-12)

**Codebase Evidence**:
- Backtest fixtures live in `e2e/fixtures/backtests.ts` (`insufficientDataResult`, `prefixGapRange`,
  `BACKTEST_GAP_*`), catalogued in `e2e/fixtures/INVENTORY.md:22` (C-12). The auth helpers are in
  `e2e/helpers/auth.ts` (discovery-checklist j).
- The mock `runBacktest` handler is at `e2e/mock-backend.ts:670`; the existing backtest e2e is
  `e2e/insights/backtest-coverage.spec.ts`.
- `xstockstrat-ui` has **no coverage threshold** — UI behavior is covered by Playwright e2e
  (spec-template § table; UI CLAUDE.md § Testing). A fixture whose distinguishing fields are all
  equal tests nothing (insights.md 2026-07-27) — the mock must return a distinct `sizingMode` per
  branch and a real `portfolioEquityCurve`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a portfolio-mode `BacktestResult` fixture to `e2e/fixtures/backtests.ts` (with a non-empty
   `portfolioEquityCurve` and a `sizingMode: SIZING_MODE_PORTFOLIO`), and a catalog row in
   `INVENTORY.md`. Import it in the spec/mock (never inline the domain literal — C-12); scenario
   one-off overrides may stay inline.
2. Extend the `mock-backend.ts:670` `runBacktest` branch to echo the request's `sizingMode` and
   return the portfolio fixture (with a distinct `portfolioEquityCurve`) when portfolio mode is
   requested, and a legacy-labeled result otherwise — the two branches must differ in `sizingMode` so
   the assertion has teeth.
3. Add/extend the e2e spec: assert the results surface shows the mode label and the Past Runs "Mode"
   column, and that a portfolio-mode run renders the portfolio equity curve.
4. Red-before-green (P-06): the spec fails against the pre-Step-12 UI.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -g "sizing|portfolio"
```
The new spec passes; `pnpm build`/`tsc` stays green (the exhaustive `SIZING_MODE_LABEL` map compiles).
Confirm fixture imports:
```
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/backtest-*.spec.ts
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
