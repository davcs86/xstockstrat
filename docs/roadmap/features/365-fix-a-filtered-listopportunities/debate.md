# Debate Register: fix-a-filtered-listopportunities

**State**: approved
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-26 | /sdd-batch | 4 | 4 | 0 | 5 | 0 | yes |
| 2 | 2026-11-26 | /sdd-batch | 2 | 2 | 5 | 3 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Gate the no-rows kick in _read_opportunity_queue with 'if await opps.has_fresh(user_id):' (no-op), placed before count_for_user. The cold and all-stale paths stay byte-for-byte, with kick_full still set before the state read. | servicer.py:4790-4798; app/repositories/opportunities.py:332,340-348; tests/test_list_opportunities_deadlines.py:331 | settled |
| D-2 | 1 | A manual recompute or invalidate path is OUT of scope. The min_conviction=1.01 side-effect lever is removed deliberately; any replacement is a separate /sdd-story. | Operator decision 2026-11-26 (default out of scope); proposal r1; adversary r1 did not object | settled |
| D-3 | 1 | Accept that a filtered read whose only match is a stale leftover returns empty with no kick (mixed freshness), and that all-dismissed or all-snoozed fresh rows also get no kick. The stale read runs only when the user has no fresh row. | recon findings 3-4; servicer.py:5204-5217, 5311-5320; unfiltered fresh read already hides stale leftovers | settled |
| D-4 | 1 | Merge order: 365 before 366. Cross-feature constraint: one compute stamps a single valid_until on every row it writes; if 366 violates it, the mixed-freshness decision is re-evaluated. | Operator cross-feature note; adversary r1 P-05 objection | settled |
| D-5 | 2 | Implement D-1 as a one-line change: 'elif not await opps.has_fresh(user_id):' replaces the bare 'else:' at servicer.py:4790 (no re-indent). The at-most-2-line constraint comment goes on the elif line and names the fresh-but-filtered-empty fall-through (no kick). | servicer.py:4786-4820 (verified r2); proposal r2; adversary r2 C-18 objection | settled |
| D-6 | 2 | Test realism: AC-1, AC-3, AC-4 and the all-dismissed/snoozed case run over the unpatched, seeded _FakeOppRepo. Only AC-2 (symbol, which the fake ignores) patches the include_expired=False read, and has_fresh is overridden only where seeding cannot express the case. | tests/test_analysis_servicer.py:4515-4557 (verified r2: the fake applies include_expired, min_conviction and DISMISS/SNOOZE, and ignores only sources, action_filter and symbol) | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | A fused repo method returning (has_fresh, count) | Near-duplicate of two existing helpers (C-18/DRY) to save one round-trip on a rare path | locked |
| R-2 | 1 | Gating the kick on 'the request carries any filter' | Stops the kick for cold or all-stale filtered reads, which breaks FR-2 AC-3/AC-4 | locked |
| R-3 | 1 | A filtered include_expired=True fallback read on filtered-empty fresh | Diverges from the unfiltered fresh read and breaks the feature-190 O7 facet-freshness pairing | locked |
| R-4 | 1 | Production 'is True' check on has_fresh to dodge the MagicMock-truthy trap | Bends production code to a test mock; stub has_fresh in the fakes instead | locked |
| R-5 | 2 | Explicit 'if await opps.has_fresh(...): pass' with the body under 'else:' | Re-indents about 30 lines and enlarges 366's rebase; 'elif' plus an on-line comment gives the same visibility | locked |
| R-6 | 2 | Blanket test patching (fresh read forced to [] and has_fresh overridden in every scenario) | Gives up the fake's real filtering and risks a vacuous green (fails.md:801/1649/2656) | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Test blast radius: tests/test_opportunity_compute_state.py:45-53 _opp_svc() bare AsyncMock makes has_fresh truthy and would flip the feature-185 @AC-6/@AC-7 unit guards. Fix: stub has_fresh=AsyncMock(return_value=False) there and in tests/test_opportunities_repo.py:657-668, and list both in Files. The other AsyncMock sites are verified not to reach ListOpportunities. | yes | closed @ round 2 (Proposer r2 adopted the has_fresh=AsyncMock(return_value=False) stubs in _opp_svc (test_opportunity_compute_state.py:45-53) and in the test_opportunities_repo.py:657-668 stub, as Files items (b)/(c). The adversary confirmed no other site reaches _read_opportunity_queue.) |
| O-2 | 1 | has_fresh is unexercised: add a real_pg test covering fresh -> True, expired-only -> False, fresh+DISMISSed -> True. | no | closed @ round 2 (Adopted as Files item (e): a real_pg has_fresh test.) |
| O-3 | 1 | tests/conftest.py:298 _BC_METHOD_FOR needs '"has_fresh": "fetchval"'. | no | closed @ round 2 (Adopted as Files item (d): '"has_fresh": "fetchval"' added to _BC_METHOD_FOR at conftest.py:298.) |
| O-4 | 1 | docs/opportunities.md feature-215 symbol-filter sentence must say the stale read runs only when no fresh row exists. | no | closed @ round 2 (Adopted as Files item (f): the docs/opportunities.md:7 sentence is updated.) |
| O-5 | 1 | Record the single-valid_until-per-compute constraint in context.md and on 366's design. | no | closed @ round 2 (Adopted as Files item (g): the D-4 constraint is recorded in context.md and flagged for 366's design.) |
| O-6 | 2 | Kick-spy tests cannot check the valid_until and follow-up-read Then clauses of AC-1..AC-4. Add one real-kick test for AC-3/AC-4 (pattern at test_opportunity_compute_state.py:76-98), or record kick-called as the accepted proxy in Verification. | no | open |
| O-7 | 2 | Confirm that has_fresh routes via fetchval (conftest.py:298), so the fetchrow injection in test_compute_state_timeout_kicks_once_then_unavailable (:331-337) still targets the state read. Optionally pin 'has_fresh timeout gives UNAVAILABLE with no kick'. | no | open |
| O-8 | 2 | Item (e) must name tests/test_opportunities_repo.py as its target (F-08). Its fresh-plus-DISMISSed case passes by construction, so label it a D-3 pin or drop it. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
