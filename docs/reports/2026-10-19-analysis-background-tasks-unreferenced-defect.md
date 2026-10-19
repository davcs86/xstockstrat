# Defect: Analysis background tasks are created without a retained reference

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: silent-task-loss
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no
**Source**: services/xstockstrat-analysis/docs/context-constitution-findings.md — Latent bugs row "Boot recompute task is unreferenced" (broadened: all loops share the shape)

## Observed
`app/main.py` starts the boot recompute task and every long-running loop with
`asyncio.get_event_loop().create_task(...)` and discards the returned Task. The loops are live
evaluation, fundsignal, the P&L consumer, opportunity refresh, the readiness materializer and the
intent sweep. asyncio holds only weak references to tasks, so a task can be garbage-collected
mid-run, silently stopping that loop or the one-shot recompute.

## Expected
Strong references are kept, for example in a module-level set with a `discard` done-callback.

## Reproduction
1. Read `app/main.py:143-225`.
2. Note that no `create_task` result is assigned or stored.

## Evidence
`services/xstockstrat-analysis/app/main.py:143`
> asyncio.get_event_loop().create_task(_boot_recompute())

`services/xstockstrat-analysis/app/main.py:167`
> asyncio.get_event_loop().create_task(live_loop.run_forever())

`services/xstockstrat-analysis/app/main.py:211`
> asyncio.get_event_loop().create_task(pnl_pattern_consumer.run_forever())

## Root cause hypothesis
A common asyncio anti-pattern. Loops parked on `asyncio.sleep` are kept alive by timer handles,
which makes a loss rare and hard to observe.

## Confidence
low
