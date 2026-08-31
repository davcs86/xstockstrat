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

- [ ] No proto changes required
- Likely additive (non-breaking), to be confirmed at design/spec time:
  - No new `SignalSource` scalar fields are strictly required — the MCP endpoint/tool can ride in the
    existing `config_json` (`google.protobuf.Struct`, `ingest.proto:143`). **Open question:** promote
    `mcp_endpoint`/`mcp_tool` to typed fields vs. keep them in `config_json`.
  - `mcp_client` is a new `source_type` **string** value (DB CHECK), not a proto enum — no proto enum
    change. Confirm no message requires a new field.

## Config Key Changes

- [ ] No new config keys
- Expected (confirm at design):
  - One **encrypted secret** config row per registered MCP source holding the bearer token
    (`is_secret=true`). Naming to follow `<service>.<category>.<key>`; **open question** whether the
    key is fixed-per-source (e.g. `ingest.mcp_source.<slug>.bearer_token`) or a generic
    `credentials_ref` the operator sets — this is a design fork, not settled here.
  - Possibly an `ingest.mcp_client.*` category for the server-side query loop cadence/timeout
    (mirrors `analysis.fundsignal.*`). Confirm at design.

## Database Changes

- [ ] No schema changes
- Expected: a migration adding `mcp_client` to the `signal_sources.source_type` CHECK constraint
  (current CHECK last set in `007_signal_source_type_mediated.up.sql`). **Migration number must be
  reserved at design time** (ledger fail: fundamentals-signal-producer shared-migration collision).
  No new columns anticipated (endpoint/tool live in existing `config_json`; credential in config, not
  a new column).

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

## Open Questions

- [ ] **Credential home / referencing:** does the bearer token live under a fixed per-source config
  key (`ingest.mcp_source.<slug>.bearer_token`) that the register path creates, or does the operator
  pre-create an encrypted config row and the source's `credentials_ref` names its key? (Behavior #1 —
  surfaced, not guessed.) Note feature 088: `credentials_ref` is a masked-update path — a new write
  must never silently NULL it.
- [ ] **Query trigger:** a scheduled server-side loop in ingest (like `fundsignal_loop.py`) vs.
  on-demand invocation. If scheduled, what config key sets the cadence, and does it respect the
  active/health flags?
- [ ] **Response → signal mapping:** does the external MCP tool have to return a fixed
  xstockstrat-defined shape (documented contract), or is a field-mapping declared in `config_json`?
  A fixed contract is simpler and testable; a mapping is more flexible but is another validation
  surface.
- [ ] **source_type tier:** `mcp_client` is a *programmatic server-side* type with a real extractor
  (not `noop`, unlike today's `mediated_*`). Confirm it plugs into the `BaseExtractor` ABC
  (`app/extractors/base.py`) rather than forking a parallel mechanism.
- [ ] **Known trap (feature 093):** per-source credential resolution is currently unimplemented and
  `extract_website_content` *raises* for `has_credentials=true`. This feature must actually build the
  resolution for `mcp_client`; confirm it does not accidentally unblock the still-broken mediated path.
- [ ] **MCP client library:** which Python MCP client (the same SDK the agent uses, or a lighter
  client) runs inside ingest, and does it fit the service's `uv` dependency / connection-pool budget?
