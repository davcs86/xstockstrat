# Context: ui-consolidation-nextjs

**Feature**: `docs/roadmap/features/045-ui-consolidation-nextjs/feature.md`
**Product Spec**: `docs/roadmap/features/045-ui-consolidation-nextjs/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/045-ui-consolidation-nextjs/implementation-spec.md`

---

## Session 2026-05-29T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Pre-scan of the three frontends confirmed: all use basePaths (/trader, /insights, /config-ui), identical middleware pattern, shared dependency set, Next.js version skew (trader on v15, insights + config-ui on v14), and config-ui has direct pg access for audit log.
- nginx also proxies /agent/sse and /agent/messages — captured in FR-3 to move those to Next.js rewrites.
- New service name `xstockstrat-ui` proposed (open question in product-spec).
