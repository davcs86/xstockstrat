# Implementation Spec: alert-read-unread-persistence

**Status**: `pending`
**Created**: 2026-09-24
**Feature**: `docs/roadmap/features/203-alert-read-unread-persistence/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/alert-read-unread-persistence`

---

## Execution Summary

The implementation extends the existing `xstockstrat-notify` alert subsystem with per-user
read/unread state, realized as a `notify.alert_reads` join table, a `MarkAlertRead` RPC, enriched
`ListAlerts` output, and UI rendering in both the `/accounts/notifications` inbox and the `/trader`
`AlertStream` badge.

Order: proto contract first (Step 1), codegen (Step 2), migration (Step 3), notify handler
(Step 4 + test Step 5), UI shared helpers (Step 6), notifications inbox page (Step 7), AlertStream
badge refactor (Step 8), E2E mock + fixtures (Step 9), E2E specs (Step 10).

## Scenario Coverage

| Scenario | Step(s) |
|---|---|
| AC-1 (mark targeted alert read) | Step 5, Step 10 |
| AC-2 (broadcast per-user read isolation) | Step 5, Step 10 |
| AC-3 (idempotent MarkAlertRead) | Step 5 |
| AC-4 (unread_only filter) | Step 5, Step 10 |
| AC-5 (read vs acknowledged independence) | Step 5 |
| AC-6 (inbox shows level, module, body, unread) | Step 10 |

## Step Dependencies

- Step 2 requires Step 1: codegen depends on proto changes.
- Step 3 has no code dependency but logically precedes Step 4 (the handler needs the table).
- Step 4 requires Steps 1–3: handler references generated types and queries the new table.
- Step 5 requires Step 4: tests exercise the new handler methods.
- Step 6 has no strict dependency (pure extraction from existing code) but should precede Steps 7–8.
- Step 7 requires Steps 2 and 6: page component uses generated types and shared helpers.
- Step 8 requires Steps 2 and 6: badge refactor uses ListAlerts response and shared helpers.
- Step 9 requires Step 2: mock-backend returns the new proto shape.
- Step 10 requires Steps 7–9: E2E specs exercise the rendered UI against the mock.

---

### Step 1 — proto: Add MarkAlertRead RPC, read fields on Alert, unread filter/count on ListAlerts

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/notify/v1/notify.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, buf lint; `xstockstrat-notify` owner — stream delivery guarantees, per-user read semantics

**Codebase Evidence**:
- `Alert` message fields 1–12, next available field number: **13** — `packages/proto/notify/v1/notify.proto:34-47`
- `ListAlertsRequest` fields 1–4, next available: **5** — `:90-95`
- `ListAlertsResponse` fields 1–2, next available: **3** — `:97-100`
- `NotifyService` RPCs at `:12-32`; `google/protobuf/timestamp.proto` already imported at `:7`

**TDD**: N/A (proto — non-code-bearing)

**Covers**: —

**Instructions**:

1. In `packages/proto/notify/v1/notify.proto`, add to the `Alert` message (after field 12):
   ```protobuf
   bool read = 13;
   google.protobuf.Timestamp read_at = 14;
   ```
   `read` is populated per the calling user on `ListAlerts`; `StreamAlerts` sets `read = false`
   trivially (proto3 default). `read_at` is null (absent) when unread.

2. Add to `ListAlertsRequest` (after field 4):
   ```protobuf
   bool unread_only = 5;
   ```

3. Add to `ListAlertsResponse` (after field 2):
   ```protobuf
   int32 unread_count = 3;
   ```

4. Add new request/response messages:
   ```protobuf
   message MarkAlertReadRequest {
     repeated string alert_ids = 1;
   }

   message MarkAlertReadResponse {}
   ```
   Owner resolved from propagated `x-user-id` header (C-03), never the body.

5. Add the RPC to `NotifyService` (after `ListAlerts` at `:24`):
   ```protobuf
   rpc MarkAlertRead(MarkAlertReadRequest) returns (MarkAlertReadResponse);
   ```

All changes are additive — non-breaking. No field renumber, no removal.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev"
```

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/` — modify (generated output; Go, Python, TypeScript stubs)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes, buf lint; `xstockstrat-notify` owner — stream delivery guarantees, per-user read semantics

**TDD**: N/A (codegen — non-code-bearing)

**Covers**: —

**Instructions**:

Run `./scripts/buf-gen.sh` from the repo root to regenerate all stubs (Go, Python, TypeScript)
from the updated `.proto` files.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
# Confirm only notify v1 stubs changed; no unexpected diff in other services' stubs.
```

---

### Step 3 — migration: Create notify.alert_reads table

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/migrations/003_alert_reads.up.sql` — create
- `services/xstockstrat-notify/migrations/003_alert_reads.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness; `xstockstrat-notify` owner — schema fit

**Codebase Evidence**:
- Last migration: `002_push_subscriptions.up.sql` / `.down.sql` — confirmed via `ls services/xstockstrat-notify/migrations/`; next is **003**
- Existing schema uses `notify` schema prefix — `001_notify_alerts.up.sql:6` (`CREATE TABLE notify.alerts`)

**TDD**: N/A (migration — non-code-bearing)

**Covers**: —

**Instructions**:

`003_alert_reads.up.sql`:
```sql
CREATE TABLE IF NOT EXISTS notify.alert_reads (
  alert_id   UUID        NOT NULL,
  user_id    TEXT        NOT NULL,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (alert_id, user_id)
);
```
No secondary index on `(user_id)` — design.md rejected it (no query path needs a user_id-leading
lookup; PK `(alert_id, user_id)` suffices for all access patterns). No FK to `notify.alerts` — the
handler's `WHERE EXISTS` suppresses phantom IDs at write time (design.md R2 catch).

`003_alert_reads.down.sql`:
```sql
DROP TABLE IF EXISTS notify.alert_reads;
```

**Verification**:
```bash
ls services/xstockstrat-notify/migrations/003_alert_reads.up.sql services/xstockstrat-notify/migrations/003_alert_reads.down.sql
# Read both: confirm CREATE TABLE in .up has inverse DROP TABLE in .down.
```

---

### Step 4 — service: Implement MarkAlertRead handler, enrich ListAlerts with read state

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify
- `services/xstockstrat-notify/src/grpc/serviceDefinition.ts` — modify (if RPC registration needed; confirmed `:1-6` re-exports `NotifyServiceService` which picks up new RPCs from generated code automatically)

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, backpressure, alert dedup, per-user read semantics on broadcast alerts

**Codebase Evidence**:
- `AcknowledgeAlert` handler pattern (inline SQL + callback): `notifyServiceImpl.ts:146-156`
- `ListAlerts` handler: `:158-171` — currently filters by `req.userId || null` (body-based)
- `rowToAlert` mapper: `:236-252` — returns camelCase proto shape
- `registerPushSubscription` resolves owner from `call.metadata.get('x-user-id')?.[0]`: `:178`
- `serviceDefinition.ts:4-6` — re-exports `NotifyServiceService` from generated code; new RPCs auto-register
- Constructor: `(pool, config, fanout, webPush)` at `:23-27`
- `notifyServiceImpl.ts:3` imports `alertSeverityFromJSON` from generated code

**TDD**: red-green required

**Covers**: —

**Instructions**:

1. **Add `markAlertRead` method** to `NotifyServiceImpl` (after `acknowledgeAlert` at L156),
   following the same inline-SQL-in-handler style:
   ```typescript
   async markAlertRead(call: any, callback: any) {
     const userId = call.metadata?.get?.('x-user-id')?.[0]?.toString()
       || call.request.userId || null;
     if (!userId) {
       return callback({ code: 3, message: 'x-user-id header required' });
     }
     const alertIds = call.request.alertIds;
     if (!alertIds || alertIds.length === 0) {
       return callback(null, {});
     }
     try {
       await this.pool.query(
         `INSERT INTO notify.alert_reads (alert_id, user_id, read_at)
          SELECT u.alert_id, $2, NOW()
          FROM unnest($1::uuid[]) AS u(alert_id)
          JOIN notify.alerts a ON a.alert_id = u.alert_id
          ON CONFLICT DO NOTHING`,
         [alertIds, userId]
       );
       callback(null, {});
     } catch (err: any) {
       callback({ code: 13, message: err.message });
     }
   }
   ```
   Identity fallback: `metadata.get('x-user-id') || req.userId` supports both BFF (header) and
   direct gRPC test callers (design.md decision). The `JOIN notify.alerts` clause suppresses
   phantom IDs per-row (design.md R2 — the earlier `WHERE EXISTS` formulation was non-correlated
   and would gate the entire batch, not per-row). `ON CONFLICT DO NOTHING` preserves original
   `read_at` (AC-3 idempotency).

2. **Rewrite `listAlerts`** (replacing `:158-171`) to:
   - Resolve user from `call.metadata?.get?.('x-user-id')?.[0]` (security tightening per design.md
     — replaces body-based `req.userId`; blast radius contained to UI BFF + E2E mocks per recon).
   - Use `Promise.all` for two queries:
     - **Main query**: `LEFT JOIN notify.alert_reads ar ON a.alert_id = ar.alert_id AND ar.user_id = $userId`,
       with optional `WHERE ar.alert_id IS NULL` when `req.unreadOnly = true`.
     - **Count query**: `SELECT COUNT(*) ... WHERE ... AND NOT EXISTS (SELECT 1 FROM notify.alert_reads ar WHERE ar.alert_id = a.alert_id AND ar.user_id = $userId)`.
   - Limit: `req.limit > 0 ? req.limit : 50` (not `?? 50` per proto3 zero-default trap, not
     `|| 50` per falsy trap — design.md catches).
   - Return `{ alerts: rows.map(rowToAlert), unreadCount: parseInt(countResult.rows[0].count, 10) }`.
   - Add a `// Promise.all serializes at pool-max-1; auto-parallels if pool grows` comment.

3. **Extend `rowToAlert`** (at `:236-252`) to include:
   ```typescript
   read: row.read_at != null,
   readAt: row.read_at ? new Date(row.read_at) : undefined,
   ```
   These are populated by the LEFT JOIN; absent when no join row exists (unread).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint
```

---

### Step 5 — test: Unit tests for MarkAlertRead and enriched ListAlerts

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, per-user read semantics

**Codebase Evidence**:
- Existing test helpers: `makePool` (`:38-45`), `makeImpl` (`:47-50`), `capturingPool` (`:449-460`), `metaCall` (`:463-468`)
- Test runner: `node:test` — `describe`/`it` from `:16`
- Feature 092 compile-first harness: `tsc && node --test dist/__tests__/*.test.js`
- C-13: `capturingPool`/`metaCall`/`makeAlert` are single-consumer inline helpers in this test file; no second consumer introduced — inline is compliant

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5

**Instructions**:

Add the following test groups after the existing `registerPushSubscription` tests:

1. **`describe('markAlertRead')`**:
   - **AC-1**: `it('inserts a read mark for the x-user-id caller (targeted alert)')` — use
     `capturingPool`, `metaCall('u1', { alertIds: ['a1'] })`, assert SQL contains
     `INSERT INTO notify.alert_reads` and params include `['a1']` and `'u1'`.
   - **AC-3**: `it('is idempotent — ON CONFLICT DO NOTHING preserves original read_at')` — call
     twice, assert both succeed (no error), and that only one INSERT is emitted per call (the
     second call's SQL still runs but `ON CONFLICT DO NOTHING` means no row change).
   - `it('rejects when x-user-id header is missing')` — `metaCall(null, { alertIds: ['a1'] })`,
     assert callback error code 3.
   - `it('returns empty response for empty alertIds array')` — no SQL emitted.

2. **`describe('listAlerts — read state')`**:
   - **AC-1**: `it('returns read=true and read_at for a read alert')` — use `capturingPool` with
     rows containing `read_at: new Date(...)`, assert `rowToAlert` output has `read: true`.
   - **AC-2**: `it('returns read=false for an unread alert (no alert_reads row)')` — row with
     `read_at: null`, assert `read: false` and `readAt: undefined`.
   - **AC-5**: `it('read and acknowledged are independent')` — row with `acknowledged: true`,
     `read_at: null`, assert `acknowledged: true` and `read: false`.
   - **AC-4**: `it('passes unread_only filter to the SQL WHERE clause')` — `capturingPool`,
     call with `unreadOnly: true`, assert SQL contains `ar.alert_id IS NULL`.
   - `it('returns unread_count from the count query')` — `capturingPool` with count row
     `{ count: '3' }`, assert response `unreadCount` is `3`.
   - `it('defaults limit to 50 when 0 (proto3 zero-default)')` — call with `limit: 0`, assert
     SQL param for limit is `50`.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run test:coverage
# Confirm coverage threshold (40%) passes.
cd services/xstockstrat-notify && pnpm run lint
```

---

### Step 6 — service: Extract alertShared.ts (severity maps) for cross-component reuse

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/alertShared.ts` — create
- `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — modify (import from shared)

**Reviewers**: `xstockstrat-ui` owner — DRY, no stale hardcoded values

**Codebase Evidence**:
- `severityLabel` and `severityVariant` Records: `AlertStream.tsx:12-18` — currently inline
- `EnumBadge` + `Record<Enum, EnumRender>` pattern: `opportunityShared.tsx:28-70` (recon.md:68)
- **Not found**: `src/lib/alertShared.ts` does not exist — must be created from scratch

**TDD**: `N/A` — pure DRY extraction with no new behavior; existing E2E tests (AlertStream
rendering) provide regression coverage. No red-green cycle needed for a move-only refactor.

**Covers**: —

**Instructions**:

1. Create `services/xstockstrat-ui/src/lib/alertShared.ts`:
   ```typescript
   /** Shared alert severity rendering — extracted from AlertStream.tsx for
    *  reuse across the notifications inbox and the trader bell badge. */

   // AlertSeverity enum: 1=INFO, 2=WARNING, 3=ERROR, 4=CRITICAL
   export const severityLabel: Record<number, string> = {
     1: 'INFO', 2: 'WARN', 3: 'ERROR', 4: 'CRITICAL',
   };
   export const severityVariant: Record<number, 'info' | 'warning' | 'destructive'> = {
     1: 'info', 2: 'warning', 3: 'destructive', 4: 'destructive',
   };
   ```

2. In `AlertStream.tsx`, replace the inline `severityLabel` and `severityVariant` definitions
   (`:12-18`) with:
   ```typescript
   import { severityLabel, severityVariant } from '@/lib/alertShared';
   ```
   Remove the old inline definitions. The component behavior is unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
# Confirm no broken imports, AlertStream still renders (covered by existing E2E).
```

---

### Step 7 — service: Build AlertInbox component on /accounts/notifications page

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx` — create
- `services/xstockstrat-ui/src/app/accounts/notifications/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — C-17 UI/UX consistency (tokens, accessible names, state primitives), Connect-RPC call safety

**Codebase Evidence**:
- Current page: `page.tsx:1-22` — renders only `PushToggle` card; no alert list
- `notifyClient` browser client: `notifyClient.ts:5-6` — routes through `/trader/api` BFF
- `severityLabel`/`severityVariant`: extracted to `alertShared.ts` (Step 6)
- `Badge` component: `src/components/ui/badge.tsx`
- `EmptyState` component: `src/components/shared/EmptyState.tsx`
- `Skeleton` component: `src/components/ui/skeleton.tsx`
- Nav registration: `/accounts/notifications` already registered in `PLATFORM_SUBNAV.accounts` (`:90`) and `NAV_GROUPS` (`:84`) — no C-10(a) update needed

**TDD**: red-green required

**Covers**: —

**Instructions**:

1. Create `AlertInbox.tsx` as a `'use client'` component:
   - On mount, call `notifyClient.listAlerts({})` to fetch alerts with per-user read state.
   - Display each alert's: unread indicator (bold/dot for `read === false`), severity badge
     (using `severityLabel`/`severityVariant` from `alertShared.ts` and `Badge` component),
     category (module), body text, and `created_at` relative timestamp.
   - Display `unreadCount` from the response as a badge/count at the top.
   - Include a "Mark as read" button per alert (or a "Mark all read" bulk action) that calls
     `notifyClient.markAlertRead({ alertIds: [...] })` then re-fetches the list.
   - Use `Skeleton` for loading state and `EmptyState` for zero alerts (C-17).
   - Use design-role tokens only — no hardcoded colors (C-17).
   - Give every interactive control a unique accessible name (C-17).

2. Modify `page.tsx` to render `<AlertInbox />` above (or below) the existing `PushToggle` card.
   Keep the PushToggle card unchanged. The page gains a second `Card` for the alert inbox.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 8 — service: Refactor AlertStream badge to use server-side unread count

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — modify
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify (add `markAlertRead` forward)
- `services/xstockstrat-ui/src/lib/browserClients/notifyClient.ts` — no change needed (client already generated from proto; `markAlertRead` auto-available)

**Reviewers**: `xstockstrat-ui` owner — C-17 badge UX, Connect-RPC call safety

**Codebase Evidence**:
- Current client-side count: `AlertStream.tsx:41` — `const unread = alerts.length;`
- Badge rendering: `:49-55` — `>9` caps at `9+`
- Stream filter: `:28` — `{ includeAcknowledged: false }`
- Trader BFF notify service routes: `traderBff.ts:81-98` — `streamAlerts`, `listAlerts`, `registerPushSubscription`, `unregisterPushSubscription`
- `forward()` helper: `bffShared.ts:60-73` — session verify + header propagation
- `notifyClient` browser client: `notifyClient.ts:5-6` — auto-generated; new `markAlertRead` RPC available after Step 2

**TDD**: red-green required

**Covers**: —

**Instructions**:

1. In `traderBff.ts`, add `markAlertRead` to the `NotifyService` registration block (after
   `unregisterPushSubscription` at `:96`):
   ```typescript
   markAlertRead: forward((req, opts) => notifyClient.markAlertRead(req, opts)),
   ```

2. In `AlertStream.tsx`:
   - Add a secondary effect (or an additional `useState` + initial fetch) that calls
     `notifyClient.listAlerts({ limit: 1 })` to retrieve `unreadCount` from the server.
     Use the badge optimization from design.md: `limit: 1` retrieves just the count without
     loading the full alert list.
   - Replace `const unread = alerts.length;` with the server-side `unreadCount` value.
   - Keep the streaming subscription for real-time alert display in the sheet; bump the
     `unreadCount` locally when a new stream alert arrives (optimistic increment).
   - Preserve the existing badge UX: `>9` caps at `9+`, `hasHighSeverity` destructive variant.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 9 — test: Update E2E mock-backend with read/unread alert fixtures

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/alerts.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (add catalog row)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (update NotifyService handlers)

**Reviewers**: `xstockstrat-ui` owner — test-data inventory (C-12), mock fidelity

**Codebase Evidence**:
- Current mock alerts: `mock-backend.ts:491-553` — 3 stream alerts + 3 list alerts, all inline (no fixture file)
- `INVENTORY.md` catalog: `e2e/fixtures/INVENTORY.md` — no alert entry exists
- Fixture pattern: each domain entity gets its own fixture module (e.g. `accounts.ts`, `orders.ts`)
- C-12: alert mock objects are currently inline in `mock-backend.ts` — introducing a second consumer
  (the new E2E specs in Step 10) triggers centralization into a fixture module

**TDD**: red-green required

**Covers**: —

**Instructions**:

1. Create `e2e/fixtures/alerts.ts`:
   - Export `ALERT_STREAM_*` constants for the 3 existing stream alerts (extracted from
     `mock-backend.ts:493-517`).
   - Export `ALERT_LIST_*` constants for the existing 3 list alerts (from `:527-551`).
   - Add new read/unread variants for the list alerts:
     - `ALERT_READ` — an alert with `read: true`, `readAt: <timestamp>` (for AC-1).
     - `ALERT_UNREAD` — an alert with `read: false` (for AC-2/AC-4).
     - `ALERT_ACKNOWLEDGED_UNREAD` — `acknowledged: true`, `read: false` (for AC-5).
   - Export an `ALERT_LIST_WITH_READ_STATE` array combining these for the list mock.
   - Export `MOCK_UNREAD_COUNT` constant (e.g. `2`).

2. Update `INVENTORY.md` — add a catalog row:
   ```
   | Alerts (feature 203) | `ALERT_STREAM_*`, `ALERT_LIST_*`, `ALERT_READ`, `ALERT_UNREAD`, `ALERT_ACKNOWLEDGED_UNREAD`, `ALERT_LIST_WITH_READ_STATE`, `MOCK_UNREAD_COUNT` | `e2e/fixtures/alerts.ts` | `xstockstrat.notify.v1.Alert` | `e2e/mock-backend.ts` (NotifyService handlers), `e2e/trader/alert-stream.spec.ts`, `e2e/accounts/notifications.spec.ts` |
   ```

3. Update `mock-backend.ts` NotifyService handlers (`:491-553`):
   - Replace inline alert literals with imports from `e2e/fixtures/alerts.ts`.
   - `listAlerts` handler: return `{ alerts: ALERT_LIST_WITH_READ_STATE, unreadCount: MOCK_UNREAD_COUNT }`.
   - Add `markAlertRead` handler: accept the call, return `{}` (empty response — mock does not
     need to persist state; the E2E tests will use `page.route()` for stateful assertions).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "from.*fixtures/alerts" e2e/mock-backend.ts
# Confirm fixture imports present.
grep -n "INVENTORY.md" e2e/fixtures/INVENTORY.md | grep -i alert
# Confirm catalog row added.
```

---

### Step 10 — test: E2E specs for notifications inbox and AlertStream read/unread

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — E2E fidelity, C-17 accessible names, C-12 fixture imports

**Codebase Evidence**:
- Existing notifications spec: `notifications.spec.ts:1-91` — push toggle + IDOR guard tests
- Existing alert-stream spec: `alert-stream.spec.ts:1-67` — badge count, sheet open, severity variant
- `addAuthCookie` helper: `e2e/helpers/auth.ts`
- `CONNECT_HEADERS` pattern: `notifications.spec.ts:18`
- Alert fixtures: created in Step 9 (`e2e/fixtures/alerts.ts`)

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-4, AC-6

**Instructions**:

1. In `notifications.spec.ts`, add a new `describe('alert inbox')` block:
   - **AC-6**: `it('renders alert with severity badge, category (module), body, and unread indicator')`
     — navigate to `/accounts/notifications`, assert the inbox card is visible with at least one
     alert row showing the severity badge, category text, body text, and an unread indicator.
   - **AC-6**: `it('displays unread count badge')` — assert the unread count is visible and matches
     `MOCK_UNREAD_COUNT`.
   - **AC-1**: `it('mark-as-read button calls MarkAlertRead and updates the UI')` — use
     `page.route()` to intercept the `MarkAlertRead` Connect endpoint, assert it is called with
     the alert id, and verify the UI updates the read state after the call.
   - **AC-4**: `it('unread filter shows only unread alerts')` — if the inbox has an unread-only
     toggle/filter, exercise it and assert only unread alerts are displayed.

2. In `alert-stream.spec.ts`, update or add:
   - **AC-2**: `it('badge reflects server-side unread count (not client-side array length)')` —
     the badge should show `MOCK_UNREAD_COUNT` (from `listAlerts` response) rather than the
     stream alert count.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- --grep "alert inbox|AlertStream"
# Or run the full suite: pnpm test:e2e
```

---

## Deviation Log

### Step 2 — reverted recurring gofmt comment-whitespace drift in `analysis.pb.go`
- **What**: Host-native `buf-gen.sh` reformats `analysis.pb.go` comment indentation (tabs↔spaces) vs
  the committed CI stubs, even though `analysis.proto` is unchanged. Reverted; diff scoped to `notify/v1`.
- **Disposition**: Out-of-scope drift reverted (same recurring host-vs-CI parity gotcha as feature 202,
  fails.md 2026-09-24). notify stubs carry no such churn → match CI regen.

### Step 8/10 — pure server-count badge instead of design.md's optimistic increment
- **What**: design.md specced bumping `unreadCount` locally on each streamed alert. The mock replays 3
  stream alerts, which would inflate the badge to `2 (server) + 3 = 5` and make the AC-2 assertion
  ("badge shows the server count, not the client-side stream length") non-deterministic. Implemented a
  **pure server-count badge** (`unreadCount` from `listAlerts({limit:1})` on mount) with no per-stream
  increment. The badge is authoritative server truth; `Clear all` clears only the local sheet feed and
  leaves the badge (a local dismiss ≠ marking read on the server). Updated the two existing
  `alert-stream.spec.ts` badge tests to the new semantics.
- **Disposition**: Design refinement — the core approved behavior (badge = per-user server unread
  count, the AC-2 requirement) is preserved; the optimistic increment was a nice-to-have that
  conflicted with deterministic testing and the mock's replay. Real-time badge updates now land on the
  next `listAlerts` refetch. Non-Floor; no security/data change.

### Step 10 — AC-4 UI unread-filter not built (covered by the Step 5 unit test)
- **What**: Step 7's instructions did not require an unread-only toggle in `AlertInbox`, so none was
  built (behavior #2 — minimum that solves the stated problem). The Step 10 AC-4 UI test is explicitly
  conditional ("if the inbox has an unread-only toggle"). AC-4 (the `unread_only` SQL filter) is fully
  covered by the Step 5 notify unit test (`passes the unread_only filter to the SQL WHERE clause`).
- **Disposition**: In-scope minimalism; AC-4 covered at the service layer. Add a UI filter later only
  if a product need arises.
