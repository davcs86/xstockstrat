# Design: pwa-notifications

**Created**: 2026-08-29
**Rounds**: 2 (quick mode upgraded to 2 by operator; termination: approved)
**Approved by**: user @ 2026-08-29
**Grounded in**: recon.md

---

## Chosen Approach

Ship Web Push as a **third, disjoint, best-effort fanout channel** in `xstockstrat-notify`, plus the
PWA plumbing that makes `xstockstrat-ui` installable and able to receive OS notifications when closed.

**Notify (backend push).**
- A new `WebPushDispatcher` class in `services/xstockstrat-notify/src/fanout/webPush.ts`, structurally
  mirroring `FanoutDispatcher` (`src/fanout/fanout.ts:51-108`): VAPID creds read **once** in the
  constructor; `notify.push.min_severity` read **live per dispatch** via
  `ConfigWatcher.getInt('notify.push.min_severity', 2)` clamped `[0,4]` (`configWatcher.ts:84-102`,
  mirroring `fanout.ts:61`); a self-isolated `sendOne` with its own try/catch + timeout constant
  (mirroring the sanctioned non-config `FANOUT_HTTP_TIMEOUT_MS` at `fanout.ts:17-18`); a full-body
  try/catch that never throws.
- It does **not** extend `FanoutDispatcher` — the two share no state (fanout holds an in-memory dedup
  Map + Slack/email sends; push holds DB-backed subscriptions + a prune side-effect). Disjointness is
  the structural guard that keeps every `notify-external-fanout` `@AC-*` intact (C-16).
- Wired into `NotifyServiceImpl.emitAlert` via a **second `queueMicrotask`** placed beside the existing
  fanout deferral (`notifyServiceImpl.ts:106-110`), inheriting the exact after-success-callback,
  never-blocking isolation contract (FR-3 / `@AC-4`/`@AC-5`).
- Constructor-injected in `index.ts` mirroring `FanoutDispatcher(configWatcher)` (`index.ts:45-46`);
  it needs the `Pool` (subscription queries + prune) and `ConfigWatcher`.
- Two new methods on `NotifyServiceImpl` — `registerPushSubscription` / `unregisterPushSubscription` —
  surface automatically through the generated `createNotifyServiceDefinition()` (`serviceDefinition.ts:4-6`)
  once the proto is regenerated.
- **Gate on `severity` + `target_user_id` only** (never a `context` conviction key — ledger
  2026-08-19 `020` trap, recon "Existing Business Rules" `@AC-8` PRESERVE). Query
  `notify.push_subscriptions WHERE user_id=$1` for a targeted alert, all rows for a broadcast
  (`alert.targetUserId===''`). **Sequential** send loop (one row per installed device; already off the
  hot path in a microtask). On `WebPushError.statusCode` 404/410 → `DELETE … WHERE endpoint=$1` (FR-6 /
  `@AC-8`); other errors WARN `{alertId, channel:'push'}`, no propagate (extends notify `@AC-6`).

**Proto (additive, `packages/proto/notify/v1/notify.proto`).**
- `rpc RegisterPushSubscription(RegisterPushSubscriptionRequest) returns (RegisterPushSubscriptionResponse);`
- `rpc UnregisterPushSubscription(UnregisterPushSubscriptionRequest) returns (UnregisterPushSubscriptionResponse);`
- `RegisterPushSubscriptionRequest { string endpoint=1; string p256dh=2; string auth=3; string user_agent=4; }` — **no `user_id` field**; the owner is resolved from the propagated `x-user-id` header (see Post-approval revision). _(As originally approved this carried `string user_id=1` filled by the BFF; changed to header-identity after rebasing onto #1040/#1041.)_
- `RegisterPushSubscriptionResponse { string subscription_id=1; }`
- `UnregisterPushSubscriptionRequest { string endpoint=1; }` — **no `user_id`** (see Decision 1).
- `UnregisterPushSubscriptionResponse { bool deleted=1; }` (mirrors `AcknowledgeAlertResponse`).
- Non-breaking: existing `NotifyService` RPCs/messages untouched; `buf breaking` must pass (C-09).

**Migrations.**
- `services/xstockstrat-notify/migrations/002_push_subscriptions.{up,down}.sql` (next NNN = 002,
  recon Codebase Map), mirroring `001_notify_alerts.up.sql` style (`IF NOT EXISTS`, snake_case,
  TIMESTAMPTZ):
  `subscription_id UUID PK DEFAULT gen_random_uuid(); user_id TEXT NOT NULL; endpoint TEXT NOT NULL UNIQUE; p256dh TEXT NOT NULL; auth TEXT NOT NULL; user_agent TEXT; created_at TIMESTAMPTZ NOT NULL DEFAULT now();` + `INDEX ON (user_id)`.
  **Register upsert (full SET list — Decision 2):**
  `INSERT … ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent, created_at=now() RETURNING subscription_id`.
- `notify.push.min_severity` (int, default 2) seed in a **`xstockstrat-config` migration**
  (`services/xstockstrat-config/migrations/`, next NNN — resolve at `/sdd-spec`), following feature
  020's `018_notify_fanout` precedent (ledger 2026-08-26 trap). Non-secret; env-scoped, no
  `trading_mode` axis (config `@AC-10` PRESERVE).

**UI (PWA + consumer surface, C-14).**
- `public/` (created — absent today): `manifest.webmanifest` (`display: standalone`, `name`,
  `short_name`, `start_url: /trader`, theme/bg colors, icons 192/512/512-maskable), the three icon
  PNGs, and a hand-written `public/sw.js` (no `next-pwa`).
- `sw.js` `push` handler **always** calls `showNotification` (the `userVisibleOnly` obligation),
  parsing the `{title, body, url, icon}` payload inside try/catch with a fallback
  `{title:'xstockstrat', body:'You have a new alert'}`, and setting a **deterministic
  `tag`** (Decision 4) on both the success and fallback paths so the OS coalesces concurrently-visible
  duplicates. `notificationclick` → `focus` an existing window whose URL matches, else `openWindow(url)`
  (`@AC-9`).
- Root layout (`src/app/layout.tsx:8-11`) metadata gains `manifest`, `themeColor`, `icons`; a small
  `'use client'` component registers `/sw.js` at root scope (controls all four segments).
- `next.config.js` gains `headers()` returning `Cache-Control: no-cache` for `/sw.js` **and**
  `/manifest.webmanifest` (recon: file has no `headers()` today), so an updated SW always reaches
  clients (Decision 5).
- `src/middleware.ts:12-19` matcher negative-lookahead adds `sw.js`, `manifest.webmanifest`, and the
  icon paths, so they are served publicly and the SW can register (`@AC-1`).
- `Dockerfile` gains `COPY --from=builder …/public …/public` after the `.next/static` copy (standalone
  drops `public/` — recon finding 10).
- `VAPID_PUBLIC_KEY` crosses server→browser via a `VapidKeyContext` copying the `AgentUrlContext`
  pattern (force-dynamic layout read + `'use client'` provider — `accounts/layout.tsx:15,19`,
  `accounts/AgentUrlContext.tsx:8-22`), **not** `NEXT_PUBLIC_*`.

**UI (consumer surface — the enable control).**
- New page `src/app/accounts/notifications/page.tsx` (Settings group) + a `'use client'` `PushToggle`.
- Nav: a `NavItem {label:'Notifications', href:'/accounts/notifications'}` added to the Settings group
  (`navGroups.tsx:80-96`) — C-10(a), with a nav-reachability test.
- Flow: `Notification.requestPermission()` → on `granted`,
  `registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:<VAPID_PUBLIC_KEY>})`
  → POST `subscription.toJSON()` (`endpoint`, `keys.p256dh`, `keys.auth`) via
  `notifyClient.registerPushSubscription(...)`. Disable → `subscription.unsubscribe()` then
  `notifyClient.unregisterPushSubscription({endpoint})`.
- BFF: extend the **existing** `router.service(NotifyService, {...})` block in `traderBff.ts` —
  `registerPushSubscription`/`unregisterPushSubscription` are plain `forward()`s; the notify service
  resolves the owner from the `x-user-id` header that `forward`→`backendHeaders` propagates (the browser
  cannot set it — IDOR guard). _(Originally approved as a `userId: claims.user_id` body injection like
  `streamAlerts`; changed to header-identity — see Post-approval revision.)_ Browser calls go through `notifyClient`
  (`browserClients/notifyClient.ts:5-6`), already on the guarded `makeBrowserTransport` (ui-auth
  `@AC-5`/`@AC-6` PRESERVE). See "Cross-segment reuse" in Open Risks.
- C-17 (Decision 8): design-role tokens only; the control is `ui/switch.tsx` with
  `aria-label="Enable push notifications"`; page chrome on `ui/card.tsx`; the four states route through
  canonical primitives — **unsupported** → `EmptyState`; **blocked** (`Notification.permission==='denied'`)
  → `CardNotice variant="error"`; **enabled** → `CardNotice variant="muted"` + Switch on; **default** →
  Switch + copy; mutation loading/error → `QueryStateMessages`.

**VAPID key generation + deploy wiring.** Generate one keypair. `VAPID_PRIVATE_KEY` is `type: SECRET`
(notify only), `VAPID_SUBJECT` (notify only, a `mailto:`/`https:` URL), `VAPID_PUBLIC_KEY` (notify +
UI). Wired through **every** deploy site in the same PR (ledger 2026-08-19 `finnhub-key` trap):
`docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`, `deploy.yml` reusable `secrets:` +
`deploy-dev.yml`/`deploy-prod.yml` passthrough, `scripts/do-inject-prod-secrets.py`,
`docs/setup/digitalocean.md`, `.env.example` (empty ⇒ push disabled locally). Push stays disabled until
keys are present.

### Round-2 corrections folded in

- **VAPID startup validation (Decision 3):** `vapidConfigured = present(PRIVATE) && present(PUBLIC) &&
  present(SUBJECT) && /^(mailto:|https:)/.test(SUBJECT)`, computed in the constructor. Keys-present but
  malformed subject → log **ERROR once at startup** and leave the channel disabled — never a per-send
  attempt that `web-push` would throw on and the catch would silently swallow to WARN. UI needs only
  `VAPID_PUBLIC_KEY`; `web-push` performs aes128gcm payload encryption itself from the subscription's
  `p256dh`/`auth`.
- **`notification.tag` (Decision 4 correctness):** `sw.js` sets a deterministic `tag` (from the payload
  `alertId`, or `category` on the fallback path) in `showNotification` options on **both** paths.
  Honest framing recorded here: `tag` coalesces only same-tag notifications that are still *visible* —
  it is not content-hash dedup; the fanout `dedup_window_seconds` for Slack/email is untouched
  (`@AC-5` PRESERVE). A shared pure dedup helper is the named follow-up if push volume proves noisy.
- **Test RED assertions (Decision 6 correctness):** the `makePool` fake ignores SQL, so the `@AC-2`/`@AC-3`
  tests assert the **captured SQL shape** (`INSERT … ON CONFLICT (endpoint) DO UPDATE SET …` with the
  full column list; `DELETE … WHERE endpoint=$1` with a single positional param and no `user_id` bind),
  not a row count the fake cannot prove.
- **BFF ownership test (Decision 7 coverage):** a BFF-level assertion that `registerPushSubscription`
  stamps `claims.user_id` onto the notify call (the thing that makes a subscription belong to the right
  user) — paired to the register-ownership scenario.

## Rejected Alternatives

- **Extend `FanoutDispatcher` with a push channel** — rejected: forces DB-backed subscription state +
  a prune side-effect into a class whose whole contract is env-cred + in-memory + stateless-per-dispatch;
  any edit risks regressing `notify-external-fanout` `@AC-1..@AC-9` (C-16). Disjoint class is the safer posture.
- **Reuse the fanout content-hash dedup for push** (`fanout.ts:110-118`) — rejected for v1: it is a
  `private` method; sharing it would couple the two dispatchers, and duplicate OS notifications are
  low-harm (OS `tag`-coalesced). Named follow-up: a shared pure dedup helper.
- **`UnregisterPushSubscriptionRequest{endpoint,user_id}` + user-scoped DELETE** — rejected: the register
  upsert can reassign an endpoint to a new user, after which a user-scoped delete silently no-ops and
  fails `@AC-3`. Endpoint is a high-entropy capability proven by `getSubscription()`; delete-by-endpoint
  is correct and simpler.
- **A dedicated `/accounts/api` NotifyService BFF surface** — rejected: duplicates the one-line
  `forward()`/inject registrations for zero isolation gain; the guarded `notifyClient` is reachable
  same-origin from `/accounts` (see Open Risks four-facts note).
- **`next-pwa` / build-time SW toolchain** — rejected: a push-only SW (no offline/precache) is a small
  hand-written file; a build plugin is scope the task doesn't need (behavior rule 2).

## Open Risks

- [ ] **Cross-segment `notifyClient` reuse** — the `/accounts/notifications` page calls
  `notifyClient` (`baseUrl:'/trader/api'`). This is the UI CLAUDE.md "Sanctioned exception"; it holds
  only while the four facts hold: (i) `.do/app.yaml` single `/` catch-all routes `/accounts` and
  `/trader/api` to the same component; (ii) session cookie `path:'/'`; (iii) `bffShared.ts`
  `requireSession` re-checks per dispatch; (iv) `notifyClient.baseUrl` is root-relative (same-origin
  from `/accounts`). **Re-verify all four at `/sdd-spec`** and assert the `.do/app.yaml` catch-all as an
  explicit precondition step. — addressed at the BFF/UI steps.
- [ ] **`web-push` throw signature for 404/410** — assumed `WebPushError.statusCode`; confirm the exact
  shape when adding the dep. — addressed at the notify push-channel step.
- [ ] **Config-service seed NNN** unresolved in recon — `/sdd-spec` reads
  `services/xstockstrat-config/migrations/` for the next number. — addressed at the config-seed step.
- [ ] **DO network egress** — notify gains new outbound HTTPS to FCM/Mozilla/Apple push endpoints;
  confirm the network policy permits it (deploy note). — addressed at the deploy-wiring step.
- [ ] **`tag` residual limit** — coalesces only while a prior same-tag notification is visible, not
  across dismiss/time; accepted for v1. — no further action.
- [ ] **Unregister endpoint-only accepted-risk** — any valid session could delete a subscription by
  replaying a (high-entropy, non-cross-user-surfaced) endpoint; deliberate, worst case is a user losing
  a push they were unsubscribing from anyway. Recorded here, not silently. — no further action.
- [ ] **iOS** requires home-screen install for Web Push — documented, not separately engineered (Out of Scope).

## Constitution Rules Touched

- `C-04` — new proto fields are open runtime strings (endpoint/keys), correctly not enums.
- `C-08` / `C-15` — every `@AC-1..@AC-9` has a named `test` step with a real RED assertion (Decision 6, corrected).
- `C-09` — `buf lint`/`buf breaking` on the additive proto; `./scripts/buf-gen.sh` after.
- `C-10(a)` — Settings NavItem + nav-reachability test.
- `C-13` — notify `push_subscription` fixture in `src/__tests__/fixtures/` on second consumer.
- `C-16` — all touched business rules PRESERVE/EXTEND (below); no CHANGE.
- `C-17` — tokens/`ui/switch`+`ui/card`/accessible name/canonical state primitives (Decision 8).
- `P-03` — no-dedup tradeoff, endpoint-only accepted-risk, and cross-segment reuse all recorded, not silently guessed.
- `F-06` — notify stays direct pool `max 1`; no new pool, no raise (honored).
- `F-07` — `notify.push.min_severity` read live via `WatchConfig`/`getInt`; VAPID are SECRET/env credentials, not config values; the send timeout is a sanctioned non-config constant (honored).
- `F-01` — `002` is a new migration, never an edit to `001` (honored).

## Business Rules Touched (C-16)

No CHANGE verdicts — user sign-off not required on business-rule grounds.

- PRESERVE `@AC-1`/`@AC-4` (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — primary `StreamAlerts` still delivers; a slow/failed push never delays or drops it (disjoint class + second `queueMicrotask`).
- EXTEND `@AC-6` (notify-external-fanout.feature) — push adds a `"push"` channel to the catch/WARN/no-propagate contract; the 404/410 prune lives inside it.
- EXTEND `@AC-3` (notify-external-fanout.feature) — VAPID unset ⇒ push silently disabled; `notify.push.min_severity` read live.
- EXTEND `@AC-7` (notify-external-fanout.feature) — parallel `notify.push.min_severity` gate; existing `notify.fanout.min_severity` unchanged.
- PRESERVE `@AC-5`/`@AC-8`/`@AC-9`/`@AC-2` (notify-external-fanout.feature) — fanout dedup window, conviction gate, and Slack/email behavior untouched.
- PRESERVE `@AC-5`/`@AC-6`/`@AC-7` (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`) — register/unregister browser calls use the guarded `makeBrowserTransport`.
- PRESERVE `@AC-10`/`@AC-2` (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — env-scoped non-secret config seed; `VAPID_PRIVATE_KEY` stays a `type: SECRET` env var, never a `config_values` row.

## Rounds

2 rounds (quick mode; operator opted into the second). Round 1: shape confirmed, no Floor breach, 8
refinement objections. Round 2: all 8 resolved; 3 small correctness/traceability fixes folded in
(`tag` coalescing, captured-SQL RED assertions, BFF ownership test). Termination: approved by user.

## Post-approval revision (2026-08-29) — header identity for register

After the branch was rebased onto `main-dev`, it picked up #1040/#1041, which moved caller-identity
RPCs off the deprecated request-body `user_id` and onto the trusted, propagated **`x-user-id` header**
(C-03). To avoid introducing a *new* instance of the just-deprecated pattern, `RegisterPushSubscription`
was changed to match:

- `RegisterPushSubscriptionRequest` **drops `user_id`** (fields renumbered `endpoint=1..user_agent=4`).
- The notify servicer resolves the owner from `call.metadata['x-user-id']` (mirrors the identity
  service's `userIdFrom` pattern) and rejects with `code 3` when the header is absent.
- The BFF `registerPushSubscription` becomes a plain `forward()` (identity travels via
  `backendHeaders`→`x-user-id`, which the browser cannot set).

Security is unchanged (still IDOR-safe — the browser cannot assert another user), and it removes the
redundant body field so identity has a single source of truth. Operator-approved in the same session.
