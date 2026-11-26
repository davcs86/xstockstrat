# Recon: authelia-sso

**Created**: 2026-11-24 (re-spec recon; supersedes the 2026-11-16 recon, which stays in git history)
**From**: product-spec.md (amended 2026-11-24)
**Tree**: ccr-589817f0-cyg7gy@b3055c0 ≡ origin/ccr-589817f0-cyg7gy (⊇ origin/main-dev@0dbc26b)
**Affected services**: xstockstrat-identity, xstockstrat-ui, xstockstrat-agent, xstockstrat-config; packages/proto; scripts/

---

## Objective

Each deployment chooses its login with one config key, `identity/auth.mode` (`local` default | `both` | `oidc`). In `both`
and `oidc` the UI is an OIDC relying party of an external issuer and resolves `(iss, sub)` to an existing
`identity.users` row linked only through an explicit "Link SSO" (password re-entry, `prompt=login`); in `oidc` the agent
accepts only that issuer's JWT access tokens. No email matching, no user creation; DigitalOcean stays `local`.

## Codebase Map

- **`xstockstrat-identity`** (Node)
  - Server wiring: `src/index.ts:39-46` (`addService(IdentityServiceService, impl)`; methods bind by camelCase name);
    watcher `src/index.ts:24` (`new ConfigWatcher(configEndpoint, 'identity')`).
  - `authenticateUser`: `src/grpc/identityServiceImpl.ts:150-206`. Query `:157` filters `is_active = true` (inactive ≡
    unknown, code 16); seed-admin guard `:170-177` (`isBlockedDefaultAdmin` `:56-58`, `SEED_ADMIN_PASSWORD_HASH`
    `:50-51`); `bcrypt.compare` `:179`; failures via `recordLoginFailure` (`LoginFailureReason`, `src/telemetry.ts:357-362`).
  - Mint: `mintAccessToken` `:304-324` (`aud` only when given, IDENTITY-4), `issueRefreshToken` `:330-343`; the response
    literal is inline at `:189-200` and again in `refreshToken` `:258-269` (no `sessionResponse` helper).
  - `rotateRefreshToken` `:349-383` (refuses inactive, `:364`); `setUserActive(false)` revokes refresh tokens `:962-968`.
  - SAN gate precedent: `src/grpc/adminDirectory.ts:6-49` (`peerDnsSans` `:12-19`, `hasAdminDirectoryPeer` `:21-25`,
    both module-private; check before any `pool` access `:37-40`); delegation `identityServiceImpl.ts:988-990`.
  - Audit: `auditSafe` `:777-788`; `AUDIT_EVENT_TYPES` `src/telemetry.ts:381-388` (metric-label allow-list only);
    `mapDbError` `:116-120` (23505 → code 6 "user already exists").
  - Config read pattern: `this.config.getInt('jwt.access_ttl_seconds', 900)` `:140`; `ConfigWatcher.getString` exists
    (`src/services/configWatcher.ts:203`); the watcher file is byte-identical across services (`scripts/check-watcher-copies.py`).
  - Last migration: `006_user_metadata` (`migrations/`); `identity.users` (`001_identity_tables.up.sql:6-14`):
    `password_hash TEXT NOT NULL`, `email TEXT NOT NULL UNIQUE`, `is_active`, `roles TEXT[] DEFAULT '{"trader"}'`.
- **`xstockstrat-agent`** (Python)
  - MCP auth: `app/main.py` `_authorized` `:140-163` (bearer `:147-152`, `validate_bearer_claims` `:153`),
    `_send_unauthorized` `:165-176` (401 + `resource_metadata`), `_send_identity_unavailable` `:178-182` (503),
    `handle_mcp` `:195-221` (verdict order matters: `IDENTITY_UNAVAILABLE` is truthy).
  - Route table `app/main.py:236-251`: two `/.well-known/*`, `/oauth/{register,authorize,callback,token}`, then
    `Mount("/", handle_mcp)` last. Routes are static; an unrouted `/oauth/*` falls to `handle_mcp` (401, not 404).
  - `app/auth.py:57-103` `validate_bearer_claims` (identity `ValidateToken` over `mtls.secure_channel`, `aud` check `:83`,
    `IDENTITY_UNAVAILABLE` `:24`); closed rejection reasons `app/tool_metrics.py:37-38`.
  - Discovery: `app/oauth_metadata.py:19-26` (`authorization_servers: [AGENT_PUBLIC_URL]`), `:29-41` (`issuer`
    `AGENT_PUBLIC_URL`).
  - Scope: re-derived from `claims["roles"]` at two sites, `app/tools.py:148` (`_caller_access_scope`) and `:218`
    (`CallerPropagationMiddleware` → `client.set_caller`); `app/scopes.py:39` `roles_to_access_scope`.
  - Config: `WATCHED_NAMESPACES = ("agent", "indicators")` `app/config/watcher.py:16`; `read_value` `:68` (imported as
    `read_config_value`); `start_watchers` blocks on every namespace snapshot `:92-97`.
- **`xstockstrat-ui`** (Next.js)
  - Login: `src/app/auth/login/page.tsx` (`'use client'`, `:1`); `CredentialsForm` `src/components/auth/AuthForm.tsx:32`.
  - Routes: `/api/auth/login` (`route.ts:15`, non-16 codes → 503 `:37-43`), `logout` (`route.ts:6-17`, no Origin check,
    no caller in `src/`), `refresh`, `me`.
  - Cookies: `src/lib/auth.ts:47-66` (`access_token`, `refresh_token`, `remember_me`; `sameSite: 'lax'`).
  - Middleware: matcher `src/middleware.ts:22` (excludes `api/auth/login|refresh`, `auth/login`, `\.well-known`,
    `api/oauth`); `PUBLIC_HEALTH_PATHS` `:27-36`; refresh branches redirect to `/auth/login` `:73-77`, `:92-96`; a refresh
    sets cookies on the response only (the handler still sees the old cookie, `:59`, `:100`).
  - Clients: `src/lib/connectClients.ts:105` identity, `:113` config (mTLS `loadMtls` `:35-43`).
  - Config reads: no server-side helper; BFFs call `configClient.getConfig({..., environment: nativeConfigEnvironment()})`
    (`src/lib/insightsBff.ts:171-175`); `deploymentEnv.ts:13-15` maps unset `APPLICATION_ENV` to STAGING (O-34 trap).
  - Accounts: `src/app/accounts/layout.tsx:19` (sync server component, `AGENT_PUBLIC_URL`), authorized-apps page and
    BFF route; nav `src/components/shared/navGroups.tsx:104`, `PlatformHeader.tsx:93-98` (subnav), header actions
    `:248-251`.
  - Session in a handler: `getSessionFromRequest` `src/lib/auth.ts:38-42` (verified access JWT `user_id`).
  - Metrics: `AuthEvent` closed union `src/lib/bffMetrics.ts:9-19`; guard `src/lib/__tests__/bffAllowlist.test.ts`.
- **`xstockstrat-config`** (Node) / scripts / proto / deploy
  - Last config migration `055_analysis_live_enrich_ttl_reseed` (no `053` file; 054 and 055 exist).
  - Seed shapes: plain multi-env `054_…up.sql:4-13`; `is_secret` NULL-ciphertext `049_…up.sql:57-67`.
  - NOTIFY is app-level in `SetConfig` (`src/grpc/configServiceImpl.ts:846-848`); listeners `:352-353`,
    `onNotification` `:410-430`; a plain UPDATE reaches watchers only via the 5-minute backstop (`:205`, `:308-326`).
  - `SECRET_CALLER_ALLOWLIST` `src/grpc/authz.ts:136-155`; `getSecret` NULL-ciphertext branch
    `configServiceImpl.ts:647-653`.
  - `scripts/manage-users.py` (Typer, PEP 723; `_load_db_url` `:62-92`; commands `:165-415`); tests
    `scripts/tests/test_manage_users.py`; CI job `scripts-python` (`.github/workflows/ci.yml:861-894`).
  - `packages/proto/identity/v1/identity.proto`: 22 RPCs `:11-49`, last `ListAdminUserIds` `:49`; `AuthTokenResponse`
    `:57-62`; file ends `:218`; `buf.yaml` excepts `RPC_RESPONSE_STANDARD_NAME`.
  - `APP_URL`: in `deploy/homelab/compose.yml:285` and `.do/app*.yaml` UI blocks; **absent** from `docker-compose.yml`
    and the Playwright env.

## Patterns to REUSE

- Password check for `LinkExternalIdentity` → the inline sequence in `authenticateUser`
  (`identityServiceImpl.ts:157-183`: select, seed-admin guard, `bcrypt.compare`), selected by `user_id` without the
  `is_active` filter so `account inactive` is distinguishable. Extract once rather than copy (C-18 DRY).
- Session mint for `IssueSessionForUser` → `mintAccessToken` + `issueRefreshToken`; the response literal exists twice
  already (`:189-200`, `:258-269`): a third copy argues for one builder.
- SAN gates → `adminDirectory.ts` (`peerDnsSans`, exact match, deny before DB); real-socket test
  `src/__tests__/mtls.test.ts:152`; unit `callWith`/`fakePool` `src/__tests__/adminDirectory.test.ts:13-30` (a second
  consumer makes a `src/__tests__/fixtures/sanCall.ts` home, C-13).
- Post-commit audit → `auditSafe` (IDENTITY-7) + `AUDIT_EVENT_TYPES` entry `identity.external.linked`.
- Single conditional write classified by `err.constraint` → IDENTITY-13 shape; name both unique constraints in `007`.
- Config seed → `054` (plain) and `049:57-67` (secret); idempotent up-files (`migration-rerun`).
- No-login mode write → the `055` CTE: `UPDATE … RETURNING` + `pg_notify('config_changed', json_build_object(...))` with a
  final SELECT referencing the notify CTE; audit trigger copies `updated_by`/`update_reason` (`017:66-79`).
- Operator script → `scripts/manage-users.py` (PEP 723, `_load_db_url`, `scripts/tests/test_*.py` via
  `conftest.load_script`; `docs/patterns/script-tooling.md` Rules 0–2).
- Agent config read → `read_config_value('identity', 'auth.mode')` (synchronous snapshot); test stub
  `tests/test_config_watcher.py:46` `install_watcher`; autouse `config_snapshots` covers new namespaces.
- Agent JWT → `pyjwt[crypto]` already in `uv.lock` (transitively via `mcp`); `httpx` + `respx` for JWKS tests.
- UI config read with explicit environment → `nativeConfigEnvironment()` (D-39); UI e2e auth helpers
  `e2e/helpers/auth.ts`; fixtures per `e2e/fixtures/INVENTORY.md` (no SSO row yet, C-12).
- Server-to-client props on accounts pages → `src/app/accounts/layout.tsx` + `AgentUrlContext.tsx`.

## Existing Business Rules (preserve / extend)

Folded from `scenario-recon` (suites: identity, agent, ui, config, `docs/sdd/business-rules/platform.feature`).

- **CHANGE-by-config (`oidc` only; PRESERVE in `local`/`both`) — needs owner sign-off re-recorded for the re-spec:**
  - identity `@AC-2/@AC-3/@AC-6 @feature-043` (`user-management-ui.feature`): only the "can log in with the password"
    clauses, because `AuthenticateUser` refuses in `oidc` (FR-9).
  - ui `@AC-1/@AC-2/@AC-3 @feature-153` (`ui-auth-improvements.feature`): no credentials form in `oidc` (EXTEND in `both`:
    SSO entry beside the form).
  - ui `@AC-33 @feature-294` (`signal-map-instrumentation.feature`): a refused password POST in `oidc` needs its own
    response so the 401 "Invalid credentials" contract keeps its meaning.
  - agent `@AC-20/@AC-47 @feature-294`, `@AC-9 @feature-147`: the built-in OAuth routes answer 404 in `oidc` (FR-14).
    identity `@AC-1..6 @feature-265` and `@AC-52 @feature-294` stay PRESERVE (the RPCs remain).
- **PRESERVE** identity `@AC-5 @feature-043` (inactive blocked) — on password, SSO and Link paths alike.
- **PRESERVE** identity `@AC-8/@AC-10/@AC-11 @feature-043`, `@AC-13/@AC-20 @feature-274`, `@AC-22/@AC-23 @feature-294`
  (audit, no secrets in responses or logs, last-admin guard, failure reasons). A new `password_login_disabled`
  login-failure reason is EXTEND.
- **PRESERVE** identity `@AC-4 @feature-265`: SSO sessions keep the first-party claim shape and 900 s TTL (no `aud`).
- **PRESERVE** agent `@AC-19 @feature-294`: auth-path faults stay HTTP 401 — the JWKS path must not turn token defects
  into 5xx (FR-2's 503 is only for unfetchable keys, owner sign-off 2026-11-16).
- **PRESERVE** agent `@AC-9 @feature-183`, `@AC-4 @feature-241`, ui `@AC-1 @feature-263`, platform `@AC-5 @feature-210`:
  `x-user-id` is the linked platform `user_id`, never the issuer `sub`; roles from identity, never issuer claims.
- **PRESERVE** ui `@feature-128` (Node runtime, in-process refresh, cookie attributes), `@feature-271` (bounded refresh,
  exact public paths), `@AC-4..7 @feature-153` (Max-Age cap, 401 redirect, no loop), `@AC-3 @feature-360`.
- **PRESERVE / EXTEND** config `@AC-3/@AC-4/@AC-5 @feature-147`, `@AC-14 @feature-338` (the `ui.oidc.client_secret` grant
  follows the SAN-pinned model); `@AC-14/@AC-29 @feature-295` (seed both envs; every reader's default is `local`);
  `@AC-1 @feature-296` (namespace-relative key).
- **PRESERVE, risk** config `@AC-11/@AC-13 @feature-147` (per-user overlay): `auth.mode` must be read globally (see Risks).
- **PRESERVE** platform `@AC-4 @feature-210` (mTLS can't be disabled): the FR-17 command adds no plaintext/no-verify path.

## Dependencies

- Proto/RPC: add `ResolveExternalIdentity`, `LinkExternalIdentity`, `IssueSessionForUser` after `:49`; messages after
  `:218`; reuse `AuthTokenResponse` (`:57-62`) and `Role` (`:170-175`).
- Migrations: identity `007_external_identities`; config next free at execute (`056` on trunk, contested by 314/317/321).
- Config keys: `identity.auth.mode`; `ui.oidc.{issuer,client_id,client_secret,mcp_client_id,mcp_client_id_readonly,
  mcp_client_id_claude_code,mcp_client_id_claude_code_readonly}`; `agent.oidc.issuer`. `config-wiring.json`: identity
  receiver exists (`:105`); new receivers for the agent mode reader and the UI's three namespace bindings; regenerate
  `scripts/config-wiring-stored.json` (CI `config-wiring-stored`, needs a scratch DB).
- Inter-service edges: ui → identity (`ResolveExternalIdentity`, `IssueSessionForUser`, `LinkExternalIdentity`); agent →
  identity (`ResolveExternalIdentity`); ui → config (`GetSecret` `ui/oidc.client_secret`); agent and ui → the issuer
  over HTTPS (discovery, JWKS, token).
- New dependencies: UI OIDC client (`openid-client` absent today); agent `pyjwt[crypto]` made direct (`uv lock`).
- Env: `APP_URL` absent from `docker-compose.yml` and the Playwright env.

## Risks / Not-found

- **R-1 Per-user mode override.** Per-user config writes are self-service (config CLAUDE.md invariant 5) and per-user
  values overlay GetConfig when the reader passes a `user_id`; any `auth.mode` read that carries a user scope could be
  steered by that user. Reads must be global-only (or per-user writes of the key refused).
- **R-2 FR-17 write path.** No operator path writes config today: gRPC needs a client cert plus ADMIN or an
  internal-caller grant (`authz.ts:84-92`), and a plain SQL UPDATE is not notified (5-minute backstop). The 055 CTE
  shape fits; `docs/patterns/script-tooling.md` decides script vs `manage-users.py` command.
- **R-3 `oidc` recovery.** In `oidc` nobody can sign in with a password; the first link needs `both`. Recovery from a
  broken issuer or a lost last link is FR-17 → `local`/`both`. `unlink-sso` of the last admin is not guarded (043
  `@AC-11` covers roles/active only).
- **R-4 Middleware refresh hides new cookies from the handler** (`middleware.ts:59,100`): binding a link to "the current
  session" must use the verified access JWT the handler sees, and `refreshSession().claims` is camelCase (`userId`) while
  `JwtClaims` is snake_case (`src/lib/identity.ts:26`).
- **R-5 Agent route gating.** Legacy `/oauth/*` must answer an explicit 404 in `oidc` (removing the route falls through
  to `handle_mcp` → 401). The mode is read per request; the agent's startup blocks on the new `identity` snapshot.
- **R-6 Identity test mocks lack `getString`** (`identityServiceImpl.test.ts:58,291,357,1141,1388`,
  `identityServiceImpl.otlp.test.ts:40`, `identityTelemetry.test.ts:13`): adding the mode read to `authenticateUser`
  turns code 16 into a TypeError → 13 in those tests.
- **R-7 Agent scope re-derivation at two sites** (`tools.py:148`, `:218`): FR-7 narrowing must reach both, or one stays
  wide.
- **R-8 No identity DB test job**; `migration-rerun` is the only DB coverage (needs idempotent `007`).
- **R-9 UI e2e mock** answers unknown namespaces with `platform` values and has no `getSecret`, no new identity
  handlers and no stub IdP (`e2e/mock-backend.ts:1560-1586`); Playwright is `fullyParallel` with 2 workers.
- **R-10 No UI `typecheck` script / CI `tsc` step** (ledger fails 2026-11-16, D-93).
- **R-11 Draft feature 280-third-party-sso-oidc** proposes `identity.sso.*` for the same problem (owner decision).
- Not found: `oidcConfig.ts`, `/api/auth/sso/*`, `/accounts/sso`, Sign-out button, any `APP_URL` read in UI source,
  `sso_keys` fixture, `sanCall.ts`, identity `test:db`, any 345 code.
- Ledger: fails 2026-11-16 authelia-sso (cite the tool line that enforces a guarantee — openid-client issuer comparison,
  `tsc` coverage).

## Recommended Scope

Advisory, from recon: (1) proto + identity migration 007; (2) identity RPCs (resolve, link, issue session) + the
`auth.mode` gate + tests; (3) config seed + `GetSecret` grant + wiring; (4) agent: mode reader, JWKS validator, `oidc`
path, legacy-route 404, scope narrowing at both sites; (5) UI: config loaders, SSO start/callback, login page per mode,
`/accounts/sso` + Link flow, logout, authorized-apps, discovery routes, nav, Sign-out; (6) scripts: `unlink-sso`, the
mode command; (7) docs (FR-13) and e2e. The 2026-11-16 design's D-* decisions that do not depend on email linking,
`password_login_enabled` or issuer-presence modes carry forward via `debate.md`.
