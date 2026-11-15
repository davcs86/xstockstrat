# xstockstrat-identity — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (JWT secret env-only not config, SHA-256-hex token storage vs base64url PKCE, untyped-handler house style, `aud`-bound OAuth tokens) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (⚠ unsigned-token revoke) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service for authentication and JWT management. All services validate tokens against this service. Issues short-lived access JWTs and longer-lived refresh tokens, and is the durable OAuth 2.1 state store behind the MCP agent.

## Language

Node.js 24 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

gRPC-only on `50058` (every `IdentityService` method; see `identity.proto`). `ListAdminUserIds` is SAN-gated to
`xstockstrat-notify` (IDENTITY-12).

### OAuth 2.1 backend (feature 049 Part B)

Identity is the durable OAuth state store + token mint behind the MCP agent's stateless OAuth 2.1
HTTP facade. `RegisterOAuthClient` (RFC 7591 DCR, https-only public client) and `GetOAuthClient`
manage `identity.oauth_clients`; `IssueAuthCode`/`ExchangeAuthCode` use `identity.oauth_auth_codes`. The OAuth access token's `aud`-binding
contract is IDENTITY-4 in `docs/context-constitution.md`. The OAuth **refresh token reuses `identity.refresh_tokens`** (rotation
on `RefreshOAuthToken` revokes the presented token and inserts a new one). TTLs reuse
`jwt.access_ttl_seconds` / `jwt.refresh_ttl_seconds` (namespace `identity`).

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config (token TTLs; the JWT secret is env-only, IDENTITY-1) |
| xstockstrat-ledger | gRPC `AppendEvent` (`LEDGER_ENDPOINT`) | Best-effort audit of admin user-management mutations (`src/grpc/ledgerAudit.ts`) |
| PostgreSQL | DB (schema: `identity`) | Users, sessions, OAuth clients + auth codes |

## Database / Migrations

- `000_schema`, `001_identity_tables` (`users`, `api_keys`, `refresh_tokens`), `002_seed_admin`.
  `002_seed_admin` seeds `admin@localhost`/`admin` in every env; production login is refused until it is
  rotated (`isBlockedDefaultAdmin`; `scripts/manage-users.py reset-password`).
- `003_oauth` (feature 049 Part B) — adds `identity.oauth_clients` + `identity.oauth_auth_codes`;
  OAuth refresh tokens reuse `identity.refresh_tokens` (no new table).
- `004_refresh_token_client` (feature 051) — tags `refresh_tokens` with `client_id`/`last_used_at`
  so `ListAuthorizedApps`/`RevokeAuthorizedApp` can list and revoke per-user OAuth grants.
- `005_drop_api_keys` — drops `identity.api_keys`; the API-key RPCs were removed and nothing
  consumes API keys anymore.
- `006_user_metadata` — adds `phone`, `display_name`, `metadata` JSONB (≤ 8 KiB) and
  `metadata_updated_at` to `identity.users` for the profile-metadata RPCs.

See `migrations/*.up.sql` for exact columns/constraints/indexes.

## Config Keys Consumed

Namespace: `identity`

| Key | Type | Default | Description |
|---|---|---|---|
| `jwt.access_ttl_seconds` | int | `900` | Access token TTL (15 min) |
| `jwt.refresh_ttl_seconds` | int | `2592000` | Refresh token TTL (30 days) |

> The JWT signing key's env-only sourcing (never config) is IDENTITY-1 in `docs/context-constitution.md`.

## Observability (feature 294-signal-map-instrumentation)

- No `loop tick ok` (no tick loops).
- Instruments: `identity.login.failures{reason}`, `identity.token.validate_failures{reason missing_token|secret_missing|expired|invalid|other}`, `identity.oauth.exchange_failures{reason}`, `identity.refresh.rejections{kind first_party|oauth}`, `identity.audit.failures{event_type}` and `identity.audit.append.duration` (the six `user.*` audit types, else `other`).
- Load-bearing log: ERROR `ValidateToken: JWT secret missing`, once per process. No token, email or hash is ever logged or labelled.

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root `CLAUDE.md` § Environment Variable Naming Convention.

```text
GRPC_PORT=50058
CONFIG_ENDPOINT=xstockstrat-config:50060
JWT_SECRET=<secret>                    # .env — generate: openssl rand -hex 32
APPLICATION_ENV=development            # .env.local
TRADING_MODE=paper                     # paper | live
DATABASE_CA_CERT=<PEM>                 # required unless sslmode=disable — docs/patterns/database.md; the service needs the DB to boot (SELECT 1 probe)
```

## Operations

User management (`scripts/manage-users.py` create-user / reset-password / list-users) and the deploy-time `JWT_SECRET` wiring (`common.JWT_SECRET` in `secrets/<env>.enc.yaml`, legacy `DEV_JWT_SECRET`/`PROD_JWT_SECRET` fallback → `.do/app*.yaml`) live on-demand in this service's `docs/` folder (**`operations.md`**).
