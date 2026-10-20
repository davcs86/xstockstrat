# Recon: fix-push-untargeted-broadcast

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-notify, xstockstrat-portfolio, xstockstrat-analysis

---

## Objective

`WebPushDispatcher.dispatch` sends an alert with an empty `target_user_id` to every row of
`notify.push_subscriptions`, so OS notifications reach every user's devices. The fix narrows the
untargeted push to subscriptions of users who hold the admin role (operator decision 2026-10-20). It
keeps the targeted push as it is. Per-user producers (portfolio `emitRiskAlert`, and the analysis
live-loop `_emit_alert` / `_emit_fundamentals_unavailable_alert`) will set `target_user_id` to the
owning user.

## Codebase Map

- **`xstockstrat-notify`** (Node.js 24 / TypeScript)
  - Entry point: `services/xstockstrat-notify/src/index.ts:22` (`waitForSnapshot`). `WebPushDispatcher`
    is built at `:47` and `NotifyServiceImpl` at `:48`.
  - Bug site: `src/fanout/webPush.ts:88-101`. The untargeted branch at `:97-100` runs the unfiltered
    `SELECT subscription_id, endpoint, p256dh, auth FROM notify.push_subscriptions`. The targeted branch
    at `:91-96` filters with `WHERE user_id = $1`.
    - `PushAlert.targetUserId` comment at `:29`: `'' means broadcast to every subscription`.
    - `SubscriptionRow` at `:32-37` has only `subscription_id`, `endpoint`, `p256dh` and `auth`.
  - Gates that run before the audience query:
    - VAPID gate `webPush.ts:80`.
    - Severity gate `:84-86` (`notify.push.min_severity`, default 2, clamped [0,4]).
  - Error and test handling:
    - Best-effort catch-all `:116-118` (`log.warn('push dispatch error' …)`).
    - Network seam `protected deliver` `:123`.
    - 404/410 prune by endpoint only `:139` (NOTIFY-6).
  - Emit wiring: `src/grpc/notifyServiceImpl.ts`.
    - The alert object is built at `:65-78`, with `targetUserId: req.targetUserId ?? ''` at `:72`.
    - It is persisted with `req.targetUserId || null` at `:56`.
    - Web Push is dispatched in a second `queueMicrotask` after the RPC callback, at `:106-112`.
  - Register handler: `notifyServiceImpl.ts:231-253`.
    - The owner comes from `x-user-id` only (`:235`, NOTIFY-5). The handler does not read
      `x-access-scope` today.
    - Upsert at `:242-247`: `ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh …, auth …, user_agent …, created_at = NOW()`.
    - Unregister deletes by endpoint at `:262-264`.
  - In-app audience filters, which are unchanged by FR-1 but matter for FR-3:
    - `matchesSubscriber` at `notifyServiceImpl.ts:273-276`: a targeted alert reaches only the
      matching `sub.userId`.
    - `ListAlerts` at `:202` and `:210`: `a.target_user_id = $1 OR a.target_user_id IS NULL`.
    - The UI BFF always injects `userId: claims.user_id` into StreamAlerts
      (`services/xstockstrat-ui/src/lib/traderBff.ts:85-90`).
  - Last migration: `003_alert_reads.up.sql` (`services/xstockstrat-notify/migrations/`; 000–003
    present). The next migration is **`004`**.
    - Schema `migrations/002_push_subscriptions.up.sql:9-17`: `user_id TEXT NOT NULL`,
      `endpoint TEXT NOT NULL UNIQUE`, with no role or admin column.
    - Index `idx_push_subscriptions_user` at `:19`.
  - Config-read pattern: `this.config.getInt('notify.push.min_severity', 2)` at `webPush.ts:85`, read
    live on every dispatch.
  - Tests: `package.json:12` (`tsc && node --test dist/__tests__/*.test.js`), coverage `--lines 40` at
    `:13`.
  - The only caller of `RegisterPushSubscription` is the UI BFF plain `forward()` at
    `services/xstockstrat-ui/src/lib/traderBff.ts:95-97`.
    - `forward` attaches `backendHeaders` (`services/xstockstrat-ui/src/lib/bffShared.ts:64-72`),
      which sends `x-access-scope: String(rolesToAccessScope(claims.roles))` (`:41`).
    - The admin bit is `ADMIN_SCOPE = 0x04` (`services/xstockstrat-ui/src/lib/auth.ts:79`), mapped
      from the `admin` role at `:89`.
- **`xstockstrat-portfolio`** (Go 1.27)
  - Entry point: `services/xstockstrat-portfolio/cmd/server/main.go:58` (`NewPortfolioService`) and
    `:108` (`Serve`).
  - Handler: `internal/service/portfolio_service.go`.
    - `emitRiskAlert(ctx, msg)` at `:1004-1018` builds `EmitAlertRequest` at `:1008-1014` without
      `TargetUserId`.
    - It emits ledger `portfolio.risk.drawdown_breach` at `:1005`.
  - Owner in scope: `checkRiskLimits(ctx, userID, mode)` at `:964`.
    - Concentration emit at `:991`. Drawdown emit at `:999`, with the body from `evaluateDrawdowns`
      at `:956-958`.
    - Its only production caller is `s.checkRiskLimits(ctx, fill.UserID, mode)` at `:375`.
  - Notify client: field at `:45`, mTLS dial with `middleware.UnaryClientInterceptor` at `:140`,
    client built at `:151`. `NOTIFY_ENDPOINT` is read at `internal/config/config.go:38`.
  - Config-read pattern: `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)` and
    `…concentration_limit_pct", 0.20` at `portfolio_service.go:965-966`.
  - Last migration: `017_offline_realized_lifetime_fees.up.sql`. No migration is needed.
- **`xstockstrat-analysis`** (Python 3.13)
  - Entry point: `services/xstockstrat-analysis/app/main.py:39` (`serve`). `LiveEvaluationLoop` is
    built at `:149` and receives `notify_stub=servicer._notify` at `:154` (fundsignal at `:189`).
  - The stub is built at `app/handlers/servicer.py:517` over the mTLS notify channel (`main.py:88-91`).
  - Alert builders, neither of which sets `target_user_id`:
    - `_emit_alert` at `app/engine/live_loop.py:824-845` (EmitAlert `:835-845`), called at `:819`.
    - `_emit_fundamentals_unavailable_alert` at `:847-861` (title `:854`), called at `:727` inside
      `try/except` with `log.warning` (`:726-729`).
  - Owner source: `definition.user_id`. It is assigned at `:383` (`owner = definition.user_id`), the
    evaluator comes from `for_owner(definition.user_id)` at `:696`, and the state key is built at `:703`.
  - Owner guard: `_drain_held` and `_drain_watchlist` call `owner_metadata(owner)` (`:522`, `:551`).
    - That raises `ValueError` for `''` or `system` (`app/identity.py:6-10`).
    - `_run_cycle` then skips the strategy (`live_loop.py:393-395`) before `_eval_pair` (`:454`).
    - `_eval_pair` is the only caller path to both emitters. A live-loop alert therefore always has a
      real owner.
  - System producer (outside FR-3): `app/engine/fundsignal_loop.py:614-626` (`_emit_warning`,
    `category="system"`, untargeted).
  - Config-read pattern: `self._cfg.get_int("analysis.engine.alert_throttle_seconds", default=300)` at
    `live_loop.py:351`.
  - Last migration: `027_contract_owner_dimension.up.sql`. No migration is needed.

## Patterns to REUSE

- **Untargeted audience query.** Keep it inside the existing disjoint `WebPushDispatcher.dispatch`
  (`webPush.ts:88-101`), beside the targeted `WHERE user_id = $1` query (`:91-96`) and on the injected
  pool with no new pool (F-06).
  - Do not put it in `FanoutDispatcher`. Feature 165 kept push a disjoint class to protect the Slack
    and email `@AC-*` isolation (insights.md:2529-2539).
- **Gate ordering.** Put the audience filter after the VAPID gate (`webPush.ts:80`) and after the
  live severity gate (`:84-86`), so `@AC-6` and `@AC-7 @feature-165` still hold.
  - Do not gate on a `context` key (`services/xstockstrat-notify/docs/context-constitution.md:25`).
- **Failure containment.** Any admin-resolution error falls into the existing catch-all
  (`webPush.ts:116-118`) inside the post-callback `queueMicrotask` (`notifyServiceImpl.ts:106-112`).
  This keeps `@AC-5 @feature-165`, so a failed lookup never fails or delays `EmitAlert`.
- **Prune.** Reuse `sendOne`'s delete-by-endpoint (`webPush.ts:139`) unchanged for the admin-audience
  path (NOTIFY-6: never add user scoping).
- **Admin-bit parsing, if notify reads `x-access-scope`.** Copy the fail-closed helper:
  - Source: `ADMIN_SCOPE = 0x04` and `hasAdminAccessScope(md)` from
    `services/xstockstrat-identity/src/grpc/authz.ts:9-11,28-32`, which returns false on absent
    metadata, an absent header or a NaN value.
  - Config has the same copy at `services/xstockstrat-config/src/grpc/authz.ts:8,20`.
  - Per-service copies are the established pattern, because services cannot import each other.
  - Optionally add config's `0x04` literal lint ban (`services/xstockstrat-config/.eslintrc.json:24`).
    Notify's `.eslintrc.json:10-13` has no such rule today.
- **Header read in register.** Use `call.metadata?.get?.('<header>')?.[0]` as at
  `notifyServiceImpl.ts:235`.
- **Register upsert.** Add any new column to both the `INSERT` and the `ON CONFLICT … DO UPDATE SET`
  list (`notifyServiceImpl.ts:242-247`), so a re-register refreshes it. The register test asserts
  that every mutable column is refreshed (`src/__tests__/notifyServiceImpl.test.ts:485-488`) and pins
  the exact param list at `:490`.
- **Migration shape.** Follow `migrations/002_push_subscriptions.up.sql` (`IF NOT EXISTS`, comment
  header) for `004_<desc>.up.sql` and `.down.sql`, if a column is persisted.
- **Notify test harness** (`src/__tests__/webPush.test.ts`):
  - Helpers to reuse: `capturingPool` (`:33-45`), `cfg()` (`:47-49`), `StubbedDispatcher`
    (`:53-60`), `withVapid` (`:62`), `alert()` (`:88-98`, default `targetUserId: 'user-42'`), `SUBS`
    (`:100-103`).
  - Keep the targeted regression guard at `:129-145` (SQL `WHERE user_id = \$1`, params `['user-42']`).
  - Rewrite the broadcast case at `:147-155` deliberately (operator sign-off).
  - `capturingPool` returns the same rows for every SELECT, so AC-1/AC-5 need SQL and param
    assertions or a filtering fake.
  - Register harness: `metaCall` (`notifyServiceImpl.test.ts:463-468`) answers only `x-user-id`.
- **Portfolio owner threading.** Pass `checkRiskLimits`' `userID` (`portfolio_service.go:964`) into
  `emitRiskAlert` at both call sites (`:991`, `:999`) and set
  `EmitAlertRequest.TargetUserId` (proto field 6, `packages/proto/notify/v1/notify.proto:71`).
  - No new client or interceptor is needed (`:140`, `:151`).
- **Portfolio test harness:**
  - Notify stub: `recordingNotify` (`internal/service/portfolio_quote_deadline_test.go:346-357`) keeps
    only `in.Body`. Extend it to keep the request (`TargetUserId`/`Category`/`Severity`). Its other
    consumer is `offline_account_pnl_test.go:314` (`TestBackgroundPathsMakeNoBarsCalls`, `:311`).
  - Tests to extend: `TestCheckRiskLimits_AC3_SumsAcrossAccounts` (`:441-458`) and
    `TestCheckRiskLimits_AC9_UnpricedSkipsConcentrationDrawdownStillAlerts` (`:461-481`).
  - Helpers: `expectDrawdowns` (`:367-373`) hard-codes `.WithArgs("u1", "TRADING_MODE_PAPER")`; use
    `"u1"` or parameterize it. `ctxWithUser` is at `watchlist_service_test.go:280`.
  - Fixtures (C-13 Go home): `internal/testdata/marks.go:7-17` (`Lyft`, `LyftMark`, `LyftQty`, `Msft`,
    `MsftBrokerPrice`, `MsftQty`).
- **Analysis owner.** Set `target_user_id=definition.user_id` in both `EmitAlertRequest` builders
  (`live_loop.py:835-845`, `:850-860`). Ownership is already validated upstream by `owner_metadata`
  (`app/identity.py:6-10`), so no new guard is needed.
- **Analysis test harness** (`tests/test_live_loop.py`):
  - `_make_loop()` (`:36-58`, `loop._notify.EmitAlert = AsyncMock(...)` at `:56`).
  - For AC-4, copy `test_entry_exit_edge_triggered` (`:67-83`, `user_id="u1"`).
  - For AC-7, extend `TestLiveLoopFundamentalsDenyEntry_feature215` (`:1338`).
    `test_ac6_ac5_denied_three_cycles_one_warn_one_alert` (`:1392`) already reads
    `req = loop._notify.EmitAlert.await_args.args[0]` (`:1409`) and asserts `req.category` (`:1412`).
  - An inline `"u1"` owner complies with C-13 because it has a single consumer.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2 @FR-2 @feature-165` "Enabling notifications persists a per-user subscription" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). The upsert-by-endpoint row must still hold if the design adds an admin-audience column to `notify.push_subscriptions` (notify migration 004).
- **PRESERVE** `@AC-3 @FR-2 @feature-165` "Disabling notifications removes the subscription" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). Delete-by-endpoint must not change under any schema change.
- **EXTEND** `@AC-4 @FR-3 @feature-165` "An emitted alert is pushed to the target user's devices" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). Feature `@AC-2` adds exclusivity: no push to another user's endpoint or the admin's. A targeted push still goes to all of the target's devices and does not delay the alert_id.
- **PRESERVE** `@AC-5 @FR-3 @feature-165` "Push dispatch never fails or delays the primary emit" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). Admin-role resolution, whether a DB read or a lookup, runs inside the best-effort push path. Its failure is caught and logged at WARN and never fails or delays EmitAlert or StreamAlerts.
- **PRESERVE** `@AC-6 @FR-5 @feature-165` "Push is disabled when VAPID keys are absent" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). With no VAPID keys there is still no push attempt and no admin lookup.
- **PRESERVE** `@AC-7 @FR-5 @feature-165` "The min-severity gate suppresses low-severity pushes" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). The audience filter is applied together with `notify.push.min_severity`, never instead of it.
- **PRESERVE** `@AC-8 @FR-6 @feature-165` "A Gone subscription is pruned" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`). 404/410 pruning still applies to admin-audience sends.
- **PRESERVE** `@AC-1 @FR-2 @FR-3 @feature-203` "Marking a targeted alert read flips it to read for that user" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`). After FR-3, portfolio risk and live-loop alerts become targeted and take this path.
- **PRESERVE** `@AC-2 @FR-1 @FR-4 @feature-203` "A broadcast alert is unread for one user and read for another" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature:14`). Untargeted alerts stay visible to everyone in the stream and history, with read state per user. FR-1 narrows only the Web Push audience.
- **PRESERVE** `@AC-1 @FR-1 @feature-020` "A WARNING alert is fanned out to Slack when the webhook is configured" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`). The Slack/email channel is separate from Web Push and must not pick up the audience filter. FR-3 targeting does not change its gates or its dedup hash (category/source/title/body plus signal context).
- **EXTEND** `@AC-1 @FR-1 @regression @feature-172` "An account whose equity falls below its peak by more than the configured pct alerts" (`services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature:13-19`). Feature `@AC-6` adds `target_user_id` = the `checkRiskLimits` `userID`. Unchanged: WARNING severity, one alert per account, no alert within the threshold, and no alert when peak = 0.
- **EXTEND** `@AC-3 @FR-5 @regression @feature-231` "Concentration sums a symbol across accounts and alerts on the true weights" (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature:35-42`). Feature `@AC-3` adds `target_user_id` = owner. The emitted set stays exactly "concentration limit breach: LYFT at 24.1%" and "…MSFT at 75.9%".
- **PRESERVE** `@AC-9 @FR-5 @feature-231` "Any unpriced position skips concentration but drawdown still alerts" (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature:62-70`). "The only alert is" the exact drawdown body. Targeting must not emit an extra copy, broadcast or targeted.
- **EXTEND** `@AC-6 @FR-4 @feature-215` "A live-enabled fundamentals-gated strategy is denied entry on an ETF, auditably" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature:48,53`). Feature `@AC-7` adds `target_user_id` = `definition.user_id` on `_emit_fundamentals_unavailable_alert`. Still exactly one WARNING alert while the ETF stays unavailable, and exits still fire.
- **PRESERVE** `@AC-9 @FR-8 @feature-215` "A globally disabled snapshot source is not reported as absence" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature:70`). The live loop emits no alert here, and targeting must not add one.
- **PRESERVE** `@AC-37 @FR-3 @FR-6 @feature-224` "Fundamentals scan fails closed on a non-system scoring formula" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature:67`). The ERROR notify alert is still emitted. It is a system producer outside FR-3, stays untargeted, and after FR-1 is Web-Pushed to admins only.
- **PRESERVE** `@AC-36 @FR-4 @feature-224` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature`). The ERROR notify alert naming slug "macro-feed" is still emitted untargeted, and after FR-1 its push reaches admin devices only.
- **PRESERVE** `@AC-2 @FR-2 @regression @item-6 @feature-175` "The confirmed-dead propagation middleware is gone from the Node leaf services" (`docs/sdd/business-rules/platform.feature`). If notify resolves the admin role through a new outbound call, it must not bring back `src/middleware/propagation.ts`.
- **PRESERVE** `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be disabled" (`docs/sdd/business-rules/platform.feature`). Any new notify outbound gRPC dial (for example to identity for the admin role) must present the mTLS leaf (`services/xstockstrat-notify/src/mtls.ts:28` `clientCredentials()`) and fail closed.
- **CHANGE (no durable `@AC`)**: the feature 165 FR-3 rule "untargeted Web Push goes to every subscription" was never promoted to a durable suite. It is pinned only by the unit test `services/xstockstrat-notify/src/__tests__/webPush.test.ts:147-155`. The operator signed off the reversal on 2026-10-20 (`context.md` § Operator decisions). That test is rewritten deliberately as this feature's RED. At launch, this feature's scenarios are a C-16 ADD to `pwa-notifications.feature`.
- Suite coverage (from scenario-recon): all 3 notify suites read in full (21 scenarios). Portfolio: 12 suites (50 scenarios) keyword-scanned, with the 2 alert/risk files read in full. Analysis: 32 suites (184 scenarios) keyword-scanned, with the alert/notify files read in full. `platform.feature` read in full (53 scenarios). Of 308 scenarios, 19 are relevant: 0 durable CHANGE, 4 EXTEND, 15 PRESERVE.

## Dependencies

- **Proto/RPC.** No change is needed.
  - `EmitAlertRequest.target_user_id = 6` (`packages/proto/notify/v1/notify.proto:71`).
  - `Alert.target_user_id = 7; // empty = broadcast` (`:45`). This describes StreamAlerts and stays.
  - `RegisterPushSubscriptionRequest` has `endpoint = 1`, `p256dh = 2`, `auth = 3`, `user_agent = 4`
    (`:120-126`), and no user or role field (by design, C-03).
  - Identity, if consulted:
    - `Role.ROLE_ADMIN = 1` (`packages/proto/identity/v1/identity.proto:168`) and `User.roles = 3`
      (`:177`); `ListUsersResponse.users` is at `:190`.
    - `ListUsers` and `GetUser` are admin-gated on the caller's `x-access-scope` through `adminGate`
      (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:740,776,789`).
- **Migration.** Notify `004_<desc>.up.sql` and `.down.sql`, only if the design persists an admin
  audience on `notify.push_subscriptions`. Portfolio (next would be `018`) and analysis (`028`) need none.
- **Config keys.** None are anticipated. If the design adds a `notify.push.*` toggle:
  - Seed it like `services/xstockstrat-config/migrations/021_notify_push_min_severity.up.sql`.
  - The local config max is `030_marketdata_edgar_snapshot_keys`. 243 claims `031` and 241 may claim
    another, so the next free NNN is resolved across remote branches at /sdd-spec.
  - Approval: owner plus config team.
- **Inter-service edges.** No new edge is needed for the persisted-bit options. A notify → identity
  (gRPC) lookup would be a new edge:
  - The root `CLAUDE.md` § Inter-Service Dependencies graph and the notify `CLAUDE.md` § Dependencies
    table (today config + PostgreSQL only) would both need updating.
  - The edge is bound by `@AC-4 @feature-210` (mTLS) and `@AC-2 @feature-175`.
  - Portfolio → notify and analysis → notify already exist.
- **New env vars / ports.** None for the persisted-bit options. A notify → identity lookup would need
  `IDENTITY_ENDPOINT`, which is absent from the notify blocks in `docker-compose.yml:225-243` (it has
  `CONFIG_ENDPOINT` and `LEDGER_ENDPOINT` only), `.do/app.yaml:493-555` and `.do/app.dev.yaml:490-552`.

## Risks / Not-found

- **Notify cannot tell who is an admin today (design fork, FR-1).** It has no `x-access-scope` read,
  no `ADMIN_SCOPE`, no identity client and no role column (grep of `services/xstockstrat-notify/src`
  finds none). The candidate sources are listed below; the choice belongs to `/sdd-design`.
  - **(a) Capture the admin bit at `RegisterPushSubscription`.** The bit would come from
    `x-access-scope` (sent by `bffShared.ts:41`) and be stored in a new column (migration 004).
    - Not found: any mechanism that refreshes the stored bit when roles change. A demotion via
      identity `SetUserRoles` (`identityServiceImpl.ts:835`) leaves the bit stale until the user
      re-registers, and a promotion is not picked up either.
    - Rows created before the migration need a fail-closed default (non-admin), so admins re-register
      before they receive untargeted pushes.
    - An absent or unparseable scope must fail closed to non-admin (as `hasAdminAccessScope` does).
      It must not be rejected with code 3: `x-access-scope` is authorization, not identity. That
      contrasts with fails.md:2779-2782, where a missing `x-user-id` is rejected.
  - **(b) Look the role up in identity.** `ListUsers`/`GetUser` require the caller's admin bit, and no
    `x-internal-caller` allow-list exists in `services/xstockstrat-identity/src` (grep finds none).
    - Notify would have to mint an admin `x-access-scope`, which is the fails.md:531-534 near-miss
      (forwarding an elevated scope from an entry point that never authenticated it).
    - Otherwise identity needs a new internal-caller grant or RPC. Identity is not in the affected
      set, so that adds a service, a new edge and new deploy env.
  - **(c) Read `identity.users.roles TEXT[]` directly**
    (`services/xstockstrat-identity/migrations/001_identity_tables.up.sql:10`). This crosses into
    another service's schema, against the root `CLAUDE.md` § Database rule "each service owns its schema".
  - **(d) An operator-maintained admin list in config.** This drifts from identity roles and keeps a
    second source of truth.
- **Stale-role exposure (applies to a).** A user demoted after subscribing keeps getting untargeted
  pushes until they re-register. That is a residual privacy gap, so the design must state it, bound it
  or close it.
- **FR-3 changes in-app visibility, against product-spec § Consumer Surface ("In-app alert stream /
  history: unchanged").**
  - Once portfolio and live-loop alerts carry `target_user_id`, StreamAlerts delivers them only to the
    owner (`notifyServiceImpl.ts:273-276`; the BFF injects `userId` at `traderBff.ts:85-90`), and
    `ListAlerts` returns them only to the owner (`:202`, `:210`). Admins lose in-app sight of these
    alerts.
  - No durable `@AC` pins these producers as broadcast, so this is not a C-16 CHANGE. The design must
    still state it or amend the spec.
  - It must not be "fixed" by emitting a second, untargeted copy. That breaks `@AC-3 @feature-231`
    ("exactly"), `@AC-9 @feature-231` ("the only alert") and `@AC-6 @feature-215` ("exactly one").
- **Trading's per-account alerts are still untargeted. FR-3 does not cover them yet; decide at design.**
  - The untargeted sites: reconciliation mismatch
    `services/xstockstrat-trading/internal/service/trading.go:1938-1944`, account halt `:2751-2757`
    (both per-account), and systemic REDUCE_ONLY `:2183-2189` (platform-wide, correctly untargeted).
  - After FR-1 the per-account alerts reach admin devices only. Extending FR-3 to them means adding
    trading as an affected service and reading its suite in full. Only
    `resume-halted-account.feature @AC-3 @feature-169` (INFO, below the push gate) was side-checked,
    so trading is a C-16 blind spot until then.
  - The alternative is to name a follow-up feature (C-14).
- **Other untargeted producers.** Fundsignal `_emit_warning` (`fundsignal_loop.py:614-626`, `system`
  identity, operational) correctly stays untargeted and becomes admin-only after FR-1. Agent
  `emit_alert` and the ingest backfill auto-alert are out of scope per product-spec.
- **Same-helper collision.** The open defect
  `docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md` (status `open`, no
  feature claims it) concerns the ledger event type at `portfolio_service.go:1005`, inside
  `emitRiskAlert`. That is the helper FR-3 changes, so two parallel fixes would collide.
- **Overlap (from sdd-review).**
  - 251-fix-getpnl-source-service shares `portfolio_service.go` (GetPnL `:753`, `:798`), about 250
    lines apart.
  - 244-fix-python-config-zero-trap may touch `live_loop.py:351`.
  - Both are rebase-only, with no hard ordering. Notify `migrations/` is untouched by any other feature.
- **Test fake limits.** `capturingPool` ignores `WHERE` (`webPush.test.ts:33-45`), so "admin-only" can
  be proven only through SQL and param assertions or a filtering fake. An unfiltered-SELECT regression
  stays green unless a test asserts the SQL.
- **Analysis `system` owner.** Ruled out for live-loop alerts: `owner_metadata` raises before
  `_eval_pair` (`live_loop.py:393-395`, `app/identity.py:8-9`). So `target_user_id` is never `system`
  or `''` on those two emitters.
- **Doc drift to fix in the same PR.**
  - `services/xstockstrat-notify/CLAUDE.md` § Web Push ("`target_user_id` (empty ⇒ broadcast to all
    subscriptions)").
  - The `webPush.ts:29` and `:88-89` comments.
- **Doc drift out of scope.** `services/xstockstrat-analysis/CLAUDE.md:232` says notify is used to
  "Alert on completed backtests", but `servicer.py` makes no `EmitAlert` call.
- **Not found.**
  - Any portfolio or analysis test that asserts EmitAlert's `TargetUserId`, `Category` or `Severity`.
    Portfolio tests check `Body` only, and analysis has no `target_user_id` reference anywhere.
  - A portfolio fixture for "user-42" or "acct-1" with peak 10000.00 and current 8500.00. Every
    `checkRiskLimits` test uses "u1".
  - A broadcast scenario in the durable `pwa-notifications.feature`.
  - A notify Node fixture home (`src/__tests__/fixtures/`). Under C-13 it materializes only on a
    second consumer.
- **Applicable `fails.md` traps:**
  - fails.md:531-534: do not forward or mint an elevated `x-access-scope` from an unauthenticated
    entry point (option b).
  - fails.md:1620-1623: do not gate on a producer field nobody writes. Confirm every producer that FR-3
    retargets actually sets the field, by grep of the request builders.
  - fails.md:2779-2782: header-identity handlers reject a missing `x-user-id`; keep register's code 3
    (NOTIFY-5).
- **Applicable `insights.md` entries:**
  - insights.md:2529-2539: keep push a disjoint class, fail loud at startup on bad credentials.
  - insights.md:459-470: when `EmitAlert` callers send no admin metadata, an admin gate on emit would
    break every caller. This feature filters the push audience only and does not gate `EmitAlert`.
  - insights.md:3536-3539: per-user state on broadcast rows goes in a marks table, not a column on the
    shared row. Here, though, the role is per subscription row and is not per-user state on the alert.

## Recommended Scope

Advisory only:
1. **notify, service and test.** Resolve the admin audience (fork a–d above). If (a), add migration
   `004` and read `x-access-scope` in `registerPushSubscription` through a copied fail-closed
   `hasAdminAccessScope`.
   - Replace the unfiltered SELECT in `webPush.ts:97-100` with the admin-filtered audience. Keep the
     targeted branch byte-identical.
   - RED: rewrite `webPush.test.ts:147-155` (AC-1, AC-5), add the exclusivity assertion to the
     targeted guard (AC-2), and extend the register test (`notifyServiceImpl.test.ts:470-492`) if a
     column is added.
   - Update the notify `CLAUDE.md` § Web Push and the `webPush.ts:29` comment.
2. **portfolio, service and test.** Thread `userID` into `emitRiskAlert` on both paths and set
   `TargetUserId`. Extend `recordingNotify` to keep the request, and assert target, category and
   severity in the AC-3 and AC-9-style tests (AC-3, AC-6), keeping the exact body sets.
3. **analysis, service and test.** Set `target_user_id=definition.user_id` in `_emit_alert` and
   `_emit_fundamentals_unavailable_alert`, with assertions in the `_make_loop` tests (AC-4, AC-7).
4. **Design decisions to record, not code:**
   - The in-app visibility consequence of FR-3 (amend product-spec § Consumer Surface or accept it).
   - Trading per-account alerts: extend FR-3 (add the service, read its suite) or name a follow-up
     feature.
   - Coordination with the open concentration-logged-as-drawdown defect on `emitRiskAlert`.
