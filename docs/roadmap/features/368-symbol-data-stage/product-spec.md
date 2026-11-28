# Product Spec: symbol-data-stage

**Created**: 2026-11-28
**Amended**: 2026-11-28 by the design debate (operator decisions D-9 to D-65 in `debate.md`; see `context.md`)

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
every user who owns at least one strategy, the set of symbols made of that user's positions,
watchlist symbols, own signalled symbols and system-scope signalled symbols (operator decisions
D-6, D-13, D-14). The snapshot is durable, lists which users have which symbol and whether the
symbol is held, and is never rewritten once complete. Every instance with the stage enabled
ensures the session's run through the idempotent enqueue of feature 367, so it runs once however
many instances are up. A user's source read that still fails on the run's last attempt leaves that
user out of the snapshot, recorded as not snapshotted, without losing the other users. This
feature applies no cap; the D-13 sizing is a Design Constraint.

FR-2. **One data job per symbol, session and pass.** The run creates one data job per distinct
symbol across all users, keyed by symbol, session date and pass, carrying the pass's run id. A
symbol held by any user runs in the `held` lane; every other symbol runs in the `watchlist` lane.
Creating the same symbol, session and pass again creates no second job.

FR-3. **Bars to the last closed session.** A symbol is `covered` for a session when its latest
daily bar is that session and every interior hole in the 730-day history window has been fetched
at least once with the vendor returning nothing for it (operator decisions D-10, D-32). Holes
confirmed that way are remembered and not fetched again. The hole detection is feature 364's
(`GetDataCoverage` gaps); this feature does not reimplement it.

FR-4. **Automatic fetch, final bar after the close.** Each data job fetches the session's daily
bar from the vendor after the close, so the stored bar is a post-close fetch, and fetches any
unconfirmed missing sessions before it. It calls marketdata `BackfillBars` directly and
synchronously (operator decisions D-11, D-30, D-56); ingest is not involved. No operator action is
needed.

FR-5. **Verdicts.** A coverage record carries one of three bar verdicts. `covered`: FR-3 holds.
`no_vendor_data`: the vendor returned nothing for the session's bar, skipped the symbol as
delisted, or left an unconfirmed hole. `fetch_failed`: the fetch still failed when every pass was
exhausted (operator decision D-42). A fetch failure is retried in later passes (FR-14); it never
confirms a hole and never ends a data job in the dead-letter state, which is left for real
defects. A `fetch_failed` or `no_vendor_data` symbol gets no bar record.

FR-6. **Fundamentals refreshed by staleness.** The data job checks the symbol's stored filings
and, when a check is due, fetches new filings by calling marketdata `BackfillFundamentals`
directly (operator decisions D-12, D-25). A check is due 105 days after the newest stored filing
period and repeats every 7 days until a new filing lands; a symbol with no stored filings is
re-checked every 28 days; each symbol keeps a fixed weekday so checks spread across the week
(D-44). The coverage record's fundamentals state describes stored filings (D-31): `fresh` when a
period no older than 190 days is stored, `stale` when only older periods are stored,
`unavailable` when nothing is stored or the read failed. A fundamentals failure never fails the
data job or changes the bar verdict. The stage calls no fundamentals snapshot RPC.

FR-7. **EDGAR is the default fundamentals source.** The code default and the seeded default of
the latest-snapshot fundamentals source become `edgar`, with the configured vendor as the fallback
for a symbol that is not an SEC filer. A deployment with no stored value serves EDGAR. A stored
value is never changed by this feature: both staging deployments already hold `edgar`, and
production holds the seeded `vendor` row, which the operator flips by hand (operator decisions,
2026-11-28).

FR-8. **Coverage record.** Each data job writes at most one durable coverage record per symbol and
session: the bar verdict, the earliest and latest stored daily bar, the fetch outcomes and the
fundamentals state (FR-6). Running a job again for a symbol and session that already has a record
leaves the record unchanged and creates no second one.

FR-9. **Bar record that triggers evaluation.** When a symbol is `covered` for a session, the stage
writes one durable bar record for that symbol and session, exactly once, in the same transaction
as the coverage record. It is the trigger program feature 3 consumes; nothing in this feature
evaluates a strategy. A symbol that is not `covered` gets no bar record.

FR-10. **One trading calendar; a run starts after the close.** "Last closed session" is computed
from the platform's existing trading calendar (`packages/proto/marketsession`), including weekends
and market holidays. A session's run starts once the session has been closed for
`analysis.pipeline.data_stage_delay_minutes` (default 30). The start is decided once per run, in
database time, and a later change to the key does not affect a run already started. A half-day
session is treated as closing at 16:00 New York. The stage creates no run on a non-trading day and
never treats today's unfinished session as closed. A session whose start time passes while
analysis is down gets no run; its bars are fetched by the next run.

FR-11. **Kill switch; no change to existing behavior.** With
`analysis.pipeline.data_stage_enabled` false, no run, pass or job is created; jobs already created
run to completion. The stage is on by default (operator decision, 2026-11-28). This feature
removes no existing loop and changes no analysis RPC response. Its externally visible effects are:
post-close daily bars and filled history in marketdata, including a next-morning re-fetch of at
most 50 session bars (FR-13); newly stored filings and the EDGAR snapshot refresh they cause;
FR-7; vendor and SEC requests; marketdata backfill metrics and logs (no ledger events, operator
decision D-43) and fundamentals-backfill failure logs for non-filers; and, once per strategy owner
who never had one, the system signal list portfolio creates on a first watchlist read.

FR-12. **Telemetry.** The stage exports counters for symbols by bar verdict, fundamentals by
state, fetches by kind and outcome, filings fetches by outcome, deferred fetches by reason,
confirmed holes, snapshot users by outcome and finality results (FR-13), through the existing
telemetry export, with no symbol, user or run label. The authoritative per-session counts are a
query on the coverage records.

FR-13. **Automated vendor-finality check.** For a session whose run is done, while the stage is
enabled and analysis runs between 16 hours after the close and the next close, the stage
re-fetches the session's daily bar for a deterministic sample of at most 50 covered symbols. It
compares that bar with the bar the vendor returned at stage time and records `match`, `drift`,
`adjusted` or `unavailable` per symbol, and counts each result in telemetry (operator decisions
D-58, D-63, D-64). The check changes no verdict, coverage record or bar record, marks no symbol
warm, appends no ledger event and emits no alert to users.

FR-14. **Retry passes and run completion.** When every job of a pass has finished and some
snapshot symbol still has no coverage record, the stage starts another pass for only those
symbols, up to 3 more passes at least 30 minutes apart (operator decision D-41). A data job that
starts more than 30 minutes after its pass began makes no vendor call and leaves the symbol to the
next pass (D-55). On the last pass a symbol whose fetch failed, or whose job started past that
budget, gets a `fetch_failed` record. When no further pass will run, the run is marked done; after
that no coverage or bar record is created for the session, even by a job an operator requeues
(D-62, D-65).

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
- A job mechanism in Go services. Marketdata stays an RPC server that an analysis job calls
  (program plan, "One queue, owned by analysis").
- Snapshotting users who own no strategy (operator decision D-13).
- A notify alert for finality drift (operator decision D-63). The alert is a Grafana rule on the
  drift counter, documented in the service docs.
- Running a session again after its run is done, or running a session that was missed.

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-analysis` — owns the run, the passes, the job kinds, the snapshot, the coverage and
  bar records, the hole and filings bookkeeping and the finality check.
- `xstockstrat-marketdata` — a new calendar RPC; `BackfillBars` gains an optional return of the
  written bars and stops appending ledger events for the data stage's calls; EDGAR becomes the
  default snapshot source (FR-7).
- `xstockstrat-config` — seeds the two new keys and the changed default.

`xstockstrat-ingest` and `xstockstrat-portfolio` are read through their existing RPCs
(`QuerySignals`, `ListPositions`, `ListWatchlists`) with no code change.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — internal platform stage (operator decision, 2026-11-28). The coverage and bar
  records are consumed by the evaluation jobs of program feature 3 inside the same service, and
  operators observe the stage through telemetry (FR-12), logs and the tables. No alert reaches a
  user (FR-13). The user-facing view of a symbol's data state arrives with the projection reads,
  switched on in the named follow-up `pipeline-cutover` (program feature 4). FR-7 changes which
  source serves `GetFundamentals` to UI and agent readers only on a deployment with no stored
  value; no existing deployment is one.

## Proto Contract Changes

Additive only; no breaking change. All in `packages/proto/marketdata/v1/marketdata.proto`:

- New RPC `GetLastClosedSession(GetLastClosedSessionRequest) returns (GetLastClosedSessionResponse)`:
  request `as_of = 1`; response `session_date = 1`, `closed_at = 2`, `day_start = 3`, `day_end = 4`.
- `BackfillBarsRequest.return_bars = 6` (bool) and `BackfillBarsResponse.bars = 5` (repeated `Bar`).

`packages/proto/marketsession` exports its existing 16:00 close helper.

## Config Key Changes

The keys below are written in their display FQN; the stored key is namespace-relative.

New keys. Namespace `analysis`, stored keys `pipeline.data_stage_enabled` and
`pipeline.data_stage_delay_minutes`, read fresh at each use through the service's `WatchConfig`
watcher (PLAT-6). Reader: two new accessors on
`services/xstockstrat-analysis/app/engine/job_graph.py:JobGraphSettings`; the bool is read as
`get_bool("pipeline.data_stage_enabled", default=True)` like the existing `worker_enabled`, so a
missing row reads `true` (feature-100 trap); the int is read through `int_positive` and clamped to
its bounds. Seed migration: `services/xstockstrat-config/migrations/062_analysis_data_stage_keys`
(an up and down pair; `061` is the latest on `main-dev` today; re-check the number at `/sdd-spec`
and `/sdd-execute`), plus a bounds entry for the int in the config service's scalar bounds
registry.

- `analysis.pipeline.data_stage_enabled` — bool, code default `true`. Kill switch for creating runs, passes and jobs (FR-11).
- `analysis.pipeline.data_stage_delay_minutes` — int, code default `30`, bounds 5 to 360. Minutes after the close before a session's run starts (FR-10).

Changed default on an existing key (FR-7). Namespace `marketdata`, stored key
`fundamentals.snapshot_source`, `value_type` string, live read. Reader:
`services/xstockstrat-marketdata/internal/service/marketdata_service.go:snapshotSource`, whose
default constant `snapshotSourceVendor` and unknown-value fallback both change to the edgar value.
The same seed migration changes the row's `default_value` to `edgar` and leaves every stored
`value_data` as it is. Docs that state the default and must change with it:
`services/xstockstrat-marketdata/CLAUDE.md` (key table), `docs/patterns/config-governance.md`,
`services/xstockstrat-marketdata/docs/fundamentals.md` and `scripts/config-heal/catalog.tsv`.

- `marketdata.fundamentals.snapshot_source` — string, code default changes from `vendor` to `edgar`.

Every other value the stage uses is a fixed invariant recorded in `design.md` § 12, not a key.

## Database Changes

Eight new tables in the `analysis` schema: the run row, the snapshot users and snapshot rows, the
coverage record, the bar record (with the bar captured at stage time), confirmed holes, the
filings-check schedule and the finality results. One migration pair, `032` in
`services/xstockstrat-analysis/migrations/` (`031` is the latest today; re-check at `/sdd-spec`),
with no foreign key to the job tables. The DDL is in `design.md` § 11. Session-keyed rows are
pruned by the stage after `max(30, pipeline.retention_days)` days. No change to the `marketdata`
schema. `scripts/db-migrate.sh` applies config migrations before analysis migrations, so config
`062` lands before analysis `032`; neither depends on the other's content.

## Feature Workflow Notes

Branch to create: `feature/symbol-data-stage` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Design Constraints

Inputs the design had to satisfy; each is resolved in `design.md` and `debate.md`.

- **Job-graph contract.** Feature 367 has no generic periodic-job API, a verdict is a free string,
  a parent declares its child kinds at registration, and a handler's only database access is
  `job.db()`. Resolved: an ensure hook and no handler `Verdict` (design § 2, § 18).
- **One universe function.** No third copy of the drains; legacy loops read what they read today
  (design § 4).
- **Calendar single source.** No holiday table in Python (design § 3).
- **Vendor load at the close.** About 1,000 symbols become due at once; bounded by worker slots,
  marketdata's limiter and the pass budget (design § 7, § 19).
- **Changed default (ledger, feature 129).** Every read of the key and every test that assumed
  `vendor` is listed (design § 13).
- **Bool default (feature-100 trap).** A missing `data_stage_enabled` row reads `true`.
- **Connection budget (F-06).** The stage adds no pool (design § 19).
- **Sizing (D-13).** About 10 users and about 1,000 symbols per user; the snapshot bound and the
  throughput ceiling are stated with their conditions (design § 7, § 19).
- **Early closes.** Not modelled; a half day runs late (FR-10).
- **Promoted scenarios (C-16).** Twelve marketdata scenarios that relied on the `vendor` default
  gain an explicit Given; the operator signed the change (D-15).
- **Seam with program feature 3.** Stated in design § 17.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Fundamentals scope.** Resolved 2026-11-28: the operator chose "Also make EDGAR primary",
  then "Default only, I flip production" for the stored rows (FR-7).
- [x] **Activation default.** Resolved 2026-11-28: the operator chose "On by default" (FR-11).
- [x] **Consumer surface.** Resolved 2026-11-28: the operator chose "None, internal only".
- [x] **Design-phase forks.** Resolved 2026-11-28 at the design gates; every decision and its
  rejected alternatives are in `debate.md` and `context.md`.
