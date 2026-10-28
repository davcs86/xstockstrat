# Recon: fix-identity-auth-code-race

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-identity

---

## Objective

`ExchangeAuthCode` reads the auth code, checks it, and then runs an unconditional UPDATE. The successor refresh-token INSERT runs separately, outside any transaction. As a result, concurrent redemptions of one authorization code each mint an access + refresh pair (D-23, auth-code half). The fix makes redemption a conditional claim, decided by its row count, in one transaction with the refresh INSERT. It follows the `rotateRefreshToken` pattern from hotfix `5bd271d` and keeps validate-before-consume (FR-5). In the same change, first-party `authenticateUser`/`refreshToken` move onto the shared mint and refresh-issue helpers, with claim shapes unchanged (D-21 residual, FR-6..FR-8).

## Codebase Map

- **`xstockstrat-identity`** (Node.js / TypeScript, gRPC 50058)
  - Entry point: `services/xstockstrat-identity/src/index.ts:46`, `new IdentityServiceImpl(pool, configWatcher, ledgerAudit)`. Registered via `grpcServer.addService` at `:50`.
  - Handler/servicer: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`
    - `exchangeAuthCode` `:474-518`:
      - unlocked SELECT joined to `identity.users` `:481-488`
      - JS `consumed_at` check `:491` and JS expiry check `:492-494`
      - redirect_uri/client_id check `:495-497`
      - PKCE `digest('base64url')` compare `:499-502`
      - unconditional `UPDATE identity.oauth_auth_codes SET consumed_at = NOW() WHERE code = $1` `:503-506`
      - audience `resource || row.resource || ''` `:507`
      - `mintOAuthAccessToken` `:508-510`
      - `issueRefreshToken(row.user_id, clientId)` on the pool, outside any txn, `:511`
      - catch → `{ code: 13 }` `:514-517`
      - invalid grants → `{ code: 16, message: 'invalid_grant' }`
    - `authenticateUser`, D-21 site:
      - inline `now`/`expiresAt` `:163-164`, claims `:166-172`, `jwt.sign` `:174-176`
      - inline refresh `uuidv4` + hex hash + INSERT without `client_id` `:178-185`
      - response uses `expiresAt: secondsToDate(expiresAt)` and `claims` built from local `now`/`expiresAt` `:188-199`
    - `refreshToken`, D-21 site:
      - already calls `rotateRefreshToken(tokenHash, false)` `:236`
      - inline claims `:243-245`, `jwt.sign` `:247-249`
      - response `claims` `:252-262`
    - `refreshOAuthToken` `:524-543`: already uses `rotateRefreshToken(tokenHash, true)` `:530` and `mintOAuthAccessToken(…, resource || '')` `:534-536`.
    - `issueAuthCode` INSERT `:456-461`, with the hard-coded `NOW() + interval '60 seconds'` at `:459`.
  - Last migration: `006_user_metadata.up.sql` (`services/xstockstrat-identity/migrations/`). Auth-code table `identity.oauth_auth_codes` is at `migrations/003_oauth.up.sql:14-24`:
    - `code TEXT PRIMARY KEY` (SHA-256 hex)
    - `expires_at TIMESTAMPTZ NOT NULL`
    - `consumed_at TIMESTAMPTZ`
  - Config-read pattern:
    - `accessTtlSeconds` getter, `this.config.getInt('identity.jwt.access_ttl_seconds', 900)`, `identityServiceImpl.ts:121-123`
    - `refreshTtlSeconds` getter, `'identity.jwt.refresh_ttl_seconds', 2592000`, `:125-127`
    - Documented in `services/xstockstrat-identity/CLAUDE.md:74-75`
  - Other key symbols:
    - `mintOAuthAccessToken(userId, email, roles, audience)` — `identityServiceImpl.ts:295-315`. It always sets `aud`, signs with `expiresIn: this.accessTtlSeconds`, and returns only `{ accessToken, expiresIn }`.
    - `issueRefreshToken(userId, clientId?, db: Pool | PoolClient = this.pool)` — `:321-334`. It already accepts a txn client and inserts `client_id` as `clientId ?? null` (`:329-331`).
    - `rotateRefreshToken(tokenHash, touchLastUsed)` — `:340-374`.

## Patterns to REUSE

- **Conditional claim + same-txn successor insert** (FR-1/FR-2) → reuse `rotateRefreshToken` at `identityServiceImpl.ts:340-374`:
  1. `const client = await this.pool.connect()` `:344`, then `BEGIN` `:346`.
  2. `UPDATE … WHERE … IS NULL AND expires_at > NOW() … RETURNING` `:347-358`.
  3. Zero rows → `ROLLBACK` and return null `:359-362`.
  4. `issueRefreshToken(…, client)` then `COMMIT` `:365-366`.
  5. `catch` → `ROLLBACK().catch(() => undefined)` and rethrow `:368-370`.
  6. `finally` → `client.release()` `:371-373`.

  The auth-code claim keys on the `code` PK (`003_oauth.up.sql:15`), with `consumed_at IS NULL AND expires_at > NOW()`.
- **Refresh-token issue on a txn client** (FR-2, FR-7) → reuse `issueRefreshToken(userId, clientId?, db)` at `:321-334`, unchanged. First-party `authenticateUser` calls it with no `clientId`, which yields `client_id` NULL. That replaces the inline block at `:178-185`.
- **Access-token mint** (FR-6, FR-8) → generalise `mintOAuthAccessToken` at `:295-315` into one shared helper:
  - `aud` becomes optional. When omitted, no `aud` claim is written. OAuth callers still pass `''` when there is no resource, which keeps today's `aud: ''`.
  - The helper also exposes `now`/`expiresAt`, which the first-party responses need for `expiresAt`/`claims` (`:188-199`, `:252-262`).
  - `authenticateUser` (`:163-176`) and `refreshToken` (`:243-249`) then call it, so no inline `jwt.sign` remains in them.
- **Error house style** → raw numeric gRPC codes (`16` invalid_grant, `13` internal) per IDENTITY-3 (`services/xstockstrat-identity/docs/context-constitution.md:20`).
- **Hash encodings** → auth codes and refresh tokens are SHA-256 **hex**, and PKCE is compared as `sha256(verifier).base64url` (IDENTITY-2, `context-constitution.md:19`). Don't mix them while moving code.
- **`aud` binding** → OAuth tokens stay `aud`-bound to the resource (IDENTITY-4, `context-constitution.md:21`).
- **Unit-test analog for AC-1/AC-3** → `makeTokenDb(row, {failInsert})` at `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts:405-442`:
  - It is an in-memory transactional fake. Its `lockedBy` row-lock model applies the claim on COMMIT only, counts `inserts`, and has a `failInsert` switch.
  - The concurrency test is at `:457-466` and the fault-injection test (`err 13`, not revoked) at `:468-476`.
  - An auth-code variant of this fake, scaled to 20 callers, mirrors AC-1/AC-3. Its matcher would key on `SET consumed_at` + `consumed_at IS NULL`.
- **Test helpers** → `makeCall` `:62`, `makeSpyPool` `:260-272`, `implWithPool` `:274-278`, `challengeFor` `:280-282`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2` "Admin creates a new user who can then sign in" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`). First-party `authenticateUser` must still succeed after the D-21 mint and refresh-issue helper consolidation, with unchanged token shape.
- **PRESERVE** `@AC-3` "Admin resets a user's password without the current password" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`). Login with the new password works and the old password is rejected; the `authenticateUser` path is being refactored.
- **PRESERVE** `@AC-4` "Admin assigns and removes roles" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`). Roles feed the token `roles` claim, so the shared mint helper must keep them.
- **PRESERVE** `@AC-5` "Admin deactivates a user, blocking login" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`). The inactive-user rejection in `authenticateUser` must not regress when the inline `jwt.sign` and refresh INSERT are removed.
- **PRESERVE** `@AC-6` "Admin reactivates a previously deactivated user" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`). Login works again after reactivation.
- No suite has acceptance rules for the OAuth auth code, `ExchangeAuthCode`, `RefreshOAuthToken` or `refresh_tokens`. Feature 265's `@AC-1`..`@AC-6` are net-new guarantees to promote at launch (C-16), not an EXTEND or CHANGE of an existing rule.
- The 043 scenarios assert login outcomes only, not claim shape or refresh-row storage. Feature 265's `@AC-4` is therefore the only guard on claim shape. If the design alters any first-party claim, TTL rule or `aud` handling, the rules above become **CHANGE** and need sign-off in `context.md`.
- Out of scope / not impacted:
  - `user-management-ui.feature` `@AC-1/7/8/10/11 @feature-043`: admin gating, audit, password secrecy and the last-admin guard.
  - `mcp-user-profile-roles.feature` `@AC-10 @feature-183`.
  - `docs/sdd/business-rules/platform.feature`, including `@AC-5 @feature-210` header-propagation-under-mTLS. That scenario is untouched because the code under change makes no outbound call.

## Dependencies

- Proto/RPC: none. The `ExchangeAuthCode`, `AuthenticateUser`, `RefreshToken` and `RefreshOAuthToken` request and response shapes are unchanged.
- Migration: none. `consumed_at`/`expires_at` already exist (`003_oauth.up.sql:21-22`). The next free number would be `007` if one were ever needed.
- Config keys: none new. The existing `identity.jwt.access_ttl_seconds` / `identity.jwt.refresh_ttl_seconds` are reused (`identityServiceImpl.ts:121-127`). The hard-coded 60 s auth-code TTL (`:459`) is out of scope (config-governance audit F-7).
- Inter-service edges: none. `exchangeAuthCode`, `authenticateUser` and `refreshToken` make no outbound gRPC calls. The operator's x-trace-id / C-03 standing decision is therefore satisfied vacuously: there is no emit or write to another service on these paths. If design adds any audit emit, it must forward the inbound metadata (identity's `ledgerAudit.ts` `PROPAGATED_HEADERS`), never fresh metadata.
- New env vars / ports: none.

## Risks / Not-found

- **No real-Postgres harness exists in identity.**
  - Searching `src/__tests__/` finds no `DATABASE_URL`, `new Pool` or testcontainers. The only DB dep is `"pg": "^8.11.5"` (`package.json:31`).
  - Hotfix `5bd271d` checked in only the in-memory `makeTokenDb` fake (its diff touches `identityServiceImpl.test.ts` and `identityServiceImpl.ts` only). Its "real Postgres run" (19/20 and 20/20 double-mints, then 0/20) was a manual repro recorded in the commit message, not a committed harness.
  - The product spec's "FR-1..FR-3 proven only against real Postgres" therefore names a harness that does not exist. Design must choose one of three options:
    - (a) mirror the hotfix: fake-based unit tests plus a recorded manual real-PG repro;
    - (b) build a minimal opt-in real-PG test;
    - (c) amend the spec.
  - `scripts/integration-test.sh` is stale (`:4-11`: it still targets the removed 80xx ports), so it is not a usable vehicle.
  - fails.md:2255 (2026-09-15, feature 190) warns against half-building a per-feature testcontainers rig (C-18); a shared real-DB fixture is a platform follow-up.
- **Vacuous-green unit suite** (fails.md:2223, 2026-09-06):
  - The `before()` try/catch at `identityServiceImpl.test.ts:28-40` swallows import failure, and every test then does `if (!impl) return;`.
  - Under `.nvmrc` Node `22` strip-only mode the suite passes with zero assertions. CI pins Node `"24"` (`.github/workflows/ci.yml:185`).
  - The RED-before-GREEN capture (P-06) must confirm the import loaded, i.e. run on Node 24 or compile-first.
  - Overlap: feature 252 (`docs/roadmap/features/252-fix-identity-ledger-test-suites/implementation-spec.md:95`) fixes this. Whichever feature lands second merges the other's changes to `identityServiceImpl.test.ts`.
- **Existing tests that break by design:**
  - `exchangeAuthCode` tests `:310-403` feed rows through `makeSpyPool`, which returns the same rows for every query (`:260-272`). It cannot model a conditional claim's row count.
  - The "consumed" (`:371-380`) and "expired" (`:382-391`) tests set `consumed_at`/`expires_at` on the SELECTed row. Once the decision moves into the claim, they need a stateful fake (or the claim's predicates must still be mirrored in JS after the validation read).
  - The happy-path regex `INSERT INTO identity\.refresh_tokens[^)]*client_id` (`:354`) must still match. Because `issueRefreshToken`'s INSERT names `client_id` (`:329`), first-party login will now also match. Assertions that distinguish first-party from OAuth must check the `client_id` *param* (NULL vs id), not the SQL text.
- **Design forks:**
  1. FR-5 keeps today's validate-before-consume order. Choose either a validation read (SELECT) followed by the claim, or validation predicates inside the claim's `WHERE`. In the second option a mismatched client/redirect yields zero rows, which is indistinguishable from "consumed", and PKCE (a JS base64url compare) cannot sit in SQL easily. Either way only the claim's row count decides.
  2. Where the access-token mint sits relative to `COMMIT`. The mint is pure CPU, so either order works. It must not be returned to the caller before `COMMIT`.
  3. The shared helper's return shape: `{ accessToken, expiresIn, now, expiresAt }` vs a split, given that `mintOAuthAccessToken`'s callers use only `expiresIn`.
- **Pre-existing asymmetry, not in scope, flagged only:**
  - `rotateRefreshToken` requires `u.is_active = true` (`:355`), but `exchangeAuthCode`'s SELECT (`:481-488`) does not check `is_active`. A code issued just before deactivation is still redeemable within its 60 s TTL. FR-1..FR-8 do not ask for this; adding it would be scope creep unless the operator opts in.
  - Audience fallback differs: exchange uses `resource || row.resource || ''` (`:507`), refresh uses `resource || ''` (`:535`). FR-8 says keep today's shape, so the design must keep both as they are.
- **Stale line hints:** IDENTITY-2/IDENTITY-4 in `services/xstockstrat-identity/docs/context-constitution.md:19,21` cite `~L477`/`~L317`, which now drift. The `CLAUDE.md:38` "single-use" claim becomes true only after this fix. Both are for the teardown context-constitution refresh.
- **Collision (textual only):** `242-fix-push-untargeted-broadcast` also touches `identityServiceImpl.ts` (admin directory). It is in a disjoint block, so the risk is a rebase only.
- Not found: a C-13 test-data-inventory fixture home for identity (not searched beyond the test file; new fake data stays local to the test file unless reused); a shared helper returning `now`/`expiresAt` (it must be added).

## Recommended Scope

Advisory only.

1. **Step 1 — Auth-code claim (D-23, AC-1/2/3/5/6).** Rewrite `exchangeAuthCode` along the `rotateRefreshToken` pattern:
   - `connect` → `BEGIN` → validation read → conditional `UPDATE … SET consumed_at = NOW() WHERE code = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING …` → `issueRefreshToken(…, client)` → `COMMIT`; ROLLBACK on zero rows or on error.
   - Mismatch rejections happen before the claim (FR-5).
   - RED first, using an auth-code variant of `makeTokenDb` to cover the 20-way concurrency, the INSERT-failure → `13` with `consumed_at` NULL, and the validation-failure-does-not-consume cases.
   - Rewrite the consumed/expired tests on the stateful fake.
   - Settle the real-PG question at design (Risks, first bullet).
2. **Step 2 — Helper consolidation (D-21, AC-4).**
   - Make the mint helper's `aud` optional and expose `now`/`expiresAt`.
   - Route `authenticateUser` and `refreshToken` through it and `authenticateUser` through `issueRefreshToken`.
   - Unit-assert the claim set, the `expires_at - issued_at = 900`, no `aud` on first-party tokens, and `client_id` param NULL vs the client id.
   - Grep step: no `jwt.sign` in `authenticateUser`/`refreshToken` and no `refresh_tokens` INSERT in `authenticateUser`.
   - The operator may drop this step at design.
3. **Teardown** — re-anchor IDENTITY-2/IDENTITY-4 line hints, and confirm the `CLAUDE.md:38` "single-use" wording.
