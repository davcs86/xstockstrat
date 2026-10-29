# Implementation Spec: fix-identity-auth-code-race

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/265-fix-identity-auth-code-race/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-identity-auth-code-race`

---

## Execution Summary

The work follows design.md's Chosen Approach, in two red-green cycles plus two closing steps.

1. **D-23 first (Steps 1-2).** `exchangeAuthCode` keeps its validation lines. It mints before the claim. A new
   private `redeemAuthCode` copies `rotateRefreshToken` and runs the conditional claim and the successor
   `issueRefreshToken` INSERT in one transaction. The handler returns tokens only after COMMIT. Step 1 keeps
   calling today's `mintOAuthAccessToken`, so the security fix lands without the refactor.
2. **D-21 second (Steps 3-4).** Rename and generalise the mint helper to `mintAccessToken(…, audience?)`. Route
   first-party `authenticateUser` and `refreshToken` through it, and route `authenticateUser` through
   `issueRefreshToken`. Step 4 adds the AC-4 claim-shape tests and the FR-6/FR-7 structural grep.
3. **Step 5** is the recorded manual real-Postgres repro of AC-1, the harness the `5bd271d` hotfix used.
4. **Step 6** is the teardown context refresh for identity's context constitution.

There are no proto, migration, config, env var or port changes (product-spec Fix Scope; recon.md Dependencies).
Only two source files change: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` and
`services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`.

**Consumer surface (C-14):** none. The product spec marks the feature internal/platform-only. No RPC, response
shape, UI segment or Agent MCP tool changes. This was a decision, not an omission, so no UI or agent step exists.

**Evidence route (all test steps).** The identity suite skips every impl test when its `before()` import fails
(`identityServiceImpl.test.ts:28-40`). On today's `pnpm test` that import fails, on Node 22 and, per
`docs/roadmap/features/252-fix-identity-ledger-test-suites/product-spec.md:12-22`, on Node 24 too, because the
`../grpc/identityServiceImpl.js` specifier does not exist under strip-types. So `pnpm test` stays green with
zero assertions until feature 252 lands. RED and GREEN evidence is therefore taken from the **compiled run**
that `docs/roadmap/ledger/fails.md:2223-2226` prescribes: compile src plus tests with `tsc`, then run
`node --test` on the output, with the reporter pinned to TAP (`fails.md:2991-3003`). The run guard design.md §3
requires sits inside that run:
- Node 24 (`.github/workflows/ci.yml:185`);
- an assertion that `typeof IdentityServiceImpl === 'function'`;
- a non-zero executed-test count.

`pnpm run test:coverage` still runs for CI parity, but it is not RED/GREEN evidence.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` concurrent exchanges yield exactly one grant | Step 2 (fake, RED→GREEN); Step 5 (real Postgres, before/after) |
| `@AC-2` consumed code cannot be redeemed again | Step 2 (regression guard) |
| `@AC-3` failed refresh INSERT does not consume the code | Step 2 (`failInsert` and `JWT_SECRET`-unset, RED→GREEN) |
| `@AC-4` same claim shape and client tagging across login, refresh and OAuth exchange | Step 4 (first-party login `client_id` RED→GREEN; shared claim half as a guard) |
| `@AC-5` validation failure does not consume the code (3 examples) | Step 2 (regression guard, all 3 rows) |
| `@AC-6` expired code cannot be redeemed | Step 2 (regression guard) |

**Fixture mapping (C-13).** The new D-23 tests live inside the existing `describe('exchangeAuthCode')` block
(`identityServiceImpl.test.ts:310`). They reuse its `verifier`, `storedRow()` and `exchangeCall()` helpers
(`:311-337`). The acceptance literals therefore map onto the existing fixtures:
- `"u-1"` → `'u1'`
- `"mcp-client-1"` → `'oauthc_1'`
- `"https://agent.example/callback"` → `'https://app.example/cb'`
- `"v-123"` → `verifier` (`'a'.repeat(64)`)

The AC-4 resource `"https://agent.example/mcp"` is passed as a `storedRow`/`exchangeCall` override. This adds no
second inline copy of a domain literal.

## Step Dependencies

- **Step 2 [test] covers Step 1 [service]** (C-08 pair).
  - Write Step 2's tests and capture RED on the pre-Step-1 tree before Step 1's edit (`tdd-gate.md` protocol).
  - Step 1's GREEN is Step 2's Verification.
- **Step 4 [test] covers Step 3 [service]** (C-08 pair). It has the same RED-first order.
- **Step 3 requires Step 1.** Step 3 renames the helper that Step 1's moved mint call uses
  (`mintOAuthAccessToken` → `mintAccessToken`).
- **Step 5 has two halves.**
  - Its BEFORE half runs on the pre-Step-1 tree: either before Step 1's edit, or from a detached scratch worktree
    at the base sha recorded in `context.md` at Step 1 start.
  - Its AFTER half runs after Step 3.
- **Step 6 requires Steps 1-4.** It re-anchors line hints that only settle after the code moves.
- **Overlap with feature 252** (`implementation-ready`): both features touch `identityServiceImpl.test.ts`, and
  252 also touches `package.json`/`tsconfig.json`.
  - Whichever lands second merges the other's test-file changes (`252 implementation-spec.md:95`).
  - Until 252 lands, the compiled-run guard is the only P-06 protection.
  - If 252 has landed on the base when a test step runs, its compiled `pnpm test` replaces the scratch compile.
    Record that in the Deviation Log (F-09).
- **Collision (textual only):** `242-fix-push-untargeted-broadcast` touches a disjoint block of
  `identityServiceImpl.ts`, so expect a rebase conflict at most.

---

### Step 1 — service: single-use auth-code redemption in `exchangeAuthCode` (D-23)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (focus here: single-use auth-code semantics and transaction correctness); Security — JWT claims minimal, auth scope (an authorization code is redeemable exactly once)

**Codebase Evidence**:
- Confirmed via `sed -n 474,518p services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`:
  - `async exchangeAuthCode(call: any, callback: any)` starts at `:474`.
  - Validation SELECT joined to `identity.users` `:481-488`; not-found exit `:489`.
  - JS early-outs: `consumed_at` `:491`, expiry `:492-494`, redirect/client `:495-497`.
  - PKCE `digest('base64url')` compare `:499-502`.
  - **Unconditional** consume `:503-506`: `'UPDATE identity.oauth_auth_codes SET consumed_at = NOW() WHERE code = $1'`.
  - Audience `const audience = resource || row.resource || '';` `:507`; mint `this.mintOAuthAccessToken(…)`
    `:508-510`.
  - `const refreshToken = await this.issueRefreshToken(row.user_id, clientId);` on the pool, outside any
    transaction, `:511`.
  - `callback(null, { accessToken, tokenType: 'Bearer', expiresIn, refreshToken })` `:513`; catch → `{ code: 13 }`
    `:514-517`.
- Reuse target (mandatory, recon.md Patterns to REUSE): `private async rotateRefreshToken(tokenHash, touchLastUsed)`
  `:340-374`:
  - `const client = await this.pool.connect();` `:344`, then `await client.query('BEGIN');` `:346`.
  - Conditional `UPDATE … AND rt.revoked_at IS NULL AND rt.expires_at > NOW() … RETURNING` `:347-358`.
  - `if (claim.rows.length === 0) { await client.query('ROLLBACK'); return null; }` `:359-362`.
  - `this.issueRefreshToken(…, client)` then `COMMIT` `:365-366`.
  - `catch` → `ROLLBACK().catch(() => undefined)` and rethrow `:368-370`; `finally { client.release(); }`
    `:371-373`.
- `private async issueRefreshToken(userId, clientId?, db: Pool | PoolClient = this.pool)` `:321-334` already takes
  a transaction client and writes `client_id` as `clientId ?? null` (`:329-331`). It stays unchanged.
- `private get jwtSecret()` `:112-119` throws when `JWT_SECRET` is unset (IDENTITY-1). This is why minting goes
  before the claim (design.md §1 step 2).
- Schema: `identity.oauth_auth_codes.code TEXT PRIMARY KEY`, `expires_at TIMESTAMPTZ NOT NULL`,
  `consumed_at TIMESTAMPTZ` (`migrations/003_oauth.up.sql:14-24`). No migration is needed.
- Sibling atomic-guard precedent: IDENTITY-8 (`services/xstockstrat-identity/docs/context-constitution.md:25`), a
  conditional write decided by row count rather than read-then-write.

**TDD**: `red-green required`

**Covers**: — (the paired Step 2 covers AC-1, AC-2, AC-3, AC-5, AC-6)

**Instructions**:
1. **Phase A stays exactly as it is.** Leave `:478-502` as they are: the hash, the SELECT, the not-found exit, the
   JS consumed and expiry early-outs, the redirect/client check and the PKCE compare. They are reject-only
   pre-filters on a possibly stale read.
2. **Phase B replaces only `:503-511`**, in this order:
   1. Keep `const audience = resource || row.resource || '';` unchanged.
   2. Move the existing `this.mintOAuthAccessToken(row.user_id, row.email, row.roles ?? [], audience)` call
      **before** the claim. A throw here (for example `JWT_SECRET` unset) reaches the existing catch → `13`, with
      nothing consumed and no row written.
   3. Call `const refreshToken = await this.redeemAuthCode(codeHash, row.user_id, clientId);`.
   4. `if (refreshToken === null) return callback({ code: 16, message: 'invalid_grant' });`.
   5. Keep the existing `log.info('OAuth code exchanged', …)` and
      `callback(null, { accessToken, tokenType: 'Bearer', expiresIn, refreshToken })`. They now run only after
      COMMIT.
3. **Add a private `redeemAuthCode(codeHash: string, userId: string, clientId: string): Promise<string | null>`**
   directly after `rotateRefreshToken` (`:374`). It mirrors that method step for step:
   - `this.pool.connect()`, then `BEGIN`.
   - Claim:

     ```sql
     UPDATE identity.oauth_auth_codes SET consumed_at = NOW()
     WHERE code = $1 AND consumed_at IS NULL AND expires_at > NOW()
     RETURNING code
     ```

     Pass `[codeHash]`.
   - 0 rows → `ROLLBACK`, then `return null`.
   - Otherwise `const refreshToken = await this.issueRefreshToken(userId, clientId, client);`, then `COMMIT`, then
     `return refreshToken`.
   - `catch` → `await client.query('ROLLBACK').catch(() => undefined); throw err;`.
   - `finally { client.release(); }`.
   - Give it a doc comment of at most 2 lines stating the constraint: the conditional claim lets exactly one
     caller win, and the successor INSERT shares its transaction.
4. **The claim's `consumed_at IS NULL` and `expires_at > NOW()` predicates are load-bearing** (design.md §1, the
   FR-1 reading in `context.md`). Never drop them as "redundant with the JS checks".
5. **Keep the raw numeric codes** `16` and `13` (IDENTITY-3). Keep the hex code hash and the base64url PKCE compare
   byte for byte (IDENTITY-2).
6. **Touch nothing else.** `rotateRefreshToken` (hotfix `5bd271d`), `issueRefreshToken` and the audience
   fallbacks at `:507` and `:535` stay as they are.
7. **jscpd stop-and-ask (design.md §4).** If the duplication report flags a clone between `redeemAuthCode` and
   `rotateRefreshToken`, **stop and ask the user**. Do not extract a `withTransaction` helper silently. Log any
   forced divergence in the Deviation Log (F-09).
8. **Header propagation:** this step adds no outbound gRPC call, so C-03 has nothing to apply to (recon.md
   Dependencies).

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint
cd services/xstockstrat-identity && grep -n "consumed_at IS NULL AND expires_at > NOW()" src/grpc/identityServiceImpl.ts   # exactly 1 hit, inside redeemAuthCode
cd services/xstockstrat-identity && grep -n "SET consumed_at = NOW() WHERE code = \$1'" src/grpc/identityServiceImpl.ts   # 0 hits (unconditional UPDATE gone)
DUP_REPORT_ONLY=1 bash scripts/check-duplication.sh services/xstockstrat-identity/src   # run from the repo root; any redeemAuthCode/rotateRefreshToken clone → stop and ask
```
The GREEN run is Step 2's Verification.

---

### Step 2 — test: auth-code race, atomicity and non-consumption tests (AC-1, AC-2, AC-3, AC-5, AC-6)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (focus here: single-use auth-code semantics); Security — auth scope (code redeemable exactly once)

**Codebase Evidence**:
- Analog fake (mandatory reuse of the shape): `function makeTokenDb(row: any, opts: { failInsert?: boolean } = {})`
  `identityServiceImpl.test.ts:374-409` (re-anchored 2026-10-29 after feature 252's rewrite of this file).
  - Its `lockedBy` row-lock model lets a conditional claim held by an open transaction make a concurrent
    conditional claim lose.
  - The claim applies on COMMIT only (`:378-383`, `:390-399`), and `failInsert` throws `'insert failed'` on the
    refresh INSERT (`:386`).
  - The concurrency test is at `:424` and the fault-injection test at `:434`.
- `describe('exchangeAuthCode', …)` `:282` holds `verifier` `:283`, `storedRow(overrides)` `:285-298` and
  `exchangeCall(over)` `:300-309`.
  - Existing tests: happy path `:311-326` (regex `INSERT INTO identity\.refresh_tokens[^)]*client_id` at `:325`),
    bad verifier `:328-339`, consumed `:341-349`, expired `:351-359`, redirect mismatch `:361-369`.
  - All of them stay unchanged and must stay green. `makeSpyPool.connect()` (`:243-245`) returns a client over the
    same `queries`/`rows`, so the new claim gets 1 row.
- Helpers: `makeCall` `:51`, `implWithPool` `:249-252` (config `getInt` returns the default, so the access TTL is
  900), `challengeFor` `:254-256`.
- Env-mutation precedent: save, set, then restore in `finally`, as `process.env.APPLICATION_ENV` does at `:125-140`.
- The file has no `if (!impl) return;` guards since feature 252; the top-level `describe('test harness')` (`:25-27`)
  asserts the impl imports, so a failed import fails the suite instead of skipping it.
- C-13 check: identity has no `src/__tests__/fixtures/` home (`ls services/xstockstrat-identity/src/__tests__` →
  `identityServiceImpl.test.ts`, `mtls.test.ts`, `telemetry.export.test.ts`, `telemetry.test.ts`). The new fake has
  one consumer, this file, so inline is compliant.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-5, AC-6`

**Instructions**:
1. **Add `function makeAuthCodeDb(row: any, opts: { failInsert?: boolean; expireAtClaim?: boolean } = {})`** at
   module level, directly after `makeTokenDb` (`:409`). It records `sql` and `params` and exposes
   `db = { consumedAt: Date | null, committedInserts: Array<{ params: any[] }>, lockedBy }`. Its fidelity rules
   (design.md §3, binding):
   - **(a)** Any `SELECT` returns `[{ ...row, consumed_at: db.consumedAt }]`. It never returns `[]` after
     consumption.
   - **(b)** An `UPDATE` matching `SET consumed_at = NOW()` is conditional **only** when the SQL contains both
     `consumed_at IS NULL` and `expires_at > NOW()`.
     - A conditional claim returns `{ rows: [] }` when any of these holds: `db.consumedAt !== null`; another open
       transaction holds `lockedBy`; `opts.expireAtClaim`.
     - Otherwise it returns `{ rows: [{ code: '…' }] }`.
     - An unconditional UPDATE always applies.
   - **(c)** Autocommit `pool.query` UPDATEs and INSERTs apply immediately. The UPDATE sets `consumedAt`, and the
     INSERT pushes to `committedInserts`. This models today's code path, so the RED run is honest.
   - **(d)** In-transaction (`connect()` client) UPDATEs and INSERTs are staged on the transaction. `COMMIT`
     publishes them: it sets `consumedAt` and pushes the staged inserts. `ROLLBACK` discards them and releases
     `lockedBy`.
   - **(e)** `opts.expireAtClaim` makes the conditional claim see the code as expired even though the validation
     SELECT returned it live.
   - `opts.failInsert` throws `new Error('connection terminated')` on any `INSERT INTO identity.refresh_tokens`.
     That is the AC-3 Given. (`makeTokenDb` uses `'insert failed'`; the new fake's message is its own, no conflict.)
   - Each `run` starts with `await Promise.resolve()`, as `makeTokenDb` does at `:377`, so concurrent callers
     interleave.
2. **Inside `describe('exchangeAuthCode')`, add a small local `exchange(impl, over?)`** that resolves
   `{ err?: number; message?: string; res?: any }`. Model it on `refresh()` at `:411-415`. Then add these tests,
   reusing `storedRow()`, `exchangeCall()` and `implWithPool`, each setting `process.env.JWT_SECRET` as the
   neighbouring tests do:

   | Test | Scenario | Asserts | Expected on the pre-Step-1 tree |
   |---|---|---|---|
   | 20-way race | AC-1 | `Promise.all` of 20 `exchange` calls: exactly 1 result has `accessToken` and `refreshToken`; 19 have `err === 16` and `message === 'invalid_grant'`; `db.committedInserts.length === 1` and its `params[3] === 'oauthc_1'` | **RED**: 20 successes, 20 inserts |
   | `failInsert` | AC-3 | `err === 13`, no `res`, `db.consumedAt === null`, `committedInserts.length === 0` | **RED**: the autocommit UPDATE already set `consumedAt` |
   | `JWT_SECRET` unset | AC-3 | `const prev = process.env.JWT_SECRET; delete process.env.JWT_SECRET; try { … } finally { restore prev }`. Asserts `err === 13`, `db.consumedAt === null`, `committedInserts.length === 0` | **RED**: the UPDATE autocommitted before the mint threw |
   | claim-time expiry (`expireAtClaim`) | AC-1 claim predicate | `err === 16`, `committedInserts.length === 0` | **RED**: the unconditional UPDATE plus INSERT succeed |
   | sequential reuse | AC-2 | first call succeeds; second call has `err === 16`, `message === 'invalid_grant'` | green (regression guard) |
   | 3 mismatches | AC-5 | loop over `{ codeVerifier: 'wrong-verifier' }`, `{ redirectUri: 'https://evil.example/callback' }`, `{ clientId: 'other-client' }`. Each has `err === 16`, `message === 'invalid_grant'` and `db.consumedAt === null`; a following `exchangeCall()` with no override succeeds, with `accessToken` and `refreshToken` present | green (regression guard) |
   | expired code | AC-6 | `storedRow({ expires_at: new Date(Date.now() - 1000) })` → `err === 16`, `committedInserts.length === 0` | green (regression guard) |

   - Name each `it(...)` with its `@AC-*` ID so the RED/GREEN captures name the scenario (`tdd-gate.md` step 5).
   - The `JWT_SECRET` restore in `finally` is mandatory (design.md Open Risk). A leaked unset value breaks every
     later signing test in the file.
3. **Do not edit the existing exchange tests** (`:311-369`) or `makeTokenDb`.
4. Do **not** add `if (!impl) return;` guards to the new tests: feature 252 removed them all, and the top-level
   'test harness' test is what proves the impl loaded.

**Verification**: run from `services/xstockstrat-identity` on Node 24. Capture RED on the pre-Step-1 tree and
GREEN after Step 1. Since feature 252, `pnpm test` (`package.json:12`, `tsc && node --test dist/__tests__/*.test.js`)
compiles the test files and is the real RED/GREEN evidence; a `tsc` type error fails the run.
```bash
node --version   # must print v24.x (ci.yml:185); if Node 24 is unavailable, stop and ask, never substitute
pnpm test 2>&1 | tee /tmp/identity-265-step2.log
grep -E '^# (tests|pass|fail)' /tmp/identity-265-step2.log   # tests > 0; RED: the 4 RED-marked AC tests fail; GREEN: "# fail 0"
pnpm run lint && pnpm run test:coverage   # CI parity (c8 --lines 40)
```
- `dist/` falls under the root `.gitignore` `**/dist/` rule, so never stage it.
- The RED capture must show only the 4 RED-marked tests failing, for the asserted reason. If the pass count is the
  same with and without Step 1, the suite is skipping (`fails.md:2226`).

---

### Step 3 — service: one mint helper and one refresh-issue helper for first-party and OAuth (D-21)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (focus here: claim shape and TTL unchanged); Security — JWT claims minimal and unchanged by the D-21 dedup

**Codebase Evidence**:
- `private mintOAuthAccessToken(userId, email, roles, audience: string): { accessToken: string; expiresIn: number }`
  `identityServiceImpl.ts:295-315`.
  - It always writes `aud: audience` (`:309`) and signs with `{ expiresIn: this.accessTtlSeconds }` (`:311-313`).
  - Its only callers are `exchangeAuthCode` `:533-535` (moved by Step 1) and `refreshOAuthToken` `:560-562`
    (`grep -rn mintOAuthAccessToken --include=*.ts .` → 3 hits, all in this file: `:295`, `:533`, `:560`;
    re-anchored 2026-10-29).
- `authenticateUser`:
  - Inline `now`/`expiresAt` `:163-164`, `claimsPayload` `:166-172`, `(jwt as any).sign(…)` `:174-176`.
  - Inline `uuidv4()` plus `digest('hex')` plus a 3-column `INSERT INTO identity.refresh_tokens (user_id,
    token_hash, expires_at)` `:178-185`.
  - The response uses `secondsToDate(expiresAt)` and `claims` from the local `now`/`expiresAt` (`:188-199`).
- `refreshToken`: `rotateRefreshToken(tokenHash, false)` `:236` (unchanged). Inline `now`/`expiresAt`/
  `claimsPayload` `:243-245` and `(jwt as any).sign(…)` `:247-249`. Response `claims` `:252-262`.
- `issueRefreshToken(userId, clientId?, db)` `:321-334` writes `client_id` as `clientId ?? null`. The column is
  nullable (`migrations/004_refresh_token_client.up.sql:8-10`).
- Remaining `jwt.sign` sites today (`grep -n "(jwt as any).sign" src/grpc/identityServiceImpl.ts`): `:174`, `:247`,
  `:311`. Remaining `refresh_tokens` INSERT sites: `:182`, `:329`.

**TDD**: `red-green required`

**Covers**: — (the paired Step 4 covers AC-4)

**Instructions**:
1. **Rename `mintOAuthAccessToken` to `mintAccessToken(userId: string, email: string, roles: string[], audience?:
   string)`**, returning `{ accessToken: string; expiresIn: number; issuedAt: number; expiresAt: number }`.
   - `issuedAt` and `expiresAt` are epoch seconds: today's `now` and `expiresAt`.
   - Build the payload with `user_id`, `email`, `roles: roles ?? []`, `issued_at`, `expires_at`. Add
     `aud: audience` **only when `audience !== undefined`**.
   - Keep `{ expiresIn: this.accessTtlSeconds }` unchanged.
   - Update the doc comment (at most 2 lines): `aud` is written only for OAuth callers, so first-party tokens carry
     none (IDENTITY-4).
2. **Update the two OAuth callers to the new name**, keeping their arguments and `''` fallbacks:
   - `exchangeAuthCode` passes `audience` (Step 1's moved call).
   - `refreshOAuthToken` passes `resource || ''` (`:560-562`).
   - The OAuth `aud: ''` behaviour for an empty resource is preserved (FR-8).
3. **`authenticateUser`: replace only `:163-185`** with
   `const { accessToken, issuedAt, expiresAt } = this.mintAccessToken(user.user_id, email, user.roles);` (no
   audience), then `const refreshToken = await this.issueRefreshToken(user.user_id);`.
   - The mint-then-insert order is unchanged.
   - The response reads `expiresAt` and `claims.issuedAt`/`claims.expiresAt` from `issuedAt`/`expiresAt`, through
     the existing `secondsToDate`.
   - Leave the SELECT with `is_active = true`, `isBlockedDefaultAdmin` and `bcrypt.compare` (`:138-161`) as they
     are. This preserves durable `user-management-ui.feature` @AC-2..@AC-6.
4. **`refreshToken`: replace only `:243-249`** with
   `const { accessToken: newAccessToken, issuedAt, expiresAt } = this.mintAccessToken(user_id, email, roles);`.
   - The response `claims` read the returned values.
   - Leave `rotateRefreshToken(tokenHash, false)` (`:236`) as it is.
5. **Remove anything orphaned.** If `uuidv4` and `crypto` lose their last use, remove the import. Both are still
   used by `issueRefreshToken` and the hashing sites, so expect no import change. `pnpm run lint`
   (`no-unused-vars` error) proves it either way.
6. **Side effect, accepted (design.md §2, C-16 CHANGE signed off).** First-party refresh rows now store
   `client_id = NULL` explicitly through the shared INSERT.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint
cd services/xstockstrat-identity && grep -c "mintOAuthAccessToken" src/grpc/identityServiceImpl.ts   # 0
```
The structural FR-6/FR-7 grep and the GREEN run are Step 4's Verification.

---

### Step 4 — test: claim-shape and client-tagging parity across login, refresh and OAuth exchange (AC-4)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (focus here: claim shape and TTL); Security — JWT claims minimal and unchanged by the D-21 dedup

**Codebase Evidence**:
- `function makeSpyPool(rows: any[] = [])` `identityServiceImpl.test.ts:235-247` (re-anchored 2026-10-29 after
  feature 252's rewrite).
  - It records `queries: string[]` only (`query(sql, _params)` drops the params, `:239-242`).
  - `connect()` returns `{ query: this.query, release() {} }` (`:243-245`).
  - Existing consumers assert on `pool.queries` (e.g. `:325`, `:607`), so an additive `params` array leaves them
    unaffected.
  - `routePool` (`:850-861`) already records params but has no `connect()`, so it cannot serve
    `rotateRefreshToken` or the Step 1 transaction; extending `makeSpyPool` stays the choice.
- Login fixture with no new bcrypt dependency:
  - `SEED_ADMIN_PASSWORD_HASH` (`identityServiceImpl.ts:32-33`) is already imported by the test (`:11`, `:19`) and
    matches password `'admin'` (test `:121-140`).
  - `isBlockedDefaultAdmin` refuses it only when `APPLICATION_ENV === 'production'` (`identityServiceImpl.ts:38-40`).
- `refreshToken` runs through `rotateRefreshToken` → `makeSpyPool.connect()`.
  - The claim returns the spy `rows`, so `rotated.row` supplies `user_id`/`email`/`roles`.
  - `issueRefreshToken` then runs on the same client.
- Test file: `describe('authenticateUser')` `:68`; `describe('exchangeAuthCode')` `:282`;
  `describe('refreshOAuthToken')` `:593-619` (re-anchored 2026-10-29).
- Today's first-party login INSERT has 3 params (`identityServiceImpl.ts:181-185`), so `params[3]` is `undefined`.
  That is the RED discriminator. Today's first-party refresh already writes `client_id` as `null` through
  `issueRefreshToken`, and no first-party token carries `aud` today, so those assertions are guards.
- C-13: one consumer; inline is compliant. No `src/__tests__/fixtures/` home exists.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. **Make `makeSpyPool` also record params, additively.** Add `const params: any[][] = []`, return it beside
   `queries`, and in `query(sql, p?)` do `queries.push(sql); params.push(p ?? []);`. Keep the `connect()` shape.
   Every existing assertion stays unchanged.
2. **Add `describe('token claim-shape parity (AC-4)')`** after `describe('refreshOAuthToken')` (ends `:619`). It has
   three cases. Each sets `process.env.JWT_SECRET`, saves and restores `APPLICATION_ENV` in `finally` (`:121-140`
   precedent), and decodes with `jwt.verify`. No `if (!impl) return;` guard (removed by feature 252).
   - **Login:**
     - Pool: `makeSpyPool([{ user_id: 'u1', password_hash: SEED_ADMIN_PASSWORD_HASH, roles: ['trader'] }])`, with
       `APPLICATION_ENV` deleted.
     - Call: `authenticateUser(makeCall({ email: 'u@example.com', password: 'admin' }))`.
     - Find the refresh INSERT index `i` by `/INSERT INTO identity\.refresh_tokens/`, then assert
       `pool.params[i][3] === null`. This is **RED** today (`undefined`).
   - **First-party refresh:**
     - Pool: `makeSpyPool([{ token_id: 't1', user_id: 'u1', client_id: null, email: 'u@example.com', roles:
       ['trader'] }])`.
     - Call: `refreshToken(makeCall({ refreshToken: 'r1' }))`.
     - Assert the refresh INSERT `params[3] === null` (guard).
   - **OAuth exchange:**
     - Pool: `makeSpyPool([storedRow({ resource: 'https://agent.example/mcp' })])`.
     - Call: `exchangeCall({ resource: 'https://agent.example/mcp' })`. Either share `storedRow`/`exchangeCall` by
       nesting this case in `describe('exchangeAuthCode')`, or pass the row literally once. Pick nesting if that
       keeps a single consumer per literal.
     - Assert the refresh INSERT `params[3] === 'oauthc_1'`.
   - **On all three decoded tokens** (the shared half, a guard):
     - the keys `user_id`, `email`, `roles`, `issued_at`, `expires_at` are present;
     - `user_id === 'u1'`, `email === 'u@example.com'`, `roles` deep-equals `['trader']`;
     - `expires_at - issued_at === 900`.
   - **`aud`:**
     - `!('aud' in decoded)` for login and refresh (guard);
     - `decoded.aud === 'https://agent.example/mcp'` for the OAuth token.
   - Name each `it(...)` with `AC-4`.
3. **Structural FR-6/FR-7 check.** This is product-spec Test Harness Expectations; it is not a Gherkin scenario.
   Run it in this step's Verification and record its output in `context.md`.

**Verification**: run from `services/xstockstrat-identity` on Node 24. Capture RED on the pre-Step-3 tree and
GREEN after Step 3. `pnpm test` is the real RED/GREEN evidence since feature 252 (see Step 2).
```bash
node --version   # v24.x, else stop and ask
pnpm test 2>&1 | tee /tmp/identity-265-step4.log
grep -E '^# (tests|pass|fail)' /tmp/identity-265-step4.log   # tests > 0; RED: the AC-4 login client_id case fails; GREEN: "# fail 0" (Step 2's tests stay green)
# FR-6/FR-7 structural half: exactly one jwt.sign (inside mintAccessToken) and one refresh_tokens INSERT (inside issueRefreshToken)
grep -n "(jwt as any).sign" src/grpc/identityServiceImpl.ts            # exactly 1 hit, within mintAccessToken
grep -n "INSERT INTO identity.refresh_tokens" src/grpc/identityServiceImpl.ts   # exactly 1 hit, within issueRefreshToken
pnpm run lint && pnpm run test:coverage   # CI parity (c8 --lines 40, i.e. line coverage >= 40%)
```

---

### Step 5 — test: real-Postgres 20-caller repro of AC-1 (manual, local, recorded)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `docs/roadmap/features/265-fix-identity-auth-code-race/context.md` — modify (repro script verbatim, the command,
  before/after counts, operator confirmation)

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (focus here: single-use auth-code semantics under real Postgres concurrency)

**Codebase Evidence**:
- No real-Postgres harness exists in identity. The only DB dependency is `"pg": "^8.11.5"` (`package.json:31`).
  Hotfix `5bd271d` recorded a manual repro in its commit message (recon.md Risks).
- `scripts/integration-test.sh:4-11` still targets the removed 80xx ports, so it cannot be used (recon.md).
- The service builds its pool as `new Pool({ connectionString, max: parseInt(process.env.DB_POOL_MAX ?? '2', 10) })`
  (`src/index.ts:34-41`), and reads `DATABASE_URL` (`src/index.ts:18`).
- Compose `DATABASE_URL` shape:
  `postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable`
  (`docker-compose.yml:27`). Use `localhost` from the host.
- Tables to seed:
  - `identity.users(user_id UUID default, email UNIQUE, password_hash NOT NULL, roles, is_active)`
    (`migrations/001_identity_tables.up.sql:6-14`);
  - `identity.oauth_clients(client_id PK, redirect_uris TEXT[])` (`migrations/003_oauth.up.sql:7-12`).
- `issueAuthCode(call, cb)` takes `{ userId, clientId, redirectUri, codeChallenge, resource }`
  (`identityServiceImpl.ts:468`, re-anchored 2026-10-29). It requires the client to exist and the redirect to be registered.
- As of 2026-10-29 no Postgres listens on `localhost:5432` in the execute environment (`pg_isready` reports no
  response), and the execute loop may not start one, so the BEFORE/AFTER runs go to the operator (Instruction 2).

**TDD**: `red-green required` (BEFORE = RED: more than 1 grant; AFTER = GREEN: exactly 1)

**Covers**: `AC-1`

**Instructions**:
1. **Write a CommonJS script in the session scratchpad** (never committed), e.g. `repro-265.cjs`. It:
   - requires `pg` and the compiled `dist/grpc/identityServiceImpl.js` (built by `pnpm test`, Step 2);
   - builds `new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) })` and
     `new IdentityServiceImpl(pool, { getInt: (_k, d) => d })`;
   - seeds one user (`repro-265-<ts>@example.com`, any `password_hash`) and one client
     (`repro265_<ts>`, `redirect_uris = '{https://agent.example/callback}'`);
   - issues one code through `impl.issueAuthCode` with the S256 challenge of a fixed verifier;
   - fires 20 concurrent `impl.exchangeAuthCode` calls with that code, verifier, redirect and client;
   - prints the success count and
     `SELECT count(*) FROM identity.refresh_tokens WHERE user_id = $1 AND client_id = $2`;
   - deletes its seeded rows, then calls `pool.end()`.
2. **Run it as a single local command against local TimescaleDB** with migrations applied (`./scripts/bootstrap.sh`):

   ```bash
   DB_POOL_MAX=20 JWT_SECRET=repro DATABASE_URL='postgres://xstockstrat:<pw>@localhost:5432/xstockstrat?sslmode=disable' node <scratchpad>/repro-265.cjs
   ```

   Bound it with a timeout. If no local Postgres is reachable, **stop and ask the operator** to run it. Never spin
   up a container from inside the execute loop and wait on it.
3. **BEFORE run:** on the pre-Step-1 tree. Expect more than 1 success and more than 1 refresh row (the hotfix's
   refresh repro saw 19/20 and 20/20). **AFTER run:** after Step 3. Expect exactly 1 success and exactly 1 row.
4. **Record all of the following in `context.md`:**
   - the script, verbatim;
   - the exact command;
   - `node --version`;
   - both counts;
   - this line, verbatim: *"local only; never set DB_POOL_MAX for identity in .do/app*.yaml (direct :25060,
     budget 2)"* (F-06).
5. **Ask the operator to confirm in `context.md`** that this recorded repro counts as the AC-1 real-Postgres
   harness (design.md §3).

**Verification**:
```bash
grep -n "DB_POOL_MAX=20" .do/app.yaml .do/app.dev.yaml   # 0 hits (F-06)
grep -n "repro-265" docs/roadmap/features/265-fix-identity-auth-code-race/context.md   # script + command + BEFORE/AFTER counts recorded
```
The AFTER output must show exactly 1 success and exactly 1 refresh row.

---

### Step 6 — docs: teardown context refresh for identity (IDENTITY-1/2/4 anchors, single-use wording)

**Status**: `pending`
**Service**: `docs` (`services/xstockstrat-identity/docs/`)
**Files**:
- `services/xstockstrat-identity/docs/context-constitution.md` — modify
- `services/xstockstrat-identity/CLAUDE.md` — modify only if the refresh reports drift at `:37-38`

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-identity/docs/context-constitution.md`:
  - `:18` IDENTITY-1 cites "used by `jwt.verify` ~L213 and every `jwt.sign`". After Step 3 one `jwt.sign` site
    remains, inside `mintAccessToken`.
  - `:19` IDENTITY-2 cites `digest('base64url')` "~L477" and hex sites "~L179/234/266/345/433/457/505". These drift
    after Steps 1 and 3.
  - `:21` IDENTITY-4 cites `#mintOAuthAccessToken (~L317, aud: audience ~L331)`. The symbol is renamed to
    `mintAccessToken` in Step 3, so this is symbol drift, not only line drift.
- `services/xstockstrat-identity/CLAUDE.md:37-38` reads "`IssueAuthCode`/`ExchangeAuthCode` use
  `identity.oauth_auth_codes` (single-use, 60s TTL, PKCE S256, exact redirect match)". After Step 1, "single-use"
  becomes true under concurrency (recon.md Risks).
- Root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` scoped to the touched context.
  If the plugin is unavailable, do a manual reconciliation recorded in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Run `/context-forge:context-constitution refresh`, scoped to `services/xstockstrat-identity/` and the two files
   above.
2. Fix the grounded drift it reports:
   - re-anchor IDENTITY-1, IDENTITY-2 and IDENTITY-4 to the current symbols and lines;
   - IDENTITY-4 names `#mintAccessToken` and states that `aud` is written only for OAuth callers.
3. Change `CLAUDE.md:37-38` only if the refresh flags it.
4. If the plugin is unavailable, re-read both files against the code by hand. Record in the PR body that the plugin
   was unavailable **and** the reconciliation performed (root `CLAUDE.md` § Teardown, ledger `fails.md:670`).
5. Do not add a new IDENTITY-* rule for the auth-code claim unless the refresh proposes one. IDENTITY-8 already
   states the atomic-guard family.

**Verification**:
```bash
grep -n "mintOAuthAccessToken" services/xstockstrat-identity/docs/context-constitution.md services/xstockstrat-identity/CLAUDE.md   # 0 hits
grep -n "mintAccessToken" services/xstockstrat-identity/docs/context-constitution.md   # ≥1 hit (IDENTITY-4)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **2026-10-29 — Step 2 (F-09):** RED/GREEN evidence route is `pnpm test` (`tsc && node --test dist/__tests__/*.test.js`,
  feature 252), not the scratch `tsc --outDir .verify` compile; the run's output is the node spec reporter
  (`ℹ tests/pass/fail` lines), not TAP `# tests` lines, so the Verification `grep '^# '` pattern matches nothing —
  counts were read from the `ℹ` lines instead. Logs written to the session scratchpad, not `/tmp/identity-265-step2.log`.
- **2026-10-29 — Step 2 (TDD order):** Step 1 was committed before Step 2's tests, so RED was captured by temporarily
  restoring the pre-Step-1 `identityServiceImpl.ts` from `d6cd9f3c` (uncommitted), running `pnpm test`, then restoring
  the Step 1 file before GREEN. Result matches the spec table: 86 tests, 4 fail (the 4 RED-marked AC tests).
- **2026-10-29 — Step 3 (TDD order, C-08 pair with Step 4):** RED/GREEN taken from a temporary, uncommitted probe
  test (`src/__tests__/zz-step3-red.test.ts`, the AC-4 login case: refresh INSERT `params[3] === null`, no `aud`,
  `expires_at - issued_at === 900`), deleted after GREEN; Step 4 owns the committed AC-4 tests. Evidence via
  `pnpm test` spec-reporter `ℹ` lines (same route as Step 2). The `authenticateUser` inline comment "JWT payload
  uses snake_case claim names" moved into `mintAccessToken`'s 2-line doc comment rather than being dropped.
- **2026-10-29 — Step 4 (F-09):** RED/GREEN evidence via `pnpm test` spec-reporter `ℹ` lines (no TAP `# ` lines, same
  route as Step 2); logs written to the session scratchpad, not `/tmp/identity-265-step4.log`. Step 3 was committed
  first, so RED was captured by temporarily restoring the pre-Step-3 `identityServiceImpl.ts` from `d98f682f~1`
  (uncommitted), then restoring the Step 3 file before GREEN. The OAuth-exchange AC-4 case is nested in
  `describe('exchangeAuthCode')` to reuse `storedRow`/`exchangeCall` (the spec's offered option), so
  `describe('token claim-shape parity (AC-4)')` holds the login and first-party refresh cases; the shared
  assertions live in module-level helpers `assertSharedClaims`, `refreshInsertClientId` and `withAppEnvUnset`.
- **2026-10-29 — Step 5 deferred to operator — integration PR merge held until** the operator runs the recorded
  repro against a local TimescaleDB with identity migrations applied (`./scripts/bootstrap.sh`; no Postgres answers on
  `localhost:5432` here — `pg_isready` "no response" — and the execute loop may not start one). Exact checks:
  1. BEFORE (pre-Step-1 tree, base `d6cd9f3c`): `git worktree add --detach ../ident-265-before d6cd9f3c`, then in
     `../ident-265-before`: `pnpm install --frozen-lockfile --filter "xstockstrat-identity..."` and
     `pnpm --filter xstockstrat-identity run build`, then from that worktree root
     `DB_POOL_MAX=20 JWT_SECRET=repro DATABASE_URL='postgres://xstockstrat:<pw>@localhost:5432/xstockstrat?sslmode=disable' timeout 60 node <path>/repro-265.cjs`
     → expect `successes` > 1 and `refresh_rows` > 1.
  2. AFTER (this branch at or after `56daa169`): same build and the same command from the repo root → expect exactly
     `repro-265 successes=1/20 refresh_rows=1`.
  3. Record both output lines and `node --version` in context.md under the Step 5 note, and confirm there that this
     recorded repro counts as the AC-1 real-Postgres harness (design.md §3). Then flip Step 5 **Status** to `done`.
  The script is recorded verbatim in context.md (Step 5 note). Code-side it was syntax-checked (`node --check`) and
  load-checked against the Step 4 `dist/` (it reached the connect and failed `ECONNREFUSED 127.0.0.1:5432`).
  F-06 grep `DB_POOL_MAX=20` over `.do/app.yaml` and `.do/app.dev.yaml` → 0 hits.
