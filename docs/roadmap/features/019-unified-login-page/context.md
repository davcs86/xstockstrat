# Context: unified-login-page

**Feature**: `docs/roadmap/features/019-unified-login-page/feature.md`
**Product Spec**: `docs/roadmap/features/019-unified-login-page/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/019-unified-login-page/implementation-spec.md`

---

## Session 2026-05-25 — idea capture

- Feature directory created as follow-up to 018-agent-mcp-oauth.
- During 018 product spec review, operator noted that having 4 login pages (3 Next.js frontends + identity /login from 018) is maintenance debt and asked about a unified login page.
- Decision: scope minimal identity form into 018 only; consolidation deferred here.
- Preliminary product spec written at idea stage — not yet reviewed. Captures the problem, preliminary FRs, and the key architectural decision (Option A cookie exchange vs Option B shared JWT) that must be resolved before /sdd-story formalizes it.
- Dependency documented: this feature must follow 018 being launched.

## Session 2026-06-01T00:00:00Z — sdd-story

- Product spec formalized from preliminary idea capture. Status: idea → draft.
- Key updates from preliminary to formal spec:
  - Affected services updated to reflect post-045 landscape: `xstockstrat-ui` (consolidated
    frontend) replaces the three individual frontend services; nginx is already removed by 045.
  - `IDENTITY_HTTP_ENDPOINT` reference removed — this var was marked as dead/legacy in root
    CLAUDE.md; consolidated auth uses `IDENTITY_ENDPOINT` (gRPC `host:port`) unchanged.
  - Identity's `GET /login` form (FR-9 in 018) confirmed to be an Express HTTP endpoint;
    019 replaces it with a redirect to `xstockstrat-ui/auth/login` (FR-7).
  - Session model OQ resolved direction: single platform-wide JWT for the consolidated app is
    the natural fit — kept as OQ-1 for formal gate confirmation.
  - Auth route consolidation: one `/api/auth/login` route for all basePaths vs per-basePath
    routes left as OQ-1.
  - OAuth redirect mechanics captured as OQ-2 (how does unified login page distinguish OAuth
    login from regular frontend login and redirect correctly back to agent).
  - Identity HTTP server lifecycle captured as OQ-3 (should identity's Express HTTP server
    remain after its login form is replaced with a redirect?).
- Merge-order dependencies: must follow 045 (`ui-consolidation-nextjs`) and 018 (`agent-mcp-oauth`) being launched.
