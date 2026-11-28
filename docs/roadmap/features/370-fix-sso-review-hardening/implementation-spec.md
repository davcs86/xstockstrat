# Implementation Spec: fix-sso-review-hardening

**Status**: `pending`
**Created**: 2026-11-28
**Feature**: `docs/roadmap/features/370-fix-sso-review-hardening/feature.md`
**Total Steps**: 6
**Feature Branch**: `claude/345-sso-security-nits`

---

## Execution Summary

Five independent hardening fixes, one atomic test+service unit each (Steps 1–5), then docs (Step 6).
Step 1 (middleware) precedes Step 3 (link binding) because Step 3's pre-rotation relies on the
middleware forwarding rotated cookies. No design phase ran (Track C step 3 is optional; see
context.md). No proto, migration or config-key change. Consumer surface: `xstockstrat-ui` `/accounts/sso`
(link flow) and the agent MCP bearer path; both are touched directly by Steps 3–5.

Scenario coverage: AC-1, AC-2, AC-3 → Step 1 · AC-4 → Step 2 · AC-5, AC-6, AC-7 → Step 3 ·
AC-8, AC-9 → Step 4 · AC-10 → Step 5.

## Step Dependencies

- Step 3 requires Step 1: a session rotated by the middleware must reach the link handler with its new `refresh_token`.
- Each of Steps 1–5 is one atomic unit (its RED test references only existing symbols; implementation in the same commit).

---

### Step 1 — service+test: UI middleware strips identity headers and forwards rotated cookies

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/middleware.ts` — modify
- `services/xstockstrat-ui/src/middleware.test.ts` — modify

**Reviewers**: ui owner — auth edge
**Codebase Evidence**:
- `grep -n "Object.fromEntries(req.headers)" services/xstockstrat-ui/src/middleware.ts` → lines 72, 113, 129
- Early returns without a request override: `return NextResponse.next();` lines 45, 50, 52, 60
- Constants: `services/xstockstrat-ui/src/lib/headers.ts` `HEADER_USER_ID`, `HEADER_ACCESS_SCOPE`, `HEADER_TRACE_ID`
**TDD**: `red-green required`
**Covers**: `AC-1, AC-2, AC-3`
**Instructions**: One local helper builds the forwarded headers: copy `req.headers`, delete
`HEADER_USER_ID` and `HEADER_ACCESS_SCOPE`, set `HEADER_TRACE_ID`; when given rotated tokens, rewrite
the `cookie` header's `access_token`/`refresh_token`. Use it on every `NextResponse.next` path. Tests
read Next's `x-middleware-request-*` / `x-middleware-override-headers` response headers.
**Verification**: `cd services/xstockstrat-ui && pnpm exec vitest run src/middleware.test.ts && pnpm run typecheck && pnpm run lint`

---

### Step 2 — service+test: identity refuses IssueSessionForUser / ResolveExternalIdentity in `local`

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/__tests__/externalIdentity.test.ts` — modify

**Reviewers**: identity owner — auth RPCs
**Codebase Evidence**:
- `grep -n "readAuthMode(this.config) !== 'both'" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` → `linkExternalIdentity`, `{ code: 9, message: 'link disabled' }`
- Callers only run outside `local`: UI `api/auth/sso/callback/route.ts:42` (404 in `local`); agent `app/main.py` `_handle_oidc` (only when `current_auth_mode() == "oidc"`); all read `identity/auth.mode`.
**TDD**: `red-green required`
**Covers**: `AC-4`
**Instructions**: After the SAN gate and argument checks, `if (readAuthMode(this.config) === 'local') return callback({ code: 9, message: 'sso disabled' });` in both RPCs, before any pool access. The UI maps FAILED_PRECONDITION from Resolve via `resolveRefusalCode` and from Issue to `inactive`; neither is reachable in `local` (route 404s first).
**Verification**: `cd services/xstockstrat-identity && pnpm test && pnpm run lint`

---

### Step 3 — service+test: link transaction bound to the session's refresh-token hash

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/ssoTxn.ts` — modify (`session_hash` on the link txn and `SsoLink`; `sessionHash()`; `sessionHashMatches()`)
- `services/xstockstrat-ui/src/app/accounts/api/sso/link/route.ts` — modify (TTL guard, pre-rotation, bind)
- `services/xstockstrat-ui/src/app/api/auth/sso/callback/route.ts` — modify (`completeLink` copies `session_hash`)
- `services/xstockstrat-ui/src/app/accounts/api/sso/confirm/route.ts` — modify (constant-time compare)
- matching `*.test.ts` — modify

**Reviewers**: ui owner — auth edge
**Codebase Evidence**:
- `services/xstockstrat-ui/src/lib/ssoTxn.ts:22-30` link txn `user_id`, `created_at`; `TXN_TTL_S = 600`
- `services/xstockstrat-ui/src/app/accounts/api/sso/confirm/route.ts:33` `link.user_id !== claims.user_id || link.link_id !== body?.linkId`
- identity `issueRefreshToken`: `token_hash = sha256(refreshToken).hex`
- `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 60` (`src/lib/auth.ts:13`); `refreshSession` (`src/lib/identity.ts:14`)
**TDD**: `red-green required`
**Covers**: `AC-5, AC-6, AC-7`
**Instructions**: Link start: no `refresh_token` cookie → 401; `expires_at − issued_at < TXN_TTL_S + ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` → `serverLog.warn('sso_link_refused', {reason:'access_ttl_too_short'})`, 503 `failed`; remaining below the same bound → `refreshSession`, verify the rotated access token passes the same bound (else the TTL refusal), set rotated cookies with `rememberMeOptsFromRequest`. Seal `session_hash = sessionHash(refresh)`. Confirm: refuse (`failed`, 400, clear link) unless `sessionHashMatches(link.session_hash, refresh_token cookie)` (`timingSafeEqual`).
**Verification**: `cd services/xstockstrat-ui && pnpm exec vitest run src/lib/ssoTxn.test.ts src/app/accounts/api/sso src/app/api/auth/sso && pnpm run typecheck && pnpm run lint`

---

### Step 4 — service+test: SSO cookie hygiene

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/auth/sso/callback/route.ts` — modify
- `services/xstockstrat-ui/src/lib/ssoTxn.ts` — modify (`ssoLinkCookieOpts` path)
- matching `*.test.ts` — modify

**Reviewers**: ui owner — auth edge
**Codebase Evidence**:
- `callback/route.ts:63-64` `fail` passes no `clearTxnCookie`; `:86` exchange failure; `:100,:108` resolve/issue failures; `completeLink` `linkFailed`
- `ssoTxn.ts:117` `path: '/'`; readers `grep -rn SSO_LINK_COOKIE src` → `accounts/api/sso/route.ts`, `accounts/api/sso/confirm/route.ts`
**TDD**: `red-green required`
**Covers**: `AC-8, AC-9`
**Instructions**: Every failure after `txn` is opened passes `clearTxnCookie: cookieName` (`fail`, `loginFail` in resolve/issue, `completeLink` failures). `ssoLinkCookieOpts` path → `'/accounts/api/sso'` (a named constant).
**Verification**: as Step 3

---

### Step 5 — service+test: agent JWKS skips non-signing keys

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/jwks.py` — modify
- `services/xstockstrat-agent/tests/test_jwks.py` — modify

**Reviewers**: agent owner — MCP auth
**Codebase Evidence**: `app/jwks.py` `_ingest`: `log.warning("jwks key skipped", extra={"reason": "kid_or_alg"})`
**TDD**: `red-green required`
**Covers**: `AC-10`
**Instructions**: In `_ingest`, after the kid/alg check: `if "use" in jwk and jwk["use"] != "sig":` warn `reason: "use"` and `continue`. Test data single-consumer inline (C-13).
**Verification**: `cd services/xstockstrat-agent && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`

---

### Step 6 — docs: behaviour docs and 345 context

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/patterns/frontend-auth.md` — modify (middleware strips identity headers; rotated cookies forwarded)
- `docs/roadmap/features/345-authelia-sso/context.md` — modify (owner request, coordinator decision)
- service docs that state the changed behaviour (grep `sso_link`, `IssueSessionForUser`, `_ingest`)

**Reviewers**: none
**TDD**: `N/A (docs)`
**Covers**: —
**Verification**: `grep -n "x-user-id" docs/patterns/frontend-auth.md`

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
