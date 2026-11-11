# Recon: fix-read-path-owner-trust

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: main-dev@c4fd48b0a ≡ origin/main-dev (no `feature/fix-read-path-owner-trust` branch yet; the six discovery digests were UNSTAMPED, and every `path:line` below was re-grepped on this tree)
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-notify, xstockstrat-ui, xstockstrat-agent (consumer surfaces). Recon adds **xstockstrat-analysis** as a live `ListOrders` caller that is not on the affected list (see Risks).

---

## Objective

Three read and consume paths take ownership from something other than the trusted `x-user-id` header, which breaks PLAT-11:

- Trading `ListOrders`/`StreamOrderUpdates` filter on a body `user_id`, and an empty value returns all users.
- Portfolio ledger consumers substitute `"default"`/`"alpaca-default"` for a missing identity. This is reachable because `RegisterBrokerAccount` accepts an empty caller.
- Notify `ListAlerts` falls back from the header to the body `userId` and then to `null`, and `null` is unscoped.

The fix scopes non-admin reads to the header, rejects missing identity, deletes the placeholder fallbacks, and documents the proto field semantics. All proto changes stay additive.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Service `ListOrders`: `services/xstockstrat-trading/internal/service/trading.go:1645-1646`. It passes `req.UserId` to `s.repo.ListOrders(...)`. The in-memory fallback filters on `req.UserId` at `:1652` (`if req.UserId != "" && o.UserId != req.UserId`).
  - Repo `ListOrders`: `services/xstockstrat-trading/internal/repository/trading_repo.go:206`. It adds `AND user_id = $N` only when `userID != ""` (`:229-231`), so an empty value is unscoped. Confirmed by reading the body.
  - Service `StreamOrderUpdates` snapshot: `trading.go:1726`, with the filter at `:1730` (`if req.UserId != "" && order.UserId != req.UserId`).
  - Live subscription:
    - `orderSubscriber`: `trading.go:393`
    - `SubscribeOrderUpdates(id, userID)`: `:400`
    - `broadcastOrder`: `:435`. An empty `orderSubscriber.userID` means all users.
  - Handler sites that pass the body selector into the subscription:
    - Connect: `services/xstockstrat-trading/internal/handler/trading.go:117-119`, `ch := h.svc.SubscribeOrderUpdates(subID, req.Msg.UserId)`
    - gRPC adapter: `handler/trading.go:204-206`, `ch := a.h.svc.SubscribeOrderUpdates(subID, req.UserId)`
  - Handler `ListOrders`:
    - Connect: `handler/trading.go:109`. Per digest 1, every error maps to `CodeInternal`, so a new `PermissionDenied` would be masked on that path.
    - gRPC adapter: `:196`
  - `RegisterBrokerAccount`:
    - Service: `trading.go:2595`, signature `(ctx, req, userID string)`, with no empty check. Per digest 1, the OFFLINE branch persists `UserID: userID` at `:2595-2606`.
    - Handler: `handler/trading.go:270-275`, which calls `extractUserID(ctx)`.
    - `extractUserID`: `handler/trading.go:258`. It returns `""` when there is no `x-user-id`.
    - gRPC adapter: `:339`
  - Related empty-caller-capable broker-account calls:
    - `DeregisterBrokerAccountSvc`: `trading.go:3144`, with its ownership check at `:3150` (digest)
    - `UpdateBrokerAccountCredentials`: `trading.go:2664`
    - `ListBrokerAccounts` handler: `handler/trading.go:286` (digest)
  - Identity and authz:
    - `middleware.FromContext(ctx).UserID` and `.AccessScope`: `internal/middleware/propagation.go:15,37` (digest)
    - `AdminScope = 0x04`: `internal/middleware/authz.go:13`
    - `RequireAdminScope(ctx) error`: `authz.go:17`
  - Last migration: `011_offline_fees_snapshot_headers.up.sql` (`services/xstockstrat-trading/migrations/`)
  - Config-read pattern: n/a (no config key touched)
- **`xstockstrat-portfolio`** (Go)
  - `processOrderFill` (func `:373`): empty `fill.AccountId` becomes `"alpaca-default"` at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:435` (`:433-436`). This is dead, because no producer sends it empty.
  - `processAccountDeregistered`: `:1540`
    - An empty `AccountID` already returns nil at `:1553`.
    - An empty `UserID` becomes `"default"` at `:1558`.
    - The purge is `DeletePositionsNotInSync(ctx, AccountID, userID, []string{})` at `:1565`.
    - `DeleteOfflineRealized(ctx, AccountID)` at `:1569` takes no user id.
  - `processPositionSync`: `:1589`
    - An empty `AccountID` returns nil at `:1602`.
    - The legacy comment is at `:1610-1611`.
    - `"default"` is at `:1614`.
  - `processBalanceSync`: `:1744`, with no return value. `"default"` is at `:1762`, then `UpsertAccountBalance(..., userID, ...)` at `:1764`.
  - Consumers (digest): `ConsumeOrderFills` `:176`, `ConsumePositionSyncs` `:1439`, `ConsumeAccountDeregistrations` `:1451`, `ConsumeBalanceSyncs` `:1740`
  - Last migration: `018_watchlist_signal_expiry.up.sql` (`services/xstockstrat-portfolio/migrations/`)
  - Config-read pattern: n/a
- **`xstockstrat-notify`** (Node/TS)
  - `ListAlerts` owner chain: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:200`, `x-user-id || req.userId || null`
  - Unscoped predicate `($1::text IS NULL OR a.target_user_id = $1 OR a.target_user_id IS NULL)`:
    - Main query: `:210`
    - Count query: `:218`
    - Params: `:213`, `:223` (digest)
  - Stale comment: `:198-199` ("falls back to the body userId for direct gRPC test callers")
  - `markAlertRead` has the same body fallback at `:173` but still rejects on empty. Its comment is at `:166-171`.
  - `registerPushSubscription` is header-only with rejection: `:240-243`, `callback({ code: 3, message: 'x-user-id header required' })`
  - Last migration: `003_alert_reads` (next free is 004; none needed)
- **`xstockstrat-ui`** (Next.js)
  - BFF `listOrders` overrides the body with the session user: `services/xstockstrat-ui/src/lib/traderBff.ts:40-46`, `{ ...req, userId: claims.user_id }`
  - BFF `streamOrderUpdates` does the same: `:58-64`
  - The comment that goes stale is at `:35-36` ("listOrders keeps an explicit user_id — there it's a cross-user filter (empty = all)…").
  - `listAlerts` is a plain `forward()` (header only, no body `userId`): `:104`
  - Shared plumbing in `src/lib/bffShared.ts` (digest):
    - `requireSession`: `:41`
    - `backendHeaders`: `:50`
    - `forward`: `:77`
    - `forwardAdmin`: `:93`
  - Browser callers never set `userId` (digest): `src/hooks/useOrders.ts:39`, `src/hooks/useOrderUpdates.ts:21`, `src/lib/positionLineage.ts:20`, and the alert callers `useLiveStrategies.ts:27`, `AlertStream.tsx:22`, `AlertInbox.tsx:28`.
- **`xstockstrat-agent`** (Python)
  - `list_account_orders`: `services/xstockstrat-agent/app/client.py:2561`, `trading_pb2.ListOrdersRequest(user_id=user_id, account_id=account_id)` plus `x-user-id` set to the same caller (digest `:2554-2565`)
  - Tool `manage_offline_account` op `list_orders`: `app/tools.py:2393-2395,2420` (digest)
  - No `ListAlerts` or `StreamOrderUpdates` caller; notify use is `EmitAlert` only (`client.py:306-308`, digest).
- **`xstockstrat-analysis`** (Python; not on the affected list, but a live `ListOrders` caller)
  - Entry backfill: `services/xstockstrat-analysis/app/engine/entry_backfill.py:79-84`. It builds `md = owner_metadata(user_id) + [x-trace-id]`, and the request carries `user_id=user_id`. The comment at `:73` reads "Body user_id is load-bearing: trading treats an empty user_id as all users".
  - `GetStrategyAnalytics`: `services/xstockstrat-analysis/app/handlers/servicer.py:6478-6481`, `ListOrdersRequest(strategy_id=..., user_id=user_id)` with `metadata=propagation_meta`. Here `user_id = self._caller_user_id(context)`, the same identity as the propagated header.

## Patterns to REUSE

| What to build | Reuse | Where |
|---|---|---|
| Trading non-admin read scoping | Fail-closed caller check: `callerID == "" \|\| owner != callerID` returns `PermissionDenied` | `trading.go:482, 967, 1317, 1490` |
| Admin selector (Q1) | `middleware.AdminScope` and `RequireAdminScope(ctx)`. `RequireAdminScope` returns an error, so a non-failing "is admin" check would be new code; prefer reusing the `AccessScope & AdminScope` test. | `authz.go:13,17` |
| Proto field semantics | Comment or deprecation precedent: `string user_id = 6 [deprecated = true]; // DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.` | `trading.proto:201` (`ReplaceOrderRequest`) |
| RegisterBrokerAccount empty-caller guard | The same `callerID == ""` rejection, placed at the top of the service method so the OFFLINE and credentialed paths are both covered | service `trading.go:2595` |
| Portfolio identity-less event | The existing ack-and-skip idiom: early `return nil`, as at `:1553` and `:1602` | `portfolio_service.go` |
| Logging the portfolio skip | `slog.WarnContext(ctx, …, "account_id", …, "event_type", …)`. AC-2 requires "acked, logged and skipped". | `portfolio_service.go` |
| Portfolio skip telemetry | The `portfolio.consumer.events{consumer,outcome}` instrument: count the skip as `acked`. Do not add a label value, because the closed set is enforced by `telemetry_allowlist_test.go`. | digest 2 |
| Notify ListAlerts | The header-only owner with early `callback({code:3,…})` from `registerPushSubscription` (NOTIFY-5) | `notifyServiceImpl.ts:240-243` |
| Missing-identity status precedent | Portfolio feature 264 rejects a headerless stream with INVALID_ARGUMENT | `services/xstockstrat-portfolio/acceptance/fix-portfolio-snapshot-surface.feature` @AC-2 |

Test harnesses to reuse:

- **Trading** (`GOWORK=off go test ./...`): `internal/service/trading_ownership_test.go`
  - `TestPlaceOrder_RejectsMissingCaller` `:45`
  - `TestBroadcastOrder_ScopesToSubscriberUser` `:116`, which calls `s.SubscribeOrderUpdates("sub-all", "")` as the all-users case
  - Admin-scope context patterns: `middleware/authz_test.go` and `trading_resume_account_test.go:87,94` (`AccessScope: "4"` and `"2"`)
- **Portfolio**: `internal/service/export_test.go` and `portfolio_sync_retry_test.go` (read these before writing the AC-2 test)
- **Notify** (`tsc && node --test dist/__tests__/*.test.js`):
  - `metaCall(userId|null, request)`: `src/__tests__/notifyServiceImpl.test.ts:469`
  - `seqPool`: `:766`
  - Missing-header template: `:810-818`
  - Existing listAlerts block: `:831-879`
- **UI** (Vitest): `src/lib/traderBff.test.ts`. It has no existing `userId`-pin test. The `src/lib/__tests__/traderBff.test.ts` copy was not grepped.
- **Agent** (pytest-asyncio): `tests/test_offline_client.py:165-183`, using `_patch_trading_stub` and `_channel_cm`

## Existing Business Rules (preserve / extend)

**Platform** (`docs/sdd/business-rules/platform.feature`):

- **PRESERVE** `@AC-9` @feature-196, "request-only dead fields stay server-ignored". This feature extends that rule to `ListOrders`, `StreamOrderUpdates` and `ListAlerts`.
- **PRESERVE** `@AC-5` @feature-210, "Header-propagation semantics are unchanged beneath mTLS". `x-user-id` stays the identity source.
- **PRESERVE** `@AC-2` @feature-210, "A mutually-authenticated peer with a valid platform-issued identity is accepted".

**Notify** (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`, @feature-203):

- **PRESERVE** `@AC-1` "Marking a targeted alert read flips it to read for that user".
- **PRESERVE** `@AC-2` "A broadcast alert is unread for one user and read for another". Untargeted alerts stay visible to every authenticated caller, which settles part of OQ2.
- **PRESERVE** `@AC-4` "unread_only filter returns only the caller's unread alerts".
- **PRESERVE** `@AC-5` "Read state and acknowledged state are independent".

**Analysis** (`services/xstockstrat-analysis/acceptance/fix-analysis-owner-scope.feature`, @feature-262):

- **PRESERVE** `@AC-1` "The entry-backfill asks trading only for the strategy owner's orders". The call shape is body `user_id` plus `x-user-id`, with the same owner in both. It becomes **CHANGE** (user sign-off in `context.md`) if the design rejects or ignores body `user_id` in a way that alters this call.
- **PRESERVE** `@AC-2` "Another owner's fills never seed an owner's entry state".

**UI** (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`, @feature-270):

- **PRESERVE** `@AC-2` "A dropped order stream is shown to the user and reconnects".
- **PRESERVE** `@AC-1` "A fresher polled terminal status wins over a stale streamed status".

**Portfolio**:

- **PRESERVE** `@AC-1` "A snapshot stream subscriber receives only its own snapshots" and `@AC-2` "A snapshot stream with no caller identity is rejected on the gRPC path" (`fix-portfolio-snapshot-surface.feature`, @feature-264). This is the precedent pattern.
- **PRESERVE** `@AC-4` "An empty broker position snapshot does not delete order-fill-derived positions" (`fix-reconciliation-false-halt.feature`, @feature-206).
- **PRESERVE** the following from `fix-offline-book-consistency.feature`, @feature-256:
  - `@AC-1` "A failed offline realized-P&L write is retried, not acked"
  - `@AC-2` "A failed offline-realized delete on deregistration is retried"
  - `@AC-6` "A persistently failing offline sync event is parked and does not block the stream"
  - `@AC-9` "A transient write failure never parks the offline sync event"

  The identity-less skip must be a distinct pre-write branch that is acked and logged, with no retry or park.

**Agent** (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`, @feature-164):

- **PRESERVE** `@AC-1` "Register an Alpaca broker account".
- **PRESERVE** `@AC-5` "Deregister a broker account".
- **PRESERVE** `@AC-6` "List all of the caller's accounts, broker and offline together".
- **PRESERVE** `@AC-7` "A caller cannot act on an account they do not own" (also @feature-303). A non-owner still gets PERMISSION_DENIED; the new rejection covers only an empty caller.

**Trading**: no existing acceptance suite asserts user scoping of `ListOrders`, `StreamOrderUpdates` or `RegisterBrokerAccount`. `fix-ibkr-request-signing.feature` @AC-1's `ListOrders` row is the broker API call, a name collision only.

**Coverage gaps**:

- No suite asserts the portfolio `"default"`/`"alpaca-default"` fallbacks.
- No suite asserts unscoped or body-`userId` `ListAlerts`.
- No suite asserts the `ListOrders` proto field's semantics.

So this feature's @AC-1 to @AC-3 are new rules, not CHANGEs. `services/xstockstrat-ui/acceptance/offline-account-portfolios.feature` uses `"alpaca-default"` only as a fixture label.

## Dependencies

- **Proto/RPC**:
  - `packages/proto/trading/v1/trading.proto:168-169`, `ListOrdersRequest { string user_id = 1; …`
  - `:189-191`, `StreamOrderUpdatesRequest { string user_id = 1; repeated OrderStatus status_filter = 2;`
  - `packages/proto/notify/v1/notify.proto:98-99`, `ListAlertsRequest { string user_id = 1; …`

  All three fields are undocumented. A comment or `deprecated = true` is additive (`buf lint`/`buf breaking`, then `./scripts/buf-gen.sh`, C-09). Renaming or removing is breaking (2 owners + platform lead).
- **Migration**: none required. If the OQ3 cleanup is chosen: trading `012`, portfolio `019`.
- **Config keys**: none.
- **Inter-service edges** (all existing):
  - UI BFF → trading `ListOrders`/`StreamOrderUpdates`/`RegisterBrokerAccount`
  - UI BFF → notify `ListAlerts`
  - agent → trading `ListOrders`
  - analysis → trading `ListOrders` (entry backfill and `GetStrategyAnalytics`)
  - trading → ledger → portfolio (`account.positions.synced`, `account.deregistered`, `account.balance.synced`)
- **New env vars / ports**: none.
- **Docs to update with the fix**:
  - `services/xstockstrat-trading/CLAUDE.md:45-47` ("Exception: ListOrders and StreamOrderUpdates keep their body user_id … empty = all users, for trusted internal callers … not deprecated") and `:48-49` (`broadcastOrder`, "empty = all users")
  - `services/xstockstrat-notify/CLAUDE.md:39` ("body `userId` fallback; with no identity `ListAlerts` is unscoped"), and NOTIFY-5 in `services/xstockstrat-notify/docs/context-constitution.md:19` (could extend to ListAlerts)
  - `services/xstockstrat-agent/CLAUDE.md:29` ("target/scope selector, not the caller")
  - `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Consumed
  - `services/xstockstrat-ui/src/lib/traderBff.ts:35-36` (comment)
  - `services/xstockstrat-analysis/app/engine/entry_backfill.py:73` (comment)

## Risks / Not-found

- **Analysis is a live ListOrders caller missing from Affected Services** (C-14 and C-10).
  - The entry backfill (`entry_backfill.py:79-84`) and `GetStrategyAnalytics` (`servicer.py:6478`) both send body `user_id` equal to the header owner, so header scoping preserves them.
  - The design should still name analysis explicitly.
  - A body-only admin selector that ignores the header for non-admins is safe only while header == body. Confirm there is no system-identity caller.
- **Two subscription sites, not one.** Scoping only the service `StreamOrderUpdates` snapshot (`trading.go:1730`) leaves the live channel unscoped: both handler sites (`handler/trading.go:119` and `:206`) pass the body `UserId` into `SubscribeOrderUpdates`. The handler `subID` format also embeds the body user id (`:117`, `:204`).
- **Repo and in-memory fallback both unscoped on empty.** `trading_repo.go:229-231` and `trading.go:1652` both treat `""` as all users. The fix must decide the effective owner before either is reached. fails.md 2026-08-19 (feature 140) warns that the in-memory fallback silently absorbs DB failures, so scope it identically.
- **Connect `ListOrders` maps every error to `CodeInternal`** (digest 1), which masks a new `PermissionDenied`. Map the status on both transports.
- **Existing tests break with the empty-caller guard.** `RegisterBrokerAccount` is called with `context.Background()` and no caller at `trading_offline_test.go:320` and `trading_ibkr_auth_test.go:290` (digest). These must add a caller.
- **Portfolio tests pin `"default"`**: `portfolio_helpers_test.go:227-235` (`resolveSyncUserID` mirror) and `:309-319` (`TestPositionSyncPayload_FallsBackToDefault`). There is no existing test for the empty-user path of deregister or balance sync.
- **Portfolio skip must not enter retry/park.** A returned error goes through `boundedRetry` (feature 256). It would be redelivered or parked, and replay from seq 0 on every boot. The guard must return nil.
  - fails.md 2026-10-22 (feature 259): consumers that drop events classify with a narrow, positive-poison allow-list. The identity-less skip is a payload-level positive case, so it is safe as an explicit pre-write branch. It must not widen any retry classifier.
- **OQ4 legacy replay**: pre-`user_id` events (comment at `portfolio_service.go:1610-1611`) would now be skipped on every boot replay. No promoted rule covers them. This needs a design decision.
- **Deregister purge scope.** `DeleteOfflineRealized(ctx, AccountID)` at `:1569` has no user id. Skipping an identity-less deregister event also skips that delete. Confirm this is the intended behavior.
- **Notify status code (OQ2).** The existing convention is numeric code 3 (INVALID_ARGUMENT): NOTIFY-5, tests at `notifyServiceImpl.test.ts:500,810-818`, and portfolio feature 264. No `UNAUTHENTICATED` (16) usage was found in notify handlers.
- **Notify `markAlertRead` body fallback** at `:173`. The spec names only ListAlerts; also dropping the fallback here is a design call (fails.md 2026-10-07, feature 203: "A handler that claims header-only identity must reject a missing identity (code 3) instead of falling back to the body").
- **Ledger traps that apply**:
  - fails.md 2026-08-05 (feature 001): silent placeholder `user_id="default"` fails invisibly. This is the origin of the portfolio fallback.
  - fails.md 2026-10-07 (feature 203): the partial ListAlerts tightening. This feature closes it.
  - fails.md (feature 224): enumerate every query or map keyed by the old id rather than asserting that "everything is owner-scoped". Here that means every site that reads body `UserId`: `trading.go:1646,1652,1730` and `handler/trading.go:117,119,204,206`.
  - insights.md:3277: when an admin cross-user read is needed, prefer a separate admin path with a body selector, so the self (header) and admin (scope + body) authz models don't mix. This bears on OQ1 and OQ5.
- **Batch overlaps** (from sdd-review): `trading.proto` is shared with 322 (different messages); notify `ListAlerts` coupling with 315 (fix-notify-stream-contract / alert targeting). Sequence the merges.
- **Not found / not verified**:
  - No existing `ListOrders` or `StreamOrderUpdates` unit test (only `trading_ownership_test.go` was grepped).
  - No non-erroring "is admin" helper in trading middleware.
  - Whether the UI BFF `forward` injects `x-user-id` on `listAlerts` was asserted by the spec and digest, but `bffShared.ts` was not re-read in this pass.
  - Agent `RegisterBrokerAccount`/`DeregisterBrokerAccount` client callers were not grepped (`tests/test_broker_account_client.py` exists).
  - Existing `user_id = ''` broker accounts and `user_id='default'` portfolio rows in deployed DBs are unknown (OQ3).
  - The SQL in portfolio migrations was not grepped for `'default'`.

## Recommended Scope

Advisory. This is input to the grilling and `/sdd-spec`, and is not binding.

1. **Proto (additive)**: document `ListOrdersRequest.user_id` and `StreamOrderUpdatesRequest.user_id` (admin-only selector, or deprecated per OQ1/OQ5) and `ListAlertsRequest.user_id` (deprecated, ignored), following `trading.proto:201`. Then `buf lint`, `buf breaking` and `buf-gen`.
2. **Trading read scoping**: resolve the effective owner once. For a non-admin it is `x-user-id`, and an empty caller is rejected. An admin may pass a body selector, with the empty-means-all semantics decided in OQ1. Apply the effective owner to:
   - `ListOrders`, both the repo call and the in-memory fallback
   - the `StreamOrderUpdates` snapshot
   - both `SubscribeOrderUpdates` handler sites

   Map the status on Connect and gRPC. Tests extend `trading_ownership_test.go`.
3. **Trading `RegisterBrokerAccount` guard**: reject an empty caller at the top of the service method (ALPACA, IBKR and OFFLINE), and fix the two caller-less tests. Decide whether `DeregisterBrokerAccountSvc`, `UpdateBrokerAccountCredentials` and `ListBrokerAccounts` get the same guard.
4. **Portfolio**: delete the `"alpaca-default"` dead fallback. Replace the three `"default"` fallbacks with ack-and-skip plus a WARN (nil return, counted as `acked`). Update `portfolio_helpers_test.go` and add skip tests per consumer, including "next event still processed".
5. **Notify `ListAlerts`**: make it header-only with code 3 when absent, ignore the body `userId`, and drop the `$1::text IS NULL` branch from both queries. Keep the untargeted-visible branch. Add the AC-3a and AC-3b tests, and optionally apply the same to `markAlertRead`.
6. **Consumer surfaces and docs**:
   - UI: update the `traderBff.ts:35-36` comment, plus an optional Vitest pin test.
   - Agent: update the `CLAUDE.md:29` wording; the test is unchanged unless the body field is dropped.
   - Analysis: update the `entry_backfill.py:73` comment.
   - Update the trading, notify and portfolio `CLAUDE.md` files and NOTIFY-5.
7. **Optional (OQ3)**: a cleanup migration (trading `012` and/or portfolio `019`) only if the design chooses it.
