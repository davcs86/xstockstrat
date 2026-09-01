# Product Spec: pwa-notifications

**Created**: 2026-08-29

---

## Problem Statement

Traders only receive in-app alerts while the `xstockstrat-ui` tab is open and connected to the
`StreamAlerts` SSE bridge. Time-sensitive events (fills, risk breaches, high-conviction opportunities)
are missed when the app is closed. Making the UI an installable PWA with true Web Push lets an
installed user get an OS-level notification even when the app/browser is closed, on the device where
they installed it.

## User Story

As a trader who has installed the xstockstrat app, I want to receive push notifications for my alerts
even when the app is closed, so that I don't miss time-sensitive fills, risk events, and opportunities.

## Functional Requirements

FR-1. `xstockstrat-ui` serves a valid web app **manifest** (`display: standalone`, name, `start_url`,
theme/background colors, and 192px + 512px + maskable icons) and registers a **service worker**, so a
supporting browser offers "Install app" and the app launches standalone. Manifest and service worker
are reachable across all segments (served from the domain root, not a segment basePath).

FR-2. An installed/served user can **enable notifications** from an in-app control: the app requests
`Notification` permission, and on grant subscribes via the Push API using the **VAPID public key**,
then persists the resulting subscription (endpoint + p256dh + auth keys) to `xstockstrat-notify` scoped
to the authenticated user. A control to **disable** removes the subscription (browser unsubscribe +
server delete). The control reflects current permission/subscription state (default / enabled /
blocked / unsupported).

FR-3. When an alert is emitted (`EmitAlert`), `xstockstrat-notify` sends a **Web Push** to every stored
subscription for the alert's `target_user_id` (a broadcast alert with empty `target_user_id` goes to
all subscriptions), as a **best-effort side-channel** dispatched *after* the `EmitAlert` success
callback — it must never block, delay, or fail the primary in-process `StreamAlerts` delivery or the
RPC result (same isolation contract as the feature-020 Slack/SendGrid fanout).

FR-4. The service worker renders the pushed payload as an OS notification (title, body, icon); clicking
it focuses an existing app window or opens the app (deep-linking to a relevant route where the payload
provides one).

FR-5. Push delivery is **gated on VAPID keys being configured** — if `VAPID_PRIVATE_KEY` /
`VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` are unset the push channel is simply disabled (no errors), exactly
like Slack fanout when `SLACK_WEBHOOK_URL` is unset. Severity gating reuses/extends the existing
`notify.fanout.*` config so push volume is operator-tunable (`notify.push.min_severity`).

FR-6. A push whose endpoint returns **404/410 Gone** (subscription expired/revoked at the push service)
causes that subscription row to be **pruned** so it is not retried.

## Out of Scope

- Offline caching / app-shell precaching beyond the minimum service worker needed for installability +
  push (no full offline mode, no runtime asset caching strategy).
- In-app foreground notification behavior changes — the existing `StreamAlerts` SSE bridge is unchanged;
  this feature adds the closed-app channel only.
- iOS-specific quirks beyond the standard "must be installed to the home screen for Web Push" behavior
  (documented, not separately engineered).
- Per-category / per-symbol push preference UI — a single global enable/disable plus the operator
  `min_severity` gate is the whole surface for v1. (Named follow-up if needed.)
- New email/Slack behavior — untouched.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — manifest, service worker, icons, enable/disable UI control, BFF register/unregister
  routes, exposing the VAPID **public** key to the browser.
- `xstockstrat-notify` — new `RegisterPushSubscription` / `UnregisterPushSubscription` RPCs, a
  `push_subscriptions` table, and a Web Push fanout channel wired into `EmitAlert`'s best-effort dispatch
  (alongside `FanoutDispatcher`), plus dead-subscription pruning.
- `xstockstrat-config` — hosts the config-service migration that seeds the new `notify.push.*` key
  (config seeds live in `xstockstrat-config/migrations/`, per feature 020's `018_notify_fanout` and the
  2026-08-26 ledger migration entry — **not** in notify's own migrations).
- `packages/proto` — additive `notify/v1` RPCs + messages.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui`: a notification enable/disable control reachable from the shared shell
  (Settings group) so it is present on every segment, plus the browser-level install affordance (driven
  by the manifest). This is the end-user surface; without it the backend push channel is unusable.
- [ ] **Agent** — no MCP tool change.
- [ ] **None** — n/a.

## Proto Contract Changes

- [ ] No proto changes required
- **Additive (`packages/proto/notify/v1/notify.proto`)**:
  - `rpc RegisterPushSubscription(RegisterPushSubscriptionRequest) returns (RegisterPushSubscriptionResponse)`
  - `rpc UnregisterPushSubscription(UnregisterPushSubscriptionRequest) returns (UnregisterPushSubscriptionResponse)`
  - New messages carrying `user_id`, `endpoint`, `p256dh`, `auth` (+ optional `user_agent`).
  - No changes to existing messages/enums → **non-breaking** (`buf breaking` must pass). Field numbers
    start fresh per new message.

## Config Key Changes

- [ ] No new config keys
- **New key** (seeded by a `xstockstrat-config` migration; namespace `notify`):
  - `notify.push.min_severity` — int, default `2` (WARNING). Minimum `AlertSeverity` ordinal to send a
    Web Push (0=UNSPECIFIED…4=CRITICAL), clamped `[0,4]`; mirrors `notify.fanout.min_severity` semantics.
- VAPID values are **secrets/config-of-deploy**, not config-service rows: `VAPID_PRIVATE_KEY`
  (`type: SECRET`), `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` are env vars wired through the deploy pipeline
  (see Feature Workflow Notes) — never `config.config_values` (ledger 2026-08-19 `fmp-key-to-secret-env`).

## Database Changes

- [ ] No schema changes
- **New migration** in `services/xstockstrat-notify/migrations/` (next NNN after `001`): create
  `notify.push_subscriptions` — columns for `subscription_id` (PK), `user_id`, `endpoint` (unique),
  `p256dh`, `auth`, `user_agent` (nullable), `created_at`. Up + down pair. No hypertable (low-volume
  relational table, one row per installed device per user).

## Feature Workflow Notes

Branch to create: `feature/pwa-notifications` (branch from `main-dev`).

**Harness note:** this session develops on the harness-assigned `claude/pwa-notifications-2eggrc`
branch (branched from and PR'd into `main-dev`), not `feature/pwa-notifications`.

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — additive (non-breaking) proto + config change
- [ ] 2 service owners + platform lead — n/a (no breaking proto change)
- [x] DBA review + service owner — `notify` schema migration (`push_subscriptions`)
- [x] Security review — VAPID private key secret wiring

**Secret env var wiring (ledger 2026-08-19 `finnhub-key` trap).** `VAPID_PRIVATE_KEY` is a new
`type: SECRET` credential — it must be wired through **every** run site in the **same** PR, or the
feature ships inert / a deploy runs without it:
- `docker-compose.yml` (notify block; UI block gets the public key + subject)
- `.do/app.dev.yaml` **and** `.do/app.yaml`
- the deploy workflows that pass secrets (`deploy.yml` reusable `secrets:` input, `deploy-dev.yml` /
  `deploy-prod.yml` passthrough) and `scripts/do-inject-prod-secrets.py`
- docs: `docs/setup/digitalocean.md` GitHub-Actions secrets table + any prod bring-up secret list
- `.env.example` / local setup with a concrete dev default (or clearly-empty ⇒ push disabled locally)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (ledger 2026-08-19 `finnhub-key`)**: a new secret env var that misses even one
  deploy-pipeline site ships a working-locally / broken-on-deploy gap. The wiring checklist above must
  be completed in the same PR; `/sdd-spec` should enumerate each file as an explicit step.
- [ ] **Known trap (ledger 2026-08-19 `020-notify-external-fanout`)**: do **not** gate push on an alert
  `context` Struct key — no producer reliably writes one. Target push by `target_user_id` (with empty =
  broadcast) and gate on `severity` only, matching how the shipped fanout channel actually works.
- [ ] **Known trap (ledger 2026-08-26 notify migration)**: the `notify.push.min_severity` **seed** is a
  `xstockstrat-config` migration, while `push_subscriptions` is a `xstockstrat-notify` migration — two
  different services' migration dirs. Don't put the config seed in notify.
- [ ] Where exactly does the enable/disable control live in the shell nav (Settings group) and how does
  it degrade on unsupported browsers (Safari-not-installed, no service-worker support)? — resolve in
  `/sdd-design`.
- [ ] Should the `web-push` send loop be sequential or bounded-concurrent per user, and is a per-alert
  dedup needed beyond the existing fanout dedup window? — resolve in `/sdd-design`.
