# xstockstrat-identity — CLAUDE.md

## Role

Node.js gRPC service for authentication, JWT management, and API key lifecycle. All services validate tokens against this service. Issues short-lived access JWTs and longer-lived refresh tokens. API keys are hashed before storage.

## Language

Node.js 22 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50058` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`src/index.ts` runs a single `@grpc/grpc-js` server exposing all
thirteen methods: `AuthenticateUser`, `ValidateToken`, `RefreshToken`, `RevokeToken`, `CreateApiKey`,
`ValidateApiKey`, `ListApiKeys`, `RevokeApiKey`, and the OAuth 2.1 backend RPCs (feature 049 Part B)
`RegisterOAuthClient`, `GetOAuthClient`, `IssueAuthCode`, `ExchangeAuthCode`, `RefreshOAuthToken`).
The frontends validate tokens over gRPC `50058`.
The former HTTP/Connect-RPC server on `8058` (and the `src/connect/` Connect router) was removed.

### OAuth 2.1 backend (feature 049 Part B)

Identity is the durable OAuth state store + token mint behind the MCP agent's stateless OAuth 2.1
HTTP facade. `RegisterOAuthClient` (RFC 7591 DCR, https-only public client) and `GetOAuthClient`
manage `identity.oauth_clients`; `IssueAuthCode`/`ExchangeAuthCode` use `identity.oauth_auth_codes`
(single-use, 60s TTL, PKCE S256, exact redirect match). The OAuth **access token is an `aud`-bound
JWT** (`TokenClaims.aud` = the agent resource URI, RFC 8707) minted with the standard claim shape;
`ValidateToken` surfaces `aud`. The OAuth **refresh token reuses `identity.refresh_tokens`** (rotation
on `RefreshOAuthToken` revokes the presented token and inserts a new one). TTLs reuse
`identity.jwt.access_ttl_seconds` / `identity.jwt.refresh_ttl_seconds`.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config (JWT secrets, token TTLs) |
| xstockstrat-ledger | gRPC write | Auth event audit trail |
| PostgreSQL | DB (schema: `identity`) | Users, sessions, API keys, OAuth clients + auth codes |

## Database / Migrations

- `000_schema`, `001_identity_tables` (`users`, `api_keys`, `refresh_tokens`), `002_seed_admin`.
- `003_oauth` (feature 049 Part B) — adds `identity.oauth_clients` (`client_id` PK, `redirect_uris
  TEXT[]`, `client_name`, `created_at`) and `identity.oauth_auth_codes` (`code` PK = SHA-256 hash,
  `client_id`/`user_id` FKs ON DELETE CASCADE, `redirect_uri`, `code_challenge`, `resource`,
  `expires_at`, `consumed_at`, `created_at`; index on `client_id`). Refresh tokens are **not** a new
  table — OAuth reuses `identity.refresh_tokens`.

## Config Keys Consumed

Namespace: `identity`

| Key | Type | Default | Description |
|---|---|---|---|
| `identity.jwt.access_ttl_seconds` | int | `900` | Access token TTL (15 min) |
| `identity.jwt.refresh_ttl_seconds` | int | `2592000` | Refresh token TTL (30 days) |
| `identity.jwt.secret` | string (secret) | — | JWT signing key (resolved from secret store) |
| `identity.apikey.max_per_user` | int | `10` | Max API keys per user |

## Webhooks

_No webhooks. Call the gRPC RPCs on port 50058 directly._

## Environment Variables

Source: hardcoded in docker-compose `environment:` unless noted. `APPLICATION_ENV` and `NODE_ENV` come from `.env.local` (committed). `DATABASE_URL` is constructed by docker-compose from `POSTGRES_PASSWORD` in `.env`. `JWT_SECRET` comes from `.env` (see `.env.example`).

```text
GRPC_PORT=50058
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
JWT_SECRET=<secret>                    # .env — generate: openssl rand -hex 32
APPLICATION_ENV=development            # .env.local
TRADING_MODE=paper                     # paper | live
```

## User Management

`scripts/manage-users.sh` (repo root) creates and resets passwords for identity service users. It uses `bcrypt` from the identity service's `node_modules` and requires `psql`.

```bash
# From repo root (local dev):
./scripts/manage-users.sh create-user admin@example.com admin,trader
./scripts/manage-users.sh reset-password admin@example.com

# Inside a running container (docker exec):
docker exec -it xstockstrat-identity \
  DATABASE_URL=<url> /app/scripts/manage-users.sh create-user admin@example.com admin
```

The script is copied into the Docker image at `/app/scripts/manage-users.sh` by the `Dockerfile` runner stage. When run inside the container it auto-detects the container layout (`node_modules` at `/app` instead of the local service directory).

## JWT_SECRET

`JWT_SECRET` must be set identically in the identity service and all three frontends (trader, insights, config-ui). It is injected at deploy time from GitHub Actions secrets:

| Secret | Used by |
|---|---|
| `DEV_JWT_SECRET` | `deploy-dev.yml` → `.do/app.dev.yaml` |
| `PROD_JWT_SECRET` | `deploy-prod.yml` → `.do/app.yaml` |

Generate: `openssl rand -hex 32`

## Running Locally

```bash
pnpm install
pnpm run migrate
pnpm run dev
```
