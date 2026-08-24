# Recon: backtest-next-bar-fill

**Created**: 2026-08-23
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (engine); consumer surfaces xstockstrat-agent (`run_backtest`), xstockstrat-ui (`/insights` backtest views)

---

## Objective

Move backtest fills from the **current bar's close** (a mild look-ahead — the bar whose close
produced the signal) to the **next bar's open**, the standard bias-free convention, as an opt-in,
versioned mode. Legacy same-bar-close stays the default so banked runs remain comparable; the fill
model used is recorded and surfaced.

## Codebase Map

- **`xstockstrat-analysis`** (Python) — `app/handlers/servicer.py`
  - `_backtest_symbol` (SMA path) `:845`: `price = bar.close` `:966-967`; entry fill+size
    `:1005-1013` (`fill_price = price * (1 + slippage)`); exit fill `:1019-1020`
    (`price * (1 - slippage)`); mark-to-market append `:1047-1048`; forced close at last bar
    `:1051-1073` (`last_bar.close * (1 - slippage)`, `daily_equity[-1] = equity`).
  - `_backtest_symbol_evaluated` (definition path) `:1080`: `price = bar.close` `:1174-1175`; entry
    `:1190-1198`; exit `:1208`; append `:1235`; forced close `:1238-1260`.
  - Trade loop iterates `for i in range(max(1, trade_start_idx), n)`; the decision for bar `i`
    (`decisions[i]`) is computed from bar `i`'s own indicator series (evaluator), so filling at bar
    `i`'s close is the look-ahead. `bars[i]` is a proto `Bar` carrying `open`/`high`/`low`/`close` —
    next-bar-open = `bars[i+1].open`.
  - `daily_equity[j]` ↔ `diags[j]` **1:1 invariant** enforced by assert `:3275-3296`
    (`_finalize_symbol_diagnostics`, feature 071). Diagnostics `action` (`BAR_ACTION_ENTER_LONG` etc.)
    is stamped per bar.
  - Metrics unchanged: `_compute_metrics` `:3617`; per-symbol cells `:558`; grade
    `_score_from_metrics` `:3310-3336` (blends sharpe/max_drawdown/win_rate only).
  - Persistence: `_persist_backtest_run` `:1546-1579` → `backtest_runs` (`migrations/006` + cols in
    007/015). **Latest migration `016` → next `017`** (coordinate with feature 150).
  - Config `analysis.backtest.*` via `get_float`/`get_int` (zero-trap helpers
    `app/config/watcher.py:95-143`).
- **`xstockstrat-agent`** — `run_backtest` tool `app/tools.py:456`; gRPC builder `app/client.py:503,
  534-551`; summary projection `app/backtest_view.py:38-47`.
- **`xstockstrat-ui`** — `/insights` results `src/app/insights/strategies/[id]/page.tsx:508-543`
  (metrics), Past Runs `:557-582`; exhaustive enum `Record<…>` maps in
  `src/components/insights/BacktestDiagnostics.tsx:10-27` (ledger-067 risk); BFF forwards unchanged
  `src/lib/insightsBff.ts:35,40`.
- **Proto** — `packages/proto/analysis/v1/analysis.proto`: `RunBacktestRequest` `:52-62`
  (feature 150 takes `sizing_mode = 8`; **this feature takes `fill_model = 9`**), `BacktestResult`
  `:84-107` (a `fill_model` marker after 150's `mode`), `BacktestRunSummary` `:203`.

## Patterns to REUSE

- **Additive enum with `_UNSPECIFIED=0` default** (C-04) → `FillModel` enum mirroring `BacktestStatus`
  (`analysis.proto:64`); `_UNSPECIFIED`→legacy same-bar-close.
- **Both simulators share the identical fill idiom** → introduce one small helper that returns the
  fill price/bar for a signal on bar `i` given the mode (same-bar-close vs next-bar-open), and call it
  from both `_backtest_symbol` and `_backtest_symbol_evaluated` — avoids duplicating the branch (DRY).
- **Existing diagnostics/alignment machinery** → keep `_finalize_symbol_diagnostics` and the
  `daily_equity`/`diags` 1:1 contract; stamp the ENTER/EXIT action on the bar where the fill lands.
- **Agent/UI/fixtures reuse** → same as feature 150 (request threading `client.py:544-551`, summary
  keys `backtest_view.py:38-47`, UI badge `strategies/[id]/page.tsx`, fixtures `e2e/fixtures/backtests.ts`).

## Existing Business Rules (preserve / extend)

- **No existing acceptance suite for `xstockstrat-analysis`** — no promoted `@AC-*` guards fill timing
  or no-look-ahead. This feature must **author** the no-look-ahead / next-bar-open guarantees fresh
  (they promote at launch, C-16); they are not inherited.
- **No suite for `xstockstrat-ui`**; `xstockstrat-agent` suite has no backtest guarantee;
  `platform.feature` unaffected. (Confirmed by scenario-recon, shared with feature 150.)

## Dependencies

- Proto/RPC: additive `FillModel` enum + `RunBacktestRequest.fill_model = 9` (next after 150's field 8)
  + a fill-model marker on `BacktestResult`/`BacktestRunSummary`. Additive only (C-09).
- Migration: a nullable `fill_model` column on `analysis.backtest_runs` — number **017 or 018**
  depending on merge order with feature 150 (whichever lands first takes 017; F-01 no editing applied
  migrations).
- Config keys: optional `analysis.backtest.default_fill_model` (else request-param only).
- Inter-service edges / env vars / ports: none new.

## Risks / Not-found

- **Last-bar signal (FR-2)**: a signal on the final bar has no `i+1` — must be handled with no
  look-ahead (recommend: skip the entry; keep the forced-close of an open position at the last
  available price). Design must pin the exact rule.
- **Alignment invariant** (`servicer.py:3275-3296`): moving the fill to bar `i+1` shifts which bar
  carries the ENTER/EXIT action and the equity step change; the `daily_equity[j]`↔`diags[j]` 1:1
  length contract must stay intact. Off-by-one risk here is the main correctness hazard.
- **Interaction with feature 150**: orthogonal (fill timing vs capital allocation) but both add a
  `RunBacktestRequest` field and possibly a `backtest_runs` column — coordinate proto field numbers
  (8 vs 9) and migration numbers at spec time to avoid collision (feature-overlap check).
- **Cooldowns**: re-entry/exit cooldown clocks (`is_cooldown_active`, `last_exit_time`) key off bar
  time — confirm they still reference the signal bar, not the fill bar, or document the choice.
- Ledger trap **067**: a `FillModel` enum surfaced in the UI needs its TS exhaustive-`Record` key in
  the same PR.
- Root CLAUDE.md: a `run_backtest` change updates the `strat-lab` `backtest` skill in the same PR.

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding):
1. Proto: `FillModel` enum + `RunBacktestRequest.fill_model = 9`; marker on result/summary; `buf` gen.
2. Engine: a shared fill-resolution helper (mode-aware) used by both simulators; last-bar rule;
   preserve the diagnostics alignment; route by `fill_model`, legacy default.
3. Persistence: migration for `fill_model` column; write in `_persist_backtest_run`.
4. Agent: optional `fill_model` arg + summary surfacing + strat-lab skill update.
5. UI: label the fill model on results + fixtures/tests.
