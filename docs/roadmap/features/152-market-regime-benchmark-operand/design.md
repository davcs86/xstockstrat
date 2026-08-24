# Design: market-regime-benchmark-operand

**Created**: 2026-08-24
**Rounds**: 2 (full; termination: approved — operator expanded scope to close the last open risk)
**Approved by**: user @ 2026-08-24 (AskUserQuestion gates: "wire all four sites", "plumb formula-warmup into live now")
**Grounded in**: recon.md

---

## Chosen Approach

Add a plain `string source_symbol = 6;` to `StrategyComponent`
(`packages/proto/analysis/v1/analysis.proto:300`, after `params = 5`). **Plain, not `optional`** — an
unset plain string is omitted by `MessageToDict(preserving_proto_field_name=True)` (the write path,
`servicer.py:2232-2234`), so `definition_json` and `_definition_fingerprint` (`servicer.py:3994`) stay
**byte-identical** for every existing strategy (@AC-1). Additive → non-breaking; no RPC signature
change; no migration (rides `strategies.definition_json` JSONB).

**One shared computation unit.** Introduce `StrategyEvaluator._assemble_component_series(comp, closes,
eval_dates, benchmark_bars=None)` in `app/services/evaluator.py`. For an empty `source_symbol` it
delegates to today's `_compute_component(comp, closes)` unchanged (`evaluator.py:220-297`) — the
no-source path is untouched. For a truthy `source_symbol` it computes the indicator/formula on the
**benchmark's own contiguous closes** (`[b.close for b in benchmark_bars[comp.source_symbol]]`), then
LEFT-JOINs each output series onto the evaluated timeline keyed on the **trading-day date**
(`bar.time.ToDatetime(tzinfo=UTC).date()`, the transform the live loop already uses at
`live_loop.py:475`). A source component with **no benchmark bars supplied → all-`None`** (safe hold),
never computed on the evaluated `closes`. Compute-then-align (never align-then-compute:
`align_indicator_points` tail-aligns assuming a contiguous warm-up head, `evaluator.py:300-322`). The
join is lookahead-safe (benchmark date D → eval date D, no future data); missing date → `None` → leaf
`false` → hold; no forward-fill; the evaluated symbol is never reindexed. A WARN fires when in-window
join sparsity for a `source_symbol` exceeds a module-constant threshold (silent gapping stays
observable).

**All four StrategyComponent assembly sites route through the helper** (operator decision — the C-10
"forgot the shared consumer" family, `fails.md` 056/060/063/067), each preloading benchmark bars at its
own fetch layer and threading a `{source_symbol: [bars]}` dict:
1. **Backtest** — `evaluate_with_series` (`evaluator.py:148-154`) via `_backtest_symbol` (`servicer.py:1371`).
   Preload per distinct `source_symbol` with `_resolve_prefixed_bars` (`servicer.py:1059-1097`,
   window+warmup); a benchmark shortfall raises `_InsufficientData(source_symbol,…)` →
   `CoverageGap(symbol=source_symbol)` (`servicer.py:747-766`) — the **benchmark** is named in
   `coverage_gaps` (@AC-4).
2. **Live** — `_eval_pair` (`live_loop.py:450-466`) preloads per `source_symbol` **warmup-sized** (not
   the bare 365-day window). Builtin warmup via `warmup.builtin_lookback_bars`; **custom-formula warmup
   via the `GetFormula` declared `warmup_period`** — the `_declared_formula_warmup`/
   `_prefetch_formula_warmups` logic (`servicer.py:1721-1766`) extracted to a shared helper so
   `warmup.required_prefix_bars(benchmark_slice, cache)` (`warmup.py:118`) sizes a formula benchmark
   correctly on live too (operator decision — closes the P-03 silent-always-hold risk). `evaluate`
   wrapper (`evaluator.py:102-116`) forwards `benchmark_bars`.
3. **Readiness / Opportunities** — `evaluate_conditions_traced` (`evaluator.py:206-212`) via
   `EvaluateReadiness` (`servicer.py:2651`) and `ListOpportunities` (`servicer.py:3184`). Readiness
   preloads per-symbol; the per-user Opportunities compute loads each benchmark **once per pass** under
   the feature-141 `_bars_fetch_sem` + `bars_by_symbol` dedup (`servicer.py:3143-3178`) — one benchmark
   (VOO) is shared by all evaluated symbols, so it must not be fetched per (symbol, strategy).
4. **GetIndicatorSeries** — (`servicer.py:2729-2732`). The request already carries `symbol` and
   `times` (`analysis.proto:638`, index-aligned with `closes`), so `request.times` is the evaluated
   timeline; the server fetches the benchmark's bars for `comp.source_symbol` and aligns onto those
   dates.

**Server-authoritative normalization** (uppercase + trim, empty-after-trim = unset) via a shared
`_normalize_source_symbol` helper applied in **both** write paths — the ManageStrategy REGISTER path
(before `MessageToDict`, `servicer.py:2232`) and the UPDATE merge path (`_merge_definition_json`,
`servicer.py:2300-2315`) — never client-side (bypassable). Fingerprint auto-enters via `definition_json`
(@AC-6), no extra wiring.

**Consumer surface (C-14).** Authored & consumed via the Agent: the hand-written `manage_strategy`
dict→proto request builder in `xstockstrat-agent` gains `source_symbol` (Ledger RC-1/F-12 — the exact
drop-a-new-field trap), pinned by a descriptor-parity test mirroring
`test_backtest_view.py::test_summary_key_set_covers_every_proto_field`, and the `strat-lab` plugin
`backtest` skill is updated in the **same PR** (root CLAUDE.md rule). The UI strategy-builder editor is
a **named follow-up** `strategy-builder-source-symbol` (C-14 override recorded in context.md);
agent-authored strategies are fully functional without it.

## Rejected Alternatives

- **`optional string source_symbol`** — rejected: proto3 `optional` presence emits `"source_symbol":""`
  into `definition_json`, shifting the fingerprint and breaking @AC-1 byte-identity + invalidating every
  existing strategy's evidence base.
- **Per-definition helper** — rejected: GetIndicatorSeries consumes the raw `series_map` (name→list) to
  build `NamedSeries`, while (a)/(b) flatten to bare+dotted keys; a per-component unit gives all three
  the identical computation to parity-test.
- **Exact `time.seconds` join key** — rejected: brittle to per-symbol intraday timestamp differences;
  trading-day date is robust and equally lookahead-safe.
- **Align-then-compute (align raw benchmark closes, then run the indicator)** — rejected: corrupts
  rolling windows across gaps; `align_indicator_points` assumes a contiguous warm-up head.
- **Client-side normalization in the agent tool** — rejected: bypassable by the UI or any other
  ManageStrategy caller → mixed-case persisted → `"voo"`≠`"VOO"` fingerprint split.
- **Backtest + live only, safe-hold on the decide surfaces** — rejected by operator: wire all four so
  the benchmark gate is correct on Readiness/Opportunities/Symbol-chart too.
- **Keep the bare 365-day live window / builtins-only live warmth** — rejected by operator: plumb the
  formula-warmup cache into live so custom-formula benchmark gates warm correctly there too.

## Open Risks

- [ ] **Opportunities compute cost** — one extra benchmark fetch per compute pass (deduped once/pass
  under `_bars_fetch_sem`). Confirm the per-pass dedup actually collapses N evaluated symbols → 1
  benchmark fetch — addressed at the Readiness/Opportunities step, asserted by test.
- [ ] **Live formula-warmup extraction** — `_declared_formula_warmup`/`_prefetch_formula_warmups` live
  on the servicer; extracting them for reuse by `live_loop._eval_pair` must not change backtest
  behavior — addressed at the live step, guarded by the backtest byte-identity regression.
- [ ] **Join sparsity threshold** is a module constant, not a config key — tuning deferred (note in
  follow-up if operators need it).
- [ ] **`_backtest_symbol` exact call site** for benchmark threading assumed at `servicer.py:1371` per
  Round-1 citation; `/sdd-spec` pins the exact line via discovery (C-01).

## Constitution Rules Touched

- **C-01** — honored: every seam cites `path:line`; the one assumed call line is flagged for `/sdd-spec`
  discovery, not invented.
- **C-04** — N/A: `source_symbol` is an open, runtime-extensible ticker value → `string` is correct
  (not an enum).
- **C-08 / P-06** — honored: every `service` step is paired with a `test` step (red-before-green);
  coverage ≥40%.
- **C-09** — honored: proto step runs `buf lint` + `buf breaking`; `./scripts/buf-gen.sh` regenerates
  go/python/ts stubs.
- **C-10** — honored: the shared helper + benchmark preload reach **all four** StrategyComponent
  assembly sites, proven by a cross-site parity test; normalization covers **both** write paths; the
  agent builder + strat-lab skill + descriptor-parity test all land same PR.
- **C-14** — honored: consumer surface is the Agent (`manage_strategy`/`run_backtest`/live); UI editor
  deferred to the **named** follow-up `strategy-builder-source-symbol` (override recorded in context.md).
- **C-15** — honored: `@AC-1..8` in acceptance.feature; each `FR-N` covered.
- **F-04** — honored: nothing invented; the single assumed call line is an explicit `/sdd-spec` task.
- **F-07** — honored: no hardcoded config values (sparsity threshold is a code constant, not a config
  value read that should come from WatchConfig; if operators need tuning it becomes a config key in a
  follow-up).

## Business Rules Touched (C-16)

- No existing `xstockstrat-analysis` acceptance suite — this feature is **net-new behavior**.
- PRESERVE (implicit platform guarantee, analysis reviewer focus): **backtest reproducibility / no
  look-ahead / scoring determinism** — not regressed by: date-keyed lookahead-safe join, compute-from-
  before-start warmup, and the @AC-1 byte-identity regression test.

## Rounds

2 rounds (full). R1: proposer + design-adversary (verdict NEEDS-WORK; 8 objections). R2: proposer
converged against all locked R1 fixes; operator resolved the two scope forks (wire all four sites; plumb
formula-warmup into live) and approved. Termination: approved.
