# xstockstrat-identity — CLAUDE.md

## Role
Node.js gRPC service for authentication, JWT management, and API key lifecycle. All services validate tokens against this service. Issues short-lived access JWTs and longer-lived refresh tokens. API keys are hashed before storage.

## Language
Node.js 20 + TypeScript

## gRPC Port
`50058`

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

```
GRPC_PORT=50058
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
JWT_SECRET=<secret — use secret store in production>
```

## Running Locally

```bash
npm install
npm run migrate
npm run dev
```
