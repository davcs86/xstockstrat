# Design: authelia-sso

**Created**: 2026-11-24 (re-run after the owner re-spec; the 2026-11-16 design is superseded and stays in git history)
**Rounds**: 13 total; this run 4 (rounds 10–13, full; termination: approved)
**Approved by**: user @ 2026-11-24 (round-13 gate)
**Grounded in**: recon.md (2026-11-24)
**Debate register**: debate.md (this run: D-101..D-137, R-23..R-30, O-85..O-127, P-4..P-5)

---

## Chosen Approach

The text below is the round-13 consolidated design (proposer), approved with four amendments listed first; where they
differ, the amendments win. Every claim is cited to code at `ccr-589817f0-cyg7gy` (re-verified by the round-13
adversary). Consumer surfaces (C-14): the UI login page, `/accounts/sso`, `/accounts/authorized-apps`, the shared-header
Sign-out, the UI discovery documents (all `xstockstrat-ui`), and every MCP tool's authentication in `oidc`
(`xstockstrat-agent`); the operator surface is `scripts/manage-users.py`.

### Amendments at approval (override the text below)

- **D-134 Loader-fault scope.** Only the mode-branch reads (`loadAuthMode`, `loadOidcConfig`, `loadAgentIssuer`) follow a
  surface's config-`error` row. Secret faults follow each surface's own row: start → login `failed`; link start → 503
  `failed`; callback step 5 → `failed` at the purpose destination (D-113); logout → portal URL per D-52, and `found=false`
  → portal URL. `linked = issuerValid(ui.oidc.issuer) ? issuers.includes(issuer) : issuers.length > 0`; on a `ui` read
  fault, `issuers.length > 0`.
- **D-135 Precision.** FR-16.2: a Link failure returns to `/accounts/sso` only once the callback has *opened* the link
  transaction (after the mode and configuration checks); before that, or with a missing or expired transaction, it goes
  to the login page. D-132's local decrypt is `openSsoTxn` (decrypt + `exp`). AC-46's extension also asserts the PRM and
  is a labelled guard; AC-76 adopted; `adminDirectory.test.ts` imports `fixtures/sanCall.ts`; AC-28 waits with
  `await new Promise(setImmediate)`.
- **D-136** In `oidc`, an unreadable `agent/oidc.issuer` makes the UI's protected-resource document answer 503 `no-store`
  (as for an invalid issuer). D-133's fallback to today's documents applies only when the mode itself is unreadable.
- **D-137** Link `no_access` copy: "Your single sign-on account doesn't have access to xstockstrat. Ask an admin."

### 0. Summary

**Mode key.** One key, `identity/auth.mode` (`local` | `both` | `oidc`). The seed and the code default are both `local`, and every reader reads it globally (D-101/D-121).

**Identity** always runs (D-112). It gains:
- four RPCs, each gated by the exact peer SAN (D-103);
- table `007_external_identities` (D-104);
- a password gate in `oidc` only (D-102);
- a Link refusal outside `both` (D-126);
- `watchAuthMode`, which parses the mode at startup and on every config update (D-115/D-129).

**Agent.**
- `local` / `both`: today's `_authorized`, byte for byte.
- `oidc`: accepts issuer JWTs only, uses a 60 s cache that keeps successes only, and stamps the effective scope (D-105).

**UI.** In `both` / `oidc` it is a confidential OIDC relying party.
- Anonymous login goes through `/api/auth/sso/{start,callback}`.
- Linking goes through three session-gated routes: `GET /accounts/api/sso`, `POST /accounts/api/sso/link` and `POST /accounts/api/sso/confirm`. They share the one callback, which branches on the sealed `purpose` (D-107/D-111/D-113/D-125/D-132).
- Logout follows the web mode.
- Authorized-apps and the UI's discovery documents follow the MCP mode (`oidc` only). When config is unreadable, both discovery documents serve today's documents (D-133).

**Operator.** `manage-users.py set-auth-mode` sets the mode without a login (D-108), and `unlink-sso` removes links (FR-12).

**Build order.** proto → identity `007` + config seed → identity → config grant → agent → UI → scripts and docs. Every intermediate state behaves as `local` (D-109), except FR-15's every-mode logout changes (Origin 403, JSON on an expired session, the Sign-out button), which ship with the UI.

### 1. Identity (`services/xstockstrat-identity`)

**`src/authMode.ts` (D-101/D-121/D-129/D-130a)**
- `readAuthMode(config)` wraps `getString('auth.mode','local')` (`src/services/configWatcher.ts:203`) and returns `'local'|'both'|'oidc'`.
  - An absent row reads as `local` and never logs `auth_mode_invalid`. The watcher's own absent-key WARN still fires (`configWatcher.ts:184,193`).
  - Any present value outside the three, `""` included, reads as `local` and logs `auth_mode_invalid` once per distinct value. The "seen" set is module-level.
- `watchAuthMode(watcher: {getString; on('update', fn)})` parses once immediately, then on every `'update'` event (emitted at `configWatcher.ts:107`).
  - It is unit-tested with an `EventEmitter` fake that has `getString`.
  - `src/index.ts` gets a one-line `watchAuthMode(configWatcher)` after the snapshot log (`:24-26`). That line is covered by a labelled grep guard, because `index.ts` runs `main()` at import (`:71`).
  - `configWatcher.ts` is not edited (`scripts/check-watcher-copies.py`).
- `authenticateUser` and `linkExternalIdentity` call `readAuthMode(this.config)` per request.

**SAN gate.** `adminDirectory.ts` exports `peerDnsSans` (`:12-19`) and a new `hasPeerSan(call, allowed)`. Each RPC has its own allow-list and its own `PERMISSION_DENIED` message. The check runs before any pool access, in the `:37-40` shape.

**Helpers.**
- `verifyPassword(selector, password)` takes a selector by email (exact `email = $1`, `identityServiceImpl.ts:158`) or by `user_id` (no `is_active` filter). It returns `{ok,user}` or one of `unknown|inactive|blocked_default_admin|bad_password`, and records no metric (D-102).
- `sessionResponse({accessToken, issuedAt, expiresAt}, refreshToken, claims)` is a pure builder with every argument required. It replaces the literals at `:189-200` and `:258-269` (D-122).

**RPC contract.** The SAN check always runs first, and headers are never used for authorization.

| RPC | Allowed SAN | Order → success | Refusals (code / detail) |
|---|---|---|---|
| `ResolveExternalIdentity{issuer=1,subject=2}` → `{user_id=1, repeated Role roles=2, is_active=3}` | ui, agent | SAN → fields → one JOIN read `external_identities e JOIN users u USING(user_id) WHERE issuer=$1 AND subject=$2`; roles via `stringsToRoles` (`:40-43`); writes nothing | 7 `peer not authorized for ResolveExternalIdentity`; 3 `issuer and subject required`; 9 `not linked`; 9 `account inactive`; 13 `resolve failed` |
| `IssueSessionForUser{user_id=1}` → `AuthTokenResponse` | ui | SAN → fields → SELECT the stored email, roles and is_active → `mintAccessToken` + `issueRefreshToken` (`:304-343`) → `sessionResponse` | 7; 3; 5 `user not found` (D-72 remainder); 9 `account inactive`; 13 |
| `LinkExternalIdentity{user_id=1,issuer=2,subject=3,password=4}` → `{}` | ui | SAN → fields → mode ≠ `both` gives 9 `link disabled`, with no DB access and no bcrypt (D-126) → `verifyPassword({userId})` → one autocommit INSERT → `callback` → `void auditSafe('identity.external.linked', user_id, call.metadata, {user_id, issuer, outcome:'linked'})` (`:777-788`) | 7; 3; 9 `link disabled`; 9 `invalid credentials` (unknown user, bad password or `blocked_default_admin`); 9 `account inactive`; 9 `account already linked`; 9 `already linked to this issuer`; 13 `link failed` |
| `GetExternalIdentityLinks{user_id=1}` → `{repeated string issuers=1}` | ui | SAN → fields → `SELECT issuer … WHERE user_id=$1 ORDER BY issuer`; an unknown user returns `[]` | 7; 3; 13 |
| `AuthenticateUser` (changed) | n/a | Unchanged in `local` / `both`. In `oidc`, after the missing-fields check (`:152-155`) and before the query: 7 `password login disabled` + `recordLoginFailure('password_login_disabled')` | — |

**Link 23505 classification.** It uses `err.constraint`, before `mapDbError` (`:116-120`). The constraint names are code constants, asserted equal to `007`'s SQL (D-118).
- `external_identities_issuer_user_key` → `already linked to this issuer`.
- `external_identities_pkey` → one re-read of the owner:
  - same user → `already linked to this issuer`;
  - another user → `account already linked`;
  - no row → retry the INSERT once.

**Refusal contract (D-123/D-130e).** Identity exports `EXTERNAL_IDENTITY_REFUSALS`, partitioned the same way as the vector file:

```json
"refusals": {
  "resolve": ["not linked", "account inactive"],
  "link":    ["invalid credentials", "account inactive", "account already linked",
              "already linked to this issuer", "link disabled"],
  "session": ["account inactive"]
}
```

- This is a new section of `scripts/testdata/oidc-issuer-vectors.json`, alongside the `issuer`, `app_url`, `mode` and `prm` sections.
- The UI's `src/lib/ssoRefusals.ts` mirrors all three partitions. The agent mirrors `resolve`.
- Each of the three languages asserts that its constant equals the JSON.
- The vector file is added to the identity, UI and agent `changes` filters (`.github/workflows/ci.yml:62,64,59`).

**Telemetry.**
- `AUDIT_EVENT_TYPES` (`telemetry.ts:381-388`) gains `identity.external.linked`, so `recordAuditFailure` labels it specifically (`:426-429`). Its doc comment "user.* event types" becomes "audited event types".
- `LoginFailureReason` (`:357-362`) gains `password_login_disabled`.
- New closed-label counter `identity.link.failures{reason: invalid_credentials|inactive|already_linked|already_linked_issuer|link_disabled|internal}`. Link never calls `recordLoginFailure`.
- **`CLAUDE.md` § Observability** lists `identity.external.linked` among the audited types and adds `identity.link.failures` (D-130f).

**Test fixtures.** One `fakeConfig()` with `getString` (R-6, C-13), and `src/__tests__/fixtures/sanCall.ts`.

**Migration `007_external_identities`.**
- `CREATE TABLE IF NOT EXISTS`.
- Named constraints `external_identities_pkey (issuer, subject)` and `external_identities_issuer_user_key (issuer, user_id)`.
- FK `ON DELETE CASCADE`.
- Down: `DROP TABLE IF EXISTS`.

### 2. Agent (`services/xstockstrat-agent`)

**Setup.**
- `WATCHED_NAMESPACES` (`app/config/watcher.py:16`) gains `identity`.
- `app/sso_mode.py` provides `current_auth_mode()`, `agent_issuer()` and `_log_once`. The issuer grammar is pinned to the vector file (D-79/D-88).
- An absent mode row reads as `local` without `auth_mode_invalid`. `watch_core.py:199`'s own absent-key WARN stays.
- `handle_mcp` (`main.py:195-221`) reads the mode on every request.

**Routes by mode.**

| Path | `local` / `both` | `oidc` |
|---|---|---|
| MCP `/` | today's `_authorized` (`main.py:140-163`) | the status map below |
| `/.well-known/oauth-protected-resource` | byte-identical (`oauth_metadata.py:19`) | valid issuer: the vector file's `prm.expected` object built from `AGENT_PUBLIC_URL` + issuer; invalid issuer: 503 text/plain, `Cache-Control: no-store` |
| `/.well-known/oauth-authorization-server`, `/oauth/{register,authorize,callback,token}` | unchanged | `_legacy_only` → 404 text/plain. The routes stay registered (`main.py:236-251`, recon R-5) |

**MCP status map in `oidc`, in order.** Every 503 is text/plain with no `WWW-Authenticate` (`main.py:178-182`).
1. Invalid `agent/oidc.issuer` → 503, label `internal_error`, ERROR `sso_issuer_invalid` once per value. This runs before the bearer check (AC-55).
2. No bearer → 401 + `WWW-Authenticate` (`_send_unauthorized`, `:165-176`), label `missing_bearer`.
3. Pre-checks, outside the deadline (D-69/D-84/D-88). Each failure → 401, `invalid_token`.
   - The header must carry a `kid`.
   - `alg` must be in the asymmetric allow-list; HS256 and `none` are refused.
   - The unverified `iss` must equal the issuer.
   - Garbage tokens are refused.
4. JWKS lookup under one `asyncio.timeout_at` (D-18/D-31):
   - unknown `kid` and the fetch failed or timed out → 503 `jwks_unavailable`;
   - unknown `kid` and the fetch succeeded → 401.
5. Verified decode (any failure → 401):
   - leeway 30 with a strict `exp` (D-25);
   - `aud` = `X` or `[X]` (D-26), label `wrong_audience`;
   - `typ` `at+jwt` (D-95);
   - `require` exp, iss, aud and sub; `sub` must be a non-empty `str`.
6. Cache hit (60 s, successes only, D-13/D-30) → stamp.
7. `ResolveExternalIdentity` with `x-trace-id` and the remaining budget:
   - FAILED_PRECONDITION with a detail in `refusals.resolve` → **403 text/plain, body = the detail**, label `account_refused`;
   - any other detail → 503 `internal_error` + ERROR (R-30);
   - UNAVAILABLE, DEADLINE_EXCEEDED or the overall deadline → 503 `identity_unavailable`;
   - anything else → 503 `internal_error` + ERROR naming the exception class.

**Stamping.**
- Stamped claims: `{user_id, roles:[Role.Name(r).removeprefix('ROLE_').lower()], access_scope: roles_to_access_scope(roles) & scopes_to_mask(claims), trace_id}`.
- `scopes_to_mask` takes `scp` when it is a `list[str]`, else a split `scope` string, else 0 (D-95).
- `scopes.effective_access_scope` tests for the key's presence at both `tools.py:148` and `tools.py:218` (D-105).
- `record_auth_rejected` (`tool_metrics.py:36`) gains `jwks_unavailable` and `account_refused`.
- `pyjwt[crypto]` becomes a direct dependency, with `uv lock` (D-2).

### 3. UI (`services/xstockstrat-ui`)

**Config loaders (`src/lib/oidcConfig.ts`).**
- Each is a one-shot read with `environment: nativeConfigEnvironment()` (`deploymentEnv.ts:13-15`), `userId:''` and `timeoutMs: AUTH_CONFIG_TIMEOUT_MS`, using oneof-presence reads (`trader/positions/page.tsx:128`).
- **Every loader returns `'error'` on a read fault or timeout. A surface treats any of its loaders' `'error'` exactly like its row in the "config `error`" column below** (A3).

| Loader | Reads | Headers | Returns |
|---|---|---|---|
| `loadAuthMode()` | `GetConfig` namespace `identity` | none | `'local'\|'both'\|'oidc'\|'error'` (absent row → `local`, no log) |
| `loadOidcConfig()` | `GetConfig` namespace `ui` | none | `{issuer, clientId, mcpClientIds, valid}\|'error'`. Valid iff: D-79 issuer ∧ non-empty `clientId` ∧ non-null `appOrigin()` (D-125) |
| `loadOidcClientSecret()` | `GetSecret` `ui`/`oidc.client_secret` | `{[HEADER_INTERNAL_CALLER]: 'ui'}` only. The grant fails closed without it (`services/xstockstrat-config/src/grpc/authz.ts:183-184`); precedent `notify commsgunSecret.ts:43` | `{found, value}\|'error'` |
| `loadAgentIssuer()` | `GetConfig` namespace `agent` | none | `{issuer, valid}\|'error'` |

`HEADER_INTERNAL_CALLER = 'x-internal-caller'` joins `src/lib/headers.ts`, beside `:5-7` (D-130d).

**Error codes (`src/lib/ssoErrors.ts`).**

`SSO_ERROR_CODES` (login page):

| Code | Message |
|---|---|
| `failed` | "Sign-in failed. Try again." |
| `not_configured` | "SSO not configured" |
| `not_linked` | `both`: "Your single sign-on account isn't linked to an xstockstrat account. Sign in with your password and choose Link SSO, or ask an admin."<br>`oidc`: "…isn't linked to an xstockstrat account. Ask an admin." |
| `inactive` | "This account is disabled. Ask an admin." |
| `no_access` | "You don't have access to xstockstrat. Ask an admin." |

`LINK_ERROR_CODES` (`/accounts/sso`):

| Code | Message |
|---|---|
| `failed` | "Sign-in failed. Try again." |
| `not_configured` | "SSO not configured" |
| `no_access` (D-132) | "Your single sign-on account doesn't have access to xstockstrat. Ask an admin." |
| `invalid_credentials` | "Incorrect password." |
| `inactive` | "This account is disabled. Ask an admin." |
| `already_linked_other` | "This sign-in is already linked to another account. Ask an admin." |
| `already_linked_self` | "This account is already linked to a single sign-on account. Ask an admin to unlink it first." |

**`ssoErrorRedirect`**
- Signature: `ssoErrorRedirect(target: {dest:'login', code: SsoErrorCode} | {dest:'link', code: LinkErrorCode}, appOrigin, {fault, clearTxnCookie}): NextResponse`.
- It returns a 303 built with `new NextResponse` (D-82) to `/auth/login?error=…` or `/accounts/sso?error=…`.
- With `appOrigin` null, the `Location` is relative (D-82, per D-131).
- It records exactly one literal event: `sso_login_failed{reason}` or `sso_link_failed{reason}` (D-72 remainder, D-83, D-113).
- `bffAllowlist.test.ts` pins both events and has an `@ts-expect-error` for a link code sent to the login page.

**Txn cookie (`src/lib/ssoTxn.ts`).**
- Format: a D-8 JWE named `sso_txn_<16 hex sha256(state)>` (D-23).
- Attributes: path `/api/auth/sso/callback`, Max-Age 600, httpOnly, Lax, `secure: isProduction` (`auth.ts:53-54`).
- Payload:
  ```ts
  type SsoTxn =
    | { purpose:'login'; state; nonce; code_verifier; remember:boolean; redirect:string; exp:number }
    | { purpose:'link';  state; nonce; code_verifier; user_id:string; created_at:number; exp:number };
  ```
- `openSsoTxn` decrypts the cookie and refuses `now > exp`. It makes no network call.

**`sso_link` cookie.**
- A JWE with HKDF label `xstockstrat-ui/sso-link`.
- Attributes: `HttpOnly; Path=/; Lax; secure: isProduction`, Max-Age `txn.exp − now`.
- Payload: `{link_id, iss, sub, label, user_id, exp: txn.exp}`.

**UI routes.**

| Route | `local` | `both` / `oidc` | config `error` |
|---|---|---|---|
| `/auth/login` (server page, reads only `auth.mode`) | `CredentialsForm` | `both`: `SsoSignInForm` + `CredentialsForm`<br>`oidc`: `SsoSignInForm` only<br>Rendered even with an invalid web config | `CredentialsForm` (AC-46) |
| `POST /api/auth/sso/start` (GET → 405) | 404 | invalid web config → login `not_configured` (+ERROR once)<br>→ `isSameOrigin(req,'required')` fails → login `failed`<br>→ secret unset → `not_configured`<br>→ GetSecret or discovery fault → `failed`<br>→ 303 to the issuer (`scope=OIDC_SCOPE`, `response_mode=query`, PKCE S256, `state`, `nonce`) + login txn | login `failed` |
| `GET /api/auth/sso/callback` | 404, no redirect | the callback order below | login `failed` |
| `POST /api/auth/login` | today | `both`: today<br>`oidc`: 403 `{"error":"login_disabled"}` + `login_disabled` event; 401 stays "Invalid credentials" | today |
| `POST /api/auth/logout` | step 0: Origin `if_present` mismatch → 403, no revoke, no cookie change (D-77/D-80)<br>→ verify (D-61) → revoke iff verified → clear the session cookies + `sso_link` → `{ok:true}` | same steps, then `{ok:true, redirect}` when verified and the web config is valid. The redirect is the end-session URL if advertised and same-origin, else `${issuer}/logout?rd=${APP_URL}/auth/login` (D-97). Invalid config → `{ok:true}` | same steps → `{ok:true}` + WARN `sso_logout_mode_unknown` |
| `GET /accounts/api/sso` | 200 `{mode, linked, canLink:false, pending:null}` | the link-route table below | 200 `{mode:'error', linked, canLink:false, pending:null}` |
| `POST /accounts/api/sso/link`, `/confirm` | 404 `{error:'not_found'}` | `both`: the link-route table below<br>`oidc`: 404 | 503 `{error:'failed'}` |
| `/accounts/authorized-apps` | `AuthorizedAppsList` (moved verbatim, D-116) | `both`: the list<br>`oidc`: `SsoAppsCard` (issuer link only when valid; connector URL + copy; four client-ID rows, each hidden when empty) | the list |
| UI `/.well-known/oauth-protected-resource/agent` | unchanged (`api/oauth/protected-resource/route.ts:8-14`) | `both`: unchanged<br>`oidc` + valid agent issuer: the vector `prm.expected` object<br>`oidc` + invalid agent issuer: 503 `no-store` | **unchanged, today's document** (D-133) |
| UI `/.well-known/oauth-authorization-server/agent` | unchanged (`api/oauth/authorization-server/route.ts:8-19`) | `both`: unchanged<br>`oidc`: 404 | **unchanged, today's document** (D-133) |

**Callback order (both purposes).** The `Location` is always built on `appOrigin`.
1. Mode: `local` → 404; `error` → login `failed` (fault).
2. Web config invalid → login `not_configured`.
3. IdP `error` parameter (D-58 as amended by D-132):
   - If `state` is present, clear `sso_txn_<hash(state)>`.
   - If that cookie also opens locally through `openSsoTxn` (no network call) with `purpose:'link'`, the destination is the link page: `access_denied` → `no_access`, anything else → `failed`, recording `sso_link_failed`.
   - Otherwise the destination is the login page: `access_denied` → `no_access`, anything else → `failed`, recording `sso_login_failed`.
4. Missing, undecryptable or expired txn → login `failed`. No network call has happened yet. **From here on, `txn.purpose` picks the destination.**
5. Secret `found=false` or empty → `not_configured`; a GetSecret fault → `failed`.
6. `getOidcConfiguration` (D-34/D-70/D-87/D-89), then `authorizationCodeGrant(cfg, url, {pkceCodeVerifier, expectedState, expectedNonce, idTokenExpected:true})`. Any throw → `failed`, logging only the error class (D-75).
7. Branch on purpose.
   - **`login`:**
     - `ResolveExternalIdentity` with `x-trace-id` (D-114): `not linked` → `not_linked`; `account inactive` → `inactive`; anything else → `failed`.
     - Then `IssueSessionForUser`: `account inactive` → `inactive`; anything else → `failed`. No cookies are set on any failure.
     - On success: `setSessionCookies(…, remember ? {maxAge} : undefined)`, clear every `sso_txn_*`, 303 to `safeRedirect(redirect)`, event `sso_login_ok`.
   - **`link`:**
     - Step 1's mode must be `both`, else link `failed` (D-125).
     - `auth_time` check (D-111/D-127): `typeof c.auth_time==='number' && Number.isFinite(c.auth_time) && c.auth_time >= txn.created_at − OIDC_CLOCK_SKEW_S`, with `c = tokens.claims()`. Failure → WARN `sso_link_refused{auth_time_missing|auth_time_stale}` + link `failed`.
     - `label = email ?? preferred_username ?? 'your single sign-on account'`.
     - Seal `sso_link`, clear every `sso_txn_*`, 303 to `/accounts/sso`. No identity call.

**Link routes.** All three use `withBffMetrics('accounts', …)`, are not exempt from the middleware, call identity with `restBackendHeaders(req, claims.user_id, claims.roles)` (`restBackendHeaders.ts:9-15`, D-114), and use `timeoutMs: AUTH_CONFIG_TIMEOUT_MS`.

| Route | Order and outcome |
|---|---|
| `GET /accounts/api/sso` | No verified session (`auth.ts:38`) → **401** `{error:'unauthorized'}`<br>→ `GetExternalIdentityLinks` fails → **503** `{error:'failed'}`<br>→ **200** `{mode, linked, canLink, pending}`, where:<br>• `canLink = mode==='both'` (also when already linked, AC-67);<br>• `linked` = valid web config ? `issuers.includes(issuer)` : `issuers.length>0`;<br>• `pending = {linkId, label, accountEmail}` only when `canLink` and a valid `sso_link` matches the session `user_id`;<br>• `accountEmail` is the session JWT's `email` (`auth.ts:7`);<br>• the body never carries `iss` or `sub`. |
| `POST /accounts/api/sso/link` (no body) | 401<br>→ mode gate (404 outside `both`, 503 on `error`)<br>→ invalid web config **400** `not_configured`<br>→ `isSameOrigin('required')` fails **403** `failed`<br>→ secret unset **400** `not_configured`<br>→ GetSecret or discovery fault **503** `failed`<br>→ **200** `{url}` + link txn. The URL carries `prompt=login` and `max_age=0`; `checks.maxAge` is never passed (D-119). |
| `POST /accounts/api/sso/confirm` `{linkId,password}` | 401<br>→ mode gate<br>→ Origin **403** `failed`<br>→ `sso_link` missing, undecryptable or expired, or `user_id` ≠ the session's, or `link_id` ≠ `linkId` → **400** `failed` (cookie cleared)<br>→ empty password → **400** `invalid_credentials` (identity not called)<br>→ `LinkExternalIdentity`, mapped below |

How confirm maps `LinkExternalIdentity`:

| Result | Response | `sso_link` cookie |
|---|---|---|
| OK | 200 `{ok:true}` | cleared |
| `invalid credentials` | 400 `invalid_credentials` | kept (retry; the P-5 edge zone bounds guesses) |
| `account inactive` | 400 `inactive` | cleared |
| `account already linked` | 400 `already_linked_other` | cleared |
| `already linked to this issuer` | 400 `already_linked_self` | cleared |
| `link disabled` | 400 `failed` | cleared |
| UNAVAILABLE, DEADLINE or any other | 503 `failed` | kept |

Every refusal records `sso_link_failed{reason}`. A refusal is never 401, because `apiFetch` retries a 401 (`authRedirect.ts:67-73`); 400 matches `connectCodeToHttp` (`connectClients.ts:134-139`).

**Page `/accounts/sso`** (`'use client'`, D-117).
- Reads go through `apiFetch`. The confirm call uses `apiFetch(…, {redirect:'manual'})`, and an `opaqueredirect` means "go to login" (D-124).
- The password is held in component state across the one retry.
- States use `QueryStateMessages`, `CardNotice` (the `?error=` messages from `LINK_ERROR_CODES`) and `FormDialog` (the confirmation "You are linking {label} to {accountEmail}.").
- Nav entries go beside `navGroups.tsx:104` and in the accounts subnav at `PlatformHeader.tsx:96-97`, with a nav-reachability test.

**Other UI pieces.**
- `SignOutButton` (D-53/D-63).
- Middleware exempt sets (D-40/D-62).
- `OIDC_CLOCK_SKEW_S = 30` in the F-07 form (D-13).
- `openid-client@6.8.9`, exact pin (D-34).
- The `typecheck` CI step (D-93).
- `APP_URL` in compose and in the Playwright env (D-67).
- **E2E:**
  - By default the mock serves **no `identity/auth.mode` row**, which reads as `local` (D-116/D-130e).
  - Every spec that changes the mode lives in one `test.describe.configure({mode:'serial'})` file (D-120).
  - The stub IdP runs on `127.0.0.1` (D-91), with knobs `signWith:'foreign'`, `endSession`, `requireHint` and `authTime:'fresh'|'absent'|'stale'`.
  - IdP-error cases use a `page.route` intercept of the authorization request (D-64), so no new knob is needed.

### 4. Config

| Key | Type | Seed / code default | Readers |
|---|---|---|---|
| `identity/auth.mode` | string | `local` / `local` | identity `src/authMode.ts:readAuthMode`/`watchAuthMode`; UI `loadAuthMode`; agent `sso_mode.py:current_auth_mode` |
| `ui/oidc.issuer`, `ui/oidc.client_id` | string | `""` | UI `loadOidcConfig` |
| `ui/oidc.client_secret` | `is_secret`, `value_data='[redacted]'`, NULL ciphertext | unset (`found=false`) | UI `loadOidcClientSecret` (start, callback, link start, logout) |
| `ui/oidc.mcp_client_id{,_readonly,_claude_code,_claude_code_readonly}` | string | `""` | UI `loadOidcConfig` |
| `agent/oidc.issuer` | string | `""` | agent `sso_mode.py`; UI `loadAgentIssuer` |

**Seed migration `<next free>_authelia_sso_keys` (D-109).**
- 18 rows: the plain shape of `054_*.up.sql` plus the secret shape of `049:57-67`.
- No notify, because the seed equals the code default.
- The down migration deletes only rows that still carry the sentinel `updated_by` and the seed value (`054_*.down.sql:4-10`), plus `value_encrypted IS NULL` for the secret row.

**Other config changes.**
- New `SECRET_CALLER_ALLOWLIST` grant `{callerID:'ui', namespace:'ui', keys:['oidc.client_secret'], peerSan:'xstockstrat-ui'}` (`authz.ts:136-155`).
- `config-wiring.json` receivers: the UI's three namespace bindings and the agent's mode reader.
- `config-governance.md` gains the author sentinel `operator:manage-users`.

### 5. Scripts (`scripts/manage-users.py`)

**`set-auth-mode <local|both|oidc> --environment <production|staging> --reason <text>`** (D-108).
- An invalid value exits 2, names the allowed values and never connects.
- It requires `DATABASE_URL`, with no `.env` fallback.
- It prints the redacted host and database name, then both environments' rows before and after.
- It runs the 055-shaped CTE (`055_*.up.sql:4-23`): `UPDATE … SET value_data, updated_by='operator:manage-users', update_reason, caller_identity=NULL, updated_at=NOW() WHERE namespace='identity' AND key='auth.mode' AND environment=$env AND user_id IS NULL RETURNING …`.
- It **always** issues `pg_notify('config_changed', {namespace:'identity', key:'auth.mode', environment, user_id:null})`, the shape of `configServiceImpl.ts:846-848`.
- A missing row with `local` is success. A missing row with `both` or `oidc` exits 1 ("seed migration not applied").

**`unlink-sso <email> [--issuer] [--force/-f]`** mirrors `delete-user` (`:416-487`, exact `email = %s` lookup at `:448`).
- Confirmation prompt, skipped by `--force`.
- `DELETE … RETURNING issuer`; exit 1 when no rows are deleted.
- **On success it prints "<email> can link again with Link SSO while the deployment's auth.mode is both."** It gives no issuer-email hint (D-130b).

### 6. Cutover gates (homelab, before `set-auth-mode both`; D-119, P-5)

1. A homelab-edge path-scoped rate-limit zone over `POST /accounts/api/sso/confirm` (homelab-edge is adding it to the
   SSO spec's § 4.3 zones, owner 2026-11-24).
2. S17 proven: Authelia re-authenticates on `prompt=login` + `max_age=0` and returns a fresh `auth_time` in the ID token
   (homelab-edge is extending SSO spec S17 to this, owner 2026-11-24).
3. Authelia's web client `xstockstrat[-staging]-web` is registered with scopes `openid profile email` (SSO spec § 4.6 as
   amended 2026-11-24, owner; `OIDC_SCOPE` requests all three, and Authelia refuses a scope the client is not registered
   for with `invalid_scope`, spike item (c)), and its `claims_policy.id_token` includes `email`, `preferred_username`
   and `auth_time`.
4. `manage-users.py reset-password` of the seed row (D-49 N-9).

homelab-edge `docs/runbooks/sso.md` § 6 is to list gates 1–4 (owner, 2026-11-24). Gate 3's scope clause was added
2026-11-24 after the final pre-merge review (D-119 gate 3; context.md).

Runbook pre-checks (`docs/runbooks/authelia-sso-cutover.md`), not gates:
- the config listener is up;
- the issuers and `APP_URL` pass the grammar (D-91/D-81);
- `ui/oidc.client_secret` is set;
- every admin is linked before `oidc`, with recovery via FR-17;
- after `oidc`: the D-42 signals and the D-98 revocation steps.

### 7. Seam table

Seam labels:
- **IU**: identity unit
- **AP**: agent pytest
- **UV**: UI vitest
- **E2E**: Playwright, in the one serial SSO file
- **SP**: `scripts/tests/test_manage_users.py`
- **CU**: config unit
- **DG**: named RED/GREEN `grep -F` docs step
- **G**: labelled guard

| AC | Mechanism | Test seam |
|---|---|---|
| 1 | Callback login branch: Resolve → IssueSession → cookies → 303 | IU (JOIN, `sessionResponse`); UV; E2E |
| 2 | Resolve only selects; IssueSession writes only `refresh_tokens`; the email claim is never sent | IU (fake pool records statements); UV (the Resolve request has no email) |
| 3 | `not linked` → `not_linked`, message per mode | IU; UV; E2E (Outline over both/oidc) |
| 4 | PK 23505 → re-read → `account already linked` → 400 `already_linked_other` | IU; UV; E2E |
| 6 | One database per deployment; Resolve is read-only | IU (AC-3's test with `environment=production`) + **G** |
| 7 | 9 `account inactive` → `inactive` | IU; UV; E2E |
| 10 | D-26 `aud` → 401 + `WWW-Authenticate` | AP `test_sso_auth.py` |
| 11 | Agent PRM in `oidc` = vector `prm.expected` | AP `test_sso_metadata.py` |
| 12, 13 | `effective_access_scope` at `tools.py:148,218`; `scp` | AP `test_sso_scope.py` (both sites) |
| 14 | 60 s cache, successes only | AP (injected clock) |
| 15 | Expired entry + UNAVAILABLE → 503 | AP (no backend stub called) |
| 16 | 7 `password login disabled`; `oidc` render | IU; E2E |
| 17 | `both` → token pair; `both` render | IU; E2E |
| 20, 36 | FR-13 docs | DG |
| 21, 30 | 403 text/plain body from `refusals.resolve`; no backend RPC | AP (vector-driven) |
| 22 | Stamped `user_id`; scope 11 & 3 = 3 | AP |
| 23 | D-69 pre-checks, D-25, D-31 | AP (Outline rows) |
| 24 | D-23 state, D-29 nonce/`aud`, D-34 foreign key | UV `oidcClient.test.ts` + callback UV; Resolve mock not called |
| 25 | Constraint-name classifier; one row | IU (RED on the name branch; constants = `007` SQL) + **G** (`migration-rerun` PK) |
| 27, 38, 70, 73 | `hasPeerSan` before any pool access | IU (`sanCall.ts`; pool spy untouched) |
| 28 | `void auditSafe` after the callback; real `createLedgerAudit('localhost:1')` with `LedgerServiceClient.prototype.appendEvent` patched to fail and `mtls.clientCredentials` made insecure (precedent `identityTelemetry.test.ts:76-92`) | IU: the Link callback returns OK. After one awaited tick, `identity.audit.failures{event_type=identity.external.linked}` = 1 and the ERROR `ledger audit append failed (best-effort)` was logged (`ledgerAudit.ts:66-71`) (D-128) |
| 29 | `remember` in the txn → maxAge; rotation keeps it | UV; E2E |
| 31 | Absent row → `local` | IU; UV; E2E (default mock = row absent, D-130e) |
| 32 | `both` → today's `_authorized`; an RS256 token fails `ValidateToken` | AP |
| 33 | `rotateRefreshToken` `is_active` (`identityServiceImpl.ts:364`) + middleware (PRESERVE) | **G** |
| 34, 48 | `SsoAppsCard` | E2E (`oidc`) |
| 35 | Grant + header; existing redaction | CU `src/__tests__/secretsAndScope.test.ts`: SAN `xstockstrat-ui` + `x-internal-caller ui` → value; SAN `xstockstrat-agent` + `x-internal-caller ui` → denied. UV: `loadOidcClientSecret` sends only `HEADER_INTERNAL_CALLER: 'ui'` |
| 41, 42 | `local` unchanged | **G** (existing `auth.spec.ts`, agent OAuth tests) |
| 43 | `_legacy_only` 404; HS256 pre-check 401 | AP |
| 44, 71 | `set-auth-mode` CTE + always notify → DELTA → `watchAuthMode` | SP (CTE, notify, exit 2 without connecting); IU (`watchAuthMode` with an `EventEmitter` fake: update → re-parse) + **G** (grep `watchAuthMode(configWatcher)` in `src/index.ts`, D-129); AP (snapshot change) + **G** (60 s delivery) |
| 45 | Login page reads only the mode; password POST unchanged in `both` | E2E (stub IdP down) |
| 46 | Any loader `error` → `CredentialsForm`; discovery routes serve today's documents (D-133) | UV (login page; both discovery routes with `loadAuthMode`/`loadAgentIssuer` = `error`); E2E |
| 47 | Start and callback → 404 at step 1 | UV (Resolve mock not called); E2E |
| 49 | Discovery routes by mode; whole PRM from the vector file | UV + AP (both assert `prm.expected`, D-130e) |
| 50 | `unlink-sso` DELETE; Resolve → `not linked`; relink | SP (including the D-130b message); IU + **G** (FK/PK) |
| 51 | IdP `access_denied` on a login txn → login `no_access` | UV; E2E |
| 52, 53 | End-session URL vs portal URL | UV; E2E (`page.route`, D-64) |
| 54 | Invalid web config → `not_configured` before the Origin check; ERROR once | UV (`fetch` never called); E2E |
| 55 | Agent 503 before the bearer check; agent PRM 503; UI PRM 503 (`oidc` + invalid agent issuer) | AP; UV |
| 56 | Logout with invalid config → `{ok:true}` | UV; E2E |
| 57 | Step 0, all modes | UV (Outline; revoke mock not called) |
| 58 | `appOrigin` null → `not_configured`; `if_present` fails open + `app_url_invalid` | UV |
| 59 | GET 405; `isSameOrigin('required')` | UV; E2E |
| 60 | Mode `error` → `failed` | UV; E2E |
| 61 | Unknown `kid` + failed fetch → 503 `jwks_unavailable` | AP (respx) |
| 62 | Logout `error` → WARN | UV; E2E |
| 63 | `SignOutButton`, three modes | E2E |
| 64 | D-61 expired → JSON | UV; E2E |
| 65 | Full link flow; audit payload; next SSO login | IU (INSERT, exact audit keys, `x-user-id` in the audit metadata); UV; E2E (`authTime:'fresh'`) |
| 66 | `invalid credentials` → 400, no INSERT | IU; UV; E2E |
| 67 | `canLink` while linked → `issuer_user_key` → `already_linked_self` | IU; UV; E2E |
| 68 | `sso_link` absolute `exp`; `user_id` mismatch; logout clears it | UV |
| 69 | GET status in every mode; POST `/link` 404 | UV; E2E |
| 72 | Log-once in three readers; vector `mode` rows | IU (`watchAuthMode` update); AP; UV |
| 74 | D-111 check; no `sso_link` sealed | UV (absent; −31 s refused; −30 s accepted); E2E (`authTime:'absent'`, `'stale'`) |
| 75 | Mode gate before DB and bcrypt | IU (Outline local/oidc: 9 `link disabled`; pool and bcrypt spies untouched; `identity.link.failures{link_disabled}`) |
| 76 (proposed) | D-132 advisory `openSsoTxn` at step 3 | UV (link txn + `error=access_denied` → 303 `/accounts/sso?error=no_access`, `sso_link_failed{no_access}`, `sso_login_failed` not recorded, txn cleared; `server_error` → `failed`; expired link txn → login page); E2E (`page.route` intercept) |
| 77 (added post-design) | D-107/D-124 link-route statuses; row 1 is the middleware redirect, the handler's 401 is the stale-token case | UV (`middleware.test.ts`: no cookie → `/auth/login`; the three route tests, one case per remaining row) |
| 78 (added post-design) | D-136 UI PRM 503 `no-store` when `agent` / `oidc.issuer` is unreadable in `oidc` | UV (`protected-resource/route.test.ts`) |

No live AC is uncovered. The guard rows are labelled as guards (D-118). Rows 77 and 78 were added on 2026-11-24 after
the post-design `/sdd-review product-spec` added those scenarios.


## Rejected Alternatives

All locked alternatives in debate.md, both runs (R-2, R-13 and R-14 are moot under the re-spec and stay locked).

- `R-1` `PyJWKClient` run via `asyncio.to_thread` — rejected because It is synchronous urllib, refetches on every unknown `kid` with no cooldown (a refetch-amplification DoS against Authelia), and has no stale-on-error or single-flight.
- `R-2` Unique index on `lower(email)` — rejected because The migration would fail on existing mixed-case duplicates, which AC-5 says can exist.
- `R-3` Identity also validates `iss` (watches `ui`/`agent`) — rejected because Adds a new watcher and coupling to a SAN-gated, header-blind RPC whose callers already verified the token (YAGNI, C-18).
- `R-4` Agent allow-list of `client_id`/`azp` (a new config key) — rejected because Authelia's per-client `audience` already enforces this. Reconsider only if the spike shows any client can request the audience.
- `R-5` `ResolveExternalIdentity` also mints tokens for the UI (one RPC) — rejected because Mixes the authorization outcome with minting, and contradicts the owner-approved spec (`IssueSessionForUser`).
- `R-6` Stamp narrowed `roles` instead of an effective scope — rejected because OAuth-scope masks such as 0x03 correspond to no role set (`scopes.py:39`).
- `R-8` Hand-rolled OIDC code+PKCE flow on jose alone — rejected because The owner chose a vetted library at gate 1 (O-13 checklist risk).
- `R-9` Encode remember/redirect inside the `state` string — rejected because The owner chose cookie binding at gate 1 (D-15).
- `R-10` A sealed single map of SSO transactions in one cookie — rejected because It grows, and two tabs writing it race (O-11).
- `R-11` PyJWT `strict_aud=True` — rejected because It rejects `["X"]`, which Authelia may emit (`api_jwt.py:538-548`).
- `R-12` Resolve single-flight per `(iss, sub)` with a trace-link log — rejected because The owner chose trace fidelity over cold-cache load at gate 2 (D-30).
- `R-13` Explicit `BEGIN` + two INSERTs as the primary CREATE path — rejected because It holds a client across two statements. The CTE is provably correct (adversary round 3); keep it only as a contingency (D-32).
- `R-14` `SELECT … FOR KEY SHARE` on the user during LINK — rejected because The deactivation race is already bounded by `IssueSessionForUser` + the 60 s TTL; the extra lock isn't worth it (C-18).
- `R-15` The UI PRM route returns 404 in SSO mode and relies on the agent's `WWW-Authenticate` pointer — rejected because Loses for clients that probe the RFC 9728 canonical location first (O-33).
- `R-16` Fold unlink into `update-email --unlink` — rejected because Merges two responsibilities (C-18); a separate command is clearer.
- `R-17` Single-DB "viewer" case as AC-6 coverage — rejected because It is AC-1 with a viewer; the independence property is untested (fake coverage).
- `R-18` 303 redirect from `/api/auth/logout` in SSO mode — rejected because Fetch callers can't follow it, and the route would have two response shapes.
- `R-19` Store the ID token (JWE cookie) for `id_token_hint` — rejected because A third long-lived cookie holding the email; `client_id` suffices unless the spike proves otherwise, and then the portal branch goes first (D-59).
- `R-20` Exempt `/api/auth/logout` unconditionally — rejected because Exposes the open RevokeToken unverified-decode defect to the internet and adds a local-logout CSRF (O-44).
- `R-21` `jwtVerify(..., {clockTolerance: 14d})` instead of catching `JWTExpired` — rejected because It also relaxes `nbf` by 14 days. The explicit `JWTExpired` + `exp` bound is clearer about intent.
- `R-22` A cross-process e2e counter endpoint for RevokeToken — rejected because Scaffolding for an assertion the route unit test already makes (C-18).
- `R-7` HS256-signed (JWS) SSO transaction cookie — rejected because `verifyAccessToken` accepts any HS256 `JWT_SECRET` JWS, so the cookie would also be a valid session token (type confusion).
- `R-23` Link bound through the anonymous `/api/auth/sso/start` and a server-rendered `/accounts/sso` reading the session cookie — rejected because The middleware refreshes cookies only on the response (`middleware.ts:56-69`), so the handler sees the expired token on the first landing after the IdP round trip; the exempt `/start` is never refreshed (D-40/D-62)
- `R-24` In-handler refresh at the link start — rejected because Duplicates the middleware refresh (C-18 DRY), and the rotated old refresh token is then unusable to the handler
- `R-25` A `linked_issuers` field on `GetUserMetadataResponse` — rejected because Breaks `rowToUserMetadata` exact-key parity (`identityServiceImpl.ts:81-92`) and mixes concerns
- `R-26` `GetExternalIdentityLink(user_id, issuer) → bool` — rejected because Cannot answer FR-16's "linked in every mode" in `local` with an empty issuer
- `R-27` SetConfig refusing a per-user write of `identity/auth.mode` — rejected because All three readers are global by construction (`configWatcher.ts:90`, `watcher.py:49-53`, UI empty body id); tests pin it (C-18 YAGNI)
- `R-28` A two-fake-pool unit test for AC-6 — rejected because Passes on any code (independent fakes); repeats R-17's fake-coverage rationale (`fails.md:115-136`)
- `R-29` `sessionResponse(…, refreshToken?)` where an absent token means "issue one" — rejected because A flag argument hiding a DB write; drags the refresh path into the refactor (C-18)
- `R-30` The agent echoing any Resolve FAILED_PRECONDITION detail verbatim — rejected because An unknown detail would reach the client; D-24's closed set is cheaper

## Open Risks

- [ ] **S17 unproven**: if Authelia ignores `prompt=login`/`max_age=0` or omits `auth_time`, D-111 refuses every link
  (fail closed). Cutover gate 2; signal WARN `sso_link_refused`. — homelab-edge P0/P1 (S17, being extended to
  `max_age=0` + `auth_time`), before `both`.
- [ ] **Edge cutover gates** (D-119): rate-limit zone over `POST /accounts/api/sso/confirm`; Authelia web client
  registered with `openid profile email` (else every SSO login and Link fails with `invalid_scope`) and
  `claims_policy.id_token` with `email`, `preferred_username`, `auth_time`; seed-row `reset-password`. — homelab-edge
  (SSO spec § 4.3, § 4.6 and `sso.md` § 6 being amended, owner 2026-11-24), before `set-auth-mode both`.
- [ ] **Stale signing keys** (D-31/D-37): while the JWKS cannot be fetched, the agent keeps verifying with a key it
  already holds for up to `_JWKS_STALE_MAX_S` (24 h) after its last successful fetch, so a key the issuer retired or
  revoked stays accepted that long, beyond SSO spec § 4.7's rotation window. — owner sign-off before Step 19; the
  cutover runbook states it (Step 54).
- [ ] **No identity DB-test job** (recon R-8): AC-25's row count and AC-50 rest on labelled Postgres guards and
  `migration-rerun` (D-118). — accepted residual.
- [ ] **Config migration number contested**: `056` is also planned by 314, 317 and 321; take the next free number at
  execute. — config seed step.
- [ ] **New shared vector file** `scripts/testdata/oidc-issuer-vectors.json` (issuer, app_url, mode, refusals {resolve,
  link, session}, expected PRM) gates identity, UI and agent CI filters. — first step that creates it.
- [x] **Draft feature 280-third-party-sso-oidc** overlaps the problem (no key collision). — owner decision 2026-11-24:
  280 is `demoted/canceled`, superseded by 345.
- [ ] **Authentik exploration** (owner, xstockstrat-only) may later propose an identity-less `oidc`; out of scope here
  (D-112). — owner.
- [x] **`/sdd-review product-spec`** re-run after the O-94 edits. — done 2026-11-24 (O-94 closed).

## Constitution Rules Touched

- `C-01` — honored: every cited path:line re-verified in rounds 12–13; library behaviour cited from published tarballs
  (D-127).
- `C-03` — honored: UI → identity calls forward `x-user-id`/`x-access-scope`/`x-trace-id` (D-114); the agent stamps the
  linked `user_id`, never `sub`.
- `C-04` — honored: closed sets for modes, refusal details (D-123) and metric labels; proto adds no free-text status.
- `C-05` — honored: nine seeded keys, namespace-relative, readers named per key (D-109).
- `C-07` — honored: identity `007`; config number taken at execute (next free).
- `C-08`/`C-15` — honored: every live AC has a test seam or a labelled guard (round-13 seam table, D-118, D-128, D-129).
- `C-09` — honored: additive `identity.proto`; `buf lint`/`buf breaking`/`buf-gen.sh`.
- `C-10` — honored: `/accounts/sso` in both nav lists with a reachability test (D-117); authorized-apps list moved
  verbatim (D-116).
- `C-12`/`C-13` — honored: `fakeConfig()`, `sanCall.ts`, e2e fixtures via `INVENTORY.md`.
- `C-14` — honored: consumer surfaces named above.
- `C-16` — honored: see Business Rules Touched; CHANGE items signed off by the owner.
- `C-17` — honored: canonical UI primitives (D-117).
- `C-18` — honored: shared `verifyPassword`, pure `sessionResponse`, one vector file, no SetConfig change (R-27).
- `P-01`..`P-05` — honored: orchestrator-only writes; mediated debate; owner gates at rounds 10–13; context.md
  checkpoints per gate.
- `F-01` — honored: no applied migration edited.
- `F-04` — honored: every new file is marked new; no invented path.
- `F-06` — honored: no new pool; Link/Resolve use autocommit single queries.
- `F-07` — honored: runtime values via WatchConfig; constants in the D-13 fixed-invariant form.

## Business Rules Touched (C-16)

- CHANGE (`oidc` only; PRESERVE in `local`/`both`), signed off by the owner @ 2026-11-24 (context.md, round-10 and
  round-11 gates): identity `@AC-2/@AC-3/@AC-6 @feature-043` (password-login clauses), ui `@AC-1/@AC-2/@AC-3 @feature-153`
  (credentials form, Remember-me cookies), agent `@AC-20/@AC-47 @feature-294` and `@AC-9 @feature-147` (built-in OAuth
  routes 404), ui `@AC-4/@AC-6/@AC-9 @feature-350` (no authorized-apps list in `oidc`).
- PRESERVE ui `@AC-33 @feature-294` (401 "Invalid credentials" kept; `oidc` adds a separate 403 `login_disabled`).
- PRESERVE identity `@AC-5/@AC-7/@AC-8/@AC-10/@AC-11 @feature-043`, `@AC-1..6 @feature-265`, `@AC-22/@AC-23/@AC-52
  @feature-294`, `@AC-13/@AC-20 @feature-274`; agent `@AC-19 @feature-294`, `@AC-9 @feature-183`, `@AC-4 @feature-241`;
  ui `@feature-128`, `@feature-271`, `@AC-4..7 @feature-153`, `@AC-3 @feature-360`, `@AC-1 @feature-263`; config
  `@feature-147` (`@AC-3/4/5/11/13`), `@AC-14/@AC-29 @feature-295`, `@AC-1 @feature-296`; platform `@AC-4/@AC-5
  @feature-210`, `@AC-9 @feature-196`, `@AC-4 @feature-252`.
- EXTEND identity `@AC-8 @feature-043` (new `identity.external.linked` audit), `@AC-22 @feature-294` (new
  `password_login_disabled` reason); config `@AC-4 @feature-147` (new SAN-pinned `ui` grant).
