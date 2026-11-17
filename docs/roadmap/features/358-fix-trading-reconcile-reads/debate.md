# Debate Register: fix-trading-reconcile-reads

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-17 | /sdd-batch | 8 | 6 | 0 | 5 | 0 | yes |
| 2 | 2026-11-17 | /sdd-batch | 4 | 2 | 5 | 4 | 0 | yes |
| 3 | 2026-11-17 | /sdd-batch | 3 | 2 | 4 | 5 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Drain the portfolio ListPositions cursor in a trading-local helper, listAccountPlatformPositions, that returns either the complete set or an error, never a partial slice. It replaces the single call at trading.go:2231-2239. | trading.go:2231-2247; portfolio_service.go:1111-1167 (collectFills precedent) | settled |
| D-2 | 1 | Every incomplete read (RPC error or deadline, empty page with a token, repeated token, duplicate symbol) routes into the existing ppErr skip unchanged: WARN and continue, with no candidate, no halt, nothing systemic, and resolveUnknownIntents skipped for that tick. | trading.go:2240-2243; operator decision 2026-11-17 (skip, never halt); fails.md:3311 | settled |
| D-3 | 1 | Each page gets its own context.WithTimeout(broker.timeout_ms) with x-user-id injected. Worst case is ceil(n/500) × timeout, which is acceptable because the loop-termination rules exist and missed ticks are dropped. | trading.go:2109, :2231-2234, :2585, :2014-2021 | settled |
| D-4 | 1 | Reject any repeated next_page_token (seen-set, a superset of next == sent) and any empty page that carries a token. This is defense-in-depth against a monotonic keyset cursor. | portfolio_service.go:1124-1126, :1163-1165; portfolio_repo.go:167,177,199-204 | settled |
| D-5 | 1 | Fail closed on a symbol repeated across pages instead of last-write-wins. | services/xstockstrat-portfolio/migrations/003_positions_account_id.up.sql:10 (unique per user/symbol/mode/account) | settled |
| D-6 | 1 | Keep page size 500 as a named code constant shared with the tests. Add no config key and no page cap. | trading.go:2237; operator Fix Scope; adversary F-07 assessment | settled |
| D-7 | 1 | Portfolio page failures stay excluded from systemicCount, preserving the systemic escalation semantics. | trading.go:2135, :2224, :2242 | settled |
| D-8 | 1 | Wrap each helper error with its cause and page index so the existing WARN tells the failure modes apart. Add no new metric. | trading.go:2241 | settled |
| D-9 | 2 | Within each page, the helper runs the token guards (empty page with a token, repeated next_page_token) before merging that page's symbols, and only then runs the duplicate-symbol check. This makes the FR-3 repeated-token guard reachable and testable independently of D-5. | adversary r2 blocking objection; fails.md:3312; ignore-token fake pattern at portfolio_pnl_paging_test.go:34,49 | settled |
| D-10 | 2 | The positive-control test asserts that the mismatch_found payload has expected == 5 (the page-2 platform qty). This makes it a RED test that proves page-2 data was used in the compare. | trading.go:2286 emitReconciliationFinding(..., platformQty, bp.Quantity); payload at :2064-2068 | settled |
| D-11 | 2 | D-3 is pinned by asserting that each page call's recorded ctx.Deadline() is strictly later than the previous page's (page 1 sleeps a few ms). Liveness of page 1's ctx is not used as evidence. | adversary r2; R-1 (a shared deadline yields equal deadlines) | settled |
| D-12 | 2 | Each guard is pinned by a direct-helper hardening row asserting its exact page-indexed error text (repeated token, empty page with a token, duplicate symbol, and an RPC error that still unwraps to codes.Unavailable). | trading.go:2241 WARN; O-3 | settled |
| D-13 | 3 | The duplicate-symbol guard's error text is `page %d: duplicate symbol %q`, without 'across pages', because the step-7 check also catches a duplicate within one page. The D-12 hardening row asserts this exact text. | adversary r3; trading.go:2241 WARN (D-8 cause discrimination) | settled |
| D-14 | 3 | Finding payload assertions read only from the existing recordingLedgerClient via e.Payload.Fields["expected"/"broker_reported"].GetNumberValue(). No local or second ledger recorder may be introduced. | trading_reconciliation_test.go:137-149 (records full AppendEventRequest), :562/:596/:632 (Payload.Fields reads); trading.go:2064-2068 payload map | settled |
| D-15 | 3 | Per-tick call-count and token assertions use a paging-fake call log that is snapshotted and reset between the two reconcileTick calls, so each tick is asserted independently. | adversary r3; two-tick pattern at trading_reconciliation_test.go:554-555 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | One shared context and deadline across all pages of an account | Large accounts would hit the deadline every tick and never be checked, with nobody noticing. Per-page timeouts keep the per-call semantics. | locked |
| R-2 | 1 | An inline drain loop in reconcileTick | reconcileTick is already about 215 lines. The helper gives a single return contract that can be tested. | locked |
| R-3 | 1 | Tolerating duplicate symbols across pages (sum or last-write-wins) | A duplicate can only come from a broken cursor, and tolerating it would hide page overlap. | locked |
| R-4 | 1 | A fixed page cap | It is a speculative constant (C-18). The seen-token and duplicate-symbol rules already terminate. | locked |
| R-5 | 1 | A new config key for the page size | The operator Fix Scope excludes it, and the value is a paging shape, not an operator-tunable setting. | locked |
| R-6 | 1 | Counting portfolio page failures toward systemicCount | It would change the systemic escalation semantics, so it is excluded on purpose. | locked |
| R-7 | 2 | Merging a page's symbols before its token checks | The D-5 duplicate-symbol guard then shadows the D-4 repeated-token guard on ignore-token fakes, leaving FR-3 untested (fails.md:3312). | locked |
| R-8 | 2 | Using 'page-1 ctx still live during the call' as evidence of per-page deadlines | It holds identically under the locked R-1 shared deadline, so it cannot tell D-3 from R-1. | locked |
| R-9 | 3 | A local or second ledger recorder extension for reading finding payloads | recordingLedgerClient already captures the full structpb Payload, and a duplicate recorder could reintroduce the type-only vacuous check that O-7 closed (C-13/C-18). | locked |
| R-10 | 3 | A fake clock seam to make the per-page deadline ordering deterministic | context.WithTimeout does not use s.clock, so this would need a new speculative seam (C-18). A 5 ms sleep with entry-captured Deadline() is enough. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | The tests have no positive control. AC-1..AC-3 only check that nothing happened, so a drain that always errors passes them while silently disabling position reconciliation, which breaks @AC-2 @feature-206 in practice. Required: a positive-control halt test (SYM501 on page 2 with an unexplained mismatch, so a finding is emitted and the account halts), plus AC-1 asserting exactly 2 calls, PageToken=="p2" on the second, and a cleared pre-seeded acc-1:pos:SYM501 candidate. | yes | closed @ round 2 (r2 concretely added a positive-control halt test on a page-2 symbol, plus AC-1 asserting exactly 2 calls with tokens ["","p2"] and a pre-seeded acc-1:pos:SYM501 candidate checked after the tick. The payload and rationale refinements are tracked as new non-blocking objections.) |
| O-2 | 1 | FR-2 deadline case is untested. Add a page-2 fake that blocks on ctx.Done() under a short broker.timeout_ms, and assert the skip. | no | closed @ round 2 (r2 added a deadline variant: a 50 ms broker.timeout_ms snapshot through config.MustSnapshotWatcher and a page-2 fake blocking on ctx.Done(), asserting the skip. D-3 discrimination is tracked as a new objection.) |
| O-3 | 1 | Helper errors must carry their cause and page index so the WARN at trading.go:2241 tells repeated-token, empty-page-with-token and duplicate-symbol apart. | no | closed @ round 2 (Helper errors are %w-wrapped with a 1-based page index and a cause-specific message (list positions, empty page with a token, repeated token, duplicate symbol), asserted through direct helper calls.) |
| O-4 | 1 | Correct the AC-2 RED rationale. It fails naturally on today's code (SYM501 missing, so it diverges and halts); the PageToken=="p2" assertion is a GREEN-side guard. | no | closed @ round 2 (AC-2 is recorded as failing RED naturally (SYM501 absent, so it diverges at :2256 and halts), with the "p2" assertion as a GREEN-side guard and no vacuous-pass note. The adversary concurred.) |
| O-5 | 1 | Describe the seen-token set as defense-in-depth only, not as covering a real cycle scenario against the monotonic keyset cursor. | no | closed @ round 2 (The seen set is described as defense-in-depth against a monotonic keyset cursor in a code comment of at most 2 lines and in the PR description. The adversary concurred.) |
| O-6 | 2 | AC-3 must exercise the repeated-token guard, not the duplicate-symbol guard. Adopt D-9 (token checks before the symbol merge) and a direct-helper row asserting `page 2: repeated next_page_token "p2"`, so deleting the seen-token check turns a test red. | yes | closed @ round 3 (r3 puts the token guards at step 6, before the symbol merge at step 7 (D-9). It adds a direct-helper row asserting `page 2: repeated next_page_token "p2"`, which goes red if the seen-token check is deleted. The adversary confirmed this.) |
| O-7 | 2 | The positive control must assert the mismatch_found payload expected == 5. Otherwise a drain that fetches and then discards page 2 still passes. | no | closed @ round 3 (The r3 positive control asserts mismatch_found payload expected == 5 and broker_reported == 10. It is RED on today's code (expected == 0), and the payload is readable via recordingLedgerClient Payload.Fields (:562).) |
| O-8 | 2 | Correct the AC-1 RED rationale. On today's code the seed is deleted and emitted at tick 1 (trading.go:2042-2044). Pair 'key absent' with 'no finding and not halted after tick 1'. | no | closed @ round 3 (The r3 AC-1 RED rationale now states that the seed is deleted and a finding emitted at ≥ 1+graceTicks (trading.go:2041-2044, re-verified). The test pairs 'key absent' with 'no finding and not halted' after tick 1.) |
| O-9 | 2 | The deadline variant must tell D-3 apart from R-1 by asserting strictly increasing per-page ctx.Deadline(), not ctx liveness. | no | closed @ round 3 (The r3 deadline variant asserts that page 2's recorded Deadline() is strictly after page 1's, with page 1 sleeping 5 ms. Liveness is not used as evidence (R-8).) |
| O-10 | 3 | Remove the 'local recorder extension' fallback. Payload assertions must use the existing recordingLedgerClient's e.Payload.Fields["expected"].GetNumberValue()==5 and ["broker_reported"]==10. | no | open |
| O-11 | 3 | Change the duplicate-symbol error text to `page %d: duplicate symbol %q`, without 'across pages', and update the D-12 row to match. | no | open |
| O-12 | 3 | Split the paging fake's call log per tick (snapshot or reset between the two reconcileTick calls) so the call assertions are per tick, not cumulative. | no | open |
| O-13 | 3 | In the deadline variant, the broker fakes must not sleep, because the 50 ms broker.timeout_ms also applies to the broker calls. Record ctx.Deadline() at fake-call entry, before page 1's sleep and before page 2 blocks. | no | open |
| O-14 | 3 | The RPC-error hardening row should assert status.Code(err)==codes.Unavailable on the wrapped error, not status.Code(errors.Unwrap(err)). | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
