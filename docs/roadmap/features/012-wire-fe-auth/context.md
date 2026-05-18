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
