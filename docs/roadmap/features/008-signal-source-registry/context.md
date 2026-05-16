# Context: signal-source-registry

**Feature**: `docs/roadmap/features/008-signal-source-registry/feature.md`
**Product Spec**: `docs/roadmap/features/008-signal-source-registry/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/008-signal-source-registry/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: audit revealed `source` field on ExternalSignal is free-form with no validation; mismatched slugs cause silent data loss in analysis backtesting.
- Scope defined during session: five source types (simple_email, email_attachment, linked_email, simple_website, authenticated_website), DB-backed registry, per-source Python extractor modules, BaseExtractor interface, ListSignalSources RPC, IngestSignal validation.
- This feature is a prerequisite for: AI agent feature (Phase 1 MCP server), signal-source-weighting (007).
- Credential storage pattern: references to secret.* config keys only — never stored in registry rows.

## Session 2026-05-16T00:01:00Z — spec refinement

- Added Sources management UI in xstockstrat-config-ui (/sources page) to scope.
- UI requirements: list sources, enable/disable toggle, structured edit form per source_type (email filters, website URLs, credentials_ref input), read-only weight display (wired to analysis.signals.source_weights, editable in 007).
- Resolved open question: ManageSignalSource requires admin API key validated via identity service — not open like n8n webhooks.
- Resolved open question: config_json is validated per source_type (required fields enforced at RPC level, not freeform JSONB).
- credentials_ref never returned in any response; replaced by has_credentials boolean flag.
- extractor_module field is read-only in the UI after registration.
- UI may optionally display extractor source code as a view-only reference (not a hard requirement).
