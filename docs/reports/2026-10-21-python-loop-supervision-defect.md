# Defect: Python background loops and config watchers die permanently on one unexpected exception, and the analysis P&L-pattern consumer advances past a failed event

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: silent-background-loop-death
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-07, D-08, D-56. Grouped by service + theme (unsupervised background work in the Python services). The scan rated D-56 one level lower; it is grouped here because the same supervision rule (retry transient, never silently skip) fixes it.

## Observed

### D-07 — Analysis background loops die permanently on one exception; tasks are unretained

Each analysis `*_forever` coroutine catches errors only inside the cycle body. The durable-schedule calls around it
(`DurableSchedule.seed`, `next_sleep_seconds`, `advance`, all plain DB statements with no try,
`app/engine/durable_schedule.py:57,75,91`) run outside any guard. One transient DB error there ends the coroutine for
the life of the process. Examples:

- the fundamentals signal producer: `run_forever` seeds and then loops on `_tick` with no try;
- its `_tick` catches a failed `run_once` but then calls `_advance_schedule(retry)` in the `except` branch, so a DB
  outage that failed the cycle also kills the loop;
- the opportunity refresh, readiness materializer and template-intent sweep use the same seed-then-`while True` shape.

All loops are started with bare `asyncio.get_event_loop().create_task(...)` in `app/main.py`. The task is not
retained and has no done-callback, so a dead loop logs nothing (the exception is only reported if the task is
garbage-collected), and the service stays healthy. Producers go silently stale: no fundamentals signals, no
opportunity refresh, no readiness pre-warm, no saga sweep.

### D-08 — `ConfigWatcher._watch` catches only `AioRpcError` (three copies)

The `WatchConfig` reconnect loop in all three Python services catches only `grpc.aio.AioRpcError`. Any other
exception (for example a decode error, a `RuntimeError` from the channel, or a cancelled-stream edge) ends `_watch`.
The task was created unretained in `__init__`, so nothing reports it. The service keeps serving the last snapshot
forever, and live config changes stop arriving with no signal.

### D-56 — Analysis P&L-pattern consumer skips a failed event and advances past it

`PnLPatternConsumer.run_forever` wraps each `process_event` in `except Exception` and logs a warning. The next
successful event advances `analysis.ledger_stream_cursor` with `GREATEST(...)`, so the cursor moves past the failed
sequence. A transient DB error on a `portfolio.position.closed` event permanently loses that seal and its samples.
Nothing replays it.

## Expected

- D-07: every analysis background loop survives any exception from its schedule bookkeeping or cycle. It logs the
  error, backs off and continues. Started tasks are retained (a module-level set) with a done-callback that logs an
  unexpected exit.
- D-08: `_watch` reconnects after any exception, not only `AioRpcError`. It logs each failure and backs off so it
  cannot hot-loop.
- D-56: a transient failure on an event is retried before the cursor moves past it. A poison event is parked under an
  explicit rule and logged, not skipped silently.

## Reproduction

1. D-07: in `services/xstockstrat-analysis`, build a `FundamentalsSignalLoop` whose `DurableSchedule.next_sleep_seconds`
   raises `asyncpg.PostgresConnectionError` once and then returns `3600`. Run `run_forever()` as a task. After the
   first raise the task is done with the exception, and `_tick` is never called again.
2. D-07 (cycle path): make `run_once` raise and `_advance_schedule` raise in the same tick. The task ends.
3. D-08: build a `ConfigWatcher` whose `WatchConfig` stub iterator raises `RuntimeError("boom")`. `_watch` returns
   with that exception and never calls `WatchConfig` again. Same for indicators and ingest.
4. D-56: feed `run_forever` a stream of two events with sequences 10 and 11. Make `process_event` raise
   `asyncpg.PostgresConnectionError` for 10 and succeed for 11. The cursor ends at 11, and event 10 is never
   processed again.

## Evidence

### D-07

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:158-165` (scan cited `:164-165`)
> await self._seed_schedule()
> ...
> while True:
>     await asyncio.sleep(await self._tick())

`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:152-155` (`_tick`'s handler itself does DB I/O)
> except Exception as e:  # never let one bad cycle kill the loop
>     log.error("fundsignal: cycle error: %s", e)
>     ...
>     await self._advance_schedule(retry)

`services/xstockstrat-analysis/app/handlers/servicer.py:5925,5929` (opportunity refresh), `:6100,6105` (readiness
materializer), `:6144-6146` (template-intent sweep); scan cited `:5925-5930`, `:6100-6106`, `:6144-6146`
> await schedule.seed()
> ...
> while True:
>     await asyncio.sleep(await self._opportunity_refresh_tick(schedule))

The ticks call `schedule.next_sleep_seconds()` / `schedule.advance(...)` outside any try (`servicer.py:5882,5891,5903`;
`:6055,6060,6067,6079`; `:6113,6136`).

`services/xstockstrat-analysis/app/main.py:143,167,174,194,211,215,221,225` (scan cited `:167-225`)
> asyncio.get_event_loop().create_task(fundsignal_loop.run_forever())

`live_loop.run_forever` (`app/engine/live_loop.py:326-338`) is the counter-example: its cycle is guarded, and the only
unguarded call is a config read.

### D-08

`services/xstockstrat-analysis/app/config/watcher.py:56` (unretained task), `:66-80` (`except` at `:78`); scan cited `:56,78`
`services/xstockstrat-indicators/app/config/watcher.py:56`, `:58-79` (`except` at `:77`); scan cited `:56,77`
`services/xstockstrat-ingest/app/config/watcher.py:69`, `:79-93` (`except` at `:91`); scan cited `:69,91`
> except grpc.aio.AioRpcError as e:
>     log.warning("config stream error: %s, reconnecting in 2s", e)
>     await asyncio.sleep(2)

### D-56

`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:155-159`
> async for event in stream:
>     try:
>         await self.process_event(event)
>     except Exception as e:  # noqa: BLE001 — one bad event never kills the loop

`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:403-412`
> ON CONFLICT (consumer) DO UPDATE SET last_sequence = GREATEST(
>     analysis.ledger_stream_cursor.last_sequence, EXCLUDED.last_sequence)

## Root cause hypothesis

Each loop was hardened per cycle body ("one bad cycle never kills the loop") but not around its schedule bookkeeping,
and no shared supervised-loop helper or task registry exists. The watcher reconnect was written for gRPC errors only.
The P&L consumer treats "do not kill the loop" as "skip the event", and its monotonic cursor turns a skip into a
permanent loss.

## Confidence

high
