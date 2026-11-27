# Program: job-graph analysis pipeline

**Status**: plan approved by the operator in session, 2026-11-27. No feature started.
**Baseline**: `main-dev` at `50e5021` (post-promotion of 2026-11-27).
**Scope**: the analysis pipeline only. Trading and portfolio consumers are out of scope.

This document is the program-level plan. Each feature below still goes through `/sdd-story` and
`/sdd-design`; numbers are allocated at story time. Nothing here overrides a feature's own design.

## Why

A sweep of the ledger, the feature logs, the bug reports and the loop code (2026-11-26) traced
about 35 of 67 bug reports and 13 ledger failure classes to six structural causes.

| # | Root cause | Evidence |
|---|---|---|
| 1 | The unit of work is the tick, not the item | Batch loss on one failure (308); about 690 pairs against a budget of 50 per 60s (293); live-only truncation, then rotation (131, 366) |
| 2 | Progress lives in memory and assumes one instance | Full fill replay on boot (311); in-memory live-loop cursor, warm set, claims and cancel set |
| 3 | Prerequisites are implicit and pull-based | Frozen daily series scored live; `no_bars` only logs; backfill-then-rerun is manual (343) |
| 4 | Derived data has no invalidation lineage | Fabricated neutral signals (309); fundamentals joined before bars (216) |
| 5 | Read paths trigger compute | Empty-universe recompute per poll (177), filtered-empty kick (365) |
| 6 | Every loop reinvents scheduling, retry, claim and telemetry | Fundamentals-signal chain of eight fixes (062 to 309); opportunity chain of eleven (131 to 366) |

About half of the loop-adjacent reports were pure logic or contract bugs. This program does not
claim to prevent that class.

Feature 366 documents the cost of the current shape in its own accepted residuals: at a pool of
about 350 symbols a full rotation takes about 18 computes against a 3-day cycle, and an expired
live-only row stays hidden for about 24 hours (`services/xstockstrat-analysis/docs/opportunities.md`).

## Operator decisions

| # | Decision |
|---|---|
| D-1 | Postgres job graph with park-and-wake. No broker (consistent with the 366 "use postgres" ruling). |
| D-2 | Evaluation fires only on a closed daily bar. Intraday activates nothing. |
| D-3 | A strategy or formula edit re-evaluates silently: the projection updates, no alert fires. |
| D-4 | Opportunities and readiness are projections of evaluation results. |
| D-5 | Built-in indicators may be persisted across users. Formula results are never persisted. |
| D-6 | Universe per user = positions, signalled symbols and watchlists, up to about 1,000 symbols. |
| D-7 | Every symbol in the universe, held or not, is evaluated against all of the user's strategies. |
| D-8 | Watchlist-to-strategy bindings become purely presentational. |
| D-9 | The fundamentals signal is retired. Strategies read fundamentals directly. |
| D-10 | Universe-relative ranking is not needed now, and must not be blocked. |
| D-11 | DigitalOcean and homelab stay identical. Single-instance constraints are removed. |
| D-12 | Cutover is a shadow run with a parity report, then a switch. |
| D-13 | Size for about 10 users, 5 to 10 strategies and 5 to 10 signal sources each. |

## Design calls made in planning

These are proposals for the feature designs to confirm or overturn.

- **One queue, owned by analysis.** Marketdata and ingest stay plain RPC servers that an analysis
  job calls. This avoids writing queue semantics in both Go and Python.
- **The evaluation job is per (user, symbol, bar).** It fetches bars once, computes built-in
  indicators once and writes one isolated result row per strategy. That is about 1,000 jobs per
  user per bar instead of up to 10,000.
- **Every job carries a universe-run id.** A later ranking feature adds one barrier job that waits
  on a run's symbol jobs and stores a per-symbol rank (D-10).
- **A dependency parks; it does not requeue.** A parent waits on a child and inherits a terminal
  verdict when the child is unsatisfiable. Attempts are bounded and end in a dead-letter state.
- **Effects go through an outbox.** Alerts, ledger events and projection rows commit with the job
  result, under idempotency keys.

## Features and order

```text
1 job-graph core
      └─ 2 symbol data stage
              └─ 3 evaluation + projection (shadow mode)
                      └─ 4 cutover and retirement
                              ├─ 5 change-driven re-evaluation
                              ├─ 6 fundamentals inputs, signal retirement
                              ├─ 7 presentational watchlist bindings
                              ├─ 8 multi-instance enablement
                              └─ 9 built-in indicator store (only on measured need)
```

| # | Working slug | Delivers | Retires or reuses |
|---|---|---|---|
| 1 | `pipeline-job-graph` | Job tables and worker runtime in analysis: keyed idempotent enqueue, lease with heartbeat and fencing, backoff by error class, park-and-wake dependencies, terminal verdicts, dead-letter, priority lanes (held first), queue telemetry, run id. Migrates no pipeline. | Reuses the transaction-scoped advisory lock pattern from 311 and the supervision helpers from 259 |
| 2 | `symbol-data-stage` | A daily scheduler snapshots the universe and enqueues one data job per symbol: bars to the last closed session, fundamentals refreshed by staleness, a coverage verdict, and an automatic backfill child with a terminal "no vendor data" verdict. Emits the per-symbol bar record that triggers evaluation. | Reuses 364's interior-hole detection and 343's "No vendor data" state. Removes the reliance on the warm set and on manual backfills for strategy data |
| 3 | `strategy-eval-projection` | Evaluation jobs write result rows keyed by user, strategy, symbol, bar and definition fingerprint. Transitions go to the outbox. Opportunity and readiness reads become pure reads of the projection. Runs in shadow beside the live loop with a parity report (D-12). | Reuses 327's fingerprint, which already covers referenced formula content |
| 4 | `pipeline-cutover` | Alerts switch to the new path. The first bar seeds state without alerting. | Live loop; opportunity daily refresh, read kicks and compute state; 366's rotation cursor, cycle keys and read branches; 365's branch; readiness materializer and cache; the per-cycle and per-compute caps and their config keys; the fan-out sites 308 isolated |
| 5 | `change-driven-reevaluation` | Strategy, formula, watchlist, position and signal changes enqueue targeted jobs; removals tombstone rows (D-3). The daily sweep stays as the correctness backstop. | Likely adds ledger events for watchlist and formula mutations |
| 6 | `fundamentals-strategy-inputs` | Strategies reference fundamentals directly (D-9). Touches analysis, ingest, portfolio, indicators, the UI and config. | Fundamentals-signal loop, its tables and keys, the blend-universe special case, 309's direction rules |
| 7 | `watchlist-binding-presentational` | Binding and default-strategy fields stop affecting evaluation (D-8). Updates the UI, the agent tools and the `strat-lab` plugin. | Binding-first attribution |
| 8 | `analysis-multi-instance` | Removes the remaining in-memory claims in analysis, proves safety under deploy overlap, re-checks the connection budget, then raises the instance count (D-11). | Single-instance assumption in analysis |
| 9 | `builtin-indicator-store` | Shared built-in indicator values per symbol, parameters and bar (D-5). Built only if evaluation cost measurements justify it. | — |

## What the 2026-11-27 promotion changed

The stopgap question is closed: the fixes that this program would have superseded are launched.

| Feature | State | Effect on the plan |
|---|---|---|
| 308 per-symbol isolation | launched | No longer "do not build". Its isolated fan-outs are retired at cutover |
| 366 live-only rotation | launched | Same. Cutover removes the cursor, the cycle keys and read branches (i) to (v) |
| 365 filtered-read kick | launched | Removed with the read kicks at cutover |
| 364 gaps-only interior holes | launched | Feature 2 reuses the detection; it no longer has to build it |
| 327 evidence fingerprint | launched | Feature 5 reuses the fingerprint as the job key; the formula-version defect is already fixed |
| 309 fundamentals-signal scoring | launched | Feature 6 retires the scoring it fixed. Whether fabricated signals were retracted is to be confirmed in that design |
| 311, 313, 314, 316, 317, 310 | launched | Outside this program; nothing to do |
| 330 live-enrich seed | in progress | Independent; finish as planned |

Retiring launched behaviour changes promoted acceptance scenarios. Under Constitution C-16 each
such change needs an operator-signed CHANGE row. Feature 4 carries most of them (048, 131, 180,
181, 185, 308, 365 and 366 scenarios), and features 6 and 7 carry the rest.

## Risks

- **Fundamentals quota.** FMP allows 250 calls a day, which cannot serve 1,000 symbols. EDGAR has
  to be the primary source, with staleness-based refresh.
- **Alert parity at cutover.** State seeding on the first bar must not alert on conditions that
  were already true.
- **Change events.** A quick grep found no ledger event for watchlist or formula mutations.
  Feature 5's design has to confirm this and choose the carrier.
- **Database headroom.** One small cluster is shared by staging and production, with about 22
  connections. Job and result tables need retention pruning, and feature 8 must re-check the
  budget before raising instance counts.
- **Result volume.** Up to about 100,000 result rows per bar at the D-13 ceiling. The proposal is
  to keep the latest row per key plus transitions.
- **Close-of-day burst.** Every symbol's bar lands at once. Priority lanes put held positions
  first; drain time has to be measured in feature 3's shadow run.

## Open items for the feature designs

- Whether the worker runs inside the analysis service or as a separate component (feature 1 or 8).
- How the watchlist UI presents a symbol once every strategy applies to it (feature 7).
- The retention policy for result rows and finished jobs (features 1 and 3).
