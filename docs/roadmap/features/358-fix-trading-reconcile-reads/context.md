# Context Log: fix-trading-reconcile-reads

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md` (no GitHub issue — Issues disabled): trading reconcile reads only the first 500 platform positions per account
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-2
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-trading (upstream, unchanged: xstockstrat-portfolio `ListPositions`)
- Root cause hypothesis: Reconcile assumed one page per account while the token was unreliable (fixed by feature 353). Fix: drain the cursor, failing closed per `docs/roadmap/ledger/fails.md:3311` (page error → skip the account for the tick), tested against a fake that ignores the token.
- Recommended design depth: quick → `/sdd-design fix-trading-reconcile-reads quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-trading-reconcile-reads
- Twin: feature 357 `fix-portfolio-internal-position` (portfolio internal readers), split by operator decision 2026-11-17.
- A false finding halts the account — the fail-safe direction is skip-the-tick, never a halt on an incomplete read.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (criteria verdict: PASS WITH WARNINGS, no fails, no floor breaches):
  1. C-2 (trading domain): FR-4 did not name broker types — **resolved** this session: FR-4 now states the change is broker-agnostic (portfolio read only) and covers every broker type `reconcileTick` covers today except `BROKER_TYPE_OFFLINE`, which `reconcileTick` already skips (`trading.go` offline-skip in the broker map build).
  2. Criterion 8: `@FR-4` attaches only to AC-1 with no named broker type; FR-4's "order-side reconcile and `GetPositions` unchanged" clause relies on the existing order-side tests — accepted for a bug fix, open for design.
  3. FR-2 also covers a deadline failure; AC-2 tests only `Unavailable` — advisory (same `ppErr`-style skip path); design may add a deadline case.
  4. The batch-supplied feature path was malformed (`docs/roadmap/features/docs/roadmap/features/358-…/`); the files live at `docs/roadmap/features/358-fix-trading-reconcile-reads/` — caller path issue, not a spec issue.
  5. Dependency on feature 353 (code-completed, must merge first) is stated in prose only — carry it into merge-order/status tracking so 358 cannot merge ahead of 353 (not edited here: this session may edit only this feature dir).
- Overlap findings: none (overlap verdict PASS, no collisions).
- Recommended design depth: quick (SEV-2 bug, single service xstockstrat-trading, no proto/migration/config/consumer-surface change).

OPERATOR DECISIONS (binding, recorded 2026-11-17):
- Operator 2026-11-17: split from feature 357 (portfolio internal readers); scope is only trading reconcileTick's platform-position read.
- Fail-safe direction is skip-the-account-for-the-tick on any incomplete read, never a halt; follow docs/roadmap/ledger/fails.md:3311 (fail closed, reject a repeated token, test against a fake that ignores the token).
- Do not touch features 351, 353 or 354.
- Red-before-green is mandatory.

## Session 2026-11-17 — sdd-batch design gate (round 2)

`/sdd-design fix-trading-reconcile-reads` full debate halted at its approval gate after round 2 (gate policy: halt). design.md is NOT written and status.md is unchanged (still spec-ready). The debate register is `debate.md` (D-1..D-12, R-1..R-8, O-1..O-9).

## Open Threads

- **Approach**: the code design is unchanged and rests on D-1..D-8. A trading-local helper `listAccountPlatformPositions` drains portfolio `ListPositions` in pages of the const `reconcilePositionsPageSize = 500`. Each page gets its own `context.WithTimeout(broker.timeout_ms)` with `x-user-id`, and `cancel()` runs right after the call, never deferred in the loop. The helper returns either the complete set or a `nil` slice plus a `%w`-wrapped, 1-based page-indexed error. `reconcileTick:2231-2239` calls the helper, and the existing ppErr skip at `:2240-2243` stays byte-for-byte: WARN and continue, no candidate, no halt, nothing systemic. Round 2 adds D-9: in each page the token guards (empty page with a token, repeated `next_page_token`) run before the symbol merge, and the duplicate-symbol check runs after them. Tests are written RED first in `trading_reconciliation_test.go` with a paging fake capped at 100 calls:
  - AC-1, with the corrected rationale: RED comes from the finding and halt that today's code emits at tick 1 (`trading.go:2042-2044`).
  - A positive control asserting the payload `expected == 5` (D-10).
  - AC-2 error.
  - AC-2 deadline, asserting page-2 `ctx.Deadline()` is strictly after page 1's (D-11).
  - AC-3 with an ignore-token fake.
  - A direct-helper hardening table with exact error text per guard (D-12).
- **Strongest open objection (blocking, O-6)**: AC-3 has to exercise the repeated-token guard (FR-3/D-4), not the duplicate-symbol guard. In the r2 order (merge first), the D-5 duplicate check shadowed the seen-token check, so deleting the seen-token check left the suite green (fails.md:3312). The synthesis folds in D-9 and a direct-helper row asserting `page 2: repeated next_page_token "p2"`. The objection stays open until the next proposal adopts both concretely. O-7, O-8 and O-9 are non-blocking test-text refinements and are open (payload `expected == 5`, the AC-1 RED rationale, and D-3 vs R-1 deadline discrimination). O-1..O-5 closed at round 2.
- **Floor status**: no floor breaches.
- **Uncovered @AC changes**: `358 @AC-1` EXTEND is not covered by an operator decision. `358 @AC-2` and `@AC-3` EXTEND are covered (operator 2026-11-17: skip, never halt). PRESERVE only: `@AC-1/@AC-2/@AC-3 @feature-206` (fix-reconciliation-false-halt.feature) and `@AC-45 @feature-294` (signal-map-instrumentation.feature).
- **Open risks**:
  - A skipped tick is visible only through the WARN (no metric, D-8).
  - Tick wall-clock time grows to ceil(n/500) × broker.timeout_ms.
  - `resolveUnknownIntents` is skipped whenever the platform read is incomplete.
  - The rejections rely on portfolio's UNIQUE index (migrations/003:10) and feature 353's paging.
  - The deadline-ordering assertion needs page 1 to sleep a few ms.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The code design is unchanged and rests on D-1 through D-8. This round fixes the order of checks inside each page so that every guard can be tested on its own, and it tightens the test assertions that the adversary showed were vacuous or wrongly reasoned.\n\n**Service change** (`services/xstockstrat-trading/internal/service/trading.go`)\n- Add a package const `reconcilePositionsPageSize = 500`.\n- Add a helper next to reconcileTick: `func (s *TradingService) listAccountPlatformPositions(ctx context.Context, accountID, userID string, mode commonv1.TradingMode, timeout time.Duration) ([]*portfoliov1.Position, error)`.\n- Per page `i` (1-based), the helper:\n  1. Creates `pctx, cancel := context.WithTimeout(ctx, timeout)` and appends `x-user-id`, as `:2231-2234` does today.\n  2. Calls `ListPositions` with `Page{PageSize: reconcilePositionsPageSize, PageToken: token}`.\n  3. Calls `cancel()` as soon as the call returns. It must not `defer` inside the loop.\n  4. On an RPC error, returns `nil, fmt.Errorf(\"page %d: list positions: %w\", i, err)`.\n  5. Reads `next := resp.GetPage().GetNextPageToken()`.\n  6. Runs the token guards before merging any symbols (D-9):\n     - empty page with `next != \"\"` → `\"page %d: empty page with next_page_token %q\"`\n     - `next != \"\"` and `next` already in the seen set → `\"page %d: repeated next_page_token %q\"`\n  7. Merges the page's symbols. A symbol already seen gives `\"page %d: duplicate symbol %q across pages\"`.\n  8. If `next == \"\"`, returns the full set. Otherwise it adds `next` to the seen set and continues with `token = next`.\n- On every error the helper returns `nil`, never a partial slice.\n- Change `reconcileTick`:\n  - `:2231-2239` becomes `platformPositions, ppErr := s.listAccountPlatformPositions(ctx, accountID, entry.userID, tradingMode, timeout)`.\n  - `:2240-2243` stays byte-for-byte: WARN and continue, nothing counted as systemic, `resolveUnknownIntents` skipped.\n  - `:2244-2247` ranges over the returned slice.\n  - Nothing else changes.\n- Put a comment of at most 2 lines on the seen set saying it is defense-in-depth against a monotonic keyset cursor (O-5). The full rationale goes in the PR description.\n\n**Tests, written RED first** (`services/xstockstrat-trading/internal/service/trading_reconciliation_test.go`)\n\nShared setup:\n- One file-local paging fake sets `fakeReconciliationPortfolioClient.listPositionsFn` (:124). It records each call's `PageToken`, `ctx.Deadline()` and `x-user-id` under a mutex. It enforces `pagingCallCap = 100`, mirroring `services/xstockstrat-portfolio/internal/service/portfolio_pnl_paging_test.go:27-28,43`. It serves pages by token, and has an `ignoreToken` mode plus per-token hooks for errors and blocking.\n- The broker `getPositionsFn` (:81) returns SYM001..SYM501 at qty 10. `fakePositionQtyLookup` (:228) is empty. `recordingLedgerClient` (:137).\n- Each test runs graceTicks=1 and calls `reconcileTick` twice, following `:554-555`.\n- Halt state is read through `isAccountHalted` (`trading.go:2892`).\n\n1. **AC-1**\n   - Pages: page 1 is SYM001..500 with next token \"p2\"; page 2 is SYM501 with next token \"\".\n   - Pre-seed `reconcileCandidates[\"acc-1:pos:SYM501\"] = 1`.\n   - After tick 1, assert together: the key is absent, there is no `reconciliation.mismatch_found`, and the account is not halted.\n   - Assert exactly 2 calls per tick, with tokens `[\"\", \"p2\"]`.\n   - Corrected RED rationale: on today's code tick 1 increments the seed to 2 ≥ 1+graceTicks, so `recordReconciliationCandidate` (`trading.go:2042-2044`) deletes the key and emits a finding and a halt. RED therefore comes from the finding and halt assertions, not from the seed \"surviving\". The seed-absent plus no-finding pair is what separates a correct compare from a skip, because a skip leaves the seed at 1.\n2. **Positive control** (guards durable `@AC-2 @feature-206`)\n   - Same pages, but SYM501 on page 2 has qty 5 against broker qty 10.\n   - Assert `reconciliation.mismatch_found` for SYM501 with payload `expected == 5` (from `trading.go:2286` platformQty and the `:2064-2068` payload), and that the account is halted.\n   - Assert 2 calls per tick.\n   - This is now a real RED test: today SYM501 reads as platform qty 0, so the payload has `expected == 0`.\n3. **AC-2 (error)**\n   - Page \"p2\" returns `codes.Unavailable`.\n   - Assert a call with token \"p2\" was made, and that there is no `acc-1:pos:` candidate, no finding and no halt.\n   - It fails RED on today's code: SYM501 is absent, diverges at `:2256` and halts. The \"p2\" assertion is a GREEN-side guard.\n4. **AC-2 deadline variant**\n   - `svc.cfgW = config.MustSnapshotWatcher(...)` with `broker.timeout_ms = 50`, the seam used at `trading_ibkr_auth_test.go:121-126`. `GetFloat` widens an IntVal (`internal/config/watchcore.go:411-416`), so IntVal or FloatVal both work.\n   - Page 1 sleeps about 5 ms, then succeeds. Page \"p2\" blocks on `<-ctx.Done()`.\n   - Assert the same skip outcomes as AC-2.\n   - To pin D-3, assert page 2's recorded `ctx.Deadline()` is strictly after page 1's. A shared deadline (R-1) gives equal deadlines; per-page timeouts give a later one.\n5. **AC-3**\n   - The fake ignores the token and always returns page 1 with token \"p2\".\n   - Assert exactly 2 calls per tick, and no candidate, finding or halt.\n   - Because of D-9, call 2 is rejected by the repeated-token guard before any symbol is merged.\n   - RED: today the account halts on SYM501.\n6. **Hardening table** (calls the helper directly, so no log capture is needed)\n   - Asserts the exact error text, so deleting any single guard turns a row red.\n   - Rows:\n     - `page 2: repeated next_page_token \"p2\"`, using the ignore-token fake\n     - `page 2: empty page with next_page_token`\n     - `page 2: duplicate symbol \"SYM500\"`, using a fake whose page 2 repeats SYM500 under a fresh token\n     - `page 2: list positions:`, which must still satisfy `status.Code(errors.Unwrap(...)) == codes.Unavailable`\n\nBuild order:\n1. Write tests 1-5 and confirm they are RED on unchanged code. Test 6 depends on the helper's signature, so it is added in step 2.\n2. Make the service change and add test 6.\n3. Run `GOWORK=off go test ./...` in `services/xstockstrat-trading`. The existing `trading_ibkr_auth_test.go` and `trading_telemetry_test.go` use the default empty single page (:131), which has no `Page`, so `next == \"\"` and the drain makes 1 call.\n4. Add one sentence at `services/xstockstrat-trading/docs/reconciliation.md:57`.\n\nNo proto, migration, config or portfolio change. Features 351, 353 and 354 are untouched.",
    "open_objections": [
      {
        "text": "[C-15; fails.md:3312] As proposed in r2, AC-3 never exercises the repeated-token guard (FR-3/D-4). The helper merges symbols before it reads the token, so on the ignore-token repeat the duplicate-symbol check (D-5) fires first, and deleting the seen-token check leaves every test green. The synthesized approach fixes this with D-9 (token guards run before the symbol merge) and a direct-helper hardening row that asserts `page 2: repeated next_page_token \"p2\"`. This stays open until the next proposal adopts both concretely.",
        "blocking": true
      },
      {
        "text": "[C-16, guards @AC-2 @feature-206] The positive control must assert the mismatch_found payload `expected == 5` (trading.go:2286 → :2064-2068). Without it, a drain that fetches page 2 and then discards it still passes (SYM501 reads as 0, which differs from 10). With it, the test becomes a real RED test instead of a GREEN-only guard.",
        "blocking": false
      },
      {
        "text": "[C-15] The AC-1 RED rationale is factually wrong. On today's code the seeded key does not 'survive and grow': tick 1 increments it to 2 >= 1+graceTicks, and recordReconciliationCandidate deletes it and emits (trading.go:2042-2044). The spec must pair 'key absent after tick 1' with 'no finding and not halted after tick 1', and must state that RED comes from the finding and halt assertions.",
        "blocking": false
      },
      {
        "text": "[C-15, D-3] The r2 deadline check ('page-1 ctx was still live') cannot tell D-3 apart from the locked R-1. The spec must instead assert that page 2's recorded ctx.Deadline() is strictly after page 1's, with page 1 sleeping a few ms so the clock is guaranteed to advance.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "358 @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "358 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "358 @AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-1 @feature-206 (fix-reconciliation-false-halt.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-206 (fix-reconciliation-false-halt.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-206 (fix-reconciliation-false-halt.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-45 @feature-294 (signal-map-instrumentation.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Merging symbols before the token checks on each page (the r2 order). It lost because the duplicate-symbol guard then shadows the repeated-token guard on every ignore-token fake, which leaves FR-3 untested (fails.md:3312).",
      "Giving AC-3's fake fresh symbols on the repeat as the only fix (adversary option b). It lost because it leaves the guard order unspecified. Running the token checks first plus the direct-helper error row pins each guard independently and costs nothing.",
      "Using 'page-1 ctx still live during the call' as evidence of per-page deadlines. It lost because it holds under both D-3 and the locked R-1. Strictly increasing per-page ctx.Deadline() is the deterministic discriminator.",
      "Recording 'a legitimate duplicate symbol across pages' as the strongest risk. It lost because positions.account_id is NOT NULL DEFAULT 'alpaca-default' and UNIQUE(user_id, symbol, trading_mode, account_id) (portfolio migrations/003:2,10), and trading filters on user, mode and account. Only a broken cursor can produce a duplicate, which is the premise of D-5/R-3.",
      "Asserting halt state through the raw svc.halted map. It lost to isAccountHalted (trading.go:2892), the accessor the production path uses."
    ],
    "open_risks": [
      "Each skipped tick is logged only by a cause-tagged WARN. A persistent server-side cursor bug would leave an account's position side unchecked indefinitely, with no metric or alert. A metric is out of scope (YAGNI, D-8).",
      "Tick wall-clock time grows by up to ceil(n/500) × broker.timeout_ms per large account, and the account loop is sequential. Portfolio's per-page enrichPositions quote fetch (marketdata.quote_timeout_ms 4000 against a broker timeout of 5000) makes page deadlines more likely on big accounts.",
      "resolveUnknownIntents stays skipped for an account whenever its platform read is incomplete (existing behaviour, trading.go:2240-2243 continue). An extended portfolio outage therefore also delays UNKNOWN-intent resolution.",
      "The duplicate-symbol and repeated-token rejections rely on portfolio's UNIQUE(user_id, symbol, trading_mode, account_id) (migrations/003:10) and on feature 353's exactly-once keyset paging. A future portfolio change that splits a symbol across rows would cause false skips, not false halts.",
      "The deadline-ordering assertion relies on the monotonic clock advancing between page calls. A few ms of sleep on page 1 is required, or the assertion could flake on equality."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-07",
      "P-03",
      "PLAT-4",
      "PLAT-N1"
    ],
    "rationale": "I verified the adversary's factual claims against the code.\n- `recordReconciliationCandidate` deletes the key at >= 1+graceTicks (trading.go:2042-2044), so the r2 AC-1 seed rationale is wrong.\n- `emitReconciliationFinding` puts platformQty into `expected` (:2064-2068, called at :2286), so an `expected==5` assertion makes the positive control a real RED test.\n- `GetFloat` widens an IntVal (watchcore.go:411-416).\n- portfolio migrations/003 makes account_id NOT NULL with a 4-column UNIQUE, so r2's 'strongest risk' is not real.\n\nThe blocking flaw is real: if the helper merges symbols before it checks the token, the ignore-token AC-3 fake is stopped by the D-5 duplicate check, and FR-3's guard is never exercised. That is the exact fails.md:3312 pattern. The cheapest fix runs the token guards before the symbol merge (D-9) and adds a direct-helper error-text row, so each guard can be deleted without the suite staying green. This does not contradict D-4 or D-5. It only fixes evaluation order, so it is a new decision.\n\nO-1 through O-5 close on their stated terms:\n- O-1: r2 delivered a concrete positive-control halt test and the AC-1 call, token and seed assertions.\n- O-2: a deadline variant now exists.\n- O-3: errors are %w-wrapped, page-indexed and cause-specific, including repeated-token text.\n- O-4: AC-2 RED is correctly reasoned.\n- O-5: the seen set is described as defense-in-depth.\n\nThe adversary's further refinements (the payload assertion, the AC-1 rationale correction, and pinning D-3 against R-1) are new defects in r2's test text rather than unmet parts of the old objections. They are recorded as new non-blocking objections and folded into the approach.\n\nRegister check: no D-n is contradicted, no R-n is reintroduced (the deadline test now explicitly discriminates against R-1), and no O-n is re-raised. No reopen petitions came from either side.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Within each page, the helper runs the token guards (empty page with a token, repeated next_page_token) before merging that page's symbols, and only then runs the duplicate-symbol check. This makes the FR-3 repeated-token guard reachable and testable independently of D-5.",
          "evidence": "adversary r2 blocking objection; fails.md:3312; ignore-token fake pattern at portfolio_pnl_paging_test.go:34,49"
        },
        {
          "text": "The positive-control test asserts that the mismatch_found payload has expected == 5 (the page-2 platform qty). This makes it a RED test that proves page-2 data was used in the compare.",
          "evidence": "trading.go:2286 emitReconciliationFinding(..., platformQty, bp.Quantity); payload at :2064-2068"
        },
        {
          "text": "D-3 is pinned by asserting that each page call's recorded ctx.Deadline() is strictly later than the previous page's (page 1 sleeps a few ms). Liveness of page 1's ctx is not used as evidence.",
          "evidence": "adversary r2; R-1 (a shared deadline yields equal deadlines)"
        },
        {
          "text": "Each guard is pinned by a direct-helper hardening row asserting its exact page-indexed error text (repeated token, empty page with a token, duplicate symbol, and an RPC error that still unwraps to codes.Unavailable).",
          "evidence": "trading.go:2241 WARN; O-3"
        }
      ],
      "new_rejected": [
        {
          "text": "Merging a page's symbols before its token checks",
          "why": "The D-5 duplicate-symbol guard then shadows the D-4 repeated-token guard on ignore-token fakes, leaving FR-3 untested (fails.md:3312)."
        },
        {
          "text": "Using 'page-1 ctx still live during the call' as evidence of per-page deadlines",
          "why": "It holds identically under the locked R-1 shared deadline, so it cannot tell D-3 from R-1."
        }
      ],
      "new_objections": [
        {
          "text": "AC-3 must exercise the repeated-token guard, not the duplicate-symbol guard. Adopt D-9 (token checks before the symbol merge) and a direct-helper row asserting `page 2: repeated next_page_token \"p2\"`, so deleting the seen-token check turns a test red.",
          "blocking": true
        },
        {
          "text": "The positive control must assert the mismatch_found payload expected == 5. Otherwise a drain that fetches and then discards page 2 still passes.",
          "blocking": false
        },
        {
          "text": "Correct the AC-1 RED rationale. On today's code the seed is deleted and emitted at tick 1 (trading.go:2042-2044). Pair 'key absent' with 'no finding and not halted after tick 1'.",
          "blocking": false
        },
        {
          "text": "The deadline variant must tell D-3 apart from R-1 by asserting strictly increasing per-page ctx.Deadline(), not ctx liveness.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "r2 concretely added a positive-control halt test on a page-2 symbol, plus AC-1 asserting exactly 2 calls with tokens [\"\",\"p2\"] and a pre-seeded acc-1:pos:SYM501 candidate checked after the tick. The payload and rationale refinements are tracked as new non-blocking objections."
        },
        {
          "id": "O-2",
          "how": "r2 added a deadline variant: a 50 ms broker.timeout_ms snapshot through config.MustSnapshotWatcher and a page-2 fake blocking on ctx.Done(), asserting the skip. D-3 discrimination is tracked as a new objection."
        },
        {
          "id": "O-3",
          "how": "Helper errors are %w-wrapped with a 1-based page index and a cause-specific message (list positions, empty page with a token, repeated token, duplicate symbol), asserted through direct helper calls."
        },
        {
          "id": "O-4",
          "how": "AC-2 is recorded as failing RED naturally (SYM501 absent, so it diverges at :2256 and halts), with the \"p2\" assertion as a GREEN-side guard and no vacuous-pass note. The adversary concurred."
        },
        {
          "id": "O-5",
          "how": "The seen set is described as defense-in-depth against a monotonic keyset cursor in a code comment of at most 2 lines and in the PR description. The adversary concurred."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-17 — sdd-batch design gate (round 3)

`/sdd-design fix-trading-reconcile-reads` full debate halted at its approval gate after round 3 (gate policy: halt). design.md is NOT written and status.md is unchanged (still spec-ready). The debate register is `debate.md` (D-1..D-15, R-1..R-10, O-1..O-14; O-1..O-9 closed).

## Open Threads

- **Approach**: the r3 proposal is adopted as written, plus five small precision fixes (D-13..D-15 and non-blocking O-10..O-14). The code design and D-1..D-12 are unchanged. In `trading.go`, a const `reconcilePositionsPageSize = 500` and a helper `listAccountPlatformPositions` drain portfolio `ListPositions`. Each page gets its own `context.WithTimeout` with `x-user-id`, and `cancel()` runs right after the call. The token guards (empty page with a token, repeated token) run before the symbol merge (D-9). The duplicate-symbol text is now `page %d: duplicate symbol %q`, without "across pages" (D-13). Every error returns `nil`. `reconcileTick:2231-2239` becomes one helper call, and the ppErr skip at `:2240-2243` stays byte-for-byte. Tests are written RED first in `trading_reconciliation_test.go`: AC-1, a positive control, AC-2 error, AC-2 deadline, AC-3, and a direct-helper hardening table. They follow three rules:
  - Payloads are read only from the existing `recordingLedgerClient` (`expected == 5`, `broker_reported == 10`). No second recorder (D-14).
  - Call logs are snapshotted and reset per tick (D-15).
  - The broker fakes never sleep, the deadline is captured at call entry, and the RPC-error row uses `status.Code(err) == codes.Unavailable`.
- **Strongest open objection (non-blocking, O-10)**: remove the r3 "local recorder extension" fallback. Payload assertions must read from the existing `recordingLedgerClient` (`trading_reconciliation_test.go:137-149`, read pattern `:562`). A duplicate recorder is the route back to the type-only vacuous check that O-7 closed. O-11..O-14 (duplicate-symbol text, per-tick call log, non-sleeping broker fakes with deadline captured at entry, `status.Code` on the wrapped error) are also open and non-blocking, and all are folded into the approach. O-6 (blocking), O-7, O-8 and O-9 closed at round 3. No blocking objection remains open.
- **Floor status**: no floor breaches.
- **Uncovered @AC changes**: `358 @AC-1` EXTEND is not covered by an operator decision. `358 @AC-2` and `@AC-3` EXTEND are covered (operator 2026-11-17: skip, never halt). PRESERVE only: `@AC-1/@AC-2/@AC-3 @feature-206` (fix-reconciliation-false-halt.feature), `@AC-9 @feature-249`, `@AC-45 @feature-294` (signal-map-instrumentation.feature), `@AC-1/@AC-7 @feature-169`.
- **Open risks**:
  - A skipped tick is visible only through the WARN (no metric, D-8).
  - Tick wall-clock time grows to ceil(n/500) × broker.timeout_ms.
  - `resolveUnknownIntents` stays skipped while the platform read is incomplete.
  - The rejections rely on portfolio's UNIQUE index (migrations/003:10) and on keyset paging. A violation would cause false skips, not false halts.
  - The deadline-ordering assertion depends on the monotonic clock advancing during page 1's 5 ms sleep. If it does not, the test fails as a flake; it never passes vacuously.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The r3 proposal is adopted as written, plus five small precision fixes from the r3 adversary (D-13 to D-15 and the non-blocking objections O-10 to O-14). The code design and D-1 to D-12 do not change.\n\n**Service change.** All edits are in `services/xstockstrat-trading/internal/service/trading.go`.\n- Add a package const `reconcilePositionsPageSize = 500`. It replaces the literal at `:2237`.\n- Add a helper next to `reconcileTick`: `func (s *TradingService) listAccountPlatformPositions(ctx, accountID, userID string, mode commonv1.TradingMode, timeout time.Duration) ([]*portfoliov1.Position, error)`.\n- For each page `i` (1-based), the helper does these steps in order:\n  1. Creates `pctx, cancel := context.WithTimeout(ctx, timeout)` and adds `x-user-id`, as `:2231-2234` does today (D-3).\n  2. Calls `ListPositions` with `Page{PageSize: reconcilePositionsPageSize, PageToken: token}`.\n  3. Calls `cancel()` as soon as the call returns. No `defer` inside the loop.\n  4. On an RPC error, returns `nil, fmt.Errorf(\"page %d: list positions: %w\", i, err)`.\n  5. Reads `next := resp.GetPage().GetNextPageToken()`.\n  6. Runs the token guards before merging any symbol (D-9):\n     - zero positions and `next != \"\"` → `\"page %d: empty page with next_page_token %q\"`\n     - `next != \"\"` and `next` already in the seen set → `\"page %d: repeated next_page_token %q\"`\n  7. Merges the page's symbols. A symbol already seen, whether on an earlier page or on this one, gives `\"page %d: duplicate symbol %q\"`. The text drops \"across pages\" (D-13).\n  8. If `next == \"\"`, returns the full slice. Otherwise it adds `next` to the seen set and sets `token = next`.\n- Every error returns `nil`, never a partial slice.\n- In `reconcileTick`:\n  - `:2231-2239` becomes a single helper call.\n  - `:2240-2243` (the `ppErr` WARN and `continue`) stays byte-for-byte. This keeps the skip with no systemic count and no halt, and `resolveUnknownIntents` stays skipped (D-2, D-7).\n  - `:2244-2247` ranges over the returned slice.\n- The seen set gets a code comment of at most 2 lines saying it is defense-in-depth against a monotonic keyset cursor.\n\n**Tests, written RED first** (`trading_reconciliation_test.go`).\n\nShared setup:\n- One file-local paging fake sits on `fakeReconciliationPortfolioClient.listPositionsFn` (`:124`).\n  - Under a mutex it records each call's `PageToken`, `x-user-id` and `ctx.Deadline()`. The deadline is captured at call entry, before any sleep or block.\n  - It has a call cap of 100, an `ignoreToken` mode, and per-token error and blocking hooks.\n- Per-tick call assertions read a log that is snapshotted and reset between the two `reconcileTick` calls (the `:554-555` pattern), so each tick is checked on its own (D-15).\n- The broker fakes return SYM001..SYM501 at qty 10. They must not sleep (O-13).\n- `fakePositionQtyLookup` is empty.\n- Each test uses graceTicks=1 and two ticks. Halt state is read through `isAccountHalted` (`trading.go:2892`).\n- Finding payloads are read only from the existing `recordingLedgerClient` (`:137-149`), which records full `*ledgerv1.AppendEventRequest` structs. Read them with `e.Payload.Fields[\"expected\"].GetNumberValue()` and `[\"broker_reported\"].GetNumberValue()`, the access pattern at `:562`. Adding a second or local recorder is forbidden (D-14).\n\n1. **AC-1**\n   - Page 1 is SYM001..500 with next token \"p2\". Page 2 is SYM501 with next token \"\".\n   - Pre-seed `reconcileCandidates[\"acc-1:pos:SYM501\"]=1`.\n   - After tick 1, assert all of these: the key is absent, there is no `reconciliation.mismatch_found`, and `!isAccountHalted`. Assert the same after tick 2.\n   - Each tick's tokens must equal `[\"\",\"p2\"]`.\n   - RED rationale: on today's code tick 1 raises the seed to 2 ≥ 1+graceTicks, so `recordReconciliationCandidate` deletes the key and returns true (`trading.go:2041-2044`). `:2285-2286` then emits the finding and halts the account.\n2. **Positive control** (guards `@AC-2 @feature-206`)\n   - Same pages as AC-1, but SYM501 on page 2 has qty 5.\n   - Assert a `mismatch_found` whose payload has `expected == 5` and `broker_reported == 10` (built by `emitReconciliationFinding` at `:2060-2070`, called at `:2286`).\n   - Assert the account is halted and that each tick made 2 calls.\n   - It is RED on today's code, where `expected == 0`.\n3. **AC-2 (error)**\n   - Page \"p2\" returns `codes.Unavailable`.\n   - Assert a call with token \"p2\" was made, and that there is no `acc-1:pos:` candidate, no finding and no halt.\n4. **AC-2 deadline variant**\n   - Set `svc.cfgW = config.MustSnapshotWatcher(...)` with `broker.timeout_ms=50`, the seam at `trading_ibkr_auth_test.go:121-126`.\n   - Page 1 sleeps 5 ms after recording its entry deadline. Page \"p2\" blocks on `<-ctx.Done()`.\n   - Assert the same skip outcomes as AC-2.\n   - Assert page 2's entry `Deadline()` is strictly after page 1's (D-11, not R-8).\n5. **AC-3**\n   - The fake ignores the token and always returns page 1 with next token \"p2\".\n   - Assert exactly 2 calls in each tick's own log, and no candidate, finding or halt.\n6. **Hardening table** (calls the helper directly; every row also asserts a `nil` slice)\n   - `page 2: repeated next_page_token \"p2\"`, using the ignore-token fake\n   - `page 2: empty page with next_page_token \"p3\"`\n   - `page 2: duplicate symbol \"SYM500\"`, where page 2 repeats SYM500 and its next token is \"\"\n   - `page 2: list positions: ...`, with `status.Code(err) == codes.Unavailable` on the wrapped error. grpc-go v1.83.2 `status.Code` unwraps `%w` chains, so `errors.Unwrap` is not needed (O-14).\n\n**Build order**\n1. Write tests 1-5 and show them RED on unchanged code.\n2. Make the helper and `reconcileTick` change, and add test 6.\n3. Run `GOWORK=off go test ./...` in `services/xstockstrat-trading`. Existing tests use the default empty single page, so they make 1 call.\n4. Add one sentence at `services/xstockstrat-trading/docs/reconciliation.md:57`.\n\nThere is no proto, migration, config or portfolio change. Features 351, 353 and 354 are untouched.",
    "open_objections": [
      {
        "text": "[C-13/C-18] The positive control and AC-1 must read finding payloads from the existing recordingLedgerClient (trading_reconciliation_test.go:137-149 records full AppendEventRequest; read pattern at :562) via e.Payload.Fields[\"expected\"].GetNumberValue()==5 and [\"broker_reported\"]==10. The r3 'local recorder extension' fallback must be removed from the spec — it duplicates a working fixture and is the route back to a type-only vacuous check.",
        "blocking": false
      },
      {
        "text": "[D-8 precision] The duplicate-symbol error text must be `page %d: duplicate symbol %q`, without 'across pages'. Step 7 also catches a duplicate within one page, and 'across pages' would mislabel that in the WARN at trading.go:2241. Update the D-12 row to match.",
        "blocking": false
      },
      {
        "text": "[C-15] The per-tick call assertions (AC-1 tokens [\"\",\"p2\"], positive-control 2 calls, AC-3 exactly 2 calls) must read a call log that is snapshotted and reset between the two reconcileTick calls. A cumulative 4-call total cannot catch a single tick that loops one time too many.",
        "blocking": false
      },
      {
        "text": "[C-15] In the deadline variant, the 50 ms broker.timeout_ms also governs the broker calls (brokerCallTimeout trading.go:2585-2591). The spec must state that the broker fakes return immediately, so the skip cannot pass because of a broker-side timeout. ctx.Deadline() must be recorded at fake-call entry, before page 1's sleep and before page 2 blocks.",
        "blocking": false
      },
      {
        "text": "[test precision] The RPC-error hardening row should assert status.Code(err)==codes.Unavailable on the wrapped error. grpc-go v1.83.2 unwraps %w chains. errors.Unwrap peels only one layer and would break if the wrapping changes.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "358 @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "358 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "358 @AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-1 @feature-206 (fix-reconciliation-false-halt.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-206 (fix-reconciliation-false-halt.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-206 (fix-reconciliation-false-halt.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-249",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-45 @feature-294 (signal-map-instrumentation.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-169",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-169",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Adding a local or second ledger recorder to read finding payloads (the r3 fallback). It lost because recordingLedgerClient (trading_reconciliation_test.go:137-149) already captures the full AppendEventRequest including the structpb Payload, and a duplicate recorder could quietly bring back the type-only vacuous check that O-7 closed.",
      "Asserting the helper's returned slice instead of the finding payload in the positive control. It lost because that cannot prove reconcileTick uses page-2 data in the compare. A drain that fetches page 2 and then discards it would still pass.",
      "Injecting a fake clock to make the per-page deadline check deterministic. It lost because context.WithTimeout uses the wall and monotonic clock, not s.clock, so it would need a new seam (C-18). A 5 ms sleep with strictly increasing Deadline() captured at call entry is enough.",
      "Keeping 'across pages' in the duplicate-symbol error text. It lost because the step-7 check also fires on a duplicate within one page, and that text would mislabel the WARN cause (D-8).",
      "Asserting call counts on the log accumulated across both ticks. It lost because the 4-call total cannot detect a single tick that loops one extra time.",
      "Using errors.Unwrap in the RPC-error row. It lost because it peels exactly one layer, while status.Code already unwraps %w chains in grpc-go v1.83.2."
    ],
    "open_risks": [
      "A skipped tick is logged only by a cause-tagged WARN. A persistent server-side cursor bug would leave an account's position side unchecked indefinitely, with no metric or alert. A metric is out of scope (D-8).",
      "Tick wall-clock time grows by up to ceil(n/500) × broker.timeout_ms for each large account, because the account loop runs sequentially. Portfolio's per-page enrichPositions quote fetch makes page deadlines more likely on big accounts.",
      "resolveUnknownIntents stays skipped while an account's platform read is incomplete (existing continue at trading.go:2240-2243). An extended portfolio outage therefore also delays resolution of UNKNOWN intents.",
      "The duplicate-symbol and repeated-token rejections depend on portfolio's UNIQUE(user_id, symbol, trading_mode, account_id) (migrations/003:10) and on keyset paging returning each row exactly once. A future portfolio change that splits a symbol across rows would cause false skips. It would not cause false halts.",
      "The deadline-ordering assertion depends on the monotonic clock advancing during page 1's 5 ms sleep. Equal deadlines would fail the test as a flake rather than pass it vacuously."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-4",
      "PLAT-N1"
    ],
    "rationale": "Round 3 closes all four open objections concretely, and the adversary's verdict is SOUND with no Floor breaches.\n- O-6 (blocking) is closed. The token guards are step 6, before the symbol merge at step 7. The direct-helper row asserting `page 2: repeated next_page_token \"p2\"` goes red if the seen-token check is deleted.\n- O-7 is closed. The positive control asserts payload `expected == 5` and `broker_reported == 10`.\n- O-8 is closed. The AC-1 RED rationale now matches trading.go:2041-2044, which I re-checked: the key is deleted and the function returns true at ≥ 1+graceTicks.\n- O-9 is closed. The test asserts strictly increasing per-page Deadline().\n\nI verified the adversary's main factual claim in code. recordingLedgerClient (:137-149) appends the full *ledgerv1.AppendEventRequest. Existing tests read Payload.Fields at :562, :596 and :632. emitReconciliationFinding (:2060-2070) writes `expected` and `broker_reported` into the payload map. So the proposal's \"strongest risk\" is already resolved, and the local-recorder fallback should be forbidden. That is D-14.\n\nI also confirmed grpc-go v1.83.2 in go.mod, so status.Code unwraps %w chains. brokerCallTimeout (:2585-2591) is shared with the broker calls, which supports the note that the broker fakes must not sleep.\n\nThe adversary's other points are new precision gaps that the r3 text does not answer, so each is recorded as a new non-blocking objection and folded into the approach.\n- The duplicate-symbol text mislabels a duplicate within one page (D-13).\n- Call logs are not split per tick (D-15).\n- Broker fakes could sleep, and the deadline was not captured at call entry.\n- The RPC-error row uses errors.Unwrap.\n\nNone of these contradicts a settled decision. D-13 refines only the D-12 message string. D-12's \"still unwraps to codes.Unavailable\" is honored by status.Code. Nothing re-raises a locked R-n or a closed O-n.\n\nRegister check: no D-n is contradicted, no R-n is reintroduced (the fake-clock idea is rejected as new, not as a variant of R-1/R-8), and no reopen petitions came from either side or from the operator.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The duplicate-symbol guard's error text is `page %d: duplicate symbol %q`, without 'across pages', because the step-7 check also catches a duplicate within one page. The D-12 hardening row asserts this exact text.",
          "evidence": "adversary r3; trading.go:2241 WARN (D-8 cause discrimination)"
        },
        {
          "text": "Finding payload assertions read only from the existing recordingLedgerClient via e.Payload.Fields[\"expected\"/\"broker_reported\"].GetNumberValue(). No local or second ledger recorder may be introduced.",
          "evidence": "trading_reconciliation_test.go:137-149 (records full AppendEventRequest), :562/:596/:632 (Payload.Fields reads); trading.go:2064-2068 payload map"
        },
        {
          "text": "Per-tick call-count and token assertions use a paging-fake call log that is snapshotted and reset between the two reconcileTick calls, so each tick is asserted independently.",
          "evidence": "adversary r3; two-tick pattern at trading_reconciliation_test.go:554-555"
        }
      ],
      "new_rejected": [
        {
          "text": "A local or second ledger recorder extension for reading finding payloads",
          "why": "recordingLedgerClient already captures the full structpb Payload, and a duplicate recorder could reintroduce the type-only vacuous check that O-7 closed (C-13/C-18)."
        },
        {
          "text": "A fake clock seam to make the per-page deadline ordering deterministic",
          "why": "context.WithTimeout does not use s.clock, so this would need a new speculative seam (C-18). A 5 ms sleep with entry-captured Deadline() is enough."
        }
      ],
      "new_objections": [
        {
          "text": "Remove the 'local recorder extension' fallback. Payload assertions must use the existing recordingLedgerClient's e.Payload.Fields[\"expected\"].GetNumberValue()==5 and [\"broker_reported\"]==10.",
          "blocking": false
        },
        {
          "text": "Change the duplicate-symbol error text to `page %d: duplicate symbol %q`, without 'across pages', and update the D-12 row to match.",
          "blocking": false
        },
        {
          "text": "Split the paging fake's call log per tick (snapshot or reset between the two reconcileTick calls) so the call assertions are per tick, not cumulative.",
          "blocking": false
        },
        {
          "text": "In the deadline variant, the broker fakes must not sleep, because the 50 ms broker.timeout_ms also applies to the broker calls. Record ctx.Deadline() at fake-call entry, before page 1's sleep and before page 2 blocks.",
          "blocking": false
        },
        {
          "text": "The RPC-error hardening row should assert status.Code(err)==codes.Unavailable on the wrapped error, not status.Code(errors.Unwrap(err)).",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-6",
          "how": "r3 puts the token guards at step 6, before the symbol merge at step 7 (D-9). It adds a direct-helper row asserting `page 2: repeated next_page_token \"p2\"`, which goes red if the seen-token check is deleted. The adversary confirmed this."
        },
        {
          "id": "O-7",
          "how": "The r3 positive control asserts mismatch_found payload expected == 5 and broker_reported == 10. It is RED on today's code (expected == 0), and the payload is readable via recordingLedgerClient Payload.Fields (:562)."
        },
        {
          "id": "O-8",
          "how": "The r3 AC-1 RED rationale now states that the seed is deleted and a finding emitted at ≥ 1+graceTicks (trading.go:2041-2044, re-verified). The test pairs 'key absent' with 'no finding and not halted' after tick 1."
        },
        {
          "id": "O-9",
          "how": "The r3 deadline variant asserts that page 2's recorded Deadline() is strictly after page 1's, with page 1 sleeping 5 ms. Liveness is not used as evidence (R-8)."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
