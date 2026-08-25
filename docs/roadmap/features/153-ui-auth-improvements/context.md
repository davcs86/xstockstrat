# Context: ui-auth-improvements

**Feature**: `docs/roadmap/features/153-ui-auth-improvements/feature.md`
**Product Spec**: `docs/roadmap/features/153-ui-auth-improvements/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/153-ui-auth-improvements/implementation-spec.md`

---

## Session 2026-08-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Grounding findings from recon while writing the spec:
  - Cookies are set in `src/lib/auth.ts::setSessionCookies` with **no `maxAge`** → session cookies,
    dropped on browser close. This is the real cause of "not staying signed in," not token TTL.
  - Server-side TTLs (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`):
    `identity.jwt.access_ttl_seconds` default 900 (15m); `identity.jwt.refresh_ttl_seconds`
    default 2592000 (30d). A 7-day persistent cookie is fully backed → no identity/proto change.
  - `AuthenticateUserRequest` is email+password only; extended session is a UI cookie-persistence
    concern → no proto change.
  - Browser data calls go through per-segment BFFs via `src/lib/browserClients/*.ts`, each creating
    its own `createConnectTransport({ baseUrl })` inline (~15 files, no shared factory). FR-6 (401
    redirect on all clients) points at consolidating onto a shared transport factory — flagged as an
    Open Question and tied to the recurring "forgot the shared consumer" ledger-fails pattern.
  - `middleware.ts` already redirects **browser navigations** to `/auth/login` on missing/expired
    session; this feature adds the **client-side data-call** 401 path only.
- Open forks left for `/sdd-design`: extended-session duration source (constant vs config key);
  shared-transport-factory refactor; redirect-loop guard on the login page.
