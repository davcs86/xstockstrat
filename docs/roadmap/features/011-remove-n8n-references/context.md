# Context: remove-n8n-references

**Feature**: `docs/roadmap/features/011-remove-n8n-references/feature.md`
**Product Spec**: `docs/roadmap/features/011-remove-n8n-references/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/011-remove-n8n-references/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: n8n was planned as the orchestration layer but never implemented; platform moving to AI agent architecture (009, 010).
- No functional changes — rename and path update only. Zero existing callers, so no backward compatibility needed.
- New canonical webhook path prefix: /webhooks/<action> (drops the /n8n/ segment).
- packages/n8n/ deleted (not archived) — superseded by agent approach.
- docs/setup/n8n.md replaced with stub pointing to 009.
- 009 product spec must be updated as part of this feature (references old /webhooks/n8n/ paths).
- Two open questions: DO app spec n8n env vars, add-data-source.md runbook references.
