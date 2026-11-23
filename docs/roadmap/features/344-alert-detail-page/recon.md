# Recon: alert-detail-page

**Created**: 2026-11-15
**From**: product-spec.md
**Tree**: feature/alert-detail-page@0788d0aaf (contains origin/main-dev@67dcfc11a). The discovery digests were unstamped; every `path:line` below was re-grepped at this tree.
**Affected services**: xstockstrat-notify, xstockstrat-ui, xstockstrat-ingest

---

## Objective

Give every alert its own page at `/accounts/notifications/<alert_id>` showing severity, category, source service, time, title, full body, read state, correlation ID and every context field. Opening the page marks the alert read for that user. Rows in the Notifications list and the header Alerts drawer link to it, and a push notification opens it. Backfill-failure alerts from ingest get a plain-language body (`<CODE> — <details>`), with the raw exception text kept only in the alert context.

Operator decisions (binding, 2026-11-15): dedicated page, not an expandable row; opening the page marks the alert read; plain-language backfill-failure body; 339-fix-symbol-page-alerts-ui changes the same drawer and lands first.

## Codebase Map

- **`xstockstrat-notify`** (Node.js)
  - Entry point: `services/xstockstrat-notify/src/index.ts:60` (`grpcServer.addService(createNotifyServiceDefinition(), notifyImpl …)`). The impl object is registered whole, so a new `getAlert` method needs no separate handler-map entry.
  - Handler/servicer: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`
    - `markAlertRead` — `:201`. Owner at `:202` (header, then body `userId`); missing user → code 3 at `:204`; insert with `JOIN notify.alerts … ON CONFLICT DO NOTHING` at `:211-217`. It has no visibility check.
    - `listAlerts` — `:225`. Read join at `:238`, visibility predicate at `:239` (repeated at `:247`).
    - `rowToAlert` — `:371`. It maps `sourceService`, `correlationId`, `read`, `readAt` but **not `context`**.
    - `emitAlert` — `:49`. Stores context as `JSON.stringify(req.context ?? {})` at `:97`.
  - Last migration: `005_email_outbox.up.sql` (`services/xstockstrat-notify/migrations/`)
  - Config-read pattern: `this.config.getInt('fanout.dedup_window_seconds', 300)` — `services/xstockstrat-notify/src/fanout/fanout.ts:83` (not needed by this feature)
  - Other key symbols:
    - `PushPayload` (has optional `url`) — `services/xstockstrat-notify/src/fanout/webPush.ts:44-52`
    - Push payload build (title, body, icon, tag only) — `webPush.ts:143-148`; `alert.alertId` in scope at `:152`
    - `notify.alerts` table (`alert_id UUID`, `context JSONB`) — `services/xstockstrat-notify/migrations/001_notify_alerts.up.sql:6-21`
    - `notify.alert_reads` (no FK to alerts) — `services/xstockstrat-notify/migrations/003_alert_reads.up.sql`
    - Proto: `rpc ListAlerts` `packages/proto/notify/v1/notify.proto:24`, `rpc MarkAlertRead` `:28`, last RPC `FanoutWebhook` `:39`, `message Alert` `:42-59`, `ListAlertsRequest` `:102`, `MarkAlertReadRequest` `:116`
    - Tests: `metaCall(userId, request)` helper `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts:534`; `describe('markAlertRead (feature 203)'` `:847`; `describe('listAlerts — read state (feature 203)'` `:896`; push payload assertions `src/__tests__/webPush.test.ts:228-229`

- **`xstockstrat-ui`** (Next.js)
  - Entry point: `services/xstockstrat-ui/src/app/accounts/notifications/page.tsx` (directory holds only `page.tsx`, `AlertInbox.tsx`, `PushToggle.tsx`; no `[alert_id]` route exists)
  - Handler/servicer (BFF): `services/xstockstrat-ui/src/lib/traderBff.ts:96` `router.service(NotifyService, {`; `listAlerts` `:104`; `markAlertRead` `:115`. `forward` is at `services/xstockstrat-ui/src/lib/bffShared.ts:77`.
  - Last migration: n/a (stateless here)
  - Config-read pattern: n/a
  - Other key symbols:
    - Browser client `notifyClient` — `services/xstockstrat-ui/src/lib/browserClients/notifyClient.ts:6`
    - Server client — `services/xstockstrat-ui/src/lib/connectClients.ts:98-99` (`NOTIFY_ENDPOINT` `:20`)
    - Inbox — `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx`: `listAlerts({})` `:28`, `markAlertRead` `:46`, `unreadIds` `:55`, row `<li data-testid="alert-row">` `:92-96`, title `<p>` `:116`, per-row "Mark read" `Button` `:122-131`. No `Link`/`href` today.
    - Drawer — `services/xstockstrat-ui/src/components/trader/AlertStream.tsx`: one-shot count `listAlerts({ limit: 1 })` `:22`, `streamAlerts` `:38`, `<SheetTitle>Alerts</SheetTitle>` `:82`, "Clear all" `:87`. No `Link`/`href` today.
    - Drawer mount — `services/xstockstrat-ui/src/components/trader/AppShell.tsx:24` only. The accounts layout (`services/xstockstrat-ui/src/app/accounts/layout.tsx:25`) renders `PlatformHeader` with no `actions`, so there is no bell on `/accounts/*` pages.
    - Nav — `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx:94` (`match: 'exact'`), `isItemActive` `:100-104`, `resolveActive` `:107`; `services/xstockstrat-ui/src/components/shared/navGroups.tsx:89` (no `match`; default is `'prefix'`, `:12-13`)
    - Severity maps — `services/xstockstrat-ui/src/lib/alertShared.ts:5`, `:12`
    - Service worker — `services/xstockstrat-ui/public/sw.js`: fallback url `/trader` `:18`, `url` parse `:30`, `pickClientUrl` `:37-42`, `data: { url }` `:57`, `notificationclick` `:62-75`. Unit-tested mirror: `services/xstockstrat-ui/src/lib/swHelpers.ts:27`, `:48` (`swHelpers.test.ts`).
    - e2e: `services/xstockstrat-ui/e2e/mock-backend.ts:663` (NotifyService), `listAlerts` `:685`, `markAlertRead` `:691`; `e2e/accounts/notifications.spec.ts:92` (inbox suite); `e2e/trader/alert-stream.spec.ts`; `e2e/fixtures/alerts.ts` (`ALERT_LIST_WITH_READ_STATE` `:94`, `MOCK_UNREAD_COUNT` `:95`); `e2e/nav-reachability.spec.ts:53`
    - Docs: `services/xstockstrat-ui/docs/pwa-push.md` (push, inbox and bell behavior)

- **`xstockstrat-ingest`** (Python)
  - Entry point / handler: `services/xstockstrat-ingest/app/handlers/servicer.py`
    - `_emit_backfill_alert(self, job_id, status, failed_symbols, error, propagation_meta)` — `:519`. Context built at `:529`; title `:535`; body `:536` (`f"Backfill job {job_id} {label}: {error}"`).
    - FAILED caller with the raw exception — `:574-593` (`except Exception as e`; job row `error=str(e)` `:584`, ledger payload `:589`, alert call `:591-593` passes `str(e)`).
    - Other callers pass fixed plain strings — `:762` (FAILED, "all backfill chunks failed") and `:774` (PARTIAL).
  - Last migration: `016_seed_source_templates.up.sql` (`services/xstockstrat-ingest/migrations/`)
  - Config-read pattern: none on the alert path
  - Other key symbols: `e.code()` / `e.details()` / `e.code().name` on `grpc.aio.AioRpcError` — `servicer.py:489-495`; `rpc_error(code, details="")` — `services/xstockstrat-ingest/tests/_helpers.py:96`; alert tests `services/xstockstrat-ingest/tests/test_ingest_servicer.py:696`, `:720`, `:759`

## Patterns to REUSE

- `GetAlert` handler SQL → reuse the `listAlerts` read join and visibility predicate at `notifyServiceImpl.ts:236-239` (`LEFT JOIN notify.alert_reads ar … AND ar.user_id = $1`; `a.target_user_id = $1 OR a.target_user_id IS NULL`), adding `a.alert_id = $2`.
- Row → proto mapping → reuse `rowToAlert` at `notifyServiceImpl.ts:371` (extend it with `context`; see Risks).
- Caller identity → `call.metadata?.get?.('x-user-id')` as at `notifyServiceImpl.ts:202`, rejecting a missing identity with code 3 (`:204`). Do not copy the body-`userId` fallback or the `$1::text IS NULL` unscoped branch into the new RPC (NOTIFY-7, `services/xstockstrat-notify/docs/context-constitution.md:19`; `fails.md` 2026-10-07 alert-read-unread-persistence).
- Error codes → numeric gRPC codes as at `notifyServiceImpl.ts:204`, `:221`; use `code: 5` for both a missing alert and one not visible to the caller, so the two are indistinguishable (@AC-2).
- `GetAlertRequest` shape → mirror `MarkAlertReadRequest` (`notify.proto:116`): no user field, owner from the header.
- Mark read on page open → the existing `notifyClient.markAlertRead({ alertIds })` call (`AlertInbox.tsx:46`) through the existing BFF entry (`traderBff.ts:115`). Its `ON CONFLICT DO NOTHING` (`notifyServiceImpl.ts:211-217`) already keeps `read_at` on a repeat open.
- BFF handler → `getAlert: forward((req, opts) => notifyClient.getAlert(req, opts))` beside `traderBff.ts:104`, `:115`.
- Browser data access on the new page → the root-relative `notifyClient` (`browserClients/notifyClient.ts:6`), as `AlertInbox.tsx:28` already does under `/accounts` (the sanctioned exception recorded in `services/xstockstrat-ui/docs/pwa-push.md`). Do not add a REST route.
- Severity badge and labels → `severityLabel` / `severityVariant` (`alertShared.ts:5`, `:12`), as used at `AlertInbox.tsx:108-110`.
- Loading / not-found / error states → `EmptyState` as at `AlertInbox.tsx:86-88` (C-17).
- Push deep link → set the existing optional `PushPayload.url` (`webPush.ts:51`) in the payload built at `webPush.ts:143-148`. The service worker already reads it (`sw.js:30`, `:57`, `:64`), so no new payload field is needed.
- Nav match → the existing `match?: 'exact' | 'prefix'` model (`navGroups.tsx:12-13`; `PlatformHeader.tsx:103`).
- gRPC code and details for the ingest body → `e.code().name` and `e.details()` as at `servicer.py:489-495`.
- Tests:
  - notify: `metaCall` and the `markAlertRead` / `listAlerts` suites (`notifyServiceImpl.test.ts:534`, `:847`, `:896`); push payload assertions in `webPush.test.ts:228`.
  - ui: `e2e/mock-backend.ts:685-693` (add `getAlert`), `e2e/fixtures/alerts.ts` + `INVENTORY.md` row (C-12), `e2e/accounts/notifications.spec.ts:92`, `e2e/trader/alert-stream.spec.ts`, `src/lib/swHelpers.test.ts`.
  - ingest: `rpc_error` (`tests/_helpers.py:96`) and the alert tests at `test_ingest_servicer.py:696-759`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-2 @FR-3 @feature-203` "Marking a targeted alert read flips it to read for that user" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`) — MarkAlertRead sets read and read_at and drops unread_count; the FR-5 page-open mark-read must use it.
- **PRESERVE** `@AC-2 @FR-1 @FR-4 @feature-203` "A broadcast alert is unread for one user and read for another" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`) — GetAlert read state and the page-open mark-read are per caller, never global.
- **PRESERVE** `@AC-3 @FR-2 @feature-203` "MarkAlertRead is idempotent" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`) — repeat opens must not move read_at.
- **PRESERVE** `@AC-4 @FR-3 @feature-203` "unread_only filter returns only the caller's unread alerts" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`) — the list and filter are untouched (search/filter/pagination out of scope).
- **PRESERVE** `@AC-5 @FR-1 @feature-203` "Read state and acknowledged state are independent" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`) — opening the page changes read only, never acknowledged.
- **EXTEND** `@AC-6 @FR-5 @FR-6 @feature-203` "The notifications inbox shows level, module, body, and unread state" (`services/xstockstrat-ui/acceptance/alert-read-unread-persistence.feature`) — rows become links to /accounts/notifications/<alert_id>; the row content, unread indicator and badge are unchanged.
- **EXTEND** `@AC-9 @FR-4 @feature-165` "Clicking a push notification opens the app" (`services/xstockstrat-ui/acceptance/pwa-notifications.feature`) — 344 FR-6 supplies the alert-page url; focus-existing-window-else-open behavior stays.
- **EXTEND** `@AC-4 @FR-3 @feature-165` "An emitted alert is pushed to the target user's devices" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — the push payload gains the alert url; title/body, per-endpoint sends and non-blocking EmitAlert stay.
- **PRESERVE** `@AC-5 @FR-3 @feature-165` "Push dispatch never fails or delays the primary emit" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — the payload change adds no EmitAlert failure path.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-242` "A targeted alert reaches only the target user's devices" (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`) — push audience unchanged.
- **PRESERVE** `@AC-5 @FR-1 @regression @feature-242` "An untargeted alert is Web-Pushed only to admin-role users' devices" (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`) — push audience unchanged.
- **PRESERVE** `@AC-9 @FR-2 @regression @feature-270` "A dropped alert stream is shown to the user and reconnects" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — the header drawer, which gains row links in AlertStream.tsx, keeps its disconnect indicator and live updates.
- **PRESERVE** `@AC-5 @FR-1 @regression @feature-271` "The alert stream is not cut off by the unary default deadline" (`services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature`) — the new unary GetAlert must not alter the StreamAlerts deadline handling.
- **PRESERVE** `@AC-20 @FR-4 @feature-334` "a hand-off notify rejects as INVALID_ARGUMENT is not retried forever" (`services/xstockstrat-ingest/acceptance/webhook-fanout-callback.feature`) — the WARNING alert that names the job is separate from the FR-7 failure-alert body and must not change.
- No **CHANGE** is proposed. Two conditions would turn an EXTEND into an unsigned CHANGE, and design must hold both: the push payload keeps a `url` field (not replaced by a bare alert id), and FR-7 rewrites only the body of the `_run_backfill` FAILED alert.
- No new suite is needed for any affected service: xstockstrat-notify, xstockstrat-ui and xstockstrat-ingest all have acceptance suites.
- Coverage limit of the scenario scan: `docs/sdd/business-rules/platform.feature` after line 796 and several ingest/ui/notify suites were keyword-screened (alert/notification/drawer/bell/backfill), not read in full. A nav, shell or alert-body scenario there could have been missed.

## Dependencies

- Proto/RPC: new `rpc GetAlert(GetAlertRequest) returns (Alert)` in `packages/proto/notify/v1/notify.proto` (service block `:14-39`); new `GetAlertRequest { string alert_id = 1; }`. `message Alert` (`:42-59`, fields 1-14) is unchanged. Additive; `buf lint` + `buf breaking` + `./scripts/buf-gen.sh` (C-09); 1-owner gate.
- Migration: none. (Next free numbers if design finds a need: notify `006`, ingest `017`.)
- Config keys: none
- Inter-service edges: none new. `xstockstrat-ui → xstockstrat-notify` (gRPC 50059) and `xstockstrat-ingest → xstockstrat-notify` (`EmitAlert`) already exist.
- New env vars / ports: none

## Risks / Not-found

- **`rowToAlert` drops `context`** (`notifyServiceImpl.ts:371-392`), so `ListAlerts` never returns it although the column exists (`001_notify_alerts.up.sql:14`). FR-2 and @AC-1 need every context field. Design must decide whether to add `context` to `rowToAlert` (which also changes `ListAlerts` responses) or map it only in `getAlert`, and how the JSONB value encodes as a `google.protobuf.Struct` with this service's ts-proto settings. Not verified: `emitAlert` passes `req.context` straight through at `:113`, which suggests a plain object, but the generated code was not read.
- **Rendering context in the browser.** `fails.md` 2026-08-05 (live-strategy-alert-engine): the spec assumed protobuf-es v2 Struct field introspection in the TS client and the shipped code abandoned it. The page must render arbitrary context fields (strings, lists such as `failed_symbols`), so design must name the exact access path and test it.
- **Non-UUID alert IDs.** `notify.alerts.alert_id` is `UUID` (`001_notify_alerts.up.sql:7`). A URL id that is not a UUID (the scenarios use `a1f3`) would fail the cast and return code 13, not NOT_FOUND. `fails.md` 2026-10-07 recorded the same for `$1::uuid[]`. `getAlert` must return code 5 for a malformed id.
- **Identity on `GetAlert`.** `listAlerts` is unscoped when no identity is present (`:239`, NOTIFY-7). The new RPC should require `x-user-id`; this is a design decision to record. A `rowToAlert` extension or a new handler also overlaps 316-fix-notify-stream-contract in the same file (disjoint regions per the product-spec review; rebase only).
- **`markAlertRead` has no visibility check** (`:211-217`): any user can mark any existing alert id read (inert, but an existence probe). The page should call it only after `GetAlert` succeeded. Tightening `markAlertRead` itself is outside the stated scope; design decides whether to leave it.
- **No bell on the alert page.** `AlertStream` is mounted only in the trader `AppShell` (`AppShell.tsx:24`); `/accounts/*` has no bell (`accounts/layout.tsx:25`). @AC-6 ("the bell shows no unread badge" after opening `/accounts/notifications/a1f3`) is not observable on that page as written. Also, the badge is fetched once on mount and never refreshed (`AlertStream.tsx:19-31`; `fails.md` 2026-10-07; `pwa-push.md`). Design must say where @AC-6 is observed (for example on the next `/trader` page load) or whether a bell is added to the accounts header, and must name the badge invalidation trigger. 339 is specified to add badge refresh on mark-read; its design is not written yet (339 has only story artifacts).
- **Dependency on 339.** 339-fix-symbol-page-alerts-ui rewrites the drawer (`AlertStream.tsx`: stored alerts in the drawer, a mark-read action, badge refresh). The drawer row markup that FR-4 links (`AlertStream.tsx:110-124` today) will differ after 339. Operator decision: 339 lands first; the FR-4 drawer step must re-grep its anchors after 339 merges. No `merge-order.md` row for 339 → 344 exists yet (grep found none).
- **Row link next to a button.** The inbox row holds a "Mark read" `Button` (`AlertInbox.tsx:122-131`). Making the whole `<li>` a link would nest a button inside an anchor. Design must pick the link target (for example the title) and keep the row's `data-testid`s that `e2e/accounts/notifications.spec.ts:95-117` asserts.
- **Nav match.** `PlatformHeader.tsx:94` is `match: 'exact'`, so the entry is not active on a child path; `navGroups.tsx:89` already defaults to prefix. Changing `:94` to prefix is safe against the sibling accounts items (`:93`, `:95`, `:96` have different paths). No unit test covers `isItemActive`; only `e2e/nav-reachability.spec.ts` references the nav. C-10(a): the alert page gets no nav entry of its own (decided in the product spec), so the proof is an active-state assertion on the child path.
- **Push click with an open window.** `pickClientUrl` (`sw.js:37-42`) focuses a window only when its URL already contains the target URL; otherwise it opens a new window. With an alert-specific URL an app window on another page is not reused. This satisfies @AC-7 and keeps `@AC-9 @feature-165`. Navigating an existing window instead would be a behavior change, not required.
- **Push URL and basePath.** The UI is served at the domain root with no `basePath` (`pwa-push.md`; `next.config.*` has no `basePath` match), so `/accounts/notifications/<alertId>` is usable as-is. `sw.js` and `swHelpers.ts` are hand-mirrored copies; any change to one must be made in both. No change to either is expected.
- **BFF error passthrough.** `fails.md` 2026-08-06 (strategy-creation-flow): a BFF dispatch collapsed backend errors to a generic "HTTP 400". `forward` (`bffShared.ts:77-91`) rethrows the backend call's error unchanged, but `createDispatch` was not read. Design must require a test that NOT_FOUND from `GetAlert` reaches the page as "Alert not found" (@AC-2), keyed on the Connect code, not the message text.
- **BFF allowlist test.** `services/xstockstrat-ui/src/lib/__tests__/bffAllowlist.test.ts` has no notify/alert entry (grep), so no allowlist row is expected for `getAlert`. Its label-set pins were not read in full.
- **Ingest exception types.** The FAILED path catches any `Exception` (`servicer.py:574`). Only a `grpc.aio.AioRpcError` has a code and details; the fundamentals path calls marketdata directly (`:601`) and is the @AC-8 case. A non-RPC exception needs a fallback body, which the spec does not define; the fallback must still not print `AioRpcError` text. Design must define it. The two fixed-string callers (`:762`, `:774`) and the PARTIAL body must stay as they are.
- **Readers of the old body.** Grep for `Backfill job` across `services/`, `packages/`, `plugins/` found no reader of the failure body: the hits are the builder itself, the unrelated webhook hand-off alert (`services/xstockstrat-ingest/app/engine/webhook_handoff_loop.py:74`), a metric description (`app/telemetry.py:429`) and docs. No ingest test asserts the body text or `context["error"]` today. notify's external fan-out dedups on a hash that includes the body (`services/xstockstrat-notify/src/fanout/fanout.ts:82-92`; key function not read), so only new backfill-failure alerts get new dedup keys.
- **Build couples tests (notify).** `fails.md` 2026-11-04 (fix-push-untargeted-broadcast): notify's `tsc` build compiles tests, so a signature change and its test call sites must land in one step. Adding `url` to the payload and a new method are additive, but `/sdd-spec` should keep each notify change and its tests in one atomic unit.
- **Not found / not verified**: the `GetAlert` RPC and `getAlert` handler (absent everywhere); an `[alert_id]` route under `accounts/notifications` (absent); whether `e2e/trader/live-strategies.spec.ts` depends on drawer markup; the `createDispatch` error mapping; the ts-proto Struct representation; 339's final drawer markup.

## Recommended Scope

Advisory step boundaries, not binding:

1. **proto** — add `GetAlert` + `GetAlertRequest` to `notify.proto`; `buf lint`, `buf breaking`, `./scripts/buf-gen.sh`.
2. **notify service + test** (one unit) — `getAlert` (header-only identity, visibility predicate, read join, NOT_FOUND for missing / invisible / malformed id) and `context` in the row mapper; tests for @AC-1 (fields incl. context), @AC-2, @AC-3, @AC-9 and per-caller read state.
3. **notify service + test** (one unit) — `url: '/accounts/notifications/<alertId>'` in the push payload; `webPush.test.ts` assertion (@AC-7, notify half).
4. **ingest service + test** — plain-language FAILED body for an `AioRpcError`, defined fallback for other exceptions, raw text kept in `context["error"]`; PARTIAL and fixed-string bodies unchanged (@AC-8).
5. **ui BFF + mock** — `getAlert: forward(...)` in `traderBff.ts`; `getAlert` in `e2e/mock-backend.ts`; alert-detail fixture + `INVENTORY.md` row.
6. **ui page** — `src/app/accounts/notifications/[alert_id]/page.tsx`: fetch, render all fields and context rows, "Alert not found" state, mark read after a successful load; nav match change at `PlatformHeader.tsx:94`; e2e for @AC-1, @AC-2, @AC-3, @AC-6, @AC-9 and nav active state.
7. **ui links** — inbox row link (@AC-4) and drawer row link (@AC-5, after 339 merges; re-grep anchors); push click e2e or `swHelpers` unit test for the alert url (@AC-7, ui half).
8. **docs** — `services/xstockstrat-ui/docs/pwa-push.md`, notify `docs/context-constitution.md` (GetAlert identity rule next to NOTIFY-7), and acceptance-suite promotion at integration.
