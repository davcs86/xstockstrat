# xstockstrat-identity — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped; all findings re-checked still open). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Config key `identity.jwt.secret` listed as consumed ("resolved from secret store") | Secret comes from `process.env.JWT_SECRET` only; code comments that secrets are NOT in config | `CLAUDE.md` § Config Keys Consumed vs `identityServiceImpl.ts#jwtSecret` (~L112-119) | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md § Config Keys Consumed (~L77) now states the JWT signing key is read from `JWT_SECRET` env, not a config key (IDENTITY-1) |
| CLAUDE.md Dependencies table lists only config + PostgreSQL — no ledger | identity now has a **REAL** outbound gRPC dependency on `xstockstrat-ledger` for admin-mutation audit (feature 043) with a `LEDGER_ENDPOINT` env var. (This is the same dep whose *fictional* prior form was "resolved" by deletion; it is now genuine and must be re-added.) | `src/grpc/ledgerAudit.ts#createLedgerAudit` (~L32-35), wired `src/index.ts#createLedgerAudit` (~L45), `LEDGER_ENDPOINT` | Add the ledger audit dep + `LEDGER_ENDPOINT` back to CLAUDE.md Dependencies + Env Vars (root §Header Propagation also corrected — see root findings) |
| CLAUDE.md Ports section: server "exposes all **eleven** methods" and lists 11 | The server now also serves 10 more (`GetUserMetadata`, `UpdateUserMetadata`, `AdminGetUserMetadata`, `AdminUpdateUserMetadata`, `CreateUser`, `ListUsers`, `GetUser`, `UpdatePassword`, `SetUserRoles`, `SetUserActive`) — 21 total (re-counted 2026-10-14) | `src/grpc/identityServiceImpl.ts#adminGetUserMetadata`, `#adminUpdateUserMetadata`, `#createUser`, `#setUserActive` | Update the method list/count (or drop the count) |
| CLAUDE.md Database/Migrations stops at `005_drop_api_keys` | `006_user_metadata.up.sql` (adds `phone`/`display_name`/`metadata` JSONB/`metadata_updated_at`) is undocumented | `migrations/006_user_metadata.up.sql` | Add the 006 migration row |
| `package.json` description "Auth, JWT, and **API key** management" | API-key feature fully removed (migration `005_drop_api_keys`, all `*ApiKey` RPCs gone). The stale "mirrors revokeApiKey" comment is gone (2026-10-14: grep zero hits); only the description remains | `services/xstockstrat-identity/package.json` `description` | Update the description |
| `src/grpc/authz.ts` header comment: request-body `user_id` is ignored except by `ListAuthorizedApps`/`RevokeAuthorizedApp` | The admin RPCs (`adminGetUserMetadata`, `adminUpdateUserMetadata`, `getUser`, `updatePassword`, `setUserRoles`, `setUserActive`) read the body `user_id` by design (IDENTITY-10) | `src/grpc/authz.ts` header vs `src/grpc/identityServiceImpl.ts#adminGetUserMetadata` | Amend the comment |
| `CLAUDE.md` Constitution banner lists "fictional ledger audit"; Environment Variables lists `TRADING_MODE` and omits `LEDGER_ENDPOINT` / `DB_POOL_MAX` | The ledger audit is real (`ledgerAudit.ts`); `TRADING_MODE` is part of the repo-wide docs-vs-code disagreement logged in the root findings | `src/grpc/ledgerAudit.ts`; root findings log | Fix the banner and env block |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ⚠ **security, unverified** — `refreshOAuthToken` revokes the presented token and inserts the new one in separate non-transactional pool queries; the SELECT has no `FOR UPDATE` and the revoke does not check `revoked_at IS NULL`. | A crash between revoke and insert leaves the user with no refresh token; two concurrent refreshes of one token can both succeed (rotation double-spend). Not yet reproduced. | `src/grpc/identityServiceImpl.ts#refreshOAuthToken` |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — `revokeToken` decodes the token **without verifying the signature** and revokes all refresh tokens for the decoded `user_id`, returning `success:true` for empty/garbage tokens. This allows revoking any known user's sessions from an unsigned/forged token (a logout-DoS). Is accepting an unverified `user_id` to revoke sessions an accepted trade-off, or should it verify (allowing expired-but-signed only)? `identityServiceImpl.ts#revokeToken` (~L295-312) — status: **open** (note: the new `updatePassword`/`setUserActive` sidestep it by revoking on the target `user_id`)
- `adminGate` returns `code:13` "missing metadata" when `call.metadata` is absent (also `getUserMetadata`/`updateUserMetadata`) — intended, or should it be UNAUTHENTICATED/INVALID_ARGUMENT? `src/grpc/identityServiceImpl.ts#adminGate` — status: **open**
- Should `adminUpdateUserMetadata` get `setUserActive`'s last-admin / token-revoke semantics? It has neither — status: **open**
- `refreshOAuthToken` bumps `last_used_at` then immediately revokes the row, and `issueRefreshToken` does not copy it to the new token — intended? — status: **open**
- `jwt.verify(token, secret)` pins no `algorithms` list — intentional reliance on jsonwebtoken's HMAC-only default for string secrets, or should `algorithms:['HS256']` be pinned? `identityServiceImpl.ts#validateToken` (`jwt.verify` ~L213) — status: **open**

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


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-identity-claude-md-drift-defect`](../../../docs/reports/2026-10-19-identity-claude-md-drift-defect.md) | Identity CLAUDE.md and package metadata misdescribe the RPC surface, deps and migrations |
| [`2026-10-19-identity-refresh-rotation-not-atomic-defect`](../../../docs/reports/2026-10-19-identity-refresh-rotation-not-atomic-defect.md) | Refresh-token rotation is not atomic (double-spend and lost-token window) |
| [`2026-10-19-identity-revoketoken-unverified-decode-defect`](../../../docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md) | RevokeToken trusts an unverified JWT and revokes all of the decoded user's sessions |
| [`2026-10-20-node-impl-test-suites-never-load-impl-defect`](../../../docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md) | identity and ledger unit suites never load the service implementation (impl tests pass vacuously; found 2026-10-20) |
| [`2026-10-28-node-leaf-c8-check-coverage-unenforced-defect`](../../../docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md) | Node-leaf c8 `--lines 40` is declared but never enforced (no `--check-coverage`) |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
