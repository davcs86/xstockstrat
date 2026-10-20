# Recon: fix-push-untargeted-broadcast

**Created**: 2026-10-20
**From**: product-spec.md (re-reviewed 2026-10-20), acceptance.feature (@AC-1..@AC-7)
**Affected services**: xstockstrat-notify, xstockstrat-portfolio, xstockstrat-analysis

---

## Objective

`WebPushDispatcher.dispatch` sends every alert with an empty `target_user_id` to every row of
`notify.push_subscriptions`, so one user's alert content reaches every user's devices. The fix
limits untargeted Web Push to subscriptions of admin-role users (FR-1; operator decision
2026-10-20, which reverses feature 165 FR-3). The targeted path stays byte-identical (FR-2). Portfolio
`emitRiskAlert` and the analysis live-loop `_emit_alert` / `_emit_fundamentals_unavailable_alert`
set `target_user_id` to the owning user (FR-3). Still open for design: how notify decides who is an
admin.

## Codebase Map

- **`xstockstrat-notify`** (Node.js 24 / TypeScript)
  - Entry point: `services/xstockstrat-notify/src/index.ts:22` (`waitForSnapshot`).
    - Pool `max: parseInt(process.env.DB_POOL_MAX ?? '1')` at `:39`.
    - `new WebPushDispatcher(pool, configWatcher)` at `:47`.
    - `new NotifyServiceImpl(pool, configWatcher, fanout, webPush)` at `:48`.
  - Bug site: `src/fanout/webPush.ts:88-101`. When `alert.targetUserId` is set, the code runs
    `… WHERE user_id = $1` (`:91-96`). Otherwise it runs the unfiltered
    `SELECT subscription_id, endpoint, p256dh, auth FROM notify.push_subscriptions` (`:97-101`).
    - `PushAlert.targetUserId` (`:29`) has the comment `'' means broadcast to every subscription`.
      This comment becomes wrong after the fix.
    - `SubscriptionRow` (`:32-37`) has `subscription_id`, `endpoint`, `p256dh` and `auth`.
    - The dispatcher takes `pool` and `config` through its constructor (`:52-55`).
  - Gates that run before the audience query:
    - VAPID gate: `webPush.ts:80`.
    - Severity gate: `:84-86` (`getInt('notify.push.min_severity', 2)`, clamped to 0..4).
  - Error and test handling:
    - Catch-all: `:116-118` (`log.warn('push dispatch error' …)`).
    - Network seam that tests override: `protected deliver` at `:123`.
    - 404/410 responses prune by endpoint only: `:139`.
  - EmitAlert: `src/grpc/notifyServiceImpl.ts`.
    - Persists `req.targetUserId || null` (`:56`).
    - Builds the alert object at `:65-78`, with `targetUserId: req.targetUserId ?? ''` (`:72`).
    - Stream fan-out at `:81-90`, then `callback` at `:93`.
    - Slack/SendGrid fanout microtask at `:100-104`; Web Push microtask at `:108-112`.
  - Register: `registerPushSubscription` at `notifyServiceImpl.ts:231-255`.
    - Reads `x-user-id` only (`:232`) and returns code 3 if it is absent (`:233-234`).
    - Upsert at `:242-247`: `ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh …, auth …, user_agent …, created_at = NOW()`.
    - Params at `:248`. The handler never reads `x-access-scope`.
  - Unregister deletes by endpoint: `:261-271` (SQL at `:264`).
  - In-app audience, which FR-1 does not touch:
    - `matchesSubscriber`: `:273-276`.
    - `ListAlerts`: `:202` and `:210` (`a.target_user_id = $1 OR a.target_user_id IS NULL`).
  - Schema: `migrations/002_push_subscriptions.up.sql:9-17`.
    - `user_id TEXT NOT NULL` (`:11`).
    - `endpoint TEXT NOT NULL UNIQUE` (`:12`).
    - Index `idx_push_subscriptions_user` on `user_id` (`:19`).
    - No role or admin column.
  - Last migration: `003_alert_reads.up.sql` (`services/xstockstrat-notify/migrations/`, which holds
    `000`-`003`). The next number is **`004`**.
  - Config-read pattern: `webPush.ts:85`. `ConfigWatcher` provides `getString` / `getInt` /
    `getFloat` / `getBool` (`src/services/configWatcher.ts:110,115,120,125`).
  - Test command: `package.json:12` (`tsc && node --test dist/__tests__/*.test.js`). Coverage
    command: `:13` (c8 `--lines 40`).
  - Invariants (`services/xstockstrat-notify/docs/context-constitution.md`):
    - NOTIFY-1 (`:16`): severity stays a string at fan-out.
    - NOTIFY-5 (`:19`): register takes the owner from `x-user-id` only.
    - NOTIFY-6 (`:20`): unregister and prune delete by `endpoint` only.
    - Push gates on severity only, never on a `context` key (`:25`).
    - `EmitAlert` is deliberately not role-gated. No caller sends an admin bit
      (`services/xstockstrat-notify/CLAUDE.md:43-55`, feature 092).
- **`xstockstrat-portfolio`** (Go 1.27)
  - Handler: `internal/service/portfolio_service.go`.
    - `emitRiskAlert(ctx, msg)` at `:1004-1018` takes no owner. It builds `EmitAlertRequest`
      (`:1008-1014`: WARNING, `Category: "risk"`, `Title: "portfolio risk limit breach"`,
      `Body: msg`, `SourceService: "portfolio"`) with no `TargetUserId`.
    - It also appends a ledger event `portfolio.risk.drawdown_breach` on `"portfolio:risk"` (`:1005`).
  - Owner in scope: `checkRiskLimits(ctx, userID, mode)` at `:964`.
    - Concentration emit at `:991`.
    - Drawdown emit at `:998-999`. Its body comes from `evaluateDrawdowns` (`:948`, format at
      `:956-958`).
  - Call chain: the only production caller is `s.checkRiskLimits(ctx, fill.UserID, mode)` (`:375`).
    - That call is inside `processOrderFill` (`:264`), driven by the ledger order-fill stream.
    - `fill.UserID` comes from JSON field `user_id` (`:246`).
  - Notify client: field at `:45`, mTLS dial with `middleware.UnaryClientInterceptor` at `:140`, and
    `NewNotifyServiceClient` at `:151`.
    - The stream path carries no `x-user-id`. The interceptor injects headers only when
      `PropagationData` is in the ctx (`internal/middleware/propagation.go:20-49`).
  - Config-read pattern: `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)` and
    `…concentration_limit_pct", 0.20)` (`portfolio_service.go:965-966`).
  - Last migration: `017_offline_realized_lifetime_fees.up.sql`. No migration is needed.
- **`xstockstrat-analysis`** (Python 3.13)
  - Entry point: `app/main.py`. `LiveEvaluationLoop(…, notify_stub=servicer._notify, …, portfolio_stub=servicer._portfolio)`
    is at `:149-159`. The stub is built at `app/handlers/servicer.py:517`.
  - Alert builders, neither of which sets `target_user_id`:
    - `_emit_alert`: `app/engine/live_loop.py:824-845`, EmitAlert at `:834`, called at `:819`.
    - `_emit_fundamentals_unavailable_alert`: `:847-861`, title at `:854`, called at `:727` inside
      `try/except`.
  - Owner source: `definition.user_id`.
    - Set at `servicer.py:7214` (`row.get("user_id", "") or ""`).
    - Proto field `StrategyDefinition.user_id = 13` (`packages/proto/analysis/v1/analysis.proto:377`).
    - `definition` is rebound by `sector_params.apply_sector` (`live_loop.py:734`). That copies with
      `out.CopyFrom(definition)` (`app/services/sector_params.py:109`), so `user_id` survives.
  - Owner guard:
    - `_run_cycle` reads `owner = definition.user_id` (`live_loop.py:383`).
    - It calls `_drain_held` / `_drain_watchlist` inside `except ValueError → continue` (`:384-395`).
    - Both call `owner_metadata(owner)` (`:522`, `:551`), which raises for `''` or `system`
      (`app/identity.py:6-10`).
    - Records reach `_eval_pair` (`:454`) only after that guard.
    - Pinned by `tests/test_owner_header_guard.py:423`.
  - System producer outside FR-3: `app/engine/fundsignal_loop.py:614-628` (`_emit_warning`,
    `category="system"` at `:621`, untargeted). Also called from `_abort_cycle` (`:604`).
  - Config-read pattern: `self._cfg.get_int("analysis.engine.alert_throttle_seconds", default=300)`
    (`live_loop.py:351`).
  - Last migration: `027_contract_owner_dimension.up.sql`. No migration is needed.

## Patterns to REUSE

- **Untargeted audience query.** Replace the unfiltered branch inside
  `WebPushDispatcher.dispatch` (`webPush.ts:97-101`), next to the targeted query (`:91-96`).
  - Use the injected `pool`, whose max is 1 (`index.ts:39`; F-06). Do not create a new pool.
  - Do not move push into `FanoutDispatcher`. A disjoint push class protects the Slack/email
    `@AC-*` isolation (insights.md:2529-2539).
- **Gate order.** The audience lookup goes after the VAPID gate (`webPush.ts:80`) and the live
  severity gate (`:84-86`). Then no lookup runs while push is disabled or below `min_severity`
  (`@AC-6`, `@AC-7 @feature-165`). Never gate on `context` (`context-constitution.md:25`;
  fails.md:1620-1623).
- **Failure containment.** Any admin-resolution error must fall into the existing catch-all
  (`webPush.ts:116-118`) inside the post-callback microtask (`notifyServiceImpl.ts:108-112`;
  insights.md:2144-2151). A failed lookup means no push plus a WARN, never an RPC error
  (`@AC-5 @feature-165`).
- **Prune.** Reuse `sendOne`'s delete-by-endpoint (`webPush.ts:139`) unchanged for the rows the admin
  audience selects (NOTIFY-6: never add `user_id` scoping).
- **Admin-bit parsing, if notify reads `x-access-scope`.** Copy the fail-closed pair:
  - `ADMIN_SCOPE = 0x04` and `hasAdminAccessScope(md)` from
    `services/xstockstrat-identity/src/grpc/authz.ts:10,28-32`. It returns false on absent metadata,
    an absent header or a NaN value.
  - Config has a twin at `services/xstockstrat-config/src/grpc/authz.ts:8,20`.
  - Per-service copies are the precedent. A third Node copy versus extracting a shared helper is a
    C-18/DRY call for design.
- **Header read.** Read headers with `call.metadata?.get?.('<key>')?.[0]`, as at
  `notifyServiceImpl.ts:232`.
- **Admin-bit source on the register path.** The UI BFF `forward` (`services/xstockstrat-ui/src/lib/traderBff.ts:95-97`)
  attaches `backendHeaders` (`services/xstockstrat-ui/src/lib/bffShared.ts:38-43`).
  - The header is
    `x-access-scope: String(rolesToAccessScope(claims.roles))` (`:41`). The admin role maps to
    `ADMIN_SCOPE` at `services/xstockstrat-ui/src/lib/auth.ts:79,89`.
  - This is the same trust model as `x-user-id` (NOTIFY-5): the edge injects it from the verified
    JWT.
- **Register upsert.** Any new column goes into both the `INSERT` and the `ON CONFLICT … DO UPDATE SET`
  (`notifyServiceImpl.ts:242-247`).
  - The register test asserts that every mutable column is refreshed
    (`src/__tests__/notifyServiceImpl.test.ts:485-488`).
  - It also pins the exact param list (`:490`), so a new bound param fails it deliberately.
- **Migration shape.** If a column or table is added, follow `migrations/002_push_subscriptions.up.sql`
  (header comment, `IF NOT EXISTS`) for `004_<desc>.up.sql` + `.down.sql`.
- **Config key, only if design adds one.**
  - Seed it like `services/xstockstrat-config/migrations/021_notify_push_min_severity.up.sql`
    (staging and production rows).
  - Register it beside `docs/patterns/config-governance.md:528` and
    `services/xstockstrat-notify/CLAUDE.md:83`.
  - Read it live with `getBool` / `getString` (`configWatcher.ts:125,110`).
- **Notify test harness** (`src/__tests__/webPush.test.ts`):
  - Fixtures:
    - `capturingPool` (`:33-45`): any `SELECT` returns the same `rows`. It is not SQL-aware.
    - `cfg` (`:47-49`): implements only `getInt`.
    - `StubbedDispatcher` (`:53`), `withVapid` (`:62`), `withoutVapid` (`:75`).
    - `alert()` (`:88-98`), with default `targetUserId: 'user-42'`.
    - `SUBS` (`:100-103`).
  - Keep the targeted guard at `:129-145` (`/WHERE user_id = \$1/`, params `['user-42']`).
  - Rewrite the broadcast case at `:147-155` deliberately as the RED (operator sign-off).
  - Register harness (`src/__tests__/notifyServiceImpl.test.ts`):
    - `capturingPool` (`:449-460`).
    - `metaCall` (`:463-468`), which serves `x-user-id` only. Extend it for `x-access-scope`.
    - `noopWebPush` (`:59`), `recordingWebPush` (`:64`).
    - Push-isolation test at `:546-565`.
- **Go producer targeting precedent.** Trading already sets `TargetUserId: order.UserId` on its
  bracket, approval and fill alerts (`services/xstockstrat-trading/internal/service/trading.go:3348`,
  `:3684`, `:3700`). Portfolio sets the same body field.
- **Portfolio owner threading.** Pass the `checkRiskLimits` `userID` (`portfolio_service.go:964`)
  into `emitRiskAlert` at `:991` and `:999`, and set `EmitAlertRequest.TargetUserId`.
  - The field is proto field 6 (`packages/proto/notify/v1/notify.proto:71`).
  - It must be the body field, not a header. The stream path carries no propagation
    (`propagation.go:20-49`).
  - No new client, interceptor or `x-internal-caller` is needed. Notify applies no authz to the
    target (`notifyServiceImpl.ts:56`).
- **Portfolio test harness** (`internal/service/`):
  - `recordingNotify` (`portfolio_quote_deadline_test.go:346-357`) records `in.Body` only. Extend it
    to keep `TargetUserId`, `Category` and `Severity`. It has another consumer at
    `offline_account_pnl_test.go:314`.
  - Bases to extend:
    - `TestCheckRiskLimits_AC3_SumsAcrossAccounts` (`:441-458`) for AC-3.
    - `TestCheckRiskLimits_AC9_UnpricedSkipsConcentrationDrawdownStillAlerts` (`:461-481`). Its
      drawdown is `brk-1` 800/1000, so AC-6's `acct-1` 8500/10000 is a new case.
  - `expectDrawdowns` (`:367-373`) hard-codes `.WithArgs("u1", "TRADING_MODE_PAPER")`.
  - Go fixture home (C-13): `internal/testdata/marks.go:7-17` (`Lyft`, `LyftMark`, `LyftQty`, `Msft`,
    `MsftBrokerPrice`, `MsftQty`).
  - Test command: `cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/...`.
- **Analysis owner.** Add `target_user_id=definition.user_id` to both `notify_pb2.EmitAlertRequest`
  builders (`live_loop.py:835-844`, `:850-860`). `owner_metadata` already validates the owner
  upstream (`app/identity.py:6-10`).
- **Analysis test harness:**
  - `_make_loop()` (`tests/test_live_loop.py:36-58`), with `EmitAlert = AsyncMock` at `:56`.
  - For AC-4, the base is `test_entry_exit_edge_triggered` (`:67`, `user_id="u1"`). No test asserts
    `_emit_alert` request fields today.
  - For AC-7, extend `TestLiveLoopFundamentalsDenyEntry_feature215` (`:1338`).
    `test_ac6_ac5_denied_three_cycles_one_warn_one_alert` (`:1392`) already reads
    `req = loop._notify.EmitAlert.await_args.args[0]` (`:1409`).
  - A second harness exists at `tests/test_fundamentals_formula_servicer.py:74-90` (`EmitAlert` at
    `:88`).

## Existing Business Rules (preserve / extend)

Folded from the scenario-recon digest. One conditional row (feature 175) was added by a targeted
re-grep.
- **PRESERVE** `@AC-4 @FR-3 @feature-165` "An emitted alert is pushed to the target user's devices"
  (`services/xstockstrat-notify/acceptance/pwa-notifications.feature:24-29`).
  - This is FR-2, the regression guard. 242 `@AC-2` only adds negatives (no push to user-77 or the
    admin endpoint).
  - At promotion, merge or extend this scenario rather than duplicating it.
- **PRESERVE** `@AC-5 @FR-3 @feature-165` "Push dispatch never fails or delays the primary emit"
  (`pwa-notifications.feature:31-32`). Admin resolution stays inside the best-effort microtask. A
  failure means no push plus a WARN, never an RPC error or added latency.
- **PRESERVE** `@AC-6 @FR-5 @feature-165` "Push is disabled when VAPID keys are absent"
  (`pwa-notifications.feature:38-39`). There is no push and no admin lookup while the channel is
  disabled.
- **PRESERVE** `@AC-7 @FR-5 @feature-165` "The min-severity gate suppresses low-severity pushes"
  (`pwa-notifications.feature:44-45`). The gate also applies on the admin-audience path. 242 `@AC-1`
  and `@AC-5` assume `min_severity` 2.
- **PRESERVE** `@AC-8 @FR-6 @feature-165` "A Gone subscription is pruned"
  (`pwa-notifications.feature:51-52`). The 404/410 prune still works for rows the admin query
  selects.
- **PRESERVE (conditional: admin flag persisted on `push_subscriptions`)** `@AC-2 @FR-2 @feature-165`
  "Enabling notifications persists a per-user subscription" (`pwa-notifications.feature:11-12`).
  Upsert-by-endpoint, with no duplicate rows, still holds after a `004` column is added.
- **PRESERVE** `@AC-2 @FR-1 @FR-4 @feature-203` "A broadcast alert is unread for one user and read for
  another" (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature:13-14`).
  - Untargeted alerts stay visible in-app to every user. The persisted `target_user_id` of an
    untargeted alert is never rewritten.
  - Fanning out per-admin targeted copies would be a CHANGE here and must be blocked.
- **PRESERVE** `@AC-1 @FR-2 @FR-3 @feature-203` "Marking a targeted alert read flips it to read for
  that user" (`alert-read-unread-persistence.feature:6-7`). FR-3 moves portfolio and live-loop alerts
  onto this targeted path.
- **PRESERVE** `@AC-1 @FR-1 @feature-020` "A WARNING alert is fanned out to Slack when the webhook is
  configured" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature:11-12`). The
  Slack/SendGrid audience is out of scope. Targeted alerts still go to the shared operator channel.
- **EXTEND** `@AC-3 @FR-5 @regression @feature-231` "Concentration sums a symbol across accounts and
  alerts on the true weights" (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature:35-36`).
  - 242 `@AC-3` adds `target_user_id` = the owner.
  - Bodies ("concentration limit breach: LYFT at 24.1%", "… MSFT at 75.9%"), category `risk`,
    severity WARNING and the exact alert set stay byte-identical.
- **EXTEND** `@AC-9 @FR-5 @feature-231` "Any unpriced position skips concentration but drawdown still
  alerts" (`fix-after-hours-positions-priced.feature:61-62`).
  - The drawdown alert gains `target_user_id`.
  - The skip WARN and "the only alert" (`brk-1` at 20.0%) are unchanged. No second copy, targeted or
    untargeted.
- **EXTEND** `@AC-1 @FR-1 @regression @feature-172` "An account whose equity falls below its peak by
  more than the configured pct alerts" (`services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature:12-13`).
  - The WARNING drawdown alert gains `target_user_id` = the owner (242 `@AC-6`).
  - Still no alert within the threshold or when `peak_equity = 0`.
- **EXTEND** `@AC-6 @FR-4 @feature-215` "A live-enabled fundamentals-gated strategy is denied entry on
  an ETF, auditably" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature:48-49`).
  - The single WARNING alert gains `target_user_id = definition.user_id` (242 `@AC-7`).
  - The once-per-episode dedup and the exits-still-fire behaviour are unchanged.
- **PRESERVE** `@AC-9 @FR-8 @feature-215` "A globally disabled snapshot source is not reported as
  absence" (`block-fundamentals-strategy-on-etf.feature:65-66`). The live loop still emits no alert;
  targeting adds no emit.
- **PRESERVE** `@AC-37 @FR-3 @FR-6 @feature-224` "Fundamentals scan fails closed on a non-system
  scoring formula" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature:61-62`).
  - The ERROR alert is still emitted and stays untargeted. It never gets `target_user_id = system`.
  - After FR-1 its push reaches admins only.
- **PRESERVE** `@AC-36 @FR-4 @feature-224` "System slugs are reserved in both directions"
  (`docs/sdd/business-rules/platform.feature:314`). Same treatment: the untargeted operator ERROR
  alert still fires, and its push goes to admins only.
- **PRESERVE (conditional: new notify outbound call)** `@AC-5 @FR-5 @feature-210` "Header-propagation
  semantics are unchanged beneath mTLS" (`platform.feature:238`). The producer-to-notify hops gain a
  body field only.
- **PRESERVE (conditional: new notify outbound dial)** `@AC-4 @FR-4 @feature-210` "mTLS is enforced
  identically in every environment; verification cannot be disabled" (`platform.feature:229`). Such a
  dial uses `clientCredentials()` (`services/xstockstrat-notify/src/mtls.ts:28`) and fails closed.
- **PRESERVE (conditional: new notify outbound call; added by re-grep, scenario-recon classed feature
  175 not impacted)** `@AC-2 @FR-2 @regression @item-6 @feature-175` "The confirmed-dead propagation
  middleware is gone from the Node leaf services" (`platform.feature:165-166`). A notify-to-identity
  call must not bring back `src/middleware/propagation.ts`.
- **PRESERVE (conditional: FR-3 extended to trading)** `@AC-3 @FR-4 @feature-169` "ResumeAccount emits
  an INFO alert" (`services/xstockstrat-trading/acceptance/resume-halted-account.feature:20-21`). INFO is
  below the push gate.
- **PRESERVE (conditional: notify-to-identity lookup; a CHANGE if the gate is loosened, which needs
  sign-off)** `@AC-7 @FR-7 @feature-043` "A non-admin caller is denied every user-management RPC"
  (`services/xstockstrat-identity/acceptance/user-management-ui.feature:54-55`).
- **PRESERVE (conditional: admin audience persisted or cached)** `@AC-4 @FR-4 @feature-043` "Admin
  assigns and removes roles" (`user-management-ui.feature:33-34`). A role change must reach the
  audience, so a stale snapshot is not acceptable. The same applies to `@AC-5` (deactivation, `:40-41`)
  and `@AC-11` (last-admin demotion, `:74-75`).
- **CHANGE (no durable `@AC`; signed off)**: the feature 165 FR-3 rule "untargeted Web Push goes to
  every subscription" was never promoted to a suite.
  - It is pinned only by the unit test `services/xstockstrat-notify/src/__tests__/webPush.test.ts:147-155`.
    That test's "AC-4" label does not match the suite's targeted `@AC-4`.
  - The operator signed off the reversal on 2026-10-20 (`context.md` § Operator decisions). The test
    is rewritten deliberately.
  - At launch, 242 `@AC-1` and `@AC-5` are a C-16 ADD to `pwa-notifications.feature`.
- **Not impacted:**
  - notify:
    - `@AC-3 @feature-165` (unregister by endpoint).
    - `@AC-3/@AC-4/@AC-5 @feature-203`.
    - `@AC-2..@AC-9 @feature-020`.
  - portfolio: valuation, snapshot and HWM scenarios (`@AC-1/2/6/8/13/14 @feature-231`,
    `@AC-2 @feature-172`).
  - platform: `@AC-9 @FR-5 @regression @feature-196` covers dead request-body `user_id` fields. It does
    not cover `EmitAlertRequest.target_user_id`, which is a live selector.
  - UI: `pwa-notifications.feature` and `alert-read-unread-persistence.feature`.
  - agent, marketdata and ingest suites (no push or alert guarantees).
- **Coverage:**
  - Read in full: 3 notify suites, 2 portfolio suites, 2 analysis suites, and `platform.feature`
    (about 104 in-scope scenarios).
  - The other 10 portfolio and 30 analysis suites were grep-scanned only.
  - 18 in-scope scenarios are relevant, 3 of them conditional, plus 3 conditional out-of-set
    scenarios (trading, identity) and the 1 re-grep row.
  - Verdicts: 4 EXTEND and 19 PRESERVE, with no durable CHANGE.

## Dependencies

- **Proto/RPC:** no change for FR-1, FR-2 or FR-3.
  - Existing fields:
    - `EmitAlertRequest.target_user_id = 6` (`packages/proto/notify/v1/notify.proto:71`).
    - `Alert.target_user_id = 7; // empty = broadcast` (`:45`). This describes StreamAlerts and
      stays.
    - `RegisterPushSubscriptionRequest` (`:120-126`): `endpoint = 1`, `p256dh = 2`, `auth = 3`,
      `user_agent = 4`. It has no user or role field, and reading `x-access-scope` at register needs
      no proto change.
  - Identity, only if consulted:
    - RPCs: `ListUsers` (`packages/proto/identity/v1/identity.proto:41`), `GetUser` (`:42`),
      `SetUserRoles` (`:44`).
    - Enum value `ROLE_ADMIN = 1` (`:168`).
- **Migration:**
  - Notify: `004_<desc>.up.sql` + `.down.sql`, only if design persists the admin audience. Current
    max is `003_alert_reads`. A git-log scan of every `origin` ref on 2026-10-20 found no notify
    `004*` and no config `031+` committed.
  - Portfolio (next `018`) and analysis (next `028`) need none.
- **Config keys:** none are anticipated.
  - An audience toggle would be `notify.push.<key>` (C-05), registered as above.
  - Config's local max is `030_marketdata_edgar_snapshot_keys`. 243 claims `031` and 241 may claim
    another in spec text, so the next free number is resolved at /sdd-spec.
  - Approval: owner plus the config team.
- **Inter-service edges:**
  - Existing: portfolio → notify and analysis → notify (gRPC write).
  - A persisted-bit option adds no edge.
  - A notify → identity lookup would be a new edge:
    - Update the root `CLAUDE.md` § Inter-Service Dependencies and the notify `CLAUDE.md`
      § Dependencies (`:62-67`, today config and PostgreSQL only).
    - Bound by `@AC-4`/`@AC-5 @feature-210` and `@AC-2 @feature-175`.
- **New env vars / ports:** none for the persisted-bit options. A notify → identity lookup needs
  `IDENTITY_ENDPOINT`, which is absent from the notify blocks in:
  - `docker-compose.yml:217-243` (has `CONFIG_ENDPOINT`/`LEDGER_ENDPOINT` at `:230-231`)
  - `.do/app.yaml:493-555`
  - `.do/app.dev.yaml:490-552`

## Risks / Not-found

### Risks

- **Notify has no admin source today (FR-1 design fork).** These are the candidate sources found;
  choosing one is design's job.
  - **(a) Capture the `x-access-scope` admin bit at `RegisterPushSubscription` and persist it
    (`004`).** This is the cheapest option: the bit already arrives (`bffShared.ts:41`) and no proto
    change is needed.
    - Staleness: the bit is captured only on the explicit Enable action
      (`services/xstockstrat-ui/src/app/accounts/notifications/PushToggle.tsx:64`, register call at
      `:80`). Promotion or demotion via `setUserRoles`
      (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:835`) and deactivation
      (`identity.users.is_active`, `migrations/001_identity_tables.up.sql:11`) do not propagate.
    - A demoted user keeps receiving admin pushes until they re-register. That is a residual privacy
      gap, which design must bound or close.
    - Rows that exist before `004` need a fail-closed default (non-admin), so admins must re-enable
      push.
    - An absent or unparseable scope must fail closed to non-admin, not be rejected with code 3: the
      scope is authorization, not identity (contrast fails.md:2779-2782 for `x-user-id`).
    - Where to store it: the role is per user, not per device. insights.md:3536-3539 argues per-user
      state does not belong on a shared row. A column copies the role onto every device row, while a
      `(user_id)`-keyed table holds it once. This is a C-18 call.
  - **(b) Notify → identity lookup.** `listUsers` (`identityServiceImpl.ts:775`) and `getUser`
    (`:788`) sit behind `adminGate` (`:735`). No `x-internal-caller` grant exists in
    `services/xstockstrat-identity/src` (grep found no hits).
    - The options are a new narrow RPC (EXTEND, which adds identity to the affected set), a loosened
      gate (CHANGE of `@AC-7 @feature-043`), or minting an admin scope from notify (the
      fails.md:531-534 near-miss).
    - Any of these also adds a new edge, new env and the mTLS-scoped rules above.
  - **(c) Cross-schema read of `identity.users.roles TEXT[]`** (`001_identity_tables.up.sql:10`).
    - No non-identity service reads `identity.users`. The only other reader is
      `scripts/manage-users.py:180,236`.
    - It conflicts with root `CLAUDE.md` § Database ("each service owns its schema").
    - `user_id` is `UUID` there (`:7`) and `TEXT` in notify (`002_push_subscriptions.up.sql:11`).
    - Notify's DB-role grants are undocumented.
  - **(d) A config-held admin list.** This would be a second source of truth that drifts from
    identity roles.
- **The audience query is now a correctness boundary.** `capturingPool` ignores SQL
  (`webPush.test.ts:33-45`). An unfiltered-SELECT regression stays green unless the tests assert the
  SQL and params, or use a fake that applies the admin filter (needed for AC-1 and AC-5).
- **FR-3 in-app consequence (accepted).** Once targeted, portfolio and live-loop alerts leave every
  non-owner's `ListAlerts` (`notifyServiceImpl.ts:202`, `:210`) and `StreamAlerts`
  (`matchesSubscriber` `:273-276`), admins included.
  - This is accepted under the operator decision (product-spec § Consumer Surface).
  - Do not offset it with a second untargeted copy. That breaks "exactly" in `@AC-3 @feature-231`,
    "the only alert" in `@AC-9 @feature-231`, and "exactly one" in `@AC-6 @feature-215`.
- **Empty owner falls back to admin-only push.**
  - Portfolio: no empty-`fill.UserID` guard was found before `:375` (only `:264-290` and `:340-378`
    were read). An empty user produces an untargeted, admin-only push.
  - Analysis: the owner guard holds only when `portfolio_stub` is wired. `_drain_held` and
    `_drain_watchlist` return `set()` before `owner_metadata` when `self._portfolio is None`
    (`live_loop.py:520-522`, `:549-551`). The constructor defaults it to `None` (`:277`), but
    production wires it (`app/main.py:158`).
- **Trading per-account alerts are still untargeted.** Reconciliation mismatch
  (`trading.go:1938-1944`, CRITICAL) and account halt (`:2751-2757`, CRITICAL) become admin-only
  pushes after FR-1, and the owner loses them.
  - Design must either extend FR-3, which adds trading and requires reading its suites in full
    (today it is a C-16 blind spot beyond `@AC-3 @feature-169`), or name a follow-up (C-14).
  - The systemic REDUCE_ONLY alert (`:2183-2189`) is correctly untargeted.
- **Agent `emit_alert` wording.** `broadcast=true` sends `target_user_id=""`
  (`services/xstockstrat-agent/app/tools.py:690`, `:699`), and `docs/runbooks/mcp-tools.md:256`
  describes it as "system-wide broadcast". After FR-1 the push reaches admins only. Design either
  updates the wording (adding xstockstrat-agent) or names a follow-up (C-14).
- **Same-helper collisions:**
  - The open defect `docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md`
    (sidecar `open`) is about `emitRiskAlert`'s ledger event at `portfolio_service.go:1005`. That is
    the helper FR-3 changes.
  - 215 (`block-fundamentals-strategy-on-etf`, in progress) edits `_emit_fundamentals_unavailable_alert`
    (`live_loop.py:847-861`). Whichever feature merges second must carry
    `target_user_id=definition.user_id`.
  - 251 (`portfolio_service.go` GetPnL) and 244 (`live_loop.py:351`) are rebase-only.
- **Doc drift to fix in the same PR:**
  - `services/xstockstrat-notify/CLAUDE.md:90` ("empty ⇒ broadcast to all subscriptions") and the Web
    Push paragraph (`:85-95`).
  - `services/xstockstrat-notify/docs/context-constitution-findings.md:38`.
  - The `webPush.ts:29` and `:88` comments.
  - Optional: `services/xstockstrat-portfolio/CLAUDE.md:87` and `services/xstockstrat-analysis/CLAUDE.md:406`,
    to note owner targeting.
- **Doc drift out of scope:** `services/xstockstrat-analysis/CLAUDE.md:232` says notify is used to
  "Alert on completed backtests", but `servicer.py` makes no `EmitAlert` call.

### Not found

- No notify code reads `x-access-scope` or `ADMIN_SCOPE`, or has any role concept. A grep of
  `services/xstockstrat-notify/src` (non-test) finds `x-user-id` reads only.
- No identity client, `IDENTITY_ENDPOINT`, or cross-schema `identity.*` read in notify. No
  non-identity service reads `identity.users`.
- No role or admin column on `notify.push_subscriptions`, and no push-audience config key (only
  `notify.push.min_severity`).
- No documented per-service DB-role or schema-grant model, so notify's rights on `identity.users`
  are unknown.
- No role-refresh mechanism for subscription rows once roles change.
- No multi-user or admin-vs-non-admin push test. `capturingPool` returns the same rows for every
  `SELECT`.
- No test asserts `EmitAlertRequest.TargetUserId`, `Category` or `Severity` in portfolio (Body only)
  or `target_user_id` anywhere in analysis. No test asserts `_emit_alert` request fields.
- No `"user-42"` or `acct-1` peak 10000 / current 8500 fixture in portfolio
  `internal/testdata/`. Existing tests use `"u1"`.
- No notify Node fixture home (`src/__tests__/fixtures/`). Under C-13 it materializes on a second
  consumer.
- Not traced: an empty-`fill.UserID` guard in portfolio `processOrderFill` beyond `:264-290` and
  `:340-378`.
- Not checked: migration numbers claimed in other features' spec text (only committed files were
  scanned).

### Ledger traps

- fails.md:531-534: never forward or mint an elevated `x-access-scope` from an entry point that did
  not authenticate it (option b).
- fails.md:1620-1623: do not gate on a producer field nobody writes. Grep every FR-3 request builder
  to confirm it really sets `target_user_id`.
- fails.md:2770-2772: when a guard is justified by a DB constraint, cite its migration line.
  `push_subscriptions` has only UNIQUE `endpoint` (`002:12`) and an index on `user_id` (`:19`).
- fails.md:2779-2782: header-identity handlers reject a missing `x-user-id` (code 3). Register keeps
  this behaviour. The admin bit is authorization and fails closed instead.
- fails.md:2303-2306 (context only): changes to the `checkRiskLimits` / `emitRiskAlert` failure
  aggregate shipped waived. Targeting does not alter it.
- insights.md:459-473: `EmitAlert` callers send no admin bit, so the audience must come from stored
  subscriptions or a lookup, never from the emit caller. Do not role-gate `EmitAlert`.
- insights.md:2144-2151: keep side effects past the success callback (microtask), not just inside a
  catch.
- insights.md:2529-2539: keep push a disjoint class, and validate credential shape at startup.
- insights.md:3536-3539: per-user state goes in a `(entity, user)` table, not a column on a shared
  row. This bears on where option (a) stores the bit.

## Recommended Scope

Advisory only:
1. **notify service step** (with its paired test step):
   - Resolve the admin audience (fork a-d). For (a), add migration `004`, read `x-access-scope` in
     `registerPushSubscription` through a fail-closed `hasAdminAccessScope` copy, and refresh the
     value in the upsert SET list.
   - Replace `webPush.ts:97-101` with the admin-filtered query, after the gates and inside the
     catch-all. Keep `:91-96` byte-identical.
   - Update `webPush.ts:29` and `:88`, notify `CLAUDE.md:90`, and `context-constitution-findings.md:38`.
2. **notify test step:**
   - Rewrite `webPush.test.ts:147-155` as RED for AC-1 and AC-5, with SQL/param assertions or an
     admin-aware fake.
   - Add the AC-2 exclusivity assertions to `:129-145`.
   - Extend `metaCall` and the register test (`notifyServiceImpl.test.ts:470-514`) if register
     changes.
3. **portfolio service and test steps:**
   - `emitRiskAlert(ctx, userID, msg)` sets `TargetUserId` at both `:991` and `:999`.
   - Extend `recordingNotify`. Assert target, category and severity in the AC-3 base and a new AC-6
     `acct-1` case, keeping the exact body sets.
4. **analysis service and test steps:**
   - Add `target_user_id=definition.user_id` to both builders.
   - Add AC-4 and AC-7 assertions in `tests/test_live_loop.py`.
5. **Design decisions to record (not code):**
   - The admin-source fork and the bound on stale roles.
   - Trading per-account alerts: extend FR-3, or name a follow-up.
   - Agent `emit_alert` wording.
   - Ordering against 215 and the open concentration-logged-as-drawdown defect.
