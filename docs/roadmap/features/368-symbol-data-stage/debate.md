# Debate Register: symbol-data-stage

**State**: in-debate
**Mode**: full (round cap lifted by operator override, context.md 2026-11-28)
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-28 | /sdd-design | 8 (+7 at the gate, operator) | 5 (+7 at the gate) | 4 (at the gate) | 18 | 0 | yes |

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
| D-9 | 1 (gate) | Missing bars are fetched by the backfill child calling marketdata `BackfillBars` directly, synchronously, for the missing ranges. Ingest is not involved in the bar path. Operator decision 2026-11-28. | marketdata `internal/service/marketdata_service.go:1541-1543`, `:1607`, `:1652`; `internal/service/authz.go:26-29` | settled |
| D-10 | 1 (gate) | Coverage rule: a symbol is `covered` when its latest daily bar is the last closed session and every interior hole in the window has been attempted and the vendor returned nothing. Confirmed holes are remembered and not fetched again. `no_vendor_data` means the last session's bar is unobtainable or the symbol has no bars. Operator decision 2026-11-28; amends FR-3 and FR-5. | context.md 2026-11-28 | settled |
| D-11 | 1 (gate) | The run for a session starts a configured delay after 16:00 New York (new key, proposed default 30 minutes) and each data job forces a post-close fetch of that session's bar, so the stored bar is final. Half days run late. Operator decision 2026-11-28. | context.md 2026-11-28 | settled |
| D-12 | 1 (gate) | FR-6 includes fetching new filings: the data job triggers a fundamentals backfill for a symbol whose newest stored filing period is older than a threshold. Operator decision 2026-11-28; widens FR-6. | context.md 2026-11-28 | settled |
| D-13 | 1 (gate) | Snapshotted users are the owners of at least one strategy. Operator decision 2026-11-28; narrows FR-1's "every user". | analysis `app/engine/live_loop.py:374-402`; context.md 2026-11-28 | settled |
| D-14 | 1 (gate) | A user's universe is positions + watchlists + own signals + system-scope signals. Operator decision 2026-11-28. | `app/engine/live_loop.py:384`, `:409-413`; context.md 2026-11-28 | settled |
| D-15 | 1 (gate) | The twelve promoted marketdata scenarios that rely on the `vendor` default (255 `@AC-1,2,3,5,6,9`; 340 `@AC-2,4`; 254 `@AC-1,2,5,7`) get an explicit Given `snapshot_source is "vendor"`; their outcomes do not change. C-16 CHANGE signed by the operator 2026-11-28. | recon.md § Existing Business Rules; context.md 2026-11-28 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Port the trading calendar to Python. | Second hand-maintained holiday table; breaks FR-10 and the DRY guard rail. | locked |
| R-2 | 1 | Derive the last closed session from `GetDataCoverage` on a sentinel symbol. | Answers about a symbol, not the calendar; treats the session as closed from 16:00 (`timeframe.go:108-111`). | locked |
| R-3 | 1 | One batched admin multi-symbol backfill job per session. | Widens what a background job may do, loses per-symbol dedup, one `FAILED` job hits many symbols (ingest `servicer.py:589-590`). | locked |
| R-4 | 1 | A `run_id` label on telemetry. | Identifier label; breaks platform 294 `@AC-41`. | locked |
| R-5 | 1 | The backfill child returns `Verdict("no_vendor_data")`. | Blocks the data job for good (367 `@AC-9`), so nobody can write the coverage record FR-8 requires. | locked |
| R-6 | 1 (gate) | Drive the backfill through ingest's self-serve path under a universe member's identity. | Attributes ledger events to a user who asked for nothing, raises untargeted alerts, needs polling (O-2, O-7). Operator chose D-9. | locked |
| R-7 | 1 (gate) | A SAN-bound `system` grant on ingest `TriggerBackfill`. | Ingest change, a CHANGE to 343 `@AC-15`, and polling of an asynchronous job. Operator chose D-9. | locked |
| R-8 | 1 (gate) | Start the run after New York midnight. | Results and later alerts would arrive overnight. Operator chose D-11. | locked |
| R-9 | 1 (gate) | Strict FR-3: any interior hole blocks coverage. | Excludes illiquid and halted symbols for about two years on the IEX feed. Operator chose D-10. | locked |
| R-10 | 1 (gate) | Snapshot every user through a new cross-user owner read. | Adds a service, proto and grant change for users who have nothing to evaluate. Operator chose D-13. | locked |
| R-11 | 1 (gate) | Exclude system-scope signals from the universe. | Diverges from what the live loop covers, which 369 compares against. Operator chose D-14. | locked |
| R-12 | 1 (gate) | Fundamentals: re-derive only, defer new filings to program feature 6. | Operator chose D-12. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Bar finality. Coverage is presence by date; a forming bar written before the close passes as `covered` for good unless a post-close write happens, and that depends on the in-memory warm set (`timeframe.go:113-116`; `marketdata_service.go:1203-1222`). The time of day finalizes nothing. | yes | open |
| O-2 | 1 | Backfill wait. A 60 s poll then a transient retry dies after about 6.5 minutes; ingest queues above 3 jobs, so children die from queueing alone, and each poll is reported as a retry (`job_graph.py:114-116`, `:621-627`; ingest `servicer.py:691-693`). | yes | closed @ round 1 gate (D-9: synchronous call, no polling of an external job) |
| O-3 | 1 | Universe job fails for good on an empty `WaitOn` (fresh deployment, or every user's read failing) and a partial outage drops users for the whole day (`job_graph.py:172-173`). | yes | open |
| O-4 | 1 | A park of 10,000 children under the 5 s control budget is unmeasured; the 10,000 bound equals the D-13 ceiling and "held first, then by symbol" starves late symbols for good (`pipeline_jobs.py:13`, `:379-390`). | yes | open |
| O-5 | 1 | An unfillable interior hole (IEX feed, halts) makes a symbol `no_vendor_data` for about two years and triggers a backfill every session. FR-3 vs vendor reality needs a rule. | yes | open |
| O-6 | 1 | Two verdict rules disagree: the data job tolerates a head gap after the wake while the outcome table maps `INCOMPLETE` to `no_vendor_data`; "same earliest bar" cannot tell a young listing from an unfillable head hole (ingest `servicer.py:921-937`). | yes | open |
| O-7 | 1 | Side effects FR-11 and C-14 deny: ingest jobs and ledger events attributed to a user who asked for nothing; untargeted backfill alerts visible to every user (ingest `servicer.py:673-683`); `ListWatchlists` creating a system list for owners with no live strategy (`portfolio_service.go:2452-2453`); fundamentals reads marking the whole universe warm, so the quote poller and bar ingester then poll it (`marketdata_service.go:2144-2145`, `:680-682`). | yes | open |
| O-8 | 1 | Vendor axis. Production stays on `vendor` until the operator flips it (operator decision). One `GetFundamentals` per symbol per day spends the 250-call budget and starves interactive reads (`marketdata_service.go:1992-2003`). The stage must be safe on both axes. | yes | open |
| O-9 | 1 | System-scope signals: the live loop already joins them into every live strategy's set (`live_loop.py:384`, `:409-413`), so "leak" is not a reason to exclude them; excluding them diverges from the legacy path that 369 compares against. | no | closed @ round 1 gate (D-14) |
| O-10 | 1 | The 729-day window is coupled to ingest's tunable `backfill.self_serve_max_range_days`; lowering it fails every stage backfill (ingest `servicer.py:472`, `:533`). | no | closed @ round 1 gate (D-9: no self-serve envelope) |
| O-11 | 1 | Kill switch as `Verdict("stage_disabled")` leaves blocked rows for 30 days and makes the session unrecoverable after re-enabling. Gating creation is enough for `@AC-18`. | no | open |
| O-12 | 1 | Pruning the feature tables inside `retention_prune` couples 367's kind to 368's tables; a fixed 30 days can disagree with `pipeline.retention_days`. | no | open |
| O-13 | 1 | `symbol_backfill.outcome` duplicates the coverage record; on `ALREADY_EXISTS` the child triggers a second no-op job. | no | closed @ round 1 gate (D-9: no ingest job to track) |
| O-14 | 1 | Telemetry: an upgrade from `no_vendor_data` to `covered` is never counted; "backfills started" counts re-triggers; multiple instances multiply the in-flight bound. | no | open |
| O-15 | 1 | Ensure hook: while marketdata is down a 5 s timeout delays reap and settle every tick; a session whose trigger passes while analysis is down is never run. | no | open |
| O-16 | 1 | Extracting the drains: hitting the page cap is silent today (`live_loop.py:600-625`); a strict version that raises must not make the legacy wrapper count a failure (feature 356 scenarios). | no | open |
| O-17 | 1 | Identity: marketdata reads are ungated, so a representative owner's identity is not needed for them; use the system-read identity for global reads. | no | open |
| O-18 | 1 | Seam for 369: a bar record does not imply a complete snapshot (a user's read can fail), does not imply final OHLC (O-1), and the universe job's state is no run barrier because the first dead child blocks it while siblings keep running (`pipeline_jobs.py:146-153`). | yes | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
