# xstockstrat-notify — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (AlertSeverity string↔int at the DB boundary, numeric-`13` error style, config-as-startup-gate-only) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (3 dead config keys, fictional ledger dep, `severities` type/runtime mismatch) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service providing **server-streaming alert delivery**. Services emit alerts via `EmitAlert` RPC; frontends and monitoring clients subscribe via the `StreamAlerts` server-streaming RPC and receive alerts in real time as they are emitted. Alert fan-out is in-process (no message broker required for small clusters).

## Language

Node.js 22 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50059` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`src/index.ts` runs a single `@grpc/grpc-js` server exposing
`EmitAlert`, `AcknowledgeAlert`, `ListAlerts`, and the `StreamAlerts` server-stream). The MCP
agent emits alerts via `EmitAlert`; the trader UI subscribes to `StreamAlerts` over gRPC and
bridges it to browser SSE. The former HTTP/Connect-RPC server on `8059` (its `src/connect/`
Connect router and `src/webhooks/` handlers) was removed.

## Key Design

- `StreamAlerts` holds long-lived gRPC server streams per subscriber
- Fan-out is synchronous in `EmitAlert` — alerts are delivered to matching subscribers before the RPC returns
- Alerts are also persisted to `notify.alerts` for history and replay
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

**Tests run compile-first** (`tsc && node --test dist/__tests__/*.test.js`) with a **static** import
and a hard "import succeeded" assertion — feature 092 replaced the `--experimental-strip-types`
harness whose lazy `try/catch` import silently skipped every case (0 assertions; the feature-074
zero-assertion trap).

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| PostgreSQL | DB (schema: `notify`) | Persist alert history |

## Config Keys Consumed

Namespace: `notify`

| Key | Type | Default | Description |
|---|---|---|---|
| `notify.stream.max_subscribers` | int | `1000` | **Documented, not yet enforced** — intended connection cap; no code reads it |
| `notify.alert.retention_days` | int | `30` | **Documented, not yet implemented** — intended history retention; no retention job reads it |
| `notify.alert.max_body_bytes` | int | `4096` | **Documented, not yet enforced** — intended body-size check; no code reads it |
| `notify.fanout.min_severity` | int | `2` | Primary external-fanout gate: minimum `AlertSeverity` ordinal to fan out (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL), clamped to [0,4]. **Default 2 (WARNING) excludes INFO fill confirmations — lower to `1` to fan out fills.** (feature 020) |
| `notify.fanout.min_confidence_threshold` | float | `0.7` | Minimum `context.conviction` (analysis readiness ordinal) required to fan out — applied only when the alert carries a numeric `conviction`; conviction-less alerts are gated by `min_severity` alone (feature 020) |
| `notify.fanout.dedup_window_seconds` | int | `300` | Suppress re-delivery of a byte-identical alert (content hash of category/source/title/body + signal context) within this window (feature 020) |
| `notify.fanout.sendgrid_from_email` | string | `''` | Sender address for outbound fanout email; email disabled until both from/to are set **and** `SENDGRID_API_KEY` is present (feature 020) |
| `notify.fanout.sendgrid_to_email` | string | `''` | Recipient address for outbound fanout email; email disabled until both from/to are set **and** `SENDGRID_API_KEY` is present (feature 020) |

**External alert fanout (feature 020).** `src/fanout/fanout.ts` (`FanoutDispatcher`) POSTs qualifying
alerts to a Slack incoming webhook and/or SendGrid v3 mail-send as a **best-effort side-channel**. It
is dispatched via `queueMicrotask` *after* the `EmitAlert` success callback, so it never affects the
primary in-process `StreamAlerts` delivery or the RPC result, and every failure is caught and logged
at WARN. Channels are enabled independently: Slack iff `SLACK_WEBHOOK_URL` is set, email iff
`SENDGRID_API_KEY` **and** both `notify.fanout.sendgrid_*_email` keys are non-empty. The five
`notify.fanout.*` knobs are read live on every dispatch, so a change takes effect with no restart.

## Environment Variables

```text
GRPC_PORT=50059
CONFIG_ENDPOINT=xstockstrat-config:50060
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
SLACK_WEBHOOK_URL=                  # type: SECRET (feature 020) — Slack incoming webhook; empty ⇒ Slack fanout disabled; rotation requires redeploy, not a live config push
SENDGRID_API_KEY=                   # type: SECRET (feature 020) — SendGrid v3 API key; empty ⇒ email fanout disabled; rotation requires redeploy
```

> `SLACK_WEBHOOK_URL` / `SENDGRID_API_KEY` are vendor credentials delivered as DO App Platform
> `type: SECRET` env vars through the full deploy pipeline (docker-compose + both `.do/app*.yaml`
> + the four deploy workflows + `scripts/do-inject-prod-secrets.py`) — **never** config-service
> rows (config governance / feature 076). Both are optional; an unset value simply disables that
> fanout channel.

## Running Locally

```bash
pnpm install
# schema: run ../../scripts/db-migrate.sh from repo root (golang-migrate, not node-pg-migrate)
pnpm run dev
```
