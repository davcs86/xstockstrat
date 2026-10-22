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
