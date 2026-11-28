# Product Spec: strategy-eval-projection

**Created**: 2026-11-28

---

## Problem Statement

Strategy evaluation in analysis is a timer loop whose position state lives in memory and is rebuilt
by replay after each restart, whose alerts and ledger events are best-effort calls with no
idempotency key, and whose opportunity and readiness reads trigger computation (program root causes
1, 2, 5 and 6, `docs/roadmap/program-job-graph-analysis-pipeline.md`). The operator needs evaluation
to be a durable per-item job whose results are stored once and read many times, and needs proof
that it agrees with the live loop before anything switches to it.

## User Story

As the platform operator, I want strategy evaluation to run as jobs that write a durable result
projection and an outbox of transitions, in shadow beside the live loop with a parity report, so
that I can switch alerts and reads to the new path (program feature 4) with evidence.

## Functional Requirements

FR-1. **Evaluation job per user, symbol and closed bar.** For each bar record written by feature
368 (`symbol-data-stage`) and each user whose universe snapshot contains that symbol, one
evaluation job exists, keyed by user, symbol and bar date, carrying the universe-run id. The job
runs in the `held` lane when that user holds the symbol and in the `watchlist` lane otherwise.
Evaluation fires only on a closed daily bar (operator decision D-2); a symbol with no bar record
for a session is not evaluated for it.

FR-2. **All active strategies, isolated.** A job evaluates the symbol against every active strategy
of that user (operator decisions D-7 and 2026-11-28), not only live-enabled or watchlist-bound
ones. It fetches the symbol's bars once. One strategy's failure does not lose or alter another
strategy's result in the same job; the failed strategy's result records the failure.

FR-3. **Result rows keyed by definition fingerprint.** Each evaluated strategy produces one result
row keyed by user, strategy, symbol, bar date and the feature 327 evidence fingerprint (strategy
definition plus referenced formula content). The row holds the decision for that bar (entry, exit
or neither), the position state after the bar and the readiness trace. Re-running the same job
writes no second row and changes no stored row.

FR-4. **Durable position state.** Whether a strategy is in position on a symbol, and its entry and
exit cooldown anchors, are read from and written to the projection, not held in memory. After a
restart the next evaluation continues from the stored state without replaying history. The shadow
path does not read or write any state the live loop uses (`analysis.strategy_cooldowns`).

FR-5. **No look-ahead.** A job for bar date D uses only bars dated D or earlier, whenever it runs,
including when it runs late or is retried after later bars exist.

FR-6. **Transitions go to an outbox, exactly once.** When a result is an entry or exit transition,
an outbox row is committed in the same transaction as the result row, under an idempotency key of
user, strategy, symbol, bar date and transition kind. A retried or re-run job creates no second
outbox row.

FR-7. **Dry-run dispatcher.** A dispatcher drains the outbox and marks each row `suppressed`
without calling notify or the ledger (operator decision, 2026-11-28). It has no delivery switch in
this feature: no alert and no ledger event can be produced by the new path. Program feature 4 adds
the switch together with the delivering code.

FR-8. **Projection read path behind a switch.** Opportunity and readiness reads can be served from
the projection as pure reads that start no computation. `analysis.projection.read_source` selects
the source and defaults to `legacy` (operator decision, 2026-11-28). With `legacy`, every
`ListOpportunities`, `EvaluateReadiness` and `GetWatchlistReadiness` response is produced by the
existing code path, unchanged. With `projection`, the same RPCs answer from result rows and a read
never enqueues, kicks or computes anything.

FR-9. **Parity report in the logs.** After a universe run's evaluation jobs finish, a parity step
compares the new path with the live path for that bar and writes the report to the service logs
and telemetry (operator decision, 2026-11-28). It covers transitions (entry and exit per user,
strategy and symbol), the opportunity set and readiness state. It compares only the pairs both
paths cover and reports separately the count of pairs only the new path covers and only the live
path covers. Each mismatch is logged with user, strategy, symbol, bar date and both values, up to
a per-run detail bound, with the total count always reported. The bound's value is a design
output.

FR-10. **Shadow measurements.** The feature exports the measurements feature 367 deferred to this
shadow run: time from the first bar record of a run to its last evaluation job finishing, ready
depth and oldest-ready age per lane during the close-of-day burst, attempts per second, and the
dead-tuple ratio of the job table.

FR-11. **Kill switch, no behavior change.** With `analysis.pipeline.evaluation_enabled` false, no
evaluation job, result row, outbox row or parity report is created. This feature removes no
existing loop, sends no alert, appends no ledger event and, with the read switch on `legacy`,
changes no RPC response.

FR-12. **Retention.** For each user, strategy and symbol the projection keeps the latest result row
and every transition row; non-transition rows and drained outbox rows older than a retention
window are pruned by a job on the graph. The window's length is a design output. Formula results are not stored for reuse across users (operator decision D-5).

## Out of Scope

- Delivering alerts or ledger events from the new path, seeding state on the first bar without
  alerting, and flipping the read switch (program feature 4, `pipeline-cutover`).
- Retiring the live loop, the opportunity refresh, the read kicks, the readiness materializer and
  their caps and keys (program feature 4).
- Re-evaluating on a strategy, formula, watchlist, position or signal change (program feature 5).
  A changed definition is picked up at the next bar under its new fingerprint.
- Strategies reading fundamentals directly (program feature 6) and presentational watchlist
  bindings (program feature 7).
- Universe-relative ranking (operator decision D-10). The run id and the run-level wait stay
  available to it.
- A shared built-in indicator store (program feature 9).
- A UI page or agent tool for the parity report (see Consumer Surface).
- Raising the analysis instance count (program feature 8).

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-analysis` — owns the evaluation job kinds, the result projection, the outbox, the
  dispatcher, the projection read path and the parity step.
- `xstockstrat-config` — seeds the new `analysis` config keys.

`xstockstrat-indicators` and `xstockstrat-marketdata` are called through their existing RPCs with
no contract change.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — shadow feature. The parity report is read by the operator in the service logs and
  telemetry (FR-9; operator decision 2026-11-28, confirmed: logs first, a user-scoped agent MCP
  tool only if the design shows logs cannot carry the report, in which case the operator is asked). The user-facing consumers, `ListOpportunities`
  and the readiness RPCs, keep their legacy source here (FR-8) and switch to the projection in the
  named follow-up `pipeline-cutover` (program feature 4).

## Proto Contract Changes

- [x] No proto changes required — the projection read path answers the existing RPCs and messages.
  If `/sdd-design` concludes the parity report needs the fallback agent tool, the RPC it adds is
  recorded here before `/sdd-spec`.

## Config Key Changes

Both keys are in namespace `analysis`, written below in their display FQN, stored
namespace-relative (`pipeline.evaluation_enabled`, `projection.read_source`) and read fresh at
each use through the service's `WatchConfig` watcher (PLAT-6).

- Reader of `pipeline.evaluation_enabled`: a new accessor (name fixed at `/sdd-spec`) on
  `services/xstockstrat-analysis/app/engine/job_graph.py:JobGraphSettings`, read as
  `get_bool("pipeline.evaluation_enabled", default=True)` like the existing `worker_enabled`, so a
  missing row reads `true` (feature-100 trap).
- Readers of `projection.read_source`: the servicer methods `ListOpportunities`,
  `EvaluateReadiness` and `GetWatchlistReadiness` in
  `services/xstockstrat-analysis/app/handlers/servicer.py`, through one shared accessor in that
  file (name fixed at `/sdd-spec`); a missing
  or unrecognised value reads `legacy`.

Seed migration:
`services/xstockstrat-config/migrations/063_analysis_evaluation_keys` (an up and down pair; `061` is the latest on
`main-dev` today and `062` is planned by feature 368; re-check at `/sdd-spec` and `/sdd-execute`).

- `analysis.pipeline.evaluation_enabled` — bool, code default `true`. Kill switch for evaluation jobs, the outbox and the parity step (FR-11).
- `analysis.projection.read_source` — string, `legacy` | `projection`, code default `legacy`. Source for opportunity and readiness reads (FR-8).

The parity detail bound (FR-9) and the retention window (FR-12) are design outputs: each is
either a constant or a key added to this section before `/sdd-spec`.

## Database Changes

New tables in the `analysis` schema for evaluation result rows (including position state) and for
the outbox, with the indexes the opportunity and readiness reads need. One up and down migration pair, `033`
in `services/xstockstrat-analysis/migrations/` (`031` is the latest today and `032` is planned by
feature 368; re-check at `/sdd-spec`). Table and column names are design outputs.

## Feature Workflow Notes

Branch to create: `feature/strategy-eval-projection` (branch from `main-dev`, after feature 368 is
on `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Design Constraints

Inputs the design must satisfy. Each states what `/sdd-design` has to show.

- **Depends on feature 368.** The bar record, the universe snapshot and the coverage record are
  368's contract. This feature is designed only after 368's design is approved, and merges after it
  (`docs/roadmap/features/merge-order.md` row to be added at `/sdd-review`).
- **Effects are at-least-once (feature 367).** A handler can run more than once and its only
  database access is `job.db()`. The design must show the result row and the outbox row commit
  atomically and idempotently within that contract, and must resolve hazards H1 and H2 that 367
  recorded for an in-transaction report.
- **Evaluator reuse.** `app/services/evaluator.py:StrategyEvaluator` is shared by the backtest,
  readiness, opportunities and the live loop, and calls `xstockstrat-indicators` per component with
  the owner's `x-user-id`. The design must reuse it, must not fork a second scoring path, and must
  state how header propagation (PLAT-4) works from a job with no inbound request.
- **Compute once per job.** The program plan asks for bars and built-in indicators computed once
  per job across that user's strategies. The evaluator recomputes shared components per strategy
  today. The design must state what is shared and show it cannot leak one strategy's failure or one
  user's formula result into another.
- **Parity semantics.** The live loop passes no signals map, honours watchlist bindings, a
  per-cycle cap of 50 pairs and an in-process alert throttle, and evaluates on a 60 s timer. The
  design must define when two paths "agree" on a transition despite those differences, and how the
  parity step observes the live path's transitions without changing the live loop's behavior.
- **Projection is one read path among several (C-10(b), ledger 2026-08-01).** Opportunity and
  readiness values are exposed by several RPCs. The projection read must serve every field the
  legacy path serves, pinned by an executable parity test per RPC.
- **Promoted scenarios (C-16).** With `read_source` on `legacy` no promoted scenario changes. The
  design must list each durable scenario the `projection` setting would change (features 177, 181,
  185, 365, 366 and others) and confirm none is changed by default; the signed CHANGE rows belong
  to program feature 4.
- **Result volume.** Up to about 100,000 result rows per bar at the D-13 ceiling. The design must
  show the write rate, table growth under FR-12 and vacuum behavior.
- **Close-of-day burst and indicator load.** About 10,000 evaluation jobs become ready together.
  The design must bound concurrent calls to `xstockstrat-indicators` and `xstockstrat-marketdata`
  and state the expected drain time that FR-10 then measures.
- **Connection budget (F-06).** Analysis keeps its 2-connection client pool and the fixed
  2-connection control pool. The dispatcher and the parity step add no pool.
- **Executor-thread handlers.** Feature 367 left cancellation of a handler running in an executor
  thread "to be designed in program feature 3". The design must state whether evaluation runs in
  one and, if so, what a cancelled job's thread can still write.
- **Bool default (feature-100 trap).** A missing `evaluation_enabled` row must read as `true`.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Read switch.** Resolved 2026-11-28: the operator chose "Legacy reads, switch at cutover" (FR-8).
- [x] **Parity report surface.** Resolved 2026-11-28: the operator answered "Could be in the logs?
  Otherwise, Agent MCP tool, user-scoped" (FR-9).
- [x] **Outbox scope.** Resolved 2026-11-28: the operator chose "Outbox + dry-run dispatcher" (FR-7).
- [x] **Strategy set.** Resolved 2026-11-28: the operator chose "All active, parity on overlap" (FR-2, FR-9).
- [x] **Evaluation default.** Resolved 2026-11-28: the operator chose "On by default".
  `analysis.pipeline.evaluation_enabled` defaults to `true`; the shadow run costs up to about
  10,000 jobs and their indicator calls per session at the D-13 ceiling.
- [x] **Outbox delivery key.** Resolved 2026-11-28: the operator chose "Drop it, cutover adds it" (FR-7).
