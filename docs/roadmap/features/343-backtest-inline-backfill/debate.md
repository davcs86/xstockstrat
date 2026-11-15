# Debate Register: backtest-inline-backfill

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-15 | /sdd-batch | 3 | 3 | 0 | 9 | 0 | yes |
| 2 | 2026-11-15 | /sdd-batch | 4 | 0 | 9 | 9 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | FR-6 is pursued through a narrow server-side self-serve envelope on `TriggerBackfill` (one symbol, BARS, GAPS_ONLY, no overwrite, explicit range ends, empty callback_url). The gate keeps its position; admin behaviour is unchanged; no proto change. | services/xstockstrat-ingest/app/handlers/servicer.py:417-425; proposer and adversary both endorse the shape in round 1. | settled |
| D-2 | 1 | The card tracks its own `jobId` in local state and re-runs through the existing `handleRun`; there is no automatic re-run and no BFF change. | src/hooks/useBackfills.ts:30; page.tsx:1178-1197; src/lib/insightsBff.ts:86,:89; operator decision 2; uncontested in round 1. | settled |
| D-3 | 1 | The design gate presents FR-6 cost as tiers T0 (envelope only), T1 (plus span-cap key), T2 (plus per-user cap with migration 017) and FR-7; the operator chooses. | Operator decision 4; servicer.py:650-667 shows the range is uncapped under GAPS_ONLY. | settled |
| D-4 | 2 | T1 is the design's recommended tier: the self-serve envelope plus the WatchConfig key `ingest` / `backfill.self_serve_max_range_days` (int, default 730, `int_positive` reader, config seed migration, full C-05 contract). The operator still chooses the tier at the gate under D-3. | services/xstockstrat-ingest/app/handlers/servicer.py:650-667; app/config/watcher.py:111-113; proposer adopts it and the adversary endorses it in round 2. | settled |
| D-5 | 2 | The backfill request range stays exactly the reported `gap`. Widening to `{gap.start .. requestedRange.end}` is put to the operator as gate question G-2 and is not adopted without sanction. | Operator decision 1; analysis servicer.py:1581,2123,2214,1315-1322 (trace of the empty-window re-run); e2e/insights/backtest-coverage.spec.ts:77-79; uncontested by the adversary in round 2. | settled |
| D-6 | 2 | Server proof of @AC-7 is one table-driven ingest test with a real `ingest_pb2.TriggerBackfillRequest` at scope "0": each envelope condition broken gives PERMISSION_DENIED with no `insert_job` and no notify call, at-cap is QUEUED, and admin is unaffected. The MagicMock gate tests are rewritten with real requests. | tests/test_ingest_servicer.py:362,:594; proposer commitment in round 2, uncontested. | settled |
| D-7 | 2 | Vendor-unfillable gap: after a COMPLETED backfill from the card, a re-run that is still insufficient for the same symbol and gap shows "No vendor data for {range}" and hides the action for that gap. A different gap is still offered. | Proposal round 2 answer to O-8; uncontested by the adversary. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Delete the `TriggerBackfill` admin gate outright. | Opens multi-symbol, FULL, overwrite and callback fan-out jobs to all users; ingest has no server-side symbol or range bound. Both sides reject it. | locked |
| R-2 | 1 | A coded numeric span or range cap in ingest. | Breaches F-07; a numeric cap must be a WatchConfig key with the C-05 contract. | locked |
| R-3 | 1 | Automatic backtest re-run when the backfill completes. | Forbidden by binding operator decision 2. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1: GAPS_ONLY is not a quota bound (`servicer.py:650-667`). Adopt a span-cap key or state the unbounded range as accepted exposure, and correct the gate cost table. | yes | closed @ round 2 (The proposal adopts tier T1: a span-cap WatchConfig key `backfill.self_serve_max_range_days` (default 730, full C-05 contract, seed migration) and a corrected gate cost table. The adversary endorses it.) |
| O-2 | 1 | O-2: backfilling only the prefix `gap` can leave the backtest window empty (analysis `servicer.py:1574-1578`), so @AC-5 can fail. Widening the range changes @AC-2/FR-2 and needs operator sanction. | yes | closed @ round 2 (The proposer traced the empty-window re-run (OK with zero trades on the definition path, a window gap on the SMA path), keeps the exact gap, and brings widening to the gate as G-2, an explicit @AC-2 amendment.) |
| O-3 | 1 | O-3: the retained MagicMock gate tests pass vacuously. A table-driven test with a real `TriggerBackfillRequest` is required as the server proof of @AC-7. | yes | closed @ round 2 (The proposer commits to the table-driven test with a real `TriggerBackfillRequest` and rewrites the MagicMock tests at `:362` and `:594`.) |
| O-4 | 1 | O-4: `gapToBackfillRequest` duplicates the insights request at `insights/strategies/[id]/page.tsx:541-547`; reuse the helper or record the trade-off. | no | closed @ round 2 (One shared `gapToBackfillRequest` mapping serves both the symbol card and the insights button. The fill-mode change on the insights button is split out as O-12 and gate question G-3.) |
| O-5 | 1 | O-5: agent, mcp-tools and strat-lab wording must list every envelope condition, and the denial detail should name the envelope. | no | closed @ round 2 (The denial detail and the agent, mcp-tools and plugin wording list every envelope condition. PERMISSION_DENIED pass-through is confirmed at `tools.py:225-228`. The remaining docstring fix is O-14.) |
| O-6 | 1 | O-6: add `user_id`, from the `x-user-id` header only, to the `ingest.backfill.queued` payload. | no | closed @ round 2 (Already satisfied: ledger stamps the event owner from the `x-user-id` metadata (`ledgerServiceImpl.ts:76-78`) that ingest sends with the event (`servicer.py:502-515`). No payload field is added; the follow-up test is O-10.) |
| O-7 | 1 | O-7: e2e fixtures must come from the canonical builders with an INVENTORY row, a gap distinct from the window, and server-true status and error strings. | no | closed @ round 2 (The proposal commits to canonical builders, an INVENTORY row, a gap distinct from the window and server-true status and error strings. The PARTIAL copy defect is tracked as O-11.) |
| O-8 | 1 | O-8: a vendor-unfillable gap loops COMPLETED, insufficient, backfill again; define the card's behaviour for a second insufficient result. | no | closed @ round 2 (Same-gap memory after a COMPLETED backfill shows "No vendor data for {range}" and hides the action for that gap. Uncontested.) |
| O-9 | 1 | O-9: the proposal cites a non-existent @AC-9; FR-5's PARTIAL and CANCELED branches and the zero-denominator copy have no scenario. | no | closed @ round 2 (@AC-9 exists at `acceptance.feature:44` on `origin/feature/backtest-inline-backfill`, so round 1's claim was wrong. The example rewrites and new scenarios are tracked as O-18.) |
| O-10 | 2 | O-10: drop `user_id` from the `ingest.backfill.queued` payload, because ledger already stamps the owner from `x-user-id` metadata (`ledgerServiceImpl.ts:76-78`). Add a test that the queued event carries `x-user-id` metadata. Proposer to confirm. | yes | open |
| O-11 | 2 | O-11: PARTIAL copy must have two branches, because PARTIAL can occur with zero failed chunks (`servicer.py:739-740`). One vitest case per branch. | yes | open |
| O-12 | 2 | O-12: switching the insights button to GAPS_ONLY is an unsanctioned behaviour and scope change. Keep it FULL through `gapToBackfillRequest(gap, {fillMode})` and put the switch to the operator as G-3. | yes | open |
| O-13 | 2 | O-13: add an eighth envelope condition, a non-empty `x-user-id` that is not `system`, with a row in the table test. | no | open |
| O-14 | 2 | O-14: fix the false sentence at agent `tools.py:1578-1580` and state that non-admins need `fill_mode='gaps_only'` and explicit start and end. | no | open |
| O-15 | 2 | O-15: add the new key to `platform.feature` `@AC-6 @feature-244`, the ingest key table and the registered-keys log; name the coupling with analysis `backtest.max_range_days`; map PERMISSION_DENIED to a specific card message. | no | open |
| O-16 | 2 | O-16: a restart marks a job FAILED and may then resume it, so the card can allow a duplicate. State this as accepted or define the handling. | no | open |
| O-17 | 2 | O-17: cost T1+ (per-symbol active-job de-duplication) and a separate self-serve concurrency limiter for the gate table. | no | open |
| O-18 | 2 | O-18: rewrite the @AC-9 examples to server-true copy and add scenarios for zero-denominator progress, "No vendor data", the over-cap denial and both PARTIAL branches. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
