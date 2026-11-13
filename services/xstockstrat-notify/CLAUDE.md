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

gRPC-only on `50059`; the trader UI bridges `StreamAlerts` to browser SSE.

## Key Design

- `StreamAlerts` holds long-lived gRPC server streams per subscriber
- Fan-out is synchronous in `EmitAlert` — alerts are delivered to matching subscribers before the RPC returns
- Alerts are also persisted to `notify.alerts` for history and replay
- Per-user read state (`notify.alert_reads`, feature 203) and the owner fallback: NOTIFY-7.
- Alert matching: by `user_id`, `categories[]`, `severities[]`

## Authorization — EmitAlert is an internal-service-caller contract (feature 092)

`EmitAlert` is **intentionally ungated** (F-11): its trust boundary is the private network plus the agent's
OAuth edge, no caller sends an admin bit, and a metadata-less call must succeed (pinned by
`src/__tests__/notifyServiceImpl.test.ts`).

### FanoutWebhook is gated by the mTLS peer SAN

`FanoutWebhook` is gated solely by peer SAN (`FANOUT_WEBHOOK_PEER_SANS` = `xstockstrat-ingest`, else code `7`);
the matched SAN is stored as `source_service`.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig, GetSecret | Live config at startup; the commsgun app key (`commsgun.app_key`, resolved as internal caller `notify`) |
| xstockstrat-identity | gRPC ListAdminUserIds | Untargeted Web Push audience (feature 242) |
| PostgreSQL | DB (schema: `notify`) | Persist alert history, the outbound webhook delivery queue and the email outbox |
| External HTTPS | outbound `POST` | Webhook deliveries, only to origins in `webhook.allowed_origins` |
| commsgun (homelab email hub) | outbound HTTPS `POST` | Alert email enqueue at `commsgun.enqueue_url`, a tailnet-only name; unreachable from DigitalOcean, where `auto` stays on SendGrid |

## Config Keys Consumed

Namespace: `notify`

| Key | Type | Default | Description |
|---|---|---|---|
| `fanout.min_severity` | int | `2` | Primary external-fanout gate: minimum `AlertSeverity` ordinal to fan out (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL), clamped to [0,4]. **Default 2 (WARNING) excludes INFO fill confirmations — lower to `1` to fan out fills.** (feature 020) |
| `fanout.min_confidence_threshold` | float | `0.7` | Minimum `context.conviction` (analysis readiness ordinal) required to fan out — applied only when the alert carries a numeric `conviction`; conviction-less alerts are gated by `min_severity` alone (feature 020) |
| `fanout.dedup_window_seconds` | int | `300` | Suppress re-delivery of a byte-identical alert (content hash of category/source/title/body + signal context) within this window (feature 020) |
| `fanout.sendgrid_from_email` | string | `''` | Sender address for outbound fanout email; email disabled until both from/to are set **and** `SENDGRID_API_KEY` is present (feature 020) |
| `fanout.sendgrid_to_email` | string | `''` | Recipient address for outbound fanout email; email disabled until both from/to are set **and** `SENDGRID_API_KEY` is present (feature 020) |
| `webhook.allowed_origins` | string | `''` | Origin allowlist for callback URLs: comma-separated `host[:port]` entries, optional `https://` prefix, missing port = 443 (match rule: § Outbound webhooks). Empty rejects all. Read on every accept and before every attempt |
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

**Web Push (feature 165).** `WebPushDispatcher` (`src/fanout/webPush.ts`) is a best-effort fanout channel
queued after the RPC result; it gates on severity only (`push.min_severity`) + `target_user_id`; untargeted
alerts go to admins only (NOTIFY-8); endpoint prune/unregister rules: NOTIFY-6; it needs all three VAPID vars.

**External alert fanout (feature 020).** `FanoutDispatcher` (`src/fanout/fanout.ts`): Slack iff `SLACK_WEBHOOK_URL`,
email iff `SENDGRID_API_KEY` + both `fanout.sendgrid_*_email` keys; best-effort, never affects the RPC result
(live-read knobs: NOTIFY-3).

**Email providers (feature 338).** A qualifying alert produces at most one email. `fanout.email_provider`
picks the carrier: `sendgrid` (as before), `commsgun` (the homelab hub only, never SendGrid), or `auto` —
commsgun when its URL, app id, recipient and app key are all available, otherwise SendGrid. A commsgun
email is one row in `notify.email_outbox` (migration `005`) delivered by `CommsgunWorker`
(`src/fanout/commsgunWorker.ts`) with retries; when a row ends undelivered in `auto`, SendGrid is tried once.
Email is at-most-once, alerts about it (category `commsgun`, reserved and never emailed) are at-least-once
(NOTIFY-13). Dispatch and route tables, outbox states, retry classes and the incident alerts: `email-providers.md`
in this service's `docs/` folder; operator rules (key rotation order, changing the app id, the first homelab
deploy check): `operations.md` there.

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
  4 in flight. Each attempt re-runs the URL rule, then POSTs the webhook envelope (body and
  `Idempotency-Key` header per the contracts doc, `contracts.md`, in the `davcs86/webhooks-mcp` repository) with
  `redirect: 'manual'`. 2xx → `delivered`; 408, 429, 5xx, a timeout or a network error →
  retried with the backoff above; a redirect, any other status, or a URL the rule no longer passes →
  `dead` at once. The last allowed attempt failing also marks the row `dead`.
- **Dead letter**: one WARNING alert (category `webhook`, source `xstockstrat-notify`) raised
  in-process, naming the event, the origin (host and port only) and the idempotency key.
- **Requeue** a `dead` row after fixing an allowlist mistake: SQL in `operations.md` in this service's `docs/` folder.

## Observability (feature 294-signal-map-instrumentation)

- No `loop tick ok`: the webhook worker's and the commsgun worker's 5 s ticks write no per-tick record.
- Instruments: `notify.delivery{channel fanout|slack|sendgrid|push|webhook|commsgun, outcome}` (commsgun: queued|enqueue_error|unconfigured at dispatch, sent|http_error|timeout|error|no_app_key|secret_unresolved|no_endpoint per attempt, rerouted per rerouted row, dead once per undelivered row; fanout gates: gated_severity|gated_conviction|deduped|dispatch_error; slack/sendgrid: sent|http_error|timeout|error; push adds disabled|admin_lookup_error|no_audience|pruned; webhook: sent|http_error|timeout|error per attempt, plus dead once per dead-lettered row), `notify.stream.evictions{reason write_error|stream_error}`, gauge `notify.stream.subscribers`.
- Load-bearing logs: INFO `delivery channels` at startup; WARN `StreamAlerts subscriber evicted` (`reason`); ERROR `webhook delivery dead` (`eventName`, `origin`, `idempotencyKey`, `attempts`, `lastError`); WARN `webhook.allowed_origins has malformed entries — they match nothing` (at most once per 60 s); WARN `commsgun delivery undelivered` (`alertId`, `outboxId`, `attempts`, `errorClass`); WARN `commsgun email rerouted` (`alertId`, `outboxId`, `reason`, `fallback`); WARN `commsgun app id changed while emails are queued`; WARN `commsgun app key resolve failed` (`status`, `failures`); WARN `fanout channel error` with `channel: 'commsgun'` on a failed enqueue. The startup `delivery channels` line lists `commsgun` as enabled when the worker's route at boot is `attempt`.

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root `CLAUDE.md` § Environment Variable Naming Convention.

```text
GRPC_PORT=50059
CONFIG_ENDPOINT=xstockstrat-config:50060
IDENTITY_ENDPOINT=xstockstrat-identity:50058  # feature 242; unset ⇒ startup ERROR, untargeted push disabled
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
DATABASE_CA_CERT=<PEM>                 # required unless sslmode=disable — docs/patterns/database.md; the service needs the DB to boot (SELECT 1 probe)
SLACK_WEBHOOK_URL=                  # type: SECRET (feature 020) — Slack incoming webhook; empty ⇒ Slack fanout disabled; rotation requires redeploy, not a live config push
SENDGRID_API_KEY=                   # type: SECRET (feature 020) — SendGrid v3 API key; empty ⇒ email fanout disabled; rotation requires redeploy
VAPID_PRIVATE_KEY=                  # type: SECRET (feature 165) — Web Push VAPID private key; empty ⇒ push disabled
VAPID_PUBLIC_KEY=                   # feature 165 — VAPID public key (also consumed by xstockstrat-ui); non-secret
VAPID_SUBJECT=                      # feature 165 — VAPID contact URL (mailto: or https:); non-secret; invalid/absent ⇒ push disabled
```

> All optional; an unset value disables that channel; Web Push needs all three VAPID values (wiring: `docs/runbooks/sops-secrets.md`).
