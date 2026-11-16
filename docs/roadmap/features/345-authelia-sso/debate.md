# Debate Register: authelia-sso

**State**: in-debate
**Mode**: full (the owner authorized more than 5 rounds if necessary — context.md 2026-11-15)
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | /sdd-design | 16 | 9 | 1 | 18 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | **Mode is computed per request.** The agent reads both issuers from its WatchConfig snapshot (`read_config_value`; `agent` + `ui` namespaces, `ui` added to `WATCHED_NAMESPACES`). The UI uses a header-less one-shot `GetConfig`. Both issuers non-empty means SSO; anything else means legacy. Half-configured logs `sso_mode_misconfigured` once per process. The legacy branch is today's code, moved but not rewritten. | `main.py:154-177`, `watcher.py:16,68`, recon R-3 | settled |
| D-2 | 1 | **Agent token validation uses PyJWT, promoted to a direct dependency (`pyjwt[crypto]` + `uv lock`), plus a hand-rolled async httpx JWKS cache** (`app/jwks.py`: single-flight, freshness, unknown-`kid` refresh with cooldown, stale-on-error). The algorithm is pinned to an asymmetric allow-list. | `uv.lock:932`, `pyproject.toml:6-22`, recon R-2 | settled |
| D-3 | 1 | **Effective scope.** In SSO mode `_authorized` stamps `access_scope = roles_to_access_scope(roles) & scopes_to_mask(token.scope)` plus the resolved `user_id` (never `sub`). A new `scopes.effective_access_scope(claims)` is read at both sites, `tools.py:146` and `tools.py:216`. Legacy claims never carry `access_scope`. | `tools.py:137-217`, `scopes.py:39`, recon R-1 | settled |
| D-4 | 1 | **SAN gating.** Export `peerDnsSans` from `adminDirectory.ts`, with no new imports. Each new RPC gets its own allow-list and its own `PERMISSION_DENIED` message: `ResolveExternalIdentity` = ui + agent, `IssueSessionForUser` = ui only. The gate runs before any DB access. `ADMIN_DIRECTORY_PEER_SANS` is untouched. | `adminDirectory.ts:6-40`, `@AC-10 @feature-242` | settled |
| D-5 | 1 | **Resolve atomicity** comes from PK `(issuer,subject)` + `UNIQUE(issuer,user_id)` + `users.email` UNIQUE, plus one retry when the raw `err.code === '23505'`, checked before `mapDbError`. | `identityServiceImpl.ts:116-120`, recon R-10 | settled |
| D-6 | 1 | **SSO-created users get an unusable password**: a bcrypt hash of 32 random bytes. No schema change. | `001:9`, recon R-4 | settled |
| D-7 | 1 | **Non-unique index** `users_email_lower_idx ON identity.users (lower(email))` in identity migration `007`. Existing mixed-case duplicates resolve to `ambiguous email`. | `001:6-14`, recon R-5, AC-5 | settled |
| D-8 | 1 | **UI SSO transaction state** (`state`, `nonce`, `code_verifier`, `remember`, `redirect`) lives in an httpOnly cookie, encrypted as JWE (dir/A256GCM) with a key from HKDF-SHA256(`JWT_SECRET`, info `xstockstrat-ui/sso-txn`). It is not an HS256 JWS. Path `/api/auth/sso/callback`, Max-Age 600. | `ui/src/lib/auth.ts:23-36` | settled |
| D-9 | 1 | **`redirect_uri = ${APP_URL}/api/auth/sso/callback`**, taken from env `APP_URL`. Never from the Host header and never from a new key. | `compose.yml:283`, `.do/app.yaml:607-667`, recon R-8 | settled |
| D-10 | 1 | **Agent metadata.** The protected-resource metadata change lives in `oauth_metadata.py` (fixes spec drift R-13). In SSO mode it returns `authorization_servers:[issuer]` + `scopes_supported`; in legacy mode it is byte-identical. In SSO mode `/oauth/{register,authorize,callback,token}` and `/.well-known/oauth-authorization-server` answer 404. | `oauth_metadata.py:19-26`, `main.py:250-267` | settled |
| D-11 | 1 | **Proto (additive).** `ResolveExternalIdentity(ResolveExternalIdentityRequest{issuer=1,subject=2,email=3})` returns `ResolveExternalIdentityResponse{user_id=1, repeated Role roles=2, is_active=3, ExternalIdentityOutcome outcome=4}`. `IssueSessionForUser(IssueSessionForUserRequest{user_id=1})` returns `AuthTokenResponse`. `enum ExternalIdentityOutcome{…_UNSPECIFIED=0, LINKED_EXISTING=1, LINKED_BY_EMAIL=2, CREATED=3}`. | `identity.proto:49,57-71,170`, `buf.yaml` | settled |
| D-12 | 1 | **Password gate** in `authenticateUser`: `getBool('auth.password_login_enabled', false)`, before the DB query, returning code 7 "password login disabled" + `recordLoginFailure('password_login_disabled')`. The UI `/api/auth/login` maps `PermissionDenied` to 403. Test mocks gain `getBool` (R-7). | `identityServiceImpl.ts:150-160`, `configWatcher.ts:222`, `login/route.ts:29-44` | settled |
| D-14 | 1 | **Owner sign-off (gate 1):** an unknown `kid` when Authelia's JWKS cannot be fetched returns 503 without `WWW-Authenticate`. A token defect while the keys are reachable stays 401. FR-2 is amended accordingly. | context.md 2026-11-16 | settled |
| D-15 | 1 | **Owner sign-off (gate 1):** remember-me and the redirect are bound to the OIDC `state` through the encrypted SSO-transaction cookie keyed by the random state, not encoded into the `state` string. FR-1 is amended accordingly. | context.md 2026-11-16 | settled |
| D-16 | 1 | **Owner decision (gate 1):** the UI OIDC flow uses `openid-client` v6 (panva, the same author as jose). jose stays for the existing session JWT. | context.md 2026-11-16 | settled |
| D-13 | 1 | **Fixed constants** (60 s role TTL, JWKS freshness, cooldown, fetch timeout) stay in code with the "Fixed invariant (F-07)" comment form. They are not config keys. | `client.py:39-47` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | `PyJWKClient` run via `asyncio.to_thread` | It is synchronous urllib, refetches on every unknown `kid` with no cooldown (a refetch-amplification DoS against Authelia), and has no stale-on-error or single-flight. | locked |
| R-2 | 1 | Unique index on `lower(email)` | The migration would fail on existing mixed-case duplicates, which AC-5 says can exist. | locked |
| R-3 | 1 | Identity also validates `iss` (watches `ui`/`agent`) | Adds a new watcher and coupling to a SAN-gated, header-blind RPC whose callers already verified the token (YAGNI, C-18). | locked |
| R-4 | 1 | Agent allow-list of `client_id`/`azp` (a new config key) | Authelia's per-client `audience` already enforces this. Reconsider only if the spike shows any client can request the audience. | locked |
| R-5 | 1 | `ResolveExternalIdentity` also mints tokens for the UI (one RPC) | Mixes the authorization outcome with minting, and contradicts the owner-approved spec (`IssueSessionForUser`). | locked |
| R-6 | 1 | Stamp narrowed `roles` instead of an effective scope | OAuth-scope masks such as 0x03 correspond to no role set (`scopes.py:39`). | locked |
| R-8 | 1 | Hand-rolled OIDC code+PKCE flow on jose alone | The owner chose a vetted library at gate 1 (O-13 checklist risk). | locked |
| R-9 | 1 | Encode remember/redirect inside the `state` string | The owner chose cookie binding at gate 1 (D-15). | locked |
| R-7 | 1 | HS256-signed (JWS) SSO transaction cookie | `verifyAccessToken` accepts any HS256 `JWT_SECRET` JWS, so the cookie would also be a valid session token (type confusion). | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | **Re-auth loop.** In SSO mode, every resolve error except FAILED_PRECONDITION currently falls to 401 + `WWW-Authenticate` (PERMISSION_DENIED, INTERNAL, ALREADY_EXISTS, INVALID_ARGUMENT, local mTLS RuntimeError), so Claude loops through consent. After the token is verified: FAILED_PRECONDITION → 403; anything else → 503 with no `WWW-Authenticate`. AC-19 @feature-294 binds the legacy branch only. (P-03, `@AC-11 @feature-273`) | yes | open |
| O-2 | 1 | **Latency budget.** A cold path of discovery 5 s + JWKS 5 s + resolve 10 s blows the `@AC-11 @feature-273` 10.5 s bound. Use one overall `asyncio.timeout(_RPC_TIMEOUT_S)` across the JWKS fetch and resolve, pass the remaining budget to the resolve `timeout=`, cache discovery separately from keys, and pin 10.5 s with a test. | yes | open |
| O-3 | 1 | **Unknown-`kid` and cooldown semantics.** Unknown `kid` while the last fetch succeeded → 401. 503 only when no successful fetch exists or the last refresh failed. Missing `kid` → 401. Reject `use=enc` keys. The 503-on-JWKS-outage reading deviates from FR-2's literal "any failure → 401" and needs owner sign-off (P-03). | yes | open |
| O-4 | 1 | **C-16 regression.** Lowercasing on a case-only difference breaks flag-on password login for admin-created mixed-case rows (`@AC-2/3/6 @feature-043`; rollback path D6). Sync only when `lower(stored) <> token_email`, consistent with FR-3's case-insensitive rule. | yes | open |
| O-5 | 1 | **Rollout lockout.** A plain-INSERT seed is invisible to a running config process (in-memory snapshot, `configServiceImpl.ts:224-225,442,454`). Identity restarting first reads the flag as missing, `false`, and every password login is refused, including DigitalOcean legacy mode. Migration 050 up and down must `pg_notify('config_changed', …)` for identity/ui/agent × both environments (`041:539`, `046:58`, `047:58`). Rollout order plus a migration assertion. (ledger: maintenance_mode) | yes | open |
| O-6 | 1 | **Unbounded audit on the login path.** `auditSafe` awaits `audit.append`, and AppendEvent has no deadline (`@AC-24 @feature-294`). Reply first, fire the audit without awaiting. Release the transaction client before the audit, the email sync and the retry (identity direct pool = 2). State the release points explicitly. | yes | open |
| O-7 | 1 | **Token confusion.** Require the agent `aud` to be exactly `X` or `[X]` (no multi-audience). Require UI `azp == clientId` when `aud` is an array. Require `typ` `at+jwt` if the spike confirms Authelia sets it. | no | open |
| O-8 | 1 | **Global-scope reads.** Mode and issuer reads must be pinned to global scope: tests show no `x-user-id` header, an empty `user_id`, and an agent WatchConfig with no `user_id`. Per-user self-service writes would otherwise enable an IdP takeover. Require `https` issuer and a same-origin `jwks_uri`, with loopback http allowed only for the stub. (ledger: fix-config-ui-env) | no | open |
| O-9 | 1 | **`leeway=0` also applies to `iat`/`nbf`** (verify PyJWT 2.15.0). Keep `exp` strict and tolerate small `iat`/`nbf` skew. (ledger: agent-mcp-server) | no | open |
| O-10 | 1 | **SSO routes mid-flow.** If the config read throws mid-flow, redirect `?error=failed`; return 404 only for legacy or half-configured. `/start` checks `client_secret` presence before redirecting. | no | open |
| O-11 | 1 | **Second click or tab overwrites `sso_txn`.** Key the cookie by a state hash, or use a sealed map. | no | open |
| O-12 | 1 | **Refusal details are a string contract** across identity, UI and agent. Use one exported constant set in identity, a mirrored UI constant, and contract tests (C-04 spirit). | no | open |
| O-13 | 1 |  Hand-rolled OIDC client in the UI. List every check: `iss`, `aud`/`azp`, `exp`, `nonce`, alg allow-list, `response_mode=query`, RFC 6749 §2.3.1 form-encoding for `client_secret_basic`. Or use `openid-client` v6. (C-18) | no | closed @ round 1 (owner: openid-client v6, D-16) |
| O-14 | 1 | **Record why the JWKS cache is hand-rolled** (the R-1 rationale). Drop or justify the 10 000-entry role-cache cap (YAGNI for family users). (C-18) | no | open |
| O-15 | 1 | **Cache stampede.** Parallel MCP requests on a cold cache, plus uncached refusals, put load on identity's 2-connection pool. Single-flight the resolve per `(iss, sub)` in the agent. (F-06 contention) | no | open |
| O-16 | 1 | **Test strategy.** AC-25 (the race) needs a real-Postgres concurrency test or an explicit waiver. A namespace-aware e2e `getConfig` mock must diff the existing consumers first. (ledger: align-frontend-e2e-bff-mocks) | no | open |
| O-17 | 1 | **The `authenticateUser` → `sessionResponse` refactor touches legacy.** Claims use the request email today. Pass the caller's email and pin a claims-equality test, or leave `authenticateUser` untouched. (FR-14) | no | open |
| O-18 | 1 | **Owner confirmations.** Assumption 10 (remember/redirect bound through the cookie keyed by `state`, rather than carried inside `state`) needs owner acknowledgement. Scope `loadOidcConfig` to the authorized-apps page, not `accounts/layout.tsx`. Verify the ui/agent leaf SANs before the gate is specced (R-17). (P-03; ledger: wire-fe-auth) | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
