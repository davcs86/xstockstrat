# Product Spec: symbol-data-stage

**Created**: 2026-11-28

---

## Problem Statement

Strategy data in analysis is pulled on demand and its prerequisites are implicit: a symbol with no
bars only logs `no_bars`, a frozen daily series is scored as if it were current, and a backfill
followed by a re-run is a manual operator action (program root cause 3,
`docs/roadmap/program-job-graph-analysis-pipeline.md`). The operator needs every symbol a user
cares about to have current daily bars and fundamentals, or an explicit verdict that it cannot,
before anything evaluates it.

## User Story

As the platform operator, I want a daily data stage on the analysis job graph that brings every
universe symbol's bars and fundamentals up to date and records a coverage verdict per symbol, so
that evaluation (program feature 3) runs only on complete data and no backfill is manual.

## Functional Requirements

FR-1. **Daily universe snapshot.** Once per closed trading session, a universe run records, for
every user, the set of symbols made of that user's positions, signalled symbols and watchlist
symbols (operator decision D-6), up to about 1,000 symbols per user. The snapshot is durable and
lists which users have which symbol and whether the symbol is held. Every instance with the stage
enabled ensures the session's run through the idempotent enqueue of feature 367, so it runs once
however many instances are up. One user's failed source read does not lose the other users'
snapshot.

FR-2. **One data job per symbol and session.** The run enqueues one data job per distinct symbol
across all users, keyed by symbol and session date, carrying the run id. A symbol held by any user
runs in the `held` lane; every other symbol runs in the `watchlist` lane. Enqueuing the same
symbol and session again creates no second job.

FR-3. **Bars to the last closed session.** A data job checks the symbol's daily bar coverage. The
symbol is `covered` when its latest daily bar is the last closed session and its stored daily
series has no interior hole over the required history window. The hole detection is feature 364's
(`GetDataCoverage` gaps); this feature does not reimplement it.

FR-4. **Automatic backfill.** When bars are not covered, the data job starts a gaps-only backfill
for the missing ranges as a child job and parks until it finishes. No operator action is needed.
When the child succeeds the data job re-checks coverage.

FR-5. **Terminal "no vendor data" verdict.** When a completed backfill returns nothing for a
missing range (feature 343's `BACKFILL_SYMBOL_OUTCOME_EMPTY`), the symbol's coverage verdict for
that session is `no_vendor_data`. That verdict is terminal for the session: the job does not retry
it, and a job that waits on it is not run. A transient backfill failure is retried under feature
367's attempt bound and ends in the dead-letter state, never in a silent success.

FR-6. **Fundamentals refreshed by staleness.** A data job refreshes the symbol's fundamentals
snapshot when the stored one is older than the source's freshness window, and leaves a fresh one
alone. A fundamentals failure, an exhausted quota or a non-filer never fails the data job or
changes the bar verdict; it is recorded as the fundamentals state of the coverage record (`fresh`,
`stale` or `unavailable`).

FR-7. **EDGAR is the primary fundamentals source.** The latest-snapshot fundamentals source
defaults to EDGAR, with the configured vendor as the fallback for a symbol that is not an SEC
filer (operator decision, 2026-11-28). A deployment that has never set the source serves EDGAR
after this feature. The FMP daily cap of 250 calls therefore applies only to the fallback.

FR-8. **Coverage record.** Each data job writes one durable coverage record per symbol and
session: the bar verdict (`covered` or `no_vendor_data`), the earliest and latest stored daily
bar, and the fundamentals state (FR-6). Re-running the job for the same symbol and session
replaces the record and creates no second one.

FR-9. **Bar record that triggers evaluation.** When a symbol is `covered` for a session, the stage
writes one durable bar record for that symbol and session, exactly once. It is the trigger program
feature 3 consumes; nothing in this feature evaluates a strategy. A symbol that is not `covered`
gets no bar record.

FR-10. **One trading calendar.** "Last closed session" is computed from the platform's existing
trading calendar (`packages/proto/marketsession`), including weekends and market holidays. The
stage creates no run on a non-trading day and never treats today's unfinished session as closed.

FR-11. **Kill switch, no behavior change.** With `analysis.pipeline.data_stage_enabled` false, no
universe run and no data job is created. The stage is on by default (operator decision,
2026-11-28). This feature removes no existing loop and changes no analysis RPC response; the only
externally visible changes are fresher stored bars and FR-7.

FR-12. **Telemetry.** The stage exports, per run, the number of symbols by bar verdict, the number
of backfills started, and the fundamentals states, through the existing telemetry export.

## Out of Scope

- Evaluating strategies, result rows, the outbox and the parity report (program feature 3,
  `strategy-eval-projection`).
- Retiring the live loop, the opportunity refresh, the readiness materializer or any existing
  on-demand bar fetch (program feature 4, `pipeline-cutover`).
- Enqueuing data jobs on a change (a new watchlist symbol, a new position) between daily runs
  (program feature 5, `change-driven-reevaluation`). The daily run is the only trigger here.
- Intraday bars and any timeframe other than daily (operator decision D-2).
- Strategies reading fundamentals directly and retiring the fundamentals signal (program feature 6).
- A UI or agent view of coverage (operator decision, 2026-11-28; see Consumer Surface).
- A job mechanism in Go services. Marketdata and ingest stay RPC servers that an analysis job
  calls (program plan, "One queue, owned by analysis").

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-analysis` — owns the universe run, the data job kinds, the coverage and bar records.
- `xstockstrat-marketdata` — EDGAR becomes the default snapshot source (FR-7); serves coverage,
  fundamentals and, if the design chooses it, the last-closed-session answer (FR-10).
- `xstockstrat-ingest` — serves the backfill the child job drives (FR-4). A code change is needed
  only if the design finds the existing `TriggerBackfill`/`GetBackfillStatus` contract insufficient.
- `xstockstrat-portfolio` — serves positions and watchlists for the snapshot (FR-1). A code change
  is needed only if the design finds no existing cross-user read.
- `xstockstrat-config` — seeds the new key and the changed default.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — internal platform stage (operator decision, 2026-11-28). The coverage and bar
  records are consumed by the evaluation jobs of program feature 3 inside the same service, and
  operators observe the stage through telemetry (FR-12) and the job tables. The user-facing view of
  a symbol's data state arrives with the projection reads, switched on in the named follow-up
  `pipeline-cutover` (program feature 4).

## Proto Contract Changes

- [ ] No proto changes required
- Undecided until `/sdd-design`: FR-10 has no Python calendar today, so the design chooses between
  a new non-breaking marketdata RPC that returns the last closed session and another single-source
  mechanism. FR-1 may need a non-breaking cross-user read on portfolio. No breaking change is
  permitted by this spec.

## Config Key Changes

New key, namespace `analysis`, stored namespace-relative, read fresh at each use through the
service's `WatchConfig` watcher (PLAT-6). Reader:
`services/xstockstrat-analysis/app/engine/job_graph.py:JobGraphSettings` (exists; `/sdd-design` may
move the read into the stage's own settings object). Seed migration:
`services/xstockstrat-config/migrations/062_analysis_data_stage_keys` (`061` is the latest on
`main-dev` today; re-check the number at `/sdd-spec` and `/sdd-execute`).

- `analysis.pipeline.data_stage_enabled` — bool, code default `true`. Kill switch for the universe run and the data jobs (FR-11).

Changed default on an existing key, namespace `marketdata` (FR-7). Reader: the existing live read
in `services/xstockstrat-marketdata` (path and symbol to be cited by `/sdd-design` recon). The same
seed migration updates the stored global row only where it still holds the old default.

- `marketdata.fundamentals.snapshot_source` — string, code default changes from `vendor` to `edgar`.

How the run is scheduled after the close, and whether that needs a key, is a design output; any
further key is added to this section before `/sdd-spec`.

## Database Changes

New tables in the `analysis` schema for the universe snapshot (run, user, symbol, held flag), the
per-symbol coverage record and the per-symbol bar record. One migration pair, `032` in
`services/xstockstrat-analysis/migrations/` (`031` is the latest today; re-check at `/sdd-spec`).
Table and column names, and retention, are design outputs. No change to the `marketdata` schema is
expected.

## Feature Workflow Notes

Branch to create: `feature/symbol-data-stage` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Design Constraints

Inputs the design must satisfy. Each states what `/sdd-design` has to show.

- **Job-graph contract.** Feature 367 has no generic periodic-job API (only `_ensure_prune`), a
  verdict is a free string, a parent declares its child kinds at registration, and a handler's only
  database access is `job.db()`. The design must fit these or state the exact core change it needs.
- **One universe function.** Owner-level symbol drains are duplicated today between
  `app/engine/live_loop.py` and `app/handlers/servicer.py`, and `resolve_universe` is per strategy.
  The design must name the single read the snapshot uses and must not add a third copy (DRY guard
  rail). It must not change what the legacy loops read (FR-11).
- **Calendar single source.** The trading calendar exists only in Go. The design must not create a
  second, hand-maintained holiday table in Python.
- **Backfill ownership.** `TriggerBackfill` is an ingest RPC that fans out to marketdata. The
  design must state which service the child job calls, how it learns completion without holding a
  worker slot for the whole backfill, and how a backfill the operator started by hand for the same
  symbol is not duplicated.
- **Vendor load at the close.** About 1,000 symbols become due at once. The design must bound
  concurrent vendor calls for bars and for EDGAR (`marketdata.edgar.rate_limit_rps` is 10) and show
  the drain time at the D-13 ceiling.
- **Changed default (ledger, feature 129).** A provider change that audited only the proto missed
  seven literal config-key reads in service code. The design must list every read of
  `marketdata.fundamentals.snapshot_source` and every test that assumes `vendor`.
- **Bool default (feature-100 trap).** A missing `data_stage_enabled` row must read as `true`, not
  as the type's zero value.
- **Connection budget (F-06).** Analysis keeps its 2-connection client pool and the fixed
  2-connection control pool. The stage adds no pool.
- **Retention.** Snapshot, coverage and bar records grow by up to about 10,000 rows per session at
  the D-13 ceiling. The design must state how they are pruned.
- **Seam with program feature 3.** The bar record and the snapshot are the contract
  `strategy-eval-projection` (feature 369) is designed against. The design must state their keys
  and the guarantee "exactly one bar record per covered symbol and session" precisely.
- **Unused capability (C-18).** The bar record has no reader until feature 369. It is in scope
  because the program plan fixes it as the trigger; the design adversary should test that.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Fundamentals scope.** Resolved 2026-11-28: the operator chose "Also make EDGAR primary" (FR-7).
- [x] **Activation default.** Resolved 2026-11-28: the operator chose "On by default" (FR-11).
- [x] **Consumer surface.** Resolved 2026-11-28: the operator chose "None, internal only".
