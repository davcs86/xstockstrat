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
