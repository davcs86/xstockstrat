# xstockstrat-identity — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift, fictional ledger dep)
live in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Config key `identity.jwt.secret` listed as consumed ("resolved from secret store") | Secret comes from `process.env.JWT_SECRET` only; code comments that secrets are NOT in config | `CLAUDE.md:76` vs `identityServiceImpl.ts:29-31` | Remove the config key from docs (IDENTITY-1) |
| CLAUDE.md dependency "xstockstrat-ledger — Auth event audit trail" + `LEDGER_ENDPOINT` | No ledger client; auth events are only `log.info` lines | `CLAUDE.md:45,89` vs `src/` (grep zero) | Implement the audit trail or delete the dep |
| `package.json` description "Auth, JWT, and **API key** management"; comment `revokeAuthorizedApp` "mirrors revokeApiKey" | API-key feature fully removed (migration `005_drop_api_keys`, all `*ApiKey` RPCs gone) | `package.json:4`, `identityServiceImpl.ts:498` | Update description + stale comment |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — `revokeToken` decodes the token **without verifying the signature** and revokes all refresh tokens for the decoded `user_id`, returning `success:true` for empty/garbage tokens. This allows revoking any known user's sessions from an unsigned/forged token (a logout-DoS). Is accepting an unverified `user_id` to revoke sessions an accepted trade-off, or should it verify (allowing expired-but-signed only)? `identityServiceImpl.ts:203-209` — status: **open**
- `jwt.verify(token, secret)` pins no `algorithms` list — intentional reliance on jsonwebtoken's HMAC-only default for string secrets, or should `algorithms:['HS256']` be pinned? `identityServiceImpl.ts:119` — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
