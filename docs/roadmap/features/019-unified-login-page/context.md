# Context: unified-login-page  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped as a consolidated `/auth/login` + `/auth/oauth-login` pair with 3 consolidated `/api/auth/*` routes and one `middleware.ts`, replacing 3 per-basePath login pages + 9 per-basePath auth routes + 3 per-basePath e2e specs in `xstockstrat-ui`. Identity's Express HTTP server was confirmed already absent (gRPC-only) rather than needing removal.
**Why (irrecoverable rationale)**: Single platform-wide JWT (shared `JWT_SECRET`, cookie `path: '/'`) was chosen over a per-frontend cookie-exchange design (Option A vs Option B, captured at idea stage) because the consolidated `xstockstrat-ui` (post-045) is one Next.js app, not three, making per-service token exchange pointless overhead (context.md:14, 27, 41-42). OAuth login was split into a *separate* `/auth/oauth-login` route rather than branching the shared `/auth/login` route, specifically to avoid conditional logic mixing agent-OAuth and normal-user login paths (context.md:43-45).
**Rejected alternatives**:
- Option A (per-frontend cookie exchange) — lost once 045 consolidated the three frontends into one app, making a shared JWT the natural fit (context.md:14, 27).
- Branching `/auth/login` to also handle OAuth — lost to a dedicated `/auth/oauth-login` route to avoid mixed-purpose branching logic (context.md:43-45).
**Scars & gotchas**:
- The 2026-06-01 implementation spec was written against an assumed single consolidated auth-route structure that did not match main-dev reality post-045 (which had per-basePath routes/pages/specs); required a full re-spec mid-execution on 2026-06-04 after merging current main-dev (context.md:76-80).
- CI caught a Next.js trailing-slash normalization bug invisible in local dev: `/config-ui/` 308-redirects to `/config-ui` *before* hitting the auth middleware, so the e2e redirect-path assertion needed the trailing slash dropped to match trader/insights (context.md:135-137).
- Playwright e2e for Step 8 timed out twice under the harness (dev-server compile); execution fell back to tsc/lint-only verification, per the spec's own documented fallback (context.md:127-128).
**Permanent deviations**:
- design/spec said "single consolidated `/api/auth/*` + single `e2e/auth.spec.ts`" already existed to modify -> shipped creating those consolidated artifacts from scratch (they didn't exist; main-dev still had per-basePath copies) -> because 045's actual landed structure diverged from what the 2026-06-01 spec assumed (context.md:78).
- Step 6 (agent `UI_BASE_URL` wiring) shipped as env-var + TODO only, no redirect-target code, because dependency feature 018 (agent-mcp-oauth) had not landed yet at execution time (context.md:59, 80, 112-116).
**Cross-feature signal**: - W5 in the impl-spec review flagged a required execution-order constraint versus feature 016 (mock-backend.ts overlap) — 019 needed to land before 016, resolved via merge-order sequencing (context.md:71, 74).
**Deferred follow-ons**: - Update agent's `/oauth/authorize` redirect target to use `UI_BASE_URL` once feature 018 (agent-mcp-oauth) lands (context.md:59, 113).
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
