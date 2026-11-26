# Debate Register: fix-gapsonly-backfill-is

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-26 | /sdd-batch | 5 | 6 | 0 | 5 | 0 | yes |
| 2 | 2026-11-26 | /sdd-batch | 5 | 3 | 4 | 4 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | For 1d, GetDataCoverage computes head, interior and tail gaps with ComputeSessionGaps. The bars come from one gate-free query (MIN/MAX/COUNT plus array_agg of times) using the same predicate as today. Gaps are bounded at the last completed session. The wire shape is unchanged, and covered_ranges is not rewritten. | marketdata_repo.go:243-247; PK (symbol,timeframe,time) at 001_marketdata_hypertables.up.sql:20; the adversary's gate-brittleness finding | settled |
| D-2 | 1 | New additive outcome BACKFILL_SYMBOL_OUTCOME_INCOMPLETE = 4, merged with precedence FAILED > INCOMPLETE > SKIPPED > EMPTY. Any INCOMPLETE entry makes the final status PARTIAL, checked before COMPLETED. | common.proto:156-163; servicer.py:310-317,876-886; @AC-24 @feature-352 keeps EMPTY distinct | settled |
| D-3 | 1 | The GAPS_ONLY verify step also runs on the resume path, keyed by a reserved marker in the symbol_results JSONB. No migration. | servicer.py:308,320-326,956-972 (resume has no verify, confirmed this round) | settled |
| D-4 | 1 | @AC-13 @feature-343 is preserved: the UI maps a PARTIAL with only INCOMPLETE outcomes and zero failed chunks to the no-vendor-data state and does not re-offer the backfill for that gap. | backtest-inline-backfill.feature:90-95; page.tsx re-run shown only when state is ready; no operator sanction for a CHANGE | settled |
| D-5 | 1 | The one-off NYSE closures since 2000 go into the shared marketsession.isHoliday. No second calendar. | marketsession.go:1-2,74 | settled |
| D-6 | 2 | The GAPS_ONLY planner coalesces each symbol's consecutive coverage gaps into one work unit while the merged span (first gap start to last gap end) stays within backfill.chunk_window_days. This bounds chunks per symbol at about the FULL-mode count. Re-fetching the stored sessions between gaps is harmless under overwrite=false. | servicer.py:807-810 (one unit per gap), :829-832 (per-unit chunking); alpaca.feed=iex default at internal/alpaca/client.go:43; ingest CLAUDE.md:159; no *.feature pins the per-gap unit shape | settled |
| D-7 | 2 | Resume verify rebuilds a common.v1.TimeRange that sets start/end only for non-NULL persisted range_start/range_end, mirroring the fresh path's raw request.range. A RED pytest covers a resume with a NULL bound. | servicer.py:296-305 (_ts_to_dt returns None; _dt_to_ts has no None guard), :569-570 (persisted range bounds), agent app/client.py:2151-2158 (one-sided ranges) | settled |
| D-8 | 2 | The resume marker is the reserved symbol_results key 'gaps_only', valued {symbol: entry}. It is persisted as {} at plan time and passed as the _run_chunks symbol_results seed. INCOMPLETE ranks 3 in _OUTCOME_PRECEDENCE, between SKIPPED 2 and FAILED 4. | servicer.py:308,310-326,856,988,1004,1082-1088 | settled |
| D-9 | 2 | An INCOMPLETE-only PARTIAL sends no notify alert. The ingest.backfill.completed ledger payload gains an additive incomplete_symbols list, and the webhook payload is unchanged. | servicer.py:905-924 | settled |
| D-10 | 2 | The head gap (gaps[0]) is classified by one GetDataCoverage store probe over [gaps[0].start - 365d, gaps[0].start), judged on bars_total > 0. gaps[1:] are missing by the separation invariant pinned in TestComputeSessionGaps. A verify or probe RPC failure records FAILED (retryable PARTIAL), not INCOMPLETE. | proposal r2 §2; timeframe.go:77,84; servicer.py:335-346; @AC-1 @feature-153 400-day envelope | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | count < expected deficit gate before the per-time read | Duplicate or mis-calendared rows inflate the count and hide holes, and the pre-open probe always has a deficit, so it saves nothing | locked |
| R-2 | 1 | Request flag include_interior_gaps | Proto change and approval gate for a negligible saving | locked |
| R-3 | 1 | Ingest classifies head and tail gaps by comparing raw timestamps to window earliest/latest | Window-relative classification gives a false COMPLETED, the UTC/NY boundary misclassifies, and it puts calendar logic in Python | locked |
| R-4 | 1 | Leaving resumed GAPS_ONLY jobs unverified | Reproduces COMPLETED-while-missing under deploy restarts | locked |
| R-5 | 1 | Rewriting covered_ranges | No consumer (How-to-Act #3) | locked |
| R-6 | 1 | Reusing EMPTY or FAILED for still-missing sessions | Collides with @AC-24 @feature-352, or conflates fetch errors with missing data | locked |
| R-7 | 2 | One planner work unit per coverage gap under GAPS_ONLY once interior gaps are reported | Chunks, persisted rows and RPCs scale with hole count and repeat on every run for vendor-unfillable IEX holes (C-18) | locked |
| R-8 | 2 | Converting persisted range bounds with _dt_to_ts unconditionally on resume | Raises on the NULL bounds that one-sided agent ranges produce, leaving the job RUNNING and unverified (the R-4 failure mode) | locked |
| R-9 | 2 | Notify alert for an INCOMPLETE-only PARTIAL | Fires on every retry of a vendor-unfillable hole; the ledger field and WARN log carry the signal | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Head carve-out blind spot: a request that starts inside a hole longer than the lookback K classifies the remainder as pre-listing and ends COMPLETED. Close it with bounded classification or record an operator-accepted residual. | yes | open |
| O-2 | 1 | It is unverified whether the BFF/job-status route exposes symbol_results to the UI, which the AC-13-preserving mapping requires. | yes | closed @ round 2 (insightsBff.ts:89-93 returns getBackfillStatus unchanged and useBackfills.ts:33 passes the proto BackfillJob through, so symbolResults (field 16) reaches backtestBackfill.ts with no BFF change. The adversary did not contest this.) |
| O-3 | 1 | Exact shape of the resume verify marker, and the guard against re-finalizing an already-terminal job (ingest findings:30). | no | closed @ round 2 (The marker is 'gaps_only': {symbol: entry}, persisted at :856 and seeded into _run_chunks (:988,:1004) so chunk writes keep it. It merges with no special case. An INCOMPLETE-only PARTIAL has all chunks COMPLETED and is never re-driven. The broader findings:30 issue is out of scope. The NULL-bound resume crash is fixed by the new range-rebuild decision.) |
| O-4 | 1 | Alert policy and message for a PARTIAL caused only by INCOMPLETE. | no | closed @ round 2 (No notify alert for an INCOMPLETE-only PARTIAL (the alert stays gated on failed_symbols or chunks_failed). The ledger event gains an incomplete_symbols field, plus a WARN log.) |
| O-5 | 1 | Re-read webhook-fanout-callback.feature for scenarios that rely on failed_symbols for PARTIAL. | no | closed @ round 2 (webhook-fanout-callback.feature:50,103 and notify :47-51 key only on status. No scenario requires a non-empty failed_symbols for PARTIAL.) |
| O-6 | 2 | K = 365 needs operator approval as a fixed invariant, recorded in context.md and ingest CLAUDE.md (F-07 convention). | no | open |
| O-7 | 2 | GAPS_ONLY jobs in flight at deploy have no marker and resume unverified. Record this as an operator-accepted one-time residual. | no | open |
| O-8 | 2 | The worst-case scan for unset-start ranges is the symbol's full history (2000 floor), doubled by verify. Restate the Assumptions and measure against, or accept within, the @AC-1 @feature-153 budget. | no | open |
| O-9 | 2 | Confirm the exact coalescing boundary rule and that plan_chunks still applies chunk_max_bars inside merged units. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
