# Design: backtest-next-bar-fill

**Created**: 2026-08-23
**Rounds**: 7 (full debate; user raised the cap from 5 to 7; termination: approved at the cap)
**Approved by**: user @ 2026-08-23
**Grounded in**: recon.md

---

## Chosen Approach

Add an **opt-in, versioned fill model** to the `xstockstrat-analysis` backtest engine that shifts
fills from bar `i`'s close to bar `i+1`'s **open**, selected by a new proto field
`RunBacktestRequest.fill_model` (a `FillModel` enum, `FILL_MODEL_UNSPECIFIED=0` → legacy
same-bar-close, byte-for-byte default). The mechanism is **deferred execution, not a price swap** (a
price-only swap that stamped equity on bar `i` from bar `i+1` data would be look-ahead): a signal on
bar `i` sets a pending fill; it is applied at the **top of iteration `i+1`** at `bars[i+1].open`.

**One shared `_apply_fill` state machine** over an explicit `SimState`
(`equity/position/entry_price/entry_time/last_exit_time/trades`) is called from both simulators
(`_backtest_symbol` `servicer.py:845`, `_backtest_symbol_evaluated` `:1080`). Critically, `_apply_fill`
**returns** the fill-bar upgrade action (`BAR_ACTION_ENTER_LONG`/`EXIT_LONG`, or `None`) and mutates
`SimState`; it **never writes `diags`**. The **loop remains the sole writer** of `diags[...].action`
at the existing stamp site (`:1046` SMA / `:1234` evaluated), applying the returned upgrade over its
default (`HOLD_LONG if position>0 else HOLD_FLAT`, `:1177-1181`), and the sole appender to
`daily_equity` (`:1048`/`:1235`). This makes "one writer" syntactically enforced, removes the
clobber-ordering hazard, and keeps the `daily_equity[j] ↔ diags[j]` 1:1 assert (`:3275-3296`)
trivially true (one append per iteration, unchanged count/site).

**Effective fill model is resolved once at `RunBacktest` entry** — `effective = request.fill_model if
set else config analysis.backtest.default_fill_model else UNSPECIFIED` — mirroring the
commission/slippage resolution at `servicer.py:383-384`, and threaded via the params tuple to **both
simulators and `_persist_backtest_run`**. The **effective** value (never the raw request field) is
persisted on `backtest_runs` and echoed on `BacktestResult.fill_model`/`BacktestRunSummary.fill_model`,
so a run's banked/echoed model always equals what actually routed the simulation (comparability
promise held).

**Last-bar rule:** a signal on bar `n-2` fills at `bars[n-1].open` and is then force-closed at
`bars[n-1].close` — the same single-bar round-trip legacy same-bar mode already produces, so trade
counts stay symmetric across modes. Only a signal on the **absolute last bar `n-1`** drops (its
pending has `fill_idx=n`, no iteration `n`, so `_apply_fill` is never called → the loop's default
`HOLD_FLAT` stands, no `TradeRecord`, no equity step). The symmetric **front edge** (an unprefixed
bar-0 signal never fills, because iteration 0 doesn't run) is documented alongside it; both mirror
legacy's own bar-0 handling and are not regressions.

**Cooldown is measured fill-to-fill:** the gate check relocates into `_apply_fill` reading
`bars[fill_idx].time` against the fill-bar anchors `entry_time`/`last_exit_time` (`:1196,:1231`); in
same-bar mode `signal==fill` so it is byte-identical to legacy. (The signal-vs-fill reference is
carried as a `/sdd-spec` confirm-item; fill-bar is the recommendation, for consistency with when the
position is actually held. Byte-identical in legacy mode either way.)

**Consumer surfaces (C-14):** the agent `run_backtest` tool gains a `fill_model` arg and surfaces the
effective model in its summary (`app/backtest_view.py`), with the `strat-lab` `backtest` skill updated
in the **same PR**. The UI `/insights` strategy-detail page labels the fill model
(`strategies/[id]/page.tsx`), and the new `FillModel` enum's TS exhaustive-`Record` key is added in
the **same PR** (ledger-067, `BacktestDiagnostics.tsx:10-27`).

## Rejected Alternatives

- **Price-only resolver** (resolve `bars[i+1].open` but execute in place on bar `i`) — rejected:
  stamping equity on bar `i` from bar `i+1` data is look-ahead and corrupts the `daily_equity`↔`diags`
  semantics even though lengths still match.
- **Suppress the `n-2→n-1` entry** — rejected: legacy records that round-trip, so suppressing the
  next-bar analog breaks cross-mode trade-count comparability (the feature's whole purpose). Drop only
  the truly unfillable absolute-last-bar signal.
- **Signal-to-signal cooldown** — rejected as the default: fill-to-fill matches actual transaction
  dates (wash-sale/min-hold semantics); byte-identical in legacy mode. (Kept as a `/sdd-spec` confirm.)
- **In-place `diags.action` mutation inside `_apply_fill`** — rejected: reopens the clobber-ordering
  hazard; the return-the-upgrade / loop-writes-once pattern makes single-writer syntactic.
- **Stamp the signal-bar conviction on a fill row** (to keep action/conviction coherent) — rejected:
  more invasive, redefines conviction on fill rows and risks the backtest/live conviction contract,
  for a display-only gain. The decouple is documented + covered by an AC instead.

## Open Risks

- [ ] **Diagnostic action/conviction decouple** — in next-bar mode `diags[i+1].action` reflects bar
  `i`'s signal while `diags[i+1].conviction` reflects bar `i+1`'s own decision, so the `/insights`
  overlay can show "ENTER on a row whose conviction reads hold." Display-only (grade math never reads
  conviction — `_score_from_metrics` uses sharpe/max_drawdown/win_rate only); documented here + in the
  strat-lab skill, and pinned by an AC asserting the intended semantics. → design caveat + AC.
- [ ] **Cooldown reference-bar** — pin signal-bar vs fill-bar explicitly in the spec (recommend
  fill-bar); only affects new next-bar behavior, byte-identical in legacy mode. → `/sdd-spec`.
- [ ] **Pending applied above the warm-up `continue`** — `_apply_fill` must run before the SMA
  warm-up `continue` branches (`:970-972,:979-981`); practically unreachable (warm-up is a strict
  prefix, a post-signal bar has SMAs) but must be stated as an invariant. → `/sdd-spec`.
- [ ] **Config zero-trap rationale** — `analysis.backtest.default_fill_model` via `get_int` is safe
  *only because* both absent and a configured `0` resolve to `UNSPECIFIED`→legacy; note this so a
  future reader doesn't "fix" it. → `/sdd-spec`.
- [ ] **Cross-feature field/migration coordination (SPOF)** — the `merge-order.md` 150↔151 row is the
  only guard against a silent `BacktestResult` field collision (bytes persisted verbatim; `buf
  breaking` is per-branch). Row authored with feature 150's design. Numbers re-derived from the merged
  tree at `/sdd-spec` (151: `fill_model` request=9, result=20, summary=18, migration 018; whichever
  lands second renumbers).

## Constitution Rules Touched

- `C-04` — honored by: `FillModel` enum with `FILL_MODEL_UNSPECIFIED=0`.
- `C-05`/`F-07` — honored by: `analysis.backtest.default_fill_model` read via `WatchConfig`; no
  hardcoding; default declared in the service CLAUDE.md.
- `C-07` — honored by: new migration `017`/`018` (re-derived at spec time), never editing an applied one.
- `C-08`/`P-06` — honored by: the mandated pre-refactor byte-for-byte golden test over **both**
  simulators (incl. SMA warm-up `continue` branches, ledger-056) + every `@AC` pairs a RED-first test
  using real `Bar`/`BarDiagnostic` protos (ledger fails.md:725).
- `C-09` — honored by: additive-only proto; `buf lint`/`buf breaking` green; `./scripts/buf-gen.sh`.
- `C-10`/`C-14` — honored by: agent tool + strat-lab skill + UI label + UI enum-map key all land in
  the same PR as the proto change.
- `C-16` — honored by: opt-in; legacy default unchanged; analysis has no promoted suite yet, so
  scenarios are net-new and promote at launch.
- `F-01` — honored by: additive nullable migration; no applied migration edited.

## Business Rules Touched (C-16)

None changed. No promoted `@AC-*` suite exists for `xstockstrat-analysis`; this feature's AC-1..AC-9
are net-new and promote at launch.

## Rounds

7 (full debate; cap raised 5→7 by the user). R1 accepted deferred-execution over the naive price
swap; R2 mandated the shared helper + parity test; R3 allowed the n-2 fill, chose fill-to-fill
cooldown; R4 pinned the golden test + field/migration coordination; R5 locked the single-writer
return pattern + coordinated field range; R6 (fresh red-team) surfaced effective-model resolution,
AC-8 config-contingency, and the action/conviction decouple; R7 (terminal) confirmed all resolutions
close, verdict APPROVABLE. No Floor breach at any round.

## Proto / Migration / Config Footprint (for /sdd-spec)

- Proto (additive): `FillModel` enum; `RunBacktestRequest.fill_model = 9`; `BacktestResult.fill_model
  = 20`; `BacktestRunSummary.fill_model = 18`. Re-derived at spec time per the merge-order.md 150↔151
  row.
- Migration: nullable `fill_model` on `analysis.backtest_runs` — `017` or `018` (whichever of 150/151
  lands second renumbers).
- Config: optional `analysis.backtest.default_fill_model`.

## The single thing /sdd-spec must not get wrong

The **loop is the sole writer** of `diags[...].action` at `:1046`/`:1234`; `_apply_fill` **returns**
the ENTER/EXIT upgrade (or `None`) and never touches `diags`. Any spec step that has `_apply_fill`
mutate the diagnostic in place reopens the clobber-ordering hazard, can leave a phantom ENTER on an
unapplied (last-bar) pending, and risks the `:3291` 1:1 assert. Stamp-on-apply-via-return is the
invariant everything rests on.
