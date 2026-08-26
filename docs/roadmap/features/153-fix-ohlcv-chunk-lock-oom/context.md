# Context Log: fix-ohlcv-chunk-lock-oom  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A two-piece, zero-app-code fix for the recurring TimescaleDB `out of shared memory` (SQLSTATE 53200) on `marketdata.ohlcv`: **(A)** an out-of-repo operator bump of the DO cluster `max_locks_per_transaction` 64→1024 (already applied and holding 2026-08-24), plus **(B)** marketdata migration `004` widening the ohlcv chunk interval 1d→30d (metadata-only, future-only). The root cause was lock-table exhaustion — a 400-day scan over 1-day chunks locks ~400 chunks × 4 relations ≈ 1,600 AccessShareLocks in one transaction against a ~1,600-slot table. This was the exact recurrence feature 141's design named as Open Risk 1: 141's semaphore/dedup guarded only `_compute_opportunities`, and the bug came back through the unguarded sibling path `EvaluateReadiness`.

**Why (irrecoverable rationale)**:
- A single 400-day query nearly exhausts the lock table *on its own*, so an app-level concurrency bound (141's approach) is defense-in-depth, never a standalone fix — this is why the fix went to global cluster/hypertable levers instead of extending the semaphore.
- The two pieces are complementary by necessity: migration 004 is **inert on existing back-history** (`set_chunk_time_interval` only affects future chunks; existing 1-day chunks age out over ~400 days), so Piece A carries the transition and acceptance was gated on "Piece A applied + holding," not on 004.
- The user raised the bump to **1024** over the debate's converged **512** specifically to eliminate the transition-window concurrency residual outright (~16 vs ~8 concurrent worst-case scans, ~7MB on the 1GB box).
- The `30d` interval was chosen for finer chunk-exclusion pruning on **bounded-range** `QueryBars` reads; the round-2 rationale that 30d helps `QueryRecentBars` was identified as **false** (LIMIT/ORDER-BY-DESC opens ~1 chunk regardless of width) and deliberately excluded from durable memory (C-01).

**Rejected alternatives**:
- Out-of-band re-chunk of existing data — lost: the lock-safe batched form races the always-on ingester and is unverifiable pre-deploy (F-05), while the simple `INSERT…SELECT` form reads all ~400 chunks in one txn (~1,600 locks) so it *itself* needs Piece A first — additive to A, never a substitute.
- App-side time-windowed fetch — lost as over-build and partial: misses the live-loop's raw 365-day `GetBars`, reopening a C-10 gap the global levers close.
- Extend feature 141's `_bars_fetch_sem` to `EvaluateReadiness` — lost as over-build; global A+B covers the whole blast radius; kept as a named runner-up only if telemetry later shows sustained concurrency.
- `max_locks` 256 / 512 — lost to the user's 1024. 90-day interval — coarser bounded-range pruning, immaterial. Quotes-hypertable widening — out of scope (`GetLatestQuote` is a LIMIT-1 latest-read and widening it would edit the applied `001`, F-01).

**Scars & gotchas**:
- **The DO cluster is single-node, so a `db-cluster-update-psql-config` parameter change triggers a brief restart that hits BOTH `xstockstrat-staging` AND `xstockstrat-production` DBs together** — not just the targeted environment. Observed a transient ripple ~21:25 UTC: directly-connected Node services' `StreamEvents` to ledger :50057 refused while they reconnected to the restarted DB; self-healed by 21:25:37, all 12 components back HEALTHY. This blast radius is only in context.md.
- AC-2 asserts the **configured dimension interval** (`timescaledb_information.dimensions.time_interval`), NOT physical chunk width: 30d chunks physically created during an up-window stay 30d after a `down` — benign (wider = fewer locks), and deliberately not verified.
- Migration 004 carries **no** `003`-style remediation-log table and **no** `DO $$` compressed-chunk pre-flight; those existed in `003` only because it moved rows. A naive "mirror 003" would have cargo-culted inert machinery onto a metadata-only call.

**Permanent deviations**: None. All 3 steps landed with "Deviations: none"; the fix shipped exactly as designed. Only ordering note: Piece A was applied during the *design* session (user-authorized) rather than at the execute/operator step — an acceleration, not a contradiction.

**Cross-feature signal**: This is the second episode of the same OOM class (141 → 153). The durable lesson: **a fix scoped to one of several structurally identical call sites lets the bug recur through an unguarded sibling.** 141 guarded `_compute_opportunities`; 153 mapped 5+ identical 400-day bars-fetch sites (`EvaluateReadiness`, backtest, `GetIndicatorSeries`, live-loop 365d) and chose a global fix precisely so the residual siblings can't produce a 154.

**Deferred follow-ons**: Full AC-1 staging confirmation (a 400-day readiness scan completing with 0 SQLSTATE 53200) pended the next readiness cycle at launch. Re-add the app-level guard to the still-unguarded `EvaluateReadiness`/live-loop paths **only if** telemetry shows sustained high concurrency (>16 concurrent worst-case scans) — an accepted residual, not scheduled. `max_connections ≈ 25` for `db-s-1vcpu-1gb` remains a *named assumption* behind the lock arithmetic, never read from the DO API.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-26 entries. (The `max_locks`/53200/`update`-vs-`get`-schema design lesson and the F-05 don't-need-a-live-DB migration rule were already recorded at insights.md:2084 / fails.md:729.)
**Runtime-invariant recommendations (→ /context-constitution)**: PLAT-* — the DO managed-Postgres cluster `xstockstrat` (`db-s-1vcpu-1gb`) is **single-node**, so any `db-cluster-update-psql-config` change restarts **both `xstockstrat-staging` and `xstockstrat-production` databases together** with brief downtime, causing directly-connected services (ledger/config/identity/notify LISTEN/NOTIFY + `StreamEvents` subscribers) to reconnect. (The lock-budget arithmetic invariant `chunks×relations ≤ max_locks×(conns+prepared)` is already in `docs/runbooks/ohlcv-lock-budget-tuning.md`.)
**Scenario promotion (C-16)**: 2 `@AC-*` → `services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature` (new suite).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4. (The full lock arithmetic + the 64→1024 operator procedure survive in `docs/runbooks/ohlcv-lock-budget-tuning.md`.)
