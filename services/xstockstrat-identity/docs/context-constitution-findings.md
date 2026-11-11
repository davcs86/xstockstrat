# xstockstrat-identity — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped; all findings re-checked still open); refreshed 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `9892b61` — refresh-rotation row resolved (hotfix #1262), +2 latent bugs (no `is_active` check on the auth-code path, empty `aud` on refresh), `eleven methods` row narrowed, impl-test report's identity half closed); refreshed 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `0a3d508` — +1 doc-lie (JWT secret attributed to config), 1 row resolved); refreshed 2026-11-10 (branch `main-dev` @ `3b0fa6ab` — 5 doc-lie rows resolved (CLAUDE.md Dependencies/Migrations, `package.json`, `authz.ts` header), banner/env row narrowed to the env block; line hints re-stamped). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Config key `identity.jwt.secret` listed as consumed ("resolved from secret store") | Secret comes from `process.env.JWT_SECRET` only; code comments that secrets are NOT in config | `CLAUDE.md` § Config Keys Consumed vs `identityServiceImpl.ts#jwtSecret` (~L112-119) | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md § Config Keys Consumed (~L77) now states the JWT signing key is read from `JWT_SECRET` env, not a config key (IDENTITY-1) |
| `CLAUDE.md` Environment Variables lists `TRADING_MODE` and omits `LEDGER_ENDPOINT` / `DB_POOL_MAX` (narrowed 2026-11-10: the banner no longer says "fictional ledger audit") | `LEDGER_ENDPOINT` is read for the ledger audit (`ledgerAudit.ts`) and `DB_POOL_MAX` by the pool; `TRADING_MODE` is part of the repo-wide docs-vs-code disagreement logged in the root findings | `services/xstockstrat-identity/CLAUDE.md` env block (`TRADING_MODE=paper` ~L106); `src/grpc/ledgerAudit.ts`; `src/index.ts#DB_POOL_MAX` (~L31); root findings log | Fix the env block |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **RESOLVED (hotfix #1262, feature 265; verified 2026-11-04) — `rotateRefreshToken` is now transactional and single-use** (`pool.connect` → `BEGIN` → a conditional claim `UPDATE … WHERE rt.revoked_at IS NULL AND expires_at > NOW() AND u.is_active = true` → the successor insert via `issueRefreshToken(…, client)` in the same transaction → `COMMIT`/`ROLLBACK`; report sidecar `resolved`; IDENTITY-13). Original finding: ⚠ **security, unverified** — `refreshOAuthToken` revokes the presented token and inserts the new one in separate non-transactional pool queries; the SELECT has no `FOR UPDATE` and the revoke does not check `revoked_at IS NULL`. | A crash between revoke and insert leaves the user with no refresh token; two concurrent refreshes of one token can both succeed (rotation double-spend). Not yet reproduced. | `src/grpc/identityServiceImpl.ts#refreshOAuthToken` |
| **A user deactivated inside the 60 s auth-code window can still redeem the code** (found 2026-11-04): `is_active` is enforced in `authenticateUser` and `rotateRefreshToken` only; `exchangeAuthCode` joins `identity.users` without it, and `redeemAuthCode` / `issueAuthCode` never check it. (`validateToken` ignores `is_active` too, which is expected for stateless JWTs.) | A just-deactivated account receives an access token and a refresh token. Action: add `u.is_active = true` to the claim, or accept the 60 s window and document it. | `src/grpc/identityServiceImpl.ts#exchangeAuthCode`, `#redeemAuthCode`; contrast `#authenticateUser` (`is_active` ~L158) and `#rotateRefreshToken` (~L364) |
| **`refreshOAuthToken` mints `aud: ""` when `resource` is absent** (found 2026-11-04): `exchangeAuthCode` falls back to the code's stored `row.resource`; the refresh has no stored resource to fall back to. | A client that omits `resource` on refresh gets a token the agent edge (`aud == AGENT_PUBLIC_URL`) rejects, forcing a pointless re-auth. Action: fail loudly, or inherit the originally granted resource. | `#refreshOAuthToken` (~L587) vs `#exchangeAuthCode` (~L551); `services/xstockstrat-agent/app/oauth_server.py` (`refresh_token` grant ~L280) |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — `revokeToken` decodes the token **without verifying the signature** and revokes all refresh tokens for the decoded `user_id`, returning `success:true` for empty/garbage tokens. This allows revoking any known user's sessions from an unsigned/forged token (a logout-DoS). Is accepting an unverified `user_id` to revoke sessions an accepted trade-off, or should it verify (allowing expired-but-signed only)? `identityServiceImpl.ts#revokeToken` (~L279-296) — status: **open** (note: the new `updatePassword`/`setUserActive` sidestep it by revoking on the target `user_id`)
- `adminGate` returns `code:13` "missing metadata" when `call.metadata` is absent (also `getUserMetadata`/`updateUserMetadata`) — intended, or should it be UNAUTHENTICATED/INVALID_ARGUMENT? `src/grpc/identityServiceImpl.ts#adminGate` — status: **open**
- Should `adminUpdateUserMetadata` get `setUserActive`'s last-admin / token-revoke semantics? It has neither — status: **open**
- `refreshOAuthToken` bumps `last_used_at` then immediately revokes the row, and `issueRefreshToken` does not copy it to the new token — intended? — status: **open**
- `jwt.verify(token, secret)` pins no `algorithms` list — intentional reliance on jsonwebtoken's HMAC-only default for string secrets, or should `algorithms:['HS256']` be pinned? `identityServiceImpl.ts#validateToken` (`(jwt as any).verify(` ~L218) — status: **open**

## Resolved (2026-09-16 security audit)

- **Default seed admin (`admin@localhost` / `admin`) authenticated in production.** Migration
  `002_seed_admin` seeds a known bcrypt hash of `"admin"` into **every** environment (the db-migrator
  runs it in prod), and the "rotate in production" comment relied on manual action. Migration 002 is
  applied and immutable, so the fix is a code guard: `authenticateUser` now refuses any account still
  carrying the committed seed hash when `APPLICATION_ENV === 'production'` (`isBlockedDefaultAdmin`),
  forcing an operator to rotate it via `scripts/manage-users.py reset-password` before the default
  admin can log in. Dev/staging keep the convenience login. Covered by
  `src/__tests__/identityServiceImpl.test.ts` ("default seed-admin lockout"). `identityServiceImpl.ts`
  (`SEED_ADMIN_PASSWORD_HASH` / `isBlockedDefaultAdmin` + the `authenticateUser` guard).
- **RESOLVED 2026-11-04 — `CLAUDE.md` Ports "exposes all **eleven** methods" and lists 11.** The claim is gone: `CLAUDE.md` now says the server exposes "every `IdentityService` method, including …" (`grep -c eleven` = 0 in the file now and at both prior commits).
- **RESOLVED 2026-11-10 — `CLAUDE.md` Dependencies table had no ledger row.** It now lists `xstockstrat-ledger` (`gRPC AppendEvent` via `LEDGER_ENDPOINT`, best-effort admin-mutation audit, `src/grpc/ledgerAudit.ts`).
- **RESOLVED 2026-11-10 — `CLAUDE.md` Database/Migrations stopped at `005_drop_api_keys`.** `CLAUDE.md` now lists `006_user_metadata` (`phone`, `display_name`, `metadata` JSONB).
- **RESOLVED 2026-11-10 — `package.json` description advertised "API key" management.** `services/xstockstrat-identity/package.json` `description` is now "Auth, JWT, OAuth, and user management".
- **RESOLVED 2026-11-10 — `src/grpc/authz.ts` header said body `user_id` is read only by `ListAuthorizedApps`/`RevokeAuthorizedApp`.** The header (~L2-4) now adds "and the admin-gated RPCs, where it names the target user (IDENTITY-10)".
- **RESOLVED 2026-11-10 — ⚠ `CLAUDE.md` Dependencies said config supplies "JWT secrets".** The row now reads "Live config (token TTLs; the JWT secret is env-only, IDENTITY-1)".


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| `2026-10-19-identity-claude-md-drift-defect` (pruned 2026-11-10; `git show adf411c3:docs/reports/2026-10-19-identity-claude-md-drift-defect.md`) | Identity CLAUDE.md and package metadata misdescribe the RPC surface, deps and migrations |
| `2026-10-19-identity-refresh-rotation-not-atomic-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-19-identity-refresh-rotation-not-atomic-defect.md) | Refresh-token rotation is not atomic (double-spend and lost-token window) — **resolved (hotfix #1262; verified 2026-11-04)** |
| `2026-10-21-identity-auth-code-race-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-21-identity-auth-code-race-defect.md) | ExchangeAuthCode race — fixed in code by `redeemAuthCode` (feature 265); report `triaged` (added to this table 2026-11-04) |
| [`2026-10-19-identity-revoketoken-unverified-decode-defect`](../../../docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md) | RevokeToken trusts an unverified JWT and revokes all of the decoded user's sessions |
| `2026-10-20-node-impl-test-suites-never-load-impl-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md) | identity and ledger unit suites never load the service implementation (impl tests pass vacuously; found 2026-10-20) — **identity half no longer reproduces (verified 2026-11-04: `identityServiceImpl.test.ts` imports the impl in a `before()` and asserts it; triaged, feature 252)** |
| [`2026-10-28-node-leaf-c8-check-coverage-unenforced-defect`](../../../docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md) | Node-leaf c8 `--lines 40` is declared but never enforced (no `--check-coverage`) |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
