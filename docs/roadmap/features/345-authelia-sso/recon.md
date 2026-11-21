# Recon: authelia-sso

**Created**: 2026-11-15
**From**: product-spec.md (FR-1..FR-14), acceptance.feature (AC-1..AC-47)
**Tree**: ccr-cb8f5383-len5a9@bf7f6a96 ⊇ origin/main-dev@9f885622 (feature branch not yet created)
**Affected services**: xstockstrat-identity, xstockstrat-ui, xstockstrat-agent, xstockstrat-config (+ `packages/proto`, `scripts/manage-users.py`)

---

## Objective

Give every xstockstrat deployment a config-selected **SSO mode**. In it, the web UI logs in with OIDC against the
homelab's Authelia, then receives an identity-minted session. The agent validates Authelia JWT access tokens and
resolves `(iss, sub, email)` to an `identity.users` row: linked by subject, else by a unique email, else created as
`trader`. It narrows scope by OAuth scope and caches roles 60 s, failing closed. **Legacy mode** is the seeded default,
including the DigitalOcean apps, and stays byte-for-byte today's behaviour. No feature code exists yet: grep for `oidc`,
`password_login`, `external_identities`, `ResolveExternalIdentity` and `IssueSessionForUser` outside `docs/` returns
nothing.

## Codebase Map

- **`xstockstrat-identity`** (Node.js, gRPC 50058; `node:test`, c8 40 %)
  - Server and binding: `src/index.ts:42-46`. Methods bind by name, so a new RPC is a new class method.
    `new IdentityServiceImpl(pool, configWatcher, ledgerAudit)` is at `index.ts:39`. The watcher is namespace
    `identity` only (`index.ts:24`). Server mTLS requires client certs (`src/mtls.ts:22-25`).
  - SAN gate precedent: `src/grpc/adminDirectory.ts`.
    - `ADMIN_DIRECTORY_PEER_SANS` (`:6`); `peerDnsSans(call)` (`:12-19`, module-private); `hasAdminDirectoryPeer`
      (`:21-25`, private).
    - `PEER_SAN_ERROR` (`:27-30`; message hard-coded to ListAdminUserIds). It is checked before the DB (`:37-40`).
    - The file is header-blind and has no relative imports (`:1`). Delegation is at `identityServiceImpl.ts:988-990`.
  - Handlers in `src/grpc/identityServiceImpl.ts` (untyped, raw numeric codes, IDENTITY-3):
    - `authenticateUser`
      - Lines `:150-206`. The query at `:157-160` is case-sensitive `email = $1 AND is_active`.
      - `isBlockedDefaultAdmin` is at `:56-58,170`.
      - The mint at `:185-186` is `mintAccessToken` then `issueRefreshToken`.
    - `mintAccessToken(userId,email,roles,audience?)`
      - Lines `:304-324`. Claims are `{user_id,email,roles,issued_at,expires_at}` plus `aud` only when an audience is given.
      - Signed HS256 (jsonwebtoken default) with env `JWT_SECRET` (`:130-137`).
    - `issueRefreshToken(userId, clientId?, db)`: `:330-343`. There is a single TTL and no remember-me column.
    - `rotateRefreshToken`: `:349-383`, a transactional conditional UPDATE with `u.is_active = true`.
    - `validateToken`: `:211-236`, no is_active check.
    - `createUser`: `:803-829`. Default roles `['trader']` (`:808`), email not lowercased, `password_hash NOT NULL`.
    - `setUserActive`: `:934-986`. Deactivation **revokes all refresh tokens immediately** (`:962-968`).
    - `auditSafe(eventType, targetUserId, metadata, payload)`: `:777-788`, best-effort.
    - `mapDbError`: `:116-120`. It maps `23505` to code 6 "user already exists"; the message is user-specific.
    - Config getters: `this.config.getInt('jwt.access_ttl_seconds',900)` (`:140`) and
      `getInt('jwt.refresh_ttl_seconds',2592000)` (`:144`).
    - OAuth RPCs: `:417-595`. Legacy only; unchanged.
  - Config watcher: `src/services/configWatcher.ts:222-226` `getBool(key, def)`. A missing key returns `def` and
    logs a rate-limited WARN. The file is byte-identical across services, so do not edit it
    (`scripts/check-watcher-copies.py`).
  - Last migration: `006_user_metadata`.
    - `identity.users`: `email TEXT NOT NULL UNIQUE` (case-sensitive), `password_hash TEXT NOT NULL`,
      `roles TEXT[] DEFAULT '{"trader"}'` (`001:6-14`).
    - There is no `lower(email)` index.
    - `refresh_tokens.client_id` was added by `004`.
  - Telemetry closed sets:
    - `LoginFailureReason`: `src/telemetry.ts:357-362`.
    - `AUDIT_EVENT_TYPES` (six `identity.user.*` values): `:381-388`.
    - Guard tests: `telemetryAllowlist.test.ts:46` and `identityTelemetry.test.ts:88-95`.
- **`xstockstrat-agent`** (Python 3.13, Streamable HTTP 9000; pytest, coverage 40 %, `ci.yml:476-478`)
  - `app/main.py`
    - `build_http_app()`: `:99`.
    - Route table at `:250-267`: `/.well-known/*`, `/oauth/{register,authorize,callback,token}`, `/api/tools`,
      `Mount("/", handle_mcp)`.
    - `_authorized` (`:154-176`) validates, then stamps `scope["state"][MCP_CLAIMS_SCOPE_KEY] = claims`.
    - `_send_unauthorized` (`:179`) returns 401 with WWW-Authenticate `resource_metadata`.
    - `_send_identity_unavailable` (`:192`) returns 503 without WWW-Authenticate.
    - `handle_mcp`: `:209`. The lifespan `start_watchers` is at `:237`.
  - `app/auth.py`: `validate_bearer_claims` (`:57-96`) returns `{user_id,email,roles,aud}`, `None` or
    `IDENTITY_UNAVAILABLE` (a truthy `object()`, `:24`). `aud == AGENT_PUBLIC_URL` is checked at `:48,83`.
  - `app/oauth_server.py` (legacy AS, `:76-292`): `JWT_SECRET` txn HMAC (AGENT-6) and the `UI_BASE_URL` /
    `/auth/oauth-login` handoff (`:186-192`).
  - `app/oauth_metadata.py`: `protected_resource_metadata` (`:19`) returns
    `authorization_servers: [AGENT_PUBLIC_URL]`; `authorization_server_metadata` is at `:29`. These builders live here,
    **not in `main.py`**.
  - `app/scopes.py`: `MCP_CLAIMS_SCOPE_KEY` (`:18`), private bit constants (`:33-36`), `roles_to_access_scope` (`:39`).
  - `app/tools.py`
    - `_claims_from_context`: `:101`. `_require_claims`: `:119`.
    - `_caller_access_scope` (`:137`) **re-derives from `roles`**. `_require_admin` (`:149`) tests `& 0x04`.
    - `_caller_user_id` (`:158`) reads `user_id`.
    - `CallerPropagationMiddleware` (`:193`, reads at `:215-217`) also re-derives scope from `roles`.
  - `app/client.py`
    - `_metadata`/`set_caller`: `:62-80`.
    - Identity helpers at `:1520-1639`, one `mtls.secure_channel` per call (AGENT-1), `_RPC_TIMEOUT_S = 10.0`
      (`:44`).
  - `app/config/watcher.py`
    - `WATCHED_NAMESPACES = ("agent","indicators")`: `:16`.
    - `start_watchers` (`:85`) blocks until every namespace's snapshot arrives (90 s, `watch_core.py:36`).
    - `read_value` (`:68`) returns `None` for an unwatched namespace.
  - `app/tool_metrics.py:39`: `record_auth_rejected` reasons form a closed set (`tests/test_telemetry_allowlist.py`).
  - Dependencies (`pyproject.toml:6-22`): no direct JWT library. `pyjwt 2.15.0` and `cryptography 50.0.0` are only
    transitive via `mcp` (`uv.lock:932,344`). `httpx` is direct; `respx` is a dev dependency.
- **`xstockstrat-ui`** (Next.js 15; vitest + Playwright)
  - Login page `src/app/auth/login/page.tsx:1`
    - A `'use client'` page rendering `AuthCardShell` + `CredentialsForm showRememberMe`
      (`src/components/auth/AuthForm.tsx:18,32,36,109`).
    - Local `safeRedirect` at `:8-18` (allow-list `/trader|/insights|/config-ui`).
  - `src/app/auth/oauth-login/{page,OAuthLoginForm}.tsx`: legacy agent handoff via `resolveAgentCallback`
    (`src/lib/oauthCallback.ts:6`, exact-match pattern).
  - `src/app/api/auth/login/route.ts:15-26,47`
    - Calls `identityClient.authenticateUser`, then `setSessionCookies(…, rememberMe ? {maxAge} : undefined)`.
    - Metrics: `withBffMetrics`, `recordAuthEvent`.
    - `Unauthenticated` returns 401 and **everything else returns 503**, including `PERMISSION_DENIED`.
  - `src/lib/auth.ts`
    - `setSessionCookies(res, access, refresh, opts?)` (`:47-66`) sets the `access_token` and `refresh_token` cookies
      and the `remember_me` marker.
    - `REMEMBER_ME_MAX_AGE_SECONDS = 1_209_600` (`:17`); `rememberMeOptsFromRequest` (`:70`).
    - `verifyAccessToken` (`:23-36`) uses jose HS256 `JWT_SECRET`; `rolesToAccessScope` (`:86`).
  - `src/middleware.ts`
    - Runtime nodejs (`:15`).
    - Matcher exclusion regex at `:22`, which includes `api/auth/login|api/auth/refresh|auth/login|auth/oauth-login`.
      **`api/auth/sso/*` is not excluded.**
    - The no-claims branch is at `:45-84`. Tests are in `src/middleware.test.ts` (`matches()` helper).
  - Clients: `src/lib/connectClients.ts`
    - `loadMtls()` (`:31-39`) loads the UI leaf with SAN `xstockstrat-ui`.
    - `identityClient` (`:101`), `configClient` (`:109`).
    - `connectCodeToHttp` (`:127`) maps FailedPrecondition to 400 and PermissionDenied to 403.
  - Identity helpers: `src/lib/identity.ts` (`refreshSession :14`, `revokeToken :42`).
  - Environment helper: `src/lib/deploymentEnv.ts:13` `nativeConfigEnvironment()`.
  - Config reads happen only inside the BFF forwarders (`insightsBff.ts:171-175`, `traderBff.ts:169`). There is no
    server-side helper.
  - The UI never calls `GetSecret`.
  - `/accounts/authorized-apps`: `page.tsx` (client, `apiFetch` `:42,:75`), `accounts/api/authorized-apps/route.ts`
    (`:14,:40,:62-64`).
    - The server-to-client prop pattern is `src/app/accounts/layout.tsx` + `AgentUrlContext.tsx`.
    - Nav entries: `navGroups.tsx:104`, `PlatformHeader.tsx:95`.
  - Libraries: `jose ^5.0.0`, `next ^15.5.28`. There is **no OIDC client library**.
- **`xstockstrat-config`** (Node.js, gRPC 50060)
  - `src/grpc/authz.ts`
    - `HEADER_INTERNAL_CALLER='x-internal-caller'` (`:74`).
    - `SecretCallerGrant` (`:125-134`); `SECRET_CALLER_ALLOWLIST` (`:136-155`, three grants, all SAN-bound).
    - `hasSecretCallerAuthority` (`:178-193`) needs the header, a matching callerID and namespace, the key, and the
      peer SAN.
  - `getSecret`: `configServiceImpl.ts:615-664`. A NULL ciphertext returns `{value:'', found:false}` (`:643-647`).
  - `GetConfig` and `WatchConfig` are open (config `CLAUDE.md` invariant 5).
  - Last migration: `049_notify_commsgun_channel_keys`.
    - Seed shape: `049:…-55`, a staging + production pair with `ON CONFLICT … DO NOTHING`.
    - Seeded-empty secret: `049:57-67` (`value_data '[redacted]'`, `is_secret TRUE`, ciphertext NULL).
    - Stored-key CHECK: `045:127-129`.
- **`packages/proto`**
  - `identity/v1/identity.proto`: 24 RPCs at `:10-50`, the last being `ListAdminUserIds` (`:49`, with a SAN comment at
    `:47-48`).
  - Messages: `AuthTokenResponse{1..4}` (`:57-62`), `TokenClaims{1..6}` (`:64-71`), `Role` (`:170-175`).
    The file ends at `:218`; nothing is reserved.
  - `buf.yaml`: STANDARD lint except `RPC_RESPONSE_STANDARD_NAME` and `RPC_REQUEST_RESPONSE_UNIQUE`, so returning
    `AuthTokenResponse` is allowed. Enum values need the `EXTERNAL_IDENTITY_OUTCOME_` prefix.
- **`scripts/manage-users.py`**
  - Commands at `:165`, `:213`, `:269`, `:339`, `:415`. DB access via `_load_db_url()` (`:62`) and psycopg 3.
  - `update-roles` (`:339-412`) matches `WHERE email = %s` case-sensitively (`:389-395`).
  - Tests: `scripts/tests/test_manage_users.py` (`_mock_conn :47`, `TestUpdateRolesCmd :297`).
- **Deploy**
  - DigitalOcean: `.do/app.yaml` and `.do/app.dev.yaml` use the managed DB (`app.yaml:691-697`).
    - Agent: `UI_BASE_URL`, `AGENT_PUBLIC_URL`, `JWT_SECRET`, `MTLS_*` (`:336-399`).
    - UI: `APP_URL`, `AGENT_PUBLIC_URL`, `JWT_SECRET`, `MTLS_*` (`:607-667`).
    - `db-migrator` is a PRE_DEPLOY job (`:669-689`).
  - Homelab: `deploy/homelab/compose.yml`, with its own DB from `.env` (`:15,21`) and its own `db-migrator` (`:39`).
    - UI block: `:266-298`. Agent block: `:300-330`.
  - `scripts/db-migrate.sh` runs config, then identity, then the rest. No new environment variables are needed.

## Patterns to REUSE

- SAN-gated, header-blind RPC: reuse the `adminDirectory.ts` shape (`peerDnsSans`, check before the DB,
  `PERMISSION_DENIED`).
  - Keep **per-RPC allow-lists**; never widen `ADMIN_DIRECTORY_PEER_SANS` (business rule `@AC-10 @feature-242`).
  - The test template is `adminDirectory.test.ts:25-30` `callWith(san,…)` (look-alike SANs, a missing auth context,
    spoofed headers, zero DB queries). The real-socket variant is `mtls.test.ts:152`.
- Session minting: reuse `mintAccessToken` + `issueRefreshToken` as `authenticateUser` does (`:185-186`). A refresh
  `client_id` of NULL keeps the first-party claim shape (`@AC-4 @feature-265`).
- Atomic guarded write: the IDENTITY-13 pattern (one conditional statement or transaction), as in
  `rotateRefreshToken :349-383`; map errors through `mapDbError` (`:116`).
- Best-effort audit: `auditSafe` (`:777`) with an explicit allow-listed payload. Add the new event types to
  `AUDIT_EVENT_TYPES` (`telemetry.ts:381`).
- Role conversions: `ROLE_ENUM_TO_STRING`, `rolesToStrings` and `stringsToRoles` (`identityServiceImpl.ts:33-43`,
  IDENTITY-9).
- Flag read: `this.config.getBool('auth.password_login_enabled', false)`. The wiring receiver `identityServiceImpl.ts:this.config`
  already exists (`config-wiring.json:105`).
- Config seed: the `049` up/down shape, including a seeded-empty `is_secret` row with NULL ciphertext.
- GetSecret grant: append to `SECRET_CALLER_ALLOWLIST` (`authz.ts:136-155`). Tests go in
  `src/__tests__/secretCallerAuthz.test.ts`.
- Agent claim stamping: `_authorized` (`main.py:154-176`) stamps `MCP_CLAIMS_SCOPE_KEY`; tools read it via
  `_claims_from_context` (`tools.py:101`).
- Agent 401/503 builders: `_send_unauthorized` and `_send_identity_unavailable` (`main.py:179,192`).
- Agent config read: `read_config_value` from the watcher snapshot (AGENT-9). Never use a request-path `GetConfig`
  (`@AC-1 @feature-247`).
- Agent identity call: a new helper in `client.py`, alongside `validate_token`, with `mtls.secure_channel(IDENTITY_ENDPOINT,
  "xstockstrat-identity")` and `timeout=_RPC_TIMEOUT_S` (`@AC-10 @feature-273`).
- Agent test fixtures (C-13 home): `tests/conftest.py` `ADMIN`/`TRADER`/`VIEWER` claims (`:15-17`), `_rpc_error`
  (`:36`), the autouse `config_snapshots` (`:112`, which covers new namespaces automatically), and `install_watcher`
  (`test_config_watcher.py:46`).
  - The end-to-end template is `test_streamable_http_auth.py:37`; the legacy regression net is `test_oauth.py`.
- UI cookies: `setSessionCookies` + `REMEMBER_ME_MAX_AGE_SECONDS`.
  - Every rotation path passes `rememberMeOptsFromRequest` (UI-8). The SSO callback passes `{maxAge}` from the
    signed `state`.
- UI redirect safety: extract `safeRedirect` from `login/page.tsx:8-18` into `src/lib/`, and keep
  `resolveAgentCallback`'s exact-match idea for the OIDC `redirect_uri`.
- UI route shape: `api/auth/login/route.ts` (`withBffMetrics`, `recordAuthEvent`, `serverLog`).
- UI server-to-client prop: `accounts/layout.tsx` + `AgentUrlContext.tsx` (for the Authelia link on authorized-apps).
- UI tests (C-12):
  - `e2e/helpers/auth.ts` (`signTestJwt`, `addAuthCookie`, `TEST_JWT_SECRET`) and `e2e/fixtures/users.ts`.
  - `e2e/mock-backend.ts` (`identityHandlers :281`, config `getConfig :1532`, `configValueOverrides :1496`).
  - `e2e/auth.spec.ts` (Remember-me Max-Age `:44-67`).
  - Unit tests: `src/lib/auth.test.ts`, `src/middleware.test.ts`.
- Script: the `update-roles` command structure plus `test_manage_users.py` `_mock_conn` and the
  `TestSqlParameterization` pattern.
- JWT validation, agent: PyJWT is already locked (2.15.0). Promote it to a direct dependency rather than adding a new
  library.
- JWT validation, UI: `jose` is already present and covers `createRemoteJWKSet`/`jwtVerify` for the ID token. This is a
  design choice, not a repo fact.

## Existing Business Rules (preserve / extend)

Folded from `scenario-recon`. The paths are `services/xstockstrat-<svc>/acceptance/…` and
`docs/sdd/business-rules/platform.feature`.

- **PRESERVE** identity `user-management-ui.feature` (feature 043):
  - `@AC-1` (no password or hash in ListUsers);
  - `@AC-4` (SetUserRoles is the only role path);
  - `@AC-5` (deactivation blocks login);
  - `@AC-7` (admin gate on the six RPCs is unchanged; the new RPCs are SAN-gated);
  - `@AC-10` (no password in payloads or logs);
  - `@AC-11` (the last-admin guard keys on role/active, never on `admin@localhost`).
- **PRESERVE, flag-conditional** identity `user-management-ui.feature` `@AC-2`, `@AC-3`, `@AC-6` (password login after
  create/reset/reactivate). These hold while `auth.password_login_enabled=true`, which is seeded everywhere.
  `design.md` must scope them to legacy mode / flag-on, or they become CHANGEs.
- **EXTEND** identity `user-management-ui.feature` `@AC-8`: new link/create audits with payload `user_id`, `issuer`,
  `outcome`.
- **PRESERVE, legacy mode** identity `fix-identity-auth-code-race.feature` `@AC-1/2/3/5/6` (feature 265,
  ExchangeAuthCode).
- **EXTEND** identity `fix-identity-auth-code-race.feature` `@AC-4` (feature 265). `IssueSessionForUser` is a third
  first-party mint path with the same claim shape, no `aud`, and refresh `client_id` NULL.
- **PRESERVE** identity `fix-push-untargeted-broadcast.feature` `@AC-9` and `@AC-10` (feature 242). ListAdminUserIds
  stays notify-only, and the ui peer is still denied.
- **PRESERVE** identity `mcp-user-profile-roles.feature` `@AC-10` (feature 183): header admin gate on the profile RPCs.
- **PRESERVE** identity `signal-map-instrumentation.feature` (feature 294):
  - `@AC-22`: login failure reasons. The flag-off denial adds a new bounded reason.
  - `@AC-23`: ValidateToken.
  - `@AC-52`: refresh rejections.
- **EXTEND** identity `signal-map-instrumentation.feature` `@AC-24`: audit failure counted, no deadline.
- **PRESERVE** ui `ui-auth-improvements.feature` (feature 153):
  - `@AC-1`: unchecked Remember-me control.
  - `@AC-5/6/7`: 401 redirects to login without looping.
- **EXTEND** ui `ui-auth-improvements.feature` `@AC-2/3/4`. The SSO callback sets cookies identically through the
  signed `state`.
- **PRESERVE** ui `ui-middleware-nodejs-runtime.feature` `@AC-1..7` (feature 128). Node runtime, in-process refresh,
  and `api/auth/refresh` matcher exclusion are unchanged; `/api/auth/sso/*` must be public.
- **PRESERVE** ui `fix-ui-transport-hardening.feature` `@AC-1/2/3/4/6` (feature 271):
  - deadlines are unchanged;
  - public paths are exact (no prefix leaks).
- **PRESERVE** ui `signal-map-instrumentation.feature` `@AC-33/34`: closed `ui.auth.events` set, no credentials in logs.
- **EXTEND** `platform.feature` `@AC-41 @feature-294`: new instruments carry no identifier labels.
- **PRESERVE** agent `mcp-user-profile-roles.feature` `@AC-1..9` (feature 183). Admin tools are gated on the
  effective 0x04 bit, and narrowing can only tighten.
- **PRESERVE** agent `fix-config-audit-author-spoof.feature` `@AC-4` (feature 241): `x-user-id` is the resolved
  `user_id`, never `sub`.
- **EXTEND** agent `fix-agent-client-deadlines.feature` `@AC-11` (feature 273). In SSO mode, a stalled
  `ResolveExternalIdentity` with an expired cache gives the same 503 (no WWW-Authenticate, same `x-trace-id`, within
  10.5 s). An invalid token still gets 401.
- **PRESERVE** agent `fix-agent-client-deadlines.feature` `@AC-10`: every stub call passes a timeout.
- **PRESERVE** agent `fix-agent-client-deadlines.feature` `@AC-5`: legacy mode only.
- **PRESERVE** agent `fix-agent-getconfig-deadline.feature` (feature 247):
  - `@AC-1`: snapshot reads only.
  - `@AC-4`: DCR does not hang. Legacy mode only; 404 in SSO mode.
- **PRESERVE** agent `config-secrets-and-scoping.feature` `@AC-9` (feature 147): txn signed with `JWT_SECRET`. Legacy
  mode only.
- **PRESERVE** agent `signal-map-instrumentation.feature` (feature 294):
  - `@AC-19`: an mTLS fault in the auth path returns 401 `internal_error` (see Risk R-14).
  - `@AC-20/47`: legacy OAuth.
- **EXTEND** agent `signal-map-instrumentation.feature` `@AC-21`: backend rpc_errors attribution for the resolve call.
- **PRESERVE** agent `mcp-list-correlation-prompts.feature` `@AC-4/5`: prompts work on an Authelia-token session.
- **PRESERVE** config `fix-edge-owner-scope.feature` `@AC-4/5/6/8` (feature 263): reads bound to the verified caller.
- **EXTEND** config `config-secrets-and-scoping.feature` (feature 147):
  - `@AC-1/1b`: `ui/oidc.client_secret` seeded `is_secret=true`.
  - `@AC-4`: the new `ui` grant.
- **PRESERVE** config `config-secrets-and-scoping.feature`:
  - `@AC-2/3/14`: redaction.
  - `@AC-5`: fail closed for others.
  - `@AC-16`: an unset secret returns `found=false`.
- **PRESERVE** config `fix-marketdata-secret-exposure.feature` `@AC-3/4/6` (feature 254) and
  `notify-commsgun-channel.feature` `@AC-14` (feature 338). SAN-bound grants stay isolated.
- **EXTEND** config `fix-config-keys-drift.feature` `@AC-14` (feature 295): complete seed rows for all five keys in both
  environments.
- **PRESERVE** config `fix-config-keys-drift.feature` `@AC-29`: identical coded defaults across readers, `false` and
  `""`.
- **PRESERVE** config `fix-config-keys-contract.feature` `@AC-1` (feature 296): relative stored keys.
- **PRESERVE** `platform.feature`:
  - `@AC-19 @feature-295`, `@AC-7`/`@AC-9 @feature-304`, `@AC-6 @feature-296`: config-wiring zero findings, empty
    baseline, receivers.
  - `@AC-1/2/5 @feature-210`: mTLS and the header trio.
- **No CHANGE** with sign-off is required, provided `design.md` scopes the flag- and mode-conditional rules above to
  legacy mode or flag-on.
- **Coverage gaps** (no durable `@AC` exists, so trunk behaviour is unguarded):
  - `/accounts/authorized-apps` (feature 051) and the unified login page (feature 019);
  - agent `aud` validation and RFC 9728 metadata;
  - the role→scope mappings.

## Dependencies

- Proto/RPC (additive, `identity.proto`):
  - `ResolveExternalIdentity(ResolveExternalIdentityRequest{issuer=1,subject=2,email=3})` returns
    `ResolveExternalIdentityResponse{user_id=1, repeated Role roles=2, is_active=3, ExternalIdentityOutcome outcome=4}`.
  - `IssueSessionForUser(IssueSessionForUserRequest{user_id=1})` returns `AuthTokenResponse`.
  - `enum ExternalIdentityOutcome` with the `EXTERNAL_IDENTITY_OUTCOME_` prefix.
  - Then `./scripts/buf-gen.sh` (TS, Python, Go stubs checked in).
- Migrations:
  - identity `007_external_identities` (next after `006`);
  - config `050_authelia_sso_keys` (next after `049`).
  - Both run via `db-migrate.sh` (config first) on DigitalOcean (PRE_DEPLOY) and the homelab (compose `db-migrator`).
- Config keys (new):
  - `identity` / `auth.password_login_enabled` (bool, default false, seeded true);
  - `ui` / `oidc.issuer`, `oidc.client_id` (string `""`);
  - `ui` / `oidc.client_secret` (is_secret, NULL ciphertext);
  - `agent` / `oidc.issuer` (string `""`).
  - Agent `WATCHED_NAMESPACES` gains `ui`.
- Inter-service edges (new):
  - ui → identity: `ResolveExternalIdentity`, `IssueSessionForUser`;
  - agent → identity: `ResolveExternalIdentity`;
  - ui → config: `GetSecret` with `x-internal-caller: ui`, and one-shot `GetConfig` for the `ui`/`identity`/`agent`
    namespaces;
  - agent → config: `WatchConfig ui`;
  - ui and agent → Authelia over HTTPS: discovery/JWKS for both, token endpoint for the UI.
- New environment variables or ports: **none in the spec**. Open item: the UI has no public base URL for the OIDC
  `redirect_uri` (Risk R-8).

## Risks / Not-found

- **R-1. Agent scope is re-derived from `roles` at two sites** (`tools.py:137 _caller_access_scope`, `tools.py:215-217
  CallerPropagationMiddleware`). FR-7 narrowing has no effect unless both read a stamped effective scope, or the
  stamped `roles` are themselves narrowed. AGENT-3 is the choke point.
- **R-2. There is no direct JWT/JWKS library in the agent.** PyJWT is only transitive, and its `PyJWKClient` is
  synchronous (urllib), so it would block the async `_authorized`. Promoting PyJWT needs `uv lock` (uv lock rule).
- **R-3. Adding `ui` to `WATCHED_NAMESPACES` makes agent startup wait for a `ui` snapshot** (90 s timeout,
  `watch_core.py:36`). Ordering is safe because the `ui` namespace already has rows (config `023`) and migration
  `050` runs before services start, but the agent cannot start without the `ui` snapshot.
- **R-4. `password_hash` is NOT NULL** (`001:9`). An SSO-created row needs an unusable hash, because a password login
  must never match it, even with the flag on in legacy mode.
- **R-5. Email is case-sensitive everywhere.** The `UNIQUE (email)` index, `authenticateUser`, `createUser` and
  `manage-users update-roles` all compare as written. Existing mixed-case rows can make a `lower(email)` match return
  more than one row ("ambiguous"). Lowercasing new or synced emails changes how they are stored, and a later
  password login (legacy mode or rollback) with original casing will fail. A `lower(email)` index is new.
- **R-6. The SAN helper is not exported** and its error message is hard-coded to ListAdminUserIds. The gates must stay
  per RPC (`@AC-10 @feature-242`). The file has no relative imports (strip-types).
- **R-7. Identity test mocks lack `getBool`.** These sites would throw, turning an expected code 16 into 13:
  `identityServiceImpl.test.ts:58,292,357,1141,1388`, `identityServiceImpl.otlp.test.ts:40`,
  `identityTelemetry.test.ts:13`.
- **R-8. UI gaps.**
  - There is no public base URL for the UI, so building the `redirect_uri` needs a choice: `APP_URL`, already
    present in DO and the homelab, or a config key.
  - There is no server-side config helper.
  - The login page is a client component.
  - The middleware matcher does not exclude `api/auth/sso/*`.
  - The login route maps `PERMISSION_DENIED` to 503.
  - There is no e2e stub IdP or JWKS, and the mock `getConfig` returns `platform` values for unknown namespaces.
- **R-9. `GetSecret` needs `x-internal-caller: ui` in the request headers**, alongside the SAN (`authz.ts:183`). No
  UI-side constant for that header was verified.
- **R-10. `mapDbError` maps any `23505` to "user already exists"** (code 6). Race handling on
  `external_identities` must key on the raw `err.code`/constraint before mapping.
- **R-11. `setUserActive(false)` already revokes all refresh tokens immediately** (`:962-968`). FR-10 ("at first
  refresh") understates this, and AC-33 holds either way.
- **R-12. Closed telemetry sets.**
  - identity `LoginFailureReason` and `AUDIT_EVENT_TYPES`;
  - agent `record_auth_rejected` reasons;
  - ui `ui.auth.events` (`bffAllowlist.test.ts`).
  - Each gets new members plus an updated allow-list test. No identifier labels (`@AC-41`).
- **R-13. Spec drift: the protected-resource metadata builder lives in `app/oauth_metadata.py:19`**, not `main.py`
  as FR config-key readers state. Correct this in design and spec.
- **R-14. mTLS local fault vs outage.** `@AC-19 @feature-294` returns 401 `internal_error` for an mTLS/local fault in
  the auth path, while FR-8 returns 503 when identity is unreachable. Default: a local fault stays 401; only gRPC
  `UNAVAILABLE`/`DEADLINE_EXCEEDED` gives 503.
- **R-15. Seeded-empty secret.** A NULL ciphertext gives `found=false` (`@AC-16`). The callback must treat
  `found=false` or an empty value as "SSO not configured" (fail closed).
- **R-16. The Authelia v4.39.28 spike is still open**:
  - RFC 8707 `resource` and `aud`;
  - JWT access tokens carrying `scope` and `email`;
  - custom scopes;
  - group re-check on refresh;
  - pre-registered Claude.ai / Claude Code clients;
  - `sub` stability.
  It gates `/sdd-spec`.
- **R-17. Not found**:
  - a bool seed with default `false` and value `true` among config `046`–`049` (only the `041` catalog shape);
  - existing `scopes_supported` in metadata;
  - an `update-email` SQL precedent;
  - the actual UI and agent certificate SANs (convention `xstockstrat-<svc>`, `inter-service-mtls.md:13`).
  `platform.feature` was only partially read (lines 797-2695 were keyword-scanned).
- Ledger traps:
  - fails.md: never change a config key's `value_type` in place (`maintenance_mode` entry). New keys only.
  - insights 092: pick the authz model from the verified caller set. Here the SAN gate's callers are exactly
    `xstockstrat-ui` and `xstockstrat-agent`.
  - insights 072 / FR-B13: agent statelessness. The role cache is per instance, TTL-bounded and fails closed.
  - fails 016: grep a column's write site before reusing it. `refresh_tokens.client_id` means OAuth client and must
    not carry remember-me state.

## Recommended Scope

These boundaries are advisory, not binding:

1. proto: the RPCs, messages and enum, then `buf-gen`.
2. identity migration `007`.
3. config migration `050` plus the `GetSecret` `ui` grant.
4. identity: the password-flag gate; `ResolveExternalIdentity`; `IssueSessionForUser`; email sync; audits and
   telemetry. Include the SAN-gate tests and the config-mock `getBool` fix.
5. `manage-users.py update-email` and its tests.
6. agent: the `sso_mode` / `validate_authelia_token` (JWKS) / resolve client / role cache / effective-scope stamping
   at both sites / 404 gating of the legacy routes / metadata in SSO mode / `ui` watcher. Add PyJWT and re-lock.
7. ui: `oidcConfig.ts` server helpers; `/api/auth/sso/{start,callback}`; the middleware matcher; the login page as a
   server wrapper plus client form; the 403 mapping on `/api/auth/login`; the authorized-apps pointer. Add e2e with a
   stub IdP.
8. docs: mcp-tools runbook, CLAUDE.md files, constitutions (AGENT-1/9, IDENTITY-12/15), `frontend-auth.md`,
   `inter-service-mtls.md` grants, `config-governance.md` registered-keys log, `config-wiring.json` receivers.
