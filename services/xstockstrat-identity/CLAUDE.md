# xstockstrat-identity — CLAUDE.md

## Role
Node.js gRPC service for authentication, JWT management, and API key lifecycle. All services validate tokens against this service. Issues short-lived access JWTs and longer-lived refresh tokens. API keys are hashed before storage.

## Language
Node.js 20 + TypeScript

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50058` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8058` | Connect-RPC + n8n webhooks |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8058`.

- Router: `src/connect/connectRouter.ts` — exposes `AuthenticateUser`, `ValidateToken`, `CreateApiKey` via `connectNodeAdapter`
- Entry: `src/index.ts` — HTTP server with CORS headers mounts the Connect router
- Callers (n8n, frontends) use HTTP `8058`; internal services use gRPC `50058`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config (JWT secrets, token TTLs) |
| xstockstrat-ledger | gRPC write | Auth event audit trail |
| PostgreSQL | DB (schema: `identity`) | Users, sessions, API keys |

## Config Keys Consumed

Namespace: `identity`

| Key | Type | Default | Description |
|---|---|---|---|
| `identity.jwt.access_ttl_seconds` | int | `900` | Access token TTL (15 min) |
| `identity.jwt.refresh_ttl_seconds` | int | `2592000` | Refresh token TTL (30 days) |
| `identity.jwt.secret` | string (secret) | — | JWT signing key (resolved from secret store) |
| `identity.apikey.max_per_user` | int | `10` | Max API keys per user |

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/validate-token` | POST | `{token}` | Validates JWT, returns claims |
| `/webhooks/n8n/create-apikey` | POST | `{user_id, name, scopes}` | Creates new API key |

## Environment Variables

Source: hardcoded in docker-compose `environment:` unless noted. `APPLICATION_ENV` and `NODE_ENV` come from `.env.local` (committed). `DATABASE_URL` is constructed by docker-compose from `POSTGRES_PASSWORD` in `.env`. `JWT_SECRET` comes from `.env` (see `.env.example`).

```
GRPC_PORT=50058
HTTP_PORT=8058
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
JWT_SECRET=<secret>                    # .env — generate: openssl rand -hex 32
APPLICATION_ENV=development            # .env.local
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
pnpm install
pnpm run migrate
pnpm run dev
```
