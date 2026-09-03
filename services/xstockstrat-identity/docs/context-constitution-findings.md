# xstockstrat-identity — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Config key `identity.jwt.secret` listed as consumed ("resolved from secret store") | Secret comes from `process.env.JWT_SECRET` only; code comments that secrets are NOT in config | `CLAUDE.md:76` vs `identityServiceImpl.ts:29-31` | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md:80 now states the JWT signing key is read from `JWT_SECRET` env, not a config key (IDENTITY-1) |
| CLAUDE.md Dependencies table lists only config + PostgreSQL — no ledger | identity now has a **REAL** outbound gRPC dependency on `xstockstrat-ledger` for admin-mutation audit (feature 043) with a `LEDGER_ENDPOINT` env var. (This is the same dep whose *fictional* prior form was "resolved" by deletion; it is now genuine and must be re-added.) | `src/grpc/ledgerAudit.ts:36-39`, wired `src/index.ts`, `LEDGER_ENDPOINT` | Add the ledger audit dep + `LEDGER_ENDPOINT` back to CLAUDE.md Dependencies + Env Vars (root §Header Propagation also corrected — see root findings) |
| CLAUDE.md Ports section: server "exposes all **eleven** methods" and lists 11 | The server now also serves 8 more (`GetUserMetadata`, `UpdateUserMetadata`, `CreateUser`, `ListUsers`, `GetUser`, `UpdatePassword`, `SetUserRoles`, `SetUserActive`) — 19 total | `identityServiceImpl.ts:555,594,675,703,716,733,764,807` | Update the method list/count (or drop the count) |
| CLAUDE.md Database/Migrations stops at `005_drop_api_keys` | `006_user_metadata.up.sql` (adds `phone`/`display_name`/`metadata` JSONB/`metadata_updated_at`) is undocumented | `migrations/006_user_metadata.up.sql` | Add the 006 migration row |
| `package.json` description "Auth, JWT, and **API key** management"; comment `revokeAuthorizedApp` "mirrors revokeApiKey" | API-key feature fully removed (migration `005_drop_api_keys`, all `*ApiKey` RPCs gone) | `package.json:4`, `identityServiceImpl.ts:527` | Update description + stale comment |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — `revokeToken` decodes the token **without verifying the signature** and revokes all refresh tokens for the decoded `user_id`, returning `success:true` for empty/garbage tokens. This allows revoking any known user's sessions from an unsigned/forged token (a logout-DoS). Is accepting an unverified `user_id` to revoke sessions an accepted trade-off, or should it verify (allowing expired-but-signed only)? `identityServiceImpl.ts:232-238` — status: **open** (note: the new `updatePassword`/`setUserActive` sidestep it by revoking on the target `user_id`)
- `jwt.verify(token, secret)` pins no `algorithms` list — intentional reliance on jsonwebtoken's HMAC-only default for string secrets, or should `algorithms:['HS256']` be pinned? `identityServiceImpl.ts:148` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
