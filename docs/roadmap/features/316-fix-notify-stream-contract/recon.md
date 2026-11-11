# Recon: fix-notify-stream-contract

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached @ origin/main-dev c4fd48b0a (no `feature/fix-notify-stream-contract` on origin yet). Discovery digests arrived UNSTAMPED; every `path:line` cited below was re-grepped at this tree.
**Affected services**: xstockstrat-notify

---

## Objective

Fix two SEV-3 defects in notify's `StreamAlerts` fan-out. First, `StreamSubscriber.severities` is typed `number[]` but carries ts-proto `stringEnums` strings at runtime, and only a numeric test covers it. The fix types it as `AlertSeverity` and tests the string form from the wire. Second, `emitAlert` ignores `write()`'s `false` (buffer-full) return, so a stalled client buffers alerts in server memory without bound. The fix evicts or ends the stream of a subscriber that stays backpressured past a threshold. The client reconnects and pages history through `ListAlerts`.

## Codebase Map

- **`xstockstrat-notify`** (Node.js / TypeScript)
  - Handler/servicer: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`
    - `StreamSubscriber.severities: number[]` — `:15`
    - `private subscribers: Map<string, StreamSubscriber>` — `:22`
    - subscriber gauge `observeStreamSubscribers(() => this.subscribers.size)` — `:30`
  - Fan-out (`emitAlert`):
    - DB insert converts severity with `alertSeverityToNumber(req.severity)` — `:54`
    - the fan-out alert keeps the **string** `severity: req.severity` — `:70`
    - loop does `sub.call.write(alert)` / `deliveredCount++` — `:87-88`; the return value is discarded
    - only a `throw` evicts: `this.subscribers.delete(subId)` + `recordStreamEviction('write_error')` — `:90-91`
  - Registration (`streamAlerts`):
    - `severities: req.severities ?? []` — `:132`, with no conversion
    - `call.on('cancelled')` deletes the subscriber — `:144-146`
    - `call.on('error')` deletes it and calls `recordStreamEviction('stream_error')` — `:148-150`
    - no `drain` listener
  - Filter: `matchesSubscriber` compares `sub.severities.includes(alert.severity)` — `:288`, string vs string at runtime
  - Imports: `alertSeverityToNumber, alertSeverityFromJSON` from `'@xstockstrat/proto/notify/v1/notify'` — `:3`
  - The `AlertSeverity` type is exported from that module: it is already imported at `src/fanout/fanout.ts:6` and `src/fanout/webPush.ts:8`, both as `alert.severity as AlertSeverity`
  - Telemetry: `services/xstockstrat-notify/src/telemetry.ts`
    - `export type StreamEvictionReason = 'write_error' | 'stream_error'` — `:322`
    - counter `notify.stream.evictions` — `:329`
    - `recordStreamEviction(reason)` — `:339`
  - Last migration: `003_alert_reads.up.sql` (`services/xstockstrat-notify/migrations/`); next free is `004`. None is needed.
  - Config-read pattern: `ConfigWatcher`
    - `getString` — `src/services/configWatcher.ts:203`
    - `getInt` — `:209`
    - `getFloat` — `:216`
    - read live per dispatch by `FanoutDispatcher` / `WebPushDispatcher` (NOTIFY-3, `docs/context-constitution.md:17`)
  - Proto: `enum AlertSeverity` — `packages/proto/notify/v1/notify.proto:57-63` (UNSPECIFIED=0, INFO=1, WARNING=2, ERROR=3, CRITICAL=4)
  - Tests: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`, run by `pnpm test` = `tsc && node --test dist/__tests__/*.test.js` (`package.json:12`)
    - `makeImpl` — `:51`
    - `recordingFanout` — `:84`
    - `makeAlert` (defaults `severity: 2`) — `:113`
    - `emitAndFlush` — `:331`
    - `REQ` (defaults to the string `'ALERT_SEVERITY_WARNING'`) — `:359`
    - the numeric-only severity test is `makeAlert({ severity: 3 })` + `severities: [1, 2]` — `:633-634`. It is a negative case only.
    - the feature-294 eviction test — `:687-708`

## Patterns to REUSE

- **String-typed severity filter**: type `severities` as `AlertSeverity[]` with the existing import pattern `import { ..., AlertSeverity } from '@xstockstrat/proto/notify/v1/notify'` (`src/fanout/fanout.ts:6`). Keep the string-vs-string compare at `notifyServiceImpl.ts:288`, as NOTIFY-1 requires (`docs/context-constitution.md:16`: "fan-out keeps the **string**"). Ledger rule (fails.md:1576-1578): decode proto enums by string constant, and never index a numeric map with a decoded enum.
- **Backpressure eviction**: reuse the eviction idiom from `notifyServiceImpl.ts:90-91`, which is `this.subscribers.delete(subId)` + `recordStreamEviction(<reason>)` + `log.warn('StreamAlerts subscriber evicted', { reason })`. Deleting from the map keeps the `notify.stream.subscribers` gauge (`:30`) accurate without extra work.
- **Eviction reason**: widen `StreamEvictionReason` (`src/telemetry.ts:322`) rather than adding a new counter. The label set stays closed; CLAUDE.md:112 says "Label values are closed sets".
- **Threshold**: a code constant is the default path. `services/xstockstrat-notify/CLAUDE.md:112` says: "Any fixed value below (N, caps, truncation lengths) is a code constant, not a config key." If design chooses a config key instead, reuse `ConfigWatcher.getInt` (`configWatcher.ts:209`).
- **AC-1 / AC-2 tests**: copy the mock-call shape from the feature-294 test (`notifyServiceImpl.test.ts:687-708`), `{ request: {...}, on() {}, write(alert) {...} }` driven by `impl.streamAlerts(...)` + `emitAndFlush(impl, REQ(...))`. Assert on `(impl as any).subscribers.size` and `counterValue(reader, 'notify.stream.evictions', 'reason', ...)`.
  - AC-1: build the request with `severities: ['ALERT_SEVERITY_WARNING', 'ALERT_SEVERITY_CRITICAL']`.
  - AC-2: build the call with `write() { return false; }`.
  - Mocks must provide `on`, because `streamAlerts` registers listeners.
- **Fixtures** (C-13): use the test file's own helpers (`makeImpl`, `REQ`, `makeAlert`) and add no new inline domain data shapes.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-32` "A failed stream write evicts the subscriber visibly" (`services/xstockstrat-notify/acceptance/signal-map-instrumentation.feature`). A throwing `write` must still evict with reason `write_error` (`:16`), and the gauge must read 2 for the remaining subscribers.
- **EXTEND** `@AC-32`. The backpressure eviction is a new case alongside it and needs its own reason value (e.g. `backpressure` / `slow_consumer`). It must also remove the subscriber from the map so the gauge stays accurate. The closed `reason` set `write_error|stream_error` is documented at `services/xstockstrat-notify/CLAUDE.md:115`, so the doc must change in the same step.
- **PRESERVE** `@AC-1` "An untargeted alert is not Web-Pushed to any non-admin user's devices" (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`). In-process StreamAlerts subscribers must still receive an untargeted WARNING alert.
- **PRESERVE** `@AC-5` "Push dispatch never fails or delays the primary emit" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). `EmitAlert` must still return success with an `alert_id`, and stream subscribers (ERROR severity) must still receive the alert. Eviction must never fail or delay `EmitAlert`.
- **PRESERVE** `@AC-4` "A Slack webhook timeout does not delay or drop the primary stream" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`). The ordering of the primary stream and the `queueMicrotask` side-channels must not change.
- `docs/sdd/business-rules/platform.feature`: no cross-cutting rule constrains StreamAlerts fan-out. The adjacent `notify.fanout.min_severity` key gates external fanout, not the stream filter.
- No CHANGE flags. New AC-1 and AC-2 add behavior and become `@feature-316` on promotion (C-16).

## Dependencies

- Proto/RPC: none. `AlertSeverity` (`notify.proto:57-63`) and `StreamAlerts` are unchanged.
- Migration: none. Notify's next free number would be `004`.
- Config keys: none if the threshold is a code constant (the recommended default). The options:
  - A new `stream.<threshold>` key under namespace `notify` would need three things together (C-05): a seed migration in `xstockstrat-config`, a row in notify's `CLAUDE.md` § Config Keys Consumed, and a log entry in `docs/patterns/config-governance.md`.
  - `notify.stream.max_subscribers` is no longer documented. Commit `adf411c3` dropped it as a dead key (`docs/context-constitution-findings.md:44`), and `src/` has zero hits for it. The product-spec's "documented … default 1000" is stale, so enforcing it would mean re-introducing a key.
- Inter-service edges: none.
- New env vars / ports: none.

## Risks / Not-found

- **Stale spec premise**: Open Question 2 assumes `notify.stream.max_subscribers` is "documented but unread". It is now neither. Design should treat it as out of scope or as a new key, not as "start enforcing an existing key".
- **Slow-consumer policy** (Open Question 1): AC-2's Then allows "removed from the fan-out set **or** its stream is ended".
  - Ending the stream without deleting the map entry would leave the AC-32 gauge stale.
  - Whichever action is chosen must delete from `this.subscribers` and record a reason.
  - The threshold unit (consecutive `false` writes, pending-message count, or time without `drain`) is undecided.
- **`call.end()` / `call.destroy()`**: no existing use on a grpc-js server-stream call in notify `src/`. The only `.end()` hits are `pool.end()` (`src/index.ts:66`) and test spans. The grpc-js API is unverified here (F-04: confirm before citing). `StreamSubscriber.call` is untyped (`any`), so the compiler will not help.
- **`drain` handling**: notify has no `'drain'` listener today. If design counts pending writes and resets on `drain`, the mock `on()` must accept `'drain'`, and a mock that never emits it models the stalled client.
- **Doc/telemetry drift on a new reason**: `CLAUDE.md:115` (Observability instruments line) lists `reason write_error|stream_error`. `src/__tests__/telemetryAllowlist.test.ts:31` lists `MIN_INSTRUMENTS` by name and records only `write_error` (`:36`). It does not appear to constrain label values, but this was not fully verified.
- **Severity-mismatch records to retire** when the type is fixed:
  - `services/xstockstrat-notify/docs/context-constitution.md:31` (gotcha)
  - `services/xstockstrat-notify/docs/context-constitution-findings.md:24` (open row) and `:60` (report index)
  - the `CLAUDE.md:4` banner, which names "`severities` type/runtime mismatch"
- **Ledger traps**:
  - fails.md:1576-1578 (string enums under `stringEnums=true`): the original cause of this bug.
  - fails.md:1566: a config key with an aspirational comment and no reader or seed. Applies only if a key is chosen.
  - fails.md:2699-2701: config-seed migrations are numbered in `xstockstrat-config`'s own series, not notify's.
- **Overlap**: `xstockstrat-notify` is also touched by features 312, 323 and 324 (sdd-review WARN). `notifyServiceImpl.ts` and `telemetry.ts` may conflict, so check merge order before execute.
- **Reproduction**: per the report, a grpc-js client that simply never reads does not reproduce the bug. Only a raw HTTP/2 `pause()` does. The unit test must model it as `write()` returning `false` with no `drain`, not as a real socket.

## Recommended Scope

Advisory, two steps:

1. **Severity typing (AC-1)**
   - Change `StreamSubscriber.severities` to `AlertSeverity[]`.
   - Add a positive string-form `streamAlerts` + `emitAlert` test (WARNING/CRITICAL subscriber gets CRITICAL and not INFO).
   - Convert the numeric `matchesSubscriber` test at `:633-634` to string form.
   - Retire the mismatch records in notify's `docs/context-constitution*.md` and the `CLAUDE.md` banner.
2. **Backpressure eviction (AC-2, extends AC-32)**
   - In the `emitAlert` loop, track `write()` returning `false` per subscriber against a code-constant threshold.
   - Past the threshold, delete the subscriber, record a new `StreamEvictionReason`, log, and best-effort end the call.
   - Widen the type at `telemetry.ts:322` and update `CLAUDE.md:115`.
   - Add an AC-2 test and keep the AC-32 test green.
   - Keep `notify.stream.max_subscribers` out of scope unless design decides otherwise and adds the seed migration (C-05).
