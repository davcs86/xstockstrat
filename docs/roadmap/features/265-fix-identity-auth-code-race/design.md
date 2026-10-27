# Design: fix-identity-auth-code-race

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (operator approval at the design gate, round 2: "APPROVED as synthesized, including the mint-before-claim order")
**Grounded in**: recon.md

---

## Chosen Approach

**Scope.** Two files change:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`

There are no proto, migration or config changes (recon.md:11). `rotateRefreshToken` (hotfix `5bd271d`,
recon.md:50) is not touched. **Consumer surface (C-14):** internal-only. No RPC, response shape, UI segment
or Agent MCP tool changes. The one change the MCP agent's OAuth client can see is that a duplicate or
concurrent redemption now gets `16 invalid_grant` (product-spec.md:103-105).

### 1. D-23: `exchangeAuthCode` in two phases (recon.md:18-29)

**Phase A: validation stays as it is.** These lines are kept unchanged:
- the pool SELECT joined to `identity.users` (recon.md:19)
- the not-found exit
- the JS `consumed_at` and expiry early-outs (recon.md:20)
- the redirect_uri/client_id check (recon.md:21)
- the PKCE `sha256(verifier).base64url` compare (recon.md:22, IDENTITY-2 recon.md:69)

The early-outs can only reject. A grant comes only from the claim's row count, which is the FR-1 reading the
product-spec review recorded (context.md, session 2026-10-22 sdd-review). The JS checks are best-effort
pre-filters on a stale read. **The claim's `consumed_at IS NULL` and `expires_at > NOW()` predicates are
load-bearing. Never drop them as "redundant with the JS checks".** AC-2 and AC-6 exit through the early-outs,
so only AC-1's losing callers and the claim-time-expiry test exercise the predicates.

**Phase B replaces only the unconditional UPDATE through the refresh INSERT** (recon.md:23-26). It runs in
this order:
1. Compute `audience = resource || row.resource || ''`, unchanged from today (recon.md:24, :125).
2. Call `mintAccessToken(row.user_id, row.email, row.roles ?? [], audience)` before the claim transaction.
   - Minting is CPU-only, but it can throw: the `jwtSecret` getter reads `process.env.JWT_SECRET` and throws
     when it is unset (IDENTITY-1).
   - A throw at this point reaches the existing catch → `13` (recon.md:27), with nothing consumed and no row
     written. That honours FR-2/AC-3 for mint failures too.
   - Losing racers each sign one token and throw it away. It is never returned.
3. Call a new private `redeemAuthCode(codeHash, userId, clientId): Promise<string | null>`. It copies the
   `rotateRefreshToken` structure step for step (recon.md:54-62):
   - `this.pool.connect()`, then `BEGIN`.
   - `UPDATE identity.oauth_auth_codes SET consumed_at = NOW() WHERE code = $1 AND consumed_at IS NULL AND
     expires_at > NOW() RETURNING code`, keyed on the `code` PK (recon.md:62).
   - Zero rows → `ROLLBACK`, return `null`. The handler maps `null` to `{ code: 16, message: 'invalid_grant' }`.
   - Otherwise call `issueRefreshToken(userId, clientId, client)` (recon.md:49, :63, unchanged), then `COMMIT`,
     then return the refresh token.
   - A throw → `ROLLBACK().catch(() => undefined)`, then rethrow. The handler maps it to `13`.
   - `client.release()` runs in `finally`.
4. The handler returns `{ accessToken, tokenType: 'Bearer', expiresIn, refreshToken }` only after
   `redeemAuthCode` returns non-null, i.e. after COMMIT. No token reaches a caller before the claim is durable
   (recon.md:121, fork 2).

Raw numeric codes `16`/`13` stay (IDENTITY-3, recon.md:68).

### 2. D-21: one mint helper and one refresh-issue helper (recon.md:64-67)

**Generalise the existing helper.** Rename `mintOAuthAccessToken` (recon.md:48) to
`mintAccessToken(userId, email, roles, audience?)`. It:
- writes `aud` only when `audience !== undefined`;
- keeps `roles ?? []` and the same `{ expiresIn: this.accessTtlSeconds }` sign option;
- returns `{ accessToken, expiresIn, issuedAt, expiresAt }`, with `issuedAt`/`expiresAt` in epoch seconds
  (resolves recon.md:122, fork 3).

The OAuth call sites keep passing their `''` fallbacks: exchange `:507` and `refreshOAuthToken` `:535`
(recon.md:37, :125). IDENTITY-4 `aud` binding is unchanged (recon.md:70).

**`authenticateUser`.** Replace only the inline mint plus refresh block (recon.md:30-31) with
`mintAccessToken(user.user_id, email, user.roles)`, with no audience, followed by
`issueRefreshToken(user.user_id)`.
- The mint-then-insert order is unchanged.
- `secondsToDate(expiresAt)` and `claims` read the returned values (recon.md:32).

**`refreshToken`.** Replace only the inline claims plus `jwt.sign` (recon.md:35) the same way.

**Left alone:** the `is_active` SELECT, `isBlockedDefaultAdmin`, bcrypt, and
`rotateRefreshToken(tokenHash, false)` (recon.md:34).

**Side effects:**
- First-party refresh rows now store `client_id = NULL` explicitly through the shared INSERT
  (`clientId ?? null`, recon.md:49). The column is nullable (migration 004).
- The impl-spec carries a structural grep step proving no inline `jwt.sign` remains outside `mintAccessToken`
  and no inline refresh INSERT remains outside `issueRefreshToken`. This is the FR-6/FR-7 structural half,
  open from the product-spec review.

### 3. Test harness: option (a), mirroring the hotfix (recon.md:101-109)

**New fake: `makeAuthCodeDb(row, { failInsert?, expireAtClaim? })`.** It is local to the test file next to
`makeTokenDb` (recon.md:71-74), records SQL and params, and has a `committedInserts` list plus a `consumedAt`
field. Its fidelity rules:
- **(a)** The validation SELECT never returns `[]` after consumption. It returns the row with its current
  `consumed_at`, like Postgres.
- **(b)** The claim UPDATE is conditional only when both the `consumed_at IS NULL` and `expires_at > NOW()`
  predicates are present in the SQL. Otherwise it applies unconditionally.
- **(c)** Autocommit `pool.query` UPDATEs and INSERTs apply immediately. This models today's legacy path, so
  the RED run is honest.
- **(d)** In-transaction INSERTs become visible in `committedInserts` only on COMMIT. ROLLBACK discards them
  and any in-txn `consumed_at`.
- **(e)** `expireAtClaim` makes the code expired at claim time even though the validation read saw it live.

**Changed helper: `makeSpyPool`** (recon.md:75). An additive change makes it also record `params`. Existing
tests are unaffected. It is the source for the AC-4 login/refresh param checks, so no third fake is needed
(C-18). Domain dummy data stays local to the test file, because no identity fixture home exists
(recon.md:128, C-13).

**RED-then-GREEN tests (P-06).** The RED run is captured on today's code.

| Test | Asserts | RED on today's code |
|---|---|---|
| AC-1 | A 20-way `Promise.all` gives exactly 1 success and 19 × `16`. `committedInserts.length === 1`, and that insert's `client_id === 'oauthc_1'`. | 20 successes, 20 inserts |
| AC-3, `failInsert` | `13`, no tokens, `consumedAt === null`, 0 committed inserts | the UPDATE autocommits first |
| AC-3, `JWT_SECRET` unset | Save the var, delete it, restore it in `finally`. Asserts `13`, `consumedAt === null`, 0 inserts. | the UPDATE has autocommitted |
| Claim-time expiry (`expireAtClaim`) | `16`, 0 inserts | — |
| AC-4 first-party half | `aud` absent, and `client_id` param `params[3] === null`, for login and refresh | today's 3-param INSERT |

**Regression guards, green before and after.**
- **AC-2:** a sequential second redemption returns `16`.
- **AC-5:** for each of the 3 client/redirect/PKCE mismatches, `consumedAt` stays null, and a correct call
  afterwards succeeds.
- **AC-6:** an expired code returns `16` with 0 inserts.
- **AC-4 shared half, across all three tokens:**
  - claim keys `user_id`, `email`, `roles`, `issued_at`, `expires_at`;
  - `expires_at - issued_at === 900`;
  - the OAuth token has `aud === 'https://agent.example/mcp'`;
  - the OAuth `client_id` param equals the client id.
- **Existing exchange tests** (recon.md:115-118): unchanged and green. `makeSpyPool.connect()` returns a
  client closing over the same `queries`/`rows`, so the claim returns 1 row and the
  `INSERT INTO identity\.refresh_tokens[^)]*client_id` regex still matches.

**Run guard (fails.md:2223, recon.md:110-114).** It goes into the impl-spec verification step itself. It
requires:
- Node 24 (`ci.yml:185`);
- an assertion that `typeof IdentityServiceImpl === 'function'`;
- a non-zero executed-test count.

Overlap with feature 252: whichever lands second merges the other's `identityServiceImpl.test.ts` changes.

**Real-Postgres proof of AC-1.** The proof is the harness the `5bd271d` hotfix used: a manual 20-caller repro
against local Postgres (recon.md:103).
- `context.md` records the script verbatim, a single local command with the `DB_POOL_MAX=20` env override on
  a local process or compose run, and the before and after grant counts.
- It also carries this line: *"local only; never set DB_POOL_MAX for identity in .do/app*.yaml (direct :25060,
  budget 2)"* (F-06).
- The operator confirms in `context.md` that this recorded repro counts as the harness.

### 4. Other constraints

- **jscpd (`minTokens` 100).** If the `redeemAuthCode`/`rotateRefreshToken` transaction tail trips the check,
  stop and ask the user. There is no silent `withTransaction` extraction. The basis is CLAUDE.md "touch only
  what the task requires" plus C-18. A forced divergence during execute is logged per F-09 in the Deviation
  Log.
- **Accepted residual.** Only a lost COMMIT acknowledgement leaves the code consumed and a refresh row written
  while the caller sees `13`. `rotateRefreshToken` has the same residual.
- **Trace (C-03, operator standing decision 2026-10-21).** These paths make no outbound calls or emits
  (recon.md:96), so nothing needs propagating and no context is minted. Any audit emit added later must
  forward the inbound metadata via `ledgerAudit.ts` `PROPAGATED_HEADERS`.

## Rejected Alternatives

- **Mint after COMMIT** (proposal r2) — rejected because minting can throw (the `JWT_SECRET` getter, IDENTITY-1).
  A throw after COMMIT burns the code and leaves an orphan refresh row, which violates FR-2/AC-3. Minting first
  costs only discarded HMAC signs on the losing callers.
- **Mint inside `redeemAuthCode` before COMMIT** (via a callback or a returned pair) — rejected because it
  couples the transaction helper to JWT minting (C-18). Minting first in the handler closes FR-2 just as well
  and is simpler.
- **Delete the JS consumed/expiry early-outs** — rejected because it means rework, breaks existing tests
  (recon.md:116-117), and lets stale codes tie up identity's 2-connection pool.
- **Shared `withTransaction` helper** — rejected because it edits hotfix `5bd271d` code and widens the diff.
  It is a fallback only if jscpd forces it, and only after asking the user.
- **Single-statement CTE claim plus INSERT** — rejected because it departs from the `rotateRefreshToken`
  pattern, makes reusing `issueRefreshToken` awkward, and is harder to fault-inject.
- **`SELECT … FOR UPDATE`, then validation, then UPDATE** — rejected because probes and failed validations
  would hold a row lock and a pool connection.
- **Validation predicates in the claim `WHERE`** (recon.md:120, fork 1) — rejected because PKCE cannot be
  checked in SQL, a mismatch would look the same as "consumed" (weakening FR-5 tests), and it is a larger
  rewrite.
- **A committed opt-in real-Postgres test** (option b, recon.md:106) — rejected because it is a one-off
  per-feature DB rig (fails.md:2255, C-18).
- **A separate first-party mint helper** — rejected in favour of making `aud` optional on the existing helper
  (FR-6/FR-8, IDENTITY-4).
- **A third ad-hoc fake for the login/refresh param checks** — rejected in favour of an additive
  params-recording change on `makeSpyPool` (C-18).

## Open Risks

- [ ] **The fake proves ordering, not Postgres serialisation.** It proves ordering and transaction structure,
  not that Postgres serialises the conditional UPDATE. The AC-1 guarantee rests on a manual repro CI cannot
  re-run, and it is only meaningful if run with `DB_POOL_MAX` above 2. To be addressed at: the impl-spec
  exchangeAuthCode step (repro script and before/after counts recorded in context.md).
- [ ] **Overlap with feature 252.** Both touch `identityServiceImpl.test.ts`. Whichever lands second merges the
  other. Until 252 lands, the run guard is the only P-06 protection against a vacuously green suite. To be
  addressed at: every test step's verification, and the final integration PR.
- [ ] **Lost COMMIT acknowledgement.** The code is consumed and a refresh row exists, but the caller sees `13`.
  `rotateRefreshToken` has the same residual. Accepted, no step.
- [ ] **`JWT_SECRET`-unset test mutates `process.env`.** It must restore the value in `finally`, or later tests
  in the file may fail or leak. To be addressed at: the AC-3 test step.
- [ ] **jscpd may trip on the duplicated transaction tail.** The fallback touches hotfix code and needs a user
  gate. To be addressed at: the exchangeAuthCode step's pre-commit run.
- [ ] **Out of scope, flagged only:**
  - no `is_active` check on exchange (recon.md:124);
  - the different audience fallbacks `:507` vs `:535` (recon.md:125);
  - the hard-coded 60 s auth-code TTL `:459` (F-07).

  To be addressed at: none in this feature, so the operator should decide whether follow-up items are
  needed.
- [ ] **Stale context hints.** Teardown must re-anchor the IDENTITY-2/IDENTITY-4 line hints and re-check the
  "single-use" wording in `services/xstockstrat-identity/CLAUDE.md:38` (recon.md:126). To be addressed at: the
  teardown / context-constitution refresh step.

## Constitution Rules Touched

- `C-03` — honored by: the paths make no outbound calls or emits (recon.md:96), so nothing needs propagating
  and no fresh context is minted. The operator's standing 2026-10-21 trace directive is satisfied without
  any code change.
- `C-11` — honored by: `/sdd-story` (via triage) → `/sdd-review` → this full two-round `/sdd-design` ran before
  any code.
- `C-13` — honored by: no identity fixture home exists (recon.md:128). The new fake and its dummy rows stay
  local to the test file beside `makeTokenDb`.
- `C-15` — honored by: every test traces to an `@AC-*` in `acceptance.feature`. FR-6/FR-7 structural halves
  get an impl-spec grep step.
- `C-16` — honored by: see Business Rules Touched. Durable `user-management-ui.feature` scenarios are
  preserved.
- `C-18` — honored by: the approach reuses `rotateRefreshToken`'s shape and the unchanged `issueRefreshToken`,
  and generalises the one mint helper. It adds no `withTransaction` abstraction, no third fake and no
  one-off DB rig.
- `F-06` — honored: the `DB_POOL_MAX=20` override is local-only for the manual repro and is never set in
  `.do/app*.yaml`. Identity stays direct `:25060`, budget 2.
- `F-07` — honored: no new hardcoded values. The pre-existing 60 s TTL literal is flagged, not touched.
- `F-09` — honored: any execute-time divergence (for example a jscpd-forced extraction) goes to the Deviation
  Log, never into a step body.
- `P-02` — honored: the proposer and adversary saw only the orchestrator's synthesized state.
- `P-03` — honored: the harness gap was surfaced and resolved by an explicit option (a) choice, not a
  guess (recon.md:101-109).
- `P-04` — honored: the operator approved at the round-2 gate (2026-10-22). It is recorded in
  `feature.md` Status History and `context.md`.
- `P-06` — honored: the RED-then-GREEN test set is listed above. The run guard (Node 24, the impl-loaded
  assertion and a non-zero test count) goes into the impl-spec verification step.
- `IDENTITY-1` — honored: `JWT_SECRET` stays env-only. The mint-before-claim order exists because its getter
  throws.
- `IDENTITY-2` — honored: the hex code/refresh hashes and the base64url PKCE compare are moved unchanged.
- `IDENTITY-3` — honored: raw numeric `16`/`13`.
- `IDENTITY-4` — honored: OAuth tokens keep `aud` bound to the resource, with the `''` fallbacks preserved.
  Only first-party tokens omit `aud`.

## Business Rules Touched (C-16)

- **CHANGE** `265:@AC-1` "Concurrent exchanges of one authorization code yield exactly one grant" — altered
  guarantee: concurrency now yields exactly one grant (today: N). Signed off by the operator @ 2026-10-21/22
  in the D-23 scope decision ("Scope is D-23 auth-code half and D-21") and the round-2 gate approval
  (context.md).
- **PRESERVE** `265:@AC-2` "A consumed authorization code cannot be redeemed again" — not regressed by:
  the JS early-out is kept and the claim predicate backs it.
- **CHANGE** `265:@AC-3` "A failed refresh-token insert does not consume the authorization code" — altered
  guarantee: consume and INSERT are now atomic, and a mint failure consumes nothing. Signed off by the
  operator @ 2026-10-22 (D-23 scope plus the round-2 approval of mint-before-claim, context.md).
- **CHANGE** `265:@AC-4` "First-party login, first-party refresh and OAuth exchange issue tokens with the same
  claim shape and client tagging" — altered: first-party refresh rows carry an explicit NULL `client_id`
  through the shared INSERT, and first-party tokens are minted by the shared helper without `aud`. The
  observable claim keys and TTL are preserved. Signed off by the operator @ 2026-10-21/22 in the D-21 scope
  decision (context.md).
- **PRESERVE** `265:@AC-5` "A request that fails client, redirect or PKCE validation does not consume the
  code" — not regressed by: validation still runs before the claim (Phase A unchanged).
- **PRESERVE** `265:@AC-6` "An expired authorization code cannot be redeemed" — not regressed by: the JS
  expiry early-out is kept, and `expires_at > NOW()` sits in the claim.
- **PRESERVE** `@AC-2`..`@AC-6` (`services/xstockstrat-identity/acceptance/user-management-ui.feature`:
  create-then-sign-in, password reset, role assign/remove, deactivate blocks login, reactivate)
  (recon.md:79-83) — not regressed by: the `is_active` SELECT, `isBlockedDefaultAdmin`, bcrypt and the
  roles passthrough in `authenticateUser` are untouched. Only the mint and refresh-issue lines move onto
  the shared helpers.
