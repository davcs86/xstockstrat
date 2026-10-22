# Defect: Config change propagation and config/ledger handlers fail silently on DB errors — dead LISTEN socket, hung RPCs, orphaned WatchConfig streams

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: stale-config-and-hung-rpc
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-config, xstockstrat-ledger
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-05, D-06, D-35, D-58. Re-verified against main-dev @ a053b0e on 2026-10-21; current lines below.

## Observed

### D-05 — Config LISTEN connection has no `error`/`end` handler and no reconnect

`ConfigServiceImpl.initialize()` checks out one pooled client, issues `LISTEN config_changed` and attaches only a
`notification` listener. Nothing listens for `error` or `end`, and nothing reconnects. When the socket drops (DB
failover, idle reset, network blip), the service keeps serving its in-memory snapshot but never sees another
`config_changed`. Every `SetConfig` after that point is persisted but never broadcast, so every `WatchConfig`
subscriber platform-wide (including `platform.maintenance_mode` and `platform.trading_state` watchers) keeps stale
config until config restarts. An `error` event with no listener can also crash the process. The `notification`
handler is `async` with no try: a failed `reloadNamespace` query is an unhandled rejection (fatal by default on Node 24).

### D-06 — Async gRPC handlers await the DB outside `try`, so the callback is never called

- Config `getConfig` awaits `resolveOverlayValues` (a per-user DB query when `user_id` is set) with no try.
- Config `setConfig` awaits the existence-gate query and the global-row fallback query outside any try; only the
  final INSERT/NOTIFY is wrapped.
- Ledger `appendEvent` (idempotent path) awaits `this.pool.connect()` before its try.

A rejected promise in any of these never reaches `callback`, so the caller waits until its own deadline (or forever,
if it set none) instead of getting `UNAVAILABLE`/`INTERNAL`, and the rejection is unhandled.

### D-35 — `WatchConfig` registers the subscriber only after the snapshot resolves; a failed snapshot leaves the stream open

`watchConfig` computes the initial snapshot asynchronously and only then writes it and adds the subscriber to the
map. A `config_changed` broadcast that lands between the snapshot read and `subscribers.set` is never delivered to
that subscriber (missed boot delta). If the snapshot rejects, the `catch` only logs: the call is never ended or
errored, so the client sits on an open stream with no snapshot and no status (the client-side config-readiness wait
times out, 90 s per `docs/patterns/config-startup.md`, instead of failing fast and reconnecting).

### D-58 — `broadcastToSubscribers` drops a subscriber on any error without ending its call

The per-subscriber `try` wraps both `snapshotForSubscriber` (a per-user overlay DB query) and `call.write`. On any
error the subscriber is deleted from the map and only a warning without `err` is logged. The stream stays open,
so the client never reconnects and silently keeps stale config indefinitely. A transient DB error during one
broadcast permanently unsubscribes every per-user watcher in that namespace. This is the server-side mirror of
D-35. (The surveyor rated this item one level below the group severity on its own; it is grouped here because the
fix is the same "end the call so the client reconnects" contract.)

## Expected

- D-05: the config LISTEN client has `error`/`end` handlers and reconnects with backoff (ledger's `EventNotifier`
  pattern), re-snapshotting (`reloadAll`) and re-broadcasting on reconnect so changes made while disconnected
  are delivered. The notification handler never produces an unhandled rejection.
- D-06: every awaited DB call in `getConfig`, `setConfig` and ledger `appendEvent` sits inside a try whose catch
  calls `callback` with a gRPC error (`UNAVAILABLE` or `INTERNAL`).
- D-35: a subscriber is registered before (or atomically with) the snapshot read so no delta between snapshot and
  registration is lost (or a version check re-sends), and a failed initial snapshot ends the call with an error
  status so the client's reconnect/backoff path runs.
- D-58: a failed broadcast to one subscriber logs `err` and ends that subscriber's call with an error status
  (so it reconnects and re-snapshots), rather than silently dropping it.

## Reproduction

1. D-05: start config against Postgres, then terminate the LISTEN backend
   (`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query = 'LISTEN config_changed'`).
   Then `SetConfig` any global key (e.g. `analysis.backtest.max_duration_seconds`). The row and audit update, but
   no open `WatchConfig` stream receives a DELTA, and none will until config restarts.
2. D-06: in a unit test, stub `pool.query` to reject for the per-user overlay SELECT and call
   `getConfig({ request: { namespace: 'analysis', user_id: 'u-1' } }, cb)`; `cb` is never invoked. Same for
   `setConfig` with the existence-gate SELECT rejecting, and ledger `appendEvent` with an `idempotencyKey` and
   `pool.connect` rejecting.
3. D-35: open `WatchConfig` with `user_id: 'u-1'` while the overlay SELECT is made to reject; the stream receives
   no message and no status. Separately, delay the overlay SELECT and fire a `config_changed` NOTIFY before it
   resolves; the subscriber never receives that DELTA.
4. D-58: with a per-user subscriber open, make the overlay SELECT reject once during a broadcast. The subscriber is
   removed from the map, its stream stays open, and later changes never arrive.

## Evidence

### D-05 — Config LISTEN connection has no `error`/`end` handler and no reconnect

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:164-172`
> const pgClient = await this.pool.connect();
> await pgClient.query('LISTEN config_changed');
> pgClient.on('notification', async (msg: any) => {
> ...
>   await this.reloadNamespace(namespace, env);
>   await this.broadcastToSubscribers(namespace, env);

`grep -n "pgClient" configServiceImpl.ts` returns only `:164-166`: no `on('error')` or `on('end')`. Reference
reconnect pattern: `services/xstockstrat-ledger/src/services/eventNotifier.ts:74-78` (`client.on('error', …)` /
`client.on('end', …)` with `reconnectDelayMs`).

### D-06 — Async gRPC handlers await the DB outside `try`

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:315-319` (getConfig, no try in the method)
> async getConfig(call: any, callback: any) {
> ...
>   const values = await this.resolveOverlayValues(namespace, env, userId);

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:447-462` (setConfig; the only try starts at `:500`)
> const existing = await this.pool.query(
> ...
>   const globalExisting = await this.pool.query(

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:74-75`
> const client = await this.pool.connect();
> try {

### D-35 — `WatchConfig` registration races the snapshot

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:305-312`
> this.snapshotForSubscriber(sub, ConfigUpdateType.CONFIG_UPDATE_TYPE_SNAPSHOT)
>   .then((payload) => {
>     call.write(payload);
>     this.subscribers.set(subId, sub);
>   })
>   .catch((err) => {
>     log.warn('Failed to send initial snapshot', { subId, error: err?.message });

### D-58 — `broadcastToSubscribers` drops a subscriber without ending its call

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:264-271`
> try {
>   const payload = await this.snapshotForSubscriber(sub, ConfigUpdateType.CONFIG_UPDATE_TYPE_DELTA);
>   sub.call.write(payload);
> ...
> } catch (err) {
>   log.warn('Failed to write to subscriber', { clientId: sub.clientId });
>   this.subscribers.delete(id);

## Root cause hypothesis

The config server treats the DB as always-available: the LISTEN client was written without the lifecycle handling
ledger's `EventNotifier` later gained, and the WatchConfig/broadcast paths remove or never register subscribers on
error without signalling the client, so client-side reconnect logic (fixed in `69c8554`) never fires. D-06 is the
same "await before try" slip in three handlers.

## Confidence

high (D-05, D-06, D-58 are direct reads of current code; D-35's missed-delta window is a timing race confirmed by
reading, not yet by a test).
