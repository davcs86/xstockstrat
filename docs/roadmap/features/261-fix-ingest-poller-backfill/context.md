# Context Log: fix-ingest-poller-backfill

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ingest-poller-backfill-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:261-fix-ingest-poller-backfill`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-09, D-34,
  D-42, D-59.
- Severity: SEV-2 (group). Impact type: silent-signal-loss. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-ingest (fix site), xstockstrat-config (`GetSecret` server, read-only).
- Root cause hypothesis: per-source (not per-item / per-call) error handling in the poller; a first-list extraction
  heuristic; in-memory cancel flag plus unconditional `RUNNING` writes on queued-start and resume.
- Re-verification on a053b0e: all four D-ids reproduce by reading.
  - D-09: `mcp_client_loop.py:124-125` (unchanged); caller catch `:143-146` (scan `:145`).
  - D-34: queued-start `RUNNING` `servicer.py:493-498` (scan `:494-498`); resume `RUNNING` `:734` (unchanged);
    `backfill_chunks.py:146` (unchanged); `_canceled_jobs` `:326` (unchanged); `CancelBackfill` `:869-907`.
    Traced further at triage: a queued-canceled bars job is left `RUNNING` with PENDING chunks (`run_one` skip
    `:759-760`, `_finalize_backfill` early return `:655-659`), then revived on restart; a queued-canceled
    fundamentals job calls `BackfillFundamentals` and overwrites `CANCELED` (`:526-545`, no cancel check).
  - D-42: `watcher.py:155-163` (unchanged); call site `mcp_client_loop.py:116`; loop `:139-146`.
  - D-59: `mcp_client_loop.py:41-45` (unchanged).
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) modifies `mcp_client_loop.py:133-138` (the
    `request_timeout_seconds` read, switching to `int_positive`) and `ingest/app/config/watcher.py` (getters and the
    `backfill_max_concurrent_*` properties, consumed at `servicer.py:323,749`). D-42 should reuse 244's clamped
    timeout read. **Merge 244 first, then rebase 261**; add a `merge-order.md` row at /sdd-spec.
  - `247-fix-agent-getconfig-deadline` (implementation-ready) is the agent-side sibling of D-42 (the filed report
    `2026-10-19-agent-get-config-value-no-deadline-defect` does not cover ingest). Reuse its deadline pattern; no file
    overlap.
  - `259-fix-python-loop-supervision` (D-08) edits `_watch` in the same ingest `watcher.py`; disjoint from
    `resolve_secret`, rebase only.
- Recommended design depth: full → `/sdd-design fix-ingest-poller-backfill` (rationale: 2 affected services, the C-0
  full trigger). Config is read-only, so the operator may downgrade to `/sdd-design fix-ingest-poller-backfill quick`.
  Design forks: D-59 rule (sole list key vs named `signals` key vs per-source `result_key`); D-34 persisted-status
  check vs a new column.
- Development branch: feature/fix-ingest-poller-backfill

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor
  breaches). Overlap level: WARN (no FAIL; no proto-field, migration, or new config-key collision).
- Warnings:
  - Criterion 8 / FR-6: AC-7 ("no rule selects either list" for `{alerts, rows}`) is testable only once design fixes
    the selection rule (well-known `signals`/`items` keys vs per-source `result_key`). Design must confirm AC-7 stays
    valid under the chosen rule.
  - Criterion 2: FR-5 "deadline error" and FR-6 "ambiguous-result error" do not pin `last_error` text. Design pins a
    stable marker substring that AC-4 / AC-7 assert.
  - Criterion 8: AC-2 / AC-3 "marketdata RPC never called" / "no chunk executed" are observable only at the
    stub/mock boundary. Resolved in product-spec § Acceptance Criteria (stated as verified there).
  - Criterion 11: a FR-6 `result_key` in `config_json` would change the `manage_signal_source` schema and the
    `/config-ui` source form; recorded as a conditional Consumer Surface amendment. Design updates the surfaces if
    `result_key` is chosen.
  - Doc drift (NOTE): `services/xstockstrat-ingest/CLAUDE.md` says restart reconciles RUNNING/QUEUED jobs to FAILED
    with "no automatic resume", but `resume_incomplete_jobs` is wired at `app/main.py:119` and defined at
    `app/handlers/servicer.py:714`. FR-4 matches the code. Reconcile that CLAUDE.md at landing (teardown).
  - Coordination (NOTE): 244, 259 and the config-stream resilience peer touch `mcp_client_loop.py` / `watcher.py`.
    Design confirms the merge order.
- Overlap findings:
  - `244-fix-python-config-stored-zero` (implementation-ready): same-key, same-lines conflict at
    `mcp_client_loop.py:133-138` (`request_timeout_seconds` read → `int_positive`); same file, disjoint regions in
    `app/config/watcher.py` (getters) and `app/handlers/servicer.py` (`_backfill_sem` at `:323`). Recommended order:
    244 first, then 261 rebases FR-5 onto `int_positive`.
  - `259-fix-python-loop-supervision` (draft): same file `app/config/watcher.py`; region overlap unverified until 259
    is specced.
  - Low-risk shared context: 260 (`servicer.py:1039-1066`) and 242 (`servicer.py:473`, adjacent to queued start
    `:493-498`) — disjoint lines, rebase only. Config `GetSecret` (254, 242 peer-SAN grant at
    `services/xstockstrat-config/src/grpc/authz.ts:124`) is read-only here — no collision.
  - Line drift: trunk has `resolve_secret` at `watcher.py:146` (spec cites `:155-163`) and the timeout read at
    `mcp_client_loop.py:135`. Design re-anchors.
  - Merge-order: no `merge-order.md` row for 261 yet. Recommended WARN row 244 → 261 (later also vs 259). Not
    written — needs user confirmation per the /sdd-review rule; propose at /sdd-spec.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-09, D-34, D-42, D-59.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Next: `/sdd-design fix-ingest-poller-backfill`.

## Session 2026-10-22 — sdd-batch design gate (round 2)

`/sdd-design fix-ingest-poller-backfill` (full debate) is halted at its approval gate after round 2 (gate policy:
halt). design.md is not written and status stays `spec-ready`.

### Open Threads

- **Approach (carries forward from r2, ingest only, 3 files, no proto/migration/config-key/config_json change):**
  - FR-6: `_select_signal_list(d)` in `app/engine/mcp_client_loop.py`, applied in both dict branches. Rules in order:
    `signals` list wins → exactly one non-empty all-dict list wins → several such lists raise
    `ambiguous result: multiple candidate lists [...]` → all lists empty and no `symbol` key returns `[]` →
    otherwise `[d]`.
  - FR-1: a per-item `try/except` with skip warnings and a summary `log.info`, emitted before any raise. If every
    parsed item fails, raise `RuntimeError("all N items failed: ...")`, which lands in `last_error`.
  - FR-5: `resolve_secret(..., timeout=)` passes the gRPC deadline. Only `DEADLINE_EXCEEDED` is translated, as
    `RuntimeError("GetSecret deadline exceeded after Ns") from e`. Rebase onto 244's `int_positive` when it lands.
  - FR-2/3/4: synchronous `_canceled_jobs` checks with no await before the guarded write. Placements: semaphore entry
    before RUNNING (`servicer.py:493`), between BackfillFundamentals and `update_job` (`:540-544`), the blanket
    except (`:510`), and a persisted CANCELED check in `_resume_job` (`:724-734`).
  - Trace: request paths keep `propagation_meta`. `_resume_job` mints one uuid4 `x-trace-id` per resumed job.
  - Tests go red first, including the O-3 guard test (the `update_job` fake asserts set membership at the CANCELED
    write).
  - Build order: FR-6+FR-1 → FR-5 (after 244) → FR-2/3/4 → teardown. Teardown fixes the CLAUDE.md "no automatic
    resume" drift, logs the `main.py` comment drift in findings, and adds the single-instance cancel invariant.
- **Strongest open objection (blocking, O-1, P-03/C-15):** "every parsed item fails → `last_error`" contradicts
  product-spec FR-1 ("a skipped item alone does not mark the source errored"). Before design approval and
  `/sdd-spec`, three things must land: an FR-1 amendment in product-spec.md, `@AC-8 @FR-1` appended to the branch
  `acceptance.feature`, and a context.md decision record.
- **Other open objections (non-blocking):**
  - O-2: all-empty-envelope `[]` rule plus a test, and the `@AC-4 @feature-166` EXTEND.
  - O-3: guard test, and cite `fails.md:1688-1693`.
  - O-5: the poll-loop GetSecret trace-id cost case needs an operator call.
  - O-4: FR-2 window text must cover `await get_job` `:881`.
  - O-8: FR-3 interleave note.
  - O-6: inline `AioRpcError` builder unless two modules use it.
  - O-7: the AC-4 fake sleeps for `timeout`.
  - C-15: the main-dev `acceptance.feature` is stale, so `/sdd-sync` must reconcile it.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (no operator decision yet):**
  - `@AC-8 (261, FR-1)` EXTEND, to be appended.
  - `@AC-4 @feature-166` EXTEND: a single signal object with a `tags` list is wrapped instead of returning its tag
    strings.
  - 261 `@AC-1`…`@AC-7` are operator-sanctioned CHANGEs.
  - feature-166 `@AC-5`, feature-173 `@AC-1`/`@AC-3` and feature-198 `@AC-6` are PRESERVE.
- **Next:** resolve O-1, plus the operator's call on the O-5 poll-loop trace and the uncovered EXTENDs, then re-run
  `/sdd-batch` to resume the debate at round 3 from the state below.

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

## Session 2026-10-22 — sdd-batch design-state correction (round 2)

- The previous `sdd-batch-design-state` block, under the round-2 gate entry, held feature 265's identity design (`exchangeAuthCode`, D-23/D-21) because of a cross-feature writer mix-up. The prose Open Threads in that entry are 261's and stay valid.
- The block below is 261's real round-2 synthesis, restored verbatim from the batch run journal (`synth:fix-ingest-poller-backfill:r2`). It supersedes the earlier block. 265's own `context.md` was checked and holds its correct state.
- Operator gate answer (2026-10-22), unchanged: APPROVED, with FR-1 amended (an all-fail batch marks the source errored, `@AC-8`).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The r2 proposal is the current best approach and carries forward. It resolves both r1 blocking objections at the placements the r1 synthesis specified. Changes stay in xstockstrat-ingest only, in three files, with no proto, migration, config-key or config_json change. This round adds the following amendments.\n\n1. **FR-6 `_select_signal_list(d)`** (`app/engine/mcp_client_loop.py`). It replaces the dict branch at `:41-45` and the decoded-text-dict branch at `:50-51`. A decoded list still passes through, and `JSONDecodeError` is still a source error.\n   - (a) `d[\"signals\"]` is a list \u2192 return it, even if empty.\n   - (b) Candidates are non-empty, all-dict list values. Exactly one candidate \u2192 return it.\n   - (c) Two or more candidates \u2192 `ValueError(\"ambiguous result: multiple candidate lists [<sorted keys>]\")`.\n   - (d) No candidates:\n     - **AMENDED (O-2):** if `d` has at least one list value, every list value is empty, and `\"symbol\"` is not in `d` \u2192 return `[]`. This keeps today's silent behaviour for `{\"items\": []}` and `{\"results\": [], \"count\": 0}`, which I verified: the first-list-wins loop at `:42-44` returns `[]`.\n     - Otherwise return `[d]`. A single signal object with `tags: [\"ai\"]` or `tags: []` carries `\"symbol\"`, so it wraps.\n     - design.md must record this as an **EXTEND** of `@AC-4 @feature-166`. Today such an object returns its tag strings, which I verified at `:42-44`.\n\n2. **FR-1 per-item guard** (`:124-125`).\n   - Each item is wrapped in `try/except Exception`. A failure logs a warning (`mcp_client loop: source %s item skipped: %s`), increments `skipped` and keeps `first_err`.\n   - After the loop, one summary `log.info(\"mcp_client loop: source %s polled ingested=%d skipped=%d\")`, emitted **before** any raise (O-1 ordering).\n   - Then, if `parsed` is non-empty and every item was skipped, `raise RuntimeError(f\"all {n} items failed: {first_err}\")`. The per-source catch at `:143-152` records it as `last_error`.\n   - **AMENDED (O-1):** before `/sdd-spec`, amend product-spec FR-1 with the total-failure rule. Append `@AC-8 @FR-1` to the branch copy of `acceptance.feature` (\"every parsed item fails \u2192 last_error set, summary logged\"). AC ids are append-only. Record the decision in context.md.\n\n3. **FR-5 deadline** (`app/config/watcher.py:146-164`).\n   - `resolve_secret(key, user_id=..., timeout: float | None = None)` passes `timeout=` to `self._stub.GetSecret`.\n   - Only `AioRpcError` with `code() == DEADLINE_EXCEEDED` is translated, as `raise RuntimeError(f\"GetSecret deadline exceeded after {timeout}s\") from e` (O-7 chaining).\n   - `PERMISSION_DENIED`, `INTERNAL` and `found=false` are unchanged.\n   - The call site at `mcp_client_loop.py:116` passes `float(timeout_seconds)`, the value already clamped at `:133-138`.\n   - Rebase onto feature 244's `int_positive` read when it lands. If 261 lands first, keep today's `max(get_int(...), 1)`.\n\n4. **FR-2/3/4 cancel guards** (`app/handlers/servicer.py`). Each check is synchronous, with no `await` between it and the write it protects.\n   - **FR-2:** first statement inside `async with self._backfill_sem:` (`:493`), before the RUNNING write (`:494`): `if job_id in self._canceled_jobs: discard; log.info(...canceled while queued...); return`.\n   - **FR-3:** in `_execute_fundamentals_backfill`, between the BackfillFundamentals return (`:532-540`) and `update_job` (`:544`): the same check, discard, log, return. No COMPLETED/PARTIAL write and no `.completed` emit.\n   - **FR-4:** in `_resume_job`, after `row = get_job` (`:724`) and before the RUNNING write (`:734`): `if row[\"status\"] == BACKFILL_STATUS_CANCELED: log.info(\"skipping resume of canceled job %s\"); return`.\n   - **Blanket except** (`:510`): `if job_id in self._canceled_jobs: discard; return` before the FAILED write.\n   - No new events. `_finalize_backfill`, `run_one`, `resume_incomplete_jobs` and its count are untouched.\n   - Proof that the in-memory set is authoritative (re-verified this round):\n     - The only `BACKFILL_STATUS_CANCELED` write in `app/` is `servicer.py:900`.\n     - It is preceded by the synchronous `self._canceled_jobs.add` at `:896`.\n     - Ingest runs with `instance_count: 1` (`.do/app.yaml:238`).\n   - **AMENDED (O-3):** add a guard test. A repo fake for `update_job` asserts `job_id in servicer._canceled_jobs` when the CANCELED write arrives. A future reorder, or a second CANCELED writer path, then fails CI. Cite ledger `fails.md:1688-1693` in design.md as the rule that was weighed.\n\n5. **Trace (operator 2026-10-21, C-03).**\n   - Request-derived paths keep the `propagation_meta` captured before `create_task`.\n   - **AMENDED (O-5, partial):** `_resume_job` mints `((\"x-trace-id\", str(uuid.uuid4())),)` once per resumed job and passes it to `_run_chunks`/`_finalize_backfill` instead of `()` (`servicer.py:737-738`). `uuid` is already imported at `:11`, so the change is one line with no new helper. Resumed BackfillBars calls and emits then share one correlatable id.\n   - The poll-loop GetSecret keeps internal-caller metadata only, pending the operator's call (see open objection). `resolve_secret` takes no metadata parameter, and widening it touches a file shared with in-flight features 242, 260 and fix-config-stream-resilience.\n\n6. **Tests, red first per step (P-06).**\n   - Widen existing fakes with `timeout=None`: `test_mcp_client_loop.py:65`, `:210`, and `test_mcp_client.py:27`.\n   - **AMENDED (O-6):** the `AioRpcError(DEADLINE_EXCEEDED, Metadata(), Metadata(), details=...)` builder stays inline unless both `test_mcp_client.py` and `test_mcp_client_loop.py` consume it. If they do, it goes next to `job_row` in `tests/_helpers.py`, and that home is recorded in context.md.\n   - **AMENDED (O-7):** the AC-4 fake asserts `timeout == 2.0`, does `await asyncio.sleep(timeout)`, then raises. The test asserts the marker in `last_error` for src-a and that src-b is still polled. Keep feature 247's outer hang guard.\n   - Parsing tests:\n     - AC-1 with a caplog summary;\n     - AC-5 and AC-7;\n     - a single object with `tags`;\n     - an all-empty-lists envelope \u2192 `[]` with no extractor warning (O-2);\n     - a text-fallback `{\"signals\": [...]}`;\n     - AC-8, all items failing.\n   - Cancel tests:\n     - AC-2 (bars and fundamentals queued cancel) and AC-6 run through `CancelBackfill` with repo fakes. Do not copy `test_cancel_backfill.py:52`'s private-set assertion.\n     - AC-3 runs through `resume_incomplete_jobs` with a CANCELED `job_row`, spying on the chunk runner and marketdata.\n     - The O-3 ordering test.\n     - `test_ingest_servicer.py:624` stays green.\n\n7. **Build order:** FR-6 + FR-1 \u2192 FR-5 (after 244) \u2192 FR-2/3/4 \u2192 teardown.\n   - Fix the \"no automatic resume\" drift in `services/xstockstrat-ingest/CLAUDE.md`.\n   - Log the `main.py:66` and `:117-118` comment drift in `services/xstockstrat-ingest/docs/context-constitution-findings.md`. `main.py` is untouched.\n   - Add an ingest invariant: \"single instance; `CancelBackfill` adds to `_canceled_jobs` before its CANCELED write; the guards rely on the set alone\", referencing the O-3 test.\n   - **AMENDED (O-4/O-8), design.md text:**\n     - The accepted FR-2 window spans CancelBackfill's whole `await get_job` (`:881`) as well as the RUNNING write. The outcome is still correct via the chunk guard at `:759`, the FR-3 guard and `_finalize_backfill` at `:657`. Executors must NOT add a DB read before the RUNNING write.\n     - The FR-3 interleave, a cancel during the COMPLETED `update_job` await, leaves one stale set entry per race. It also lands both `.completed` and `.canceled` in the ledger. This is accepted and is not a guard bug.",
    "open_objections": [
      {
        "text": "[P-03 / C-15, O-1] The FR-1 rule 'every parsed item fails \u2192 RuntimeError \u2192 last_error' goes beyond product-spec FR-1 ('a skipped item alone does not mark the source errored'). A failing one-item batch now marks the source errored. Before design approval and /sdd-spec:\n- amend FR-1 in product-spec.md;\n- append `@AC-8 @FR-1` to the branch copy of acceptance.feature on origin/feature/fix-ingest-poller-backfill, which is append-only;\n- record the decision in context.md;\n- emit the summary log.info before the raise.\nThe r2 proposal adopted the rule but did not answer the spec drift.",
        "blocking": true
      },
      {
        "text": "[C-16, O-2] Rule (d) as proposed wraps an envelope whose lists are all empty (e.g. {\"items\": []}) as [d]. Today it returns [] silently (verified, mcp_client_loop.py:42-44). The proposed behaviour adds a missing-symbol extractor warning on every empty poll. The synthesis amendment is: return [] when d has at least one list value, every list value is empty, and \"symbol\" is not in d; otherwise wrap. It also reclassifies @AC-4 @feature-166 as EXTEND, because a single object with a tags list stops returning its tag strings. This stays open until the next proposal or the spec adopts it, with an all-empty-envelope test.",
        "blocking": false
      },
      {
        "text": "[ledger fails.md:1688-1693, O-3] The in-memory _canceled_jobs authority is proven: the only CANCELED write is servicer.py:900, after the add at :896, with instance_count 1. Nothing enforces it, though. Add a unit test in which the update_job fake asserts set membership when the CANCELED write arrives, and cite the ledger rule in design.md.",
        "blocking": false
      },
      {
        "text": "[C-03 / operator 2026-10-21, O-5] The synthesis adopts a minted uuid4 x-trace-id per resumed job (servicer.py:737-738, uuid already imported). The poll-loop GetSecret still carries no trace id. The context.md record must argue unavailability or a cost case:\n- resolve_secret has no metadata parameter;\n- widening it collides with in-flight 242/260/fix-config-stream-resilience edits to watcher.py;\n- last_error already carries the slug and owner.\nThe argument must not rest on 'there is no helper'. Otherwise, mint one id per poll cycle and pass it through a new optional metadata kwarg. The operator may decide.",
        "blocking": false
      },
      {
        "text": "[accuracy, O-4] The design.md accepted-window text must say that the FR-2 window also covers CancelBackfill's whole `await get_job` (:881), and that the outcome is still correct through the existing in-run guards. Executors must not add a DB read before the RUNNING write.",
        "blocking": false
      },
      {
        "text": "[C-18, O-8] Document the FR-3 interleave: one stale _canceled_jobs entry per race, plus both .completed and .canceled ledger events. It is accepted as rare.",
        "blocking": false
      },
      {
        "text": "[C-13, O-6] Keep the AioRpcError(DEADLINE_EXCEEDED) builder inline unless two test modules consume it. In that case put it next to job_row in tests/_helpers.py and record that home in context.md.",
        "blocking": false
      },
      {
        "text": "[test fidelity, O-7] The AC-4 fake must `await asyncio.sleep(timeout)` before raising, so the bounded-hang path is exercised. resolve_secret must use `raise ... from e`.",
        "blocking": false
      },
      {
        "text": "[C-15] The main-dev copy of acceptance.feature is stale: it has no AC-6/AC-7 and the older AC-1 text. Design and spec cite the branch copy, and /sdd-sync reconciles the two.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (261, FR-1)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 (261, FR-2)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 (261, FR-4)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4 (261, FR-5)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5 (261, FR-6)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6 (261, FR-3)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-7 (261, FR-6)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8 (261, FR-1, to be appended: all items fail -> last_error)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-166",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-166",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-173",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-173",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-198",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "asyncio.wait_for as the GetSecret bound: feature 247 rejected it (design.md:22, :162-165). It raises a bare TimeoutError with an empty str(), sends no grpc-timeout, and would split the precedent.",
      "Raw AioRpcError text as the FR-5 marker: str(AioRpcError) is multi-line debug text that would end up in last_error and the /config-ui health list. The clean translated message costs about 4 lines.",
      "Per-source result_key in config_json for FR-6: it changes the config_json, manage_signal_source and /config-ui contracts (C-14, @AC-32 parity) for no stated need (C-18).",
      "r1's 'sole non-empty list' / 'all empty \u2192 []' FR-6 rule: it selects or empties a single signal object's tags list and silently drops the signal.",
      "r2's unconditional rule (d) `[d]` wrap: it turns today's silent empty-envelope polls into per-poll extractor warnings (O-2). Superseded by the 'all lists empty and no symbol \u2192 []' refinement.",
      "r1's _is_canceled helper (set check, then awaited get_job): the await between check and write leaves a window in which a cancel is missed.",
      "Compare-and-set terminal writes (UPDATE ... WHERE status <> CANCELED, widening backfill_jobs.update_job at :59): safe across replicas and closes the O-4/O-8 windows, but it changes a shared helper used by every status write and needs new repo-fake semantics. That rework is not justified at instance_count 1, given the user's low-rework instruction.",
      "Filtering canceled jobs in list_jobs_with_incomplete_chunks via a join: it changes the resume count and breaks test_ingest_servicer.py:624.",
      "Leaving the resumed BackfillBars path with `()` metadata: minting a uuid4 trace id there is one line with uuid already imported, and the operator's standing rule asks for one when available."
    ],
    "open_risks": [
      "The FR-2/FR-3 guards depend on single-instance ingest, and on CancelBackfill staying the sole CANCELED writer and adding to the set before writing. The O-3 test catches a reorder or a second writer in-process. Scaling ingest above instance_count 1 would still silently bring back D-34; that is documented as an invariant but not enforced.",
      "Accepted FR-2 window (corrected): a cancel whose `await get_job` (:881) overlaps the runner acquiring the semaphore can still produce one ingest.backfill.running emit and a marketdata call. The existing guards (:759, FR-3, _finalize_backfill :657) then stop the run.",
      "FR-3 interleave: one stale _canceled_jobs id per race, plus both .completed and .canceled events in the ledger.",
      "AC-4 proves the deadline value and the error translation with a sleeping fake. The real grpc-timeout behaviour on a hung channel rests on the grpc.aio contract.",
      "Merge-order coupling: FR-5 depends on feature 244's int_positive read, and watcher.py/mcp_client_loop.py overlap with 242, 260 and fix-config-stream-resilience.",
      "Out of scope: the seeded bare key vs the dotted read (025_\u2026up.sql:34 vs mcp_client_loop.py:135) means the effective timeout is the 30s code default. This needs its own defect report or a 244 follow-up.",
      "Canceled bars jobs with PENDING chunks are re-listed and counted in 'resumed N' at every boot. This is bounded and explained by the skip log."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06"
    ],
    "rationale": "**r1 blockers.** r2 adopted both r1 blocking fixes exactly as placed:\n- synchronous set checks at `servicer.py:493` (before `:494`) and between `:540` and `:544`;\n- the persisted-status check only in `_resume_job` (`:724-734`);\n- the dict-only candidate rule with the `[d]` fallback.\n\nSo both are closed.\n\n**Re-verified this round.**\n- `CancelBackfill` (`:881-902`) adds to `_canceled_jobs` at `:896` before its only CANCELED write at `:900`. A grep confirms there is no other `BACKFILL_STATUS_CANCELED` write in `app/`.\n- The current parser (`mcp_client_loop.py:41-45`) returns the first list, so `{\"items\": []}` returns `[]` today. That grounds O-2: r2's rule (d) would turn silent empty polls into per-poll warnings. The amended rule (\"all lists empty and no symbol \u2192 `[]`\") keeps today's behaviour at no cost. It also confirms the single-object-with-tags case is an EXTEND, not a PRESERVE.\n- `_resume_job` passes `()` metadata (`:737-738`), and `uuid` is already imported (`:11`). Under the operator's standing rule, minting a trace id there is a one-line, no-new-helper change, so I adopted it.\n- The poll-loop GetSecret trace is left as an operator-visible, non-blocking choice. `resolve_secret` has no metadata parameter, and that file is under concurrent edit by sibling features. That is a genuine rework and overlap cost, not merely the lack of a helper.\n\n**Why O-1 is blocking.** The adversary rated it non-blocking. I made it blocking because C-15 makes `acceptance.feature` the single source of acceptance truth, and the design adds a behaviour (a one-item failing batch marks the source errored) that contradicts FR-1's current wording. The fix is cheap: amend FR-1 and append `@AC-8`. It must land before design approval so `/sdd-spec` plans against consistent artifacts.\n\n**Remaining items.** The other adversary items (O-3, O-4, O-6, O-7, O-8) are adopted as low-rework amendments: one guard test, design.md wording, a fixture-placement rule, a sleeping fake, and `from e` chaining.\n\n**Rule classification.** No Floor breaches. The 261 ACs are operator-sanctioned CHANGEs under the D-09/D-34/D-42/D-59 scope. `@AC-8` and the `@AC-4 @feature-166` EXTEND are not explicitly sanctioned, so they are marked uncovered and need recording in context.md. Durable feature-166/173/198 rules are otherwise preserved.\n\n**Compare-and-set alternative.** Compare-and-set terminal writes remain the strongest alternative. They lose only because of the user's \"preserve, low rework\" instruction while ingest runs as a single instance."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md was already written (services: xstockstrat-ingest fix site, xstockstrat-config read-only; key
  reuse patterns: the per-source catch at `mcp_client_loop.py:143-152` as the error channel, and the `_canceled_jobs`
  fast path plus the persisted-status check).
- Phase 1 Grilling: 2 rounds (full). Termination: approved at the operator design gate. Built from the LAST
  `sdd-batch-design-state` block (the design-state correction entry); the earlier block is feature 265's and was
  ignored.
  - Chosen approach: ingest only, 3 files.
    - FR-6: `_select_signal_list`.
    - FR-1: a per-item guard plus a summary log; when every item fails, the poll raises.
    - FR-5: a gRPC `timeout=` on GetSecret, translating only DEADLINE_EXCEEDED.
    - FR-2/3/4: synchronous `_canceled_jobs` guards, plus a persisted CANCELED check in `_resume_job`.
    - A uuid4 trace id per resumed job.
  - Rejected: `asyncio.wait_for`, `result_key` in `config_json`, compare-and-set terminal writes (low-rework at
    `instance_count: 1`), the resume-query join, and the r1/r2 FR-6 rules.
- Constitution rules touched: C-03, C-08, C-11, C-13, C-15, C-16, C-18, P-02, P-03, P-06. Floor breaches: none.
- Status: spec-ready → design-approved.

### Decisions

- **Operator 2026-10-22 (design gate r2): APPROVED as synthesized. FR-1 is AMENDED.**
  - When every parsed item in a batch fails, including a one-item batch, the poll emits the summary `log.info` first
    and then raises `RuntimeError("all N items failed: ...")`. The source's `last_error` is set.
  - A partial failure only logs the skipped count and does not mark the source errored.
  - Applied this session:
    - FR-1 amended in product-spec.md;
    - `@AC-8 @FR-1 @regression` appended to acceptance.feature (ids stay append-only);
    - design.md written.
  - This resolves blocking objection O-1 (P-03/C-15).
- **C-16 classification.** `@AC-8` (EXTEND) and the `@AC-4 @feature-166` EXTEND (a single signal object with a `tags`
  list is wrapped, not mined for its tag strings) are covered by the operator's "APPROVED as synthesized". The 261
  `@AC-1`..`@AC-7` CHANGEs are covered by the 2026-10-21 scope decision.
- **Pinned `last_error` markers:**
  - FR-5 / AC-4: `GetSecret deadline exceeded`;
  - FR-6 / AC-7: `ambiguous result`;
  - FR-1 / AC-8: `all <N> items failed`.
- **O-2 adopted.** An envelope whose lists are all empty and that has no `symbol` key returns `[]`, keeping today's
  silent empty polls. A test covers it.
- **O-5, the cost case for the poll-loop GetSecret trace id (operator may override).** The id is not added this time:
  - `resolve_secret` has no metadata parameter;
  - widening it collides with in-flight `watcher.py` edits by 242, 260 and fix-config-stream-resilience;
  - `last_error` already carries the slug and owner.
  - The resumed-backfill path DOES mint a uuid4 `x-trace-id` per job.
- **O-6 fixture home.** The DEADLINE_EXCEEDED `AioRpcError` builder stays inline unless both `test_mcp_client.py` and
  `test_mcp_client_loop.py` use it. In that case it moves to `tests/_helpers.py` next to `job_row`, and that move is
  recorded here.

### Open Threads

- [ ] **Single-instance dependency.** The FR-2/FR-3 guards rely on single-instance ingest and on CancelBackfill being
  the only CANCELED writer, adding to the set first. Target: the FR-2/3/4 step (O-3 `update_job` fake asserts set
  membership) and teardown (ingest invariant).
- [ ] **Accepted FR-2 window.** It covers CancelBackfill's whole `await get_job` (`:881`), so at most one running emit
  and one marketdata call can slip through, and the existing guards stop the run. Executors must NOT add a DB read
  before the RUNNING write. Target: the FR-2/3/4 step.
- [ ] **FR-3 interleave.** It leaves one stale set entry per race, with both `.completed` and `.canceled` in the ledger.
  Accepted and documented. Target: the FR-2/3/4 step.
- [ ] **AC-4 fidelity.** The sleeping fake proves the deadline value and the translation, while real hung-channel
  behaviour rests on `grpc.aio`. Target: the FR-5 step plus the dev smoke test.
- [ ] **Merge order.** It runs 244 → 261 (FR-5 rebases onto `int_positive`), and the work overlaps 242, 259, 260 and
  fix-config-stream-resilience. Target: `/sdd-spec` (propose the `merge-order.md` row).
- [ ] **Out of scope: seeded key form.** The seeded bare key and the dotted read differ (`025_…up.sql:34` vs
  `mcp_client_loop.py:135`), so the effective timeout is the 30 s default. File a separate defect report or a 244
  follow-up. Target: teardown.
- [ ] **Repeated resume count.** Canceled bars jobs with PENDING chunks are re-counted in "resumed N" at every boot.
  This is bounded and logged. Target: the FR-4 step.
- [ ] **Stale main-dev copy.** The main-dev `acceptance.feature` lacks AC-6/AC-7/AC-8. Target: `/sdd-sync`.
- [ ] **Teardown.**
  - Fix the "no automatic resume" drift in `services/xstockstrat-ingest/CLAUDE.md`.
  - Log the `main.py:66` / `:117-118` comment drift in the ingest findings doc.
  - Run `/context-forge:context-constitution refresh`.
- Ledger: no new line. Every reusable lesson here is already covered by `fails.md:1688-1693` and feature 247's
  deadline precedent.
- Next: `/sdd-spec fix-ingest-poller-backfill`.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 9 steps: 4 `service` + 4 paired `test` + 1 `docs` teardown.
  Status: design-approved → implementation-ready.
- Inputs:
  - design.md § Chosen Approach (mandatory); its Rejected Alternatives were excluded.
  - recon.md § Patterns to REUSE (cited directly).
  - The LAST `sdd-batch-design-state` block (the design-state correction entry). The earlier block is feature 265's
    and was ignored.
- Scenario coverage (C-15):
  - AC-1, AC-8 → Step 4;
  - AC-5, AC-7 → Step 2;
  - AC-4 → Step 6;
  - AC-2 (bars + fundamentals outline), AC-3, AC-6 → Step 8.
  - The `@AC-4 @feature-166` EXTEND (single object with `tags`) is asserted in Step 2.
- Consumer surfaces (C-14): no `xstockstrat-ui` / `xstockstrat-agent` step. The surfaces read the persisted rows
  the fix corrects, and no schema changes (no `result_key`). Recorded in § Execution Summary.
- Key codebase findings (re-verified on branch @ 2f6411ca; recon line anchors all still resolve):
  - `mcp_client_loop.py`: `_extract_result_items` `:34-52`, unguarded loop `:124-125`, `resolve_secret` call
    `:116`, timeout read `:133-138`, per-source catch `:143-152`.
  - `watcher.py`: `resolve_secret` `:146-164`, with `GetSecret` at `:155-163` and no `timeout=`. `import grpc` is
    at `:10`.
  - `servicer.py`:
    - semaphore `:493` → RUNNING `:494-499`;
    - blanket except `:510-524`;
    - fundamentals `update_job` `:544-551`;
    - `_resume_job` `:723-738` (`()` meta `:737-738`);
    - `CancelBackfill` set-add `:896` before the only CANCELED write `:900`.
  - Test fakes that must widen with `timeout=None`:
    - `_FakeSecretStub.GetSecret` `test_mcp_client.py:27`;
    - `_FakeCfgWatcher.resolve_secret` `test_mcp_client_loop.py:65`;
    - `_PerOwnerCfgWatcher.resolve_secret` `:210`.
  - `_mcp_source` default owner is `seed-user` (`test_mcp_client_loop.py:72`).
  - `int_positive` is **Not found** in `app/`, so feature 244 has not landed. Step 5 keeps
    `max(get_int(...), 1)` unless 244 merges first.
  - No migration (last ingest migration `014_contract_signal_ownership`, untouched). No proto, no config key.

### Decisions

- **Cancel tests go in `tests/test_ingest_servicer.py`, not `tests/test_cancel_backfill.py`.**
  - `make_servicer(max_concurrent=...)` (`:31`), `patch_chunk_repo` (`:431`) and the fundamentals helpers
    (`:1724-1737`) live there.
  - `test_cancel_backfill._make_servicer` hardcodes `backfill_max_concurrent_jobs = 5`.
  - This is a placement choice only; the tests are still driven through `CancelBackfill` plus repo fakes.
- **O-3 guard test RED.** It passes on today's tree (the ordering is already correct). Its RED is demonstrated at the
  TDD gate by temporarily reordering `CancelBackfill` `:896`/`:897`.
- **Merge-order row 244 → 261 (WARN) is proposed, not written.** This run's write scope is the feature directory, and
  the row needs user confirmation. Pick it up at `/sdd-review impl-spec` or `/sdd-sync`.

### Open Threads

- [ ] Add the `merge-order.md` row 244 → 261 (WARN) once confirmed.
- [ ] Step 9 files the seeded key-form defect report (`docs/reports/2026-10-22-ingest-mcp-client-timeout-seed-key-form-defect.md`).
- Ledger: no new line. The lessons are already covered by `fails.md:1688-1693` and the 2026-08-06
  durable-observable-backfills entry.
- Next: `/sdd-review fix-ingest-poller-backfill impl-spec`, then `/sdd-execute fix-ingest-poller-backfill`.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings (advisory — did not block; lifecycle unchanged, `implementation-ready`). Overlap
  level: WARN (file-level only with 244-fix-python-config-stored-zero; no proto, migration or config-key collision).
- Addressed in implementation-spec.md (commit 19c8c101):
  - [x] C-14 consumer surfaces: added a Step Dependencies no-change note plus a dev smoke-check for `/config-ui`
    signal-sources and the agent `list_signal_sources` / `cancel_backfill` + `get_backfill_status` tools.
  - [x] Step 2 Verification: dropped the assert-nothing `grep ... || true`.
  - [x] Step 8 / P-06: the O-3 guard's RED (temporarily move the `:896` set-add after the `:897-902` CANCELED write)
    must be captured in context.md by `/sdd-execute`, then the order restored.
  - [x] Step 7: added a conditional split note for the `_resume_job` trace-id minting (C-03) if execution grows large.
  - [x] Step 9: cites both 025 seed rows (`:34-36` staging, `:37-39` production) and the raw-key snapshot
    (`configServiceImpl.ts:203-213` → `watcher.py:112-118`), with a re-confirm-before-filing instruction. No later
    config migration renames the key (grep, 2026-10-22).
  - [x] Merge-order row text made concrete in § Step Dependencies (row itself still unwritten — see below).
- No change needed:
  - FR-1 / AC-8 scope drift: already resolved. product-spec.md FR-1 (`:40-48`) carries the all-fail clause and
    `@AC-8`, amended at the design gate 2026-10-22; the reviewer was handed the pre-amendment text.
- Unresolved ⚠ carried into execution:
  - Merge-order: `docs/roadmap/features/merge-order.md` row 244 → 261 (WARN) — [ ] unaddressed (outside this run's
    write scope; write at `/sdd-sync` or at the integration PR, after operator confirmation).
  - Step 5: verify feature 244's merge state on `main-dev` before executing; rebase onto its timeout read if merged —
    [ ] unaddressed.
  - Step 9 / INGEST docs: 244 Step 17 also edits the INGEST rules table near `context-constitution.md:28`; expect a
    doc-merge conflict on INGEST-9/INGEST-10 — [ ] unaddressed.
- Overlap findings: 244 shares `mcp_client_loop.py`, `watcher.py`, `test_ingest_servicer.py`,
  `test_mcp_client_loop.py`, ingest `CLAUDE.md` and both ingest constitution docs. Awareness only: config migration
  NNN 032 is claimed by both 244 and 248 (not caused by 261).

### Open Threads

- [ ] Add the `merge-order.md` row 244 → 261 (WARN) once confirmed.
- [ ] Confirm 244 merge state before Step 5.
- [ ] Step 8: record the O-3 RED run.
- Ledger: no new line.
- Next: `/sdd-execute fix-ingest-poller-backfill`.

## Session 2026-10-29 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: `git merge --no-edit origin/main-dev` into the detached checkout merged cleanly (no conflicts);
  `ledger-guard --own-slug fix-ingest-poller-backfill --base origin/main-dev --fix` reported clean, so no repair.
- Re-spec of Steps 1–9 step bodies only (Evidence / Files / Instructions / Verification), re-grepped 2026-10-29:
  - Steps 1, 3: `run_one_cycle` per-source catch is now `:140-150` (`except` `:142`, `mark_source_error` `:145`).
    `_extract_result_items` `:34-52`, loop `:124-125`, `_build_external_signal` `:72-74`, `log` `:28` unchanged.
  - Steps 2, 4, 6: `test_mcp_client_loop.py` anchors drifted (+3 for the fakes; `test_source_failure_...` `:208`,
    `_PerOwnerCfgWatcher.resolve_secret` `:247`, `test_resolve_secret_sends_exact_user_scope` `:320`); the
    `_watcher_with` import is `:19`; the inline `AioRpcError` builder is `test_ingest_servicer.py:552`.
  - Step 5: `resolve_secret` `watcher.py:150`, `GetSecret` call `:159-167`, return `:168`. `grpc.aio.AioRpcError`
    is no longer caught anywhere in `watcher.py` (259 made `_watch` catch `Exception`); `import grpc` `:10` still
    covers the new catch. **Feature 244 is merged** (code-completed): `run_one_cycle` reads the timeout via
    `int_positive(...)` at `:133-135`, so Step 5 takes the "pass 244's clamped value" branch.
  - Step 7: all `servicer.py` evidence matched exactly; only the cited test line moved (`:640`).
  - Step 8: `test_ingest_servicer.py` helper anchors drifted; `job_row` is already imported as `_job_row` (`:26`),
    so the step reuses that alias.
  - Step 9: dropped the planned `2026-10-22-ingest-mcp-client-timeout-seed-key-form-defect.md/.status` create. The
    defect is already filed as `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` (sidecar
    `wont-fix`, `ref: feature:277-fix-ingest-seeded-config-keys`; 277 demoted/canceled by the operator 2026-10-23).
    Step 9 now cites that report in the findings entry instead. Cited dotted read moved to `mcp_client_loop.py:134`.
- § Step Dependencies (outside the re-spec scope, left as written) is now stale on two points, both resolved: the
  `int_positive` "Not found" claim (244 merged) and the "not written" merge-order row (it exists at
  `merge-order.md:82`).

### Open Threads

- [x] Add the `merge-order.md` row 244 → 261 (WARN) — exists at `merge-order.md:82`.
- [x] Confirm 244 merge state before Step 5 — merged into main-dev; Step 5 re-specced onto `int_positive`.
- [ ] Step 8: record the O-3 RED run.

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)

- Mode: `sequential` (one commit per step on `feature/fix-ingest-poller-backfill`, single integration PR at the end).
  Status: `implementation-ready` → `in-progress`.
- Up-front confirmation: given by the operator's standing authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute; unattended checkpoints;
  merge-train authorized; 255/275 deferred; operator-only DB/prod steps — open the PR, hold the merge). Per-feature
  blocker decisions of 2026-10-29 were given by the operator through the session's question tool. Checkpoints:
  `report`. C-16 promotion auto-confirmed unless it changes an existing `@AC` rule (the `@AC-4 @feature-166` EXTEND
  in `mcp-client-signal-source.feature` extends, not changes, so it is in scope of the auto-confirm only if it adds
  a scenario without rewording the existing one).
- Plan: Steps 1–9 as re-specced above (TDD red-before-green for every service/test pair; Step 8 records the O-3 RED
  run here).

### Step 1 — service: FR-6 `_select_signal_list` (done 2026-10-29)

- Added `_select_signal_list` above `_extract_result_items` in `services/xstockstrat-ingest/app/engine/mcp_client_loop.py`
  (design.md § FR-6 rule order); the dict branch and the dict text-fallback route through it; `json.loads` stays
  unguarded. The `ambiguous result` `ValueError` reaches the existing `run_one_cycle` catch (no new plumbing).
- TDD: FR-6 red (scratch test, not committed — Step 2 owns the real tests): `signals`-alongside-`warnings`, two
  candidate lists raising `ambiguous result`, single object with `tags` list wrapped, sole all-dict list, text-fallback
  envelope → 6 failed / 4 passed on the pre-implementation tree → green: 10 passed. Scratch file removed.
- Verification: grep hits; `ruff check` + `ruff format --check` clean; full suite 346 passed, coverage 82.57% (≥40%).
- Deviations: none.

### Step 2 — test: FR-6 selection rule (done 2026-10-29)

- Added to `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`: `test_ac5_signals_key_selected_alongside_other_list`,
  `test_ac7_two_candidate_lists_records_ambiguous_error`, `test_single_signal_object_with_tags_is_wrapped` (parametrized
  `["ai"]` / `[]` — the `@AC-4 @feature-166` EXTEND), `test_all_empty_envelope_returns_no_items_silently` (O-2, `caplog`),
  `test_sole_dict_list_selected`, `test_text_fallback_signals_envelope`; shared via inline `_item` / `_run_cycle_with`
  helpers (C-13: single consumer, no fixture home).
- TDD: AC-5 red: one ingest expected, none awaited; AC-7 red: `ambiguous result` not recorded (alerts ingested); tags
  wrap red (both variants); text-fallback red → 5 failed / 12 passed against the pre-Step-1 `mcp_client_loop.py`
  (`0c6aae42`, swapped in temporarily) → green: 17 passed. All-empty envelope and sole dict list are characterization
  (already green on the old first-list rule).
- Verification: module 17 passed; full suite 353 passed, coverage 84.10% (≥40%); `ruff check` + `ruff format --check`
  clean. Run with `uv run --extra dev` (plain `uv run` re-syncs without the dev extra and falls back to a global pytest).
- Deviations: none.

### Step 3 — service: FR-1 per-item guard, summary log, all-fail raise (done 2026-10-29)

- `poll_one_source` in `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` now wraps each ingest in
  `try/except` (`item skipped` warning), always logs `polled ingested=<n> skipped=<m>` before any raise, and raises
  `RuntimeError("all <N> items failed: <first_err>")` only when every parsed item failed, so the existing
  `run_one_cycle` catch records it as `last_error`. A partial failure does not call `mark_source_error`; `owner=owner`
  is kept on every ingest.
- TDD: AC-1 red: partial batch aborted on the first failing item (1 of 3 awaited, `boom BAD` recorded as source error);
  AC-8 red: `last_error` was `boom BAD`, not `all 2 items failed` → 2 failed on the pre-implementation tree → green: 2
  passed. Scratch test (ingest mock raising per symbol), not committed — Step 4 owns the real tests; file removed.
- Verification: grep hits at `:149`/`:153`/`:155`; `ruff check` + `ruff format --check` clean; full suite 353 passed,
  coverage 83.83% (≥40%).
- Deviations: none.

### Step 4 — test: FR-1 isolation and all-fail (done 2026-10-29)

- Added to `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`: `test_ac1_one_failing_item_does_not_drop_batch`
  and `test_ac8_all_items_failed_records_last_error` (source `src-a`, owner `u-1`, `caplog` on `app.engine.mcp_client_loop`
  at INFO). `_run_cycle_with` gained optional `source=` / `ingest=` kwargs so both reuse the Step 2 helper (C-13:
  single consumer, data inline).
- TDD: AC-1 red: `assert 2 == 3` awaits (batch aborted at the failing item); AC-8 red: `all 1 items failed` not
  recorded (`last_error` was `boom`) → 2 failed / 17 passed against the pre-Step-3 `mcp_client_loop.py` (`f847487f`,
  swapped in temporarily, then restored) → green: 19 passed.
- Verification: module 19 passed; full suite 355 passed, coverage 84.24% (≥40%); `ruff check` + `ruff format --check`
  clean. `test_source_failure_records_health_and_continues` and `test_second_identical_cycle_deduplicates` stay green.
- Deviations: none.

### Steps 5 + 6 — FR-5 GetSecret deadline + AC-4 tests (done 2026-10-29, one commit)

- Operator decision (session question tool, 2026-10-29, own words): "Merge pairs + standing rule" — Step 5's call-site
  change breaks Step 6's fakes and Step 5's RED test is Step 6's, so both land as one commit (Deviation Log).
- `ConfigWatcher.resolve_secret` (`app/config/watcher.py`) takes `timeout: float | None = None`, passes `timeout=` to
  `GetSecret` (request + `x-internal-caller` metadata unchanged), and translates only `DEADLINE_EXCEEDED` into
  `RuntimeError("GetSecret deadline exceeded after <t>s")` (no key/value; `__cause__` kept); other codes re-raise
  untranslated. `poll_one_source` passes `timeout=float(timeout_seconds)` (244's `int_positive` read untouched).
- Tests: fakes widened with `timeout`; `test_resolve_secret_passes_timeout_and_translates_deadline`,
  `test_resolve_secret_permission_denied_is_not_translated` (`test_mcp_client.py`) and
  `test_ac4_hung_getsecret_is_bounded_and_recorded` (`test_mcp_client_loop.py`). C-13: the shared `AioRpcError`
  builder's new home is `tests/_helpers.py::rpc_error` (two consumers).
- TDD: red → 3 failed / 23 passed (`TypeError: resolve_secret() got an unexpected keyword argument 'timeout'` ×2;
  AC-4 `assert [None, None] == [2.0, 2.0]`, GetSecret unbounded) → green: 26 passed.
- Verification: Step 5 greps hit (call-site grep in its ruff-wrapped form, per operator); full suite 358 passed,
  coverage 84.29% (≥40%); `ruff check` + `ruff format --check` clean; `DEADLINE_EXCEEDED` present in `tests/`.
- Deviations: Steps 5+6 merged; Step 5 grep form (both logged in the Deviation Log).

### Step 7 — service: FR-2/FR-3/FR-4 cancel guards and resumed-job trace id (done 2026-10-29)

- `services/xstockstrat-ingest/app/handlers/servicer.py`: FR-2 guard is the first statement inside
  `async with self._backfill_sem:` in `_run_backfill` (discard + `canceled while queued; not starting` + return, no DB
  read; 2-line constraint comment: single-instance ingest, `CancelBackfill` adds to `_canceled_jobs` before its
  CANCELED write); the same guard is the first statement of its blanket `except` (no FAILED write/event/alert for a
  canceled job); FR-3 guard in `_execute_fundamentals_backfill` between `failed = ...` and the COMPLETED/PARTIAL
  `update_job`; FR-4 in `_resume_job` skips a persisted `CANCELED` row after the `row is None` return, then mints
  `meta = (("x-trace-id", str(uuid.uuid4())),)` and passes it to `_run_chunks` / `_finalize_backfill`. No `await`
  between any check and the write it guards. `resume_incomplete_jobs`, `_finalize_backfill`, `run_one` and the
  `data_kind` dispatch untouched.
- TDD: scratch probe (not committed; Step 8 owns the real tests) — queued cancel bars/fundamentals (RUNNING written,
  `assert 2 not in [2, 4]` / `[2, 3]`), fundamentals cancel mid-run (`[2, 3] == [2]`), cancel-then-error (`assert 4
  not in [2, 4]`, FAILED written), canceled job resumed (`TypeError` from the unpatched chunk path — resume ran),
  resumed-job trace id (`{}.get('x-trace-id')` → None) → 6 failed on the pre-implementation tree → green: 6 passed.
  Scratch file removed.
- Verification: `_canceled_jobs` / `skipping resume of canceled job` / `x-trace-id", str(uuid.uuid4())` greps hit;
  full suite 358 passed, coverage 83.65% (≥40%); `ruff check` + `ruff format --check` clean.
- Deviations: none. The standing "merge pairs" rule did not apply: Step 7's Verification passes on its own.

### Step 8 — test: cancel durability (AC-2 outline, AC-3, AC-6) + O-3 ordering guard (done 2026-10-29)

- `services/xstockstrat-ingest/tests/test_ingest_servicer.py`: new `TestCancelDurability` (after the resume tests) with
  `test_ac2_queued_cancel_never_runs[bars|fundamentals]`, `test_ac3_canceled_job_not_resumed_after_restart`,
  `test_ac6_fundamentals_canceled_mid_run_stays_canceled`, `test_o3_cancel_registers_set_before_canceled_write`,
  `test_resume_job_sends_minted_trace_id`, plus module helpers `_status_writes` / `_events_for` / `_until`. Cancels go
  through `CancelBackfill(_ctx("4"))` + repo fakes; `_canceled_jobs` is never mutated, and is read only by the O-3
  fake at the CANCELED write (the invariant itself). `job_row` reused via the existing `_job_row` alias (C-13);
  event-gated marketdata fakes stay inline. Existing resume tests untouched and green.
- TDD: Step 7 had already landed, so RED was taken against a temporarily restored pre-Step-7 `servicer.py` (then
  restored): 5 failed / 1 passed — AC-2 bars `assert 2 not in [6, 2]` and fundamentals `assert 2 not in [6, 2, 3]`
  (job-B written RUNNING), AC-3 `update_job` "Awaited 4 times" (canceled job resumed), AC-6 `assert 3 not in [2, 6, 3]`
  (COMPLETED over CANCELED), trace id `{}.get('x-trace-id')` → None; O-3 passed (regression guard). O-3 RED (P-06):
  set-add moved after the CANCELED `update_job` in `CancelBackfill` → `assert [False] == [True]`; order restored,
  `servicer.py` unchanged by this commit. GREEN: 6 passed.
- Verification: `test_ingest_servicer.py` + `test_cancel_backfill.py` 119 passed; full suite 364 passed, coverage
  84.19% (≥40%); `ruff check` + `ruff format --check` clean; `_job_row` import grep hits `:26`.
- Deviations: none. The standing "merge pairs" rule did not apply.

### Step 9 — docs: teardown (resume drift, single-instance invariant, findings) (done 2026-10-29)

- `services/xstockstrat-ingest/CLAUDE.md` § Database (`ingest.backfill_jobs`): startup reconciles every
  RUNNING/QUEUED job to FAILED, then `resume_incomplete_jobs` re-drives jobs with PENDING/FAILED chunks, skipping a
  persisted `CANCELED` job; a job canceled while QUEUED never starts. The "FR-3 — no automatic resume" claim is gone.
- `services/xstockstrat-ingest/docs/context-constitution.md`: **INGEST-10** — cancel guards read only the in-memory
  `_canceled_jobs` set; valid only with `instance_count: 1` (`.do/app.yaml` and `.do/app.dev.yaml`, both checked) and
  `CancelBackfill` as the sole CANCELED writer (grep: the only `status=…CANCELED` write in `app/`), set-add before
  write; guard test `test_o3_cancel_registers_set_before_canceled_write` (present at `tests/test_ingest_servicer.py:842`,
  landed in Step 8). Scaling past one instance re-opens D-34.
- `services/xstockstrat-ingest/docs/context-constitution-findings.md`: "Documentation that lies" rows for the
  `app/main.py` ~L66 / ~L117-118 comment drift (fix when `main.py` is next touched; `main.py` untouched) and for the
  inert seeded `mcp_client.request_timeout_seconds` (re-confirmed: both 025 rows bare at `:34`/`:37`; config
  `reloadNamespace` keys by raw `row.key` `configServiceImpl.ts:204-213`; only 025 mentions the key among config
  migrations; 029 excludes `ingest`), citing the existing `wont-fix` report
  `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md`. No new report filed (re-spec 2026-10-29).
- Teardown: the context-forge `context-constitution` skill is not available in this session (only
  `context-scrubber`), so the scoped refresh was manual — drifted `~L` hints into `servicer.py`,
  `mcp_client_loop.py` and `config/watcher.py` re-resolved and re-stamped in both constitution docs; header stamps
  updated. The integration PR body must state this (root CLAUDE.md § Teardown).
- TDD: N/A (docs). Verification: all four greps hit and the duplicate report path is absent.
- Deviations: manual teardown reconciliation (Deviation Log). The standing "merge pairs" rule did not apply.

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan — fix-ingest-poller-backfill (feature 261)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature | CREATE | NEW | per-item isolation in the mcp_client batch. Related to 166 AC-4 but asserts different outcomes. |
| AC-2 (Outline, bars + fundamentals) | same | CREATE | NEW | queued-cancel stays CANCELED. No existing suite covers CancelBackfill lifecycle. |
| AC-3 | same | CREATE | NEW | canceled job is not resumed after restart. |
| AC-4 | same | CREATE | NEW | GetSecret is bounded by request_timeout_seconds. 166 AC-3/AC-5 do not assert a deadline. |
| AC-5 | same | CREATE | NEW | signal list is found when another list is present. |
| AC-6 | same | CREATE | NEW | cancel mid-run is not finalized as COMPLETED or PARTIAL. |
| AC-7 | same | CREATE | NEW | ambiguous result shape is recorded as a source error. |
| AC-8 | same | CREATE | NEW | all-items-failed batch is recorded as a source error. |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature (CREATE) ---
# Promoted from docs/roadmap/features/261-fix-ingest-poller-backfill/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-261` tag.
# Durable business rules xstockstrat-ingest guarantees for the mcp_client poller and backfill cancel lifecycle.

Feature: xstockstrat-ingest - mcp_client poller isolates failures and backfill cancel is final
  Regression guard for docs/reports/2026-10-21-ingest-poller-backfill-defect.md:
  the ingest mcp_client poller drops or stalls signals, and canceled backfills are revived.

  @AC-1 @FR-1 @regression @feature-261
  Scenario: One failing item does not drop the rest of an mcp_client batch
    Given an active mcp_client source "src-a" for user "u-1" whose fetch returns 3 items that all pass extraction
    And ingesting item 2 raises an error
    When one poll cycle runs
    Then the signals for item 1 and item 3 are ingested for user "u-1"
    And the poll emits a log record for source "src-a" with a skipped count of 1
    And source "src-a" has no last_error from this poll

  @AC-2 @FR-2 @regression @feature-261
  Scenario Outline: A backfill canceled while queued stays CANCELED and never runs
    Given ingest.backfill.max_concurrent_jobs is 1
    And backfill job "job-A" is RUNNING and a <kind> backfill job "job-B" is QUEUED behind it
    When job "job-B" is canceled and then job "job-A" finishes
    Then job "job-B" status is CANCELED
    And no "ingest.backfill.running" event is emitted for "job-B"
    And marketdata <rpc> is never called for "job-B"

    Examples:
      | kind         | rpc                  |
      | bars         | BackfillBars         |
      | fundamentals | BackfillFundamentals |

  @AC-3 @FR-4 @regression @feature-261
  Scenario: A canceled backfill is not resumed after a restart
    Given backfill job "job-C" is CANCELED and still has 2 PENDING chunks
    When ingest restarts and resume_incomplete_jobs runs
    Then job "job-C" status is CANCELED
    And no chunk of job "job-C" is executed

  @AC-4 @FR-5 @regression @feature-261
  Scenario: A hung GetSecret is bounded and recorded as that source's error
    Given ingest.mcp_client.request_timeout_seconds is 2
    And active mcp_client sources "src-a" and "src-b"
    And GetSecret for "src-a" never responds
    When one poll cycle runs
    Then the cycle completes within 10 seconds
    And ListSignalSources shows a deadline error in the last_error of "src-a"
    And source "src-b" is polled in the same cycle

  @AC-5 @FR-6 @regression @feature-261
  Scenario: The signal list is found when the result also carries another list
    Given an active mcp_client source "src-a" whose fetch returns structured content {"warnings": [], "signals": [one valid AAPL item]}
    When one poll cycle runs
    Then 1 signal for "AAPL" is ingested

  @AC-6 @FR-3 @regression @feature-261
  Scenario: A fundamentals backfill canceled mid-run is not finalized as COMPLETED or PARTIAL
    Given fundamentals backfill job "job-D" is RUNNING with its BackfillFundamentals call in flight
    When job "job-D" is canceled and then the BackfillFundamentals call returns success
    Then job "job-D" status is CANCELED
    And get_backfill_status for "job-D" reports CANCELED

  @AC-7 @FR-6 @regression @feature-261
  Scenario: An ambiguous result shape is recorded as a source error
    Given an active mcp_client source "src-a" whose fetch returns structured content {"alerts": [one valid MSFT item], "rows": [one valid TSLA item]}
    And no rule selects either list as the signal list
    When one poll cycle runs
    Then no signal is ingested for source "src-a"
    And ListSignalSources shows an ambiguous-result error in the last_error of "src-a"

  @AC-8 @FR-1 @regression @feature-261
  Scenario: A batch in which every item fails is recorded as the source's error
    Given an active mcp_client source "src-a" for user "u-1" whose fetch returns 1 item that passes extraction
    And ingesting that item raises an error
    When one poll cycle runs
    Then no signal is ingested for source "src-a"
    And the poll emits a log record for source "src-a" with a skipped count of 1 before the error is recorded
    And ListSignalSources shows an "all 1 items failed" error in the last_error of "src-a"

### Notes / ambiguities / conflicts
- Attribution: every scenario's observable subject (poller, backfill_jobs, ListSignalSources, get_backfill_status) is in xstockstrat-ingest. No platform.feature entry is needed. The acceptance/ directory already exists, so only the file is created.
- No CONFLICT and no OVERLAP. Checked against these suites:
  - services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature (feature 166) has AC-3 (GetSecret bearer), AC-4 (parse into ExternalSignals) and AC-5 (unreachable endpoint records health). These are extended by 261 (per-item isolation, deadline, list selection), not contradicted.
  - historical-fundamentals-backtest.feature, fix-python-config-stored-zero.feature and fix-python-config-zero-trap.feature cover other backfill facets.
  - docs/sdd/business-rules/platform.feature only has the per-user mcp_client credential scenario at ~line 307 and config-key zero-trap rows.
- services/xstockstrat-ingest/CLAUDE.md says startup reconciles RUNNING/QUEUED jobs to FAILED with no automatic resume, while chunk-level re-drive exists. AC-3 only constrains CANCELED jobs and does not contradict this.
- @AC numbers repeat across suites (166 AC-4 and 261 AC-4, for example). They are disambiguated by the @feature-NNN tag, as in the existing files.

### Coverage check
- Source scenarios: 8 (AC-1..AC-8, with AC-2 an Outline of 2 examples). Planned: 8 NEW, 0 DUP, 0 OVERLAP, 0 skipped. Counts match.
```

## Session 2026-10-30 (CI: feature status automation)

- Promotion PR #1368 merged to main
- Feature promoted and committed: df521ff51091a86e813950b34afff09ac4e8821b
- Status updated: `code-completed` → `launched`
- Launched date: 2026-10-30
