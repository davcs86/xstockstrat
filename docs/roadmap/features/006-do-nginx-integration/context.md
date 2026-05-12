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
