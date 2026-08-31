# Product Spec: mcp-client-signal-source

**Created**: 2026-08-31

---

## Problem Statement

The platform can register signal sources, but the only sources that actually fetch external content
are the `mediated_*` types, which are pulled **by the Claude agent** at scan time — there is no way
to have the platform itself, unattended, pull signals from an external service on a schedule. A
growing class of upstream providers now expose their data as **MCP servers** (an MCP endpoint + a
bearer token + a tool to call). Operators want to register such an MCP server once and have
`xstockstrat-ingest` query it server-side, parse the response, and ingest the resulting signals with
no human/agent in the loop.

## User Story

As a platform operator, I want to register an external MCP server as a server-side signal source
(endpoint + bearer token + which tool to query), so that `xstockstrat-ingest` pulls and ingests
its signals automatically without the fetch being mediated by the Claude agent.

## Functional Requirements

FR-1. A new signal-source `source_type` — `mcp_client` — can be registered through the existing
`ManageSignalSource` RPC / `manage_signal_source` MCP tool, carrying an MCP endpoint URL and the name
of the MCP tool to query in `config_json` (e.g. `{"mcp_endpoint": "...", "mcp_tool": "get_signals",
"mcp_arguments": {...}}`).

FR-2. The MCP bearer token is treated as a **secret**: it is stored as an encrypted config row
(`is_secret=true`, AES-256-GCM, per feature 147), never on the `signal_sources` row in plaintext and
never returned on any read edge. The source row references it (via `credentials_ref` / a config key),
and `xstockstrat-ingest` resolves the plaintext **only** at query time via the `GetSecret` RPC using
the `x-internal-caller` allow-list — the same pattern `xstockstrat-marketdata` uses for vendor keys.

FR-3. `xstockstrat-ingest` performs the outbound MCP call server-side over MCP Streamable HTTP,
sending only an `Authorization: Bearer <token>` header (no other auth scheme), calls the configured
tool, and receives its structured result.

FR-4. A parsing mechanism maps the MCP tool result into zero or more `ExternalSignal`s
(`symbol`, `direction`, `conviction` 0–1, `headline`, `valid_from`/`valid_until`, `raw_url`, `tags`)
and ingests each via the existing `IngestSignal` path (so dedup on `(source, symbol, direction)` and
the reliability-weight/alert-threshold machinery all apply unchanged).

FR-5. A malformed or unreachable MCP response (bad token → 401, endpoint down, unparseable payload)
does **not** crash the ingest service: the source's health/`last_error` columns
(migration `008_signal_source_health`) are updated and the cycle continues, consistent with how other
sources record health.

FR-6. Registration input is validated **fail-closed**: a `mcp_client` source missing a valid
`mcp_endpoint` (or `mcp_tool`) is rejected at write with `INVALID_ARGUMENT`; an unrecognized/omitted
required config field is rejected, not silently defaulted (ledger fail: fundamentals-signal-producer
config validator fail-open).

## Out of Scope

- Non-bearer MCP auth (OAuth flows, mTLS, API-key query params) — bearer header only, by explicit
  request.
- Registering xstockstrat **as** an MCP server for others (that already exists — `xstockstrat-agent`);
  this feature is xstockstrat **consuming** an external MCP server.
- Building a general per-source credential-resolution framework for the other `mediated_*` /
  programmatic types (feature 093 left that unbuilt). This feature builds credential resolution only
  for the `mcp_client` path; generalizing it is a possible follow-up.
- A bespoke UI editor for the MCP mapping beyond exposing the new type on the existing config-ui
  `/sources` page.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ingest` — Python; owns the `signal_sources` registry and the ingest path; gains the
  server-side MCP client + parser + `GetSecret` credential resolution (net-new outbound HTTP here).
- `xstockstrat-config` — reused: stores the encrypted bearer secret; `GetSecret` decrypts for the
  allow-listed internal caller. `xstockstrat-ingest` must be added to the `GetSecret` `x-internal-caller`
  allow-list if not already present.
- `xstockstrat-agent` — `manage_signal_source`/`list_signal_sources` MCP tools must accept the new
  `mcp_client` type and its `config_json` fields; `docs/runbooks/mcp-tools.md` kept in parity.
- `xstockstrat-ui` — `/config-ui` `/sources` page: the new source type appears as a registerable option.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/config-ui` `/sources` page: `mcp_client` becomes a selectable
  source type with fields for MCP endpoint, tool name, and the (secret) bearer token. Reachable per
  C-10 (the `/sources` page is already registered in `PLATFORM_SUBNAV`).
- [x] **Agent** — `xstockstrat-agent` MCP tools `manage_signal_source` (register/update an
  `mcp_client` source) and `list_signal_sources` (surface the new type + `has_credentials`).
- [ ] **None**

Signals produced by the source flow into every existing signal-consuming surface (alerts,
opportunities, backtests) unchanged — no new surface needed for the signals themselves.

## Proto Contract Changes

- [x] **No proto changes required.** Decided: the MCP endpoint and tool name ride in the existing
  `config_json` field (`google.protobuf.Struct`, `packages/proto/ingest/v1/ingest.proto:150`) —
  they are not promoted to typed `SignalSource` scalar fields (keeps the change non-breaking and
  avoids a proto churn for what is source-specific config). `mcp_client` is a new `source_type`
  **string** value governed by the DB CHECK constraint (`source_type` is a plain `string` at
  `ingest.proto:146`, not a proto enum), so no proto message or enum changes. `/sdd-spec` re-confirms
  no message needs a new field.

## Config Key Changes

New keys (all `<service>.<category>.<key>`, 3-segment — C-05):
- `ingest.mcp_credential.<slug>` — the **encrypted bearer secret** for the source with that slug
  (`is_secret=true`, AES-256-GCM per feature 147). Decided: the register path writes the token here
  and sets the source row's `credentials_ref` to this exact key (respecting feature 088's masked-update
  of `credentials_ref` — never silently NULLed). `<slug>` is the `signal_sources.slug`, so the key is
  three dot-segments (`ingest` / `mcp_credential` / `<slug>`), unlike the rejected four-segment
  `ingest.mcp_source.<slug>.bearer_token`.
- `ingest.mcp_client.poll_interval_seconds` — cadence of the server-side query loop (default `300`).
- `ingest.mcp_client.request_timeout_seconds` — per-call outbound MCP timeout (default `30`).

Also required (not a config *key*, but a config-service grant): `xstockstrat-ingest` is added to the
`GetSecret` `x-internal-caller` allow-list (`SECRET_CALLER_ALLOWLIST`) alongside `xstockstrat-marketdata`,
so it can resolve `ingest.mcp_credential.<slug>` (preserves feature-147 `@AC-4`/`@AC-5` fail-closed
default for every other caller).

## Database Changes

- One migration on `xstockstrat-ingest` adding `mcp_client` to the `signal_sources.source_type` CHECK
  constraint (current CHECK last set in `007_signal_source_type_mediated.up.sql`). Shipped as a
  numbered **`.up.sql` + `.down.sql` pair** per repo convention (C-07); the `.down.sql` restores the
  prior CHECK. Next-free number is **`011`** (trunk tip is `010_add_signal_source_reliability_weight`;
  overlap scan confirms `011` unclaimed) — `/sdd-spec` re-derives it from the merged tree at spec time
  (ledger fail: fundamentals-signal-producer shared-migration collision). No new columns: endpoint/tool
  live in the existing `config_json`; the credential lives in config, not a new column.

## Feature Workflow Notes

Branch to create: `feature/mcp-client-signal-source` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — `xstockstrat-ingest` owner
- [ ] 2 service owners + platform lead (breaking proto change) — only if a breaking proto change is chosen
- [x] DBA review + service owner (schema migration) — for the `source_type` CHECK addition
- [x] Security review — bearer credential handling (encrypted config + `GetSecret`)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Resolved Design Decisions

Product-level forks are decided below (no unresolved blocking questions remain — criterion 9).
`/sdd-design` validates the implementation specifics noted, but the product shape is committed.

- [x] **Credential home / referencing:** the register path writes the bearer token to encrypted config
  key `ingest.mcp_credential.<slug>` (`is_secret=true`) and sets the source row's `credentials_ref` to
  that key; `xstockstrat-ingest` resolves plaintext only at query time via `GetSecret`
  (`x-internal-caller`). Never a per-source plaintext column; never silently NULLs `credentials_ref`
  (feature 088 masked-update path).
- [x] **Query trigger:** a scheduled server-side loop in ingest (mirrors the `fundsignal_loop.py`
  pattern), cadence from `ingest.mcp_client.poll_interval_seconds` (default 300), per-call timeout from
  `ingest.mcp_client.request_timeout_seconds` (default 30). The loop only queries `active=true` sources
  and records health/`last_error` on failure. (Design confirms loop placement + lifecycle wiring.)
- [x] **Response → signal mapping:** the external MCP tool must return a **fixed, documented
  xstockstrat contract** — a list of signal objects with keys `symbol`, `direction`
  (`buy`/`sell`/`hold`/`watchlist`), `conviction` (0–1), and optional `headline`/`valid_from`/
  `valid_until`/`raw_url`/`tags`. No per-source field-mapping in `config_json` (rejected: extra
  validation surface for little gain). Malformed items are skipped and counted, not fatal (FR-5).
- [x] **source_type tier:** `mcp_client` is a *programmatic server-side* type with a **real extractor**
  that plugs into the existing `BaseExtractor` ABC (`services/xstockstrat-ingest/app/extractors/base.py`),
  not a `noop` and not a parallel mechanism. (Design confirms the exact extractor signature/input
  dataclass.)
- [x] **Known trap (feature 093) — acknowledged:** per-source credential resolution is unimplemented
  today (`extract_website_content` raises for `has_credentials=true`). This feature builds resolution
  **only** for the `mcp_client` path via `GetSecret`; it does not touch or unblock the still-broken
  mediated path (that generalization is explicitly Out of Scope).
- [x] **MCP client library:** ingest uses the official Python MCP SDK client over **Streamable HTTP**
  (the same SDK family `xstockstrat-agent` already depends on), issuing outbound-only calls (no DB pool
  impact). `/sdd-spec` pins the exact package/version and runs `uv lock` for the ingest service per the
  root uv-lock rule.
