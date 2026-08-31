# Context: mcp-client-signal-source

**Feature**: `docs/roadmap/features/166-mcp-client-signal-source/feature.md`
**Product Spec**: `docs/roadmap/features/166-mcp-client-signal-source/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/166-mcp-client-signal-source/implementation-spec.md`

---

## Session 2026-08-31 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Grounding (codebase-discovery digest):**
  - Signal sources are owned by `xstockstrat-ingest`: table `ingest.signal_sources`
    (`migrations/002_add_signal_sources_registry.up.sql`, health cols `008`, `reliability_weight` `010`),
    proto `SignalSource` (`packages/proto/ingest/v1/ingest.proto:143`), admin-gated
    `ManageSignalSource`/`ListSignalSources` RPCs, agent tools `manage_signal_source`
    (`services/xstockstrat-agent/app/tools.py:897`) / `list_signal_sources` (`:219`).
  - Current extraction is two-track: programmatic `source_type`s → `BaseExtractor`
    (`app/extractors/base.py`, all currently `noop`); `mediated_*` types are fetched **agent-side by
    Claude** (`_EXTRACTOR_TOOL_MAP` `tools.py:200`, `extract_website_content` `:294`). There is **no
    server-side outbound HTTP in ingest** — this feature is net-new plumbing there.
  - Only Bearer-auth outbound fetch today is agent-side `_fetch_url` (`tools.py:1677`). Secret pattern
    to follow: encrypted config + `GetSecret`/`x-internal-caller` (ref `xstockstrat-marketdata`
    `internal/config/config.go:114`). ingest does not call `GetSecret` today.
  - **Feature 093 caveat:** per-source credential resolution is unimplemented — sources with
    `has_credentials=true` currently RAISE. This feature must actually build resolution for the
    `mcp_client` path.
  - `ExternalSignal` shape: `ingest.proto:106` (source, symbol, direction, conviction 0–1, valid_from/
    until, headline, raw_url, tags). Dedup on `(source, symbol, direction)`.
- **Prior features to respect:** 008 (registry + BaseExtractor + `mediated_*` rationale), 062 (`derived`
  source_type for internal producers), 088 (AIP-161 masked-update verbs; `credentials_ref` masked path —
  never silently NULL), 134 (`reliability_weight` NOT NULL DEFAULT 1.0, bind explicit value on register).
- **Ledger traps folded into Open Questions:** fail-open config validator (fundamentals-signal-producer)
  → FR-6 fail-closed; MCP tool contract drift + `mcp-tools.md`/`strat-lab` parity (F-12) → reviewers +
  agent-surface note; shared migration-number collision → reserve CHECK migration number at design.
- **Consumer surface (C-14):** UI `/config-ui` `/sources` + Agent `manage_signal_source` /
  `list_signal_sources`.
- Open design forks recorded in product-spec `## Open Questions` (credential home, query trigger,
  response→signal mapping, source_type tier, MCP client library) — to be resolved in `/sdd-design`.

## Session 2026-08-31 — sdd-review product-spec

- Ran /sdd-review (not skipped, per operator instruction). spec-reviewer + feature-overlap.
- Initial verdict: FAIL (criterion 9 — six unchecked Open Questions) + warnings (4-segment secret key;
  migration up/down pairing unstated; `config_json` cite `:143`→`:150`). Overlap: CLEAN (ingest migration
  next-free 011; `ingest.mcp_*` namespace + `mcp_client` source_type unclaimed).
- Fixes: resolved all Open Questions → "Resolved Design Decisions" (credential home=`ingest.mcp_credential.<slug>`
  encrypted + credentials_ref + GetSecret; scheduled loop w/ `ingest.mcp_client.poll_interval_seconds`/`request_timeout_seconds`;
  fixed xstockstrat-defined response contract; BaseExtractor tier; feature-093 mediated path untouched; official Python MCP SDK client / Streamable HTTP).
  3-segment secret key; migration 011 up/down pair; line cite fixed; ingest added to SECRET_CALLER_ALLOWLIST.
- Re-review verdict: PASS (0 blockers, 0 warnings).
- Status: draft → spec-ready. Next: /sdd-design mcp-client-signal-source quick.

## Session 2026-08-31 — sdd-design

- **Mode**: FULL (2 rounds). Ran in an isolated subagent (no live `AskUserQuestion`/`Task`) — proposer↔
  adversary self-run + self-synthesized (fails.md 2026-08-08 / 121-123 precedent); recorded as a Process
  Note in design.md. No Floor breach → approval not blocked, but the two genuine forks a human gate owns
  are surfaced to the operator (below), not treated as settled.
- **Phase 0 Recon**: refreshed/extended recon.md against direct verification. Key sharper facts vs the
  prior draft: (1) `ManageSignalSource` register **stores `credentials_ref` only — never writes a secret
  and never calls config `SetConfig`** (`servicer.py:1123,1144`), so the encrypted-secret write must be
  orchestrated by the consumer surface (agent `set_config` + config-ui BFF), NOT ingest. (2)
  `validate_config_json` is **already fail-closed** (feature 062 `else`→reject, `signal_sources.py:224-228`)
  — the `mcp_client` branch reuses the `simple_website` "requires non-empty `url`" shape (`:214`). (3) Health
  writers already exist: `mark_source_fed` (clear last_error) / `mark_source_error` (set) / `derive_health_status`
  (→down) (`signal_sources.py:60-77,13-24`) — REUSE, not net-new. (4) `_SS_CREDENTIAL_REQUIRED_TYPES`
  (`servicer.py:54`) gains `mcp_client`. (5) The agent's `mcp>=2.0.0,<3` uses **non-standard module paths**
  (`mcp.server.mcpserver`, `tools.py:46`), so its client-side API is unverified; ingest has neither `mcp`
  nor `GetSecret`. (6) config-ui nav is `NAV_GROUPS`, not the inert `PLATFORM_SUBNAV` (fails.md 2026-08-26) —
  moot here since `/sources` already exists (no new page/nav).
- **No proto change — CONFIRMED**: `source_type` string (`ingest.proto:146`), `config_json` Struct (`:150`),
  `credentials_ref` request field (`:194`), `GetSecret`/`SetConfig` already exist. `/sdd-spec` re-confirms.
- **Migration number — CONFIRMED real next-free `011`** (trunk tip `010_add_signal_source_reliability_weight`;
  `migrations/` verified). `.up` re-lists all 12 CHECK values; `.down` restores the 007 CHECK of 11.
- **Phase 1 Grilling (2 rounds)**. Chosen approach: new `mcp_client` type; secret-first two-write (config
  `SetConfig` is_secret=true, then `ManageSignalSource` with `credentials_ref`); fail-closed `mcp_client`
  validator branch naming a missing `mcp_endpoint` (@AC-6); net-new scheduled loop mirroring
  `fundsignal_loop.py` resolving the bearer via `GetSecret` (`x-internal-caller: ingest`), calling the tool
  over MCP Streamable HTTP with `Authorization: Bearer` only, mapping a fixed response contract to
  `ExternalSignal`s via a pure `BaseExtractor`, ingesting via `IngestSignal`, and recording health via
  `mark_source_fed`/`mark_source_error`. Rejected: DB-column token, token-through-config_json, proto
  `bearer_token`, agent-mediated pull, per-source mapping DSL, orphan-cleanup saga.
- **Bearer secret storage/redaction**: written ONLY to encrypted config key `ingest.mcp_credential.<slug>`
  (`is_secret=true`, AES-256-GCM, feature 147) via `SetConfig`; redacted at every config read edge; never in
  `config_json` (a verbatim `ListSignalSources` read edge) or any ingest column; resolved only via `GetSecret`.
- **Fail-closed validation**: missing `mcp_endpoint`/`mcp_tool` → `INVALID_ARGUMENT` naming the field;
  `mcp_client` ∈ `_SS_CREDENTIAL_REQUIRED_TYPES` → register without `credentials_ref` rejected. Validator
  branch + migration-011 CHECK land in the SAME PR (fails.md `signal-source-registry` lockstep trap).
- **Constitution rules touched**: C-04 (no enum — string+CHECK), C-05, C-07/F-01, C-08/P-06, C-10/C-14,
  F-04, F-06, F-07. **Floor breaches: none** (the unverified MCP client symbol is parked as an F-04-safe
  spec-time gate, not asserted). Business rules: PRESERVE feature-147 @AC-1/1b/2/3/5/16 + feature-127
  @AC-1/2/3/4 + feature-156 @AC-8; EXTEND feature-147 @AC-4; no CHANGE.
- **OPEN THREADS (operator-confirm before /sdd-execute)**: (A) MCP client implementation pick — SDK client
  vs httpx JSON-RPC fallback — `/sdd-spec` must import the installed `mcp>=2.0.0,<3` and pin it (feature-009
  trap). (B) Bearer-required stance — confirm no unauthenticated `mcp_client` is intended. (C) Two-write
  non-atomicity accepted (secret-first; harmless redacted orphan on register failure; no saga).
- **Status**: per task constraints, this run wrote ONLY recon.md + design.md + this context block; it did
  NOT flip status.md (spec-ready) or edit feature.md. A normal /sdd-design COMPLETION would flip
  spec-ready → design-approved — left for the orchestrator. Next: /sdd-spec mcp-client-signal-source.

## Session 2026-08-31 — design decisions resolved (operator defaults)

- (B) Bearer token is MANDATORY for every `mcp_client` source — registration is rejected (fail-closed, INVALID_ARGUMENT) if no bearer secret is provided; no unauthenticated MCP endpoint is allowed. Design's recommended security posture.
- (A) MCP client transport (SDK vs httpx JSON-RPC fallback) is pinned at `/sdd-spec` against the actual installed client; prefer the robust minimal JSON-RPC-over-Streamable-HTTP path to avoid the agent's non-standard `mcp.server.mcpserver` SDK-path fragility (feature-009 trap). F-04-safe gate at spec.
