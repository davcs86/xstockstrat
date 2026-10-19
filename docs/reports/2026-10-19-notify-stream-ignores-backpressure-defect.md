# Defect: StreamAlerts fan-out ignores write backpressure (unbounded buffering)

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: unbounded-memory
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-notify
**Config-only fix possible**: no
**Source**: `services/xstockstrat-notify/docs/context-constitution-findings.md` § Open questions bullet 1; constitution § Gotchas (fan-out ignores `call.write()` backpressure)

## Observed
`emitAlert` calls `sub.call.write(alert)` for every matching subscriber and drops a subscriber only
if `write` throws. The `false` return (buffer full) is discarded and there is no `drain` handling,
so a stalled or slow `StreamAlerts` client (for example a backgrounded browser tab behind the BFF
SSE bridge) accumulates every alert in server memory for as long as the stream is open.
`notify.stream.max_subscribers` is not enforced either, so nothing caps the total.

## Expected
When `write` returns `false` past a threshold, the subscriber is dropped or its stream ended; it reconnects and pages history via `ListAlerts`.

## Reproduction
1. Open a `StreamAlerts` gRPC client that never reads from the stream.
2. Call `EmitAlert` in a tight loop.
3. Watch notify's RSS grow without bound; no subscriber is evicted.

## Evidence
`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:84`
> `            sub.call.write(alert);`

`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:87`
> `          } catch {`

## Root cause hypothesis
The fan-out treats `write` as synchronous delivery; grpc-js buffers internally instead of throwing.

## Confidence
low (the code path is confirmed; memory growth has not been measured in a deployed environment)
