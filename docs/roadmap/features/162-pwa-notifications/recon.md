# Recon: pwa-notifications

**Created**: 2026-08-29
**From**: product-spec.md
**Affected services**: xstockstrat-notify, xstockstrat-ui, xstockstrat-config, packages/proto

---

## Objective

Make `xstockstrat-ui` an installable PWA (manifest + service worker + icons) and add a true Web Push
channel so installed users receive OS-level notifications for their alerts even when the app is closed.
Push is a **third best-effort fanout channel** in `xstockstrat-notify`, mirroring the feature-020
Slack/SendGrid `FanoutDispatcher` pattern — gated on VAPID keys (like Slack on its webhook) and on a
new `notify.push.min_severity` config key.

## Codebase Map

- **`xstockstrat-notify`** (Node.js)
  - Entry point / injection wiring: `src/index.ts:15-50` (ConfigWatcher `:19` → `waitForSnapshot(90_000)` `:20` → `Pool` `:33` → `FanoutDispatcher(configWatcher)` `:45` → `NotifyServiceImpl(pool, configWatcher, fanout)` `:46` → `addService(createNotifyServiceDefinition(), notifyImpl)` `:50`).
  - Servicer: `src/grpc/notifyServiceImpl.ts` — `emitAlert` (`:32`), success callback `:97-100`, best-effort fanout deferral `queueMicrotask(() => fanout.dispatch(alert).catch(...))` `:106-110`; alert object built `:69-82` (includes `targetUserId`).
  - Service definition (generated ts-proto, **no** proto-loader): `src/grpc/serviceDefinition.ts:4-6` returns `NotifyServiceService`.
  - Fanout template: `src/fanout/fanout.ts` — constructor reads creds from env once `:51-54`; top-level try/catch never throws `:57-108` (WARN `:105-107`); live config per dispatch `:61,:69,:76,:100-101`; channel enable gates `:99` (Slack iff url), `:102` (SendGrid iff key+from+to); dedup sweep+sha256 `:74-82,:111-118`; per-channel `send*` with `AbortController` 3s timeout `:18,:120-144,:146-187`; `FanoutAlert` interface `:25-34`.
  - Config getters: `src/services/configWatcher.ts:84-102` (`getString/getInt/getFloat/getBool(key, default)`); namespace `'notify'` constructed `index.ts:19`.
  - Last migration: `001_notify_alerts.up.sql` → **next is `002`** (`services/xstockstrat-notify/migrations/`). Schema style: `IF NOT EXISTS`, snake_case, TIMESTAMPTZ, partial indexes; `notify.alerts` has `target_user_id TEXT` (NULL=broadcast) `001_notify_alerts.up.sql:6-21`. Migrations run via golang-migrate (`scripts/db-migrate.sh`), **not** the `node-pg-migrate` in the `migrate` npm script.
  - Tests: `src/__tests__/{fanout,notifyServiceImpl}.test.ts` — compile-first `tsc && node --test dist/__tests__/*.test.js` + static import assertion (074/092 guard); fanout tests stub `globalThis.fetch` + fake `ConfigWatcher` + cred env dance (`fanout.test.ts:26-60`); EmitAlert-through-fanout uses `emitAndFlush` double `setTimeout(0)` (`notifyServiceImpl.test.ts:305-313`, cases `:344-373`); `makePool` fake `:39-46`.
  - Env read: `GRPC_PORT` `index.ts:15`, `CONFIG_ENDPOINT` `:16`, `DATABASE_URL` `:17`, `DB_POOL_MAX` `:38`, `SLACK_WEBHOOK_URL`/`SENDGRID_API_KEY` `fanout.ts:52-53`.

- **`xstockstrat-ui`** (Next.js 15 / React 18)
  - `next.config.js` (38 lines): `output: standalone` unless `NEXT_DISABLE_STANDALONE` `:7`; redirect `/`→`/trader` `:16`; `rewrites()` (OAuth well-known) `:24-35`. **No `headers()`, no `basePath`.**
  - Root layout metadata: `src/app/layout.tsx:8-11` — only `title`/`description`; **no `icons`/`manifest`/`themeColor`**; `<html lang="en">` `:15`. `src/app/icon.svg` is the only icon.
  - **`public/` does not exist** — must be created (manifest, icons, `sw.js`).
  - Shell nav: `src/components/shared/navGroups.tsx` — `NAV_GROUPS` `:41`; pinned **Settings** group `:80-96` (`items` = Profile … MCP tools); `NavItem` supports `adminOnly?`, `match?` `:10-20`. `PlatformHeader.tsx` imports it from `./navGroups` `:12` (never re-declare — TDZ cycle).
  - BFF: `src/lib/bffShared.ts` (`requireSession :32`, `backendHeaders :41`, `forward :63`, `createBffRouter :82`, `createDispatch :110`, handler key = prefix+path `:114`). `src/lib/traderBff.ts` already registers `router.service(NotifyService, {...})` `:119-128` (streamAlerts injects `userId: claims.user_id`; `listAlerts: forward(...)` `:127`); dispatch `createDispatch(router,'/trader/api')` `:182`. `src/lib/connectClients.ts` — `NOTIFY_ENDPOINT` `:18`, `notifyClient` via `createGrpcTransport` `:34`.
  - Browser notify client: `src/lib/browserClients/notifyClient.ts:5-6` (`makeBrowserTransport('/trader/api')` + `createClient(NotifyService, transport)`); consumer bell UI `src/components/trader/AlertStream.tsx:27-33` (`for await` connect-web stream — **not** SSE). `makeBrowserTransport` factory (auth-refresh interceptor) `src/lib/browserClients/transport.ts`.
  - Middleware matcher: `src/middleware.ts:12-19` — negative-lookahead excludes `_next/static|favicon.ico|icon.svg|apple-icon.png|...`; **does NOT exclude `/sw.js` or `/manifest.webmanifest`** (they would hit the auth gate → redirect to `/auth/login` `:27-34`).
  - Server-env → browser bridge precedent (NOT `NEXT_PUBLIC_*`): `src/app/accounts/layout.tsx:15` `dynamic='force-dynamic'`, `:19` reads `process.env.AGENT_PUBLIC_URL`; `src/app/accounts/AgentUrlContext.tsx:8-22` `'use client'` provider/hook. Mirror for `VAPID_PUBLIC_KEY`.
  - `package.json`: Next `^15.5.21`, React `^18.3.1`; **no `web-push`/PWA/service-worker deps**.
  - `Dockerfile` (28 lines): copies `.next/standalone` `:25` + `.next/static` `:26` only — **no `public/` copy step** (standalone does not auto-include it); CMD `node services/xstockstrat-ui/server.js` `:28`.

- **`xstockstrat-config`** (Node.js) — hosts the config-seed migration only. Precedent: feature 020's `018_notify_fanout` seeded `notify.fanout.*` in `services/xstockstrat-config/migrations/` (per ledger 2026-08-26). The `notify.push.min_severity` seed follows there.

- **`packages/proto`** — `notify/v1/notify.proto`: `NotifyService` (`EmitAlert`, `StreamAlerts`, `AcknowledgeAlert`, `ListAlerts`); additive RPCs/messages only.

## Patterns to REUSE

- New WebPush fanout channel → **mirror `FanoutDispatcher`** structure (`src/fanout/fanout.ts`): env cred read in constructor, live config per dispatch, self-isolated `send*` with try/catch + timeout. Wire it into the same `queueMicrotask` best-effort deferral (`notifyServiceImpl.ts:106-110`).
- Config gate for push severity → **`ConfigWatcher.getInt('notify.push.min_severity', 2)`** clamped `[0,4]` (`configWatcher.ts:88`), mirroring `notify.fanout.min_severity` (`fanout.ts:61`).
- New RPC handlers → add `registerPushSubscription`/`unregisterPushSubscription` methods on `NotifyServiceImpl`; they surface automatically through `createNotifyServiceDefinition()` once the proto is regenerated.
- Push subscription table → **mirror `001_notify_alerts.up.sql` style** for `002_push_subscriptions.up.sql`.
- UI BFF → **extend the existing `router.service(NotifyService, {...})` block in `traderBff.ts`** with `registerPushSubscription`/`unregisterPushSubscription: forward(...)`; browser calls via **`notifyClient`** (`browserClients/notifyClient.ts`, already on the guarded `makeBrowserTransport`).
- Expose VAPID public key → **copy `AgentUrlContext` pattern** (force-dynamic layout read + `'use client'` context provider).
- Nav registration → add a `NavItem` to the **Settings** group in `navGroups.tsx:80-96` (C-10a).
- Secret env wiring → **follow the Slack/SendGrid `type: SECRET` deploy path** (notify CLAUDE.md § Environment Variables) for `VAPID_PRIVATE_KEY`.
- UI test fixtures → `services/xstockstrat-ui/e2e/fixtures/` + `INVENTORY.md` (C-12); notify tests → `src/__tests__/` fetch-stub + fake-config pattern (C-13).

## Existing Business Rules (preserve / extend)

From `scenario-recon` (notify-external-fanout / config-secrets-and-scoping / ui-auth-improvements suites + platform.feature; ~59 scanned, 14 relevant; **no CHANGE verdicts**):

- **PRESERVE** `@AC-1` "WARNING alert fanned out to Slack when webhook configured" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — primary `StreamAlerts` must still fire for every alert; push is a 3rd channel.
- **PRESERVE** `@AC-4` "Slack timeout does not delay/drop the primary stream" (notify-external-fanout.feature) — FR-3's isolation contract; a slow/failed `web-push` send must never add latency to the stream or the `EmitAlert` result.
- **EXTEND** `@AC-6` "fanout channel error logged at WARN with alert id + channel name" (notify-external-fanout.feature) — push adds a `"push"` channel to the same catch/WARN/no-propagate contract; the FR-6 404/410 prune lives inside this caught path.
- **EXTEND** `@AC-3` "no credentials ⇒ nothing fans out, runtime knobs still live" (notify-external-fanout.feature) — VAPID unset ⇒ push silently disabled (FR-5); `notify.push.min_severity` read live per dispatch.
- **EXTEND** `@AC-7` "alert below severity floor not fanned out" (notify-external-fanout.feature) — push adds a **parallel** `notify.push.min_severity` gate; existing `notify.fanout.min_severity` unchanged.
- **PRESERVE** `@AC-8` "conviction-bearing alert below conviction floor not fanned out" (notify-external-fanout.feature) — push gates on **severity only** (ledger trap: no producer reliably writes a `context` conviction); Slack/email conviction gate untouched.
- **PRESERVE** `@AC-9` "conviction-less alert gated by severity alone" (notify-external-fanout.feature).
- **PRESERVE** `@AC-5` "same alert twice within dedup window fans out once" (notify-external-fanout.feature) — any push-dedup decision must not regress `notify.fanout.dedup_window_seconds` for Slack/email.
- **PRESERVE** `@AC-2` "qualifying alert delivered as email with every field" (notify-external-fanout.feature) — Slack/email out of scope, must not regress.
- **PRESERVE** `@AC-5`/`@AC-6` "Unauthorized data call redirects to login" / "401 redirect applies to every segment" (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`) — register/unregister browser calls and the shell-level control must build on `makeBrowserTransport` (guarded).
- **PRESERVE** `@AC-7` "redirect does not loop on login page" (ui-auth-improvements.feature).
- **PRESERVE** `@AC-10` "config messages carry environment, no trading_mode" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — the `notify.push.min_severity` seed follows env scoping.
- **PRESERVE** `@AC-2` "WatchConfig never streams secret plaintext" (config-secrets-and-scoping.feature) — guards keeping `VAPID_PRIVATE_KEY` a `type: SECRET` env var, never a `config_values` row.

No prior `@AC-*` governs the PWA manifest, service worker, or the shell Settings group — FR-1/FR-2/FR-4 are net-new, unguarded ground (design-adversary should treat the "served from root across all segments" requirement as new).

## Dependencies

- Proto/RPC: **additive** `notify/v1` — `RegisterPushSubscription`/`UnregisterPushSubscription` RPCs + request/response messages; existing `NotifyService` at `packages/proto/notify/v1/notify.proto:12-25`. Non-breaking (`buf breaking` must pass).
- Migration: `002_push_subscriptions.{up,down}.sql` in `services/xstockstrat-notify/migrations/`; **config seed** in `services/xstockstrat-config/migrations/` (next NNN there — verify at spec time).
- Config key: `notify.push.min_severity` (int, default 2) — new; non-secret.
- Inter-service edges: unchanged runtime graph — UI BFF → notify gRPC (register/unregister), notify → push endpoints (outbound HTTPS via `web-push`, new egress).
- New env vars: `VAPID_PRIVATE_KEY` (`type: SECRET`, notify), `VAPID_PUBLIC_KEY` (notify + UI), `VAPID_SUBJECT` (notify). **Absent** from `docker-compose.yml` / `.do/app.dev.yaml` / `.do/app.yaml` — must be added to every deploy site.
- New npm deps: `web-push` (notify). UI needs **no** runtime web-push dep (subscription uses the browser Push API + a hand-written `public/sw.js`; no build-time SW toolchain).

## Risks / Not-found

- **Secret-wiring trap (ledger 2026-08-19 `finnhub-key`)**: `VAPID_PRIVATE_KEY` must reach every run site in the same PR — `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`, `deploy.yml` reusable `secrets:` + `deploy-dev.yml`/`deploy-prod.yml` passthrough, `scripts/do-inject-prod-secrets.py`, plus `docs/setup/digitalocean.md`. `/sdd-spec` must enumerate each file as a step.
- **Fanout-gate trap (ledger 2026-08-19 `020`)**: gate push on `severity` + `target_user_id`, never a `context` Struct key.
- **Config-seed location trap (ledger 2026-08-26)**: `notify.push.min_severity` seed is a **config-service** migration; `push_subscriptions` is a **notify** migration.
- **Dockerfile `public/` gap**: standalone build drops `public/` — the UI Dockerfile needs an explicit `COPY … public …` line or manifest/icons/`sw.js` 404 at runtime.
- **Middleware gate**: `/sw.js` + `/manifest.webmanifest` must be added to the matcher negative-lookahead or they redirect to login (service worker won't register).
- **Service-worker scope**: `sw.js` served from root must control all four segment scopes (`/trader`, `/insights`, `/config-ui`, `/accounts`) — root registration + `Service-Worker-Allowed` not needed if `sw.js` is at root, but the `push`/`notificationclick` handlers must be hand-written (no `next-pwa`).
- **`web-push` outbound egress**: notify gains new outbound HTTPS to push services (FCM/Mozilla/Apple endpoints) — confirm the DO network policy permits it (design/deploy note).
- **iOS**: Web Push requires the user to install to the home screen; documented, not separately engineered (Out of Scope).
- Open design Qs (from product-spec): exact placement/degradation of the enable control; sequential vs bounded-concurrent send loop; whether a push-specific dedup is needed beyond the fanout window.

## Recommended Scope (advisory — input to grilling & /sdd-spec)

1. **proto**: additive `RegisterPushSubscription`/`UnregisterPushSubscription` + messages; `buf-gen`.
2. **notify migration `002`**: `push_subscriptions` table (+ down).
3. **config migration**: seed `notify.push.min_severity`.
4. **notify service**: register/unregister handlers (upsert-by-endpoint / delete-by-endpoint, user-scoped); a `WebPushDispatcher`-style channel mirroring `FanoutDispatcher`, wired into the `EmitAlert` best-effort dispatch; 404/410 prune; `web-push` dep; tests.
5. **UI PWA plumbing**: `public/manifest.webmanifest` + icons (192/512/maskable) + `public/sw.js` (`push` + `notificationclick`); root layout `manifest`/`themeColor`/`icons`; `next.config.js` `headers()` for SW/manifest; middleware matcher exclusion; Dockerfile `public/` copy.
6. **UI push control**: VAPID-public-key context (force-dynamic + provider), an enable/disable control in the Settings group (`/accounts/notifications`) that requests permission, subscribes via Push API, and calls the BFF register/unregister; extend `traderBff` NotifyService block + `notifyClient`; nav registration; e2e.
7. **Secret/env wiring**: VAPID vars through docker-compose + both `.do/app*.yaml` + deploy workflows + `do-inject-prod-secrets.py` + docs; generate a real keypair.
8. **Docs**: notify CLAUDE.md (config key + env), UI CLAUDE.md (PWA section), config-governance per-feature key log, digitalocean setup secret table.
