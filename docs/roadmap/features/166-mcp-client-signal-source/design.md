# Design: mcp-client-signal-source

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: approved — with two operator-confirm items surfaced below)
**Approved by**: /sdd-design (isolated subagent; see Process Note) @ 2026-08-31
**Grounded in**: recon.md

> **Process Note (fails.md 2026-08-08, features 121–123).** This `/sdd-design` ran inside an isolated
> subagent without live `AskUserQuestion`/`Task` access, so the proposer↔adversary rounds and the
> Phase-1 gate were self-run and self-synthesized (P-01/P-02 mediated within one agent). No Floor
> breach was found, so approval is not blocked — but the two genuine forks that a live human gate
> would own (§Open Risks: **the MCP client implementation pick** and **bearer-required stance**) are
> surfaced to the operator in the run report and MUST be confirmed before `/sdd-execute`, not treated
> as settled by this self-run debate.

---

## Chosen Approach

A new **`mcp_client`** server-side signal `source_type` in `xstockstrat-ingest`. No proto change:
`source_type` is a plain string (`ingest.proto:146`), the MCP endpoint/tool ride the existing
`config_json` `google.protobuf.Struct` (`ingest.proto:150`), `credentials_ref` is already a
`ManageSignalSource` request field (`ingest.proto:194`), and both `GetSecret` (`config.proto:35`)
and `SetConfig` (`config.proto:26`) already exist. Confirmed: **no message or enum needs a new field.**

**Registration (write) — a two-RPC orchestration owned by the consumer surface, secret-first:**
1. The consumer writes the bearer token to encrypted config key **`ingest.mcp_credential.<slug>`**
   via config `SetConfig` with `is_secret=true` + `create_key=true` — reusing the **existing** agent
   `set_config` tool (`tools.py:1223`) and the config-ui SetConfig BFF. The token is AES-256-GCM at
   rest and redacted at every config read edge (feature 147). It is written **only** here — never into
   `config_json` (which `ListSignalSources` returns verbatim, `servicer.py:1063`) and never onto any
   ingest column.
2. The consumer then calls `ManageSignalSource` REGISTER with `source_type="mcp_client"`,
   `config_json={mcp_endpoint, mcp_tool, mcp_arguments?}`, and `credentials_ref="ingest.mcp_credential.<slug>"`.
   Ingest stores the ref only (`servicer.py:1113-1148`, unchanged). `has_credentials` derives from the
   ref (`:1062`). Register stays admin-gated (`_has_admin_scope`).

**Fail-closed validation (FR-6/@AC-6):** add an `mcp_client` `elif` to `validate_config_json`
(`signal_sources.py:186-230`) mirroring the `simple_website` "requires non-empty `<field>`" shape
(`:214`): a missing/empty `mcp_endpoint` returns `INVALID_ARGUMENT` naming the field; likewise
`mcp_tool`. Add `mcp_client` to `_SS_CREDENTIAL_REQUIRED_TYPES` (`servicer.py:54`) so a register
without a `credentials_ref` is rejected. Migration **011** `DROP`s + re-`ADD`s the
`source_type` CHECK **re-listing all 12 values** (the 11 from `007` + `mcp_client`) — never an append
(fails.md `signal-source-registry`); `.down.sql` restores the `007` CHECK. The validator branch and
the CHECK land in the **same PR** (a CHECK-only add leaves the type validator-rejected; a
validator-only add leaves it CHECK-rejected at INSERT).

**Query (pull) — a net-new scheduled loop mirroring `analysis/app/engine/fundsignal_loop.py`:**
a background asyncio task started at ingest boot, cadence from `ingest.mcp_client.poll_interval_seconds`
(default 300) and per-call timeout from `ingest.mcp_client.request_timeout_seconds` (default 30), read
from the ingest config watcher (F-07 — no hardcoding). Each cycle lists **active** `mcp_client` sources
and, per source:
- resolves the bearer via config `GetSecret` (`x-internal-caller: ingest`; namespace `ingest`, key
  `mcp_credential.<slug>` — the `credentials_ref` with its namespace segment stripped, mirroring
  marketdata `ResolveSecret`, `config.go:120-133`). `found=false` (unset bearer, @AC-16) → record via
  `mark_source_error` and skip (health→DOWN), do not crash.
- makes the outbound **MCP Streamable HTTP** call — JSON-RPC `initialize` → `tools/call` for the
  configured `mcp_tool` with `mcp_arguments` — sending **only** `Authorization: Bearer <token>` (no
  other auth), under the per-call timeout. The outbound call sits behind a small injectable client
  seam (`McpClientProtocol`) so the parser, the GetSecret path (@AC-3), and the failure path (@AC-5)
  are unit-testable against a fake (fixtures in ingest `tests/conftest.py`, C-13).
- maps the tool result — a **fixed xstockstrat contract**: a list of objects
  `{symbol, direction, conviction, headline?, valid_from?, valid_until?, raw_url?, tags?}` — into
  `ExternalSignal`s (`ingest.proto:106-117`) through a **real extractor** plugged into `BaseExtractor`
  (`extractors/base.py:51-55`) with a new `McpClientInput` dataclass wrapping the **already-fetched**
  result. The extractor is pure (no network, no secrets) — the credential-bearing fetch lives in the
  loop, not the extractor. Malformed items are skipped and counted, not fatal.
- ingests each via `IngestSignal` (dedup on `(source,symbol,direction)`, reliability-weight and
  alert-threshold machinery apply unchanged; `mark_source_fed` clears `last_error` on success).
- wraps the whole per-source body so any exception (401, timeout, unparseable payload) →
  `mark_source_error(slug, str(e))` (`signal_sources.py:71-77`) → `derive_health_status` yields DOWN on
  the next read (@AC-5); the loop continues to the next source and the service stays up.

**Consumer surfaces (C-14):** (a) agent `manage_signal_source` gains a `bearer_token` argument and
orchestrates the two writes (set_config then register); `list_signal_sources` already surfaces
`source_type` + `has_credentials`, so `mcp_client` appears with `has_credentials=true` and no token
(@AC-1/@AC-2). (b) config-ui `/sources` (page already exists — no new nav) gains `mcp_client` as a
selectable type with endpoint/tool/secret fields, performing the same secret-first two-write via its
BFF. (c) `docs/runbooks/mcp-tools.md` + the tool docstrings gain the new type **in the same PR**
(fails.md `mcp-tools-alignment`, F-12). ingest joins the config `SECRET_CALLER_ALLOWLIST` grant.

**Dependency:** add the MCP client dependency to ingest `pyproject.toml` → `uv lock` (root uv-lock rule).

## Rejected Alternatives

- **Store the bearer on a new `signal_sources` DB column** — rejected: violates feature-147 secret-at-rest
  + redaction (@AC-1/2/3) and repeats the migration-009 / feature-076 plaintext-in-a-broadcast-table trap.
  The encrypted config secret is the sanctioned home.
- **Pass the token through `config_json` to ingest, let ingest write the secret** — rejected: `config_json`
  is a verbatim read edge (`ListSignalSources`), so the plaintext would leak; and it would force a
  net-new ingest→config `SetConfig` write edge for no gain. The token goes straight to config as a secret.
- **Add a typed `mcp_endpoint`/`mcp_tool` scalar or a `bearer_token` field to the proto** — rejected:
  breaks the "no proto change" decision, adds proto churn for source-specific config, and a proto
  `bearer_token` field would be a plaintext secret on the wire/logs. `config_json` + config-secret suffices.
- **Agent-mediated pull (reuse the `mediated_*` model)** — rejected: the feature's whole purpose is
  unattended in-service pull with no agent in the loop (problem statement); mediated is the status quo
  being complemented, not replaced.
- **Per-source field-mapping DSL in `config_json`** — rejected (product spec + adversary agree): a fixed
  xstockstrat response contract avoids a speculative validation/mapping surface (behavior 2 / overbuild).
- **A thin `httpx` JSON-RPC MCP client instead of the SDK** — held as the **fallback**, not the default:
  simpler and free of the non-standard-SDK uncertainty, but re-implements MCP framing (initialize
  handshake, session-id header, SSE/JSON response parsing) that is brittle to MCP-spec drift. Prefer the
  `mcp` package's Streamable-HTTP client **if** the installed `mcp>=2.0.0,<3` exposes a usable one with
  custom-header support; fall back to httpx only if it does not (decided at /sdd-spec — see Open Risks).
- **A compensating-transaction / saga to clean up an orphaned secret on register failure** — rejected as
  overbuild: with secret-first ordering, a failed register leaves only a harmless unreferenced, redacted
  secret; a dangling ref (if register-first) degrades safely via `found=false`. Neither justifies a saga.

## Open Risks

- [ ] **MCP client implementation is unverified (OPERATOR-CONFIRM + spec gate).** The agent's
  `mcp>=2.0.0,<3` uses non-reference module paths (`mcp.server.mcpserver`), so its **client**-side API is
  unknown. `/sdd-spec` must import the installed package, confirm whether it exposes a Streamable-HTTP
  client with `Authorization: Bearer` header injection, and pin the choice (SDK client preferred, else the
  httpx JSON-RPC fallback) — verified at design/spec time, not first use (fails.md feature-009). — target
  loop step (Recommended Scope step 4).
- [ ] **Bearer-required stance (OPERATOR-CONFIRM).** This design makes a bearer token mandatory for every
  `mcp_client` source (`mcp_client` ∈ credential-required; @AC-1 expects `has_credentials=true`). An
  unauthenticated MCP endpoint is Out of Scope (bearer only, by explicit request). Confirm no
  no-auth `mcp_client` is intended. — target register step (step 2).
- [ ] **Two-write non-atomicity (accepted).** Secret-first ordering makes a failed register leave only a
  harmless redacted orphan secret; documented, no compensating cleanup. — target register step (step 2/6).
- [ ] **`credentials_ref` namespace/key split.** The loop must split `ingest.mcp_credential.<slug>` into
  GetSecret `namespace=ingest` + `key=mcp_credential.<slug>`; confirm the config service's key storage
  splits on the first dot (marketdata precedent: `marketdata` / `alpaca.api_key`). — target loop step (step 4).
- [ ] **Health-write mechanism.** Reuse `mark_source_fed` (success/clear) and `mark_source_error`
  (failure) — no new columns; confirm the loop clears `last_error` on a fully-successful cycle. — step 5.

## Constitution Rules Touched

- **C-04** — no new enum; `source_type` is a runtime-extensible string by existing design, so `mcp_client`
  is a new string value governed by the DB CHECK (not a proto enum). Honored (no C-04 obligation triggered).
- **C-05** — new keys are 3-segment (`ingest.mcp_credential.<slug>`, `ingest.mcp_client.poll_interval_seconds`,
  `ingest.mcp_client.request_timeout_seconds`); the bearer is `is_secret` (feature-147 pattern, `secret.*`
  prefix retired). Defaults declared in the ingest service CLAUDE.md at execute. Honored.
- **C-07 / F-01** — one **new** migration `011` (`.up`+`.down`); no applied migration edited. Honored.
- **C-08 / P-06** — each service step gets a paired red-before-green test; the injectable MCP client seam
  makes the outbound call, the 401→health path, and GetSecret resolution unit-testable (C-13 fixtures).
- **C-10 / C-14** — the type reaches **both** named consumer surfaces (agent tools + config-ui `/sources`)
  and the shared `mcp-tools.md`/docstrings in the same PR; parity across all surfaces. Honored.
- **F-04** — the unverified MCP client symbol is parked as a spec-time verification gate, never asserted as
  a found path in the design (recon `## Not found`). Honored.
- **F-06** — the loop makes outbound HTTP, not DB connections; no new/raised DB pool. Honored.
- **F-07** — cadence + timeout read from config via WatchConfig; nothing hardcoded. Honored.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1/@AC-1b/@AC-2/@AC-3/@AC-16 @feature-147` (config-secrets-and-scoping.feature) — bearer
  encrypted at rest, `is_secret` row-authoritative, never streamed/returned, `found=false` distinguishes
  unset from decrypt-failure — not regressed: the token is written only via `SetConfig(is_secret=true)`,
  read only via `GetSecret`, never placed in `config_json`.
- EXTEND `@AC-4 @feature-147` — ingest joins `SECRET_CALLER_ALLOWLIST` (`x-internal-caller: ingest`); the
  existing marketdata grant is unchanged.
- PRESERVE `@AC-5 @feature-147` — the new ingest grant does not weaken the fail-closed default for other callers.
- PRESERVE `@AC-1/@AC-2/@AC-3/@AC-4 @feature-127` (platform.feature / consolidate-watchlist-signal.feature) —
  MCP-sourced signals ride the unchanged `IngestSignal` path, so watchlist auto-add / non-watchlist no-op /
  dedup-no-retrigger / best-effort-side-effect all hold.
- PRESERVE `@AC-8 @feature-156` — `ManageSignalSource` stays admin-gated; the background loop uses service
  identity (`x-internal-caller`), not a forwarded user scope.
- No CHANGE to any existing rule — `mcp_client` is net-new behavior; no user sign-off-for-change required.
