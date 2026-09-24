# Recon: alert-read-unread-persistence

**Created**: 2026-09-24
**From**: product-spec.md
**Affected services**: xstockstrat-notify, xstockstrat-ui, packages/proto

---

## Objective

Add per-user read/unread state for alerts — a `(alert_id, user_id) → read_at` model, a
`MarkAlertRead` RPC, `ListAlerts` unread filtering/counting — so the notification inbox shows
accurate unread counts and mark-as-read controls, independently of the existing operational
`acknowledged` flag and independently per user for broadcast alerts.

## Codebase Map

- **`packages/proto` (notify contract)**
  - `Alert` message fields 1–12, next available: **13** — `packages/proto/notify/v1/notify.proto:34-47`
    - `bool acknowledged = 11` (global, not per-user); no `acknowledged_by`/`acknowledged_at` in proto
  - `AlertSeverity` enum — `:49-55` (UNSPECIFIED=0, INFO=1, WARNING=2, ERROR=3, CRITICAL=4)
  - `ListAlertsRequest` fields 1–4, next: **5** — `:90-95` (`user_id`, `categories`, `limit`, `page_token`)
  - `ListAlertsResponse` fields 1–2, next: **3** — `:97-100` (`alerts`, `next_page_token`)
  - `AcknowledgeAlertRequest` fields 1–2, next: **3** — `:81-84` (`alert_id`, `user_id`)
  - `StreamAlertsRequest` fields 1–4 — `:74-79` (`user_id`, `categories`, `severities`, `include_acknowledged`)
  - `NotifyService` RPCs: `EmitAlert`, `StreamAlerts`, `AcknowledgeAlert`, `ListAlerts`, `RegisterPushSubscription`, `UnregisterPushSubscription` — `:12-32`

- **`xstockstrat-notify`** (Node.js)
  - Entry point: `services/xstockstrat-notify/src/index.ts:15-69` — Pool, ConfigWatcher, NotifyServiceImpl, server start
  - Service handler: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:19` (`NotifyServiceImpl` class)
  - No separate repository layer — SQL queries inline in handler methods
  - `AcknowledgeAlert` handler: `:146-156` — `UPDATE notify.alerts SET acknowledged = true, acknowledged_by = $1, acknowledged_at = NOW() WHERE alert_id = $2`
  - `ListAlerts` handler: `:158-171` — only filters by `user_id` + `limit`; `categories`/`page_token` not yet implemented
  - `rowToAlert` mapper: `:236-252` — does NOT map `acknowledged_by`/`acknowledged_at` from DB rows
  - Fan-out: in-process `Map<string, StreamSubscriber>` (`:21`), no LISTEN/NOTIFY
  - `matchesSubscriber`: `:219-233` — in-memory filter for streaming
  - Service definition: `src/grpc/serviceDefinition.ts:1-6`
  - Config watcher: `src/services/configWatcher.ts:17`
  - DB schema: `services/xstockstrat-notify/migrations/001_notify_alerts.up.sql:6-21`
    - Columns: `alert_id UUID PK, severity INT, category TEXT, title TEXT, body TEXT, source_service TEXT, target_user_id TEXT, context JSONB, tags TEXT[], correlation_id TEXT, acknowledged BOOL, acknowledged_by TEXT, acknowledged_at TIMESTAMPTZ, created_at TIMESTAMPTZ`
    - Indexes: `idx_alerts_user`, `idx_alerts_category`, `idx_alerts_severity`, `idx_alerts_unacked` (partial WHERE NOT acknowledged)
  - Last migration: `002_push_subscriptions`; next: **003**
  - Test file: `src/__tests__/notifyServiceImpl.test.ts` — `node:test` runner, `makePool()`/`capturingPool()` mock pattern

- **`xstockstrat-ui`** (Next.js)
  - Notifications page: `services/xstockstrat-ui/src/app/accounts/notifications/page.tsx:4` — renders only `PushToggle` card; **no alert list**
  - AlertStream component: `services/xstockstrat-ui/src/components/trader/AlertStream.tsx:20` — Sheet with Bell icon + Badge
    - "Unread" is purely client-side: `:41` `const unread = alerts.length;` (array length, no server read state)
    - Badge rendering: `:49-55` — `>9` caps at `9+`
    - Severity map: `:12-18` — `severityLabel` and `severityVariant` Records
    - Stream filter: `:28` — `{ includeAcknowledged: false }`
  - Mounted in: `services/xstockstrat-ui/src/components/trader/AppShell.tsx:24`
  - Browser notify client: `services/xstockstrat-ui/src/lib/browserClients/notifyClient.ts:5-6` — routes through `/trader/api` BFF
  - Server-side client: `services/xstockstrat-ui/src/lib/connectClients.ts:34`
  - Trader BFF notify routes: `services/xstockstrat-ui/src/lib/traderBff.ts:81-98` — wires `streamAlerts`, `listAlerts`, `registerPushSubscription`, `unregisterPushSubscription`
  - **`AcknowledgeAlert` is NOT wired in any BFF** — proto exists but no UI call path
  - `listAlerts` consumer: `services/xstockstrat-ui/src/hooks/useLiveStrategies.ts:22-34` — filters by `categories: ['strategy']`
  - Nav registration: `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx:90` + `navGroups.tsx:84` — no unread badge
  - BFF pattern: `services/xstockstrat-ui/src/lib/bffShared.ts:60` — `forward()` with session verify + header propagation
  - E2E mocks: `services/xstockstrat-ui/e2e/mock-backend.ts:491-553` — 3 stream alerts + 3 list alerts (inline, no separate fixture file)
  - E2E specs: `e2e/trader/alert-stream.spec.ts` (badge, sheet, severity), `e2e/accounts/notifications.spec.ts` (push toggle)

## Patterns to REUSE

- `AcknowledgeAlert` handler pattern → reuse for `MarkAlertRead` at `notifyServiceImpl.ts:146-156` (same inline-SQL-in-handler style; same `pool.query` + user_id from request)
- `forward()` BFF helper → reuse at `bffShared.ts:60` to wire `markAlertRead` in the trader BFF
- `AlertStream` severity rendering → reuse `severityLabel`/`severityVariant` Records at `AlertStream.tsx:12-18` for the notifications inbox
- `EnumBadge` + `Record<Enum, EnumRender>` → reuse at `opportunityShared.tsx:70` for alert-level badges
- `notifyClient` browser client → reuse at `notifyClient.ts:5-6` for `MarkAlertRead` calls
- `capturingPool()` test mock → reuse at `notifyServiceImpl.test.ts` for `MarkAlertRead` + `ListAlerts` unread tests
- Alert mock objects → reuse/extend at `mock-backend.ts:491-553` for read/unread E2E fixtures

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @feature-020` "A WARNING alert is fanned out to Slack when the webhook is configured" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — emission+fanout path untouched
- **PRESERVE** `@AC-3 @FR-3 @FR-4 @feature-020` "With no credentials set, nothing fans out and runtime knobs still take effect live" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — primary stream delivery independent of fanout config
- **PRESERVE** `@AC-4 @FR-6 @feature-020` "A Slack webhook timeout does not delay or drop the primary stream" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — primary stream latency unaffected
- **PRESERVE** `@AC-4 @FR-3 @feature-165` "An emitted alert is pushed to the target user's devices" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — EmitAlert response returns alert_id without waiting; MarkAlertRead must not alter EmitAlert shape/timing
- **PRESERVE** `@AC-5 @FR-3 @feature-165` "Push dispatch never fails or delays the primary emit" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — EmitAlert + StreamAlerts delivery unaffected by read-state writes
- **PRESERVE** `@AC-6 @FR-5 @feature-165` "Push is disabled when VAPID keys are absent" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — EmitAlert still succeeds
- **PRESERVE** `@AC-7 @FR-5 @feature-165` "The min-severity gate suppresses low-severity pushes" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — severity gating unchanged
- **PRESERVE** `@AC-8 @FR-6 @feature-165` "A Gone subscription is pruned" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — push subscription lifecycle unchanged
- **PRESERVE** `@AC-2 @FR-2 @feature-165` "Enabling notifications persists a per-user subscription" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — per-user push subscription upsert untouched; feature 203 adds a different per-user table
- **PRESERVE** `@AC-3 @FR-2 @feature-165` "Disabling notifications removes the subscription" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — push subscription removal unchanged
- **PRESERVE** `@AC-1 @FR-1 @feature-165` "The app is installable and serves a standalone manifest" (`services/xstockstrat-ui/acceptance/pwa-notifications.feature`) — SW controls all four segment scopes including /accounts
- **PRESERVE** `@AC-9 @FR-4 @feature-165` "Clicking a push notification opens the app" (`services/xstockstrat-ui/acceptance/pwa-notifications.feature`) — notification click handler unchanged
- **PRESERVE** `@AC-2 @FR-3 @regression @feature-171` "Telemetry init remains non-blocking" (`docs/sdd/business-rules/platform.feature`) — notify service startup unaffected
- No existing `AcknowledgeAlert` `@AC-*` scenario promoted (phase-5 scaffolding, never feature-promoted); product-spec explicitly says "Changing or removing acknowledged/AcknowledgeAlert semantics" is Out of Scope — treat as implicit PRESERVE
- No existing `ListAlerts` response-shape `@AC-*` scenario — new fields are additive (non-breaking)

## Dependencies

- Proto/RPC: `MarkAlertRead` RPC (new); `Alert` gains `read` bool + `read_at` timestamp (fields 13, 14); `ListAlertsRequest` gains `unread_only` (field 5); `ListAlertsResponse` gains `unread_count` (field 3). All additive — non-breaking
- Migration: `003` for `services/xstockstrat-notify/migrations/` — new `notify.alert_reads (alert_id UUID, user_id TEXT, read_at TIMESTAMPTZ, PRIMARY KEY (alert_id, user_id))` join table
- Config keys: none
- Inter-service edges: none (read/unread stays within notify + UI boundary)
- New env vars / ports: none

## Risks / Not-found

- **`AcknowledgeAlert` is NOT wired in the UI** — the proto RPC exists and the handler works, but no BFF route or component calls it. Feature 203 adds `MarkAlertRead` as a separate RPC, but the missing `AcknowledgeAlert` wiring means the existing acknowledge model is invisible to users. Design should confirm whether wiring acknowledge is out of scope (product-spec says yes) or if it should ride this feature.
- **`ListAlerts` pagination/category filters not implemented** — `page_token` and `categories` fields exist in the proto but the handler ignores them. Feature 203 adds `unread_only` filter and `unread_count` to the response — but the existing unimplemented filters may need attention if the notifications inbox uses categories.
- **No separate repository layer** — all SQL is inline in `notifyServiceImpl.ts`. The `MarkAlertRead` handler will follow the same pattern (inline SQL), but this increases handler complexity. Design should decide whether to extract a repository or keep the inline pattern consistent.
- **Notifications page is push-only** — `/accounts/notifications` renders only the `PushToggle` component. Feature 203 needs to add an entire alert inbox to this page. The `/accounts` segment has no BFF router — it uses per-route REST API handlers. MarkAlertRead may need a new API route or the existing trader BFF wiring extended.
- **"Unread" is client-side in AlertStream** — `alerts.length` counts streaming alerts, not persisted read state. Feature 203 replaces this with server-side unread counts, but must preserve the existing badge UX.
- **Ledger trap (fails.md:457):** notify's `list-alerts` behavior once disagreed between FR-1 and FR-2 with the real decision hidden in context.md. Keep FR-2 (`MarkAlertRead`) and FR-3 (`ListAlerts` read fields/filter) describing exactly one read model; reconcile any divergence in the spec itself.
- **Direct pool budget** — notify uses direct connection `:25060` with pool max 1 (CLAUDE.md). Adding a new table + LEFT JOIN on `alert_reads` adds query complexity against a 1-connection pool. Design should verify the join performance is acceptable.

## Recommended Scope

1. **Proto + codegen** — `MarkAlertRead` RPC, `Alert` read/read_at fields, `ListAlertsRequest` unread_only, `ListAlertsResponse` unread_count; run `buf-gen.sh`
2. **Migration** — `003_alert_reads.up.sql` + `.down.sql`: `notify.alert_reads (alert_id, user_id, read_at)` join table with PK + index
3. **Notify service** — `MarkAlertRead` handler (idempotent INSERT ON CONFLICT DO NOTHING), `ListAlerts` LEFT JOIN for per-user read state + unread_only filter + unread_count, `rowToAlert` mapper gains read/read_at
4. **UI** — Notifications page gains alert inbox (list + unread badge + mark-as-read), AlertStream badge wired to server unread count, BFF route for `markAlertRead`, E2E fixture/spec updates
5. **Tests** — notify unit tests (mark read idempotency, list with read state, unread count), UI E2E (mark read, unread badge, filter)
