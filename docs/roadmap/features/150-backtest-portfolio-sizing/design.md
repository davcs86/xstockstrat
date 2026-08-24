# Design: backtest-portfolio-sizing

**Created**: 2026-08-23
**Rounds**: 5 (full debate; termination: approved at the round cap)
**Approved by**: user @ 2026-08-23
**Grounded in**: recon.md

---

## Chosen Approach

Add an **opt-in, versioned portfolio sizing model** to the `xstockstrat-analysis` backtest engine,
selected by a single new proto field `RunBacktestRequest.sizing_mode` (a `SizingMode` enum,
`SIZING_MODE_UNSPECIFIED=0` → the legacy serial-compounding path). The legacy per-symbol loop
(`servicer.py:522-572`) runs **unchanged in both modes**, so per-symbol evidence cells
(`servicer.py:558`) and the feature-065 derived grade (`_score_from_metrics`, `servicer.py:3310-3336`)
stay **byte-for-byte identical** — this is guaranteed for free because the cell metrics are computed
relative to each symbol's own `daily_eq[0]` and are therefore scale-invariant and order-independent
(FR-4).

In portfolio mode, the existing simulators **additively return** a per-bar intent series
`(timestamp, close, entry_intent: bool, exit_intent: bool, conviction)` computed from expressions
they already evaluate *before* the position/cooldown gate (SMA: `combined >= buy_threshold` /
`<= sell_threshold`, `servicer.py:995,1004,1017`; evaluated: `decisions[i].entry/.exit` from
`evaluate_with_series`, `servicer.py:1185,1201`). This is a **single fetch, single intent
computation** per symbol — no parallel pass, no second `GetBars` round-trip (which feature 141's
`analysis.opportunity.max_concurrent_bars_fetches` cap exists to prevent). A new dedicated
`_simulate_portfolio(...)` then:

1. Builds a **shared calendar** = the union of all symbols' bar timestamps, ascending
   (`servicer.py:749,772-781` confirm no shared index exists today). Per symbol it keeps a
   `date → close` map; on a date where a symbol has no bar it marks to market at its **last-known**
   close (forward-fill using only on-or-before-today closes → provably past-only, no look-ahead; a
   terminal bar freezes the price, never a synthetic sell).
2. Runs **one shared cash pool** seeded at `initial_capital` with a `positions` dict (concurrent
   holdings). Per union date, ascending: process **exits first** (free cash), then entry-intent
   symbols not held, ordered by **symbol ASC** (a deterministic — and, given binary conviction,
   honestly *arbitrary* — tiebreak; see Rejected Alternatives), opening each while
   `len(positions) < portfolio_max_concurrent` and `cash >= portfolio_position_weight ×
   initial_capital`, else recording a capital-skip.
3. Applies **per-symbol cooldown inside the sim**, reusing `effective_cooldown_days` +
   `is_cooldown_active` (`cooldown.py:30-33,42-63`) against **portfolio-local** ephemeral
   `dict[symbol → last_exit_time]` / `dict[symbol → entry_time]` (mirroring the serial locals
   `servicer.py:1150,1171` but keyed by symbol since many are held concurrently; never touches
   `analysis.strategy_cooldowns`). Gate order: cooldown first, capital second, anchors mutated only
   on an actual fill (mirrors the serial `cost <= equity` skip that changes no anchor). This keeps
   backtest/live parity (FR-6): the portfolio honors the same `cooldown_days`/`exit_cooldown_days`
   the live loop enforces.
4. On the **final union date**, force-closes every open position at its last-known close (realized
   semantics, matching the legacy forced-close `servicer.py:1051-1073,1238-1261`), then feeds the
   resulting **portfolio equity curve** into the **existing** `_compute_metrics`
   (`servicer.py:3617`) — no second metrics function (DRY). Aggregate `total_return`/`max_drawdown`/
   `sharpe` are thus order-independent (FR-1/FR-2).

**Sizing parameters are config-only** — `analysis.backtest.portfolio_position_weight` (float,
default 0.10, `get_float`) and `analysis.backtest.portfolio_max_concurrent` (int, default 9,
`get_int`); a configured `0` is meaningless (disables the portfolio) so the zero-trap→default is the
desired guard. There are **no request-override fields** ("write the minimum"). The resolved values
are **persisted** on `backtest_runs` (migration `017`: `sizing_mode`, `position_weight`,
`max_concurrent`) so a run is reproducible despite `WatchConfig` drift.

**Consumer surfaces (C-14):** the agent `run_backtest` tool gains a single `sizing_mode` arg and
surfaces the mode + a portfolio-capital-skip count in its summary (`app/backtest_view.py`), with the
`strat-lab` `backtest` skill updated in the **same PR** (root CLAUDE.md). The UI `/insights`
strategy-detail page labels the mode and plots `portfolio_equity_curve` in portfolio mode
(`strategies/[id]/page.tsx:508-545`); the new `SizingMode` enum's TS exhaustive-`Record` key is added
in the **same PR** (ledger-067, `BacktestDiagnostics.tsx:10-27`).

## Rejected Alternatives

- **Reconstruct portfolio execution from `BarDiagnostic.action`** — rejected: the action stream is
  *realized execution* gated by per-symbol equity + cooldowns, not signal intent; a capital-skipped
  entry has no later action to replay, so it structurally under-trades exactly when the shared pool is
  contended (round-1 adversary).
- **Parallel `_symbol_signal_pass` (double-pass)** — rejected: re-fetches bars (2× marketdata load,
  the feature-141 TimescaleDB OOM hazard) and re-runs the evaluator, with a divergence window between
  the two fetches. Returning intent from the existing simulator is single-fetch and divergence-free
  (round-2/3 adversary).
- **Live-equity sizing (`position_weight × current_equity`)** — rejected: compounds and reintroduces
  the path/order sensitivity the feature removes; fixed fraction of **initial** capital is
  order-independent and interpretable (round-3, reversing a round-2 phrasing).
- **Request-override for `weight`/`max_concurrent`** — rejected: speculative scope; config is the
  sole source, keeping the proto surface to one `sizing_mode` field (round-4 adversary, final).
- **Graded-conviction capital prioritization** — rejected: `evaluate_with_series` conviction is
  binary (`evaluator.py:165`) and the SMA path only enters at `combined==1.0`, so no graded key
  exists without a heavier `evaluate_conditions_traced` pass that does nothing for the SMA engine
  (round-3 adversary). v1 documents the tiebreak as deterministic-arbitrary.

## Open Risks

- [ ] **Shared-calendar forward-fill look-ahead** — the union builder must forward-fill from
  on-or-before-today closes only; the RED test for AC (e) must use a **mid-series gap** fixture, not
  merely ragged start/end dates, or the most dangerous bug ships green. → `/sdd-spec` fixture design.
- [ ] **Stale-close drawdown understatement** — forward-filling a halted/missing symbol holds equity
  flat then jumps, understating `max_drawdown` mid-gap (`servicer.py:3662-3664`). Documented v1
  caveat; v1 chooses legacy-realized parity over drawdown fidelity on gappy cohorts. → design caveat.
- [ ] **Cross-feature field/migration coordination (SPOF)** — the `merge-order.md` 150↔151 row is the
  only thing preventing a silent `BacktestResult` field collision (bytes persisted verbatim,
  `analysis.proto:80-83`; `buf breaking` is per-branch). Row authored with this design. → `/sdd-spec`
  re-derives numbers from the merged tree.
- [ ] **Symbol-ASC systematic bias** — under scarce same-bar capital, alphabetically-earlier symbols
  persistently win the last slot; documented honestly (not neutral), covered by the determinism AC.
- [ ] **`BarDiagnostic.equity` (field 15) stays per-symbol** in portfolio mode; portfolio contribution
  lives only in `portfolio_equity_curve`. Documented so a UI consumer doesn't misread it.

## Constitution Rules Touched

- `C-04` — honored by: `SizingMode` enum with `SIZING_MODE_UNSPECIFIED=0`.
- `C-05` / `F-07` — honored by: new keys `analysis.backtest.portfolio_*` read via `WatchConfig`
  zero-trap helpers; defaults declared in the service CLAUDE.md; no hardcoding.
- `C-08` / `P-06` — honored by: every `@AC` (a)-(i) pairs a RED-first test; the legacy byte-for-byte
  regression (h) is the load-bearing one.
- `C-09` — honored by: proto changes are additive only; `buf lint`/`buf breaking` green; run
  `./scripts/buf-gen.sh`.
- `C-10` / `C-14` — honored by: the agent tool + strat-lab skill + UI label + UI enum-map key all land
  in the same PR as the proto change.
- `C-16` — honored by: portfolio mode is opt-in; the legacy default is unchanged, so no existing
  business rule is altered (analysis has no promoted suite yet; this feature authors its scenarios
  fresh, promoted at launch).
- `F-01` — honored by: migration `017` is a new additive nullable column set; no applied migration
  edited.
- `F-06` — honored by: no new DB pool; `_simulate_portfolio` is in-process.

## Business Rules Touched (C-16)

None changed. `xstockstrat-analysis` has no promoted `@AC-*` suite yet (recon § Existing Business
Rules), so there is nothing to preserve/extend/regress; this feature's scenarios (a)-(i) are net-new
and promote into the durable suite at launch.

## Rounds

5 (full debate). Termination: approved at the round cap. R1 rejected the diagnostics-replay
mechanism (design-fatal); R2 replaced the double-pass with intent-return and pinned grade
consistency; R3 fixed the conviction-tiebreak no-op, the FR-5 skip surface, and terminal policy; R4
locked cooldown-in-portfolio-sim, fixed-base sizing, and field accounting; R5 finalized config-only
sizing params and the 150↔151 field-coordination fact. No Floor breach at any round.

## Proto / Migration / Config Footprint (for /sdd-spec)

- Proto (additive): `SizingMode` enum; `RunBacktestRequest.sizing_mode = 8`; `BacktestResult`
  `sizing_mode = 17`, `capital_skips = 18` (new `PortfolioCapitalSkip{symbol, timestamp,
  intended_weight, available_cash}`), `portfolio_equity_curve = 19` (new `EquityPoint{timestamp,
  equity}`); `BacktestRunSummary.sizing_mode = 17`. **Numbers re-derived from the merged tree at
  spec time** per the merge-order.md 150↔151 row.
- Migration: `017` on `analysis.backtest_runs` — nullable `sizing_mode`, `position_weight`,
  `max_concurrent`.
- Config: `analysis.backtest.portfolio_position_weight` (0.10), `analysis.backtest.portfolio_max_concurrent` (9).

## The single thing /sdd-spec must not get wrong

The legacy (`SIZING_MODE_UNSPECIFIED`) path must remain **byte-for-byte identical** — serial equity
threading, per-symbol curve concatenation, aggregate parlay, per-symbol cells, and the derived grade.
`BacktestResult` bytes are persisted verbatim (feature 068), so any drift in the default path silently
mis-renders every historically banked run. Portfolio mode is strictly additive behind the enum default.
