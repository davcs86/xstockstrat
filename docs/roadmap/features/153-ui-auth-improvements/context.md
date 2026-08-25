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

## Session 2026-08-25 — sdd-design (quick)

- Phase 0 Recon: wrote recon.md (service: xstockstrat-ui). Key reuse: extend `setSessionCookies`
  (no fork); single `makeBrowserTransport` factory over the 14 inline `browserClients/*.ts`
  transports; reuse middleware's `/auth/login?redirect=` shape.
- Phase 1 Grilling: 1 round (quick). Proposer approach + design-adversary attack. Adversary raised
  4 material findings: (1) `/accounts` is REST, not connect-web — the factory alone leaves it
  unguarded; (2) streaming RPCs (alert stream, order updates) swallow errors and a unary interceptor
  won't observe mid-stream 401s; (3) unconditional redirect bounces refreshable sessions every ~15m
  (access TTL 900s); (4) the FR-4 `604800≤2592000` unit test is a tautology.
- **User gate (AskUserQuestion) decided the 3 genuine forks:**
  - 401 behavior → **refresh-first, then redirect** (attempt `/api/auth/refresh` once; redirect only
    on refresh failure).
  - Coverage → **everything** — connect-web unary + `/accounts` REST + the two streaming RPCs.
  - Session length → **14 days, hardcoded constant, documented** (`REMEMBER_ME_MAX_AGE_SECONDS =
    1_209_600`); FR-4 downgraded from a test to a documented ≤ `identity.jwt.refresh_ttl_seconds`
    coupling comment.
- Chosen approach: one browser-only `src/lib/authRedirect.ts` core (`shouldRedirectToLogin`,
  `buildLoginRedirect`, deduped `attemptRefresh`, `redirectToLogin`, `handleUnauthorized`, `apiFetch`)
  consumed by both a new `src/lib/browserClients/transport.ts` (`makeBrowserTransport` + unary/stream
  interceptor) and the `/accounts` REST fetch sites. Remember-me: `setSessionCookies(...,{maxAge})`,
  login route reads `body.rememberMe`, opt-in `showRememberMe` checkbox in `CredentialsForm` (off on
  OAuth login).
- Constitution touched: C-11 (forks surfaced, not guessed), C-14 (surface = all UI segments + login),
  C-10 family (single factory/core so no client left unguarded + parity guard test), DRY, Edge-trap
  (authRedirect/transport are browser-only). Floor breaches: none.
- Open risks carried: streaming not replayed on refresh-success (recovers on next navigation);
  `/api/auth/me` + `/accounts/api/agent-health` deliberately scoped out of the 401 redirect;
  refresh must be a true single-in-flight singleton.
- Status: draft → design-approved.

## Session 2026-08-25 — sdd-spec + sdd-execute

- Wrote implementation-spec.md (9 steps) and executed all on branch `claude/ui-auth-improvements-apn1ya`
  (harness-designated single-branch flow, not per-step feature branches).
- Files changed:
  - `src/lib/auth.ts` — `REMEMBER_ME_MAX_AGE_SECONDS = 1_209_600` (14d, documented ≤ 30d refresh TTL);
    `setSessionCookies` gained optional `{maxAge}`.
  - `src/app/api/auth/login/route.ts` — reads `body.rememberMe`, persists cookies when true.
  - `src/components/auth/AuthForm.tsx` — opt-in `showRememberMe` checkbox + `rememberMe` field.
  - `src/app/auth/login/page.tsx` — passes `showRememberMe` (OAuth login untouched).
  - NEW `src/lib/authRedirect.ts` — shared refresh-first/redirect core (`shouldRedirectToLogin`,
    `buildLoginRedirect`, deduped `attemptRefresh`, `redirectToLogin`, `handleUnauthorized`, `apiFetch`).
  - NEW `src/lib/browserClients/transport.ts` — `makeBrowserTransport` + unary/stream 401 interceptor.
  - All 14 `src/lib/browserClients/*.ts` refactored onto `makeBrowserTransport`.
  - `/accounts` data pages (profile, mcp-tools, authorized-apps) → `apiFetch`; agent-health/`me` left as-is.
  - Tests: `auth.test.ts` (+3), NEW `authRedirect.test.ts` (6); e2e `auth.spec.ts` remember-me/checkbox.
  - `services/xstockstrat-ui/CLAUDE.md` — documented the transport factory + authRedirect core.
- Verification: `pnpm test:unit` → 116/116 pass; `pnpm lint` → no errors (pre-existing warnings only);
  `pnpm build` → exit 0 (Edge-runtime trap avoided, middleware bundled OK).
- Testing boundary: AC-5/6/7 (client 401 interceptor) covered by unit tests on the pure core; a
  deterministic browser-interceptor e2e was not added (mock harness can't orchestrate mid-session
  token expiry + failing refresh) — documented in implementation-spec Step 8.
- context-scrubber: the context-forge plugin is not available in this session, so `/context-scrubber
  scan` could not be run (noted per root CLAUDE.md teardown rule).
- Status: in-progress → code-completed.
