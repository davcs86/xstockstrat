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

## Session 2026-08-31T16:00:00Z — sdd-spec

- Generated implementation-spec.md with **17 steps**. Status → `implementation-ready`.
- Consumed recon.md + design.md (status was `design-approved`). Followed the design's Chosen
  Approach unchanged; resolved the two OPERATOR-CONFIRM open risks at spec time (see below).
- Key codebase findings (all path:line-grounded):
  - **Next ingest migration = `011`** (trunk tip `010_add_signal_source_reliability_weight`; `007` CHECK
    carries all 11 values — migration 010 added only the `reliability_weight` column). Step 1 DROP+re-ADD
    re-lists all 12; the validator branch (Step 2, `signal_sources.py:186-230`, already fail-closed at
    the `else`) + the CHECK land in the same PR (fails.md `signal-source-registry` lockstep).
  - **Config seed migration = `025_ingest_mcp_client_keys` (Step 12)** — for the two non-secret loop keys
    `ingest.mcp_client.poll_interval_seconds` (300) / `request_timeout_seconds` (30). NNN pre-assigned by
    merge-order.md lines 187–198 (config-seed batch: 021→`022`, 031→`023`, 168→`024`, 166→`025`); config
    working-tree tip is `021_notify_push_min_severity`, so `025` merges AFTER `022`/`023`/`024`
    (golang-migrate numeric-order apply — cross-feature merge dependency, not code). Post-147 seed schema
    mirrored from `019`/`021` (`is_secret`/`user_id` NULL, staging+production, no `trading_mode` — dropped
    by `017`); `key` column is namespace-relative (`mcp_client.poll_interval_seconds`, per ingest
    `watcher.py:95-101` snapshot lookup + the `005` precedent). Bearer secret `ingest.mcp_credential.<slug>`
    is NOT seeded (written at registration via `SetConfig(is_secret=true)`). Busy-loop hazard surfaced:
    optional `SCALAR_BOUNDS_REGISTRY` bound (`configServiceImpl.ts:114`) or a loop-side clamp so a settable
    `0` cannot busy-loop.
  - **MCP SDK OPEN RISK RESOLVED (fails.md 085):** installed SDK is `mcp==2.0.0` (agent `uv.lock:459`),
    a non-reference distro (`mcp.server.mcpserver.MCPServer`, deps `httpx2`+`mcp-types`). Downloaded and
    inspected the wheel: it **does** expose `mcp.client.streamable_http.streamable_http_client(url, *,
    http_client)` + `mcp.client.ClientSession` (`initialize`/`call_tool`). **Bearer injection** =
    `httpx2.AsyncClient(headers={"Authorization": f"Bearer <token>"})` passed as `http_client`;
    `_prepare_headers` (wheel `mcp/client/streamable_http.py:113-131`) never sets Authorization, so the
    bearer survives and no other auth is sent (@AC-3). The high-level `Client(url)` cannot inject headers
    (`client.py:396`) — low-level pattern required. `call_tool` returns `CallToolResult` with
    `structured_content: Any` (the JSON contract list), `content`, `is_error` (`mcp_types/_types.py:1463`).
    **Decision: SDK path chosen; httpx JSON-RPC fallback NOT needed.** ingest gains `mcp>=2.0.0,<3` →
    `uv lock` (pulls httpx2/mcp-types/starlette/uvicorn/pydantic/pyjwt transitively).
  - **`credentials_ref` split** confirmed against marketdata precedent: `ingest.mcp_credential.<slug>`
    → GetSecret `namespace="ingest"`, `key="mcp_credential.<slug>"` (split on first dot; config stores
    (namespace, key) where key may contain dots — cf. `marketdata`/`alpaca.api_key`, `config.go:120-133`).
  - **Config allow-list gap (Step 4):** `SecretCallerGrant` (`authz.ts:141-154`) only supports exact
    `keys[]`; ingest's per-slug credential keys are dynamic → added a `keyPrefixes` concept
    (`mcp_credential.`) to `hasSecretCallerAuthority` (`:161-174`), keeping marketdata's exact grant +
    the fail-closed default (PRESERVE `@AC-5 @feature-147`). Security-review step.
  - **No runtime extractor dispatcher exists** in ingest — the `noop`/`example` extractors are never
    driven server-side. The `mcp_client` loop is fully net-new; the extractor (Step 8) is a pure parser
    over an already-fetched result (`McpClientInput` added to the `RawInput` union, `base.py:42-48`).
  - **IngestSignal reuse (Step 10):** `IngestSignal` (`servicer.py:720+`) is context-coupled; spec
    extracts an internal `_ingest_external_signal(signal) -> (signal_id, deduplicated)` helper reused by
    both the RPC and the loop (loopback-gRPC fallback recorded). Dedup on `(source,symbol,direction)` via
    `signal_dedup_keys`. Health via `mark_source_fed`/`mark_source_error` (`signal_sources.py:60-77`).
  - **AC-1/AC-2 vs. agent tool (Step 13):** `list_signal_sources` currently **strips** `has_credentials`
    (`tools.py:233`), but product-spec §Consumer Surfaces line 87 + @AC-1/@AC-2 require it. Resolved:
    reverse the exclusion for the **boolean `has_credentials` only** (never the token/`credentials_ref`).
    Tool **count unchanged (32)** — a param + an output field, not a new tool (fails.md
    `offline-account-portfolios`), so the six count surfaces don't change.
  - config-ui `/sources` page exists (`page.tsx:34` `SOURCE_TYPES`), nav via `NAV_GROUPS` — no new
    page/C-10(a) step. No new env var/port anywhere (loop reuses config watcher + endpoints).

## Decisions (durable)

- **MCP client = official `mcp` SDK Streamable-HTTP low-level client** (`streamable_http_client` +
  `ClientSession`), bearer via `httpx2.AsyncClient` custom header. httpx fallback rejected as unneeded.
- **Bearer stance = mandatory** for every `mcp_client` source (`mcp_client` ∈ `_SS_CREDENTIAL_REQUIRED_TYPES`);
  no-auth MCP endpoints Out of Scope (design OPERATOR-CONFIRM item, resolved per product spec).
- **Two-write = secret-first**, no compensating saga (failed register → harmless redacted orphan secret).
- **Config secret key** `ingest.mcp_credential.<slug>` (3-segment C-05); loop keys
  `ingest.mcp_client.poll_interval_seconds` (300) / `request_timeout_seconds` (30) declared in ingest CLAUDE.md.

## Open Threads

- Step 10 `IngestSignal` refactor (extract `_ingest_external_signal`) must keep the RPC's existing tests
  green — flagged in the step; loopback-gRPC is the recorded fallback if extraction proves invasive.
- `CallToolResult.structured_content` vs `content[0].text` fallback: parser reads structured first; the
  exact attribute name (`structured_content`) is pinned from `mcp-types==2.0.0` — re-confirm at execute
  against the actually-installed version.

## Session 2026-08-31 — sdd-review impl-spec (advisory)

- Result: 0 failures, 4 warnings (advisory; no Floor breach). Exemplary secret handling (bearer encrypted, GetSecret-only, redacted at every read edge, never in config_json — a verbatim ListSignalSources edge); NO proto change; migrations 011 (ingest CHECK) + 025 (config seed) correct + paired; fail-closed validation; nav CORRECTLY targets NAV_GROUPS (Step 16).
- Unresolved ⚠ carried into execution:
  - Step 4: C-01 line drift — `INTERNAL_CALLER_ALLOWLIST` is at `authz.ts:103-110` (not `:96-108`); correct at execute time (symbols right). — [ ] unaddressed
  - Step 5: annotate the `pnpm run test:coverage` Verification with the enforced 40% floor (vitest config) so "threshold explicit" is met. — [ ] unaddressed
  - Step 15: C-01 evidence — SOURCE_TYPES has 10 types (not 9); the interface is `FormState` (not `SourceFormState`); correct at execute time. — [ ] unaddressed
  - Step 12: config seed 025 sits above tip 021; must merge AFTER 022/023/024 (already tracked in merge-order.md; re-derive if 021/031/168 slip). — [ ] note only
  - product-spec.md:85 still says `/sources` is "registered in PLATFORM_SUBNAV" (stale) — impl-spec is correct (NAV_GROUPS); reconcile the product spec on a later touch. — [ ] note only
- Overlap findings: batch scan CLEAN; 166 shares agent tools.py / mcp-tools.md with 095 (distinct tools, count 32 vs 33 — no conflict).

## Session 2026-09-01 — sdd-execute (Steps 1–17, code-completed)

Executed all 17 steps on `feature/mcp-client-signal-source` (branched off `origin/main-dev`, which
now includes 110). A new server-side `mcp_client` signal source: fail-closed validation + CHECK
(ingest), a config `GetSecret` key-prefix grant, a bearer-resolving MCP Streamable-HTTP client seam,
a pure extractor, a scheduled query loop reusing an extracted `_ingest_external_signal` (dedup +
health preserved), the config seed migration `025`, the agent two-write tool surface, the config-ui
`/sources` registration, and `mcp-tools.md` parity.

**Commits (one per step-pair):** 1-3 (`aefb5797`), 4-5 (`ac3b997c`), 6-7 (`91c1f983`), 8-9
(`c3563afc`), 10-11 (`3711aacb`), 12 (`a50acbc5`), 13-14 (`4c4a6f0e`), 15-16 (`35787f14`),
17 (`24841d11`).

**RED→GREEN (Floor P-06):** every code-bearing pair captured RED then GREEN — Steps 3/5/9/14 by
running the test before the impl; Steps 7/11 by `git stash`-ing the net-new impl to prove
ImportError RED, then GREEN. Full suites: ingest 206 pass (78% cov), config 98 pass (84%), agent 327
pass (78%), UI config-ui sources e2e 19/19 (production bundle). Regression-safe: the IngestSignal
refactor kept all 44 existing signal tests green; the config env-gate + full sources suite passed.

**MCP SDK (fails.md 085 re-check):** installed `mcp 2.1.1` (not the spec's 2.0.0); re-verified the
exact API against the wheel — `streamable_http_client(url, *, http_client)` → `(read, write)`,
`ClientSession.call_tool → CallToolResult.structured_content`, bearer via `httpx2.AsyncClient`
header. Transitive deps pulled: httpx2, mcp-types, pydantic(-core), pyjwt, starlette, sse-starlette,
uvicorn, referencing, rpds-py, truststore, python-multipart, typing-inspection.

**impl-review ⚠ resolved:** Step 4 `INTERNAL_CALLER_ALLOWLIST` line-drift (symbols right at execute);
Step 5 coverage floor met (config `test:coverage` 40% gate passes); Step 15 SOURCE_TYPES=10 / type is
`FormState` (both confirmed, no code impact).

**Deviations** (full detail in implementation-spec.md § Deviation Log): `is_secret` lives on
`ConfigValue` not `SetConfigRequest` (agent + config-ui set `cv.is_secret`); agent tool count is 33
(095 shipped `list_opportunities`), unchanged by this feature; config-ui env plumbing solved via the
BFF filling UNSPECIFIED→native (`nativeConfigEnvironment`) instead of a page server-wrapper; Step 16
mock left unchanged (per-test `page.route`, matching the sources-spec convention); loop-side clamp
(not SCALAR_BOUNDS) for the busy-loop guard.

**Cross-feature merge-order:** config migration `025` must merge AFTER `022`/`023`/`024`
(golang-migrate numeric order) — 022 (021) is in main-dev; 023 (031, PR #1062) and 024 (168, not yet)
must land first. Tracked in merge-order.md.

**Teardown:** touched `services/xstockstrat-ingest/CLAUDE.md`, `docs/patterns/config-governance.md`,
`docs/runbooks/mcp-tools.md`. `/context-scrubber` is not available in this session — flagged in the
PR body per the Teardown rule.

**Status:** `implementation-ready` → `code-completed`. Next: PR → `main-dev`.

## Session 2026-09-01 (CI: feature status automation)

- Promotion PR #1065 merged to main
- Feature promoted and committed: c086afc839f905c4f72b24d75e824e22d61af0b2
- Status updated: `code-completed` → `launched`
- Launched date: 2026-09-01
