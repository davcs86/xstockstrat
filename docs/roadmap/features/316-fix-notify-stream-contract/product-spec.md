# Product Spec: fix-notify-stream-contract

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md, docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### StreamAlerts severities filter typed number[] but carries string enums at runtime (SEV-3)

- **Observed:** `StreamSubscriber.severities` is `number[]`, but under ts-proto `stringEnums` both the request's
  `severities` and `alert.severity` are strings; the `includes` match works only because runtime types happen to
  agree. The only unit test uses numeric `[1, 2]`, so numeric-converting one side passes CI and silently stops all
  severity-filtered subscribers from receiving alerts.
- **Expected:** the field is typed as the ts-proto `AlertSeverity` string enum, and the filter is tested with the
  string form that arrives on the wire.
- Report: [docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md](../../../reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md)

### StreamAlerts fan-out ignores write backpressure (unbounded buffering) (SEV-3)

- **Observed:** `emitAlert` calls `sub.call.write(alert)` for every matching subscriber and drops one only if
  `write` throws; the `false` (buffer full) return is discarded and there is no `drain` handling. A stalled client
  accumulates every alert in server memory; `notify.stream.max_subscribers` is not enforced. Reproduced on grpc-js
  1.14.5: `write()` returned false from the 16th message, server queue reached 299,937 messages, RSS 59 → 476 MB for
  300,000 1 KB writes, never evicted.
- **Expected:** when `write` returns `false` past a threshold, the subscriber is dropped or its stream ended; it
  reconnects and pages history via `ListAlerts`.
- Report: [docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md](../../../reports/2026-10-19-notify-stream-ignores-backpressure-defect.md)

## Reproduction Steps

1. Severity type: in `matchesSubscriber`, convert `alert.severity` with `alertSeverityToNumber`; the existing
   numeric test still passes while real string-enum subscribers match nothing.
2. Backpressure: open a `StreamAlerts` client that stops reading at the raw HTTP/2 level (raw Node `http2` client
   calling `pause()`; a grpc-js client that merely never reads does not reproduce); call `EmitAlert` in a tight
   loop; notify RSS grows without bound and no subscriber is evicted.

## Root Cause Hypothesis

- The interface was hand-typed from the numeric proto enum before `stringEnums`; handlers are `any`, so the
  compiler never flags it.
- The fan-out treats `write` as synchronous delivery; grpc-js buffers the server-stream write queue without limit.
- Current sites (main-dev 0fecb24d): `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:15` (`severities:
  number[]`), `:87` (`sub.call.write(alert)`), `:288` (`sub.severities.includes(alert.severity)`); test
  `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` `:634` (numeric `severities: [1, 2]`).

## Affected Services

- xstockstrat-notify

## Fix Scope

- Proto changes anticipated: **no** — both fixes are in notify's TypeScript fan-out and its tests.
- DB migrations anticipated: **no** — no schema involvement.
- Config key changes anticipated: **yes (likely)** — a backpressure threshold may need a key, and the documented but
  unread `notify.stream.max_subscribers` (default 1000) may start being enforced.

## Open Questions

1. Slow-subscriber policy: drop the subscriber vs. end its stream, and the threshold (pending writes / bytes / time).
2. Whether enforcing `notify.stream.max_subscribers` belongs in this fix or stays out of scope.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Client-side buffering in grpc-js clients that never read (the report notes it does not affect notify's memory).
- Refactoring unrelated to the bug; performance improvements unrelated to the fix.
