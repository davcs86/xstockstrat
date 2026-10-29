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

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-identity; key reuse patterns: `rotateRefreshToken`
  conditional claim + same-txn `issueRefreshToken`; generalise `mintOAuthAccessToken`).
- Phase 1 Grilling: 2 rounds (full); termination: approved. Chosen approach: keep `exchangeAuthCode`'s validation
  as reject-only pre-filters, then compute audience → `mintAccessToken` → new private `redeemAuthCode` (BEGIN;
  conditional `UPDATE … WHERE consumed_at IS NULL AND expires_at > NOW() RETURNING`; `issueRefreshToken` in-txn;
  COMMIT) → return tokens after COMMIT; D-21 renames the mint helper to `mintAccessToken(…, audience?)` and routes
  `authenticateUser`/`refreshToken` through it and `issueRefreshToken`. Rejected: mint after COMMIT, mint inside the
  txn helper, deleting the JS early-outs, `withTransaction`, CTE claim, `FOR UPDATE`, predicates-in-WHERE, committed
  real-PG test, separate first-party mint helper, a third test fake.
- Operator decision 2026-10-22 (design gate r2): APPROVED as synthesized, including the mint-before-claim order with
  the RED test that runs with `JWT_SECRET` unset and asserts code 13, `consumedAt` null and 0 inserts. This closes
  the round-2 blocking objection.
- FR-1 reading (recorded per design): the JS consumed/expiry early-outs are best-effort pre-filters on a stale read
  and can only reject; only the claim's row count grants. The claim predicates `consumed_at IS NULL` and
  `expires_at > NOW()` are load-bearing — never drop them as "redundant with the JS checks".
- AC-1 real-Postgres proof: the harness is the manual 20-caller local repro (the one hotfix `5bd271d` used). At
  execute, record here the script verbatim, a single local command with the `DB_POOL_MAX=20` env override, and the
  before/after grant counts. Local only; never set DB_POOL_MAX for identity in .do/app*.yaml (direct :25060,
  budget 2). The operator confirms here that the recorded repro counts as the harness.
- Constitution rules touched: C-03, C-11, C-13, C-15, C-16, C-18, F-06, F-07, F-09, P-02, P-03, P-04, P-06,
  IDENTITY-1..4. Floor breaches: none.
- Business rules: CHANGE 265:@AC-1, @AC-3 (D-23 scope + r2 approval), @AC-4 (D-21 scope); PRESERVE 265:@AC-2,
  @AC-5, @AC-6 and durable `user-management-ui.feature` @AC-2..@AC-6.
- Status: spec-ready → design-approved.

### Open Threads

- Fake proves ordering/txn structure, not Postgres serialisation; AC-1 rests on the manual repro run with
  `DB_POOL_MAX` > 2 — target: impl-spec exchangeAuthCode step (repro + counts recorded here).
- Overlap with 252 on `identityServiceImpl.test.ts` (whichever lands second merges); until then the run guard
  (Node 24, `typeof IdentityServiceImpl === 'function'`, non-zero executed-test count) is the only P-06 protection —
  target: every test step's verification + final integration PR.
- Lost COMMIT acknowledgement residual (code consumed, refresh row written, caller sees 13) — same as
  `rotateRefreshToken`; accepted, no step.
- `JWT_SECRET`-unset test mutates `process.env`; must restore in `finally` — target: AC-3 test step.
- jscpd may trip on the duplicated transaction tail; fallback touches hotfix code — stop and ask the user —
  target: exchangeAuthCode step pre-commit.
- Out of scope, flagged only: no `is_active` check on exchange; audience fallbacks `:507` vs `:535`; hard-coded
  60 s auth-code TTL `:459` (F-07) — target: none here; operator to decide on follow-ups.
- Teardown: re-anchor IDENTITY-2/IDENTITY-4 line hints and re-check the "single-use" wording in
  `services/xstockstrat-identity/CLAUDE.md:38` — target: teardown / context-constitution refresh step.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status → implementation-ready.
  - Step 1 [service] D-23 `exchangeAuthCode` Phase B plus the new `redeemAuthCode`.
  - Step 2 [test] AC-1/2/3/5/6.
  - Step 3 [service] D-21 `mintAccessToken` plus first-party routing.
  - Step 4 [test] AC-4 plus the FR-6/FR-7 structural grep.
  - Step 5 [test] the manual real-PG AC-1 repro.
  - Step 6 [docs] teardown refresh of IDENTITY-1/2/4.
- Key codebase findings:
  - Recon's line map re-verified on `origin/feature/fix-identity-auth-code-race` @ 481d4742:
    - `exchangeAuthCode` `:474-518`, unconditional UPDATE `:503-506`, pool-level `issueRefreshToken` `:511`;
    - `mintOAuthAccessToken` `:295-315`, `issueRefreshToken` `:321-334`, `rotateRefreshToken` `:340-374`;
    - `jwtSecret` getter `:112-119`;
    - `jwt.sign` sites `:174`, `:247`, `:311`; refresh INSERT sites `:182`, `:329`.
  - **Evidence-route finding (beyond design.md).** Design's run guard assumed Node 24 strip-types loads the impl
    (fails.md:2223). Feature 252's product spec (`252 product-spec.md:12-22`) says the `../grpc/*.js` import fails on
    Node 24 too (`ERR_MODULE_NOT_FOUND`). 252 has not landed: `package.json` `test` is unchanged on
    `origin/main-dev` and on `origin/feature/fix-identity-ledger-test-suites`.
    - The spec therefore takes RED/GREEN evidence from the compiled run that fails.md:2223's own rule prescribes:
      `tsc` src plus tests into the git-ignored `.verify/dist/`, then `node --test --test-reporter=tap`, with the TAP
      reporter pinned per fails.md:2991.
    - The design's run guard (Node 24, `typeof IdentityServiceImpl === 'function'`, non-zero test count) sits
      inside that run.
    - `pnpm run test:coverage` stays as CI parity only.
    - No `package.json`/`tsconfig.json` change, because that is 252's scope.
  - AC-4's RED discriminator is first-party **login** only: today's 3-param INSERT leaves `params[3]` undefined.
    First-party refresh already writes `client_id` NULL via `issueRefreshToken`, and no first-party token carries
    `aud` today, so those assertions are guards. The claim-time-expiry test is also RED on today's code, because
    the unconditional UPDATE succeeds.
  - Login fixture: reuse the exported `SEED_ADMIN_PASSWORD_HASH` (password `'admin'`, accepted when `APPLICATION_ENV`
    is not production), so no new bcrypt dependency is needed. The new D-23 tests reuse `storedRow`/`exchangeCall`
    inside `describe('exchangeAuthCode')` (C-13 single consumer). No `src/__tests__/fixtures/` home exists.
  - The jscpd guard rail is report-only outside `xstockstrat-ui` (`.husky/pre-commit` step 3), so the
    `redeemAuthCode`/`rotateRefreshToken` stop-and-ask is a manual inspection of the
    `DUP_REPORT_ONLY=1 scripts/check-duplication.sh` report in Step 1.
  - Step 6 is not only line drift. IDENTITY-4 names `#mintOAuthAccessToken`, which Step 3 renames to
    `mintAccessToken`.
- Open-risk coverage:
  - Fake versus Postgres serialisation → Step 5.
  - 252 overlap → Step Dependencies plus every test step's compiled-run guard.
  - `JWT_SECRET` restore → Step 2.
  - jscpd → Step 1.
  - Stale context hints → Step 6.
  - Lost COMMIT acknowledgement → accepted, no step.
  - Out-of-scope asymmetries (`is_active` on exchange, `:507` vs `:535` fallbacks, 60 s TTL) → not stepped. The
    operator decides whether follow-ups are needed.
- Next: `/sdd-review fix-identity-auth-code-race impl-spec`.

## Session 2026-10-22 — sdd-review impl-spec

- Result: 0 failures, 6 warnings, overlap WARN (3 file collisions). This review is advisory, so lifecycle stays
  `implementation-ready`.
- Addressed:
  - Step 4 Verification now states the coverage threshold (`c8 --lines 40`, line coverage >= 40%). Re-verified
    against `services/xstockstrat-identity/package.json:13`.
- Accepted as is (verified, no edit needed):
  - Steps 1 and 3 have no test command of their own. GREEN comes from the paired Steps 2 and 4 (C-08 pairing in
    Step Dependencies), and each step still runs `pnpm run lint`.
  - The line hints in `identityServiceImpl.ts` and the test file resolve. The stale Step 6 hints are already
    flagged in the spec.
  - C-18: `redeemAuthCode` mirrors `rotateRefreshToken` under the jscpd stop-and-ask guard, with no speculative
    `withTransaction` extraction.

### Open Threads

- Step 5 (P-03): the AC-1 real-Postgres 20-caller repro is manual and cannot be machine-asserted. At the
  `/sdd-execute` checkpoint, the operator must confirm that this recorded repro counts as the AC-1 harness, and the
  before/after counts must be logged here. — [ ] unaddressed
- Step 2: RED/GREEN depends on the scratch `tsc` compile until feature 252 lands, and `tsc` emits even when there
  are type errors. Log the diagnostics in this file on each run. — [ ] unaddressed
- Overlap with `252-fix-identity-ledger-test-suites` Step 3 on `src/__tests__/identityServiceImpl.test.ts`: 252
  removes the `before()` guard (:28-40, lazy import :30) that 265 relies on as its skip guard. Whichever feature
  lands second merges the other's changes and re-checks the guard semantics. — [ ] unaddressed
- Overlap with `242-fix-push-untargeted-broadcast` on `src/grpc/identityServiceImpl.ts`: 242 adds an import at :9
  and a method after `setUserActive`. The blocks don't overlap, so the only risk is a textual rebase conflict.
  — [ ] unaddressed
- `#1262 hotfix/fix-refresh-token-rotation` also touches both identity files. Before Step 1, check whether
  `rotateRefreshToken` (:340-374, hotfix 5bd271d) is on `main-dev`, and re-anchor the line hints if it is not.
  — [ ] unaddressed

## Session 2026-10-29 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: merged `origin/main-dev` into `feature/fix-identity-auth-code-race` (normal merge). One conflict,
  `docs/roadmap/ledger/insights.md`, resolved by keeping both sides (base first). `ledger-guard --fix`: clean.
- Re-spec of step bodies against the current codebase:
  - Steps 1 and 3: no mismatch; every `identityServiceImpl.ts` anchor resolves as cited. Left unchanged.
  - Steps 2 and 4: feature 252 rewrote `src/__tests__/identityServiceImpl.test.ts`. All test-file anchors
    re-pointed (`makeTokenDb` :374-409, `describe('exchangeAuthCode')` :282, `makeSpyPool` :235-247,
    `describe('refreshOAuthToken')` :445-471, `APPLICATION_ENV` precedent :125-140, seed-hash import :11/:19).
    Step 2 Instruction 4 inverted: the file has no `if (!impl) return;` guards now, so the new tests add none.
    Verification switched from the scratch `.verify` tsc route to `pnpm test` (`package.json:12`), which is now
    real RED/GREEN evidence. Step 4 Evidence notes `routePool` (:701-712) records params but has no `connect()`,
    so extending `makeSpyPool` stays the choice.
  - Step 5: `issueAuthCode` :439. No Postgres on `localhost:5432` here and this run may not start one, so the
    BEFORE/AFTER repro goes to the operator (the spec's stop-and-ask path).
  - Step 6: identity `CLAUDE.md` anchor is :37-38.
- Not edited (outside step bodies): the Execution Summary at `implementation-spec.md:36` still describes the
  pre-252 compiled-run guard; the Step 2/4 bodies supersede it.
- Open Thread "Step 2: RED/GREEN depends on the scratch tsc compile until feature 252 lands" — addressed by this
  re-spec (252 landed). Overlap thread with 252 — addressed (merged; guards gone).

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)

- Mode: `sequential` (one commit per step on `feature/fix-identity-auth-code-race`, single integration PR at end).
- Up-front confirmation: operator approved the up-front plan by standing authorization — operator chat
  2026-10-28/29 (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute;
  unattended checkpoints, auto-confirm C-16 promotion, merge-train authorized, defer 255/275; operator-only
  DB/prod steps: open PR, hold merge; blocker decisions 2026-10-29 recorded per feature; checkpoints "report",
  C-16 promotion auto-confirmed unless it changes an existing @AC rule.
- Lifecycle: `implementation-ready` → `in-progress`.
- Known operator-only item: Step 5 (real-Postgres AC-1 repro) needs a local Postgres, which this run may not start;
  it goes to the operator per the spec's stop-and-ask path.

## Session 2026-10-29 — sdd-execute sequential, Step 1 (sdd-batch-execute)

- Step 1 done: `exchangeAuthCode` keeps Phase A as is, mints before the claim, then calls new private
  `redeemAuthCode(codeHash, userId, clientId)` (after `rotateRefreshToken`), which runs the conditional claim
  (`consumed_at IS NULL AND expires_at > NOW()`) and `issueRefreshToken(…, client)` in one transaction; 0 rows →
  `16 invalid_grant`. Unconditional autocommit UPDATE removed. No deviations.
- TDD (C-08 pair with Step 2): Step 2's tests were drafted per its Instructions and run uncommitted on the
  pre-Step-1 tree (Node 24.20.0, `pnpm test`), then the draft was reverted; Step 2 owns committing them.
  - RED: 86 tests, 82 pass, 4 fail — AC-1 20-way race (`20 !== 1` winners), AC-1 claim-time expiry (`undefined !== 16`),
    AC-3 `failInsert` and AC-3 `JWT_SECRET` unset (`consumedAt` set, expected `null`). AC-2/AC-5/AC-6 guards green.
  - GREEN: 86 tests, 86 pass, 0 fail, 0 skipped; tsc diagnostics: none.
- Verification: `pnpm run lint` 0 errors (194 pre-existing `no-explicit-any` warnings, none in new code); predicate
  grep 1 hit (`redeemAuthCode`); unconditional-UPDATE grep 0 hits; jscpd report: 1 clone, pre-existing
  (`updateUserMetadata`/`adminUpdateUserMetadata`), none between `redeemAuthCode` and `rotateRefreshToken` — no
  stop-and-ask triggered.

## Session 2026-10-29 — sdd-execute sequential, Step 2 (sdd-batch-execute)

- Step 2 done: inline `makeAuthCodeDb` fake (after `makeTokenDb`; fidelity rules a–e of design.md §3) plus 7
  `@AC-*`-named tests and a local `exchange()` helper inside `describe('exchangeAuthCode')`. Existing exchange tests
  and `makeTokenDb` untouched; no `if (!impl) return;` guards. `JWT_SECRET`-unset test restores the prior value in
  `finally`.
- TDD (Node 24.20.0, `pnpm test`): RED on the pre-Step-1 `identityServiceImpl.ts` (temporarily restored from
  `d6cd9f3c`, uncommitted) — 86 tests, 82 pass, 4 fail: AC-1 20-way race (`20 !== 1`), AC-1 claim-time expiry
  (`undefined !== 16`), AC-3 `failInsert` and AC-3 `JWT_SECRET` unset (`consumedAt` set, expected `null`).
  GREEN on the Step 1 tree — 86 tests, 86 pass, 0 fail, 0 skipped; tsc errors: none.
- Verification: `pnpm run lint` 0 errors (194 warnings, unchanged from Step 1); `pnpm run test:coverage` 86/86,
  All files 82.56% lines (≥40).
- Deviations logged (F-09): `pnpm test` route + spec-reporter output (no TAP `# ` lines); RED via temporary
  pre-Step-1 source swap because Step 1 was committed first.

## Session 2026-10-29 — sdd-execute sequential, branch setup + re-spec (sdd-batch-execute)

- Up-front plan approved by the operator's standing authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute; unattended checkpoints
  `report`; C-16 promotion auto-confirmed unless it changes an existing @AC rule; operator-only DB/prod steps:
  open PR, hold merge). Status already `in-progress` (Steps 1-2 done), so no status flip.
- §5.3 branch setup: merged `origin/main-dev` into the feature branch (normal merge, no conflicts, merge commit
  `6b61bfbf`); ledger-guard `--own-slug fix-identity-auth-code-race --fix` reported clean, no repair needed.
- Re-spec of Steps 3, 4, 5 (line-anchor drift only, no symbol drift):
  - Step 3: `refreshOAuthToken`'s `mintOAuthAccessToken` call is now `identityServiceImpl.ts:560-562`
    (`:533-535` is `exchangeAuthCode`'s Step 1 call); the 3 grep hits are `:295`, `:533`, `:560`.
  - Step 4: `describe('refreshOAuthToken')` is `:593-619` (new describe goes after `:619`); `routePool` `:850-861`;
    `pool.queries` example `:607`; `APPLICATION_ENV` precedent `:121-140`.
  - Step 5: `issueAuthCode` starts at `identityServiceImpl.ts:468`; request fields unchanged. No Postgres on
    `localhost:5432`, so the BEFORE/AFTER repro run stays with the operator, as the spec already says.

## Session 2026-10-29 — sdd-execute sequential, Step 3 (sdd-batch-execute)

- Step 3 done: `mintOAuthAccessToken` renamed to `mintAccessToken(userId, email, roles, audience?)`, returning
  `{ accessToken, expiresIn, issuedAt, expiresAt }`; `aud` written only when `audience !== undefined` (OAuth callers
  still pass `audience` / `resource || ''`, so `aud: ''` is preserved, FR-8). `authenticateUser` and `refreshToken`
  mint through it; `authenticateUser` issues its refresh token through `issueRefreshToken(user.user_id)`, so
  first-party login rows now write `client_id = NULL` explicitly (accepted side effect, design.md §2). No import change.
- TDD (Node 24.20.0, `pnpm test`), temporary uncommitted AC-4 login probe (deleted after GREEN):
  RED — 87 tests, 86 pass, 1 fail: refresh INSERT `params[3]` `undefined !== null`. GREEN — 87 tests, 87 pass, 0 fail.
- Verification: `pnpm run lint` 0 errors (192 warnings, down from 194 — two `jwt as any` sites removed);
  `grep -c mintOAuthAccessToken` → 0. FR-6/FR-7 structural preview: one `(jwt as any).sign` (`:287`, in
  `mintAccessToken`), one `INSERT INTO identity.refresh_tokens` (`:305`, in `issueRefreshToken`).
  `pnpm run test:coverage` (probe removed) 86/86, All files 82.67% lines.

## Session 2026-10-29 — sdd-execute sequential, Step 4 (sdd-batch-execute)

### Step 4 — test: claim-shape and client-tagging parity across login, refresh and OAuth exchange (AC-4) [done]
- `makeSpyPool` now records `params` beside `queries` (additive). Three `@AC-4` cases were added. The login and
  first-party refresh cases are in the new `describe('token claim-shape parity (AC-4)')`. The OAuth-exchange case is
  nested in `describe('exchangeAuthCode')` so it can reuse `storedRow` and `exchangeCall`. Each case checks the
  shared claims (`user_id`/`email`/`roles`/`issued_at`/`expires_at`, TTL 900), the `aud` rule, and the refresh
  INSERT `client_id` (`null`, `null`, `'oauthc_1'`). `APPLICATION_ENV` is unset and restored in `finally`.
- Tooling: Node 24.20.0 ✓ · pnpm 9.15.9 ✓ · `pnpm install --frozen-lockfile --filter "xstockstrat-identity..."` ⬇
  (worktree, no lockfile change).
- TDD (`pnpm test`):
  - **RED** ran on the pre-Step-3 `identityServiceImpl.ts`, restored temporarily from `d98f682f~1` and not committed.
    89 tests: 88 pass, 1 fail. The failure was "AC-4 login", with refresh INSERT `client_id` `undefined !== null`.
  - **GREEN** ran on the Step 3 tree: 89 tests, 89 pass, 0 fail, 0 skipped. All three `@AC-4` cases executed.
- FR-6/FR-7 structural check:
  - `grep -n "(jwt as any).sign"` → 1 hit, `:287`, inside `mintAccessToken` (`:271`).
  - `grep -n "INSERT INTO identity.refresh_tokens"` → 1 hit, `:305`, inside `issueRefreshToken` (`:297`).
- Verification:
  - `pnpm run lint`: 0 errors. Warnings went from 192 to 206. All 14 new ones are `any` warnings in the new
    test code, which follows the file's existing untyped-mock style.
  - `pnpm run test:coverage`: 89/89, All files 83.7% lines (threshold ≥40).
- Files modified: `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`.
- Deviations: F-09 evidence route and RED-by-temporary-source-swap, the same as Steps 2 and 3. The OAuth case is
  nested as the spec allows. See the Deviation Log.

## Session 2026-10-29 — sdd-execute sequential, Step 5 (sdd-batch-execute)

### Step 5 — test: real-Postgres 20-caller repro of AC-1 [pending — deferred to operator]
- Blocked on an operator-only action: `pg_isready -h localhost -p 5432` → "no response", and the execute loop may not
  start a database. Step **Status** stays `pending`; the integration PR merge is held (see the Deviation Log entry).
- Code side done: `repro-265.cjs` written in the session scratchpad (not committed), `node --check` passes, and on
  Node v24.20.0 against the Step 4 `dist/` it loads `pg` and `IdentityServiceImpl`, then fails at connect
  (`repro-265 failed: connect ECONNREFUSED 127.0.0.1:5432`). Seeded rows are removed by deleting the client and user
  (auth codes and refresh tokens cascade, migrations 001/003/004).
- BEFORE base: `d6cd9f3c` (pre-Step-1 `identityServiceImpl.ts`). AFTER: this branch at or after `56daa169`.
- Command (run from the repo root or the BEFORE worktree root, after `pnpm --filter xstockstrat-identity run build`):

  ```bash
  DB_POOL_MAX=20 JWT_SECRET=repro DATABASE_URL='postgres://xstockstrat:<pw>@localhost:5432/xstockstrat?sslmode=disable' timeout 60 node <scratchpad>/repro-265.cjs
  ```

- local only; never set DB_POOL_MAX for identity in .do/app*.yaml (direct :25060, budget 2)
- F-06 check: `DB_POOL_MAX=20` over `.do/app.yaml` and `.do/app.dev.yaml` → 0 hits.
- Operator to record here: `node --version`; BEFORE line (expect `successes` > 1, `refresh_rows` > 1); AFTER line
  (expect `repro-265 successes=1/20 refresh_rows=1`); and confirmation that this repro counts as the AC-1
  real-Postgres harness (design.md §3).
- Script `repro-265.cjs`, verbatim:

```js
// repro-265: 20 concurrent exchangeAuthCode calls on one code against real Postgres (AC-1).
// Run from the repo root after `pnpm test` (or `pnpm run build`) in services/xstockstrat-identity.
const path = require('node:path');
const crypto = require('node:crypto');
const dir = path.resolve(process.env.IDENTITY_DIR || 'services/xstockstrat-identity');
const { Pool } = require(require.resolve('pg', { paths: [dir] }));
const { IdentityServiceImpl } = require(path.join(dir, 'dist/grpc/identityServiceImpl.js'));

const call = (fn, request) => new Promise((resolve) => fn({ request }, (err, res) => resolve({ err, res })));

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) });
  const impl = new IdentityServiceImpl(pool, { getInt: (_k, d) => d });
  const ts = Date.now();
  const clientId = `repro265_${ts}`;
  const redirectUri = 'https://agent.example/callback';
  const verifier = 'repro-265-fixed-code-verifier-0123456789abcdefghijklmnop';
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  let userId;
  try {
    userId = (await pool.query(
      'INSERT INTO identity.users (email, password_hash) VALUES ($1, $2) RETURNING user_id',
      [`repro-265-${ts}@example.com`, 'repro-265-not-a-hash'],
    )).rows[0].user_id;
    await pool.query(
      "INSERT INTO identity.oauth_clients (client_id, redirect_uris) VALUES ($1, '{https://agent.example/callback}')",
      [clientId],
    );
    const issued = await call(impl.issueAuthCode.bind(impl), { userId, clientId, redirectUri, codeChallenge: challenge, resource: '' });
    if (issued.err) throw new Error(`issueAuthCode failed: ${JSON.stringify(issued.err)}`);
    const results = await Promise.all(Array.from({ length: 20 }, () => call(impl.exchangeAuthCode.bind(impl), {
      code: issued.res.code, codeVerifier: verifier, redirectUri, clientId, resource: '',
    })));
    const ok = results.filter((r) => !r.err).length;
    const errCodes = results.filter((r) => r.err).map((r) => r.err.code);
    const rows = (await pool.query(
      'SELECT count(*)::int AS n FROM identity.refresh_tokens WHERE user_id = $1 AND client_id = $2',
      [userId, clientId],
    )).rows[0].n;
    console.log(`repro-265 successes=${ok}/20 refresh_rows=${rows} error_codes=${JSON.stringify(errCodes)}`);
  } finally {
    await pool.query('DELETE FROM identity.oauth_clients WHERE client_id = $1', [clientId]).catch(() => {});
    if (userId) await pool.query('DELETE FROM identity.users WHERE user_id = $1', [userId]).catch(() => {});
    await pool.end();
  }
})().catch((e) => { console.error('repro-265 failed:', e.message); process.exit(1); });
```

## Session 2026-10-29 — sdd-execute sequential, Step 6 (sdd-batch-execute)

### Step 6 — docs: teardown context refresh for identity [done]
- `/context-forge:context-constitution refresh` unavailable in this session, so the refresh was manual (root
  `CLAUDE.md` § Teardown): both files re-read against `src/grpc/identityServiceImpl.ts` @ `0e4fc22d`.
- `services/xstockstrat-identity/docs/context-constitution.md`:
  - IDENTITY-1: `jwt.verify` ~L192 (`#validateToken`), single `jwt.sign` ~L287 (`#mintAccessToken`).
  - IDENTITY-2: hex sites ~L213/303/460/484/529; PKCE base64url compare ~L504 in `#exchangeAuthCode`.
  - IDENTITY-4: now names `#mintAccessToken` (~L271) and states `aud` is written only for OAuth callers (~L286);
    first-party tokens carry none.
  - Every other `~L` hint re-stamped; `last_used_at` gotcha re-anchored to `#rotateRefreshToken` `touchLastUsed`.
  - No new IDENTITY-* rule (none proposed; IDENTITY-8 holds the atomic-guard family).
- `services/xstockstrat-identity/CLAUDE.md:37-38` unchanged: "single-use" is now true under concurrency.
- Verification: `grep -n mintOAuthAccessToken` over both files → 0 hits; `grep -c mintAccessToken`
  context-constitution.md → 3 (header, IDENTITY-1, IDENTITY-4). TDD: N/A (docs).
- Integration PR body owes: "context-forge refresh plugin unavailable; manual reconciliation of identity's
  context-constitution.md + CLAUDE.md performed in Step 6" (Deviation Log, Step 6).


## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan — fix-identity-auth-code-race (feature 265)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | services/xstockstrat-identity/acceptance/fix-identity-auth-code-race.feature | CREATE | NEW | concurrent single-grant; subject is ExchangeAuthCode / identity.refresh_tokens |
| AC-2 | same | CREATE | NEW | consumed code not redeemable |
| AC-3 | same | CREATE | NEW | failed refresh insert leaves code unconsumed |
| AC-4 | same | CREATE | NEW | claim shape and client tagging across login, refresh and OAuth exchange |
| AC-5 | same | CREATE | NEW | Scenario Outline; failed validation does not consume code |
| AC-6 | same | CREATE | NEW | expired code rejected |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-identity/acceptance/fix-identity-auth-code-race.feature (CREATE) ---
# Promoted from feature 265 (fix-identity-auth-code-race) acceptance.feature at launch (C-16). Do not hand-edit; scenarios are verbatim.
Feature: xstockstrat-identity - authorization code single-use and token issuance (fix-identity-auth-code-race)
  Regression guard: ExchangeAuthCode must redeem an authorization code at most once (debt-radar D-23, D-21).

  Background:
    Given an OAuth client "mcp-client-1" registered with redirect_uri "https://agent.example/callback"
    And user "u-1" was issued an authorization code for "mcp-client-1" with a PKCE S256 challenge for verifier "v-123"

  @AC-1 @FR-1 @FR-3 @regression @feature-265
  Scenario: Concurrent exchanges of one authorization code yield exactly one grant
    When 20 ExchangeAuthCode calls for that code with code_verifier "v-123" run concurrently
    Then exactly 1 call returns an access token and a refresh token
    And the other 19 calls fail with UNAUTHENTICATED "invalid_grant"
    And identity.refresh_tokens holds exactly 1 new row for user "u-1" and client "mcp-client-1"

  @AC-2 @FR-1 @FR-4 @regression @feature-265
  Scenario: A consumed authorization code cannot be redeemed again
    Given the code was exchanged successfully once
    When ExchangeAuthCode is called again with the same code and code_verifier "v-123"
    Then the call fails with UNAUTHENTICATED "invalid_grant"

  @AC-3 @FR-2 @regression @feature-265
  Scenario: A failed refresh-token insert does not consume the authorization code
    Given the refresh-token INSERT for the exchange fails with "connection terminated"
    When ExchangeAuthCode is called with the code and code_verifier "v-123"
    Then the call fails with gRPC status INTERNAL
    And the response carries no access token or refresh token
    And the code's consumed_at is still NULL
    And identity.refresh_tokens holds no new row for user "u-1" and client "mcp-client-1"

  @AC-4 @FR-6 @FR-7 @FR-8 @regression @feature-265
  Scenario: First-party login, first-party refresh and OAuth exchange issue tokens with the same claim shape and client tagging
    Given user "u-1" with email "u1@example.com" and roles ["trader"]
    When "u-1" authenticates with a password, refreshes that session, and separately exchanges an authorization code with resource "https://agent.example/mcp"
    Then every access token carries user_id "u-1", email "u1@example.com", roles ["trader"], issued_at and expires_at
    And on every access token expires_at minus issued_at equals 900 seconds
    And only the OAuth access token carries aud "https://agent.example/mcp"
    And the login refresh token is stored with client_id NULL and the OAuth refresh token with client_id "mcp-client-1"

  @AC-5 @FR-5 @regression @feature-265
  Scenario Outline: A request that fails client, redirect or PKCE validation does not consume the code
    When ExchangeAuthCode is called for that code with <field> set to <value>
    Then the call fails with UNAUTHENTICATED "invalid_grant"
    And the code's consumed_at is still NULL
    And a following ExchangeAuthCode call with client "mcp-client-1", redirect_uri "https://agent.example/callback" and code_verifier "v-123" returns an access token and a refresh token

    Examples:
      | field         | value                          |
      | code_verifier | "wrong-verifier"               |
      | redirect_uri  | "https://evil.example/callback" |
      | client_id     | "other-client"                 |

  @AC-6 @FR-4 @regression @feature-265
  Scenario: An expired authorization code cannot be redeemed
    Given the code's expires_at is in the past
    When ExchangeAuthCode is called with the code and code_verifier "v-123"
    Then the call fails with UNAUTHENTICATED "invalid_grant"
    And identity.refresh_tokens holds no new row for user "u-1" and client "mcp-client-1"

### Notes / ambiguities / conflicts
- All six scenarios are attributed to xstockstrat-identity (observable subject is ExchangeAuthCode and identity.refresh_tokens); none cross-service, so nothing goes to docs/sdd/business-rules/platform.feature.
- Dedup: grepped services/xstockstrat-identity/acceptance/*.feature (mcp-user-profile-roles, user-management-ui, fix-identity-ledger-test-suites) and docs/sdd/business-rules for ExchangeAuthCode, invalid_grant, auth code, expires_at, client_id, 900. No matches, so no DUP, OVERLAP or CONFLICT. fix-identity-ledger-test-suites.feature:9 mentions refresh-token single-use revocation only as a mutation-test note, not an asserted outcome.
- Background is kept verbatim in the file header, since scenarios depend on it.
- The `Examples` table cell padding was slightly re-aligned (whitespace only; the values are unchanged).
- The source acceptance.feature was read from the working tree path docs/roadmap/features/265-fix-identity-auth-code-race/acceptance.feature, not origin/feature/fix-identity-auth-code-race. Orchestrator should confirm the two match.

### Coverage check
- Source scenarios: 6 (AC-1 to AC-6). Planned (NEW+DUP+OVERLAP): 6 (6 NEW). None skipped.
```
