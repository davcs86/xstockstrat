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

## Session 2026-06-01 — sdd-review impl-spec + decisions

- impl-spec review: PASS (0 failures, 7 advisory warnings).
- W1 (POST target path): executor confirms `/auth/login` is served at domain root in consolidated service (not under any basePath) at Step 1 start.
- W2 (per-basePath auth route deletions not in Files): advisory; executor deletes them per Step 2 instruction 4.
- W3 (middleware.ts path uncertainty): executor runs `find services/xstockstrat-ui -name "middleware.ts"` before Step 3 — confirmed single file per 045 sdd-spec session.
- W4 (main.py conditional): accepted; TODO comment added if 018 not landed.
- W5 (mock-backend.ts overlap with 016): **ensure 019 executes before 016**. At Step 8, after adding auth mock entries, rebase on 016 branch (or coordinate) so both features' mock additions are present in the final file.
- W5 (Step 5 typed `service` but NO-OP): advisory; no spec change.
- W6 (xstockstrat-agent no paired test): advisory; env var wiring is minimal risk.
- Hard dependency: execute after 045 is merged. Execution position: 044 → 046 → 045 → 003 → **019** → 016.

## Session 2026-06-04 — sdd-execute (re-spec)
- Merged current `origin/main-dev` into `feature/unified-login-page` (`merge -X ours`), bringing the post-045 consolidated `xstockstrat-ui`.
- **Blocker found + user decision**: the 2026-06-01 spec assumed a single consolidated `src/app/api/auth/*` route and a single `e2e/auth.spec.ts`. Reality on main-dev: a single `src/middleware.ts` routing to **per-basePath** login pages (`src/app/{trader,insights,config-ui}/login/page.tsx`), **per-basePath** auth routes (`src/app/{seg}/api/auth/{login,logout,refresh}/route.ts`, 9 files), and **per-basePath** e2e specs (`e2e/{seg}/auth.spec.ts`). User approved a targeted re-spec, **including creating the consolidated auth routes + unified login page in scope**.
- Re-spec'd: Step 1 (evidence→ui paths), Step 2 (now: create 3 consolidated `/api/auth/*` routes + delete 9 per-basePath copies), Step 3 (single `src/middleware.ts`: redirect→`/auth/login`, refresh→`/api/auth/refresh`, matcher), Step 4 (delete 3 per-basePath login pages), Step 6 (UI_BASE_URL wiring; 018 not landed → TODO only, no oauth handler), Step 8 (create unified `e2e/auth.spec.ts` + delete 3 per-basePath auth specs). Steps 5 (identity gRPC-only verify) and 7 (docs) unchanged in substance.
- 018 (agent-mcp-oauth) has NOT landed: agent `app/main.py` has no `/oauth/authorize` handler. Step 6 wires the env var and leaves a TODO; no redirect-target code yet.

### Step 1 — service: Add unified /auth/login and /auth/oauth-login pages [done]
- Created `src/app/auth/login/page.tsx` (Suspense + LoginForm, POST `/api/auth/login`, FR-3 safeRedirect allowlist → default `/trader`) and `src/app/auth/oauth-login/page.tsx` (reads redirect_uri+state, POST `/api/auth/login`, on success `window.location.href = redirect_uri?state=…`; invalid-request guard).
- Files modified: `src/app/auth/login/page.tsx`, `src/app/auth/oauth-login/page.tsx`.
- Verification: `tsc --noEmit` clean (after clearing stale .next cache from prior branch), `pnpm run lint` clean.
- Deviations: none.

### Step 2 — service: Consolidated /api/auth/* routes + delete per-basePath copies [done]
- Created `src/app/api/auth/{login,logout,refresh}/route.ts` (copied verbatim from trader variants — `@/lib/*` aliases need no edits). Deleted all nine `src/app/{trader,insights,config-ui}/api/auth/*` route files. Non-auth per-basePath api routes ([...connect], health, audit) untouched.
- Files modified: created 3 consolidated routes; deleted 9 per-basePath routes.
- Verification: `tsc --noEmit` clean; `pnpm run lint` clean; exactly one `authenticateUser` (consolidated login); only 3 auth routes remain.
- Deviations: none (matches re-spec'd Files list).

### Step 3 — service: Update src/middleware.ts [done]
- Unauthenticated block now redirects to `new URL('/auth/login', req.url)` (allows /auth/login + /auth/oauth-login through); refresh block uses `/api/auth/refresh` and redirects to `/auth/login` on failure; matcher excludes `auth/login|auth/oauth-login`.
- Files modified: `src/middleware.ts`.
- Verification: `tsc --noEmit` clean; `pnpm run lint` clean; 0 per-basePath login refs; /auth/login + /api/auth/refresh present.
- Deviations: none.
