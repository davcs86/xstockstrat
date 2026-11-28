# Debate Register: symbol-data-stage

**State**: in-debate
**Mode**: full (round cap lifted by operator override, context.md 2026-11-28)
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-28 | /sdd-design | 8 | 5 | 0 | 18 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Job shape: one universe job per session parks on one data job per distinct symbol; a data job that needs bars parks on at most one backfill child. Children take lane and run id through the park. | analysis `app/repositories/pipeline_jobs.py:101-108`, `:384`; `app/engine/job_graph.py:166-171` | settled |
| D-2 | 1 | The data job is the only decider of the bar verdict. It re-checks coverage after the wake and writes the coverage record itself. No job in this feature returns a `Verdict` to express vendor absence, so 367 `@AC-9` is never triggered by it. | `pipeline_jobs.py:132`, `:146-153`; `tests/test_job_graph_worker_real_pg.py:110-122` | settled |
| D-3 | 1 | The daily run is ensured from `maintenance_tick` through a small hook beside `_ensure_prune`, using the idempotent enqueue keyed `(kind, "global", session date)`. One row however many instances are up. | `app/engine/job_graph.py:725`, `:753`; `pipeline_jobs.py:275` | settled |
| D-4 | 1 | "Last closed session" comes from one additive, ungated marketdata RPC backed by `packages/proto/marketsession`. The date is a `YYYY-MM-DD` string (precedent in `common.proto`). No calendar code in Python. | `packages/proto/marketsession/marketsession.go:33`, `:56`; marketdata `internal/service/authz.go:26-29`; `packages/proto/common/v1/common.proto:175` | settled |
| D-5 | 1 | Coverage record and bar record are written in one `job.db` transaction: upsert on the coverage key, `INSERT … ON CONFLICT DO NOTHING` on the bar key, and a bar-exists short-circuit at the top of the handler so a replay cannot downgrade a covered symbol. | `app/engine/job_graph.py:303`; `tests/test_job_handler_contract.py` | settled |
| D-6 | 1 | FR-7 mechanics: `snapshotSource()` default argument and unknown-value fallback become the edgar constant; config `062` runs `UPDATE … SET default_value='edgar'` guarded on the old default, with an audit row in the 041 shape, and never touches `value_data`; `scripts/config-wiring-stored.json` is regenerated; `scripts/config-heal/catalog.tsv` and the three docs change; Go tests that relied on the default are pinned with the existing `cfg.strings[...]` idiom. | marketdata `internal/service/marketdata_service.go:2036-2053`; config `migrations/041_heal_config_keys_to_reader_catalog.up.sql:482-517`; `scripts/check-config-wiring.mjs:651` | settled |
| D-7 | 1 | Analysis migration `032` has no foreign key to the job tables and no text containing `pipeline_job`. | analysis `tests/conftest.py:520-525` | settled |
| D-8 | 1 | Coverage is asked with a range ending at midday New York of the session (16:00Z), which includes that session and excludes the next. | marketdata `internal/timeframe/timeframe.go:126-130` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Port the trading calendar to Python. | Second hand-maintained holiday table; breaks FR-10 and the DRY guard rail. | locked |
| R-2 | 1 | Derive the last closed session from `GetDataCoverage` on a sentinel symbol. | Answers about a symbol, not the calendar; treats the session as closed from 16:00 (`timeframe.go:108-111`). | locked |
| R-3 | 1 | One batched admin multi-symbol backfill job per session. | Widens what a background job may do, loses per-symbol dedup, one `FAILED` job hits many symbols (ingest `servicer.py:589-590`). | locked |
| R-4 | 1 | A `run_id` label on telemetry. | Identifier label; breaks platform 294 `@AC-41`. | locked |
| R-5 | 1 | The backfill child returns `Verdict("no_vendor_data")`. | Blocks the data job for good (367 `@AC-9`), so nobody can write the coverage record FR-8 requires. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Bar finality. Coverage is presence by date; a forming bar written before the close passes as `covered` for good unless a post-close write happens, and that depends on the in-memory warm set (`timeframe.go:113-116`; `marketdata_service.go:1203-1222`). The time of day finalizes nothing. | yes | open |
| O-2 | 1 | Backfill wait. A 60 s poll then a transient retry dies after about 6.5 minutes; ingest queues above 3 jobs, so children die from queueing alone, and each poll is reported as a retry (`job_graph.py:114-116`, `:621-627`; ingest `servicer.py:691-693`). | yes | open |
| O-3 | 1 | Universe job fails for good on an empty `WaitOn` (fresh deployment, or every user's read failing) and a partial outage drops users for the whole day (`job_graph.py:172-173`). | yes | open |
| O-4 | 1 | A park of 10,000 children under the 5 s control budget is unmeasured; the 10,000 bound equals the D-13 ceiling and "held first, then by symbol" starves late symbols for good (`pipeline_jobs.py:13`, `:379-390`). | yes | open |
| O-5 | 1 | An unfillable interior hole (IEX feed, halts) makes a symbol `no_vendor_data` for about two years and triggers a backfill every session. FR-3 vs vendor reality needs a rule. | yes | open |
| O-6 | 1 | Two verdict rules disagree: the data job tolerates a head gap after the wake while the outcome table maps `INCOMPLETE` to `no_vendor_data`; "same earliest bar" cannot tell a young listing from an unfillable head hole (ingest `servicer.py:921-937`). | yes | open |
| O-7 | 1 | Side effects FR-11 and C-14 deny: ingest jobs and ledger events attributed to a user who asked for nothing; untargeted backfill alerts visible to every user (ingest `servicer.py:673-683`); `ListWatchlists` creating a system list for owners with no live strategy (`portfolio_service.go:2452-2453`); fundamentals reads marking the whole universe warm, so the quote poller and bar ingester then poll it (`marketdata_service.go:2144-2145`, `:680-682`). | yes | open |
| O-8 | 1 | Vendor axis. Production stays on `vendor` until the operator flips it (operator decision). One `GetFundamentals` per symbol per day spends the 250-call budget and starves interactive reads (`marketdata_service.go:1992-2003`). The stage must be safe on both axes. | yes | open |
| O-9 | 1 | System-scope signals: the live loop already joins them into every live strategy's set (`live_loop.py:384`, `:409-413`), so "leak" is not a reason to exclude them; excluding them diverges from the legacy path that 369 compares against. | no | open |
| O-10 | 1 | The 729-day window is coupled to ingest's tunable `backfill.self_serve_max_range_days`; lowering it fails every stage backfill (ingest `servicer.py:472`, `:533`). | no | open |
| O-11 | 1 | Kill switch as `Verdict("stage_disabled")` leaves blocked rows for 30 days and makes the session unrecoverable after re-enabling. Gating creation is enough for `@AC-18`. | no | open |
| O-12 | 1 | Pruning the feature tables inside `retention_prune` couples 367's kind to 368's tables; a fixed 30 days can disagree with `pipeline.retention_days`. | no | open |
| O-13 | 1 | `symbol_backfill.outcome` duplicates the coverage record; on `ALREADY_EXISTS` the child triggers a second no-op job. | no | open |
| O-14 | 1 | Telemetry: an upgrade from `no_vendor_data` to `covered` is never counted; "backfills started" counts re-triggers; multiple instances multiply the in-flight bound. | no | open |
| O-15 | 1 | Ensure hook: while marketdata is down a 5 s timeout delays reap and settle every tick; a session whose trigger passes while analysis is down is never run. | no | open |
| O-16 | 1 | Extracting the drains: hitting the page cap is silent today (`live_loop.py:600-625`); a strict version that raises must not make the legacy wrapper count a failure (feature 356 scenarios). | no | open |
| O-17 | 1 | Identity: marketdata reads are ungated, so a representative owner's identity is not needed for them; use the system-read identity for global reads. | no | open |
| O-18 | 1 | Seam for 369: a bar record does not imply a complete snapshot (a user's read can fail), does not imply final OHLC (O-1), and the universe job's state is no run barrier because the first dead child blocks it while siblings keep running (`pipeline_jobs.py:146-153`). | yes | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
