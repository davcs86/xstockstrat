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
at the RPC layer: the MCP agent sends only `x-mcp-secret` (no admin scope), and the analysis
live/fundsignal loops, ingest backfill auto-alert, and the Go trading/marketdata/portfolio services
send propagated headers or no metadata — **none** carries an admin bit. An admin gate would break
every caller; enforcing `x-mcp-secret` would invert the trust boundary (only the *external* agent
sends it). This decision is pinned by a test in `src/__tests__/notifyServiceImpl.test.ts`
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

## Environment Variables

```text
GRPC_PORT=50059
CONFIG_ENDPOINT=xstockstrat-config:50060
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
pnpm install
# schema: run ../../scripts/db-migrate.sh from repo root (golang-migrate, not node-pg-migrate)
pnpm run dev
```
