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
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-identity | gRPC ListAdminUserIds | Untargeted Web Push audience (feature 242) |
| PostgreSQL | DB (schema: `notify`) | Persist alert history and the outbound webhook delivery queue |
| External HTTPS | outbound `POST` | Webhook deliveries, only to origins in `webhook.allowed_origins` |

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
at WARN. Channels are enabled independently: Slack iff `SLACK_WEBHOOK_URL` is set, email iff
`SENDGRID_API_KEY` **and** both `notify.fanout.sendgrid_*_email` keys are non-empty. The five
`notify.fanout.*` knobs are read live on every dispatch, so a change takes effect with no restart.

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

## Observability (feature 294-signal-map-instrumentation)

Any fixed value below (N, caps, truncation lengths) is a code constant, not a config key. Label values are closed sets; the service's telemetry allowlist test fails on any identifier or secret label.

- No `loop tick ok`: the webhook worker's 5 s tick writes no per-tick record.
- Instruments: `notify.delivery{channel fanout|slack|sendgrid|push|webhook, outcome}` (fanout gates: gated_severity|gated_conviction|deduped|dispatch_error; slack/sendgrid: sent|http_error|timeout|error; push adds disabled|admin_lookup_error|no_audience|pruned; webhook: sent|http_error|timeout|error per attempt, plus dead once per dead-lettered row), `notify.stream.evictions{reason write_error|stream_error}`, gauge `notify.stream.subscribers`.
- Load-bearing logs: INFO `delivery channels` at startup; WARN `StreamAlerts subscriber evicted` (`reason`); ERROR `webhook delivery dead` (`eventName`, `origin`, `idempotencyKey`, `attempts`, `lastError`); WARN `webhook.allowed_origins has malformed entries — they match nothing` (at most once per 60 s).

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
