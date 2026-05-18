# Context: wire-fe-auth

**Feature**: `docs/roadmap/features/012-wire-fe-auth/feature.md`
**Product Spec**: `docs/roadmap/features/012-wire-fe-auth/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/012-wire-fe-auth/implementation-spec.md`

---

## Session 2026-05-18T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Key decisions captured:
  - No new frontend service — auth wired into existing trader/insights/config-ui frontends.
  - userId propagated via `x-user-id` gRPC metadata header on service-to-service calls; nginx strips it on inbound external requests to prevent spoofing.
  - **No Bearer token forwarding to backend services.** The frontend is the auth boundary: it validates the JWT locally in `middleware.ts`, extracts `userId` from claims, and passes `x-user-id` on all outbound Connect-RPC calls. Backend services trust `x-user-id` from internal callers only.
  - Shared `@xstockstrat/auth` workspace package left as an open question for impl-spec time.
  - Hardcoded `userId ?? 'default'` fallback removed from `xstockstrat-trader` API routes (`/api/orders`, `/api/portfolio`) — routes now return 401 if no userId is available, making the auth gap explicit rather than silent.

## Session 2026-05-18T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: (1) AC-5 omits the 60s refresh threshold from FR-4; (2) ACs are qualitative rather than quantitative.
- Open questions resolved: OQ-1 deferred to impl-spec; OQ-2 deferred/out of scope; OQ-3 resolved as stateless cookie-read per request (no server-side session store).
- Overlap findings: formula-management-ui (003) and do-nginx-integration (006) both touch xstockstrat-insights; do-nginx-integration (006) also touches xstockstrat-trader, xstockstrat-config-ui, xstockstrat-nginx — advisory WARNs only, no FAIL-level conflicts. Recommend merging 006 and 011 before running /sdd-spec so nginx and identity baselines are stable.

## Session 2026-05-18T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings:
  - OQ-1 resolved: no shared `@xstockstrat/auth` workspace package. Auth utilities are replicated as `src/lib/auth.ts` per service (trader/insights) and `app/lib/auth.ts` (config-ui). This avoids pnpm workspace dep complexity for a small utility file, consistent with how each service manages its own Connect-RPC transport module.
  - Identity service uses `jsonwebtoken` (HS256 HMAC). JWT payload fields are snake_case: `user_id`, `email`, `roles`, `issued_at`, `expires_at` — confirmed at `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:L61–L67`.
  - Frontends must use `jose` (not `jsonwebtoken`) for JWT verification because Next.js `middleware.ts` runs in the Edge Runtime which lacks Node.js built-ins. `jose` is not currently in any frontend `package.json`.
  - config-ui uses `app/` directory layout (not `src/app/`); middleware must live at `services/xstockstrat-config-ui/middleware.ts` (service root), not inside `app/` or `src/`.
  - `JWT_SECRET` is in `.do/app.dev.yaml` and `.do/app.yaml` only for the identity service. All three frontends need it added.
  - `IDENTITY_HTTP_ENDPOINT` is missing from `docker-compose.yml` and DO specs for `xstockstrat-config-ui` — confirmed via grep.
  - Existing API routes in trader already have `TODO(wire-fe-auth)` comments at `orders/route.ts:L28,57` and `portfolio/route.ts:L14` — exact replace targets confirmed.
