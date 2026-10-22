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

**Who is affected.** Every service that subscribes to `WatchConfig` at startup (all backend services, the UI
and the agent) silently keeps stale config after a DB blip. Operators changing config through config-ui or the
agent `set_config` tool see their change never take effect. Callers of `GetConfig`, `SetConfig` and ledger
`AppendEvent` hang to their deadline instead of getting an error they can retry.

## Functional Requirements

- **FR-1 (D-05).** When the config LISTEN connection errors or ends, config re-establishes `LISTEN config_changed`
  with backoff, without a process restart. On reconnect it reloads every namespace and broadcasts, so a change
  committed during the outage still reaches open `WatchConfig` subscribers.
- **FR-2 (D-05).** A failure inside the `config_changed` notification handler (for example a rejected reload) is
  caught and logged. It raises no unhandled promise rejection and config keeps serving RPCs.
- **FR-3 (D-06).** `GetConfig`, `SetConfig` and ledger `AppendEvent` (including the whole idempotent-transaction
  branch: `pool.connect`, every `client.query` in it, and `ROLLBACK`) invoke the callback with a gRPC error status
  on any DB rejection, release any acquired pool client, and raise no unhandled promise rejection.
- **FR-4 (D-35).** `WatchConfig` loses no change committed between the start of the snapshot read and the
  subscriber's registration. If the initial snapshot fails, the stream is ended with a gRPC error status and the
  subscriber receives no later messages.
- **FR-5 (D-58).** When a broadcast to one subscriber fails, config logs the error message and ends that
  subscriber's call with a gRPC error status, so the client's reconnect/backoff path runs.

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
- [x] No config key changes (the reconnect backoff is a code constant whose values /sdd-design sets;
  a config key would be circular for config's own LISTEN client)

## Consumer Surface(s)

- [x] **None — internal/platform-only.** No RPC, proto field, response shape or stored state changes. The
  config-ui segment and the agent config tools (`get_config`, `set_config`, `list_config_keys`) reach config
  through `GetConfig`/`SetConfig`/`ListKeys` unchanged. The only observable difference on a DB failure is a gRPC
  error status in place of a hang (FR-3), and config changes keep propagating after a LISTEN drop (FR-1). No UI or
  agent tool change is needed.

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
