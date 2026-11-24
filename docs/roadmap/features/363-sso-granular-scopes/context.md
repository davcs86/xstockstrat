# Context: sso-granular-scopes

**Feature**: `docs/roadmap/features/363-sso-granular-scopes/feature.md`
**Product Spec**: `docs/roadmap/features/363-sso-granular-scopes/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/363-sso-granular-scopes/implementation-spec.md`

---

## Session 2026-11-24T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: owner's follow-up request during the homelab-edge Hermes Agent re-spec (2026-11-24). Owner's wording: "(1) Use
  custom granular scopes in Authelia for xstockstrat and an App-side Scope Picker, (2) Separate client_id for
  xstockstrat, full access in web, read access for mcp." Interim, owner-approved: Hermes reuses the `david` user.
- Filed from a homelab-edge session following `.claude/skills/sdd-story/SKILL.md` step by step; NNN 363 reserved with
  `scripts/sdd-allocate-feature-number.py`.
- Interpretations not yet confirmed by the owner are recorded as Open Questions OQ-1…OQ-5 in product-spec.md, not
  decided here: catalog granularity, picker placement, client-ID claim, default grant, dependency on 345.
