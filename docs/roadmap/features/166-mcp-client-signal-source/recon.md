# Recon: mcp-client-signal-source

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-ingest, xstockstrat-config, xstockstrat-agent, xstockstrat-ui

---

## Objective

Register an external MCP server as a **server-side** signal source in `xstockstrat-ingest`: store the
MCP endpoint + tool in the source's `config_json`, store the bearer token as an encrypted config
secret, then on a scheduled loop query the MCP tool server-side (bearer header only), parse the
result into `ExternalSignal`s, and ingest them via the existing `IngestSignal` path. This replaces
the agent-mediated fetch model (Claude pulling `mediated_*` sources) with unattended, in-service pull.

## Codebase Map

- **`xstockstrat-ingest`** (Python)
  - Signal-source registry table: `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql`
    (`slug` PK, `display_name`, `source_type` CHECK, `extractor_module`, `credentials_ref`, `active`,
    `config_json` JSONB); health cols in `008_signal_source_health.up.sql`; `reliability_weight` in
    `010_add_signal_source_reliability_weight.up.sql` (trunk tip → next-free migration **011**).
  - `source_type` CHECK last set: `migrations/007_signal_source_type_mediated.up.sql` (5 programmatic +
    5 `mediated_*` + `derived`); `mcp_client` to be added here.
  - Servicer: `services/xstockstrat-ingest/app/handlers/servicer.py` — `ManageSignalSource`/`ListSignalSources`
    (row↔proto ~:1060,1143), `IngestSignal`; `has_credentials` derived from `credentials_ref` (~:1062,1239).
  - Repo: `services/xstockstrat-ingest/app/repositories/signal_sources.py` (upsert/update/list; `credentials_ref` ~:102).
  - Extractor abstraction: `services/xstockstrat-ingest/app/extractors/base.py` (`BaseExtractor` ABC, input
    dataclasses); `app/extractors/noop.py` (all `mediated_*` currently noop). **No outbound HTTP client
    exists in ingest today** (grep httpx/aiohttp/requests → 0 hits) — net-new.
- **`xstockstrat-config`** (Node)
  - Secret pattern reference (consumer side): `services/xstockstrat-marketdata/internal/config/config.go:114`
    (`ResolveSecret`), `:122` (`x-internal-caller`), `:124` (`GetSecret`). `GetSecret` RPC at
    `packages/proto/config/v1/config.proto:35`. ingest does **not** call `GetSecret` today.
- **`xstockstrat-agent`** (Python)
  - Tools: `services/xstockstrat-agent/app/tools.py:897` (`manage_signal_source`), `:219`
    (`list_signal_sources`); `_EXTRACTOR_TOOL_MAP` `:200`; the only Bearer-auth outbound fetch is
    agent-side `_fetch_url` `:1677` (`Authorization: Bearer` `:1685`).
- **`xstockstrat-ui`** (Next.js)
  - config-ui `/sources` page (already in `PLATFORM_SUBNAV`) is where `mcp_client` becomes a selectable type.

## Patterns to REUSE

- Server-side query loop → mirror `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` (paced
  asyncio loop reading config cadence) rather than inventing a scheduler.
- Bearer credential resolution → reuse the marketdata `GetSecret`/`x-internal-caller` pattern
  (`marketdata/internal/config/config.go:114`), not a new secret mechanism; add ingest to the allow-list.
- Signal write → reuse the existing `IngestSignal` path + `signal_dedup_keys` dedup (`ingest.proto:119,125`)
  and reliability-weight/alert-threshold machinery; do not add a parallel ingest path.
- Source extraction → plug a real extractor into the existing `BaseExtractor` ABC (`app/extractors/base.py`),
  not a `noop` fork.
- Masked-update of `credentials_ref` → reuse feature-088 AIP-161 verb semantics (`ingest.proto:180-199`);
  never NULL it on an unrelated update.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-147` "A secret written via SetConfig is persisted encrypted, not plaintext" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — the bearer token must be AES-256-GCM ciphertext, never plaintext.
- **PRESERVE** `@AC-1b @feature-147` "is_secret is row-authoritative on write" (`config-secrets-and-scoping.feature`) — a source-credential write cannot flip a secret key to plaintext.
- **PRESERVE** `@AC-2 @feature-147` "WatchConfig never streams secret plaintext" (`config-secrets-and-scoping.feature`) — bearer token never reaches a WatchConfig subscriber.
- **PRESERVE** `@AC-3 @feature-147` "GetConfig and ListKeys redact secrets at the edge" (`config-secrets-and-scoping.feature`) — config-ui/agent reads stay redacted.
- **EXTEND** `@AC-4 @feature-147` "An allow-listed internal caller resolves a secret via GetSecret" (`config-secrets-and-scoping.feature`) — ingest joins `SECRET_CALLER_ALLOWLIST` alongside marketdata; existing grant unchanged.
- **PRESERVE** `@AC-5 @feature-147` "GetSecret fails closed for a caller not on the allow-list" (`config-secrets-and-scoping.feature`) — the new ingest grant must not weaken the fail-closed default.
- **PRESERVE** `@AC-16 @feature-147` "GetSecret distinguishes an unset secret from a decrypt failure" (`config-secrets-and-scoping.feature`) — ingest boot treats an unset bearer as not-configured, not a crash.
- **PRESERVE** `@AC-1/@AC-2/@AC-3 @feature-127` (ingest_signal watchlist auto-add / non-watchlist no-op / dedup no re-trigger) (`docs/sdd/business-rules/platform.feature`) — MCP-sourced signals flow through the same rules.
- **PRESERVE** `@AC-4 @feature-127` "A portfolio failure never fails the already-committed ingest" (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`) — best-effort side-effect contract holds on the shared path.
- **PRESERVE** `@AC-8 @feature-156` "The MCP tool triggers a scan for an admin and rejects a non-admin" (`services/xstockstrat-agent/acceptance/fix-fundamentals-signal-producer.feature`) — precedent for any admin-gated register/query tool: forward derived scope, backend authorizes, non-admin → PERMISSION_DENIED.
- xstockstrat-ingest → **no existing acceptance suite yet**; the feature's core subjects (source-registration verbs, ExternalSignal parse/ingest, server-side dedup) have no durable C-16 guard — this feature's own `@AC-*` are the regression guard.

## Dependencies

- Proto/RPC: none new. Reuse `config_json` (`ingest.proto:150`), `source_type` string (`:146`),
  `ManageSignalSource`/`ListSignalSources` (`:23-24`, `:192`), `IngestSignal` (`:119`), `GetSecret`
  (`config.proto:35`).
- Migration: ingest **011** — add `mcp_client` to `signal_sources.source_type` CHECK (`.up.sql`/`.down.sql`).
- Config keys: `ingest.mcp_credential.<slug>` (encrypted secret), `ingest.mcp_client.poll_interval_seconds`
  (300), `ingest.mcp_client.request_timeout_seconds` (30).
- Inter-service edges: ingest → config `GetSecret` (new); ingest → external MCP server (new outbound
  Streamable HTTP); ingest self `IngestSignal`.
- New env vars / ports: none new; ingest joins `SECRET_CALLER_ALLOWLIST` (config-side grant).

## Risks / Not-found

- **Not found:** any server-side outbound HTTP/MCP client in ingest, and any `GetSecret` call in ingest —
  both are net-new plumbing.
- **Feature-093 trap:** per-source credential resolution is unimplemented (`extract_website_content`
  raises for `has_credentials=true`). This feature builds resolution for `mcp_client` only; must not
  claim to fix the mediated path.
- **Ledger fail (fundamentals-signal-producer):** config validator must be fail-closed (FR-6); reserve
  migration 011 at spec time against a concurrent claim.
- **Ledger fail (mcp-tools-alignment):** `manage_signal_source`/`list_signal_sources` docstrings +
  `docs/runbooks/mcp-tools.md` must be updated in lockstep with the new type or they drift.
- **DB budget (F-06):** ingest is a PgBouncer-pooled service; the MCP client makes outbound HTTP, not DB
  connections, so no pool impact — confirm no new direct DB pool is added.

## Recommended Scope

Advisory step boundaries: (1) migration 011 CHECK add; (2) config keys + register/validate path
(fail-closed) writing `credentials_ref` + encrypted secret; (3) ingest `GetSecret` resolution +
allow-list grant; (4) server-side MCP client + scheduled loop; (5) response→`ExternalSignal` parser +
`IngestSignal` wiring + health/last_error; (6) agent tool + config-ui `/sources` surface + mcp-tools.md.
