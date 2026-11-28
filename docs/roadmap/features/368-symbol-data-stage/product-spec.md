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
symbols (operator decision D-6). This feature applies no cap; the D-13 sizing is a Design
Constraint. The snapshot is durable and
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
series has no interior hole over the history window (its length is a design output, see Design
Constraints). The hole detection is feature 364's
(`GetDataCoverage` gaps); this feature does not reimplement it.

FR-4. **Automatic backfill.** When bars are not covered, the data job starts a gaps-only backfill
for the missing ranges as a child job and parks until it finishes. No operator action is needed.
When the child succeeds the data job re-checks coverage.

FR-5. **Terminal "no vendor data" verdict.** When a completed backfill returns nothing for a
missing range (`BACKFILL_SYMBOL_OUTCOME_EMPTY`, feature 343) or skips the symbol because it is
flagged delisted (`BACKFILL_SYMBOL_OUTCOME_SKIPPED`, feature 352), the symbol's coverage verdict
for that session is `no_vendor_data`. That verdict is terminal for the session: the job does not
retry it and starts no second backfill. A transient backfill failure is retried under feature
367's attempt bound and ends in the dead-letter state, never in a silent success; the symbol then
has no `covered` verdict and no bar record for that session.

FR-6. **Fundamentals refreshed by staleness.** A data job refreshes the symbol's fundamentals
snapshot when the stored one is older than the source's freshness window, and leaves a fresh one
alone. A fundamentals failure, an exhausted quota or a non-filer never fails the data job or
changes the bar verdict; it is recorded as the fundamentals state of the coverage record (`fresh`,
`stale` or `unavailable`).

FR-7. **EDGAR is the default fundamentals source.** The code default and the seeded default of
the latest-snapshot fundamentals source become `edgar`, with the configured vendor as the fallback
for a symbol that is not an SEC filer. A deployment with no stored value serves EDGAR. A stored
value is never changed by this feature: both staging deployments already hold `edgar`, and
production holds the seeded `vendor` row, which the operator flips by hand (operator decisions,
2026-11-28). Until then the data stage's fundamentals refresh in production runs against the
vendor quota and FR-6's degraded states apply.

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
  `pipeline-cutover` (program feature 4). FR-7 changes which source serves `GetFundamentals` to
  UI and agent readers only on a deployment with no stored value; no existing deployment is one.

## Proto Contract Changes

- [ ] No proto changes required
- [x] Undecided, additive only. Decided at `/sdd-design`: FR-10 has no Python calendar today, so the design chooses between
  a new non-breaking marketdata RPC that returns the last closed session and another single-source
  mechanism. FR-1 may need a non-breaking cross-user read on portfolio. No breaking change is
  permitted by this spec.

## Config Key Changes

The keys below are written in their display FQN; the stored key is namespace-relative.

New key. Namespace `analysis`, stored key `pipeline.data_stage_enabled`, `value_type` bool, read
fresh at each use through the service's `WatchConfig` watcher (PLAT-6). Reader: a new accessor on
`services/xstockstrat-analysis/app/engine/job_graph.py:JobGraphSettings`, read as
`get_bool("pipeline.data_stage_enabled", default=True)` like the existing `worker_enabled`, so a
missing row reads `true` (feature-100 trap). Seed migration:
`services/xstockstrat-config/migrations/062_analysis_data_stage_keys` (`061` is the latest on
`main-dev` today; re-check the number at `/sdd-spec` and `/sdd-execute`).

- `analysis.pipeline.data_stage_enabled` — bool, code default `true`. Kill switch for the universe run and the data jobs (FR-11).

Changed default on an existing key (FR-7). Namespace `marketdata`, stored key
`fundamentals.snapshot_source`, `value_type` string, live read. Reader:
`services/xstockstrat-marketdata/internal/service/marketdata_service.go:snapshotSource`, whose
default constant `snapshotSourceVendor` and unknown-value fallback both change to the edgar value.
The same seed migration changes the row's `default_value` to `edgar` and leaves every stored
`value_data` as it is. Docs that state the default and must change with it:
`services/xstockstrat-marketdata/CLAUDE.md` (key table) and `docs/patterns/config-governance.md`.

- `marketdata.fundamentals.snapshot_source` — string, code default changes from `vendor` to `edgar`.

How the run is scheduled after the close, and whether that needs a key, is a design output; any
further key is added to this section before `/sdd-spec`.

## Database Changes

New tables in the `analysis` schema for the universe snapshot (run, user, symbol, held flag), the
per-symbol coverage record and the per-symbol bar record. One migration pair, `032` in
`services/xstockstrat-analysis/migrations/` (`031` is the latest today; re-check at `/sdd-spec`).
Table and column names, and retention, are design outputs. No change to the `marketdata` schema is
expected. `scripts/db-migrate.sh` applies config migrations before analysis migrations, so config
`062` lands before analysis `032`; neither depends on the other's content.

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
- **History window.** FR-3's interior-hole check needs a window. The design must fix its length
  from what evaluation needs (the live loop reads a 365-day lookback today) and say whether it is
  a constant or a key.
- **Sizing (D-13).** About 10 users and about 1,000 symbols per user. FR-1 applies no cap, so the
  design must state what bounds a run if a user exceeds that.
- **Early closes.** `packages/proto/marketsession` does not model early closes; the design must
  state when a half-day session counts as closed.
- **Promoted scenarios (C-16).** FR-7 changes a default, not a stored value. The design must
  confirm that every durable marketdata scenario naming `snapshot_source` sets it explicitly and
  therefore does not change, or raise a CHANGE row for the operator.
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

- [x] **Fundamentals scope.** Resolved 2026-11-28: the operator chose "Also make EDGAR primary",
  then "Default only, I flip production" for the stored rows (FR-7).
- [x] **Activation default.** Resolved 2026-11-28: the operator chose "On by default" (FR-11).
- [x] **Consumer surface.** Resolved 2026-11-28: the operator chose "None, internal only".
