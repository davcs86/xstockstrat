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
