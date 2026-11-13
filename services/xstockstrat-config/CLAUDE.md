# xstockstrat-config — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (DELTA carries the full namespace + wholesale replace, defaults from call-site not DB `default_value`, enum→scope-string maps, pg_notify env+user_id scope requirement) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (cross-key deadline bounds unenforced, `SCALAR_BOUNDS_REGISTRY` guarding unread values, unvalidated `onNotification` env cast, migration `031` overwrite) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service that is the **central configuration authority** for the entire platform. Provides a `WatchConfig` server-streaming RPC that all services subscribe to at startup. Config changes propagate live to all subscribers via the persistent gRPC stream.

## Language

Node.js 24 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Port | Protocol | Usage |
|---|---|---|
| `50060` | gRPC (HTTP/2) | Internal WatchConfig stream + all config reads/writes (`WatchConfig`, `GetConfig`, `ListKeys`, `SetConfig`, and the secret-only `GetSecret` RPC — feature 147) |

This service is **gRPC-only**. config-ui reaches it over gRPC `50060` (`services/xstockstrat-ui/src/lib/connectClients.ts`).

## Critical Invariants

1. **This service does NOT subscribe to itself** — it is the config source.
2. **All other services must call WatchConfig at startup** and block until they receive the initial SNAPSHOT before accepting traffic. They must pass `environment` (and, where a per-user value is needed, an optional `user_id`) in the request.
3. **Config values are scoped** environment × global/per-user (root `CLAUDE.md` § Config Governance Rules); a per-user value overrides the global value on both `GetConfig` and `WatchConfig`. The deprecated `ENVIRONMENT_DEV` maps to the `staging` scope.
4. **Config changes trigger pg_notify** → reloads namespace in memory → broadcasts DELTA to all active WatchConfig subscribers (same env scope; per-user values override the global value for a subscriber that passed a matching `user_id`). The LISTEN client issues `LISTEN` before the boot `reloadAll`, and all notification/reload work runs on one serial chain (reconnect: § WatchConfig Flow).
5. **`SetConfig` is scope-gated (global → admin; per-user → owner-only); reads are not.** The write gate branches on the target's scope (`src/grpc/authz.ts`, feature 074 + PR #994):
   - **Global write** (`user_id` empty): rejected `PERMISSION_DENIED` ("admin scope required") unless the propagated `x-access-scope` carries the ADMIN bit (`0x04`) **or** an internal-caller write is authorized (invariant #7).
   - **Per-user write** (`user_id` set): **self-service** — allowed only when the propagated `x-user-id` **equals** the target `user_id`, otherwise `PERMISSION_DENIED` ("per-user config is self-service…", `PER_USER_SCOPE_ERROR`). An ADMIN bit grants **no** override here: admins reach only globals and their own per-user rows, never another user's (operator decision, PR #994). No admin bit is required for an owner's own per-user write. Secrets **may be per-user** (feature 224, an operator override of feature 147, which allowed global secrets only): an owner may write their own `is_secret` row under the same self-service gate, and it is encrypted exactly like a global secret (the `is_secret` flag falls back to the global row's when no exact-scope row exists).

   Either branch also rejects `INVALID_ARGUMENT` when a write has no propagated identity — no `x-user-id` and no authorized `x-internal-caller`; `request.author` is ignored (feature 241). Identity is propagated, not authenticated. `GetConfig`/`ListKeys`/`WatchConfig` are deliberately **open**: every service boots by subscribing to `WatchConfig` unauthenticated, and its first message is a full namespace snapshot, so gating reads would break platform startup without hiding anything `WatchConfig` doesn't already serve.

   Reads are open but **bound** (feature 263): on `GetConfig`/`ListKeys`, a non-admin caller that propagates `x-user-id` and asks for a different non-empty body `user_id` is read at its own `x-user-id` instead (`boundReadUserId`, `src/grpc/authz.ts`) — bound, not refused. Admins and header-less callers keep the body id; an empty body id stays global. `WatchConfig` and `GetSecret` are **unbound**. A future internal reader must therefore not forward a user's `x-user-id` while asking about another user — send it header-less or admin-scoped.
6. **Secrets are encrypted at rest (feature 147)** per root `CLAUDE.md` § Config Governance Rules (AES-256-GCM `is_secret` rows, redacted at every read edge, plaintext only via `GetSecret`, `is_secret` row-authoritative on write). Service-specific: the service **fails to boot** without `CONFIG_SECRETS_ENCRYPTION_KEY`. `GetSecret` is gated by `SECRET_CALLER_ALLOWLIST` (`src/grpc/authz.ts`): grants are `marketdata` → the four vendor keys (mTLS peer DNS SAN `xstockstrat-marketdata`, feature 254) `ingest` → `keyPrefixes: ['mcp_credential.']` (SAN `xstockstrat-ingest`) and `notify` → the exact key `commsgun.app_key` (SAN `xstockstrat-notify`, feature 338) — `peerSan` on all three, so the header alone never suffices (`hasSecretCallerAuthority`).
7. **`SetConfig` also accepts an internal-caller write, additive to the admin-scope gate** (feature
   102): a background/automated process (e.g. `xstockstrat-trading`'s reconciliation poller) may
   write a normally human-operator-gated key by propagating `x-internal-caller`
   (`HEADER_INTERNAL_CALLER`, `src/grpc/authz.ts`) instead of `x-access-scope`. This is a **structurally separate**
   metadata channel — never an extension of `x-access-scope`'s human-role bitmap — checked against
   a hardcoded `INTERNAL_CALLER_ALLOWLIST` of `{callerID, namespace, key, allowedTargetValues}`
   grants. Fails closed (an absent header, an unlisted `callerID`, or a `targetValue` outside that
   caller's allowed set are all denied) and is **direction-restricted per grant** — e.g.
   `trading-reconciliation-poller` (namespace `platform`, key `trading_state`, matched by exact
   equality) may only write `REDUCE_ONLY`/`HALTED`, never back to `ACTIVE`, so a bug or compromised caller cannot silently clear a
   human-set halt. Every internal-caller write also persists `caller_identity` (the propagated
   `x-internal-caller` value) on both `config.config_values` and `config.config_audit` — `NULL` for
   every ordinary human/admin write — so an investigator can `WHERE`-filter "an automated process
   wrote this" instead of grepping `reason`; with no propagated `x-user-id`, the audit `changed_by` is
   the grant `callerID` (feature 241) (see the Author-sentinel conventions
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
              ├── Registration: the subscriber is registered pending BEFORE its snapshot read; a change
              │     broadcast meanwhile is recorded and sent as a catch-up DELTA right after the SNAPSHOT
              ├── First message: update_type=SNAPSHOT (full config dump)
              └── Subsequent messages: update_type=DELTA (carries the FULL namespace — `changedKeys=Object.keys(values)` — a wholesale replace, not just changed keys)

Config change (via SetConfig RPC)
  └── existence gate (feature 091): unregistered key → NOT_FOUND unless create_key=true
        (scope rules: CONFIG-6)
  └── INSERT/UPDATE config.config_values
        └── pg_notify('config_changed', {namespace, key, environment, user_id})
              └── ConfigServiceImpl receives LISTEN notification
                    └── Reloads namespace from DB
                          └── Broadcasts DELTA to all WatchConfig subscribers

LISTEN connection lost (error/end)
  └── release client with the error → reconnect with backoff (1 s → 30 s cap)
        └── LISTEN before reloadAll → re-broadcast DELTA to every subscribed (namespace, environment)
```

A snapshot or broadcast failure ends that subscriber's call with `INTERNAL` (13), so the client's
reconnect path runs; a client cancel or transport error only unregisters the subscriber.

Known limitations of the LISTEN recovery (feature 258) are logged in this service's `docs/` folder (**`context-constitution-findings.md`**).

## Config Keys Managed

> `SetConfig`, `create_key` and `GetSecret` reject a key that begins with its namespace (`INVALID_ARGUMENT`);
> migration `045` adds the matching DB CHECK.

Seeds live across `migrations/*.up.sql`; the reader↔seed baseline is `scripts/config-wiring.json`.

## Observability (feature 294-signal-map-instrumentation)

- No `loop tick ok`: the `LISTEN` listener is a reconnect loop, not a tick loop.
- Instruments: `config.watch.terminated{reason client_error|server_error}`, `config.listener_up`, `config.listener_reconnects`, `config.last_reload_timestamp`.
- `GetSecret` denial logs carry `reason` (no_caller_header|unknown_caller|key_not_granted|peer_san_mismatch from `secretDenialReason`), a truncated `callerId` and `hadPeerSan`. The gate is still the boolean `hasSecretCallerAuthority`; the reason is log-only. Caller ids are truncated to 64 characters (`LOG_ID_MAX`).
- Load-bearing logs: INFO `GetSecret served` (`found`), ERROR `GetSecret DB error`, WARN `WatchConfig subscriber error`. No secret value is ever logged.

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root `CLAUDE.md` § Environment Variable Naming Convention.

```text
GRPC_PORT=50060
APPLICATION_ENV=development  # development | production — default environment scope for this instance
DATABASE_CA_CERT=<PEM>                 # required unless sslmode=disable — docs/patterns/database.md
CONFIG_SECRETS_ENCRYPTION_KEY=<hex, 32 bytes>  # required (feature 147) — AES-256-GCM master key for secret rows; service FAILS TO BOOT if unset. Same custody as BROKER_ACCOUNTS_ENCRYPTION_KEY
```
