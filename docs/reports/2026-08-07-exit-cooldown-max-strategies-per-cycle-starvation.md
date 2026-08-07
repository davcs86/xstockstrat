# Defect: `max_strategies_per_cycle`'s no-rotation cap silently starves the live loop's cooldown gates for any pair beyond it

**Recorded**: 2026-08-07
**Severity**: SEV-2
**Impact type**: correctness (silent starvation, no error surfaced)
**Environment**: production and dev — code-level defect present in every deployment, latent until
the live-enabled pair count exceeds the configured cap
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

`LiveEvaluationLoop._run_cycle` (`services/xstockstrat-analysis/app/engine/live_loop.py:185-206`)
selects every live-enabled strategy with an unordered `SELECT * FROM analysis.strategies WHERE
live_enabled = TRUE AND active = TRUE`, then iterates strategy rows and their symbols, incrementing
a `processed` counter and returning **immediately** once `processed >= max_pairs`
(`analysis.engine.max_strategies_per_cycle`, default 50). There is no rotation, offset, or
round-robin across cycles — the same unordered query is re-run every `eval_interval_seconds`, so
whichever `(strategy_id, symbol)` pairs happen to fall after the cap on a given database read are
**never** passed to `_eval_pair`, cycle after cycle, indefinitely.

This silently starves **two** independent correctness mechanisms for any pair beyond the cap:

- The re-entry cooldown gate (feature 069, already shipped) never sees a bar for the pair, so its
  `_last_exit_at` anchor is never refreshed by a real transition — a starved pair can neither enter
  nor have its re-entry cooldown clock start.
- This feature's exit-cooldown gate (feature 116) has the identical exposure: a starved pair's
  `_last_entry_at` anchor is never established or refreshed by `_eval_pair`'s own edge-triggered
  logic (only the separate boot-time backfill, `app/engine/entry_backfill.py`, and hydration touch
  it outside `_eval_pair`), so its minimum-holding-period gate never evaluates for that pair either.

No error, warning, or metric is emitted when a pair falls outside the cap — the starvation is
completely silent from the operator's perspective; the only symptom is a live strategy that simply
never alerts for some of its symbols.

## Expected

Every live-enabled `(strategy_id, symbol)` pair should be reached by `_eval_pair` within a bounded
number of cycles, regardless of how many pairs exceed `max_strategies_per_cycle` in total — e.g. via
a stable ordering plus an offset/rotation that advances each cycle (round-robin), or a warning log
when the live pair count exceeds the cap so the condition is at least observable.

## Reproduction

1. Register and enable (`live_enabled = TRUE`) more `(strategy, symbol)` pairs than
   `analysis.engine.max_strategies_per_cycle` (default 50) — e.g. 60 pairs across any number of
   strategies.
2. Let several `eval_interval_seconds` cycles elapse.
3. Observe that `_eval_pair` is called only for the first ~50 pairs the unordered `SELECT` happens
   to return each cycle — the tail pairs receive zero bars, zero alerts, and zero cooldown-state
   updates, cycle after cycle, with no log line indicating anything was skipped.

## Evidence

`services/xstockstrat-analysis/app/engine/live_loop.py:185-206`
> ```python
> async def _run_cycle(self):
>     max_pairs = self._cfg.get_int("analysis.engine.max_strategies_per_cycle", default=50)
>     throttle = self._cfg.get_int("analysis.engine.alert_throttle_seconds", default=300)
>     rows = await self._db.fetch(
>         "SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE"
>     )
>     processed = 0
>     for row in rows:
>         definition = _row_to_strategy_definition(dict(row))
>         for symbol in self._symbols_for(definition):
>             if processed >= max_pairs:
>                 return
>             processed += 1
>             ...
> ```
> No `ORDER BY`, no offset/cursor state carried between cycles, unconditional early `return`.

`docs/roadmap/features/116-exit-cooldown/design.md` § Open Risks, item 1
> "`analysis.engine.max_strategies_per_cycle`'s no-rotation starvation is a pre-existing platform
> defect, not fixed by this feature... This feature's correctness assumes every live pair is reached
> within a bounded number of cycles; that assumption is false once the live pair count exceeds the
> cap. Not this feature's scope to fix (touches feature 069's shared code path)."

## Root cause hypothesis

`_run_cycle`'s cap-and-return shape was written assuming the live pair count would stay comfortably
under the default 50, with no rotation mechanism ever added as the assumption's safety net. The gap
predates feature 116 (it equally affects the feature-069 re-entry cooldown, shipped earlier) and was
only surfaced during this feature's design debate while tracing the exit-cooldown gate's correctness
assumptions.

## Not in scope (this report)

This report only files the defect per `docs/roadmap/features/116-exit-cooldown/design.md`'s explicit
instruction — feature 116 does not fix it (it touches feature 069's shared code path, a larger change
than this feature's scope). Route via `/sdd-triage --from-report` for a fix track (likely Track C —
an SDD feature to add rotation/round-robin to `_run_cycle`, or Track B if a config-only mitigation —
e.g. raising the default cap — is judged sufficient interim relief).

## Confidence

high
