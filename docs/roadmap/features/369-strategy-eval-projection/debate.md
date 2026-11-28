# Debate Register: strategy-eval-projection

**State**: in-debate
**Mode**: full (round cap lifted by operator override, context.md 2026-11-28)
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 0 (pre-debate gate) | 2026-11-28 | /sdd-design | 3 (operator) | 4 | 0 | 0 | 0 | yes |
| 1 | 2026-11-28 | /sdd-design | 9 | 4 | 0 | 18 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 0 (gate) | Read path scope: this feature stores entry and exit readiness per user, strategy and symbol and serves `EvaluateReadiness` and `GetWatchlistReadiness` from the projection behind `analysis.projection.read_source` (default `legacy`), with a parity test per RPC. The opportunity projection and `ListOpportunities` stay on the legacy path and move to program feature 4 (`pipeline-cutover`). Operator decision 2026-11-28; narrows FR-8. | recon.md § Opportunity and readiness read paths; context.md 2026-11-28 | settled |
| D-2 | 0 (gate) | Evaluation jobs read bars through a marketdata read that does not mark the symbol warm: marketdata gains an additive flag or RPC used only by these jobs. Adds marketdata to the affected services. Operator decision 2026-11-28. | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:301`, `:854`, `:971`; 368 design.md § 17 | settled |
| D-3 | 0 (gate) | Parity observes the live loop without changing it: transitions are compared by reading the live loop's existing cooldown rows after the close, readiness against the legacy readiness values; pairs the live loop did not reach are reported as not comparable. Operator decision 2026-11-28. | analysis `app/repositories/strategy_cooldowns.py:27`, `:43`, `:59`; `app/engine/live_loop.py:358` | settled |
| D-4 | 1 | Trigger: evaluation for a session starts once, after feature 368 marks that session's run done. An ensure entry enqueues one run job per done session; the run job parks on shards of at most 500, and each shard parks on evaluation jobs. A symbol with no bar record, a session with no run, an abandoned run and a user not snapshotted get no evaluation; system-scope symbols are evaluated for every snapshotted owner. | 368 design.md § 7, § 17; analysis `tests/test_job_handler_contract.py:58-70`; `app/engine/job_graph.py:56-58` | settled |
| D-5 | 1 | No handler returns a job-graph `Verdict`, and evaluation runs no work in an executor thread: it is gRPC I/O plus milliseconds of CPU. This closes the item feature 367 left to this feature. | `docs/roadmap/features/367-pipeline-job-graph/design.md:625-627`; analysis `app/engine/job_graph.py:516-519` | settled |
| D-6 | 1 | One scoring path: each strategy is evaluated once with `StrategyEvaluator.evaluate_with_series`, and both readiness traces (entry rule and exit rule) are derived from the same component series through a `trace_rule` function extracted from `evaluate_conditions_traced`, which keeps calling it. | analysis `app/services/evaluator.py:326`, `:367-396`, `:441-491` | settled |
| D-7 | 1 | Position state uses the live loop's own rules: `_apply_transition` folded from the latest stored state, or `_replay_state` over the fetched bars when there is none to continue from. The rule-implied position and the replay semantics are existing behaviour, preserved here and flagged for cutover. The job never reads or writes `analysis.strategy_cooldowns`. | analysis `app/engine/live_loop.py:209`, `:244-274`, `:809-821`; `app/repositories/strategy_cooldowns.py:27`, `:43` | settled |
| D-8 | 1 | Result rows and outbox rows are written in one `job.db` transaction, idempotent by key; 367's hazards H1 and H2 do not apply because the handler never reports inside its transaction. Only the evaluated bar's own transition enters the outbox, never replay or catch-up bars. The dispatcher is a job on the graph that marks rows `suppressed`; it has no delivery code and no key. The outbox key (user, strategy, symbol, bar date, kind) is the future delivery idempotency key. | analysis `app/engine/job_graph.py:304`, `:582-627`; 367 `debate.md` D-33; `packages/proto/ledger/v1/ledger.proto:46-50` | settled |
| D-9 | 1 | Mechanism for D-2: `GetBarsRequest.stored_only = 6` (additive). When set, marketdata serves stored bars, does not mark the symbol warm and makes no vendor fetch; unset behaviour is unchanged. | `packages/proto/marketdata/v1/marketdata.proto:139-146`; `services/xstockstrat-marketdata/internal/service/marketdata_service.go:301`, `:357-370` | settled |
| D-10 | 1 | Mechanism for D-1: `analysis.projection.read_source` is read once at the top of `EvaluateReadiness` and `GetWatchlistReadiness`, after the owner check; any value other than `projection` runs the existing body unchanged. The projection branch reads result rows only: no coverage probe, no kick, no cache write. `ListOpportunities` does not read the key. | analysis `app/handlers/servicer.py:4103`, `:4271`, `:4320-4395`; `app/engine/fundsignal_loop.py:389` | settled |
| D-11 | 1 | Bars window: 400 calendar days ending at the session's day end, the readiness window, so stored readiness can equal legacy readiness for identical inputs; bars after the evaluated bar are dropped. The live loop's 365-day window is a named cause of transition differences. | analysis `app/handlers/servicer.py:4138`; `app/engine/live_loop.py:67` | settled |
| D-12 | 1 | The fundamentals-blend strategy is evaluated like any active strategy; pairs outside its legacy universe are reported as new-path-only, not as mismatches. A stored row from an older bar is served as resolved with its age. | recon.md Notes N1 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 0 (gate) | Serve `ListOpportunities` from the projection in this feature. | Opportunities are universe membership with fields derived from signals, positions, the deny list and grades; storing them all would bring that compute into the evaluation job. Operator chose D-1. | locked |
| R-2 | 0 (gate) | No read path at all in this feature. | Reads would switch at cutover untested in shadow. Operator chose D-1. | locked |
| R-3 | 0 (gate) | Read bars through the existing warming RPCs and accept the warm set growing to the whole universe. | Continuous vendor polling of every universe symbol, competing with 368's post-close fetch. Operator chose D-2. | locked |
| R-4 | 0 (gate) | Add a per-pair decision log to the live loop for exact parity. | Changes the live loop's hot path, against FR-11. Operator chose D-3. | locked |
| R-5 | 1 | Evaluate per pass, as bar records appear, with a new lower lane. | Changes the 367 claim order and risks 368's 30-minute pass budget; held evaluation jobs would tie with held data jobs. | locked |
| R-6 | 1 | The 368 data job enqueues or parks on evaluation jobs. | A data job has no children (368 D-30) and a handler cannot enqueue (`tests/test_job_handler_contract.py:58-70`). | locked |
| R-7 | 1 | Store readiness only for watchlist-bound or requested pairs. | Contradicts D-1's pure read for `EvaluateReadiness` on any symbol and saves little. | locked |
| R-8 | 1 | Compute at read time when the projection has no row. | Breaks the pure-read requirement (FR-8). | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Silent degradation becomes permanent. The live loop's loaders swallow outages (benchmark bars, point-in-time fundamentals, the snapshot, `declared_formula_fundamentals`: `live_loop.py:671-673`, `:694-697`, `:717-720`; `evaluator.py:709-715`); reused in a write-once job they commit a wrong decision and possibly a wrong outbox row. The job needs strict loaders that defer on an outage and keep hold semantics only for absence, as new functions so the live loop does not change. | yes | open |
| O-2 | 1 | Nothing re-runs a session after an outage: deferral ends as succeeded with rows absent after about 90 s of attempts, and a bars error ends dead; the job key is then spent. After cutover that is a silently unevaluated session. FR-2 also says a failed strategy's result records the failure. Needs retry passes or an explicit ruling. | yes | open |
| O-3 | 1 | The current fundamentals snapshot is read per strategy per pair for the whole universe: on the `vendor` source a miss spends vendor quota, on `edgar` it marks the symbol warm (`marketdata_service.go:1843-1851`, `:2144-2146`, `:681`). Point-in-time inputs exist (`evaluator.py:772-774`; `classification_service.go:129`). | yes | open |
| O-4 | 1 | Unreadable formula: with a sink both NOT_FOUND and PERMISSION_DENIED skip the component, while the live loop skips on NOT_FOUND and errors the pair on PERMISSION_DENIED (`evaluator.py:282-290`). A whole-strategy failure row for NOT_FOUND drops decisions the live loop still makes. | no | open |
| O-5 | 1 | Parity date test: daily bars are stamped at or near New York midnight and `SessionDate` adds 6 hours (`marketsession.go:20-25`); a plain New York date cast misdates some. A cooldown stamp from a later session must count as not comparable. | no | open |
| O-6 | 1 | The parity signal cascades: one intraday live entry leaves the live loop in position for weeks, and every restart re-seeds live state by replay (`live_loop.py:809-821`, `:860-866`). Raw mismatch counts are not cutover evidence; the report must separate state-aligned pairs from already-diverged ones and say what it can prove. | no | open |
| O-7 | 1 | Readiness parity: legacy windows end at request time, so a legacy row computed after the next New York midnight uses different bars; long-memory indicators then differ far beyond 1e-9 (`servicer.py:4138`). | no | open |
| O-8 | 1 | Result key: taking the fingerprint out of the key changes FR-3, leaves an edited strategy pending until the next bar, and makes program feature 5 overwrite immutable rows. | no | open |
| O-9 | 1 | Indicators load: sandbox spawns dominate job time and are missing from the drain estimate; a 30 s client deadline on `ExecuteFormula` is consumed by queueing and produces sandbox timeouts of our own making (`services/xstockstrat-indicators/app/handlers/servicer.py:320-328`, `:351-360`). | no | open |
| O-10 | 1 | Slots: evaluation jobs hold worker slots while waiting on an indicators limiter and tie with held data jobs; a long drain can cut the next session's data-stage passes. | no | open |
| O-11 | 1 | Spec and scenario gaps: `@AC-16`, `@AC-17` contradict D-1; FR-2 failure row vs deferred-absent; FR-1 run id; `@AC-26` ratio formula; `@AC-20` end time; `@AC-23` unit. | no | open |
| O-12 | 1 | Projection read: no row maps to PENDING even when no row can ever arrive (inactive strategy, delisted symbol, binding added after the snapshot), and the UI polls every 30 s; `EvaluateReadiness` `computed_at` differs from legacy for failed symbols (`servicer.py:4251`, `:4265-4267`). | no | open |
| O-13 | 1 | `for_owner` rebuilds the evaluator with four arguments, so new keywords are dropped unless it is updated (`evaluator.py:264-269`). | no | open |
| O-14 | 1 | The unreadable sink must be threaded through `_assemble_sector_resolved`, which passes positional arguments (`evaluator.py:493-505`). | no | open |
| O-15 | 1 | A formula definition is fetched up to three times per strategy per job; derive digest, fundamentals map and warm-ups from one memoized read. | no | open |
| O-16 | 1 | Fold semantics: catch-up bars ignore the deny flag, so state can depend on which days a pair ran; document as preserved live behaviour (C-16), do not fix here. | no | open |
| O-17 | 1 | The parity job resolves universes from current watchlists and positions hours after the live loop ran; membership that changed must count as not comparable. | no | open |
| O-18 | 1 | A 24-hour ensure window loses a session when analysis is down over a weekend; skipped (undone or abandoned) runs are invisible to the operator; parse the subject with one split. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
