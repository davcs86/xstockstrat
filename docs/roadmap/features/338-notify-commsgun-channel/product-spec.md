# Product Spec: notify-commsgun-channel

**Created**: 2026-11-13

---

## Problem Statement

`xstockstrat-notify` can email a qualifying alert only through SendGrid (`SENDGRID_API_KEY` plus the two
`notify.fanout.sendgrid_*_email` keys), as a single best-effort POST that is lost on any failure. The homelab
now runs `commsgun`, a tailnet-only email hub (`POST https://comms.ts.<domain>/v1/messages`, Resend-backed,
durable queue, idempotent, rate-limited per app, with bounce tracking and a dashboard), and both homelab
xstockstrat environments already hold a commsgun app (`xstockstrat`, `xstockstrat-staging`) and a tailnet grant
to the edge on 443. The operator wants notify to use commsgun where it is reachable, without losing SendGrid
where it is not (the DigitalOcean-hosted environments have no tailnet path).

## User Story

As the platform operator, I want notify to send fanout email through the homelab commsgun hub when it is
configured and reachable, selectable live from config-ui, so that homelab alert email gets durable delivery
and bounce visibility while SendGrid keeps working everywhere commsgun is not available.

## Functional Requirements

FR-1. **Provider selection.** A config key `notify.fanout.email_provider` selects the fanout email provider:
`auto` (default), `commsgun` or `sendgrid`. It is read live on every dispatch. An unrecognised value behaves
as `auto`. At most one email is delivered per qualifying alert, whatever the mode.

FR-2. **`sendgrid` mode** behaves exactly as today (feature 020): one best-effort SendGrid POST, enabled iff
`SENDGRID_API_KEY` and both `notify.fanout.sendgrid_*_email` keys are set. No commsgun call is made.

FR-3. **Base configuration and readiness.** commsgun's *base configuration* is the enqueue URL, the app id
and `notify.commsgun.to_email`, all non-empty. In `auto` (or an unrecognised mode) commsgun is *ready* only
when the base is set and the app key has been resolved (`GetSecret` succeeded with `found = true`). When it is
not ready, `auto` behaves exactly as `sendgrid` mode — so an environment that never sets the commsgun keys
(DigitalOcean dev/prod) sees no behaviour change. In `commsgun` mode a qualifying alert is queued whenever the
base is set, whether or not the key is available; the key is checked at each attempt (FR-18).

FR-4. **Durable outbox.** In `auto` or `commsgun` mode with commsgun configured, a qualifying alert (same
gates as today: `fanout.min_severity`, `fanout.min_confidence_threshold`, `fanout.dedup_window_seconds`) is
persisted as one outbox row before any network call, and delivered asynchronously by a worker. The
`EmitAlert` result and `StreamAlerts` delivery are never delayed or failed by the outbox (same isolation as
the existing fanout and Web Push channels). A pending row survives a notify restart.

FR-5. **Enqueue contract.** Each attempt POSTs the commsgun email contract: headers `X-Commsgun-App`,
`Authorization: Bearer <app key>`, `Idempotency-Key` (derived deterministically from the alert id, so every
retry of one row carries the same key and the same body), JSON body `channel: "email"`, `to`, `subject`,
`text`. `202` and `200` (`duplicate: true`) both mark the row delivered.

FR-6. **Retry classification.** `429` (honouring `Retry-After`), `503`, any other `5xx`, a timeout or a
network error are retried with capped exponential backoff up to a configured attempt limit. `401`, `403`,
`409`, `413` and `422` are permanent: the row stops at once without further attempts.

FR-7. **Fallback.** A row ends `undelivered` when its attempts are used up or it gets a permanent status.
The fallback depends on the mode at that moment (an unrecognised value reads as `auto`): `auto` with SendGrid
enabled → the alert is sent once through SendGrid (`fallback = sendgrid`); `auto` with SendGrid disabled, or
`commsgun` → no email (`fallback = none`); `sendgrid` → the row is rerouted instead (FR-13). The row is kept
and records its state, its fallback and, for a rerouted row, the reroute reason. One qualifying alert never
produces more than one email: a crash between ending a row and sending its fallback results in no email,
never two.

FR-8. **Escalation without a loop.** Every `undelivered` row raises one in-process WARNING alert (category
`commsgun`, source `xstockstrat-notify`) naming the originating alert id and the error class, persisted before
any fallback send, plus one WARN log line and the `dead` delivery counter. If the process stops before that
alert is persisted, it is raised after restart (alerts are at-least-once). Alerts in category `commsgun` reach
`StreamAlerts`, Slack and Web Push but are never emailed by either provider, so there is no alert → email →
failure → alert cycle. The exclusion point is the email branch of `FanoutDispatcher`.

FR-9. **Credential handling.** The commsgun app key is an encrypted config secret (`is_secret = true`),
resolved by notify through the `GetSecret` RPC as an allow-listed internal caller. It is never an env var,
never logged, never part of an error string or an outbox row, and reads as `[redacted]` at every config read
edge. A rotated key takes effect without a notify redeploy.

FR-10. **Operator surface.** Every new key is seeded by a config migration and is visible and editable in
config-ui (the secret through the existing secret-write path). The startup delivery-channel log line names
`commsgun` among enabled or disabled channels, by name only.

FR-11. **No log leakage.** No recipient address, subject, body, app key or enqueue URL appears in a log line
or error string; logs carry the alert id, the outbox row id, the HTTP status class and the attempt number.

FR-12. **One subscriber app per environment.** Each environment sends as its own commsgun app:
`production` as `xstockstrat`, `staging` as `xstockstrat-staging`. The app id and the app key are
per-environment config rows (the app id seeded with those values, the key set per environment by the
operator); notify resolves both for the environment it runs in (`APPLICATION_ENV`) and never reads another
environment's row. The idempotency key needs no environment prefix: commsgun scopes it per app.

FR-13. **Rerouting.** On each tick the worker ends due pending rows without a commsgun POST in two cases:
mode `sendgrid` → `rerouted` with reason `deliberate`; mode `auto` with the base unset or the key unset →
`rerouted` with reason `lost_config`. Each rerouted row is sent once through SendGrid if it is enabled
(`fallback = sendgrid`), otherwise `fallback = none`. A row that reaches its terminal step while the mode is
`sendgrid` is rerouted as `deliberate`.

FR-14. **Pinned but unconfigured.** In `commsgun` mode with the base not fully set, a qualifying alert creates
no row and sends no SendGrid email; it records the `unconfigured` outcome. The condition raises one incident
alert when it starts and one more every 24 hours while it lasts; it ends when the mode or the base changes.

FR-15. **Incident alerts.** All are WARNING, category `commsgun`, source `xstockstrat-notify`, and carry
counts, key *names* and error classes only. (a) A `lost_config` drain raises one alert giving the rows by
fallback, the unconfirmed fallbacks and the rows still pending. (b) A `deliberate` drain raises one alert only
if at least one row was dropped (`fallback = none`) or its SendGrid send was not confirmed; a deliberate drain
whose every send was confirmed raises nothing. Drains alert once per drain. (c) A stalled key — `auto`, base
set, and the key unset or unresolved after two consecutive failed resolves — raises one alert naming the gRPC
status class, repeating every 24 hours while it lasts; it is silent without the base. (a) and (c) may both
fire for the same unset key. Every rerouted row that needs an alert is covered by one, including across a restart.

FR-16. **Hold.** In `auto` with the base set and a key that has never been resolved, pending rows are neither
attempted nor rerouted; new qualifying alerts go through SendGrid meanwhile. Held rows are delivered once the
key resolves, however old they are.

FR-17. **Shutdown.** On SIGTERM or SIGINT a commsgun POST in flight is aborted: the attempt is not counted and
the row stays `pending`. A terminal step already in progress, including its SendGrid fallback, finishes before
the DB pool closes, within the existing 5-second limit.

FR-18. **Error classes and retry timing.** `last_error`, logs and alerts carry only an error class from a
closed set. Three classes cover causes that are not HTTP errors and make no POST: `no_app_key` (key unset),
`secret_unresolved` (key never resolved), `no_endpoint` (URL or app id empty at attempt time); in `commsgun`
mode each counts as a retryable attempt. `Retry-After` is honoured but capped:
delay = min(max(backoff, Retry-After), `notify.commsgun.backoff_max_seconds`).

FR-19. **App-id change warning.** The app id is read at each attempt. When it changes while rows are pending,
the worker logs one WARN that contains neither app id. Pending rows keep the recipient they were queued with.

FR-20. **Reserved category and failed enqueue.** Category `commsgun` is reserved for notify and documented as
such; any alert in that category skips email. If the outbox insert fails in `auto`, notify records
`enqueue_error`, logs a WARN and sends once through SendGrid; in `commsgun` mode it records the metric and the
WARN only.

## Out of Scope

- SMS through commsgun — commsgun holds SMS with no provider today. Follow-up feature once it has one.
- Replacing or deprecating SendGrid, or changing the Slack and Web Push channels.
- Giving SendGrid a durable outbox; it stays a single best-effort POST (both as primary and as fallback).
- Any change to `davcs86/commsgun` (the enqueue contract is frozen) or to `davcs86/homelab-edge` (app keys
  `commsgun_app_key_xstockstrat` / `_xstockstrat_staging`, sender entries and the `tag:xstockstrat*` →
  `tag:edge:443` grants already exist).
- Reading commsgun delivery/bounce status back into xstockstrat; the commsgun dashboard is the source.
- Per-user recipients or per-user provider choice; fanout email stays a single global recipient.
- A dedicated config-ui page; the generic key editor is the surface.
- An age cap or expiry for held rows; purge or retention of terminal outbox rows; requeue tooling for
  `undelivered` rows.
- Running more than one notify instance (the worker's claim is in memory, as for webhooks).
- An alert when an enqueue fails in `commsgun` mode (the database is the failing dependency).

## Affected Services

- `xstockstrat-notify` — provider selection, commsgun client, outbox table + worker, fallback, `GetSecret`
  resolution, delivery-channel log, telemetry.
- `xstockstrat-config` — seed migration for the new keys (incl. the secret row); `notify` added to the
  `GetSecret` allow-list for exactly the commsgun secret.
- `xstockstrat-ui` — no code change expected; `/config-ui` is the consumer surface and is verified by e2e.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` segment `/config-ui`: the new `notify` keys appear in the existing key
  list/editor (already registered in `PLATFORM_SUBNAV`); the operator sets the provider mode, the commsgun
  URL, app id and recipient, and writes the app key as a secret. No new page or route.
- [ ] **Agent** — no tool change. The existing `get_config` / `set_config` / `list_config_keys` tools reach
  the new keys as they reach any key.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

All keys: namespace `notify`, global scope, per environment, seeded by one new `xstockstrat-config` migration
(next free number at execute time — not pinned here, see Known trap 2), read live per dispatch / per attempt
through notify's config watcher. **Stored keys are namespace-relative** (`fanout.email_provider`,
`commsgun.<name>` under namespace `notify`); the FQNs below are display-only. Reader files marked *new* do
not exist yet; their names are the planned homes and are confirmed by `/sdd-spec`.

- `notify.fanout.email_provider` — string, code default `auto`; `auto` | `commsgun` | `sendgrid`. Reader:
  `services/xstockstrat-notify/src/fanout/fanout.ts:FanoutDispatcher`.
- `notify.commsgun.enqueue_url` — string, code default `''`; full HTTPS URL of the enqueue endpoint. Reader:
  `services/xstockstrat-notify/src/fanout/commsgunClient.ts:CommsgunClient` (*new*).
- `notify.commsgun.app_id` — string, code default `''`; value of `X-Commsgun-App`. Seeded per environment:
  `xstockstrat` (production), `xstockstrat-staging` (staging). Reader:
  `commsgunClient.ts:CommsgunClient` (*new*).
- `notify.commsgun.app_key` — string, **secret** (`is_secret = true`); seeded as a value-less secret row
  (NULL ciphertext, as the marketdata keys were) so config-ui lists it and can set it; no code default, an
  unset value (`found = false`) means "not configured". Resolved via `GetSecret`, never via `WatchConfig`. Reader:
  `services/xstockstrat-notify/src/services/commsgunSecret.ts:resolveCommsgunAppKey` (*new*).
- `notify.commsgun.to_email` — string, code default `''`; recipient of commsgun fanout email. No sender key:
  `from` is omitted, so commsgun applies the app's default sender. Reader: `fanout.ts:FanoutDispatcher`
  (the "configured" test and the row's recipient).
- `notify.commsgun.max_attempts` — int, code default `8`; attempts before a row ends undelivered. `≤ 0` reads
  as the default. Reader: `services/xstockstrat-notify/src/fanout/commsgunWorker.ts:CommsgunWorker` (*new*).
- `notify.commsgun.backoff_base_seconds` — int, code default `30`; wait after failed attempt *n* is
  `min(base·2^(n−1), backoff_max_seconds)`. `≤ 0` reads as the default. Reader: `commsgunWorker.ts:CommsgunWorker`.
- `notify.commsgun.backoff_max_seconds` — int, code default `3600`. `≤ 0` reads as the default. Reader:
  `commsgunWorker.ts:CommsgunWorker`.
- `notify.commsgun.request_timeout_seconds` — int, code default `10`, clamped to `[1,60]`. Reader:
  `commsgunClient.ts:CommsgunClient`.

**`GetSecret` grant** (code, not a key): `services/xstockstrat-config/src/grpc/authz.ts:SECRET_CALLER_ALLOWLIST`
gains `{ callerID: 'notify', namespace: 'notify', keys: ['commsgun.app_key'], peerSan: 'xstockstrat-notify' }`
— exact key, SAN-pinned like the two existing grants.

## Database Changes

- New table `notify.email_outbox` in a new numbered migration pair in `services/xstockstrat-notify/migrations/`:
  one row per qualifying alert (`alert_id` UNIQUE); `state` ∈ `pending`, `delivered`, `undelivered`,
  `rerouted`; `fallback` ∈ `none`, `sendgrid`, set on `undelivered` and `rerouted` rows; `reroute_reason` ∈
  `deliberate`, `lost_config`, set iff `rerouted`; `attempts >= 0`, `next_attempt_at`, `last_error` (an error
  class only); `escalated_at` (only on `undelivered` / `rerouted`), `fallback_sent_at` (only with
  `fallback = sendgrid`). The rendered recipient, subject and text are stored while the row is `pending` and
  NULLed by every terminal update; a CHECK enforces "content present iff pending". No app key or URL is stored.
  Partial indexes: pending rows by `next_attempt_at`; rows that need an alert and have none.
- Connection budget unchanged: the worker uses notify's existing single pooled connection and never holds it
  across an HTTP request (as `WebhookWorker` does).
- Run order: the notify outbox migration and the config seed migration are independent. notify treats an
  absent key as its code default and an absent secret as "not configured", so either order is safe.

## Feature Workflow Notes

Branch to create: `feature/notify-commsgun-channel` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — new config keys: owner + config team
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)
- [x] Security review — new secret row and a new `GetSecret` allow-list grant

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Known Traps (Ledger)

1. **Silent fallback hides a hard failure** (fails.md 2026-08-19, feature 140): a degradation fallback must
   escalate when its trigger rate is sustained. FR-8 exists for this — `auto` must not quietly send
   everything through SendGrid for weeks while commsgun is misconfigured.
2. **Pinned volatile schema facts** (fails.md 2026-08-26, feature 020): do not hardcode the config or notify
   migration number in design artifacts; take the next free number at execute time.
3. **Credential placement** (fails.md 2026-08-19 feature 076, 2026-08-21 feature 147): a credential is never
   a plain `config_values` row; it is an `is_secret` row behind `GetSecret`, and it stays writable from
   config-ui and the agent `set_config` tool.
4. **Gating on unwritten context keys** (fails.md 2026-08-19, feature 020): the outbox reuses the existing
   fanout gates unchanged; it introduces no new `context` key dependency.

## Open Questions

- [x] **Outbox shape** — dedicated table + worker, or generalising `notify.webhook_deliveries` /
  `WebhookWorker`. Deferred to `/sdd-design` by owner decision (design fork, needs recon of `WebhookWorker`).
- [x] **What the outbox row stores** — rendered subject/text, or only the alert id re-rendered per attempt.
  Deferred to `/sdd-design` by owner decision; FR-5 (byte-identical retries) and FR-11 bind either choice.
- [x] **Tailnet name resolution from the container** — working assumption: compose-network containers on the
  app VM resolve tailnet names through the host resolver (`davcs86/homelab-edge`
  `docs/runbooks/deploy-compose-app.md`: "a user-defined network resolves tailnet names the way the compose
  project does"), so no `deploy/homelab/compose.yml` change. Recon task for `/sdd-design`: confirm, or name
  the compose change.
- [x] **`GetSecret` grant shape** — decided: exact key, SAN-pinned (see Config Key Changes).
- [x] **Local and DO environments** — decided: the secret row is seeded without a value (recon: config-ui lists
  only stored rows and cannot create one); an unset secret, or a failed `GetSecret`, is "not configured" (never
  a startup failure), so `auto` resolves to SendGrid there.
- [x] **Per-app rate limit** — decided: no pacing in the worker. The existing fanout gates bound volume, and a
  `429` is retried after `Retry-After` (FR-6) with the same idempotency key.
