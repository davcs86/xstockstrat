# Defect: Node config watchers open two new WatchConfig streams per failure, so streams multiply during a config outage

**Recorded**: 2026-10-03
**Severity**: SEV-2
**Impact type**: config-propagation
**Environment**: production (main)
**Affected service(s)**: xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config
**Config-only fix possible**: no

## Observed

Each Node service's `src/services/configWatcher.ts` schedules `setTimeout(() => this.startWatch(), 2000)`
from **both** `stream.on('error')` and `stream.on('end')`. There is no backoff, no reconnect guard, and
the previous stream is never cancelled.

`@grpc/grpc-js` 1.14.4 (`pnpm-lock.yaml:1056`) fires both events for one non-OK status: its
server-streaming `onReceiveStatus` calls `stream.push(null)` (which leads to `end`) and then
`stream.emit('error', …)`. So every failed stream starts two replacements.

While config is unreachable, watch streams therefore grow about 2ⁿ per 2-second cycle. When config
recovers, every surviving stream is live, and each config update is applied once per duplicate
stream. Recovery also hammers config with a burst of `WatchConfig` calls from all four services.

## Expected

One reconnect per stream failure, with exponential backoff and jitter. Any prior stream is cancelled
before a new one starts.

## Reproduction

1. Start ledger (or identity, notify or config) against a running config service.
2. Stop config for about 20 seconds, then start it again.
3. The `WatchConfig` subscriber count on config for that service is much greater than 1, and each
   later config change is logged as applied once per duplicate stream.

## Evidence

`services/xstockstrat-ledger/src/services/configWatcher.ts:58-66`
> stream.on('error', ...
>   setTimeout(() => this.startWatch(), 2000);
> ...
> stream.on('end', () => {
>   setTimeout(() => this.startWatch(), 2000);

The same pattern appears in `services/xstockstrat-identity/src/services/configWatcher.ts`,
`services/xstockstrat-notify/src/services/configWatcher.ts`, and
`services/xstockstrat-config/src/services/configWatcher.ts`.

`@grpc/grpc-js@1.14.4` `build/src/client.js:356-359` (the server-stream `onReceiveStatus`)
> stream.push(null);
> if (status.code !== constants_1.Status.OK) {
>     ...
>     stream.emit('error', (0, call_1.callErrorFromStatus)(status, callerStack));

## Root cause hypothesis

Both handlers were written as independent reconnect triggers on the assumption that grpc-js emits
only one of them. Fix: one guarded `scheduleReconnect()` with backoff that cancels the old call.
Because the file is copied four times, fix it once in a shared helper (debt-radar D-20).

## Confidence

high
