# xstockstrat-config — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (DELTA carries the full namespace + wholesale replace, defaults from call-site not DB `default_value`, enum→scope-string maps, pg_notify env+mode requirement) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (⚠ camelCase/snake_case trading-mode scoping collapse, audit-on-UPDATE-only) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service that is the **central configuration authority** for the entire platform. Provides a `WatchConfig` server-streaming RPC that all services subscribe to at startup. Config changes propagate live to all subscribers via the persistent gRPC stream. Config values are scoped by **environment** (`production`/`staging`) × **global/per-user** (`user_id`, NULL = global); a per-user value overrides the global one (feature 147). Paper/live is derived from environment (production = live, staging = paper) — the former `trading_mode` axis was removed.

## Language

Node.js 22 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Port | Protocol | Usage |
|---|---|---|
| `50060` | gRPC (HTTP/2) | Internal WatchConfig stream + all config reads/writes (`WatchConfig`, `GetConfig`, `ListKeys`, `SetConfig`, and the secret-only `GetSecret` RPC — feature 147) |

This service is **gRPC-only**. config-ui reaches it over gRPC `50060` (`app/lib/connectClients.ts`).
The former Connect-RPC HTTP server on `8060` (and the `src/connect/` Connect router) was removed.
Because there is no longer a separate HTTP port to gate, the gRPC server simply binds `50060` at
startup; the Docker healthcheck probes `50060` directly.

## Critical Invariants

1. **This service does NOT subscribe to itself** — it is the config source.
2. **All other services must call WatchConfig at startup** and block until they receive the initial SNAPSHOT before accepting traffic. They must pass `environment` (and, where a per-user value is needed, an optional `user_id`) in the request. The `trading_mode` field is deprecated (feature 147, deprecate-don't-delete in proto) and ignored by the server.
3. **Config values are scoped** by two dimensions (feature 147): `environment` (`production`/`staging`) × `global`/per-user (`user_id`, NULL = global). A per-user value overrides the global value on both `GetConfig` and `WatchConfig`. The deprecated `ENVIRONMENT_DEV` maps to the `staging` scope; the removed `trading_mode` axis is no longer read (paper/live is derived from environment). Proto gained `ENVIRONMENT_STAGING` and `user_id` fields on the config request messages.
4. **Config changes trigger pg_notify** → reloads namespace in memory → broadcasts DELTA to all active WatchConfig subscribers (same env scope; per-user values override the global value for a subscriber that passed a matching `user_id`).
5. **`SetConfig` is scope-gated (global → admin; per-user → owner-only); reads are not.** The write gate branches on the target's scope (`src/grpc/authz.ts`, feature 074 + PR #994):
   - **Global write** (`user_id` empty): rejected `PERMISSION_DENIED` ("admin scope required") unless the propagated `x-access-scope` carries the ADMIN bit (`0x04`) **or** an internal-caller write is authorized (invariant #7).
   - **Per-user write** (`user_id` set): **self-service** — allowed only when the propagated `x-user-id` **equals** the target `user_id`, otherwise `PERMISSION_DENIED` ("per-user config is self-service…", `PER_USER_SCOPE_ERROR`). An ADMIN bit grants **no** override here: admins reach only globals and their own per-user rows, never another user's (operator decision, PR #994). No admin bit is required for an owner's own per-user write. Secrets remain **global-only** (a per-user secret write is separately rejected `INVALID_ARGUMENT`).

   Either branch also rejects `INVALID_ARGUMENT` when a write has neither an explicit `author` nor a propagated `x-user-id`. `GetConfig`/`ListKeys`/`WatchConfig` are deliberately **open**: every service boots by subscribing to `WatchConfig` unauthenticated, and its first message is a full namespace snapshot, so gating reads would break platform startup without hiding anything `WatchConfig` doesn't already serve.
6. **Secrets are encrypted at rest (feature 147).** A secret row uses `is_secret = true` and stores AES-256-GCM ciphertext in the `value_encrypted BYTEA` column (master key: the `CONFIG_SECRETS_ENCRYPTION_KEY` env var, hex 32 bytes — the service **fails to boot** without it); `value_data` holds the literal `[redacted]` sentinel, never the plaintext or a `secret://` reference. Plaintext is **redacted at every read/broadcast edge** — `buildConfigValue` returns `[redacted]` for secret rows on `WatchConfig`/`GetConfig`/`ListKeys`. Plaintext is returned **only** by the new **`GetSecret`** RPC, which decrypts server-side and is gated by `SECRET_CALLER_ALLOWLIST` (an `x-internal-caller` allow-list in `src/grpc/authz.ts`, mirroring the feature-102 internal-caller mechanism — a caller may decrypt only the specific keys it is granted; seeded grant: `marketdata` → the four vendor keys). `is_secret` is **row-authoritative on write** — read from the stored row, never trusted from the request — so an admin `SetConfig` update can never land plaintext into a secret key. The `secret.*` name prefix is retired; secret-ness is the `is_secret` flag alone.
7. **`SetConfig` also accepts an internal-caller write, additive to the admin-scope gate** (feature
   102): a background/automated process (e.g. `xstockstrat-trading`'s reconciliation poller) may
   write a normally human-operator-gated key by propagating `x-internal-caller`
   (`HEADER_INTERNAL_CALLER`, `src/grpc/authz.ts`) instead of `x-access-scope`. This is a **structurally separate**
   metadata channel — never an extension of `x-access-scope`'s human-role bitmap — checked against
   a hardcoded `INTERNAL_CALLER_ALLOWLIST` of `{callerID, namespace, key, allowedTargetValues}`
   grants. Fails closed (an absent header, an unlisted `callerID`, or a `targetValue` outside that
   caller's allowed set are all denied) and is **direction-restricted per grant** — e.g.
   `trading-reconciliation-poller` may only write `platform.trading_state` to `REDUCE_ONLY`/
   `HALTED`, never back to `ACTIVE`, so a bug or compromised caller cannot silently clear a
   human-set halt. Every internal-caller write also persists `caller_identity` (the propagated
   `x-internal-caller` value) on both `config.config_values` and `config.config_audit` — `NULL` for
   every ordinary human/admin write — so an investigator can `WHERE`-filter "an automated process
   wrote this" instead of grepping free-text `author`/`reason` (see the Author-sentinel conventions
   table in `docs/patterns/config-governance.md`).

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| TimescaleDB/PostgreSQL | DB (schema: `config`) | Config store + audit log |

## WatchConfig Flow

```text
Service startup
  └── ConfigWatcher.WaitForSnapshot()
        └── gRPC WatchConfig(namespace="<service>") → streams ConfigSnapshot
              ├── First message: update_type=SNAPSHOT (full config dump)
              └── Subsequent messages: update_type=DELTA (carries the FULL namespace — `changedKeys=Object.keys(values)` — a wholesale replace, not just changed keys)

Config change (via SetConfig RPC)
  └── existence gate (feature 091): a write to an unregistered (namespace,key,environment,
        user_id) scope is refused NOT_FOUND unless the request sets create_key=true
  └── INSERT/UPDATE config.config_values
        └── audit trigger fires → config.config_audit row written
              ├── UPDATE: config_value_audit (BEFORE UPDATE, on a value change) — old→new
              └── CREATE: config_value_audit_insert (AFTER INSERT, migration 010, feature 091)
                    — one row with author + value, old_value NULL
        └── pg_notify('config_changed', {namespace, key, environment, trading_mode})
              └── ConfigServiceImpl receives LISTEN notification
                    └── Reloads namespace from DB
                          └── Broadcasts DELTA to all WatchConfig subscribers
```

## Config Keys Managed

See `migrations/001_config_tables.up.sql` for the canonical seed list and full platform config schema.

## Webhooks

_No webhooks. Mutate config via the `SetConfig` gRPC RPC on port 50060 — which requires the ADMIN scope bit and an attributable author (see Critical Invariants #5)._

## Config Governance

All config changes must comply with the governance rules in the root `CLAUDE.md`. Key rules:

- New keys require PR to `packages/proto/` (for type documentation)
- Sensitive keys (`is_secret=true`) are stored as AES-256-GCM ciphertext in `value_encrypted` (never plaintext), redacted at every read edge, and readable only via `GetSecret` under the `SECRET_CALLER_ALLOWLIST` (feature 147)
- All changes are written to `config.config_audit` automatically

## Environment Variables

```text
GRPC_PORT=50060
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development  # development | production — default environment scope for this instance
CONFIG_SECRETS_ENCRYPTION_KEY=<hex, 32 bytes>  # required (feature 147) — AES-256-GCM master key for secret rows; service FAILS TO BOOT if unset. Same custody as BROKER_ACCOUNTS_ENCRYPTION_KEY
# TRADING_MODE is no longer used for config scope (feature 147 removed the trading_mode axis; paper/live is derived from environment)
```

## Running Locally

```bash
pnpm install
# schema: run ../../scripts/db-migrate.sh from repo root (golang-migrate, not node-pg-migrate)
pnpm run dev
```
