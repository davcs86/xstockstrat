# Debate Register: opportunity-live-only-rotation

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-26 | /sdd-batch | 5 | 3 | 0 | 7 | 0 | yes |
| 2 | 2026-11-26 | /sdd-batch | 4 | 4 | 4 | 7 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The live-only chunk is a symbol-ordered, identity-resumed window (bisect_right on the persisted last-evaluated normalized symbol, wrapping to 0). It replaces the conviction sort and slice. An empty pool leaves the cursor untouched and writes nothing. | servicer.py:5541-5547; live_loop.py:456-466; insights.md:1856; adversary concurred | settled |
| D-2 | 1 | The cursor is a nullable live_only_cursor column on analysis.opportunity_compute_state, added by a new additive analysis migration (>=030). It is upserted cursor-only on conflict, on the same connection and transaction as the opportunities DELETE+INSERT. The servicer owns the transaction and passes conn to both repos. | operator 'use postgres'; opportunities.py:88-120; 023_opportunity_compute_state.up.sql:8-13; servicer.py:4798-4799; adversary C-18 note | settled |
| D-3 | 1 | If the carried-rows read fails, the whole compute fails. The previous queue, carried rows and cursor stay intact, and the compute never proceeds without the carry. | 356 @AC-5/@AC-10; 308 debate R-4; adversary concurred | settled |
| D-4 | 1 | Carried rows keep their stored computed_at, valid_until and composite_score. They join the symbol_score fold, and a symbol with carried rows gets no (sym,"") row. | servicer.py:5975-5983, 5556-5560; operator 'Keep own age'; 200 @AC-10 | settled |
| D-5 | 1 | The shortfall diagnostic is computed from the full pool before chunking. There is no new scheduler, and the planning unit is one chunk per full compute. | fails.md:661-663; operator FR-2a; servicer.py:6045; adversary concurred subject to operator accepting the shortfall | settled |
| D-6 | 2 | Carry eligibility: a stored row qualifies only if it is live-only by provenance, its symbol is a non-chunk pool symbol, its strategy is in resolved.universe, and it is unexpired by both clocks. An authoritative fresh-wins dedup by opportunity_key runs at the append site after step 5, the cut and the stamp, and before the symbol_score fold. | live_loop.py:108-111; servicer.py:5451-5455, 5617-5639; 011_opportunities.up.sql:21; adversary r2 accepted it as answering O-1 | settled |
| D-7 | 2 | One clock: a fresh live-only row is stamped valid_until = now + cycle_days x 24h, and other rows keep session_end + window_hours. A carried row is dropped when valid_until <= now OR age >= cycle. The heal applies the live-only stamp to live-only rows and resets their age. | servicer.py:5955-5963, 5317-5320; opportunities.py:233; operator 'Keep own age, max age'; adversary r2 raised no objection | settled |
| D-8 | 2 | Carried rows count in GetStrategyAnalytics queue_share with no code change. This is not a C-16 CHANGE, because the share is defined over valid attributed rows. | opportunities.py:363-383; adversary r2 had no objection to O-4 | settled |
| D-9 | 2 | Dispositions survive a carry with no extra work, because they are joined at read time from opportunity_actions by opportunity_key. | opportunities.py:241-242, 274-279; adversary r2 verification | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Derive the per-compute live-only limit from ceil(pool/cycle_days) | Contradicts the operator's FR-2a ruling that the per-compute limit wins, and lets the trace cost grow with pool size. | locked |
| R-2 | 1 | Carry eligibility tested only via _new_live_strats / live_by_symbol (resolved.union) | Includes deny-listed strategies, which collide on the opportunities PK with the step-5 muted placeholder (servicer.py:5451-5452, 5617-5625; 011:21). | locked |
| R-3 | 1 | Divergent per-row validity with no read-side staleness trigger | The full-recompute kick fires only on a no-rows fresh read (servicer.py:4775-4792), so a partially stale queue never revalidates. | locked |
| R-4 | 2 | An unscoped has_expired, where any expired row of the user selects the stale branch | It disables the 185 @AC-8 surgical heal, because retry_symbols is computed only on the fresh branch (servicer.py:4775-4789), and it lets out-of-scope rows flip a filtered read. | locked |
| R-5 | 2 | Carry eligibility on signal presence alone, with no action-consistency check | Action is recomputed each pass from the current direction (servicer.py:5877, 6810), so a carried row could keep an action the current signal contradicts. | locked |
| R-6 | 2 | A '-infinity' valid_until sentinel on the first cursor insert | The asyncpg decode is unverified at the servicer.py:4799 comparison and risks a TypeError on the cold/empty path; the epoch, to_timestamp(0), is aware and skew-safe. | locked |
| R-7 | 2 | A 'last successful compute' stamp on compute_state as the read-side staleness trigger | It costs the same query and contradicts D-2's cursor-only on-conflict upsert. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Carried rows collide with denied placeholders on PK (user_id, opportunity_key); carry selection must run after step 5 and the max_universe_size cut, exclude candidates and denied_covered, test resolved.universe, and dedup with the fresh row winning. | yes | closed @ round 2 (Proposal r2 tests carry eligibility against resolved.universe (deny-safe), adds the fresh-wins opportunity_key dedup after step 5 and the cut, and adds a real-PG RED test; the adversary accepted it.) |
| O-2 | 1 | Mixed validity defeats stale-while-revalidate; a read-side staleness trigger independent of per-row validity is needed. | yes | closed @ round 2 (A read-side staleness trigger (has_expired routing to the existing stale branch) was adopted; its scoping defect is tracked as a new round-2 blocking objection, and the synthesis includes the fix.) |
| O-3 | 1 | The validity (session_end) and FR-8 (computed_at) clocks diverge on weekends, and the heal re-stamps live-only rows at window_hours; drop a carried row on valid_until<=now OR age>=cycle, and give the heal the live-only stamp. | yes | closed @ round 2 (A single clock (live-only valid_until = computed_at + cycle), the pinned drop rule valid_until <= now OR age >= cycle, and the heal applying the live-only stamp.) |
| O-4 | 1 | Carried rows inflate GetStrategyAnalytics queue_share; declare a C-16 CHANGE or exclude them. | no | closed @ round 2 (queue_share is defined over valid attributed rows, so carried rows count with no rule change; the adversary concurred.) |
| O-5 | 1 | valid_window_hours is effectively overridden for live-only rows; update the C-05 docs and cap the stamp at 168h or waive. | no | open |
| O-6 | 1 | The operator must explicitly accept the FR-2 shortfall as the default outcome at homelab scale. | no | open |
| O-7 | 1 | Verify carried-row action re-INSERT against the 308 and 330 diffs before spec. | no | open |
| O-8 | 2 | has_expired must exclude live-only rows and apply the read's filters (symbol, dispositions), so the partial-expiry state keeps the fresh branch and the 185 @AC-8 surgical heal; otherwise an operator-signed C-16 CHANGE is required. | yes | open |
| O-9 | 2 | Add carry predicate (f): the current best_direction must resolve to the stored action via _resolve_action_tag, otherwise drop the row; add a RED signal-flip test. | yes | open |
| O-10 | 2 | Build carried_symbols, which suppresses the step-3 (sym,'') row, from the pre-step-3 predicates (a)(b)(c)(e)(f) only; dedup removes a carried row only when a fresh row with the same key exists; add an invariant test that every pool symbol has at least one row. | yes | open |
| O-11 | 2 | The write_cursor first-insert valid_until sentinel must decode safely at servicer.py:4799; use to_timestamp(0) and pin it with a real_pg test. | yes | open |
| O-12 | 2 | Read-driven kicks advance the cursor: log only on a change of (pool bucket, N, cycle_days), label the projection in computes, and offer the operator 'advance only on the daily refresh'. | no | open |
| O-13 | 2 | An unavailable fresh chunk evaluation replaces a good live-only row; either rely on the surgical heal (recorded) or keep the prior eligible row when the fresh row is sym_unavailable. | no | open |
| O-14 | 2 | C-18: bound and measure the queue row count, since carried rows enlarge the per-poll full-queue Python pagination (servicer.py:4743-4746); decide whether to cap carried rows. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
