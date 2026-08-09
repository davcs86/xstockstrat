# xstockstrat-identity — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (JWT secret env-only not config, SHA-256-hex token storage vs base64url PKCE, untyped-handler house style, `aud`-bound OAuth tokens) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (⚠ unsigned-token revoke, fictional ledger audit, stale API-key docs) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service for authentication and JWT management. All services validate tokens against this service. Issues short-lived access JWTs and longer-lived refresh tokens, and is the durable OAuth 2.1 state store behind the MCP agent.

## Language

Node.js 22 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50058` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`src/index.ts` runs a single `@grpc/grpc-js` server exposing all
eleven methods: `AuthenticateUser`, `ValidateToken`, `RefreshToken`, `RevokeToken`,
the OAuth 2.1 backend RPCs (feature 049 Part B)
`RegisterOAuthClient`, `GetOAuthClient`, `IssueAuthCode`, `ExchangeAuthCode`, `RefreshOAuthToken`,
and the per-user authorized-app RPCs (feature 051) `ListAuthorizedApps`, `RevokeAuthorizedApp`).
The frontends validate tokens over gRPC `50058`.
The former HTTP/Connect-RPC server on `8058` (and the `src/connect/` Connect router) was removed.

### OAuth 2.1 backend (feature 049 Part B)

Identity is the durable OAuth state store + token mint behind the MCP agent's stateless OAuth 2.1
HTTP facade. `RegisterOAuthClient` (RFC 7591 DCR, https-only public client) and `GetOAuthClient`
manage `identity.oauth_clients`; `IssueAuthCode`/`ExchangeAuthCode` use `identity.oauth_auth_codes`
(single-use, 60s TTL, PKCE S256, exact redirect match). The OAuth access token's `aud`-binding
contract is IDENTITY-4 in `docs/context-constitution.md`. The OAuth **refresh token reuses `identity.refresh_tokens`** (rotation
on `RefreshOAuthToken` revokes the presented token and inserts a new one). TTLs reuse
`identity.jwt.access_ttl_seconds` / `identity.jwt.refresh_ttl_seconds`.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config (JWT secrets, token TTLs) |
| PostgreSQL | DB (schema: `identity`) | Users, sessions, OAuth clients + auth codes |

## Database / Migrations

- `000_schema`, `001_identity_tables` (`users`, `api_keys`, `refresh_tokens`), `002_seed_admin`.
- `003_oauth` (feature 049 Part B) — adds `identity.oauth_clients` + `identity.oauth_auth_codes`;
  OAuth refresh tokens reuse `identity.refresh_tokens` (no new table).
- `004_refresh_token_client` (feature 051) — tags `refresh_tokens` with `client_id`/`last_used_at`
  so `ListAuthorizedApps`/`RevokeAuthorizedApp` can list and revoke per-user OAuth grants.
- `005_drop_api_keys` — drops `identity.api_keys`; the API-key RPCs were removed and nothing
  consumes API keys anymore.

See `migrations/*.up.sql` for exact columns/constraints/indexes.

## Config Keys Consumed

Namespace: `identity`

| Key | Type | Default | Description |
|---|---|---|---|
| `identity.jwt.access_ttl_seconds` | int | `900` | Access token TTL (15 min) |
| `identity.jwt.refresh_ttl_seconds` | int | `2592000` | Refresh token TTL (30 days) |

> The JWT signing key's env-only sourcing (never config) is IDENTITY-1 in `docs/context-constitution.md`.

## Webhooks

_No webhooks. Call the gRPC RPCs on port 50058 directly._

## Environment Variables

Source: hardcoded in docker-compose `environment:` unless noted. `APPLICATION_ENV` and `NODE_ENV` come from `.env.local` (committed). `DATABASE_URL` is constructed by docker-compose from `POSTGRES_PASSWORD` in `.env`. `JWT_SECRET` comes from `.env` (see `.env.example`).

```text
GRPC_PORT=50058
CONFIG_ENDPOINT=xstockstrat-config:50060
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
JWT_SECRET=<secret>                    # .env — generate: openssl rand -hex 32
APPLICATION_ENV=development            # .env.local
TRADING_MODE=paper                     # paper | live
```

## Operations

User management (`scripts/manage-users.sh` create-user / reset-password, incl. `docker exec`) and the deploy-time `JWT_SECRET` wiring (`DEV_JWT_SECRET`/`PROD_JWT_SECRET` → `.do/app*.yaml`) live on-demand in this service's `docs/` folder (**`operations.md`**).

## Running Locally

```bash
pnpm install
# schema: run ../../scripts/db-migrate.sh from repo root (golang-migrate, not node-pg-migrate)
pnpm run dev
```
