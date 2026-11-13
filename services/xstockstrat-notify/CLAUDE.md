# xstockstrat-notify — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (AlertSeverity string↔int at the DB boundary, numeric-`13` error style, config-as-startup-gate-only) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (dead `jsonwebtoken`/`bcrypt` deps, `severities` type/runtime mismatch) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service providing **server-streaming alert delivery**. Services emit alerts via `EmitAlert` RPC; frontends and monitoring clients subscribe via the `StreamAlerts` server-streaming RPC and receive alerts in real time as they are emitted. Alert fan-out is in-process (no message broker required for small clusters).

## Language

Node.js 24 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50059` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`src/index.ts` runs a single `@grpc/grpc-js` server exposing
`EmitAlert`, `AcknowledgeAlert`, `ListAlerts`, `MarkAlertRead`, `RegisterPushSubscription`/
`UnregisterPushSubscription`, `FanoutWebhook`, and the `StreamAlerts` server-stream). The MCP
agent emits alerts via `EmitAlert`; the trader UI subscribes to `StreamAlerts` over gRPC and
bridges it to browser SSE. The former HTTP/Connect-RPC server on `8059` (its `src/connect/`
Connect router and `src/webhooks/` handlers) was removed.

## Key Design

- `StreamAlerts` holds long-lived gRPC server streams per subscriber
- Fan-out is synchronous in `EmitAlert` — alerts are delivered to matching subscribers before the RPC returns
- Alerts are also persisted to `notify.alerts` for history and replay
- Per-user read state lives in `notify.alert_reads (alert_id, user_id, read_at)` (feature 203), with no FK to `notify.alerts`
  — `MarkAlertRead`'s per-row JOIN is the only orphan guard. `ListAlerts`/`MarkAlertRead` take the owner from `x-user-id`
  (body `userId` fallback); with no identity `ListAlerts` is unscoped (every row, `read=false`) and `MarkAlertRead` does not
  check `target_user_id`. The BFF always injects the header, so only direct gRPC callers see this.
- Alert matching: by `user_id`, `categories[]`, `severities[]`

## Authorization — EmitAlert is an internal-service-caller contract (feature 092)

`EmitAlert` is **intentionally not role-gated**. It is a private-network, gRPC-only RPC whose trust
boundary is the network plus the agent's OAuth 2.1 edge. Every caller is internal and unauthenticated
at the RPC layer: the MCP agent sends no metadata at all (feature 097 removed its shared-secret
header), and the analysis live/fundsignal loops, ingest backfill auto-alert, and the Go
trading/marketdata/portfolio services send propagated headers or no metadata — **none** carries an
admin bit. An admin gate would break every caller — no caller (internal or the agent) sends any
distinguishing header today, so there is nothing left to invert-enforce; the private-network-plus-
OAuth-edge trust established by feature 092 is unaffected by feature 097's header removal. This
decision is pinned by a test in `src/__tests__/notifyServiceImpl.test.ts`
(a metadata-less `EmitAlert` must succeed). F-11 (write-path authz) considered and deliberately left
`EmitAlert` ungated.

### FanoutWebhook is gated by the mTLS peer SAN

`FanoutWebhook` (`fanoutWebhook` in `src/grpc/notifyServiceImpl.ts`) accepts a caller only when the
verified peer certificate carries a DNS SAN in `FANOUT_WEBHOOK_PEER_SANS` (`xstockstrat-ingest`); any
other peer gets code `7`. The SAN is the only check — no header is read — and the matched SAN is stored
as the delivery's `source_service`. `EmitAlert` stays ungated.

**Tests run compile-first** (`tsc && node --test dist/__tests__/*.test.js`) with a **static** import
and a hard "import succeeded" assertion — feature 092 replaced the `--experimental-strip-types`
harness whose lazy `try/catch` import silently skipped every case (0 assertions; the feature-074
zero-assertion trap).

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig, GetSecret | Live config at startup; the commsgun app key (`commsgun.app_key`, resolved as internal caller `notify`) |
| xstockstrat-identity | gRPC ListAdminUserIds | Untargeted Web Push audience (feature 242) |
| PostgreSQL | DB (schema: `notify`) | Persist alert history, the outbound webhook delivery queue and the email outbox |
| External HTTPS | outbound `POST` | Webhook deliveries, only to origins in `webhook.allowed_origins` |
| commsgun (homelab email hub) | outbound HTTPS `POST` | Alert email enqueue at `commsgun.enqueue_url`, a tailnet-only name; unreachable from DigitalOcean, where `auto` stays on SendGrid |

## Config Keys Consumed

> **Rule (C-05, CONFIG-9):** the stored key is namespace-relative; the FQN is display-only; every read key is seeded
> by a config migration.

Namespace: `notify`

| Key | Type | Default | Description |
|---|---|---|---|
| `fanout.min_severity` | int | `2` | Primary external-fanout gate: minimum `AlertSeverity` ordinal to fan out (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL), clamped to [0,4]. **Default 2 (WARNING) excludes INFO fill confirmations — lower to `1` to fan out fills.** (feature 020) |
| `fanout.min_confidence_threshold` | float | `0.7` | Minimum `context.conviction` (analysis readiness ordinal) required to fan out — applied only when the alert carries a numeric `conviction`; conviction-less alerts are gated by `min_severity` alone (feature 020) |
| `fanout.dedup_window_seconds` | int | `300` | Suppress re-delivery of a byte-identical alert (content hash of category/source/title/body + signal context) within this window (feature 020) |
| `fanout.sendgrid_from_email` | string | `''` | Sender address for outbound fanout email; email disabled until both from/to are set **and** `SENDGRID_API_KEY` is present (feature 020) |
| `fanout.sendgrid_to_email` | string | `''` | Recipient address for outbound fanout email; email disabled until both from/to are set **and** `SENDGRID_API_KEY` is present (feature 020) |
| `webhook.allowed_origins` | string | `''` | Origins a webhook callback URL may target: comma-separated `host[:port]` entries, each with an optional `https://` prefix; a missing port means 443. A URL passes only when its host and port equal one entry exactly — a `*.host` entry is a literal host, not a wildcard, and a malformed entry matches nothing. Empty rejects every callback URL. Read on every accept and before every attempt |
| `webhook.max_attempts` | int | `8` | Attempts a delivery gets before it is marked `dead`. A stored ≤ 0 reads as the default |
| `webhook.backoff_base_seconds` | int | `30` | Wait after the first failed attempt; after failed attempt *n* the wait is `min(base·2^(n−1), webhook.backoff_max_seconds)`. A stored ≤ 0 reads as the default |
| `webhook.backoff_max_seconds` | int | `3600` | Longest wait between two attempts. A stored ≤ 0 reads as the default |
| `webhook.request_timeout_seconds` | int | `10` | Per-request timeout of one delivery attempt, clamped to [1,60]. A stored ≤ 0 reads as the default |
| `fanout.email_provider` | string | `auto` | Email provider of the fanout: `auto`, `commsgun` or `sendgrid`; any other value reads as `auto`. Read live at dispatch and on every worker tick (feature 338) |
| `commsgun.enqueue_url` | string | `''` | Full HTTPS URL of the commsgun enqueue endpoint. With `commsgun.app_id` and `commsgun.to_email` it forms the *base configuration*; any of the three empty means commsgun cannot be addressed |
| `commsgun.app_id` | string | `''` | Subscriber app this environment sends as (`X-Commsgun-App`). Seeded per environment: `xstockstrat` (production), `xstockstrat-staging` (staging). Read per attempt |
| `commsgun.to_email` | string | `''` | Recipient of commsgun email. A queued row keeps the recipient it was queued with |
| `commsgun.app_key` | string (secret) | — | Bearer key of this environment's app. An `is_secret` row seeded without a value; never in the `WatchConfig` snapshot — resolved through `GetSecret` at boot and when the snapshot `version` changes. Unset means not ready |
| `commsgun.max_attempts` | int | `8` | Attempts a queued email gets before it ends `undelivered`. A stored ≤ 0 reads as the default |
| `commsgun.backoff_base_seconds` | int | `30` | Wait after the first failed attempt; after failed attempt *n* the wait is `min(max(base·2^(n−1), Retry-After), commsgun.backoff_max_seconds)`. A stored ≤ 0 reads as the default |
| `commsgun.backoff_max_seconds` | int | `3600` | Longest wait between two attempts; it also caps a `Retry-After` answer. A stored ≤ 0 reads as the default |
| `commsgun.request_timeout_seconds` | int | `10` | Per-request timeout of one enqueue, clamped to [1,60]. A stored ≤ 0 reads as the default |
| `push.min_severity` | int | `2` | Web Push gate: minimum `AlertSeverity` ordinal to send a Web Push (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL), clamped to [0,4]. Mirrors `notify.fanout.min_severity`; default 2 (WARNING) excludes INFO fill confirmations. Read live per dispatch. (feature 165) |

**Web Push (feature 165).** `src/fanout/webPush.ts` (`WebPushDispatcher`) is a **third, disjoint,
best-effort fanout channel** — it delivers OS notifications to installed-PWA devices via the Web Push
protocol (`web-push` lib, VAPID-signed). Dispatched from `emitAlert` via a **second `queueMicrotask`**
beside the `FanoutDispatcher` one, *after* the success callback, so it never blocks/delays the primary
`StreamAlerts` delivery or the RPC result. It gates on **severity only** (`notify.push.min_severity`,
read live) + `target_user_id` — never a `context` key. An empty `target_user_id` is pushed to
**admin-role users' subscriptions only** (feature 242): `src/services/adminDirectory.ts` resolves them
by a live, uncached identity `ListAdminUserIds` call per untargeted push (single-flight, 2s deadline,
header trio relayed). If that lookup fails, the push is skipped and an ERROR is logged at most once
per 60s. The `EmitAlert` result and `StreamAlerts` delivery are unaffected (in-app broadcast still
reaches everyone). VAPID creds are read once at construction; if `VAPID_SUBJECT` is present but not a
`mailto:`/`https:` URL the channel logs ERROR once and **disables** itself (avoids a silent per-send throw). A push whose endpoint
returns **404/410** prunes that `notify.push_subscriptions` row. Subscriptions are stored via the
additive `RegisterPushSubscription` (upsert by `endpoint`) / `UnregisterPushSubscription` (delete by
`endpoint`) RPCs; `push_subscriptions` is created by notify migration `002` (schema `notify`).

**External alert fanout (feature 020).** `src/fanout/fanout.ts` (`FanoutDispatcher`) POSTs qualifying
alerts to a Slack incoming webhook and/or SendGrid v3 mail-send as a **best-effort side-channel**. It
is dispatched via `queueMicrotask` *after* the `EmitAlert` success callback, so it never affects the
primary in-process `StreamAlerts` delivery or the RPC result, and every failure is caught and logged
at WARN. Channels are enabled independently: Slack iff `SLACK_WEBHOOK_URL` is set, SendGrid email iff
`SENDGRID_API_KEY` **and** both `notify.fanout.sendgrid_*_email` keys are non-empty. The
`notify.fanout.*` knobs are read live on every dispatch, so a change takes effect with no restart.
Which provider carries the email is decided per alert — see **Email providers** below.

**Outbound webhooks.** `FanoutWebhook` stores one row per `idempotency_key` in
`notify.webhook_deliveries` (migration `004`; states `pending` / `delivered` / `dead`) and
`src/fanout/webhookWorker.ts` (`WebhookWorker`) delivers it at least once.

- **Accept** (in this order): peer SAN (code `7`) → URL rule (code `3`,
  `callback_url rejected: <reason class>`) → `validate_only` returns here and stores nothing →
  `event_name` and `idempotency_key` present and ≤ 256 characters, payload ≤ 64 KiB (code `3`) →
  `INSERT … ON CONFLICT (idempotency_key) DO NOTHING`, so a repeated call is a no-op (a failed insert
  is code `13`).
- **URL rule** (`src/fanout/webhookUrlRule.ts`): `https` only, ≤ 2048 characters, no whitespace or
  control characters, no userinfo, no trailing-dot host, and host and port equal to one
  `webhook.allowed_origins` entry. A rejection names a reason class, never the URL.
- **Worker**: started once the gRPC server is bound; every 5 s it selects due `pending` rows, at most
  4 in flight. Each attempt re-runs the URL rule, then POSTs
  `{event_name, payload: {source_service, environment, occurred_at, data}}` with an `Idempotency-Key`
  header and `redirect: 'manual'`. 2xx → `delivered`; 408, 429, 5xx, a timeout or a network error →
  retried with the backoff above; a redirect, any other status, or a URL the rule no longer passes →
  `dead` at once. The last allowed attempt failing also marks the row `dead`.
- **Dead letter**: one WARNING alert (category `webhook`, source `xstockstrat-notify`) raised
  in-process, naming the event, the origin (host and port only) and the idempotency key.
- **One instance**: the worker's claim on a row is an in-memory set, so a second notify instance
  could deliver the same row twice. It runs single statements on the one pooled connection and never
  holds it across an HTTP request.
- **Requeue** after fixing an allowlist mistake (a `dead` row is never retried by itself):
  `UPDATE notify.webhook_deliveries SET state = 'pending', attempts = 0, next_attempt_at = NOW(), last_error = NULL, updated_at = NOW() WHERE delivery_id = '<id>' AND state = 'dead';`

**Email providers (feature 338).** A qualifying alert produces at most one email, through SendGrid or
through the homelab commsgun hub. `src/fanout/emailProvider.ts` holds the rules; `src/fanout/emailRender.ts`
renders the one subject and text both providers send; `src/fanout/sendgridSender.ts` is the SendGrid POST.

- **Base and readiness.** The *base* is `commsgun.enqueue_url`, `commsgun.app_id` and `commsgun.to_email`,
  all non-empty. The app key has three states (`src/services/commsgunSecret.ts`): `key`, `absent`
  (resolved, not set) and `unknown` (no resolve has succeeded yet). A failed refresh keeps the last
  resolved state.
- **Dispatch** (email branch of `FanoutDispatcher`, after the gates, dedup and Slack):

  | Mode | Condition | Action |
  |---|---|---|
  | any | alert category `commsgun` | no email |
  | `sendgrid` | — | SendGrid, if enabled |
  | `auto` | base set and key resolved | one row in `notify.email_outbox` |
  | `auto` | otherwise | SendGrid, if enabled |
  | `commsgun` | base set | one outbox row, whatever the key state |
  | `commsgun` | base not set | nothing sent or queued (`unconfigured`) |

  A failed insert is logged and counted (`enqueue_error`); in `auto` the email then goes through SendGrid
  once, in `commsgun` mode it is not sent.
- **Outbox** (`notify.email_outbox`, migration `005`): one row per alert (`alert_id` UNIQUE). States
  `pending` / `delivered` / `undelivered` / `rerouted`; `fallback` (`none` / `sendgrid`) on the last two;
  `reroute_reason` (`deliberate` / `lost_config`) on `rerouted`. The rendered recipient, subject and text
  exist only while the row is `pending`: every terminal UPDATE sets them to NULL (a CHECK enforces it). The
  key and the URL are never stored.
- **Worker** (`src/fanout/commsgunWorker.ts`, `CommsgunWorker`): started once the gRPC server is bound;
  every 5 s, at most 4 in flight. Each tick: alert sweep → route → incidents → due rows.

  | Route | When | Pending rows |
  |---|---|---|
  | `attempt` | mode `commsgun`; or `auto` with the base set and the key resolved | POSTed to commsgun |
  | `hold` | `auto`, base set, key `unknown` | left untouched, however old, until the key resolves |
  | `reroute_lost` | `auto`, base not set or key `absent` | end `rerouted` / `lost_config` |
  | `reroute_deliberate` | mode `sendgrid` | end `rerouted` / `deliberate` |

- **Attempt**: POST `{channel:"email", to:[recipient], subject, text}` with `X-Commsgun-App`,
  `Authorization: Bearer <key>`, `Idempotency-Key: alert:<alert_id>` and `redirect: 'manual'`; every retry
  of a row is byte-identical. 2xx → `delivered`. 429, 5xx, a timeout or a network error → retried with the
  backoff above. 401, 403, 409, 413, 422, a redirect or any other status → the row ends at once. With no
  URL or app id (`no_endpoint`), an unset key (`no_app_key`) or a key never resolved (`secret_unresolved`)
  no request is made and the attempt counts as a retry.
- **End of a row.** One guarded UPDATE decides the outcome; its side effects run only for the row it
  changed. `undelivered`: alert first, then — only in `auto` with SendGrid enabled — SendGrid once.
  `rerouted`: SendGrid once if enabled, no commsgun request. A row whose attempts run out while the mode
  is `sendgrid` is rerouted, not ended `undelivered`. Email is **at most once**: a crash between the
  UPDATE and the send loses that email and never repeats it.
- **Alerts** (WARNING, category `commsgun`, source `xstockstrat-notify`; ids, counts, key names and error
  classes only). They are derived from the table, so they are **at least once**: `escalated_at` marks a
  row whose alert was stored, and every tick re-raises for rows that need one and have none. Each
  `undelivered` row gets its own alert. Rerouted rows get one alert per drain — always for `lost_config`,
  and for `deliberate` only when an email was dropped or its SendGrid send was not confirmed. Two standing
  conditions alert when they start and again every 24 hours: mode `commsgun` without the base, and `auto`
  with the base set while the key is unset or could not be read on two consecutive tries.
- **Shutdown**: an in-flight commsgun POST is aborted and its row stays `pending` with the attempt not
  counted; a row already past its terminal UPDATE finishes before the pool closes.
- **Operating rules.**
  - Category `commsgun` is reserved for notify: any alert carrying it is never emailed.
  - Rotate the app key in config first, then retire the old key on the edge — a 401 ends a row at once.
  - Change `commsgun.app_id` or `commsgun.to_email` only while the outbox has no pending row: commsgun
    scopes idempotency per app, and a queued row keeps its recipient. The worker logs one WARN when the
    app id changes with rows pending.
  - Clearing `commsgun.enqueue_url` under `auto`, even briefly, sends every pending email through SendGrid.
  - One instance: the worker's claim on a row is an in-memory map. The drain and standing-incident
    latches are in memory too, so a restart can repeat one drain alert or one first standing alert.
  - Held rows have no age limit, and terminal rows are never purged.
  - First homelab deploy: from inside the notify container, check that the enqueue host resolves and that
    one enqueue is accepted (the name is a tailnet split-horizon record; the certificate is the edge's
    wildcard).

## Observability (feature 294-signal-map-instrumentation)

Any fixed value below (N, caps, truncation lengths) is a code constant, not a config key. Label values are closed sets; the service's telemetry allowlist test fails on any identifier or secret label.

- No `loop tick ok`: the webhook worker's and the commsgun worker's 5 s ticks write no per-tick record.
- Instruments: `notify.delivery{channel fanout|slack|sendgrid|push|webhook|commsgun, outcome}` (commsgun: queued|enqueue_error|unconfigured at dispatch, sent|http_error|timeout|error|no_app_key|secret_unresolved|no_endpoint per attempt, rerouted per rerouted row, dead once per undelivered row; fanout gates: gated_severity|gated_conviction|deduped|dispatch_error; slack/sendgrid: sent|http_error|timeout|error; push adds disabled|admin_lookup_error|no_audience|pruned; webhook: sent|http_error|timeout|error per attempt, plus dead once per dead-lettered row), `notify.stream.evictions{reason write_error|stream_error}`, gauge `notify.stream.subscribers`.
- Load-bearing logs: INFO `delivery channels` at startup; WARN `StreamAlerts subscriber evicted` (`reason`); ERROR `webhook delivery dead` (`eventName`, `origin`, `idempotencyKey`, `attempts`, `lastError`); WARN `webhook.allowed_origins has malformed entries — they match nothing` (at most once per 60 s); WARN `commsgun delivery undelivered` (`alertId`, `outboxId`, `attempts`, `errorClass`); WARN `commsgun email rerouted` (`alertId`, `outboxId`, `reason`, `fallback`); WARN `commsgun app id changed while emails are queued`; WARN `commsgun app key resolve failed` (`status`, `failures`); WARN `fanout channel error` with `channel: 'commsgun'` on a failed enqueue. The startup `delivery channels` line lists `commsgun` as enabled when the worker's route at boot is `attempt`.

## Environment Variables

> **Inter-service mTLS (feature 210):** this service also requires `MTLS_CERT` / `MTLS_KEY` / `MTLS_CA_CERT` — boot-time PEM strings (its own leaf, private key, and the platform CA). The gRPC server binds mutual TLS and every outbound gRPC dial presents the leaf; **fail-closed** — the service refuses to start if any is absent. `MTLS_KEY` is a `SECRET` in `.do/app*.yaml`. Contract → `docs/patterns/inter-service-mtls.md`; rollout → `docs/runbooks/inter-service-mtls-rollout.md`.

```text
GRPC_PORT=50059
CONFIG_ENDPOINT=xstockstrat-config:50060
IDENTITY_ENDPOINT=xstockstrat-identity:50058  # feature 242; unset ⇒ startup ERROR, untargeted push disabled
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
DATABASE_CA_CERT=<PEM>                 # feature 266 — required unless DATABASE_URL has exactly sslmode=disable (local compose); unset on a TLS URL ⇒ boot exits naming DATABASE_CA_CERT. Any ssl*/uselibpqcompat URL param is refused. The sslmode=disable carve-out is DB-only — gRPC mTLS stays fail-closed; the service now needs the DB to boot (SELECT 1 probe)
SLACK_WEBHOOK_URL=                  # type: SECRET (feature 020) — Slack incoming webhook; empty ⇒ Slack fanout disabled; rotation requires redeploy, not a live config push
SENDGRID_API_KEY=                   # type: SECRET (feature 020) — SendGrid v3 API key; empty ⇒ email fanout disabled; rotation requires redeploy
VAPID_PRIVATE_KEY=                  # type: SECRET (feature 165) — Web Push VAPID private key; empty ⇒ push disabled
VAPID_PUBLIC_KEY=                   # feature 165 — VAPID public key (also consumed by xstockstrat-ui); non-secret
VAPID_SUBJECT=                      # feature 165 — VAPID contact URL (mailto: or https:); non-secret; invalid/absent ⇒ push disabled
```

> `SLACK_WEBHOOK_URL` / `SENDGRID_API_KEY` / `VAPID_PRIVATE_KEY` are credentials delivered as DO App
> Platform `type: SECRET` env vars through the full deploy pipeline (docker-compose, both
> `.do/app*.yaml`, `common.*` in `secrets/<env>.enc.yaml` rendered by `scripts/do-render-app-spec.py`; see `docs/runbooks/sops-secrets.md`) — they deliberately
> stay env `SECRET`s rather than encrypted config rows (a choice, not a governance ban; feature 147 allows secret rows). `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` are
> non-secret and wired the same way for convenience. All are optional; an unset value simply disables
> that channel. Web Push needs **all three** VAPID values (feature 165).

## Running Locally

```bash
pnpm install
# schema: run ../../scripts/db-migrate.sh from repo root (golang-migrate, not node-pg-migrate)
pnpm run dev
```
