# Defect: a genuine indicators outage loses whole readiness batches and heal rows

**Recorded**: 2026-11-05
**Severity**: SEV-3
**Impact type**: stale-or-missing-readiness-on-transient-outage
**Environment**: code reading on main-dev (no production occurrence measured)
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

Found during feature 289's design (`docs/roadmap/features/289-fix-analysis-admin-formula-refusal/design.md` (pruned 2026-11-10; `git show 2d91b567:docs/roadmap/features/289-fix-analysis-admin-formula-refusal/design.md`; synthesis in that feature's context.md) § Open Risks). After 289, an
admin/owner formula refusal no longer raises out of `compute_readiness_row` / the traced evaluator, but a genuine indicators
outage (`UNAVAILABLE`, `DEADLINE_EXCEEDED`) from `ExecuteFormula` still escapes `compute_readiness_row` (`services/xstockstrat-analysis/app/services/readiness.py:80`,
the evaluation is not wrapped; only the bars fetch is) and costs more than the one symbol:

- `_kick_readiness_refresh` `_run` (`app/handlers/servicer.py:4298`): the outer `except Exception` (`:4325-4326`, "readiness refresh kick failed for user=%s") discards the **whole batch** — `upsert_many` (`:4323-4324`) is after the loop — and the `finally` (`:4327-4329`) drops the guard keys, so every row stays PENDING and is re-kicked on each poll.
- Readiness materializer `_materialize_readiness_for_owner` (`:6111`): the raise propagates to the per-owner catch (`:6163-6165`, "readiness materializer failed for owner=…"), losing that owner's later symbols/strategies and skipping `upsert_many` (`:6132-6136`).
- Opportunity 300 s heal `_retry_unavailable_symbols`: a raise from the second `compute_readiness_row` (`:5201`) escapes `_run`, is caught at `:4927-4928` ("opportunity surgical retry failed"), and loses all `heal_rows`.

Separately, `fetch_failed` (`servicer.py:5789`, `:5827-5829`) is a symbol-wide set filled concurrently across candidates: a sibling
candidate's indicators `RpcError` on the same symbol can mark another candidate's row `unavailable` depending on completion order.

## Expected

A single failing symbol/formula degrades only that symbol's readiness (per-symbol isolation with a diagnostic, as `GetIndicatorSeries` already does at `servicer.py:4587-4594`); a transient outage does not discard the batch, the owner's pass, or the heal rows.

## Reproduction

1. Make indicators `ExecuteFormula` return `UNAVAILABLE` for one component of one strategy while others succeed.
2. Trigger `GetWatchlistReadiness` (kick) or wait for the materializer tick: no row for any symbol of that user is written; the log shows the "kick failed" / "materializer failed for owner" WARN.

## Evidence

`services/xstockstrat-analysis/app/services/readiness.py:66-89`; `services/xstockstrat-analysis/app/handlers/servicer.py:4298,4323-4329,5201,4927-4928,6111,6132-6136,6163-6165,5789,5827-5829`; ledger `docs/roadmap/ledger/fails.md` 2026-11-04 fix-backtest-silent-symbol-skip (sibling arms).

## Root cause hypothesis

Isolation scope: the per-symbol work is inside a loop whose only exception handler is outside it. Pre-dates 289 and is not made worse by it.

## Confidence

medium (code-read; not reproduced)

## Triage

Open; route with `/sdd-triage --from-report` after 289 lands. 289 deliberately does not fix it (scope) and adds no characterization test that would pin the behaviour.
