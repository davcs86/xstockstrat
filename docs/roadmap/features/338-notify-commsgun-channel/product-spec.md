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

FR-3. **commsgun is "configured"** iff the enqueue URL, the app id, the app key and a recipient are all
non-empty. In `auto` mode with commsgun not configured, notify behaves as `sendgrid` mode — so an environment
that never sets the commsgun keys (DigitalOcean dev/prod) sees no behaviour change.

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

FR-7. **Fallback.** When a row ends without delivery (attempts exhausted or a permanent status) and the mode
at that moment is `auto`, notify sends that alert once through SendGrid if SendGrid is enabled. In `commsgun`
mode there is no fallback. Either way the row is kept in a terminal state that records which path ended it.

FR-8. **Escalation without a loop.** A row that ends undelivered by commsgun is surfaced to the operator
(log at WARN with the alert id only, plus a metric), and a sustained failure is not silent. Whatever raises
that signal must not itself re-enter the email fanout (no alert → email → failure → alert cycle).

FR-9. **Credential handling.** The commsgun app key is an encrypted config secret (`is_secret = true`),
resolved by notify through the `GetSecret` RPC as an allow-listed internal caller. It is never an env var,
never logged, never part of an error string or an outbox row, and reads as `[redacted]` at every config read
edge. A rotated key takes effect without a notify redeploy.

FR-10. **Operator surface.** Every new key is seeded by a config migration and is visible and editable in
config-ui (the secret through the existing secret-write path). The startup delivery-channel log line names
`commsgun` among enabled or disabled channels, by name only.

FR-11. **No log leakage.** No recipient address, subject, body, app key or enqueue URL appears in a log line
or error string; logs carry the alert id, the outbox row id, the HTTP status class and the attempt number.

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
through notify's config watcher. Reader symbols are assigned at `/sdd-spec` (the commsgun module does not
exist yet); the selection reader is `services/xstockstrat-notify/src/fanout/fanout.ts:FanoutDispatcher`.

- `notify.fanout.email_provider` — string, default `auto`; `auto` | `commsgun` | `sendgrid`. Read by the
  fanout dispatcher.
- `notify.commsgun.enqueue_url` — string, default `''`; full HTTPS URL of the enqueue endpoint. Read by the
  commsgun client.
- `notify.commsgun.app_id` — string, default `''`; value of `X-Commsgun-App`. Read by the commsgun client.
- `notify.commsgun.app_key` — string, **secret** (`is_secret = true`), no default; Bearer key. Resolved by
  notify via `GetSecret`, never via `WatchConfig`.
- `notify.commsgun.to_email` — string, default `''`; recipient of commsgun fanout email (see Open Questions).
- `notify.commsgun.max_attempts` — int, default `8`; attempts before a row ends undelivered. `≤ 0` reads as
  the default.
- `notify.commsgun.backoff_base_seconds` — int, default `30`; wait after failed attempt *n* is
  `min(base·2^(n−1), backoff_max_seconds)`. `≤ 0` reads as the default.
- `notify.commsgun.backoff_max_seconds` — int, default `3600`. `≤ 0` reads as the default.
- `notify.commsgun.request_timeout_seconds` — int, default `10`, clamped to `[1,60]`.

## Database Changes

- New table in schema `notify` for the email outbox (one row per qualifying alert; states pending /
  delivered / terminal-undelivered; attempt count, next-attempt time, last error **class** only). New
  numbered migration pair in `services/xstockstrat-notify/migrations/`. No secret, address, subject or body
  is stored beyond what delivery needs — whether the rendered message or only the alert id is stored is a
  design decision (Open Questions).
- Connection budget unchanged: the worker uses notify's existing single pooled connection and never holds it
  across an HTTP request (as `WebhookWorker` does).

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

- [ ] **Outbox shape** — a new dedicated table + worker, or generalising `notify.webhook_deliveries` /
  `WebhookWorker` (same states, backoff and single-instance claim, but its URL rule, allowlist and payload
  envelope are webhook-specific)? Decide in `/sdd-design`.
- [ ] **Recipient and sender keys** — the spec proposes a new `notify.commsgun.to_email` and omitting `from`
  (commsgun then uses the app's default sender). Alternative: reuse `notify.fanout.sendgrid_to_email` as the
  one recipient for both providers (fewer keys, misleading name). Operator to confirm.
- [ ] **What the outbox row stores** — rendered subject/text (delivery is independent of the alert row, but
  alert content is duplicated at rest) or only the alert id, re-rendered per attempt from `notify.alerts`.
- [ ] **Tailnet name resolution from the container** — `comms.ts.<domain>` is a split-horizon name served on
  the tailnet. Recon must show that the notify container on the app VM resolves and reaches it through the
  compose network (host resolver / `extra_hosts` / DNS option), or name the `deploy/homelab/compose.yml`
  change needed.
- [ ] **Escalation channel for FR-8** — in-process WARNING alert flagged to skip email fanout (as the webhook
  dead-letter alert does, but that one would re-enter email), or metric + log only with a Grafana alert rule?
- [ ] **`GetSecret` grant shape** — `x-internal-caller` only, or also pinned to notify's mTLS peer SAN
  (`peerSan`, as the feature-224 grants are)?
- [ ] **Local and DO environments** — confirm the secret row is seeded empty/absent there so `auto` resolves
  to SendGrid, and that an absent secret is "not configured", not a startup failure.
- [ ] **Per-app rate limit** — commsgun rejects a whole request with `429` over the app's per-minute / per-day
  limit. Is the existing `fanout.dedup_window_seconds` gate enough, or should the worker pace sends?
