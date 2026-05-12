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

---

## Session 2026-05-12 — sdd-spec

- Generated implementation-spec.md with 4 steps. Status → implementation-ready.
- **Key codebase findings**:
  - Feature 005 (frontend-reverse-proxy) already has nginx.conf + Dockerfile created on feature/frontend-reverse-proxy branch (Steps 1–2 complete); 005 is in-progress state.
  - Current DO app specs (.do/app.dev.yaml L282–346, .do/app.yaml L278–342) expose all three frontends with individual http_port entries (3000, 3001, 3002); need to be removed and replaced with single nginx service on port 80.
  - DO environment variable substitution pattern: ${service.PRIVATE_URL} used for all inter-service communication; nginx must receive XSTOCKSTRAT_TRADER_PRIVATE_URL, XSTOCKSTRAT_INSIGHTS_PRIVATE_URL, XSTOCKSTRAT_CONFIG_UI_PRIVATE_URL environment variables and template them into nginx.conf at startup via docker-entrypoint.sh + envsubst.
  - Feature 005's Dockerfile references docker-entrypoint.sh (Step 2 instructions: ENTRYPOINT with source + nginx start); this script must be created in Step 3 of this feature.
  - CLAUDE.md Service Registry (L32) already has xstockstrat-nginx entry (added by 005's /sdd-review).
- **Step dependencies**: Steps 1–2 (app specs) and Step 4 (docs) are independent; Step 3 (entrypoint script) depends on Steps 1–2 being conceptually complete.
- **Next action**: `/sdd-review do-nginx-integration impl-spec` then `/sdd-execute do-nginx-integration`.
