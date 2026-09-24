# Design: alert-read-unread-persistence

**Created**: 2026-09-24
**Rounds**: 3 (quick; termination: approved)
**Approved by**: user @ 2026-09-24
**Grounded in**: recon.md

---

## Chosen Approach

A per-user read/unread model realized as a `notify.alert_reads` join table, a new `MarkAlertRead`
RPC, and `ListAlerts` extensions — staying within the existing `xstockstrat-notify` inline-SQL-in-
handler pattern and the single-connection pool budget.

### Data Layer

- **New table** `notify.alert_reads (alert_id UUID, user_id TEXT, read_at TIMESTAMPTZ, PRIMARY KEY
  (alert_id, user_id))` — migration `003_alert_reads.up.sql`. Absence of a row = unread. PK alone
  covers both lookup patterns (MarkAlertRead by `(alert_id, user_id)`, ListAlerts LEFT JOIN by
  `alert_id`). No secondary index on `(user_id)` — recon confirms no query path needs it
  (`recon.md:94`).

### Proto Contract

- `MarkAlertRead` RPC on `NotifyService` — request: `repeated string alert_ids`, owner from
  propagated `x-user-id` header (C-03), never the body (`recon.md:24`, `product-spec.md` FR-2).
- `Alert` gains `bool read = 13` and `google.protobuf.Timestamp read_at = 14` — populated per the
  calling user on `ListAlerts` responses; `StreamAlerts` sets `read = false` trivially at stream
  time (product-spec review note, `context.md:54-56`).
- `ListAlertsRequest` gains `bool unread_only = 5`; `ListAlertsResponse` gains `int32 unread_count
  = 3`. All additive, non-breaking (`recon.md:93`).

### Notify Service (`notifyServiceImpl.ts`)

- **`MarkAlertRead` handler**: `INSERT INTO notify.alert_reads (alert_id, user_id, read_at)
  SELECT unnest($1::uuid[]), $2, NOW() WHERE EXISTS (SELECT 1 FROM notify.alerts WHERE alert_id =
  id) ON CONFLICT DO NOTHING`. The `WHERE EXISTS` suppresses FK-violating phantom IDs (R2 adversary
  catch: `ON CONFLICT DO NOTHING` alone doesn't suppress FK violations). Idempotent —
  `ON CONFLICT DO NOTHING` preserves original `read_at` (AC-3).
- **`ListAlerts` handler**: Two queries via `Promise.all` — (1) main query with `LEFT JOIN
  notify.alert_reads ar ON a.alert_id = ar.alert_id AND ar.user_id = $userId` for per-row
  `read`/`read_at`, plus optional `WHERE ar.alert_id IS NULL` when `unread_only = true`; (2)
  separate `SELECT COUNT(*) FROM notify.alerts a WHERE ... AND NOT EXISTS (SELECT 1 FROM
  notify.alert_reads ar WHERE ar.alert_id = a.alert_id AND ar.user_id = $userId)` for
  `unread_count`. `Promise.all` serializes at pool-max-1 (no deadlock); auto-parallels if pool
  grows.
- **`ListAlerts` user-scoping**: Owner resolved from `metadata.get('x-user-id')?.[0]`, replacing
  the current body-based `req.userId` at `:165`. This is an **intentional security tightening**: the
  current path has a pre-existing gap where `req.userId` is null (the BFF's `forward()` sends no
  `userId` body field), causing `$1::text IS NULL` to match ALL alerts including other users'. The
  blast radius is contained — only the UI BFF and E2E mocks call `ListAlerts` (`recon.md:57`).
- **Limit handling**: `req.limit > 0 ? req.limit : 50` — not `?? 50` (proto3 zero-default trap:
  `0` is not `null`/`undefined`), not `|| 50` (falsy trap: `0` is falsy in JS).
- **Badge optimization**: Unread count for the header badge uses `ListAlerts` with `limit: 1` to
  retrieve just the `unread_count` without loading the full alert list.
- **Identity fallback**: `metadata.get('x-user-id')?.[0] || req.userId || null` for the
  MarkAlertRead handler specifically, to support both header-based (BFF) and body-based
  (direct gRPC test) callers.

### UI (`xstockstrat-ui`)

- **`alertShared.ts`** — extracted from `AlertStream.tsx:12-18`: `severityLabel` and
  `severityVariant` Records, reused by both `AlertStream` and the new notifications inbox.
  Follows the `Record<ProtoEnum, EnumRender>` pattern from `opportunityShared.tsx:28-70`
  (`recon.md:68`).
- **AlertInbox component** on `/accounts/notifications` — calls `listAlerts` via BFF, renders
  each alert's read/unread state, severity badge, category/source_service (module), body, and
  a mark-as-read control wired to `markAlertRead`.
- **AlertStream badge refactor** — replaces client-side `alerts.length` count (`AlertStream.tsx:41`)
  with server-side `unread_count` from `ListAlerts` response.
- **BFF wiring**: `markAlertRead` route added to the trader BFF via `forward()` helper
  (`bffShared.ts:60`, `recon.md:66`). `notifyClient.ts` gains the `markAlertRead` call.
- **Consumer surface (C-14)**: `/trader` (AlertStream badge) and `/accounts/notifications`
  (AlertInbox).

### Tests

- **Notify unit tests** (`notifyServiceImpl.test.ts`): `capturingPool()` mock for SQL assertion,
  `metaCall()` helper to inject `x-user-id` metadata. Cases: mark read idempotency, mark read
  with phantom alert_id (no FK violation), list with read state, unread_only filter, unread_count,
  limit = 0 defaults to 50.
- **E2E**: Mock-backend fixtures extended at `mock-backend.ts:491-553` with read/unread alert
  variants. Specs: mark-as-read interaction, unread badge count, unread_only filter toggle.

## Rejected Alternatives

- **`read_at` column on `notify.alerts`** — rejected: can't model per-user read state for broadcast
  alerts; a single timestamp can't represent "read by user A, unread for user B".
- **Sequential `await` instead of `Promise.all`** — rejected: less forward-compatible; loses
  automatic parallelism if pool-max increases. `Promise.all` is the correct pattern.
- **Single query with `COUNT(*) FILTER ... OVER()` window function** — rejected: more complex SQL,
  count repeated on every row (wasteful), marginal benefit at the 50-row cap.
- **`req.limit ?? 50`** — rejected: proto3 zero-default trap; `0` is the default, not
  `null`/`undefined`, so `??` doesn't catch it.
- **Secondary index on `alert_reads(user_id)`** — rejected: no query path uses a user_id-leading
  lookup on the read-marks table; PK `(alert_id, user_id)` suffices.
- **Separate repository layer** — rejected: inconsistent with the existing notify handler pattern
  (inline SQL); adds abstraction the task didn't ask for.

## Open Risks

- [ ] **Pool-max-1 latency** — the two-query `Promise.all` serializes today. If alert volume
  grows and latency matters, the window-function alternative or a pool increase can mitigate.
  To be validated at implementation via timing assertions in unit tests.
- [ ] **Broadcast entitlement scope** — product-spec OQ: "what defines a broadcast alert the user
  is entitled to see?" Current implementation treats all broadcasts as visible to all users.
  Per-scope filtering is a follow-up if needed. Unread count includes all visible broadcasts.

## Constitution Rules Touched

- `C-03` — honored by: owner resolved from propagated `x-user-id` header, not request body.
- `C-04` — honored by: no new enum introduced (read/unread is a boolean, not an enum).
- `C-10` — honored by: all proto additions are additive; `read`/`read_at` on `Alert` populated by
  `ListAlerts` and trivially `false`/absent on `StreamAlerts`.
- `C-14` — honored by: consumer surface documented (`/trader` AlertStream + `/accounts/notifications`
  inbox); both surfaces carry the change through to the user.
- `C-16` — honored by: all 13 PRESERVE business rules from recon.md respected; `ListAlerts`
  user-scoping change documented as intentional security tightening.
- `F-04` — honored by: all path:line citations verified against live codebase in R3.
- `F-11` — honored by: no Floor breaches across 3 rounds.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @FR-1 @feature-020` "A WARNING alert is fanned out to Slack" — not regressed by:
  emission + fanout path untouched; MarkAlertRead is a separate RPC on a separate table.
- PRESERVE `@AC-4 @FR-6 @feature-020` "A Slack webhook timeout does not delay the primary stream"
  — not regressed by: read-state writes are in MarkAlertRead, not EmitAlert or StreamAlerts.
- PRESERVE `@AC-4 @FR-3 @feature-165` "An emitted alert is pushed to the target user's devices"
  — not regressed by: EmitAlert response shape and timing unchanged.
- PRESERVE `@AC-5 @FR-3 @feature-165` "Push dispatch never fails or delays the primary emit"
  — not regressed by: read-state is a separate table and RPC; no coupling to EmitAlert.
- PRESERVE all remaining 9 feature-020/165/171 business rules per recon.md — no code path overlap.
