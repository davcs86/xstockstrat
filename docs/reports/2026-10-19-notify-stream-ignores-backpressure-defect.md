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
1. Open a `StreamAlerts` client that stops reading at the raw HTTP/2 level (for example a raw Node `http2` client that calls `pause()` on the response stream). A grpc-js client that merely never reads does not reproduce this on the server: grpc-js keeps decoding into `unpushedReadMessages` and buffers on the client side instead.
2. Call `EmitAlert` in a tight loop.
3. Watch notify's RSS grow without bound; no subscriber is evicted.

## Evidence
`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:84`
> `            sub.call.write(alert);`

`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:87`
> `          } catch {`

## Root cause hypothesis
The fan-out treats `write` as synchronous delivery; grpc-js buffers internally instead of throwing. grpc-js puts no limit on the server-stream write queue, and HTTP/2 flow control limits only the bytes on the wire, so once the peer's window is exhausted every further message is held in notify's memory.

## Confidence
high. Reproduced against grpc-js 1.14.5 (the version notify uses) on Node 22, with the server and client in separate processes and a handler that mirrors `emitAlert` (return value discarded, no `drain`). With a raw HTTP/2 client that stops reading, `write()` returned false from the 16th message on and never threw. HTTP/2 flow control stopped the wire at 65,535 bytes (client `localWindowSize: 0`), but the server queue grew to 299,937 messages (`writableLength`) and RSS went from 59 to 476 MB for 300,000 1 KB writes. All of it was still held after 10 s idle, with no cancel or eviction. Not yet measured in a deployed environment.
