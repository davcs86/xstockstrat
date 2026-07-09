# Design: backtest-debug-info

**Created**: 2026-07-08
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-07-08
**Grounded in**: recon.md

---

## Chosen Approach

One bundled feature, steps strictly ordered **proto → indicators → analysis → ui → agent** (integration
PR deploys both backend services atomically, so `warmup_period` is never dead-in-prod). The backtest
engine already computes everything the diagnostics need; this feature only **observes** and surfaces it.

**Proto (additive).** `analysis/v1/analysis.proto` (`recon.md` → `analysis.proto:54`) gains
`BacktestResult.diagnostics = 14`, a `SymbolDiagnostics` message (`symbol`, `repeated BarDiagnostic
bars`, `NoTradeReason no_trade_reason`, `int32 bars_total`, `int32 warmup_bars`), a `BarDiagnostic`
message (`symbol`, `bar_index`, `timestamp`, OHLCV, `vwap`, `map<string,double> indicators`, `bool
warmup`, `double signal_score`, `double conviction`, `BarAction action`), and the `BarAction` /
`NoTradeReason` enums — each with a `_UNSPECIFIED = 0` sentinel (C-04). `indicators/v1/indicators.proto`
gains `warmup_period` = 12/9/9 on `FormulaDefinition` / `RegisterFormulaRequest` / `UpdateFormulaRequest`
(`indicators.proto:131/158/189`). `./scripts/buf-gen.sh`, commit `gen/` (C-09).

**Indicators — `warmup_period` end-to-end.** Migration `004_formula_warmup` adds
`warmup_period INTEGER NOT NULL DEFAULT 0` to `indicators.formulas`, mirroring the `is_public`
scalar-column precedent (`migrations/001_formulas.up.sql:9`), not JSONB. Because the repo uses
`SELECT */RETURNING *` (`formulas_repository.py:57/77/158`), the column flows into the row dict
automatically; only `_row_to_formula` (`servicer.py:343`) and the request reads need explicit mapping.
A non-negative check follows the `min>max` raise pattern (`parameters.py:78`) → `INVALID_ARGUMENT`
(`servicer.py:222-226`). UI: the warm-up input goes in the shared `FormulaWorkspace.tsx` threaded
through `useFormulas` register/update — not duplicated per page.

**Analysis — diagnostics collection.** Both per-symbol helpers (`_backtest_symbol:341`,
`_backtest_symbol_evaluated:550`) return a **4-tuple** adding a `SymbolDiagnostics`; the only two callers
are `servicer.py:233/243`, and `RunBacktest` collects them into `result.diagnostics`. Diagnostics are
built by a **shared `_build_bar_diagnostic(...)` helper** (called from both paths — avoids the jscpd
block-clone that the DRY guard rail / F-05 would otherwise block) iterating `range(len(bars))`
**independently of the trade loops** (which start at 1), so **bar 0 is captured**. Each row's `action`
is **explicitly initialized** at build time (never left to the proto default → would serialize
`UNSPECIFIED` not `WARMUP`; C-04), then overwritten **inside the trade loop at the branch actually
taken** — legacy warm-up guards (`:442/:451`)→`WARMUP`, enter set **inside** the `cost<=equity` fill
block (`:486`) →`ENTER_LONG`, exit (`:492`)→`EXIT_LONG`, else `HOLD_LONG`/`HOLD_FLAT`; evaluated mirror
via `decision.entry/exit` (`:594/:603`). The **post-loop forced-close** (`:524-546/:631-653`) relabels
`diag[-1].action = EXIT_LONG`, so `ENTER_LONG`/`EXIT_LONG` bars carry the same `bar.time` written into
the `TradeRecord` (AC-3). The `indicators` map is present-only: legacy from `fast_values`/`slow_values`
(`servicer.py:404-405`, guarded `min(..., default=0)`), evaluated by projecting the evaluator's
`component_series` **dropping the redundant `<ref>.value` alias** (`evaluator.py:105-107`).
`signal_score` = real `scoring.compute_signal_score` on the legacy path, `0` on the evaluated path
(FR-4a). Timestamps use **`bar.time`** (the real proto field, `marketdata.proto:46`) — fixing the latent
`bar.timestamp` bug (`servicer.py:489/499/530/601/608/637`), which also corrects existing `TradeRecord`
times.

**Analysis — hybrid warm-up (Option-C, user-locked).** `warmup_bars` = max over the components the
active `entry_rule`/`exit_rule` **reference**. The referenced-ref set comes from a new **non-raising**
`referenced_refs(rule)` helper **extracted from** the existing `_validate_rule_refs`/`_validate_term_ref`
walk (`evaluator.py:231/269`) — validation keeps raising; the collector only gathers and collapses
dotted `bb.lower`→base `bb` (DRY). Built-in component → the **observed** first-resolved index in its
series (dict-min of `fast_values`/`slow_values` legacy; first non-`None` of `component_series[ref]`
evaluated, capped at `len(bars)-1`); custom-formula component → its **declared** `warmup_period`, fetched
via `GetFormula` (confirmed callable — `servicer.py:122`) **once per RunBacktest, cached by `formula_id`**
across symbols (avoids N×M round-trips). Legacy path references `{fast, slow}` implicitly. `no_trade_reason`
(only when a symbol trades 0): `warmup_bars >= len(bars)` → `ENTIRE_RANGE_WARMUP`; else no `ENTER_LONG`
recorded → `ENTRY_NEVER_TRUE`; `INSUFFICIENT_CAPITAL` stays in the enum but is **not emitted this
version** (user-locked). Insufficient-data symbols never enter the helper (raised `:377/:577` → coverage
gap), so this channel can't mislabel them.

**Analysis — 2-year cap.** `RunBacktest` reads `analysis.backtest.max_range_days` via `watcher.get_int`
(default 730, declared in `analysis/CLAUDE.md` + root table; C-05). To bound **all** backtests: if both
`range.start`/`.end` are set and the span exceeds the cap → `context.abort(INVALID_ARGUMENT, …)`
(`servicer.py:143/218`); if a bound is **unset** (the agent sends no range) → **default it**
(`end→now`, `start→end − max_range_days`) rather than bypass the cap. UI constrains the date pickers.

**Evaluator exposure (additive).** `evaluate()` keeps returning `list[BarDecision]` (feature-048 live
loop `live_loop.py:119` + list-mocking tests unaffected); a new `evaluate_with_series()` returns
`(decisions, component_series)` and `evaluate()` delegates to it. Additive — no signature break.

**Agent.** `client.run_backtest` switches to `MessageToDict(resp, preserving_proto_field_name=True)`
(matching sibling calls `client.py:294+`) so snake_case keys don't regress; this includes `diagnostics`
(and restores currently-dropped `trades`/`status`/`coverage_gaps`). Tool docstring updated so the agent
suggests strategy/indicator changes from the per-bar data.

**UI.** A day-by-day debug `<Card>` on `strategies/[id]/page.tsx` between the metrics/equity block and
the `INSUFFICIENT_DATA` card, using the shared shadcn `Table` markup (`table.tsx:54`) virtualized via a
new **`@tanstack/react-virtual`** dep (headless `useVirtualizer` keeps the semantic `<Table>` markup and
a11y; `react-window` would force a div-grid, abandoning the shared component). No-trade reason shown
prominently.

**Step split (paired red-green test per service step — C-08/P-06):** 1 proto (`buf` verify); 2 indicators
(migration+`warmup_period`+validation, round-trip test); 3a `evaluate_with_series`+`referenced_refs`
(series-returned / list-back-compat / nested AND-OR ref test); 3b both-path diagnostics + `bar.time` fix
(per-bar incl. bar 0, `.value` dropped, action↔TradeRecord AC-3, **real non-MagicMock `Bar` fixture**);
3c hybrid warm-up + `no_trade_reason` (observed/declared max, unused-component non-inflation, all-`None`
formula series); 3d range cap + config key (over-cap→INVALID_ARGUMENT, at-cap runs, unset→defaulted);
4 ui (virtualized table + date cap + `FormulaWorkspace` input, e2e); 5 agent (`MessageToDict`, tool test).

## Rejected Alternatives

- **Pure declared `_INDICATOR_WARMUP` map (Option C constants)** — rejected: SMA(P) resolves at index
  `P-1`, so a `period` constant disagrees with the OQ-5 leading-gap test by one and flags a bar warm-up
  while its value is present. Hybrid (observe built-ins) removes the entire constant-tuning bug class.
- **Option B (observe series resolution for everything)** — rejected: loses the user's declared-lookback
  intent for formulas (a formula's series may resolve irregularly / emit early garbage), which needs a
  *declared* `warmup_period`.
- **`return_series` kwarg on `evaluate()`** — rejected: still widens the contract the feature-048
  docstring pledges frozen; a separate `evaluate_with_series()` is cleaner.
- **Reading `action` from `decisions[i]`** — rejected: a decision-entry bar that doesn't fill (or a
  hold-while-long bar) would mislabel vs the actual `TradeRecord`; action must be captured at the branch.
- **Manual dict extension in the agent** — rejected: `MessageToDict` (with `preserving_proto_field_name`)
  matches sibling methods and also restores fields the manual projection silently dropped.
- **`react-window`** — rejected: ships its own list container, forcing abandonment of the shared shadcn
  `Table` markup; `@tanstack/react-virtual` is headless and keeps it.
- **Splitting FR-4c into its own feature** — rejected (user-locked bundle): analysis compile-depends on
  the `warmup_period` proto field, so proto+indicators must precede analysis anyway; atomic deploy avoids
  a dead-in-prod column.
- **Widening `evaluate_with_series` to also return formula warmup** — rejected: fetching `GetFormula`
  once-per-run cached by `formula_id` avoids the N×M round-trips without further widening the evaluator
  contract.

## Open Risks

- [ ] `vwap` presence heuristic — `Bar.vwap` is a proto3 scalar (no presence); "carries it" is
      approximated as `vwap != 0`, mislabeling a genuine `0.0` as absent. Decide at **step 3b** whether
      to accept the heuristic or make FR-2 `optional double vwap`.
- [ ] All-`None` formula primary series would push `warmup_bars` to `len(bars)` → `ENTIRE_RANGE_WARMUP`
      instead of `ENTRY_NEVER_TRUE`. Mitigation (adopt at **step 3c**): custom-formula components always
      use the **declared** `warmup_period`, never the observed series; test an all-`None` formula.
- [ ] The `bar.time` fix also rewrites existing `TradeRecord` entry/exit times; MagicMock tests that
      assert on `.timestamp` need a **real `Bar` fixture** — address at **step 3b**.
- [ ] Range-unset defaulting changes the agent's currently range-less backtest coverage (now bounded to
      the last `max_range_days`). Acceptable per the "cap all backtests" objective; verify at **step 3d**.

## Constitution Rules Touched

- `C-01` — honored: every design claim cites a real `recon.md` `path:line`; no invented symbols.
- `C-04` — honored: `BarAction`/`NoTradeReason` carry `_UNSPECIFIED = 0`; `action` explicitly initialized
  per row so the zero sentinel is never a silent fallback.
- `C-05` — honored: `analysis.backtest.max_range_days` follows `<service>.<category>.<key>`, default
  declared in `analysis/CLAUDE.md` + root table.
- `C-07` — honored: new migration is the next number `004`, up+down pair (no edit to an applied one).
- `C-08` / `P-06` — honored: every non-frontend service step is paired with a red-before-green test step
  meeting the service coverage threshold.
- `C-09` — honored: proto step runs `buf lint`/`buf breaking`; `./scripts/buf-gen.sh` after the change.
- `P-03` — honored: the DRY duplication, `MessageToDict` shape, and range-unset behavior were surfaced
  and decided, not guessed; residual unknowns live in Open Risks.
- `F-01` — honored: migration `004` is new, not an edit to an applied `.up.sql`.
- `F-05` — honored: shared `_build_bar_diagnostic` avoids the block-clone the pre-commit jscpd gate would
  reject before verification passes.
- `F-06` — honored: no new DB pool; evaluator/servicer reuse the existing stub and pool.
- `F-07` — honored: the cap value is read from config (`get_int`), not hardcoded.
