# Recon: mcp-client-signal-source

**Created**: 2026-08-31 (refreshed 2026-08-31 — /sdd-design Phase 0, extended with direct verification)
**From**: product-spec.md
**Affected services**: xstockstrat-ingest, xstockstrat-config, xstockstrat-agent, xstockstrat-ui

---

## Objective

Register an external MCP server as a **server-side** signal source in `xstockstrat-ingest`: store the
MCP endpoint + tool in the source's `config_json`, store the bearer token as an encrypted config
secret, then on a scheduled loop query the MCP tool server-side (bearer header only), parse the
result into `ExternalSignal`s, and ingest them via the existing `IngestSignal` path. This adds an
unattended, in-service pull model alongside the agent-mediated fetch (Claude pulling `mediated_*`).

## Codebase Map

- **`xstockstrat-ingest`** (Python 3.13; `requires-python>=3.12`)
  - Registry table: `migrations/002_add_signal_sources_registry.up.sql` (`slug` PK, `display_name`,
    `source_type` CHECK, `extractor_module`, `credentials_ref`, `active`, `config_json` JSONB);
    health cols `008_signal_source_health.up.sql`; `reliability_weight` `010_...up.sql`.
    **Trunk tip = `010` → next-free migration `011`** (verified: `migrations/` ls, last is `010`).
  - `source_type` CHECK last set `migrations/007_signal_source_type_mediated.up.sql:8-15` — the CHECK
    carries **all 11** current values (5 programmatic + 5 `mediated_*` + `derived`). Migration 011
    must `DROP` + re-`ADD` the CHECK re-listing **all 11 plus `mcp_client`** (12) — NOT an append.
  - Servicer `app/handlers/servicer.py`: `ManageSignalSource` (`:1088`), register branch (`:1113-1148`),
    update/AIP-161 merge (`:1149-1224`), `ListSignalSources` row→proto (`:1044-1072`).
    `has_credentials = (credentials_ref is not None)` (`:1062`, `:1239`).
    `_validate_source_write` (`:1074-1086`), `_SS_CREDENTIAL_REQUIRED_TYPES = {"authenticated_website",
    "mediated_authenticated_website"}` (`:54-56`).
    **The register path stores `request.credentials_ref` on the row only — it does NOT write any config
    secret and never calls config `SetConfig`** (`:1123`, `:1144`).
  - Validator `app/repositories/signal_sources.py:186-230` `validate_config_json` — **already
    fail-closed** (feature 062): the trailing `else` (`:224-228`) rejects any non-allow-listed
    `source_type` with `f"unsupported source_type {source_type!r}"`. Per-type required-field checks use
    the "requires non-empty `<field>`" shape (e.g. `simple_website` requires `url` `:214`).
  - Health writers (REUSE): `mark_source_fed` (`:60-68`, success → bump last_seen+signals_fed, clear
    last_error), `mark_source_error` (`:71-77`, failure → set last_error), `derive_health_status`
    (`:13-24`, `last_error` present → `down`). `IngestSignal`'s own path already calls `mark_source_fed`.
  - Extractor ABC `app/extractors/base.py:51-55` (`BaseExtractor.extract(raw: RawInput) -> list[dict]`);
    `RawInput` union `:42-48` is the 5 programmatic input dataclasses; `app/extractors/noop.py` (all
    `mediated_*` currently noop). **No server-side outbound HTTP client and no MCP client in ingest**
    (grep httpx/aiohttp/requests/mcp/streamablehttp → 0 runtime hits; `httpx` is dev-only).
  - Config client `app/config/watcher.py` (Python WatchConfig watcher). **ingest has NO `GetSecret`/
    `ResolveSecret` today** (grep → 0 hits) and NO scheduled background loop (the `noop` extractors are
    never driven server-side).
- **`xstockstrat-config`** (Node) — secret machinery already built (feature 147).
  - `GetSecret` RPC `packages/proto/config/v1/config.proto:35`; `GetSecretRequest{namespace,key,
    environment}` (`:110-114`), `GetSecretResponse{value,found}` (`:116-119`, `found=false` = unset).
  - `SetConfig` write path `config.proto:26,121-136` — `ConfigValue.is_secret` (`:68`), `create_key`
    (`:129-132`, mint a new key), `user_id` (secrets are global-scope only). Redaction at every read
    edge is feature-147 behavior (WatchConfig/GetConfig/ListKeys).
  - Consumer reference: `xstockstrat-marketdata/internal/config/config.go:110-133` —
    `InternalCallerID="marketdata"`, `ResolveSecret(ctx,key)` sets `x-internal-caller` and returns
    `(value, found, err)`. ingest must be added to the config `SECRET_CALLER_ALLOWLIST` grant.
- **`xstockstrat-agent`** (Python) — depends on **`mcp>=2.0.0,<3`** (`pyproject.toml:6`), imported as
  `from mcp.server.mcpserver import Context, MCPServer` (`tools.py:46`) — a **non-standard module path**
  (not the reference SDK's `mcp.server.fastmcp`), so this pin's **client**-side API is unverified.
  - Tools: `manage_signal_source` (`tools.py:897`), `list_signal_sources` (`:219`; injects
    `extractor_tool` from `_EXTRACTOR_TOOL_MAP` `:203,243`), `set_config` (`:1223`). Both a
    secret-write tool and the source-register tool already exist agent-side.
- **`xstockstrat-ui`** (Next.js) — config-ui `/sources` page **already exists** (this feature exposes a
  new type on it, not a new page). NOTE: config-ui nav lives in `NAV_GROUPS`
  (`src/components/shared/navGroups.tsx`), **not** the legacy/inert `PLATFORM_SUBNAV` (fails.md
  2026-08-26, feature 156) — but since no new page/route is added, C-10(a) nav registration is N/A here.

## Patterns to REUSE

- Scheduled server-side loop → mirror `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`
  (paced asyncio background task, config-driven cadence, `DurableSchedule`) — do not invent a scheduler.
- Bearer secret resolution → reuse the marketdata `GetSecret`/`x-internal-caller` pattern
  (`config.go:110-133`); ingest joins the config `SECRET_CALLER_ALLOWLIST` (`x-internal-caller: ingest`).
- Encrypted-secret **write** → reuse config `SetConfig` with `is_secret=true` + `create_key=true` via
  the **existing agent `set_config` tool** (`tools.py:1223`) and the config-ui SetConfig BFF path — no
  new ingest→config write edge.
- Source register → reuse `ManageSignalSource` + `credentials_ref` (`servicer.py:1113-1148`,
  masked-update `:1188-1194`) unchanged; the token never rides the proto — only its key ref does.
- Fail-closed config validation → reuse the per-type "requires non-empty `<field>`" shape in
  `validate_config_json` (`:214`) — add an `mcp_client` `elif` requiring `mcp_endpoint`/`mcp_tool`.
- Credential-required gate → add `mcp_client` to `_SS_CREDENTIAL_REQUIRED_TYPES` (`servicer.py:54`).
- Signal write + dedup → reuse `IngestSignal` + `signal_dedup_keys` (`PRIMARY KEY(source,symbol,
  direction)`) + reliability-weight/alert-threshold machinery; no parallel ingest path.
- Health on read/write → reuse `mark_source_fed`/`mark_source_error`/`derive_health_status`; no new cols.
- `ExternalSignal` shape → `ingest.proto:106-117` (source/symbol/direction/conviction 0–1/
  valid_from/until/headline/raw_url/tags; `ingested_at` server-set).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-147` "secret written via SetConfig persisted encrypted, not plaintext"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — bearer = AES-256-GCM.
- **PRESERVE** `@AC-1b @feature-147` "is_secret is row-authoritative on write" — a credential write
  cannot flip a key to plaintext.
- **PRESERVE** `@AC-2 @feature-147` "WatchConfig never streams secret plaintext".
- **PRESERVE** `@AC-3 @feature-147` "GetConfig and ListKeys redact secrets at the edge" — config-ui/agent
  reads stay redacted; the bearer never appears in `list_signal_sources` (`has_credentials` only).
- **EXTEND** `@AC-4 @feature-147` "an allow-listed internal caller resolves a secret via GetSecret" —
  ingest joins `SECRET_CALLER_ALLOWLIST` alongside marketdata; existing grant unchanged.
- **PRESERVE** `@AC-5 @feature-147` "GetSecret fails closed for a caller not on the allow-list" — the new
  ingest grant must not weaken the fail-closed default.
- **PRESERVE** `@AC-16 @feature-147` "GetSecret distinguishes an unset secret from a decrypt failure" —
  `found=false` (unset bearer) → loop treats source as not-configured (degraded), not a crash.
- **PRESERVE** `@AC-1/2/3 @feature-127` (ingest_signal watchlist auto-add / non-watchlist no-op / dedup
  no re-trigger) (`docs/sdd/business-rules/platform.feature`) — MCP-sourced signals ride the same rules.
- **PRESERVE** `@AC-4 @feature-127` "a portfolio failure never fails the already-committed ingest"
  (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`) — best-effort holds.
- **PRESERVE** `@AC-8 @feature-156` "the MCP tool triggers a scan for an admin and rejects a non-admin"
  (`services/xstockstrat-agent/acceptance/fix-fundamentals-signal-producer.feature`) — precedent:
  `ManageSignalSource` is admin-gated (`_has_admin_scope`), non-admin → PERMISSION_DENIED.
- xstockstrat-ingest → **no existing acceptance suite yet**; source-registration verbs, ExternalSignal
  parse/ingest, and server-side dedup have no durable C-16 guard — this feature's own `@AC-*` are it.

## Dependencies

- Proto/RPC: **none new** (confirmed). Reuse `config_json` (`ingest.proto:150`, `google.protobuf.Struct`),
  `source_type` **string** (`:146` — plain string, not an enum), `ManageSignalSource`/`ListSignalSources`
  (`:171-204`), `IngestSignal` (`:119`), `GetSecret` (`config.proto:35`), `SetConfig` (`config.proto:26`).
- Migration: ingest **011** — add `mcp_client` to `signal_sources.source_type` CHECK (`.up.sql`/`.down.sql`;
  `.up` re-lists all 12, `.down` restores the 007 CHECK of 11). Re-derive next-free from the merged tree
  at spec time (fails.md fundamentals-signal-producer / 081 shared-migration collision).
- Config keys (3-segment, C-05): `ingest.mcp_credential.<slug>` (encrypted secret `is_secret=true`),
  `ingest.mcp_client.poll_interval_seconds` (300), `ingest.mcp_client.request_timeout_seconds` (30).
- Inter-service edges: **ingest → config `GetSecret`** (new; `x-internal-caller: ingest`); **ingest →
  external MCP server** (new outbound Streamable HTTP); secret **write** goes agent-`set_config`/config-ui
  → config `SetConfig` (existing edge, no new ingest→config write); ingest self `IngestSignal`.
- New deps/env: add `mcp` (client) to ingest `pyproject.toml` → `uv lock` (root uv-lock rule). No new
  env vars/ports; ingest joins config `SECRET_CALLER_ALLOWLIST` (config-side grant).

## Risks / Not-found

- **Not found:** any server-side outbound HTTP/MCP client in ingest; any `GetSecret` call in ingest; any
  background extraction loop in ingest — all net-new plumbing.
- **MCP SDK API unverified (fails.md 2026-08-05 / feature 009 `agent-mcp-server`):** the agent's `mcp>=2.0.0,
  <3` uses non-reference module paths (`mcp.server.mcpserver`), so the reference SDK's client entry
  (`mcp.client.streamable_http.streamablehttp_client(url, headers=...)` + `ClientSession.call_tool`) may
  NOT match this pin. The exact client API + custom-header injection for `Authorization: Bearer` MUST be
  verified against the installed package at `/sdd-spec`, not assumed. Confirm the pin exposes a client at all.
- **Two-write non-atomicity (design fork below):** the secret write (config `SetConfig`) and the source
  register (`ManageSignalSource`) are two RPCs. Write order and orphan/dangling handling is an open risk.
- **Validator↔CHECK lockstep (fails.md 2026-08-05 `signal-source-registry`):** `mcp_client` must land in
  BOTH migration 011's CHECK AND `validate_config_json` in the same PR; a CHECK-only add leaves the type
  fail-closed-rejected by the validator; a validator-only add leaves it CHECK-rejected at INSERT.
- **Fail-open validator trap (fails.md 2026-08-06 `fundamentals-signal-producer`):** the new `mcp_client`
  branch must reject a missing `mcp_endpoint`/`mcp_tool` (FR-6/@AC-6), never default it. The existing
  validator is fail-closed at the type level; the per-field checks inside the new branch must be too.
- **Feature-093 mediated-credential trap:** per-source credential resolution is unbuilt for `mediated_*`
  (`extract_website_content` raises for `has_credentials=true`). This feature builds resolution for
  `mcp_client` ONLY; it must not claim to fix or touch the mediated path (Out of Scope).
- **mcp-tools parity (fails.md 2026-08-02 `mcp-tools-alignment`, F-12):** `manage_signal_source`/
  `list_signal_sources` docstrings + `docs/runbooks/mcp-tools.md` must gain the new type in-PR or they drift.
- **DB budget (F-06):** ingest is PgBouncer-pooled; the MCP client is outbound HTTP, not a DB connection —
  confirm no new direct DB pool is added by the loop.
- **`config_json` is a read-edge:** `ListSignalSources` returns `config_json` verbatim (`servicer.py:1063`),
  so the bearer token must NEVER be placed in `config_json` (only `mcp_endpoint`/`mcp_tool`/`mcp_arguments`).

## Recommended Scope

Advisory step boundaries: (1) migration 011 CHECK add (re-list all 12); (2) `validate_config_json`
`mcp_client` branch (fail-closed on `mcp_endpoint`/`mcp_tool`) + `_SS_CREDENTIAL_REQUIRED_TYPES` add +
config-key defaults; (3) ingest config-watcher `GetSecret` resolution + `SECRET_CALLER_ALLOWLIST` grant;
(4) server-side MCP client (SDK-API-verified) + scheduled loop reading cadence config, active-only;
(5) response→`ExternalSignal` parser + `IngestSignal` wiring + `mark_source_fed`/`mark_source_error`
health; (6) agent `manage_signal_source`/`list_signal_sources` + `set_config` orchestration + config-ui
`/sources` two-write registration + `docs/runbooks/mcp-tools.md`.
