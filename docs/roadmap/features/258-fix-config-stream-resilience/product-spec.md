# Product Spec: fix-config-stream-resilience

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-config-stream-resilience-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, findings D-05, D-06, D-35, D-58 (re-verified on main-dev @ a053b0e).

**Observed.**
- **D-05** — `ConfigServiceImpl.initialize()` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:164-172`)
  holds one LISTEN client with only a `notification` listener: no `error`/`end` handler, no reconnect, and an
  `async` handler with no try. A dropped socket silently stops all config change propagation (or crashes config).
- **D-06** — config `getConfig` (`:319`) and `setConfig` (`:447-462`) and ledger `appendEvent`
  (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:74`) await DB calls outside `try`; a rejection never
  reaches `callback`, so the caller hangs to its deadline and the rejection is unhandled.
- **D-35** — `watchConfig` (`configServiceImpl.ts:305-312`) adds the subscriber only after the snapshot resolves,
  losing deltas in that window, and on a failed snapshot only logs, leaving the stream open with no status.
- **D-58** — `broadcastToSubscribers` (`configServiceImpl.ts:264-271`) deletes a subscriber on any error without
  ending its call or logging `err`; the client never reconnects and keeps stale config.

**Expected.** The LISTEN client reconnects with backoff and re-snapshots/re-broadcasts on reconnect; every handler
returns a gRPC error instead of hanging; a subscriber never misses a delta between snapshot and registration; and
any server-side failure on a subscriber's stream ends that call with an error status so the client's existing
reconnect/backoff path (`69c8554`) runs.

## Reproduction Steps

1. D-05: terminate the `LISTEN config_changed` backend with `pg_terminate_backend`, then `SetConfig` a global key;
   no open `WatchConfig` stream receives the DELTA.
2. D-06: stub `pool.query` (config) / `pool.connect` (ledger, with `idempotencyKey`) to reject; the handler callback
   is never invoked.
3. D-35: make the per-user overlay SELECT reject on `WatchConfig(user_id='u-1')`; the stream gets no message and no
   status. Delay the SELECT and NOTIFY in between; the DELTA is missed.
4. D-58: make the overlay SELECT reject once during a broadcast; the subscriber's stream stays open and receives
   nothing thereafter.

## Root Cause Hypothesis

The config server assumes the DB is always available: the LISTEN client lacks the lifecycle handling ledger's
`EventNotifier` (`services/xstockstrat-ledger/src/services/eventNotifier.ts:74-78`) has, and stream error paths
drop subscribers without signalling the client. D-06 is a repeated "await before try" slip.

## Affected Services

- xstockstrat-config (fix site: D-05, D-06 getConfig/setConfig, D-35, D-58)
- xstockstrat-ledger (fix site: D-06 `appendEvent` `pool.connect`)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (reconnect delay is a code constant unless design decides otherwise;
  a config key would be circular for config's own LISTEN client)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Client-side ConfigWatcher behaviour (Python D-08, Node watcher fixed by `69c8554`)
- The `setConfig` audit `author` field (feature `241-fix-config-audit-author-spoof`)
- Ledger `StreamEvents` replay/notify paths (D-27; feature `248-fix-ledger-trimmed-notify-payload`)
