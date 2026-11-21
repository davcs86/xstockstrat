# Design: authelia-sso

**Created**: 2026-11-16
**Rounds**: 9 (full; termination: approved)
**Approved by**: user @ 2026-11-16
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-93 settled; D-45 superseded by D-51; D-52 amended by D-77; D-83 amended by D-93; R-1..R-22 locked; O-1..O-84 closed)

---

## Precedence

The design is the register (`debate.md`) as rendered below. The text has three layers:
- **(A)** the round-7 consolidation of D-1..D-65;
- **(B)** the round-8 mechanism for D-66..D-77;
- **(C)** the round-9 final text for D-79 and D-81..D-89, plus the register-only amendments D-89..D-93.

**Later layers and the register govern earlier text.** `/sdd-spec` cites the D-n, not the layer prose. Passages in (A) superseded by later rows:

| (A) passage | Superseded by |
|---|---|
| UI `loadOidcConfig` returning `'sso' \| 'legacy' \| 'error'` | The discriminated union with `valid:false` (D-66/D-78, (B) §D-66) |
| Agent "Token" bullets | The validator order in (B) §D-69 + D-84 `_precheck` ((C) §5) + D-89 |
| Agent "Issuer rules" | The single regex grammar (D-79/D-88, (C) §1). The D-27 runtime checks (discovery `issuer` equality, same-origin `jwks_uri`) stay |
| UI Logout steps 1–4 | (B) §D-68+D-77: step 0 is the Origin check (`if_present`, both modes, D-80), then verify → revoke ‖ redirect → clear → mode table with the `valid:false` row. Plus WARN `logout_origin_mismatch` (D-81, (C) §2) |
| `/start` order (S-2) | Mode/`valid:false` → `isSameOrigin(req,'required')` → secret → 303 (B) |
| Callback order (S-3) | `valid:false` → `not_configured` at step 1, before the IdP-error step. Error exits go through `ssoErrorRedirect(...): NextResponse` (D-82, (C) §3) |
| `getOidcConfiguration` cache "resolved only" | The single-slot `(issuer, clientId, sha256(secret))` cache, 600 s TTL (D-70), whose `.then(assertDiscoveredMetadata)` checks the byte-exact `issuer` and then the same-origin `jwks_uri` (D-87 + D-89) |
| `ui.auth.events` additions | The typed `recordAuthEvent` map + `LogoutReason` incl. `cross_origin` + `sso_login_failed{reason}` (D-72, (B) §D-72). Literal call sites only (D-83). Enforced by `tsc --noEmit` in CI (D-93) |
| Log-once mentions | One helper per language: `logOnce` in `serverLog.ts`, `_log_once` in `app/sso_mode.py` (D-90; it supersedes (C) §6's ERROR-only `errorOnce`) |
| "Txn cookie: httpOnly, Lax" | Plus `secure: isProduction` (D-75) |
| Discovery documents table | Plus the SSO `valid:false` row: PRM 503 `no-store`, AS 404 (D-78) |

---

## Chosen Approach

### (A) Consolidated design: D-1..D-65 (round 7)

Every deployment runs in exactly one mode, computed per request from its own config:
- **legacy**: today's code, moved but not rewritten;
- **SSO**: Authelia is the OIDC provider and token issuer.

In both modes, identity stays the user and role store and keeps minting sessions [D-1, FR-14].

#### Proto (`packages/proto/identity/v1/identity.proto`, additive)

- `ResolveExternalIdentity(ResolveExternalIdentityRequest{issuer=1, subject=2, email=3})` returns `ResolveExternalIdentityResponse{user_id=1, repeated Role roles=2, is_active=3, ExternalIdentityOutcome outcome=4}` [D-11].
- `IssueSessionForUser(IssueSessionForUserRequest{user_id=1})` returns the existing `AuthTokenResponse` [D-11; R-5].
- `enum ExternalIdentityOutcome{…_UNSPECIFIED=0, LINKED_EXISTING=1, LINKED_BY_EMAIL=2, CREATED=3}` [D-11, C-04].
- Refusals are gRPC statuses, not enum values: `FAILED_PRECONDITION` (code 9) with one of four FR-3 details, or `PERMISSION_DENIED`. The four details are exported as identity `EXTERNAL_IDENTITY_REFUSALS`, mirrored in UI `src/lib/ssoRefusals.ts`, and pinned by a contract test on each side [D-24].
- Run `buf lint`, `buf breaking` and `./scripts/buf-gen.sh` [C-09].

#### Identity

**Migration `007_external_identities`.**
- Table `identity.external_identities`: PK `(issuer, subject)`, `UNIQUE(issuer, user_id)`, FK to users with `ON DELETE CASCADE` [D-5].
- Non-unique index `users_email_lower_idx ON identity.users(lower(email))`. Existing mixed-case duplicates therefore resolve to `ambiguous email` [D-7; R-2].

**SAN gate.**
- Export `peerDnsSans` from `adminDirectory.ts`, with no new imports [D-4].
- `ResolveExternalIdentity` accepts SANs `{xstockstrat-ui, xstockstrat-agent}`. `IssueSessionForUser` accepts `{xstockstrat-ui}` only.
- Each RPC has its own `PERMISSION_DENIED` message, returned before any DB access [D-4].
- `ADMIN_DIRECTORY_PEER_SANS` is untouched. Identity watches no new namespace [R-3].

**Resolve.**
- Flow: SAN gate → validation → one autocommit classify query → pure `decideExternalIdentity` [D-32].
- Decision table [D-49 N-4]. "Linked" means linked under this issuer.
  - Link + active → LINKED_EXISTING.
  - Link + inactive → `account inactive`.
  - No link + empty email → `email required`.
  - More than one `lower(email)` match, in any state → `ambiguous email`.
  - Exactly one match: linked → `account already linked`; inactive → `account inactive`; otherwise → LINK.
  - No match → CREATE.
- Lowercasing happens only in SQL. JS only trims and checks for empty [D-49 N-3].
- Refusals and LINKED_EXISTING do no write and no bcrypt [D-32].
- LINK: one guarded `INSERT…SELECT … WHERE u.is_active AND lower(u.email)=lower($email) AND NOT EXISTS(…)`. `rowCount===0` counts as a lost race [D-32].
- CREATE: bcrypt of `randomBytes(32).toString('base64url')` at cost 10 first, then one data-modifying CTE that inserts the user with roles `{trader}` and the external identity [D-6, D-35, D-32].
- On a raw `23505` (checked before `mapDbError`), or on LINK with `rowCount===0`: re-classify once [D-5, D-32].
- Every statement is a `pool.query`, so at most one client is held at a time [D-21].
- Contingency only, if the DB test shows a non-23505 error: `BEGIN` + two INSERTs [D-32; R-13].
- Accepted residuals: R-14 (deactivation race), and an admin inserting a mixed-case email inside the window → `ambiguous email`.

**Email sync.**
- Applied to every success, but only effective on LINKED_EXISTING.
- `UPDATE … WHERE user_id=$1 AND lower(email)<>lower($2) AND NOT EXISTS(…)`, autocommit, awaited before the reply [D-19].
- A clash (`rowCount===0` or 23505) logs WARN `email_sync_conflict{user_id,issuer}`, with no email values [D-19].
- An empty token email means no sync [D-49 N-4].

**Audit.**
- `void auditSafe(...)` after `callback`, for LINKED_BY_EMAIL and CREATED only. Payload: `{user_id, issuer, outcome}` [D-21].
- New `AUDIT_EVENT_TYPES`: `identity.external.linked` and `identity.external.created`. The allow-list tests are updated.

**`IssueSessionForUser`.**
- SAN gate, then `SELECT user_id, email, roles, is_active`. Missing → `NOT_FOUND`; inactive → code 9 `account inactive` [D-11].
- Then private `sessionResponse(userId, email, roles)` = `mintAccessToken` + `issueRefreshToken`, using the **stored** email [D-19].
- `authenticateUser` passes its request email through unchanged. A frozen-clock deep-equal claims test pins this [D-49].

**Password gate.**
- `getBool('auth.password_login_enabled', false)`, checked before the DB query.
- If closed: code 7 "password login disabled" and `recordLoginFailure('password_login_disabled')`.
- Test mocks gain `getBool` [D-12].

#### Config

**Migration `053_authelia_sso_keys`**: 7 keys × {production, staging} = 14 global rows [D-44, D-48, D-57].

| Key | Seed value | Code default |
|---|---|---|
| `identity/auth.password_login_enabled` | `true` | `false` |
| `ui/oidc.issuer` | `""` | `""` |
| `ui/oidc.client_id` | `""` | `""` |
| `ui/oidc.client_secret` | `is_secret`, `value_data='[redacted]'`, ciphertext NULL (reads as `found=false`) | `""` |
| `ui/oidc.mcp_client_id` | `""` | `""` |
| `ui/oidc.mcp_client_id_readonly` | `""` | `""` |
| `agent/oidc.issuer` | `""` | `""` |

- **Up:** the 046/047 CTE, `INSERT … ON CONFLICT DO NOTHING RETURNING` → `pg_notify` over `SELECT DISTINCT namespace, environment`. That gives 6 notifies on a fresh DB and 0 on a re-apply [D-20, D-57].
- **Down:** `DELETE … RETURNING` with the 049 guard (`updated_by` sentinel + seed value + `value_encrypted IS NULL`). It **never deletes the flag row** [D-36].
- The config constitution records two exceptions: the seed (`true`) differs from the code default (`false`), and the CONFIG-4 `user_id` is omitted [D-20, D-36].
- Migration test via `migrationSql.ts`: 14 rows, notify counts 6 and 0, relative keys.

**GetSecret grant.** Add `{callerID:'ui', namespace:'ui', keys:['oidc.client_secret'], peerSan:'xstockstrat-ui'}` to `SECRET_CALLER_ALLOWLIST`.

**`scripts/config-wiring.json`.** One receiver per namespace for `oidcConfig.ts`; no baseline entries. Secret readers: start, callback and logout [D-59]. `check-config-wiring.mjs --final` must report zero findings.

**Fixed invariants, not config keys** ("Fixed invariant (F-07)" form) [D-13, D-37, D-49 N-14]:
- role TTL 60 s;
- JWKS fresh window, cooldown 30 s, fetch timeout 5 s;
- `_JWKS_STALE_MAX_S=86400`, `_JWKS_MAX_BYTES=65536`, `_CLOCK_SKEW_S=30`, `_DISCOVERY_FRESH_S=600`;
- `OIDC_ID_TOKEN_ALG='RS256'` (spike), `OIDC_TIMEOUT_S=10`.

#### Agent

**Mode.**
- Add `ui` to `WATCHED_NAMESPACES` (`watcher.py:16`). The environment comes from `resolve_scope("")` for every namespace [D-1, D-39].
- Each request reads `agent/oidc.issuer` and `ui/oidc.issuer` from the snapshot. Both non-empty → SSO. Exactly one set → legacy, with WARN `sso_mode_misconfigured` once per process [D-1].
- Reads are global-scope only (watcher `user_id==""`) [D-27].

**Issuer rules** [D-27, D-42]:
- https, or http on loopback only;
- the discovery document's `issuer` must equal the configured issuer exactly;
- `jwks_uri` must be same-origin.
- A non-empty invalid issuer → 503 `internal_error` + ERROR `sso_issuer_invalid`.

**Token.**
- `pyjwt[crypto]` becomes a direct dependency, with `uv lock` [D-2; R-1].
- Header defects → 401 **before** any key lookup (S-10): missing `kid`, `alg` outside the asymmetric allow-list, HS256, `none`.
- `algorithm=` comes from the JWK's `alg` ∩ the allow-list, never from the token header [D-35].
- `leeway=_CLOCK_SKEW_S`, plus a strict `exp` check; `int(exp)` is computed inside the 401 `try` [D-25, D-31].
- Non-strict `audience=`, then require `aud == AGENT_PUBLIC_URL` or `aud == [AGENT_PUBLIC_URL]`, byte-exact [D-26, D-49 N-8; R-11].
- `typ` is checked only if the spike confirms Authelia sets it [D-26].
- No `client_id`/`azp` allow-list [R-4].

**JWKS (`app/jwks.py`, async httpx).**
- One state machine per issuer. A fetch is eligible only when `task is None` and the 30 s cooldown has passed [D-31].
- Known `kid`:
  - keys fresh → verify;
  - keys stale but ≤ 24 h → verify from cache and start a gated refresh without awaiting it;
  - older than 24 h → handle as an unknown `kid` [D-31].
- Unknown `kid`: await the `shield`ed task.
  - Found → verify.
  - Fetch succeeded but `kid` absent → 401.
  - Fetch failed or deadline → 503 [D-31, D-14].
- The task is the only writer, owns its own 5 s timeout, and its done-callback retrieves the exception [D-31].
- Ingest skips each unusable key with a WARN [D-35].
- Transport: `Accept-Encoding: identity`, a `Content-Length` cap, `follow_redirects=False`. The D-27 checks run again on every discovery refetch [D-35].
- Discovery is cached separately [D-18].

**One deadline.** `asyncio.timeout_at(now+_RPC_TIMEOUT_S)` covers the JWKS fetch and the resolve; resolve gets whatever budget remains [D-18].

**Status map** [D-17, D-42]:

| Condition | Response |
|---|---|
| Token defect | 401 + `WWW-Authenticate` |
| Unknown `kid` and JWKS unfetchable | 503 `jwks_unavailable` |
| Resolve `FAILED_PRECONDITION` | 403 `account_refused` |
| Resolve `UNAVAILABLE`, `DEADLINE_EXCEEDED` or overall deadline | 503 `identity_unavailable` |
| Anything else | 503 `internal_error` + one ERROR naming the exception class |

`record_auth_rejected` gains `jwks_unavailable` and `account_refused`; `test_telemetry_allowlist.py` is updated.

**Resolve and cache.**
- No single-flight. Each cold request resolves with its own `x-trace-id` [D-30; R-12].
- Cache `(iss, sub) → (monotonic_expiry, user_id, roles)`: successes only, 60 s TTL, never served stale [D-49 N-6, FR-8].

**Stamped claims.**
- `{user_id (resolved, never sub), roles, access_scope = roles_to_access_scope(roles) & scopes_to_mask(scope), aud, trace_id}`. No `email`, no `sub` [D-3, D-49 N-6; R-6].
- `scopes.effective_access_scope(claims)` is read at `tools.py:146` and `tools.py:216`. Legacy claims never carry `access_scope` [D-3].

**Routes.**
- SSO mode:
  - the PRM in `oauth_metadata.py` returns `{resource, authorization_servers:[agent issuer], scopes_supported}`;
  - `/oauth/{register,authorize,callback,token}` and `/.well-known/oauth-authorization-server` → 404.
- Legacy mode: byte-identical [D-10].
- `@AC-19 @feature-294` is PRESERVE in legacy mode only [D-17].

#### UI

**`src/lib/oidcConfig.ts`.**
- `loadOidcConfig()` returns `'sso' | 'legacy' | 'error'`. The `'sso'` result carries `issuer`, `clientId`, `agentIssuer`, `mcpClientId` and `mcpClientIdReadonly` [D-22, D-55].
- `loadPasswordLoginEnabled()` reads the `identity` namespace.
- `loadOidcClientSecret()` calls GetSecret. `found=false` or an empty value → `not_configured` [D-41].
- Every call is header-less, with an empty `user_id`, `environment: nativeConfigEnvironment()` and `timeoutMs: AUTH_CONFIG_TIMEOUT_MS` (10 s, new in `deadlines.ts`) [D-27, D-39, D-47, D-65].
- The login page's reads run under `Promise.all` within one budget [D-47].
- `raceDeadline` (new in `deadlines.ts`) clears its own timer [D-61].

**OIDC client.**
- `openid-client@6.8.9`, exact pin [D-16, D-34; R-8].
- `getOidcConfiguration` calls `discovery(issuer, clientId, {id_token_signed_response_alg: OIDC_ID_TOKEN_ALG}, ClientSecretBasic(secret), {timeout: OIDC_TIMEOUT_S, execute: [enableNonRepudiationChecks, ...(loopback ? [allowInsecureRequests] : [])]})`, passing function references [D-29, D-34].
- The cache stores only resolved Configurations; rejected promises are dropped [D-65].
- `oidcClient.test.ts` exercises the production path through a `fetch` stub [D-34]:
  - correct signature → ok;
  - foreign key with the same `kid` → reject;
  - ES256 or `none` → reject.

**Transaction cookie.**
- JWE dir/A256GCM, key = HKDF-SHA256(`JWT_SECRET`, `xstockstrat-ui/sso-txn`), using the UI's own jose ^5 [D-8, D-50; R-7].
- Name `sso_txn_<16 hex of sha256(state)>`, path `/api/auth/sso/callback`, Max-Age 600, httpOnly, Lax [D-23; R-10].
- Contents `{state, nonce, code_verifier, remember, redirect}`. Remember and redirect are bound to `state` this way [D-15; R-9].
- Clears use the same path. On success, clear every `sso_txn_*`; on failure, clear only this request's cookie [D-35, D-49 N-13].

**`POST /api/auth/sso/start`.** There is no GET export, so GET → 405 [D-46, D-54]. Order (S-2):
1. Mode: `'legacy'` → 404; `'error'` → 303 `?error=failed`.
2. `isSameOrigin`: a missing or `null` Origin fails → 303 `?error=failed`.
3. Secret: missing → `?error=not_configured`.
4. 303 to Authelia with `redirect_uri=${APP_URL}/api/auth/sso/callback`, `scope=openid email`, `response_mode=query`, PKCE S256, `state` and `nonce` [D-9, D-41].

`remember` and `redirect` come from the form body. `redirect` goes through `src/lib/safeRedirect.ts`, extracted from `auth/login/page.tsx:8-18` with unchanged behaviour [D-46, D-54].

**`GET /api/auth/sso/callback`.** Canonical order (S-3):
1. Mode: `'legacy'` → 404; `'error'` → `failed` [D-22].
2. IdP `error` parameter: clear this request's txn cookie if `state` is present. `access_denied` → `no_access`; any other error → `failed` [D-58].
3. Missing or undecryptable txn → `failed` [D-41].
4. Secret missing → `not_configured` [D-41].
5. `authorizationCodeGrant` with checks `{pkceCodeVerifier, expectedState, expectedNonce, idTokenExpected}`. Any failure → `failed`, with no resolve [D-29].
6. `ResolveExternalIdentity`. The refusal detail maps through `ssoRefusals.ts` to `linked`, `ambiguous`, `inactive` or `no_email` [D-24, D-41].
7. `IssueSessionForUser`. `inactive` → `inactive`; any other error → `failed`. No cookies are set, and the link stays [D-49 N-5].
8. `setSessionCookies(…, remember ? {maxAge: REMEMBER_ME_MAX_AGE_SECONDS} : undefined)`, then redirect to the safe target.

Every `Location` is built as `new URL(path, APP_URL)` [D-41, D-54, D-65]. `ui.auth.events` gains `sso_login_ok`, `sso_login_failed`, `sso_login_error` and `login_disabled`.

**Login page.** A server `page.tsx` with client forms [D-22, D-54, FR-9]:

| Mode | Password flag | Renders |
|---|---|---|
| legacy or `'error'` | on | `CredentialsForm` only |
| legacy or `'error'` | off | `CredentialsForm` + the FR-9 banner |
| SSO | on | `CredentialsForm` + `SsoSignInForm` |
| SSO | off | `SsoSignInForm` only |

- `SsoSignInForm` is a native POST form with a hidden `redirect` and an uncontrolled `ui/checkbox` (`id="ssoRememberMe" name="remember" value="1"`), labelled "Keep me signed in for 14 days (SSO)" [D-54].
- `CredentialsForm` is untouched.

**`/api/auth/login`.** `PermissionDenied` → 403 `{error:'password login disabled'}` [D-12].

**Logout (`src/app/api/auth/logout/route.ts`)** [D-51, D-52, D-60, D-61, D-65; R-18, R-19, R-21].
1. `verifyAccessTokenForLogout` (in `auth.ts`; it shares a key-loading helper with `verifyAccessToken`) returns one of:
   - `verified`: the signature is valid, or the token raised `JWTExpired` with an `exp` no more than 14 d in the past;
   - `unverified`;
   - `expired_too_old`.

   `recordAuthEvent('logout', reason)` records the result (S-7).
2. **Only when verified**, run both in parallel and await both:
   - `revokeToken` with `REFRESH_TIMEOUT_MS`;
   - `resolveLogoutRedirect()`: the mode read plus discovery, under one `AUTH_CONFIG_TIMEOUT_MS` deadline.
     - If `end_session_endpoint` is advertised and same-origin: `buildEndSessionUrl({post_logout_redirect_uri: new URL('/auth/login', APP_URL).href})`.
     - Otherwise, or on throw or timeout: `autheliaPortalLogoutUrl(issuer, APP_URL)` from `src/lib/ssoLogout.ts`, with WARN `sso_logout_portal_fallback` on error.
3. `clearSessionCookies`.
4. Response:
   - legacy → `{ok:true}`, byte-identical;
   - `'error'` → `{ok:true}` plus WARN `sso_logout_mode_unknown`;
   - SSO and verified → `{ok:true, redirect}`.

No ID-token storage [R-19]. Accepted residual: a stolen access token that expired less than 14 days ago can force "log out everywhere" for its owner [D-61].

**Middleware.**
- Exported sets: `SSO_PUBLIC_PATHS`, `COOKIE_GATED_PATHS` and `PUBLIC_HEALTH_PATHS`. Logout is in `COOKIE_GATED_PATHS`: it passes only when an `access_token` or `refresh_token` cookie is present.
- The check runs at the top, before `getSessionFromRequest`. The matcher is unchanged [D-40, D-52, D-62; R-20].
- A test checks that every path in the union has a `route.ts` and that lookalike paths redirect [D-59].

**`SignOutButton`** (`src/components/shared/`), in `PlatformHeader` row 1, in both modes [D-53, D-60, D-63].
- `size-11 sm:size-8`, `aria-label="Sign out"`, guarded by `pending`.
- `fetch(…, {redirect:'manual'})` inside try/catch, then `location.assign(body.redirect ?? '/auth/login')`. Any failure → `/auth/login`.
- An e2e at 375 px on `/trader` checks for overflow; if it overflows, fall back to the offcanvas sheet.

**Discovery documents** (`src/app/api/oauth/{protected-resource,authorization-server}/route.ts`) [D-38, D-55; R-15]:

| Mode | Protected-resource | Authorization-server |
|---|---|---|
| legacy | byte-identical | byte-identical |
| SSO | `{resource: AGENT_PUBLIC_URL, authorization_servers:[agentIssuer], scopes_supported: MCP_SCOPES_SUPPORTED}` (`src/lib/mcpScopes.ts`) | 404 |
| `'error'` | 503 `no-store` | 503 `no-store` |

The whole SSO-mode PRM object is pinned by a two-sided contract test against `oauth_metadata.py`.

**Authorized apps** [D-28, D-44, D-49 N-12, D-55].
- The page becomes a server wrapper.
- `'sso'` → `SsoAppsCard`: an Authelia link (`ui/oidc.issuer`), the shared `ConnectorUrlField` (`AgentUrlContext`), and a row for each non-empty client ID.
- `'legacy'` or `'error'` → today's list, moved verbatim to `AuthorizedAppsList.tsx`.
- `accounts/layout.tsx` is untouched.

**Build check.** `docker compose build --no-cache xstockstrat-ui` plus a standalone boot smoke test. openid-client is ESM-only and depends on jose ^6 [D-50].

#### Script (`scripts/manage-users.py`)

**`update-email <old> <new>`** [FR-12]:
- Writes `lower(new)` in SQL and keeps `user_id`.
- If another row already matches `lower(email)`: "email already in use", non-zero exit.
- Tests: `TestUpdateEmailCmd` and `TestSqlParameterization`.

**`unlink-sso <email> [--issuer]`** [D-43, D-56; R-16]:
- Looks up `lower(email)` with `LIMIT 2`. 0 rows → not found. 2 rows → "ambiguous email — fix with update-email".
- Asks for confirmation unless `--force/-f`.
- Runs `DELETE … [AND issuer] RETURNING issuer, subject`. 0 rows deleted → exit 1.
- Prints the email the person must have in Authelia to relink.
- `_mock_conn` gains a `fetchall` side effect for the tests [D-64].

#### Docs (same PR as each behaviour change)

- **The FR-13 list:**
  - `mcp-tools.md`: client IDs and redirect URI;
  - identity, ui and agent `CLAUDE.md` key tables;
  - AGENT-1 and AGENT-9;
  - `frontend-auth.md`;
  - IDENTITY-15 and `database.md`.
- **Also update** [D-49 N-10a]:
  - identity `docs/operations.md`;
  - root `CLAUDE.md` § Inter-Service Dependencies;
  - identity Ports and IDENTITY-12;
  - `inter-service-mtls.md` (the new grant);
  - `config-governance.md` (registered-keys log);
  - the config-constitution exception;
  - `database.md` schema map;
  - agent `docs/oauth.md`.
- **Cutover runbook** [D-42, D-49 N-8/N-9]:
  - `APP_URL` with no trailing slash;
  - byte-exact redirect and audience;
  - `reset-password` on the staging seed row;
  - the signal list: `wrong_audience`, `jwks_unavailable`, `account_refused`, `ui.auth.events{sso_login_failed|error}`.
- **`context.md`:** record the Referrer-Policy constraint. A future `no-referrer` policy would break `/start` [D-54].

#### CI

- `identity-db-test` [D-33]:
  - `test:db --test-concurrency=1`, cloned from `ledger-db-test`;
  - added to `ci-gate.needs` and the echo list;
  - reuses the identity and migrations filters;
  - an unset URL makes the job throw.
- Deterministic 23505 test, with the waiter identified via `pg_blocking_pids`, plus a sibling LINKED_BY_EMAIL test. A `Promise.all` test checks invariants only [D-33].
- AC-6 runs against two databases [D-48; R-17].
- Agent `uv lock --check`; the UI lockfile pins `openid-client@6.8.9`.
- AC-20 and AC-36 use a `grep -F` RED/GREEN step [D-48].

#### Rollout, cutover, rollback

- **Order:** proto → `db-migrate` (config 053, identity 007) → identity → config grant → agent → UI [D-20].
  - Invariant: every intermediate state is legacy, because the issuers are empty and the flag is `true` [D-48].
  - Merge 319 first or alongside it (the RevokeToken defect) [D-52]. Rebase over 324, 331 and 323.
- **Cutover, per deployment** [FR-14, D-42]:
  1. Set `ui.oidc.client_id`, the client secret and the MCP client IDs.
  2. Set both issuers.
  3. Verify one web login, one MCP connection and one logout, using the signal list.
  4. Set the password flag to `false`.
- **Config rollback:** clear both issuers and set the flag `true`.
- **Code rollback:** revert identity, then optionally run 053 down. The order is recommended, not lockout-critical [D-20, D-36, D-48].

#### Cross-repo: homelab-edge

Separate PR. Every value is `TODO(provide)` or `TODO(verify)`.

- **Web clients, one per environment:** redirect `${APP_URL}/api/auth/sso/callback`, post-logout redirect `${APP_URL}/auth/login`, `client_secret_basic`.
- **MCP clients:** public PKCE clients with audience `${APP_URL}/agent`, IDs equal to `ui/oidc.mcp_client_id[_readonly]`, `xstockstrat.*` scopes, and `email` in access tokens.
- **`rd` / session-cookie domain:** must cover each `APP_URL` host [D-51].
- **`sso.md`:**
  - §7 and §8 use `unlink-sso` [D-43];
  - a Logout section covering the cross-app effect [D-51];
  - optionally, a staging rate-limit zone (O-43 follow-up).

#### Spike gate (Authelia v4.39.28; blocks `/sdd-spec`)

- **(a)** MCP clients work as pre-registered public clients with RFC 8707 `resource`.
- **(b)** Access tokens carry `aud` = resource, `scope` as a string, `email`, a `kid` and an asymmetric `alg`. Is `typ` `at+jwt`? [D-26]
- **(c)** The `xstockstrat.*` scopes are accepted.
- **(d)** Is group membership re-checked on refresh?
- **(e)** Is `sub` stable per username?
- The ID-token alg equals `OIDC_ID_TOKEN_ALG` [D-37].
- **Logout** [D-59]:
  - Is `end_session_endpoint` advertised?
  - Are `client_id` and `post_logout_redirect_uri` honoured without `id_token_hint` or a confirmation page?
  - What is the portal's `rd` parameter name?
  - Does `GET /logout` work without a confirmation page?
  - If `end_session` needs a hint, use the portal branch first.
- If (a) or (b) fails, fall back to option F (per the spec).

---

### (B) Mechanism for D-66..D-77 (round 8)

Round 8 delivers the mechanism for D-66..D-77 as replacement and insert text for the round-7 draft (`/tmp/claude-0/-home-user/b5e4cf35-fba7-5cc2-975f-76a499ebda16/scratchpad/345/round7-proposal.md`). It is built from three small units.

**1. One validity source per language, pinned by one vector file.**
- TS: new `src/lib/sameOrigin.ts` holds `parseAppOrigin`. New `src/lib/oidcIssuer.ts` holds `isValidIssuer`.
- Python: new `app/sso_mode.py` holds `is_valid_issuer` and `current_sso_mode`.
- New `scripts/testdata/oidc-issuer-vectors.json` holds the vectors, loaded the same way as `rpc-status-vectors.json`.
- `loadOidcConfig` returns a discriminated union. The `'sso'` variant carries `valid:false` + `reason`, and that variant does not carry the issuer. Every surface branches on `.mode` and then `.valid`, and the compiler stops any surface from using an invalid issuer. Validity is checked only when both issuers are non-empty, so D-1 (mode) and D-22 (`'error'`) keep their meaning.

**2. One Origin helper with two policies.**
- `isSameOrigin(req, 'required' | 'if_present')`.
- `/start` uses `'required'` (D-54/D-68).
- Logout uses `'if_present'` (D-77) as step 0, before any config read, verify or revoke.

**3. A typed metrics map plus one SSO-error module.**
- New leaf `src/lib/ssoErrors.ts` holds the 7 D-41 codes as a `const` array. It is shared by the login-page message map, the redirect builder and the `sso_login_failed` reason type.
- `recordAuthEvent` becomes generic: the reason argument is required for `jwt_rejected`, `logout` and `sso_login_failed`, and not allowed for any other event.

---

##### D-66: validity computed once (replaces the UI `oidcConfig.ts` bullets and adds an Agent "Mode" bullet)

**TS result type** (`src/lib/oidcConfig.ts`, new):
```ts
export type OidcInvalidReason = 'ui_issuer' | 'agent_issuer' | 'app_url';
interface SsoClientIds { mcpClientId: string; mcpClientIdReadonly: string }
export type OidcConfigResult =
  | { mode: 'legacy' }                       // both empty, or half-configured (D-1; WARN sso_mode_misconfigured once)
  | { mode: 'error' }                        // config unreachable or timed out (D-22); validity is never computed
  | ({ mode: 'sso'; valid: true; issuer: string; clientId: string; agentIssuer: string; appOrigin: string } & SsoClientIds)
  | ({ mode: 'sso'; valid: false; reason: OidcInvalidReason } & SsoClientIds);
```

**Evaluation order:**
1. Reads fail → `'error'`.
2. Either issuer is empty (`=== ''`, no trimming) → `'legacy'`. If exactly one is set, log WARN `sso_mode_misconfigured` once.
3. Otherwise SSO. Check `isValidIssuer(ui)`, then `isValidIssuer(agent)`, then `parseAppOrigin(process.env.APP_URL) !== null`. The first failure sets `reason`.
4. On an invalid result, `loadOidcConfig` logs `serverLog.error('sso_issuer_invalid', {reason})` once per process per reason. This one log covers the ERROR that D-66 requires from every surface, logout included. The surfaces do not log it again.

The two corner cases follow from this order:
- An invalid value on one side with the other side empty is half-configured: legacy plus `sso_mode_misconfigured`. That is AC-32 and AC-47, unchanged.
- A whitespace-only issuer counts as non-empty, so it gives SSO with `valid:false`.

**`parseAppOrigin(raw: string | undefined): string | null`** (in `sameOrigin.ts`, new):
- Valid iff `raw` passes the issuer scheme and host rules **and** `raw === new URL(raw).origin`.
- That means no path, no trailing slash, a lowercase host and no default port. `${APP_URL}/api/auth/sso/callback` (D-9) and `${APP_URL}/agent` (`deploy/homelab/compose.yml:284`) can therefore never produce `//`.

**Issuer rule.** Both languages implement the same rule. The vectors decide any disagreement.
- Literal prefix `https://` or `http://`, matched case-sensitively.
- None of these characters: whitespace, `\`, `@`, `?`, `#`.
- A non-empty host whose authority is already in canonical form:
  - TS: the raw authority must equal `new URL(v).host`. This rejects `127.1`, an upper-case host and `:443`.
  - Python: `netloc == netloc.lower()`; no explicit default port; a host made only of digits and dots must parse with `ipaddress`.
- A path is allowed.
- `http` is allowed only for the loopback hosts: TS `{'localhost','127.0.0.1','[::1]'}`, Python `{'localhost','127.0.0.1','::1'}`.
- D-27's runtime checks (discovery `issuer` equality, same-origin `jwks_uri`) stay where they are and are not part of the vectors.

**Vector file schema** (`scripts/testdata/oidc-issuer-vectors.json`, new):
```json
{ "issuer":  [ {"name": "...", "value": "...", "valid": true} ],
  "app_url": [ {"name": "...", "value": "...", "origin": "https://x.test" | null} ],
  "mode":    [ {"name": "...", "ui": "...", "agent": "...", "expected": "legacy" | "sso" | "sso_invalid"} ] }
```
- `issuer` and `mode` apply to node and python. `app_url` applies to node only, because the agent has no `APP_URL`.
- Minimum issuer rows, each with its outcome:
  - `https://auth.example.test` ✓
  - `https://auth.example.test:8443` ✓
  - `https://auth.example.test/realm` ✓
  - `http://localhost:9094` ✓
  - `http://127.0.0.1:9094` ✓
  - `http://[::1]:9094` ✓
  - `http://auth.example.test` ✗
  - `HTTPS://auth.example.test` ✗
  - `https:auth.example.test` ✗ (WHATWG accepts it; Python sees no netloc)
  - `" https://auth.example.test"` ✗ (WHATWG strips the space)
  - `https://Auth.example.test` ✗
  - `https://auth.example.test:443` ✗
  - `http://127.1:9094` ✗ (WHATWG turns it into 127.0.0.1)
  - `http://localhost.:9094` ✗
  - `https://u:p@auth.example.test` ✗
  - `https://auth.example.test\@evil.test` ✗
  - `https://auth.example.test/?x` ✗
  - `https://` ✗
  - `" "` ✗
- `app_url` rows: the issuer-valid forms, plus `https://x.test/` ✗ and `https://x.test/app` ✗.
- `mode` rows: `""`/`""` → legacy; valid/`""` → legacy; `" "`/valid → `sso_invalid`; `http://auth.example.test`/valid → `sso_invalid`.

**Where each language loads it:**
- TS: new `services/xstockstrat-ui/src/lib/__tests__/oidcIssuerVectors.test.ts`, using `fileURLToPath(new URL('../../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url))`. This is the same `import.meta.url` idiom as `vitest.config.ts:16`. It is one directory deeper than identity's 4-up `join(__dirname,…)` at `identity/src/__tests__/telemetry.test.ts:49-54`.
- Python: new `services/xstockstrat-agent/tests/test_oidc_issuer_vectors.py`, using `SERVICE_DIR.parent.parent / "scripts" / "testdata" / "oidc-issuer-vectors.json"`, cloned from `ingest/tests/test_telemetry.py:112-115`.
- How the precedent is consumed today: identity, ledger, config and notify read it via `join(__dirname,'..','..','..','..','scripts','testdata','rpc-status-vectors.json')`; Go via `os.ReadFile("../../../../scripts/testdata/…")` (`trading/internal/telemetry/otel_test.go:486`); Python via the ingest form above.
- **Gap found:** no `changes` filter lists that file. Add `'scripts/testdata/oidc-issuer-vectors.json'` to the `xstockstrat-agent` and `xstockstrat-ui` filters at `ci.yml:59` and `ci.yml:64` (precedent: portfolio's out-of-tree entry at `ci.yml:55`). Without this, a vector-only change runs neither suite.

**Agent** (`app/sso_mode.py`, new):
- `@dataclass(frozen=True) class SsoMode: kind: Literal['legacy','sso']; valid: bool = False; agent_issuer: str = ''; reason: str = ''`.
- `current_sso_mode()` reads `read_value("agent","oidc.issuer")` and `read_value("ui","oidc.issuer")`. `read_value` is aliased as `read_config_value` at `tools.py:77`.
- The agent validates **both** issuers, so the UI and the agent never disagree about whether the config is valid.
- It logs ERROR `sso_issuer_invalid{reason}` once per distinct `(reason, value)` pair.
- The agent has no `'error'` mode: an absent snapshot key reads as `""`, which means legacy.

**What each surface does with `valid:false`:**

| Surface | `valid:false` behaviour |
|---|---|
| Login page | SSO render (button shown; password form per the flag table) |
| `POST /start` | 303 `not_configured` at step 1, **before** the Origin check (a bad `APP_URL` makes Origin uncheckable) |
| `GET /callback` | `not_configured` at step 1, before the IdP-error step |
| Logout | step 0 Origin check (D-77), verify, revoke iff verified, clear cookies, then `{ok:true}` with **no** `redirect` and no discovery call |
| UI PRM | 503 `no-store` |
| UI AS metadata | 404 (it is still SSO mode, per the D-38 table) |
| `SsoAppsCard` | Connector URL and client-ID rows shown; Authelia link omitted |
| Agent MCP | 503 `internal_error`, no `WWW-Authenticate`, decided **before** the bearer check (a 401 would point at a PRM that answers 503, so clients would loop) |
| Agent PRM | 503 `no-store` |
| Agent `/oauth/*` | 404 |

**Redirect builder for an unusable `APP_URL`.** D-41 builds every `Location` from `APP_URL`, which fails when `APP_URL` is invalid: `NextResponse.redirect` throws on a relative URL. So:
- `ssoErrors.ts` exports `ssoErrorRedirect(code: SsoErrorCode, appOrigin: string | null, fault = false): Response`.
- It records the metric (see D-72) and returns 303.
- `Location` is `new URL('/auth/login?error='+code, appOrigin).href`, or the relative `/auth/login?error=not_configured` when `appOrigin` is null. RFC 9110 allows a relative `Location`.

##### D-67: `APP_URL` wiring (CI/Rollout insert)

- **`docker-compose.yml`, UI block:** insert `APP_URL: http://localhost:3000` after `AGENT_PUBLIC_URL` (`:520`). The port is published as `3000:3000` (`:524-525`), and the agent block already uses the literal `UI_BASE_URL: http://localhost:3000` (`:575`).
- **`services/xstockstrat-ui/playwright.config.ts`:**
  - Hoist `const BASE_URL = 'http://localhost:3000';`.
  - Use it for `use.baseURL` (`:94`, currently the literal `'http://localhost:3000'`).
  - Add `APP_URL: BASE_URL` to `webServer.env` (`:139-181`, next to `AGENT_PUBLIC_URL` at `:168`).
  - The hoist pins "same origin as `baseURL`" structurally.
- **How e2e reaches the UI:**
  - `webServer` serves `pnpm dev` locally, or `pnpm build && pnpm start` in CI (`:129-133`), on port 3000. Readiness is probed at `http://localhost:3000/insights/api/health` (`:134`).
  - Specs navigate relative to `baseURL`, so browser POSTs carry `Origin: http://localhost:3000`, which equals `APP_URL`.
  - `page.request.post` (APIRequestContext) sends no `Origin` (`auth.spec.ts:307`).
  - `Dockerfile.e2e` / `run-e2e.py` use this same config.
- **UI `CLAUDE.md` env block** (Environment Variables section), add: `APP_URL  # public origin, exactly scheme://host[:port] (no path or trailing slash); SSO redirect_uri, Locations, the /start and logout Origin checks; invalid ⇒ SSO not_configured and logout Origin check skipped with ERROR app_url_invalid`.
- `.do/app.yaml:650`, `.do/app.dev.yaml:647` and `deploy/homelab/compose.yml:283` are already set; no change.

##### D-68 + D-77: `isSameOrigin` and the logout order (UI section, replaces the round-7 Logout steps)

**`src/lib/sameOrigin.ts`** (new; no imports beyond `serverLog`):
```ts
export function parseAppOrigin(raw: string | undefined): string | null;
export function appOrigin(): string | null;   // parseAppOrigin(process.env.APP_URL); ERROR app_url_invalid once per process when non-null input fails
export type OriginPolicy = 'required' | 'if_present';
export function isSameOrigin(req: Request, policy: OriginPolicy, origin: string | null = appOrigin()): boolean;
```
- **`required`:** true iff `origin !== null` and the header exists, is not `'null'`, and `=== origin` exactly. It never compares against `req.nextUrl.origin`.
- **`if_present`:** if the header is absent → true. If `origin === null` → true. This is fail-open on purpose: it keeps the D-66 rule that logout on an invalid config still ends the session, and the ERROR above already fired. Otherwise → `header === origin`. A literal `'null'` header is "present" and fails.

**Unit cases (`sameOrigin.test.ts`):**
- `required`: missing, `null`, matching, different port, different scheme, `appOrigin` null.
- `if_present`: absent, matching, sibling `https://dash.example.test`, `null`, `appOrigin` null with a sibling header (→ true).

**Logout route** (`src/app/api/auth/logout/route.ts:6-15` rewritten; D-77 inserted at step 0):
0. `if (!isSameOrigin(req,'if_present'))`: `recordAuthEvent('logout','cross_origin')` and return `NextResponse.json({error:'origin mismatch'},{status:403})`. No `Set-Cookie`, no verify, no `revokeToken`, no config read.
   - This runs **before** D-61's verify, so revoke cannot happen.
   - It is mode-independent, so no network call happens before the check.
1. `verifyAccessTokenForLogout`, then `recordAuthEvent('logout', reason)`.
2. Only when verified: `revokeToken` ‖ `resolveLogoutRedirect()`, both awaited (D-61).
3. `clearSessionCookies`.
4. Response by mode, D-66 rows included:

| Mode | Response |
|---|---|
| legacy | `{ok:true}` |
| `'error'` | `{ok:true}` + WARN `sso_logout_mode_unknown` |
| SSO, valid, verified | `{ok:true, redirect}` |
| SSO, `valid:false` | `{ok:true}` |

- Delete the D-52 bullet "No `isSameOrigin` check here"; D-77 supersedes it.
- A cookie-less cross-origin POST still gets today's middleware 307, because the D-62 `COOKIE_GATED_PATHS` check comes first. The 403 is reachable only with a cookie, which is exactly the P-2 threat.
- `SignOutButton`'s same-origin `fetch` sends a matching `Origin`, and its D-63 non-ok branch already handles a 403.

**`/start` order** (S-2 amended):
1. Mode, including `valid:false` → `not_configured`.
2. `isSameOrigin(req,'required')` fails → `failed`.
3. Secret missing → `not_configured`.
4. 303 to Authelia.

##### D-69: agent validator ordering (Agent "Token" section, replaces it)

In `_authorized` (`main.py:154-177`), the SSO branch runs in this order:
1. `current_sso_mode()`. Invalid → 503 `internal_error`.
2. Missing bearer → 401 `missing_bearer` (`main.py:164-166`).
3. **CPU-only header and claim pre-checks, outside the D-18 deadline and before any JWKS access:**
   - `jwt.get_unverified_header` raises `DecodeError` → 401.
   - `kid` missing, not a `str`, or empty → 401.
   - `alg` ∉ the D-2 asymmetric allow-list (covers HS256 and `none`) → 401.
   - Unverified payload (`options={"verify_signature": False}`): `iss` missing or `!=` `mode.agent_issuer` byte-exact → 401.

   All are labelled `invalid_token` (existing label, `tool_metrics.py:39-42`; no new label). Because they never touch the D-31 state machine, a JWKS outage cannot turn them into 503. That holds for AC-23 rows 1 and 4 and for AC-43.
4. `deadline = loop.time() + _RPC_TIMEOUT_S`, then `async with asyncio.timeout_at(deadline)` (D-18):
   - **a.** Cached discovery (D-18; D-27/D-35 re-checks on refetch).
   - **b.** `jwks.key_for(kid)`, the D-31 state machine:
     - known `kid` → verify;
     - unknown `kid` → shielded task;
     - task ok but `kid` absent → 401;
     - task failed, or cooldown with no `last_fetch_ok`/stale → 503 `jwks_unavailable`.
   - **c.** Verified `jwt.decode(token, key, algorithms=[jwk_alg ∩ allow-list], audience=AGENT_PUBLIC_URL, issuer=mode.agent_issuer, leeway=_CLOCK_SKEW_S, options={"require":["exp","iss","aud","sub"]})`.
     - Then strict `int(exp)` inside the same `try` (D-25/D-31).
     - Then `aud == X or aud == [X]` (D-26).
     - Then `isinstance(sub, str) and sub` → else 401 `invalid_token`.
     - `typ` is checked only if the spike confirms Authelia sets it.
     - The verified `issuer=` check is authoritative; step 3's check is an early exit.
   - **d.** Role cache `(iss, sub)` hit, or `ResolveExternalIdentity` with the remaining budget, then the D-17 status map.
- **Tests** (`test_sso_auth.py`, new):
  - one case for each step-3 reject;
  - each step-3 reject with JWKS mocked to raise still gives 401 and the fetch mock is never awaited;
  - `sub` set to `""` or `123` → 401;
  - a missing `exp`/`aud`/`sub` → 401.
- `test_sso_auth_deadline.py` is unchanged: pre-checks consume none of the budget.

##### D-70: Configuration cache (UI "OIDC client" section, insert)

`src/lib/oidcClient.ts` (new) holds a **single slot**, because one issuer and client exist per deployment. A `Map` would grow with every secret rotation (C-18).
```ts
type Slot = { key: string; expiresAt: number; promise: Promise<Configuration> };
let slot: Slot | null = null;
// key = `${issuer}\n${clientId}\n${createHash('sha256').update(secret).digest('hex')}`
```
**`getOidcConfiguration`:**
- If `slot?.key === key && Date.now() < slot.expiresAt`, return `slot.promise`.
- Otherwise overwrite: `p = discovery(...)`, `slot = {key, expiresAt: Date.now() + OIDC_DISCOVERY_FRESH_S*1000, promise: p}` and `p.catch(() => { if (slot?.promise === p) slot = null; })`.

**How it composes:**
- **Eviction** is overwrite on a key change or TTL expiry. The previous Configuration is garbage-collected.
- **D-65 "never cache rejected"** holds: a rejection clears the slot only if the slot still holds that promise, so a newer key is never wiped. Concurrent callers share one in-flight fetch. That is UI discovery, not R-12's resolve single-flight.
- The secret is held only as a hash in the key.
- `Date.now()` keeps fake timers simple. A wall-clock jump only moves one refetch.
- `OIDC_DISCOVERY_FRESH_S = 600` uses the D-13 "Fixed invariant (F-07)" comment form, next to `OIDC_TIMEOUT_S`.
- An exported `__resetOidcConfigurationCache()` is used by D-34's test reset.

**Unit cases:**
- rotated secret → second `discovery` call, new Configuration;
- same key within 600 s → one call;
- 601 s later → refetch;
- rejected discovery is not cached, and the next call refetches;
- a stale rejection does not clear a newer slot.

##### D-72: typed `recordAuthEvent` (against `bffMetrics.ts:9-49`, verified)

- **Today:** `AuthEvent` has 10 members (`:9-19`). `JwtRejectReason` is `'no_secret'|'expired'|'invalid'` (`:20`). The signature is `recordAuthEvent(event, reason?: JwtRejectReason)` (`:47`).
- **Callers today:** `auth.ts:27,33` (jwt_rejected), `identity.ts:22,32,35`, `login/route.ts:11,27,33,37`, `refresh/route.ts:9`, `logout/route.ts:11` (bare `'logout'`, which this feature rewrites) and `bffAllowlist.test.ts:48-49`.

**`src/lib/ssoErrors.ts`** (new leaf, no imports):
```ts
export const SSO_ERROR_CODES = ['failed','not_configured','linked','ambiguous','inactive','no_email','no_access'] as const;
export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];
```

**`bffMetrics.ts`:**
```ts
import type { SsoErrorCode } from '@/lib/ssoErrors';
export type AuthEvent = /* existing 10 */ | 'sso_login_ok' | 'sso_login_failed' | 'sso_login_error' | 'login_disabled';
export const LOGOUT_REASONS = ['verified','unverified','expired_too_old','cross_origin'] as const;
export type LogoutReason = (typeof LOGOUT_REASONS)[number];
type AuthEventReason = { jwt_rejected: JwtRejectReason; logout: LogoutReason; sso_login_failed: SsoErrorCode };
export function recordAuthEvent<E extends AuthEvent>(
  event: E, ...reason: E extends keyof AuthEventReason ? [AuthEventReason[E]] : []
): void { const [r] = reason; authEvents().add(1, r ? { event, reason: r } : { event }); }
```

**Recording rules:**
- **Shared helper in `auth.ts`:** `verifySessionJwt(token): Promise<{ok:true; payload} | {ok:false; kind: JwtRejectReason; payload?}>` records **nothing**.
  - `verifyAccessToken` maps `kind` to `recordAuthEvent('jwt_rejected', kind)`.
  - `verifyAccessTokenForLogout` maps to `LogoutReason`: `no_secret` and `invalid` → `unverified`.
  - The logout path therefore never emits `jwt_rejected`, and middleware does not double-count, because the D-62 cookie-gated exemption runs before `getSessionFromRequest` (`middleware.ts:39-41` pattern).
- **One event per SSO outcome**, emitted only by `ssoErrorRedirect` and the success branch:
  - `sso_login_ok` on success;
  - `sso_login_error` when `fault=true`: `'error'` mode, discovery or token-endpoint transport failure or timeout, resolve or IssueSession `UNAVAILABLE`/`DEADLINE_EXCEEDED`/unknown;
  - otherwise `sso_login_failed{reason: code}`.
- `/api/auth/login` `PermissionDenied` records `login_disabled` **instead of** `login_failed`.
- **`bffAllowlist.test.ts`:**
  - `drive()` gains `('logout','cross_origin')`, `('sso_login_failed','no_access')` and `('sso_login_ok')`.
  - Keys stay `['event','reason']` (`:20`), so `@AC-41 @feature-294` is unaffected.
  - Assert `SSO_ERROR_CODES` and `LOGOUT_REASONS` equal the literal lists.
  - Assert `recordAuthEvent` is never called with `jwt_rejected` during a logout unit run (`vi.spyOn`).
  - The login page's message map is `Record<SsoErrorCode,string>`, so tsc enforces exhaustiveness.

##### D-73 / D-74 / D-75: doc and runbook deltas

**design.md Risks (D-73, replaces D-37's latency note):**
> "Callback worst case ≈ 60–70 s (mode, secret, discovery, exchange+JWKS, resolve and session, each ≤ 10 s, run sequentially). Accepted residual; no overall deadline (C-18). Invariant: the steps before the code exchange (≤ 30 s worst case) stay under Authelia's authorization-code lifespan (`identity_providers.oidc.lifespans.authorize_code`, default 1m — spike-confirmed). Caddy `reverse_proxy` sets no response timeout."

Add a matching spike-gate row: "authorization-code lifespan ≥ 30 s pre-exchange budget".

**xstockstrat cutover runbook (D-74).** The draft names no path. Proposal: new `docs/runbooks/authelia-sso-cutover.md`. Insert:
- **Pre-check:** "From the app VM: `getent hosts auth.<domain>` and `curl -fsS https://auth.<domain>/.well-known/openid-configuration` succeed, and the JWKS URL in that document returns 200. The UI (discovery, token, JWKS) and the agent (discovery, JWKS) call Authelia server-side."
- **Rollback, in this order:** "(1) Config: set `ui/oidc.issuer` and `agent/oidc.issuer` to `""` and `identity/auth.password_login_enabled` to `true`; verify AC-44. (2) Only then revert code (identity first; 053 down optional, D-36). (3) Every user with outcome CREATED (audit `identity.external.created`) has an unusable password (D-6): run `manage-users.py reset-password <email>` for each person who needs password login."
- **Residual:** "On a cut-over deployment with the flag `false`, a config outage renders the legacy login (AC-46) where password login is refused. Restore config reachability; there is no in-app workaround."
- **Signals** (D-42 list plus D-72): `ui.auth.events{event=sso_login_failed, reason}`, `{event=sso_login_error}`, `{event=logout, reason=cross_origin}`, and ERRORs `sso_issuer_invalid{reason}` and `app_url_invalid`.

**homelab-edge `docs/runbooks/sso.md`:**
- §8 gains: "`TODO(verify)`: back-channel path from the app VM to `auth.<domain>` (public hairpin vs tailnet)."
- New bullet: "Every xstockstrat back-channel call (UI token/discovery/JWKS, agent discovery/JWKS) comes from the app VM's single source IP; any Authelia rate-limit zone keyed on `{remote_host}` must exempt it." The `(public_routes)` zones are keyed `{remote_host}` (`Caddyfile.j2:113-167`).
- Logout section: the `rd` cookie-domain rule (D-51).

**D-75 (UI Transaction-cookie bullet, replaces it):**
- Cookie attributes: `httpOnly`, `sameSite:'lax'`, `secure: process.env.NODE_ENV === 'production'` (mirrors `auth.ts:53-54`), path `/api/auth/sso/callback`, Max-Age 600.
- CI e2e runs `next start` (production) on `http://localhost`, where Chromium accepts `Secure` cookies; existing session cookies already rely on this.
- Callback error logging uses `serverLog.warn('sso_callback_failed', {error_class: err.constructor.name, code})`, where `code` is the D-41 code, never the auth code.
- The test injects the sentinels `CODE-SENTINEL` (query), `IDTOKEN-SENTINEL` (token response) and `sentinel@example.test`, then asserts that no `serverLog` or console argument contains any of them.

### (C) Final text for the round-8 fixes (round 9)

##### 1. D-79: issuer grammar

**Shared fragments.** Each language builds the pattern from these named strings. The vector file holds the two assembled literals, and each language's test asserts that its constant equals the JSON literal byte for byte.

```
LABEL = (?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?
TLD   = (?![a-z0-9]{2}--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?
PORT  = (?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3})
ORIGIN= (?:https://(?:(?:LABEL\.)*TLD|127\.0\.0\.1|\[::1\])(?::(?!443(?:/|$))PORT)?|http://(?:localhost|127\.0\.0\.1|\[::1\])(?::(?!80(?:/|$))PORT)?)
PATH  = (?:/(?!\.\.?(?:/|$))[A-Za-z0-9._~!$&'()*+,;=:-]+)*
ISSUER_PATTERN  = ^ORIGIN PATH$
APP_URL_PATTERN = ^ORIGIN$
```

**Literal `ISSUER_PATTERN`** (TS `String.raw` / Python `r"..."`):
```
^(?:https://(?:(?:(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?![a-z0-9]{2}--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?|127\.0\.0\.1|\[::1\])(?::(?!443(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?|http://(?:localhost|127\.0\.0\.1|\[::1\])(?::(?!80(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?)(?:/(?!\.\.?(?:/|$))[A-Za-z0-9._~!$&'()*+,;=:-]+)*$
```
`APP_URL_PATTERN` is the same string with the final `(?:/(?!\.\.?(?:/|$))[A-Za-z0-9._~!$&'()*+,;=:-]+)*` group removed (it ends `...{0,3}))?)$`).

**Port bound.** It is encoded in the regex, so no separate code check exists to drift:
- 1..65535, no leading zero, no empty port;
- `:443` is refused for https and `:80` for http (the lookahead fires only when `/` or the end follows, so `:4430` and `:8080` pass).

**Loopback rule.**
- `http://` is accepted only for exactly `localhost`, `127.0.0.1` and `[::1]`.
- `https://` accepts those three plus LDH hostnames.
- No other IP literal is accepted in either scheme.
- Callers derive "loopback" as `issuer.startsWith('http://')` **after** validation passes. That drives D-34 `allowInsecureRequests` and the agent's httpx. There is no second host list.

**Callers.**
- TS (`src/lib/oidcIssuer.ts`):
  ```ts
  const ISSUER_RE = new RegExp(ISSUER_PATTERN); // no flags; never g/y/u/v/i
  export function isValidIssuer(v: string): boolean {
    if (!ISSUER_RE.test(v)) return false;
    const u = new URL(v);
    return u.origin + (v.length > u.origin.length ? u.pathname : '') === v;
  }
  ```
  `parseAppOrigin(raw)` is `typeof raw === 'string' && APP_URL_RE.test(raw) && new URL(raw).origin === raw ? raw : null`.
- Python (`app/sso_mode.py`):
  ```python
  _ISSUER_RE = re.compile(ISSUER_PATTERN)  # no flags
  def is_valid_issuer(v: object) -> bool:
      return isinstance(v, str) and _ISSUER_RE.fullmatch(v) is not None
  ```

**Path class is a deliberate tightening of D-79's "printable ASCII minus `% \ @ ? #`".** The path uses RFC 3986 pchar without `%` and `@`, segments must be non-empty, and `.`/`..` segments are refused. Otherwise characters such as `"`, `<`, `>`, `^`, `` ` ``, `{`, `}`, tab, a dot segment or `//` would be rewritten by WHATWG. The TS round-trip would then reject a string the Python regex accepts, which is exactly the divergence D-79 forbids. The `(?![a-z0-9]{2}--)` lookahead refuses reserved-LDH labels and `xn--` A-labels for the same reason: ada validates punycode and Python does not. That is consistent with "IDN rejected by design".

**Why both engines agree on every row.**
- No `\d`, `\w`, `\s` or `\b`; every class is an explicit ASCII range. Python's `\d` would match Unicode digits; JS `\d` does not. The fullwidth-port row guards against anyone switching to `\d`.
- No `i` flag, so the Unicode case folding of U+212A (K) and U+017F (ſ) cannot arise.
- No `\Z` (in JS `\Z` silently means the letter `Z`). `$` is used instead:
  - JS without `m`: end of input only.
  - Python `fullmatch`: `$` may match before a final `\n`, but `fullmatch` must still consume that `\n`, and no class accepts it. So a trailing `\n` is rejected in both. The `$` inside the lookaheads can only reject strings that already fail.
- Only `(?:)` and `(?!)`: no lookbehind (ES2018), no named groups (`(?P<>)` vs `(?<>)`). TS target ES2017 is irrelevant because `new RegExp(string)` gets no compile-time regex check.
- No char class contains `--`, `&&`, `~~`, `||` or a leading `[`, so Python raises no FutureWarning and JS `v`-mode semantics never apply.
- Astral or non-ASCII input:
  - JS without `u` sees surrogate code units outside every class.
  - Python sees one code point outside every class.
  - Both reject.

**Vector file** `scripts/testdata/oidc-issuer-vectors.json`:
```json
{
  "issuer_pattern": "^(?:https://(?:(?:(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*(?![a-z0-9]{2}--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?|127\\.0\\.0\\.1|\\[::1\\])(?::(?!443(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?|http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::(?!80(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?)(?:/(?!\\.\\.?(?:/|$))[A-Za-z0-9._~!$&'()*+,;=:-]+)*$",
  "app_url_pattern": "^(?:https://(?:(?:(?![a-z0-9]{2}--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*(?![a-z0-9]{2}--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?|127\\.0\\.0\\.1|\\[::1\\])(?::(?!443(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?|http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::(?!80(?:/|$))(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3}))?)$",
  "issuer": [
    {"name": "https_host",            "value": "https://auth.example.test",              "valid": true},
    {"name": "https_port",            "value": "https://auth.example.test:8443",         "valid": true},
    {"name": "https_port_4430",       "value": "https://auth.example.test:4430",         "valid": true},
    {"name": "https_port_max",        "value": "https://auth.example.test:65535",        "valid": true},
    {"name": "https_port_min",        "value": "https://auth.example.test:1",            "valid": true},
    {"name": "https_path",            "value": "https://auth.example.test/realm",        "valid": true},
    {"name": "https_path_nested",     "value": "https://auth.example.test/realm/sub",    "valid": true},
    {"name": "https_path_pchar",      "value": "https://auth.example.test/~a_b.c;d=e",   "valid": true},
    {"name": "https_digit_label",     "value": "https://1.example.test",                 "valid": true},
    {"name": "https_single_label",    "value": "https://auth",                           "valid": true},
    {"name": "https_localhost",       "value": "https://localhost",                      "valid": true},
    {"name": "https_127",             "value": "https://127.0.0.1:8443",                 "valid": true},
    {"name": "https_v6_loopback",     "value": "https://[::1]",                          "valid": true},
    {"name": "http_localhost",        "value": "http://localhost",                       "valid": true},
    {"name": "http_localhost_port",   "value": "http://localhost:9094",                  "valid": true},
    {"name": "http_127_port",         "value": "http://127.0.0.1:9094",                  "valid": true},
    {"name": "http_v6_loopback",      "value": "http://[::1]:9094",                      "valid": true},
    {"name": "http_port_443",         "value": "http://localhost:443",                   "valid": true},
    {"name": "http_non_loopback",     "value": "http://auth.example.test",               "valid": false},
    {"name": "http_127_0_0_2",        "value": "http://127.0.0.2:9094",                  "valid": false},
    {"name": "upper_scheme",          "value": "HTTPS://auth.example.test",              "valid": false},
    {"name": "no_slashes",            "value": "https:auth.example.test",                "valid": false},
    {"name": "scheme_only",           "value": "https://",                               "valid": false},
    {"name": "empty",                 "value": "",                                       "valid": false},
    {"name": "space_only",            "value": " ",                                      "valid": false},
    {"name": "leading_space",         "value": " https://auth.example.test",             "valid": false},
    {"name": "trailing_space",        "value": "https://auth.example.test ",             "valid": false},
    {"name": "trailing_newline",      "value": "https://auth.example.test\n",            "valid": false},
    {"name": "tab_in_path",           "value": "https://auth.example.test/\trealm",      "valid": false},
    {"name": "nul",                   "value": "https://auth.example.test\u0000",        "valid": false},
    {"name": "upper_host",            "value": "https://Auth.example.test",              "valid": false},
    {"name": "https_default_port",    "value": "https://auth.example.test:443",          "valid": false},
    {"name": "https_default_port_path","value": "https://auth.example.test:443/realm",   "valid": false},
    {"name": "http_default_port",     "value": "http://localhost:80",                    "valid": false},
    {"name": "leading_zero_port",     "value": "https://auth.example.test:08443",        "valid": false},
    {"name": "empty_port",            "value": "https://auth.example.test:",             "valid": false},
    {"name": "port_zero",             "value": "https://auth.example.test:0",            "valid": false},
    {"name": "port_65536",            "value": "https://auth.example.test:65536",        "valid": false},
    {"name": "port_six_digits",       "value": "https://auth.example.test:100000",       "valid": false},
    {"name": "fullwidth_port",        "value": "https://auth.example.test:８４４３", "valid": false},
    {"name": "short_ipv4",            "value": "http://127.1:9094",                      "valid": false},
    {"name": "short_ipv4_https",      "value": "https://127.1",                          "valid": false},
    {"name": "hex_ipv4",              "value": "https://0x7f000001",                     "valid": false},
    {"name": "numeric_last_label",    "value": "https://auth.example.123",               "valid": false},
    {"name": "non_loopback_ipv4",     "value": "https://192.168.1.10",                   "valid": false},
    {"name": "non_canonical_ipv6",    "value": "http://[0:0:0:0:0:0:0:1]:9094",          "valid": false},
    {"name": "non_loopback_ipv6",     "value": "https://[2001:db8::1]",                  "valid": false},
    {"name": "trailing_dot",          "value": "http://localhost.:9094",                 "valid": false},
    {"name": "idn_ulabel",            "value": "https://bücher.example.test",       "valid": false},
    {"name": "idn_alabel",            "value": "https://xn--bcher-kva.example.test",     "valid": false},
    {"name": "reserved_ldh",          "value": "https://ab--cd.example.test",            "valid": false},
    {"name": "underscore_host",       "value": "https://auth_x.example.test",            "valid": false},
    {"name": "label_leading_hyphen",  "value": "https://-auth.example.test",             "valid": false},
    {"name": "label_trailing_hyphen", "value": "https://auth-.example.test",             "valid": false},
    {"name": "userinfo",              "value": "https://u:p@auth.example.test",          "valid": false},
    {"name": "backslash",             "value": "https://auth.example.test\\@evil.test",  "valid": false},
    {"name": "query",                 "value": "https://auth.example.test/?x",           "valid": false},
    {"name": "fragment",              "value": "https://auth.example.test#x",            "valid": false},
    {"name": "pct_dot",               "value": "https://auth.example.test/%2e%2e/x",     "valid": false},
    {"name": "dot_dot_segment",       "value": "https://auth.example.test/../x",         "valid": false},
    {"name": "dot_segment",           "value": "https://auth.example.test/./x",          "valid": false},
    {"name": "trailing_slash",        "value": "https://auth.example.test/",             "valid": false},
    {"name": "double_slash",          "value": "https://auth.example.test//x",           "valid": false},
    {"name": "path_quote",            "value": "https://auth.example.test/a\"b",         "valid": false},
    {"name": "path_caret",            "value": "https://auth.example.test/a^b",          "valid": false},
    {"name": "path_brace",            "value": "https://auth.example.test/a{b}",         "valid": false}
  ],
  "app_url": [
    {"name": "https_origin",     "value": "https://xstockstrat-staging.example.test", "origin": "https://xstockstrat-staging.example.test"},
    {"name": "https_port",       "value": "https://x.test:8443",      "origin": "https://x.test:8443"},
    {"name": "local_compose",    "value": "http://localhost:3000",    "origin": "http://localhost:3000"},
    {"name": "http_127",         "value": "http://127.0.0.1:3000",    "origin": "http://127.0.0.1:3000"},
    {"name": "http_v6",          "value": "http://[::1]:3000",        "origin": "http://[::1]:3000"},
    {"name": "unset",            "value": null,                       "origin": null},
    {"name": "empty",            "value": "",                         "origin": null},
    {"name": "trailing_slash",   "value": "https://x.test/",          "origin": null},
    {"name": "path",             "value": "https://x.test/app",       "origin": null},
    {"name": "http_non_loopback","value": "http://x.test",            "origin": null},
    {"name": "default_port",     "value": "https://x.test:443",       "origin": null},
    {"name": "upper_scheme",     "value": "HTTPS://x.test",           "origin": null},
    {"name": "upper_host",       "value": "https://X.test",           "origin": null},
    {"name": "trailing_space",   "value": "https://x.test ",          "origin": null},
    {"name": "query",            "value": "https://x.test?x",         "origin": null},
    {"name": "fragment",         "value": "https://x.test#x",         "origin": null}
  ],
  "mode": [
    {"name": "both_empty",         "ui": "",                          "agent": "",                          "expected": "legacy"},
    {"name": "ui_only",            "ui": "https://auth.example.test", "agent": "",                          "expected": "legacy"},
    {"name": "agent_only",         "ui": "",                          "agent": "https://auth.example.test", "expected": "legacy"},
    {"name": "invalid_half",       "ui": "http://auth.example.test",  "agent": "",                          "expected": "legacy"},
    {"name": "both_valid",         "ui": "https://auth.example.test", "agent": "https://auth.example.test", "expected": "sso"},
    {"name": "both_valid_differ",  "ui": "https://auth.example.test", "agent": "https://auth2.example.test","expected": "sso"},
    {"name": "ui_whitespace",      "ui": " ",                         "agent": "https://auth.example.test", "expected": "sso_invalid"},
    {"name": "ui_http",            "ui": "http://auth.example.test",  "agent": "https://auth.example.test", "expected": "sso_invalid"},
    {"name": "agent_default_port", "ui": "https://auth.example.test", "agent": "https://auth.example.test:443", "expected": "sso_invalid"},
    {"name": "agent_trailing_ws",  "ui": "https://auth.example.test", "agent": "https://auth.example.test ", "expected": "sso_invalid"}
  ]
}
```

**How the tests consume the file.**
- Both languages assert the pattern constant equals the JSON literal.
- `issuer` and `mode` rows run in both languages. `app_url` rows run in TS only; `value: null` maps to `undefined`.
- TS also asserts `ISSUER_RE.test(v) === isValidIssuer(v)` on every row, which proves the round-trip never changes an outcome.
- In the TS mode test, `APP_URL` is set to `http://localhost:3000` so that `sso_invalid` can only come from the issuers.
- Python maps `sso_invalid` to `kind == 'sso' and not valid`.
- The orchestrator should hand-verify the JSON escaping once against both engines in the spec step, as RED/GREEN evidence.

##### 2. D-81: WARN shape
At logout step 0 the route emits the metric `recordAuthEvent('logout','cross_origin')` and the log:
```ts
serverLog.warn('logout_origin_mismatch', { origin_host: originHost(req.headers.get('origin')) });
```
`originHost(h: string): string` is in `sameOrigin.ts`. It returns `'null'` for the literal `null` header, otherwise `new URL(h).host.slice(0, 253)` inside try/catch, and `'unparseable'` on throw. There is no scheme, path, user id or cookie in the log, and the host is never a metric label. The fail-open path (`appOrigin()` null) passes, so there is no WARN; its ERROR comes from D-86.

##### 3. D-82: `ssoErrorRedirect` signature (`src/lib/ssoErrors.ts`)
```ts
export function ssoErrorRedirect(
  code: SsoErrorCode,
  appOrigin: string | null,
  opts: { fault?: boolean; clearTxnCookie?: string } = {},
): NextResponse
```
- **Location:** `appOrigin ? new URL(`/auth/login?error=${code}`, appOrigin).href : `/auth/login?error=${code}`` and the response is `new NextResponse(null, {status: 303, headers: {location}})`.
- **Cookie:** if `opts.clearTxnCookie` is set, the cookie is cleared with the D-75 attributes, path `/api/auth/sso/callback` and `maxAge: 0` (same path, D-49 N-13).
- **Metric:** `if (opts.fault) recordAuthEvent('sso_login_error'); else recordAuthEvent('sso_login_failed', code);`. These are the only two literal call sites (D-83). `sso_login_ok` stays in the callback success branch.
- **Unit case:** `ssoErrorRedirect('not_configured', null, {clearTxnCookie: 'sso_txn_ab…'})` gives 303, `Location: /auth/login?error=not_configured`, and a `Set-Cookie` with Max-Age=0 for that name.

##### 4. D-83: test text (`bffAllowlist.test.ts`, added in the top-level `describe`)
```ts
it('recordAuthEvent reason typing is enforced by tsc (D-83)', () => {
  const typeOnly = (): void => {
    // @ts-expect-error login_ok takes no reason
    recordAuthEvent('login_ok', 'verified');
    // @ts-expect-error logout requires a LogoutReason
    recordAuthEvent('logout');
    // @ts-expect-error a JwtRejectReason is not a LogoutReason
    recordAuthEvent('logout', 'expired');
  };
  expect(typeof typeOnly).toBe('function');
});
```
The function is never called, so no metric is emitted and the `@AC-42` no-op and `@AC-41` key assertions are unaffected. `drive()` gains `recordAuthEvent('logout','cross_origin')`, `recordAuthEvent('sso_login_failed','no_access')` and `recordAuthEvent('sso_login_ok')`.

##### 5. D-84: agent step 3 (module holding the D-2 allow-list, e.g. `app/jwks.py` or the SSO auth module)
```python
def _precheck(token: str, agent_issuer: str) -> str | None:
    """Return the kid, or None for 401 invalid_token. CPU-only; never touches JWKS."""
    try:
        header = jwt.get_unverified_header(token)
        kid, alg = header.get("kid"), header.get("alg")
        if not (isinstance(kid, str) and kid) or not isinstance(alg, str) or alg not in _ASYMMETRIC_ALGS:
            return None
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.InvalidTokenError:
        return None
    if not isinstance(payload, dict) or payload.get("iss") != agent_issuer:
        return None
    return kid
```
- The caller does: `kid = _precheck(token, mode.agent_issuer)`, then `if kid is None: record_auth_rejected("invalid_token"); return False`. That gives 401 via `_send_unauthorized` (`main.py:179-190`). Only then does it enter the D-18 `timeout_at`.
- The `isinstance(alg, str)` guard is load-bearing. A JSON-array `alg` would otherwise raise `TypeError` (unhashable) on the frozenset membership test and fall to 503 `internal_error`.
- Tests: non-JSON payload, non-dict payload (`[1]`), list-valued `alg`, and an integer `kid`, all 401 with the JWKS mock never awaited.

##### 6. D-86: dedup structure
- **TS.** Add one helper to `src/lib/serverLog.ts` (logging responsibility; reused by both modules):
  ```ts
  const loggedOnce = new Set<string>();
  export function errorOnce(message: string, reason: string, value: string | undefined): void {
    const k = `${message}\u0000${reason}\u0000${value ?? '<unset>'}`;
    if (loggedOnce.has(k)) return; loggedOnce.add(k); serverLog.error(message, { reason });
  }
  ```
  - `appOrigin()` calls `errorOnce('app_url_invalid', 'app_url', process.env.APP_URL)` whenever `parseAppOrigin` returns null, **unset included**. This refines round 8's "non-null input only"; otherwise an unset `APP_URL` in SSO mode would log nothing.
  - `loadOidcConfig` calls `errorOnce('sso_issuer_invalid', 'ui_issuer'|'agent_issuer', value)` for the two issuer reasons. For `app_url` it only calls `appOrigin()` and logs nothing itself.
  - The log payload is `{reason}` only.
- **Python** (`app/sso_mode.py`): `_logged_invalid: set[tuple[str, str]] = set()`. In `current_sso_mode()`, `if (reason, value) not in _logged_invalid: _logged_invalid.add(...); logger.error("sso_issuer_invalid", extra={"reason": reason})`. It runs single-threaded on the event loop, so no lock is needed.
- The set grows only with distinct operator-set config values. No cap (C-18).

##### 7. D-87: `assertJwksSameOrigin` placement (`src/lib/oidcClient.ts`)
```ts
function assertJwksSameOrigin(cfg: Configuration, issuer: string): Configuration {
  const j = cfg.serverMetadata().jwks_uri;
  if (!j || new URL(j).origin !== new URL(issuer).origin) throw new Error('jwks_uri_cross_origin');
  return cfg;
}
// in getOidcConfiguration, on miss:
const p = discovery(new URL(issuer), clientId, meta, ClientSecretBasic(secret), opts)
  .then((cfg) => assertJwksSameOrigin(cfg, issuer));
slot = { key, expiresAt: Date.now() + OIDC_DISCOVERY_FRESH_S * 1000, promise: p };
p.catch(() => { if (slot?.promise === p) slot = null; });
return p;
```
- It is module-private and tested through the `fetch` stub (D-34).
- A missing `jwks_uri` also rejects.
- The unit case is: a cross-origin `jwks_uri` rejects, the next call calls `discovery` again, and `slot` is null in between.

### (D) Register-only amendments after round 9

- **D-89, exact discovery issuer.** openid-client 6.8.9 normalises the issuer comparison (`new URL(..).href`, `index.js:287`) and skips it for `/.well-known/` issuers (`:264`) and for `*.b2clogin.com`. The orchestrator verified this. `assertDiscoveredMetadata(cfg, issuer)` asserts `cfg.serverMetadata().issuer === issuer` byte-exact, then the same-origin `jwks_uri`, inside the cached promise.
- **D-90, one log-once helper per language**, used by `sso_mode_misconfigured` and the invalid-config ERRORs, with test isolation (an exported reset, or a pytest fixture).
- **D-91, operator grammar spelled out in FR-14 and the runbook.** The e2e stub IdP is on `http://127.0.0.1:<port>`. Local docker-compose SSO is unsupported.
- **D-93, `tsc --noEmit`.** The UI gains a `typecheck` script plus a CI step; the type assertions stay in `bffAllowlist.test.ts`. The spec runs it first and fixes pre-existing errors in the same PR (the owner accepted this).

- **Post-approval review (`/sdd-review` re-run): AC-58..AC-60.** These are new scenarios for behaviour the design already settles; no new mechanism.
  - AC-58: an invalid `APP_URL` gives `not_configured`, and the Origin check is skipped (D-66, (B) §D-68 `if_present`). Tested in the start/logout `route.test.ts` with `APP_URL` stubbed, plus `sameOrigin.test.ts`.
  - AC-59: `/start` GET returns 405; a cross-origin or Origin-less POST gives `failed` (D-54, D-68). Tested in the start `route.test.ts` and e2e.
  - AC-60: unreadable config gives `failed` on start and callback (D-22). Tested in the route unit tests with the config client mocked to time out.
- **Config migration renumbered from `050` to `051`** (D-94; feature 341 owns `050`), **then `051` to `052`** (D-99; feature 343 owns `051_ingest_backfill_self_serve_keys`), **then `052` to `053`** (D-100; feature 347 owns `052_alpaca_adaptive_rate_limit_keys`). Re-check the next free number at merge.

- **Spike results (2026-11-16): D-95..D-98.** The spike passed; option F is not needed.
  - D-95: the agent reads the granted scopes from `scp` (an array), falling back to a `scope` string; the `typ` check `at+jwt` is enabled.
  - D-96: the Authelia config requirements in homelab-edge: ID-token and access-token `email` claims policies, and `requested_audience_mode: implicit`.
  - D-97: logout uses the portal branch, because 4.39 has no `end_session_endpoint`; `rd` is confirmed.
  - D-98: group removal does not end an existing MCP connection (a runbook residual), and the auth-code lifespan is about 60 s.

### Consumer surfaces (C-14)

- **UI** (`xstockstrat-ui`, all three segments): the login page (SSO button + checkbox per the D-54 table), `/api/auth/sso/{start,callback}`, logout + the shared-header Sign-out button, `/accounts/authorized-apps` (`SsoAppsCard`), and `/.well-known/oauth-*` via `src/app/api/oauth/*`.
- **Agent** (`xstockstrat-agent`): every MCP tool's authentication and effective scope. Tool names, parameters and responses are unchanged.
- **Script:** `manage-users.py update-email`, `unlink-sso`.

---

## Rejected Alternatives

- `R-1` `PyJWKClient` run via `asyncio.to_thread` — rejected because It is synchronous urllib, refetches on every unknown `kid` with no cooldown (a refetch-amplification DoS against Authelia), and has no stale-on-error or single-flight.
- `R-2` Unique index on `lower(email)` — rejected because The migration would fail on existing mixed-case duplicates, which AC-5 says can exist.
- `R-3` Identity also validates `iss` (watches `ui`/`agent`) — rejected because Adds a new watcher and coupling to a SAN-gated, header-blind RPC whose callers already verified the token (YAGNI, C-18).
- `R-4` Agent allow-list of `client_id`/`azp` (a new config key) — rejected because Authelia's per-client `audience` already enforces this. Reconsider only if the spike shows any client can request the audience.
- `R-5` `ResolveExternalIdentity` also mints tokens for the UI (one RPC) — rejected because Mixes the authorization outcome with minting, and contradicts the owner-approved spec (`IssueSessionForUser`).
- `R-6` Stamp narrowed `roles` instead of an effective scope — rejected because OAuth-scope masks such as 0x03 correspond to no role set (`scopes.py:39`).
- `R-7` HS256-signed (JWS) SSO transaction cookie — rejected because `verifyAccessToken` accepts any HS256 `JWT_SECRET` JWS, so the cookie would also be a valid session token (type confusion).
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
- Round 7 to 9 runners-up, recorded in D-n rather than R-n:
  - an overall callback `raceDeadline` (D-73);
  - folding an invalid issuer into `'error'` (D-66);
  - D-77 in SSO mode only (D-80, owner chose both modes);
  - WHATWG-vs-ad-hoc validators (D-79);
  - the `authEvents.typecheck.ts` file move (D-93, owner chose `tsc`).

---

## Open Risks

- [x] **The Authelia v4.39.28 spike gates `/sdd-spec`.** Done 2026-11-16 on a local, checksum-verified v4.39.28 (D-95..D-98). The Claude.ai and Claude Code client side of (a) stays unverified until cutover. It must confirm items (a)–(e), the RS256 ID-token alg, and the end_session / portal `rd` / GET `/logout` behaviour (D-59). Plus the D-73 authorization-code lifespan of at least the pre-exchange budget, and the D-89 discovery `issuer` with no trailing slash. Fallback: option F. Addressed before `/sdd-spec`.
- [ ] **Feature 319 (RevokeToken unverified decode) merges first or alongside** (D-52). Addressed at rollout ordering.
- [ ] **D-93's first `tsc --noEmit` run may surface pre-existing errors.** The owner accepted fixing them in this PR. Addressed at the first UI step.
- [ ] **Assumptions the spec must prove RED/GREEN:**
  - the vector file under both engines;
  - Next/vitest not type-checking tests (now moot under D-93, but `tsc` must go RED on a removed `@ts-expect-error`);
  - the PyJWT error classes (verified at 2.15.0).
  
  Addressed at the step that introduces each test.
- [ ] **Accepted residuals.** These go into the runbook; they are not fixed:
  - a stolen access token expired < 14 d can force log-out-everywhere (D-61);
  - the concurrent deactivation race (R-14);
  - the callback worst case of ~60–70 s (D-73);
  - a 403 logout leaves a live session behind the login page (D-81);
  - a config outage on a cut-over deployment blocks new logins (D-74);
  - a UI-issuer typo also gives MCP 503 (D-78);
  - trader `BackfillBars` WRITE (owner-accepted);
  - the analysis-029 rename (owner-accepted).
- [ ] **homelab-edge PR follow-ups.** Each is `TODO(provide/verify)`:
  - `sso.md` §7/§8 `unlink-sso`;
  - the Logout section and `rd` cookie domain;
  - post-logout redirect registration;
  - back-channel reachability;
  - the rate-limit exemption for the app VM IP (D-74).
  
  Addressed in a separate homelab-edge PR.
- [ ] **`/sdd-review product-spec` must re-run** on the amended FR-1/2/9/14/15 text and AC-24/29/47/54..57 (P-03). Addressed before `/sdd-spec`.

---

## Constitution Rules Touched

- `C-01` / `F-04`: honored. Every cited path was read or comes from recon; new files are named as new.
- `C-03`: honored. Pre-auth calls carry `x-trace-id`; post-auth calls carry the trio. No resolve single-flight (D-30).
- `C-04`: honored. `ExternalIdentityOutcome` has `_UNSPECIFIED=0`; refusal details are shared constants (D-24).
- `C-05`: honored. Every key is relative and seeded by 053; readers are listed; `check-config-wiring --final` reports zero findings.
- `C-07`: honored. Migrations `007` (identity) and `053` (config) are free (renumbered 050→051→052→053: feature 341 took `050`, feature 343 took `051`, feature 347 took `052`; re-check the next free number at merge).
- `C-08` / `C-15` / `P-06`: honored. Every FR maps to ≥1 AC and every AC to a planned test (seam checks v2–v4).
- `C-09`: honored. `buf lint`, `buf breaking`, `buf-gen`.
- `C-10`: honored. Both agent scope sites are narrowed (D-3).
- `C-11`: honored. Full SDD design, 9 rounds.
- `C-12` / `C-13`: honored. Stub-IdP fixtures go in `e2e/fixtures/` + `INVENTORY.md`; agent fixtures in `conftest.py`.
- `C-16`: honored. See Business Rules below; CHANGEs are owner-signed (context.md 2026-11-16).
- `C-17`: honored. Existing primitives, distinct accessible names, 44 px targets (D-63).
- `C-18`: honored. Single-statement writes, no single-flight, no ID-token storage, no cross-process counters, single-slot cache, one regex.
- `F-01`: honored. No applied migration is edited.
- `F-06`: honored. Identity holds at most one client per resolve (D-21).
- `F-07`: honored. Fixed invariants use the invariant comment form; client IDs come from config.
- `F-11`: honored. No unresolved Floor breach in any round.

---

## Business Rules Touched (C-16)

- **PRESERVE** identity `user-management-ui.feature` (043), except as below.
- **PRESERVE, flag-conditional** identity `user-management-ui.feature` `@AC-2/3/6`: password login holds only while `identity/auth.password_login_enabled` is `true` (seeded `true`). Owner sign-off 2026-11-16 (context.md).
- **EXTEND** identity `user-management-ui.feature` `@AC-8`: link/create audits with payload `{user_id, issuer, outcome}` (D-21).
- **PRESERVE, legacy mode** identity `fix-identity-auth-code-race.feature` `@AC-1/2/3/5/6` (265).
- **EXTEND** identity `fix-identity-auth-code-race.feature` `@AC-4` (265): `IssueSessionForUser` is a third minting path through the same private `sessionResponse`.
- **PRESERVE** identity `fix-push-untargeted-broadcast.feature` `@AC-9/10` (242); `mcp-user-profile-roles.feature` `@AC-10` (183); `signal-map-instrumentation.feature` (294).
- **EXTEND** identity `signal-map-instrumentation.feature` `@AC-24`: the new audits are counted on failure and have no deadline.
- **PRESERVE** ui `ui-auth-improvements.feature` (153); `ui-middleware-nodejs-runtime.feature` `@AC-1..7` (128); `fix-ui-transport-hardening.feature` `@AC-1/2/3/4/6` (271); `signal-map-instrumentation.feature` `@AC-33/34`.
- **EXTEND** ui `ui-auth-improvements.feature` `@AC-2/3/4`: the SSO callback sets cookies identically, and remember-me is bound via the txn cookie.
- **CHANGE** ui logout, both modes. The changes:
  - a Sign-out button in the shared header;
  - JSON instead of a redirect for an expired-session logout;
  - 403 for a cookie-bearing logout from a foreign `Origin`;
  - revoke only for a signature-valid token (319).

  Signed off by the owner @ 2026-11-16 (context.md: D-60, P-2/D-77, D-80).
- **PRESERVE in legacy mode only** agent `@AC-19 @feature-294` (D-17).
- **EXTEND** `platform.feature` `@AC-41 @feature-294`: the new instruments carry only closed, identifier-free labels (D-72).
