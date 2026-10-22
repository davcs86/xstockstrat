# Context Log: fix-identity-auth-code-race

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-identity-auth-code-race-defect.md` (Issues disabled),
  sidecar `triaged` / `ref: feature:265-fix-identity-auth-code-race`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-23
  (auth-code single-use half only; flagged security) and D-21 (mint/refresh duplication).
- Severity: SEV-2 (group; D-21 alone was rated lower by the surveyor). Impact type: auth-code-replay.
  Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md.
- Affected services: xstockstrat-identity.
- Root cause hypothesis: `ExchangeAuthCode` is read-validate-write over independent autocommit queries; hotfix
  `5bd271d` fixed the identical refresh race only.
- **Re-verification against a053b0e (scan predates `5bd271d`, which is not an ancestor of 4535695):**
  - D-23 refresh half — **excluded, no longer reproduces**: `refreshToken` (`:230-268`) and `refreshOAuthToken`
    (`:524-543`) both call `rotateRefreshToken` (`:340-370`, conditional claim + same-txn insert). Report
    `2026-10-19-identity-refresh-rotation-not-atomic-defect` is `resolved` (`ref: hotfix:hotfix/fix-refresh-token-rotation`).
  - D-23 auth-code half — **reproduces**: SELECT `:481-488`, JS check `:491`, unconditional UPDATE `:503-506`,
    separate refresh INSERT `:511` (scan cited `:461-482`; drift from `5bd271d` adding `issueRefreshToken`/`rotateRefreshToken`).
  - D-21 — **partially reproduces, narrowed**: the duplicated refresh SELECT (scan `:234-238`, `:505-509`) is gone.
    Residual: inline claim build + `jwt.sign` at `:166-176` and `:243-249` beside `mintOAuthAccessToken` `:295-315`
    (3 sign sites total); inline refresh hash+INSERT at `:178-185` beside `issueRefreshToken` `:321-334` (2 INSERT
    sites, was 3). The scan's "D-23's fix must land in both paths" no longer applies (one auth-code path); D-21 is
    kept so the D-23 fix reuses a single issue helper that first-party login also uses. Operator may drop D-21
    (AC-4) at design if it reads as an unrelated refactor.
- **Overlaps:** `252-fix-identity-ledger-test-suites` (implementation-ready) — the identity unit suite
  (`src/__tests__/identityServiceImpl.test.ts`) currently early-returns on a failed lazy import, so new
  impl-level tests silently pass until 252 lands; sequence 252 first or prove the new tests execute (P-06). AC-1
  needs a real-Postgres harness (the `5bd271d` hotfix used one). `242-fix-push-untargeted-broadcast` mentions
  `identityServiceImpl` (admin directory) — textual merge risk only.
- Design forks to settle: whether to consume the code before or after the redirect/client/PKCE checks (consume-first
  burns a code on a bad verifier — RFC-permitted, but an attacker with only the code could then deny the legit
  client); same-transaction consume + refresh INSERT (AC-3) vs consume-only.
- Recommended design depth: quick → `/sdd-design fix-identity-auth-code-race quick` (rationale: SEV-2, single
  service, no proto/migration/config, clear root cause with a proven sibling fix pattern).
- Development branch: feature/fix-identity-auth-code-race

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - FR-1 vs FR-5 tension (validate-before-consume needs a read of the stored row). **Resolved**: FR-1 now allows a
    validation read before the claim (or the predicates inside the claim); only the claim's row count decides redemption.
  - FR-8 / AC-4 silent on an empty audience. **Resolved**: FR-8 now states an OAuth token with no resource keeps
    today's `aud: ''`, first-party tokens carry no `aud`, so the shared helper's `aud` is optional.
  - FR-6 site set. **Resolved**: FR-6 now names the four sites, including `refreshOAuthToken` (intentionally in the
    shared-helper set; it already calls `mintOAuthAccessToken`).
  - Test harness, fault-injection mechanism and the 252 early-return dependency are deferred to design. Partly
    resolved: the spec now links `252-fix-identity-ledger-test-suites`; harness + mechanism remain for `/sdd-design`.
  - FR-6/FR-7 structural halves are grep/code-review verified, not scenario verified. Open: the impl-spec must carry the grep step.
  - AC-3's Given names a fault-injection detail. Accepted as written (Then steps are observable).
  - The task prompt gave a doubled feature path. Noted; the review ran against `docs/roadmap/features/265-fix-identity-auth-code-race/`.
- Overlap findings (WARN, no FAIL):
  - [file] `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`: 265's real-Postgres race and
    fault-injection tests vs 252's impl `before()` try/catch (`:28-40`, 252 Step 3) and rotation revoke assertion
    (`:403-417`). 252 `implementation-spec.md:95` says whichever lands second merges the other's changes. Textual only.
  - [file] `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`: 265 `exchangeAuthCode` `:474-518` and
    helpers `mintOAuthAccessToken` `:295`, `issueRefreshToken` `:321`, `rotateRefreshToken` `:340` vs 252
    `implementation-spec.md:220-254` (transient mutation and restore of the `refreshOAuthToken` revoke `:524-527` and
    the #1262 `AND rt.revoked_at IS NULL` line in `rotateRefreshToken`). Adjacent, disjoint blocks; rebase-level risk.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-23 auth-code half and D-21; refresh rotation already fixed by hotfix 5bd271d.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Next: `/sdd-design fix-identity-auth-code-race`.

## Session 2026-10-22 — sdd-batch design gate (round 2)

`/sdd-design fix-identity-auth-code-race` (full debate) is halted at its approval gate after round 2 (gate policy:
halt). design.md is not written and status.md is unchanged (`spec-ready`).

### Open Threads

- **Approach (round-2 synthesis):** two files only (`identityServiceImpl.ts`, `identityServiceImpl.test.ts`); no
  proto/migration/config; hotfix 5bd271d `rotateRefreshToken` untouched.
  - D-23: `exchangeAuthCode` keeps its validation lines (SELECT, JS consumed/expiry early-outs, redirect/client,
    PKCE) as reject-only pre-filters. Then: compute audience → `mintAccessToken` (before the claim, so a mint throw
    returns `13` with nothing consumed) → new private `redeemAuthCode` (BEGIN; conditional `UPDATE ... WHERE
    consumed_at IS NULL AND expires_at > NOW() RETURNING`; 0 rows → ROLLBACK, `16`; `issueRefreshToken` in-tx →
    COMMIT) → return tokens only after COMMIT. The claim predicates are load-bearing; never drop them as redundant.
  - D-21: rename `mintOAuthAccessToken` → `mintAccessToken(userId, email, roles, audience?)` (`aud` only when given);
    `authenticateUser` and `refreshToken` reuse it plus `issueRefreshToken` (first-party rows store `client_id NULL`).
  - Tests: local `makeAuthCodeDb` fake with fidelity rules (a)-(e); additive params recording on `makeSpyPool`.
    RED-then-GREEN: AC-1 (20-way race), AC-3 (failInsert and `JWT_SECRET` unset), claim-time expiry, AC-4
    first-party half. Regression guards: AC-2, AC-5, AC-6, AC-4 shared half, existing exchange tests. Run guard
    (fails.md:2223) goes into the impl-spec verification step. AC-1 real-Postgres proof is a manual local
    20-caller repro (`DB_POOL_MAX=20` local only; never in `.do/app*.yaml`).
- **Strongest open objection (blocking):** the proposer must confirm the mint-before-claim order. Proposal r2 minted
  after COMMIT, but the `jwtSecret` getter (`identityServiceImpl.ts:112-116`) throws when `JWT_SECRET` is unset, so
  a post-COMMIT throw would burn the code and leave an orphan refresh row (breaks FR-2/AC-3). Stays blocking until
  the proposer confirms or the operator explicitly waives it. Six non-blocking refinements are in the state block.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes:** none. AC-1, AC-3, AC-4 are CHANGEs, all covered by the operator's D-23/D-21 scope;
  AC-2, AC-5, AC-6 and the durable user-management-ui @AC-2..@AC-6 are PRESERVE.
- **Resume:** the next `/sdd-batch` run resumes the debate from the state block below (round 3).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. It starts from proposal r2, which confirmed every round-1 synthesis point, and folds in the adversary's r2 fixes. I checked the key claim against the code: the `jwtSecret` getter at `identityServiceImpl.ts:112-116` reads `process.env.JWT_SECRET` and throws when it is unset, so minting can fail. Two files change: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` and `src/__tests__/identityServiceImpl.test.ts`. There are no proto, migration or config changes. `rotateRefreshToken` (hotfix 5bd271d, `:340-374`) is not touched.\n\n**1. D-23: `exchangeAuthCode` (`:474-518`) in two phases**\n\n**Phase A: the existing validation lines stay as they are**\n- Kept: the pool SELECT (`:481-488`), the not-found exit (`:489`), the JS `consumed_at`/expiry early-outs (`:491-494`), the redirect/client check (`:495-497`) and the PKCE base64url compare (`:499-502`).\n- The early-outs can only reject. A grant comes only from the claim's row count.\n- `context.md` records this reading of FR-1. It also states that the claim's `consumed_at IS NULL` and `expires_at > NOW()` predicates are load-bearing and must not be removed as \"redundant with the JS checks\". The JS checks are best-effort pre-filters on a stale read.\n\n**Phase B: replaces only `:503-511`, in this order (changed this round)**\n1. Compute `audience = resource || row.resource || ''`. This is today's `:507`, unchanged.\n2. Call `mintAccessToken(row.user_id, row.email, row.roles ?? [], audience)` BEFORE the claim transaction. Minting is CPU-only. If it throws (for example `JWT_SECRET` is unset), the existing catch returns `13`, nothing is consumed and no row is written. That honours FR-2/AC-3 for mint failures too. The 19 losing racers each sign one token and throw it away; it is never returned.\n3. Call a new private `redeemAuthCode(codeHash, userId, clientId): Promise<string | null>`. It copies `rotateRefreshToken`'s structure line for line:\n   - `pool.connect()`, then `BEGIN`.\n   - `UPDATE identity.oauth_auth_codes SET consumed_at = NOW() WHERE code = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING code`.\n   - Zero rows: `ROLLBACK`, then return null. The handler maps null to `16 invalid_grant`.\n   - `issueRefreshToken(userId, clientId, client)` (`:321-334`, unchanged), then `COMMIT`, then return the refresh token.\n   - On a throw: `ROLLBACK().catch(() => undefined)`, then rethrow. The handler maps it to `13`.\n   - `release()` runs in `finally`.\n4. The handler returns `{accessToken, tokenType: 'Bearer', expiresIn, refreshToken}` only after `redeemAuthCode` returns non-null. That is after COMMIT, so no token reaches a caller before the claim is durable.\n- The raw numeric codes 16 and 13 stay (IDENTITY-3).\n\n**2. D-21: one mint helper and one refresh-issue helper**\n- Rename `mintOAuthAccessToken` (`:295-315`) to `mintAccessToken(userId, email, roles, audience?)`.\n  - It writes `aud` only when `audience !== undefined`.\n  - It keeps `roles ?? []` and the same `{ expiresIn: this.accessTtlSeconds }` sign option.\n  - It returns `{ accessToken, expiresIn, issuedAt, expiresAt }`, with `issuedAt`/`expiresAt` in epoch seconds.\n  - The OAuth call sites keep passing their `''` fallbacks (`:507`, `:535`).\n- `authenticateUser`: replace only `:163-185` with `mintAccessToken(user.user_id, email, user.roles)` (no audience) plus `issueRefreshToken(user.user_id)`.\n  - Mint-then-insert order is unchanged from today.\n  - `secondsToDate` and `claims` read the returned values.\n- `refreshToken`: replace only `:243-249` the same way.\n- The `is_active` SELECT, `isBlockedDefaultAdmin`, bcrypt and `rotateRefreshToken(tokenHash, false)` (`:236`) are not touched.\n- First-party refresh rows now store `client_id = NULL` explicitly. Migration 004 (`:8-10`) declares the column nullable.\n- A structural grep in the impl-spec confirms no inline `jwt.sign` remains outside the helper.\n\n**3. Test harness, option (a)**\n\n**`makeAuthCodeDb(row, {failInsert?, expireAtClaim?})`**\n- Local to the test file, next to `makeTokenDb` (`test.ts:407-442`), and it records params.\n- Fidelity rules (a)-(e), as in proposal r2, are written into design.md:\n  - (a) The SELECT never returns `[]` after consumption.\n  - (b) The claim is conditional only if both predicates are present.\n  - (c) Autocommit `pool.query` UPDATE and INSERT apply immediately, which models the legacy path.\n  - (d) In-transaction INSERTs become visible only on COMMIT, and ROLLBACK discards them.\n  - (e) `expireAtClaim` makes the code expired at claim time even though the validation read sees it as live.\n\n**`makeSpyPool` (`test.ts:260-272`)**\n- Additive change: it also pushes `params`. Existing tests are unaffected.\n- It is used for the AC-4 login/refresh param checks, so no third fake is needed (C-18).\n\n**RED-then-GREEN (P-06): the RED run is captured on today's code**\n- **AC-1:** a 20-way `Promise.all` gives exactly 1 success, 19 calls return `16`, `committedInserts.length === 1`, and that insert's `client_id === 'oauthc_1'`. On today's code: 20 successes and 20 inserts.\n- **AC-3:** `failInsert` gives `13`, no tokens, `consumedAt === null` and 0 committed inserts.\n  - Also new: with `JWT_SECRET` unset (save it, delete it, restore it in `finally`), the call returns `13`, `consumedAt === null` and 0 inserts. On today's code the UPDATE has already autocommitted, so `consumedAt` is set and the test is RED.\n- **Claim-time expiry:** returns `16` with 0 inserts.\n- **AC-4 first-party half:** `aud` is absent and the `client_id` param (`params[3]`) is `null` for login and refresh. Today's 3-param INSERT at `:181-185` makes this RED.\n\n**Regression guards: green before and after**\n- **AC-2:** a sequential second call returns `16`.\n- **AC-5:** for each of the 3 mismatches, `consumedAt` stays null, and a correct call afterwards succeeds.\n- **AC-6:** an expired code returns `16` with 0 inserts.\n- **AC-4 shared half, across all three tokens:**\n  - the claim keys `user_id`, `email`, `roles`, `issued_at`, `expires_at`;\n  - `expires_at - issued_at === 900`;\n  - the OAuth token has `aud === 'https://agent.example/mcp'`;\n  - the OAuth `client_id` param equals the client id.\n- **Existing exchange tests (`test.ts:339-402`):** unchanged and green. Verified: `makeSpyPool.connect()` returns a client that closes over the same `queries`/`rows`, so the claim returns 1 row and the INSERT still matches the `:354` regex.\n\n**Run guard (fails.md:2223)**\n- Node 24 (`ci.yml:185`), `typeof IdentityServiceImpl === 'function'`, and a non-zero executed-test count.\n- These go into the impl-spec verification step itself, not only into design.md.\n- Merge with feature 252, whichever lands second.\n\n**Real-Postgres proof of AC-1**\n- design.md names the manual 20-caller repro as \"the harness the 5bd271d hotfix used\".\n- `context.md` holds the script verbatim and a single local command, with the `DB_POOL_MAX=20` env override on a local process or compose run.\n- It carries an explicit line: \"local only; never set DB_POOL_MAX for identity in .do/app*.yaml (direct :25060, budget 2)\".\n- It records the before and after counts.\n- The operator confirms in `context.md` that this recorded repro counts as the harness.\n\n**Other notes for design.md**\n- **jscpd** (`minTokens` 100): if the `redeemAuthCode`/`rotateRefreshToken` tail trips the check, stop and ask the user. There is no silent `withTransaction` extraction. The basis is CLAUDE.md \"touch only what the task requires\" plus C-18. If a change is forced during execute, it is logged per F-09 in the Deviation Log.\n- **Accepted residual, now narrowed:** only a lost COMMIT acknowledgement leaves the code consumed and a refresh row written while the caller sees `13`. That is the same residual `rotateRefreshToken` has (`:366`).\n- **Trace:** these paths make no outbound calls or emits, so the C-03 directive has nothing to apply to and no context is minted.",
    "open_objections": [
      {
        "text": "[FR-2 / C-15] The next proposer must confirm the synthesis's mint-before-claim order. Proposal r2 minted after COMMIT, but `mintAccessToken` can throw (`jwtSecret` getter, `identityServiceImpl.ts:112-116`). That throw would land after the code was consumed and an orphan refresh row was committed, which breaks FR-2 and AC-3. The synthesis order is: compute audience, then mint, then `redeemAuthCode` (claim, INSERT, COMMIT), then return the tokens. Its added RED test runs with `JWT_SECRET` unset and checks for 13, `consumedAt` null and 0 inserts. Proposal r2 did not answer this point, so it stays blocking until confirmed or explicitly waived by the operator.",
        "blocking": true
      },
      {
        "text": "[P-06] Move AC-4's first-party assertions (`aud` absent, `client_id` param `params[3] === null`) to RED-then-GREEN and capture the RED run. Today's first-party INSERT (`:181-185`) has only 3 params, so these assertions fail before the fix. The proposal had labelled them green before and after.",
        "blocking": false
      },
      {
        "text": "[C-18 / DRY] Make `makeSpyPool` (`test.ts:260-272`) record params alongside the SQL. This is an additive change. It is the source for the AC-4 login and refresh param checks, which avoids a third ad-hoc fake.",
        "blocking": false
      },
      {
        "text": "[F-06 hygiene] Write the context.md repro as a single local command with `DB_POOL_MAX=20` set as an env override. Add an explicit line that the override must never be set in `.do/app*.yaml` (identity is direct `:25060` with a budget of 2).",
        "blocking": false
      },
      {
        "text": "[Citation] Re-cite the jscpd stop-and-ask rule. Its basis is CLAUDE.md 'touch only what the task requires' plus C-18. F-09 governs only how a forced divergence is logged during execute (Deviation Log); it does not set refactoring scope.",
        "blocking": false
      },
      {
        "text": "[FR-1 record] context.md must say explicitly that the claim predicates `consumed_at IS NULL` and `expires_at > NOW()` are load-bearing and cannot be dropped as redundant with the JS early-outs. AC-2 and AC-6 pass through the early-outs. Only AC-1's losing callers and the `expireAtClaim` test exercise the claim predicates.",
        "blocking": false
      },
      {
        "text": "[Ledger] Put the fails.md:2223 run guard (Node 24, `typeof IdentityServiceImpl === 'function'`, a non-zero executed-test count) into the impl-spec verification step itself, not only into design.md.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "265:@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "265:@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "265:@AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "265:@AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "265:@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "265:@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "user-management-ui:@AC-2..@AC-6 (authenticateUser is_active / default-admin guard / roles passthrough)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Mint after COMMIT (proposal r2). Lost because minting can throw (the `JWT_SECRET` getter, `:112-116`). A throw after COMMIT burns the code and leaves an orphan refresh row, which violates FR-2/AC-3. Minting first costs only discarded HMAC signs on the losing callers.",
      "Mint inside `redeemAuthCode` before COMMIT, via a callback or by returning the pair. Lost because it couples the transaction helper to JWT minting (C-18). Minting first in the handler closes FR-2 just as well and is simpler.",
      "Delete the JS consumed/expiry early-outs. Lost because it means rework, breaks existing tests (`:339-355`, `:371-391`), and lets stale codes tie up identity's 2-connection pool.",
      "Shared `withTransaction` helper. Lost because it edits hotfix 5bd271d code and widens the diff. It is used only if jscpd forces it, and only after asking the user.",
      "Single-statement CTE claim plus INSERT. Lost because it departs from the `rotateRefreshToken` pattern, makes reusing `issueRefreshToken` awkward, and is harder to fault-inject.",
      "SELECT ... FOR UPDATE, then validation, then UPDATE. Lost because probes and failed validations would hold a row lock and a pool connection.",
      "Validation predicates in the claim WHERE clause. Lost because PKCE cannot be checked in SQL, a mismatch would look the same as 'consumed' (weakening FR-5 tests), and it is a larger rewrite.",
      "A committed opt-in real-Postgres test (option b). Lost because it is a one-off per-feature DB rig (fails.md:2255).",
      "A separate first-party mint helper. Lost to making `aud` optional on the existing helper (FR-6/FR-8, IDENTITY-4).",
      "A third ad-hoc fake for the login/refresh param checks. Lost to an additive params-recording change on `makeSpyPool` (C-18)."
    ],
    "open_risks": [
      "The fake proves ordering and transaction structure, not that Postgres serialises the conditional UPDATE. The AC-1 guarantee rests on a manual repro that CI cannot re-run. Its value depends on the script in context.md being run with `DB_POOL_MAX` above 2.",
      "Overlap with feature 252 on `identityServiceImpl.test.ts`: whichever lands second merges the other. Until then the run guard is the only P-06 protection against a vacuously green suite.",
      "Lost COMMIT acknowledgement: the code is consumed and a refresh row exists, but the caller sees 13. `rotateRefreshToken` has the same residual. Accepted.",
      "The `JWT_SECRET`-unset test mutates `process.env`. It must restore the value in `finally`, or later tests in the file may fail or leak.",
      "jscpd may trip on the duplicated transaction tail. The fallback touches hotfix code and needs a user gate.",
      "Out of scope and flagged only: no `is_active` check on exchange, the different audience fallbacks (`:507` vs `:535`), and the hard-coded 60 s auth-code TTL (`:459`, F-07).",
      "Teardown must re-anchor the IDENTITY-2 and IDENTITY-4 line hints and re-check the 'single-use' wording in identity's CLAUDE.md."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-06",
      "F-07",
      "F-09",
      "P-02",
      "P-03",
      "P-04",
      "P-06",
      "IDENTITY-1",
      "IDENTITY-2",
      "IDENTITY-3",
      "IDENTITY-4"
    ],
    "rationale": "Proposal r2 concretely answered both round-1 blocking objections, so both are closed:\n- **Fake fidelity:** rules (a)-(e) are spelled out, and each test is labelled RED-then-GREEN or regression guard.\n- **Keep the early-outs:** confirmed, with the FR-1 reading recorded in `context.md`.\n\nThe adversary found no Floor breach.\n\n**The new blocking issue is real.** I checked it against the code: the `jwtSecret` getter at `:112-116` throws when `JWT_SECRET` is unset. Minting after COMMIT would therefore let a failure land after the claim is durable, which breaks FR-2's \"anything after the claim fails → rollback\" and AC-3's guarantee. The synthesis adopts the cheapest fix that adds no new abstraction: mint before the claim transaction, and still return tokens only after COMMIT. This narrows the accepted residual to a lost COMMIT acknowledgement, which matches `rotateRefreshToken`. It stays blocking only because the proposer has not yet confirmed it.\n\n**The smaller fixes follow the user's binding \"preserve as much as you can while having low rework\":**\n- AC-4's first-party checks become RED-then-GREEN, which is more honest evidence.\n- `makeSpyPool` gains params recording instead of a third fake.\n- The `DB_POOL_MAX` override is limited to a local run.\n- The jscpd rule is re-cited.\n\nHotfix code, the validation lines and the existing tests all stay untouched.\n\n**Business-rule impact:**\n- AC-1 (concurrency) and AC-3 (rollback) are CHANGEs covered by the operator's D-23 scope.\n- AC-4 is now marked CHANGE, covered by the D-21 scope. First-party refresh rows now carry an explicit NULL `client_id` through the shared INSERT, and tokens drop the `aud` key. Its observable claims (keys, TTL) are preserved.\n- Everything else is PRESERVE, including the durable user-management-ui scenarios.\n\nC-03 does not apply, because these paths make no outbound calls or emits."
  },
  "floor_breaches": []
}
```
