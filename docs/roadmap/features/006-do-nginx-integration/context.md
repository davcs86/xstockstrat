# Context: do-nginx-integration

**Feature**: `docs/roadmap/features/006-do-nginx-integration/feature.md`
**Product Spec**: `docs/roadmap/features/006-do-nginx-integration/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/006-do-nginx-integration/implementation-spec.md`

---

## Session 2026-05-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Story: wire nginx reverse proxy (from feature 005) into DO App Platform by updating `.do/app.yaml` and `.do/app.dev.yaml`.
- Key decisions captured in product-spec Open Questions: DO internal service name resolution format, build context reachability, and http_port configuration need verification at /sdd-spec time.
- Dependency on 005-frontend-reverse-proxy noted: nginx Dockerfile and nginx.conf must exist on main-dev before this feature deploys.

---

## Session 2026-05-12 — sdd-review product-spec

- **Scope expanded**: Resolved all 3 open questions, marking them [x] and bringing nginx.conf dynamic templating (via envsubst) in-scope for implementation.
- **Service registry updated**: Added xstockstrat-nginx entry to CLAUDE.md Service Registry (Nginx, HTTP reverse proxy on port 80).
- **Status transition**: `draft` → `spec-ready` (PASS review).
- **Overlap findings**: 4 WARNs (advisory) — features 002, 003, 004, 005 also touch the same frontend services or DO app specs. Recommended merge order: 005 → 006 → (002,003) → 004 to ensure routing baseline is established before other features deploy.
- **Next action**: `/sdd-spec do-nginx-integration` to generate implementation spec with concrete DO app spec changes and nginx.conf entrypoint script.
