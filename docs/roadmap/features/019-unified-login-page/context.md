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

## Session 2026-06-01T00:01:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All 3 open questions resolved at review gate:
  - JWT scope: single platform-wide JWT — one `JWT_SECRET` shared between identity and
    `xstockstrat-ui`; valid for all basePaths within the consolidated service.
  - OAuth redirect mechanics: separate `GET /auth/oauth-login` route — dedicated to the
    agent OAuth flow; avoids branching logic on the shared `/auth/login` route; agent redirects
    directly to `/auth/oauth-login`, not `/auth/login`.
  - Identity HTTP server lifecycle: remove entirely — identity returns to gRPC-only; agent's
    `/oauth/authorize` updated to redirect to `{UI_BASE_URL}/auth/oauth-login`; `UI_BASE_URL`
    is a new env var for the agent (browser-redirect URL, not a gRPC `_ENDPOINT`).
- Product spec updated: FR-7 split into FR-7 (separate /auth/oauth-login route) and FR-8
  (identity HTTP server removal + agent redirect update); FR-9 (styling). Affected services
  now includes `xstockstrat-agent`. Config key changes now documents `UI_BASE_URL`.

## Session 2026-06-01T00:02:00Z — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Key codebase findings:
  - `xstockstrat-ui` does not yet exist (feature 045 is still `draft`). Spec targets post-045 consolidated service; all step instructions include a note that execution requires 045 to be `launched` first.
  - `xstockstrat-identity` HTTP Express server is already absent (`services/xstockstrat-identity/src/index.ts` is gRPC-only with no `express` or HTTP listen calls). FR-8 is already satisfied for identity — Step 5 is a verification-only no-op unless feature 018 adds an Express server that must be removed.
  - Feature 018 (`agent-mcp-oauth`) has not landed yet — no `/oauth/authorize` handler exists in `services/xstockstrat-agent/app/main.py`. Step 6 includes a conditional instruction: add `UI_BASE_URL` env var wiring now; update the redirect target once 018 lands.
  - All three existing per-basePath login pages are confirmed at `services/xstockstrat-trader/src/app/login/page.tsx`, `services/xstockstrat-insights/src/app/login/page.tsx`, `services/xstockstrat-config-ui/app/login/page.tsx`. All three middleware files redirect to `/login` (not `/auth/login`) — Step 3 updates all of them.
  - Cookie `path: '/'` is already set in `services/xstockstrat-trader/src/lib/auth.ts` line 43 — platform-wide JWT is compatible with the existing cookie implementation; no change needed to `lib/auth.ts`.
  - `UI_BASE_URL` confirmed absent in `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml` (grep returned 0 matches).
