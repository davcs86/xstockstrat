# Defect: Fundamentals signal producer burns the day's idempotency claim on a failed emit and drops failed fetch chunks from the run, while reporting the run as complete

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: silent-signal-loss
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-analysis, xstockstrat-ingest
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-43, D-57. Grouped by service + theme (fundsignal run accounting). The scan rated D-57 one level lower; it is grouped here because both findings make `FundamentalsSignalLoop.run_once` lose symbols for the day while its run record says otherwise. Ingest is listed because the D-43 fix's double-emit trade-off depends on ingest's dedup behaviour.

## Observed

### D-43 — The day's idempotency row is claimed before emitting; a failed emit burns it

In `run_once`, each scored symbol first inserts its `analysis.fundsignal_emitted` row
(`ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol`). Only then does it call `_emit_signal`. When
`IngestSignal` fails with anything but `NOT_FOUND`, `_emit_signal` logs a warning and returns `None`. The claim row
stays, with `signal_id` NULL, and `emitted += 1` runs anyway. Effects:

- every non-`force` rerun that day skips the symbol (`row is None → continue`), so the signal is lost until the next
  day;
- `signals_emitted` on the run record over-counts;
- a `_SystemWriteRejected` raised mid-loop aborts the cycle but leaves the current symbol's claim row behind.

### D-57 — A failed `GetFundamentalsMulti` chunk spends budget, is neither fetched nor deferred, and the run reports "completed"

In `_paced_fetch`, a failed chunk call is logged and `calls += 1` runs. Its symbols are not added to `fetched` or to
`deferred`. `deferred` is computed as `symbols[i:]` after the loop, so it only holds budget-cut symbols. The run ends
`status = "completed"` when nothing was budget-deferred. Up to 50 symbols (one chunk) drop out of the cycle without
any run-level trace.

## Expected

- D-43: a symbol whose emit fails can be retried later the same day. Either the claim is removed on emit failure, or
  a claim with `signal_id IS NULL` is treated as retryable. `signals_emitted` counts only signals ingest accepted. A
  cycle abort leaves no orphan claim for the symbol being processed.
- D-57: a failed chunk's symbols are counted as deferred (or failed). The run status is not `"completed"` when
  symbols were dropped, and the warning path reports them.

## Reproduction

1. D-43: in `services/xstockstrat-analysis/tests`, drive `FundamentalsSignalLoop.run_once(force=False)` with one
   scored symbol `AAPL` above `min_conviction_to_emit`. Make `IngestSignal` raise `AioRpcError(UNAVAILABLE)`.
2. Observe: a `fundsignal_emitted` row exists for (`AAPL`, `fundamentals`, today) with `signal_id` NULL, and the run
   is finished with `signals_emitted=1`.
3. Run `run_once(force=False)` again with `IngestSignal` healthy. `IngestSignal` is never called for `AAPL`.
4. D-57: drive `run_once` with 60 symbols and budget 200. Make the first `GetFundamentalsMulti` chunk (50 symbols)
   raise. The run finishes `completed` with `deferred=0`, and the 50 symbols are neither scored nor deferred.

## Evidence

### D-43

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:242-256` (scan cited `:243-256`)
> row = await self._db.fetchrow(
>     "INSERT INTO analysis.fundsignal_emitted "
>     ...
>     "ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol",
> ...
> if row is None:
>     continue  # already emitted today

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:257-269`
> signal_id = await self._emit_signal(...)
> if signal_id is not None:
>     await self._db.execute("UPDATE analysis.fundsignal_emitted SET signal_id=$4 ...")
> emitted += 1

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:541-548` (scan cited `:547-548`)
> except Exception as e:  # noqa: BLE001 - one failed emit should not abort the run
>     if isinstance(e, grpc.aio.AioRpcError) and e.code() == grpc.StatusCode.NOT_FOUND:
>         raise _SystemWriteRejected(...)
>     log.warning("fundsignal: IngestSignal failed for %s: %s", symbol, e)
>     return None

### D-57

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:394-407` (scan cited `:394-406`)
> except Exception as e:  # noqa: BLE001 - one bad chunk should not abort the run
>     log.warning("fundsignal: GetFundamentalsMulti failed for chunk: %s", e)
> calls += 1
> i += chunk_size
> ...
> deferred = symbols[i:]

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:280`
> status = "budget_deferred" if deferred else "completed"

### Ingest dedup (relevant to the D-43 retry trade-off)

`services/xstockstrat-ingest/app/handlers/servicer.py:1039-1066`: the dedup claim is keyed on
`(user_id, source, symbol, direction)` and is overwritten (that is, not deduplicated) when `valid_until` differs.
`_emit_signal` computes `valid_until = now + valid_days` per call (`fundsignal_loop.py:520-525`). So if ingest committed
but the response was lost, a same-day retry would carry a different `valid_until` and would not be deduplicated. It
would write a second signal row.

## Root cause hypothesis

The producer uses one row for two jobs: "claimed for today" and "emitted". It never distinguishes a claim whose emit
failed. `_paced_fetch` returns only fetched and budget-cut symbols; it has no third bucket for failed chunks, so their
symbols vanish from the run's bookkeeping.

## Confidence

high
