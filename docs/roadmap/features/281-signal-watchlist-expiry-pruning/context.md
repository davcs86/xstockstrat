# Context: signal-watchlist-expiry-pruning  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: A portfolio-only expiry prune for `source=SIGNAL` entries on the per-user system watchlist. It has four parts:
- The agent stamps signal provenance on its auto-add.
- A side table holds the expiry.
- A never-waiting, in-process `SKIP LOCKED` loop is the only deleter.
- A one-shot operator backfill marks or seeds the existing backlog. It never deletes.

The premise held only for portfolio. Analysis opportunities already filter expired rows, and ingest rows are passive by design, so the operator's "both" scope reduced to portfolio. Launched 2026-11-05 via promotion PR #1448.

**Why (irrecoverable rationale)**:
- **A SIGNAL entry had no link to its signal.** There was no `signal_id`/`valid_until` on the binding or on the agent add, so a link had to be created before anything could be pruned.
- **The side table's FK targets `watchlists` only, never `watchlist_symbols`.** Replace-all `Update` deletes and re-inserts every binding, so a cascade from bindings would untrack every entry on each rename.
- **Version skew and rollback are safe because a provenance-less SIGNAL add untracks.** It is never pruned early. That let the operator cut the pause switch, with no deploy-order coupling.
- **FR-2/FR-3 were narrowed, with explicit sign-off, to agent-recorded `watchlist`-direction signals.** Buy/sell signals and non-agent ingests never keep an entry alive. The only design that made "every signal" literally true was an analysis sweeper, which needed a new ingest `system` grant that weakens 224/225.
- **The seed migration exists only because feature 278's shrink-only `config-wiring` ratchet killed the 227-D2 "unseeded key" waiver mid-flight.** The seed went into the same commit as the reader. Seeding earlier gives `seeded-unread` commits; seeding later gives `read-unseeded`.
- **The 037 down deletes only global rows (`user_id IS NULL`).** This deliberately departs from the 033 precedent: per-user overrides are operator data and must survive rollback.

**Rejected alternatives**:
- **A UI cue for expired removal, or an `EmptyState` swap:** declined.
  - Silent removal was signed off, with the ledger event as the only audit trail.
  - The list refreshes only on refocus, remount or mutation.
  - Strategy-bound SIGNAL entries are pruned like any other entry (explicit sign-off).
- **Analysis-hosted sweeper:** needs an ingest `system` grant (weakens 224/225) plus cross-user portfolio RPCs. User-rejected.
- **New portfolio→ingest edge:** needs a Platform Lead gate and a new `INGEST_ENDPOINT`, and has the same grant problem.
- **Lazy prune on read:** still needs the link, puts writes on read paths, and `ListAllWatchlistSymbols` would keep serving stale symbols.
- **Expiry column on `watchlist_symbols`, or a field on `WatchlistBinding`:** replace-all wipes it, and every hand-rolled normalizer would have to change (the feature-127 trap).
- **Blocking `FOR UPDATE` prune, or one global tx:** deadlocks with `UpdateBinding`/`UpdateBindings`, which lock symbol rows first and the parent last.
- **The backfill CLI deleting bindings itself:** a second deleter, the `UpdateBinding` deadlock, and the CLI would need a ledger/mTLS identity.
- **`reason` column or proto enum:** duplicates `signal_id IS NULL` plus the event type.
- **Pause switch (interval 0):** restored in round 2, then cut by the user in a round-3 amendment.
  - The emergency stop is now `TRUNCATE`, or `DELETE … WHERE signal_id IS NULL`.
  - Raising the interval is not a pause: the current sleep finishes first, and every restart ticks.
- **Legacy-owner match that never removes (adversary's recommendation), and a list-only REPORT:** declined in favour of strict removal.
- **Pin on MANUAL add:** would change feature 127's first-writer-wins rule. Declined.
- **Mark grace period (`now()+1h`):** declined at gate 4.
- **Agent retry of a failed renewal:** narrows the window but does not close it. Accepted as residual risk instead.
- **Skipping the add for an already-expired signal:** would change platform `@AC-1`. Add-then-prune was accepted.
- **Separate backfill binary, a `NewPool` export, or a Python/psql script:** duplicates the SQL, and no CI runs `scripts/tests`.
- **DB-level rollback test for 037:** scope creep. Asserted statically instead.

**Scars & gotchas**:
- **The prune DELETE targets only the locked set.** A DELETE over the requested or due symbols blocks on a row that the `SKIP LOCKED` select skipped (held by `UpdateBinding`), which silently breaks "never waits". This is partly encoded as PORTFOLIO-18.
- **The prune tx commits on every non-skipped list, not only when bindings were removed.** Otherwise the orphan-expiry sweep is rolled back on ticks that remove nothing.
- **`emitEvent` retries `codes.Unavailable` 4× with backoff.** A best-effort ledger-error test must inject a non-Unavailable code (`codes.Internal`), or it stalls in the retries.
- **Background-origin ledger events are owner-visible only if the owner is in `AppendEventRequest.user_id`.** Ledger prefers that field over the `x-user-id` metadata. A ctx without `PropagationData` sends no headers, so the tick mints its own `x-trace-id`.
- **Global-tick and global-classifier DB tests must filter results to the test's own rows.**
  - Bounds come from a live REPORT (`live - 1`), not fixed 0/1.
  - Fixed dates and ids rot once the CI clock passes them. Use DB `now()`-relative times and sequence ids.
- **A rescued marked row cannot then demonstrate a past renewal.** The update-only merge keeps the later `valid_until`, so AC-17 needs two separate rows or subtests.
- **The ingest-interleaving test was first a probabilistic 10-iteration race, and was flagged in review.** It was made deterministic: park APPLY on the expiry PK, confirm via `pg_stat_activity`, then commit. That test needs a pool without the harness's `lock_timeout=500ms`, because it waits on purpose.
- **golang-migrate has no out-of-order guard.** A higher config migration applied first makes `up` silently skip a lower one, and 278's static check still passes.
  - This drove three renumber/merge-order rulings on 035→037 vs feature 280. First "281 waits for 280", then reversed on 2026-11-04 to "280 renumbers above 037".
  - The local max+1 scan is blind to unmerged `claude/*` branches. That is how both the feature number (280→281) and the migration number collided.
- **The Go real-DB harness did not exist and was built from scratch.**
  - With `build-tags: [dbtest]` in `.golangci.yml`, `unused` lints the dbtest files, so every helper must be used.
  - Locally, "RED" for a DB test is only a compile failure. The first real-TimescaleDB green came in CI on PR #1401.
- **In a codegen-container worktree, `buf-gen.sh`'s built-in `buf breaking` silently skips.** The `.git` pointer is outside the mount. `tsc` also needs the worktree's own `pnpm install`.
- **`go run` reports any child failure as exit 1, while the backfill binary returns 2 or 3.** The runbook carries this.
- **Local Playwright `pnpm dev` warm-up times out at 10 s** on a cold compile of 24 routes. `CI=1` (production build) passes.
- **The `PORTFOLIO-17` invariant ID collided on main-dev** and was renumbered to PORTFOLIO-18 at merge.
- **278's `--declared-from` parses any backticked dotted name in product-spec.md as a declared config key** and blocks on it. Do not backtick table names like `config.config_values` there.
- **278's step-time `PENDING` never fails.** Only `--final --json` with a merge-base baseline catches a key finding.

**Permanent deviations**:
- **Prune tx commit scope.**
  - Design: `UPDATE parent; commit` only when R is non-empty.
  - Shipped: commits on every non-skipped list; only the parent touch is conditional.
  - Because: otherwise the orphan sweep never persists.
- **DELETE scope.**
  - Design: `SELECT … SKIP LOCKED` then `DELETE … RETURNING` over the due symbols.
  - Shipped: the delete covers only the symbols actually locked.
  - Because: a delete over D blocks on skipped rows.
- **`--legacy-owner` check.**
  - Design: APPLY refuses if `--legacy-owner` differs from REPORT's printed value.
  - Shipped: no such check.
  - Because: REPORT and APPLY are separate processes, so the pasted REPORT in the change record is the control.
- **Migration 018 replay.**
  - Design: 018 is "replayed by migration-rerun".
  - Shipped: pass 2 replays only the fixed 224/225 list, so 018 is never replayed. It is idempotent by construction, and `migration-rerun.sh` was untouched.
- **Seed migration number.**
  - Design: seed is config 035.
  - Shipped: 037.
  - Because: feature 280 held 035/036. The dependency was later reversed, and 280 renumbers above 037.
- **Backfill candidate read.**
  - Design: a read-only tx.
  - Shipped: one `REPEATABLE READ READ ONLY` snapshot, so REPORT counts and APPLY's bound check come from a single snapshot.
- **Backfill merge.**
  - Design: the backfill shares the add-path merge SQL.
  - Shipped: the backfill only inserts rows that have no expiry row yet (`ON CONFLICT DO NOTHING`) and never merges.
  - Because: its candidate set excludes bindings that already have an expiry row (impl-spec review N1–N13).
- **C-16 promotion.**
  - Design: tag AC-15..17 `@operator-backfill` and copy the agent scenarios into the agent suite.
  - Shipped: neither. AC-14 went whole to the portfolio suite, and AC-19 went to a new config suite.
  - Because: promotion is verbatim (no splitting a scenario), and the agent half's observable subject is portfolio. Why the tag was dropped is not recorded.
- **AC-1.**
  - Design: a behavioural scenario.
  - Shipped: it is really a pre-feature premise check that is false after launch. It was covered by a recon-evidence step and deliberately NOT promoted at C-16.
- **Seed key form (post-launch drift by another feature).**
  - Design and 037 seed the full-dotted key `portfolio.watchlist.signal_prune_interval_seconds`.
  - Today the reader constant is namespace-relative (`signal_prune.go` = `watchlist.signal_prune_interval_seconds`). The row was healed by config migration `041` (feature 295) and renamed by 044 (296).
  - `TestSignalPrune_IntervalReadsSeededRow` now reads `scripts/config-wiring-stored.json`, not the 037 file.
  - The promoted config suite `services/xstockstrat-config/acceptance/signal-watchlist-expiry-pruning.feature` still asserts the full-dotted key in 037. That is true only of that historical file.

**Cross-feature signal**:
- 278's shrink-only `config-wiring` ratchet retroactively invalidated an approved design's "unseeded key" waiver. Any in-flight feature relying on 227-D2 had to be re-designed.
- Feature 296's namespace-relative key convention later rewrote this feature's reader constant and seed-row form. Treat the 037 full-dotted key in the 281 config acceptance suite as history.
- Migration and feature numbers collided with unmerged harness branches (`claude/smoke-test-deployment-*`, feature 280) that a local max+1 scan cannot see. This happened twice in one feature.
- Feature 282 rebased on 281: the same functions in `AddWatchlistSymbols`, agent `client.py`/`tools.py` and `SCALAR_BOUNDS_REGISTRY`. 282's seeds landed above 037.

**Deferred follow-ons**:
- A platform CI check that every new migration NNN is above the base branch's max. Logged, not built (C-18).
- **Feature 280 (now `third-party-sso-oidc`, formerly smoke-check-runtime) renumbers.** It takes the next free config number above 296's 044/045, with namespace-relative seeds. Config 035/036 never landed and are a permanent gap on trunk.
- Post-deploy operator work: the runbook preflight (`has_table_privilege` for the portfolio role on `ingest.newsletter_signals`, unverified at build), then the backfill REPORT/APPLY. Neither is recorded as done.
- Accepted residual risks:
  - Strict untracked removal deletes entries of pre-224 legacy owners whose signals were reassigned to `SEED_USER_ID`, even though those signals are live. Undo is a manual re-add.
  - There is no grace period: APPLY plus the next tick (≤300 s) is irreversible.
  - A failed or deduplicated renewal add gets pruned early.
  - Re-stamping an entry MANUAL via replace-all makes it permanently immune.
  - The ledger event is lost on a crash between commit and emit.
  - A rebind (`UpdateBinding`) that races a prune of the same entry may fail with `ErrBindingNotFound`. This is accepted, and the AC-12(b) test allows it.
- The DBA review identity for 018/037 is not recorded.
- The context-forge refresh was unavailable; the teardown was reconciled by hand.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-11-10 entries. The 2026-10-31 backfill-design entry already existed and was skipped.

**Runtime-invariant recommendations (→ /context-constitution)**:
- PORTFOLIO-18: verify it also states "commit per non-skipped list even when R is empty (orphan sweep)" and "a provenance-less SIGNAL add deletes the expiry row (untrack)".
- PLAT: ledger `AppendEventRequest.user_id` takes precedence over `x-user-id` metadata. Background emitters must set it and mint their own `x-trace-id`. They carry no `x-access-scope`, which is recorded under C-03.
- PLAT/findings: golang-migrate has no out-of-order guard; a skipped lower migration is silent.
- Findings doc drift: the 281 config acceptance suite asserts the full-dotted key that 295/296 retired.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-10-31 — sdd-design Phase 1 round 1 (quick) — user decisions

Round 1: proposer = side-table `portfolio.watchlist_signal_expiry` stamped by the agent's add (new optional `AddWatchlistSymbolsRequest.signal_provenance=4`), pruned by an in-process portfolio goroutine; adversary verdict NEEDS WORK, **no Floor breach**. Accepted fixes: lock `watchlists` first in id order (per-watchlist tx) to avoid prune-vs-add/Update deadlock; create an expiry row only when the binding was newly inserted by this tx (or a row already exists) so legacy open-ended entries are not falsely pruned; per-row `x-user-id` on the ledger append so the audit event is owner-visible (C-03); require exactly one SIGNAL binding with provenance; tick also deletes orphan expiry rows; document `instance_count: 1`, disabled-mode re-check cadence, and the dedup-claim dependency.

**Explicit user sign-offs (AskUserQuestion, 2026-10-31):**
- **FR-2/FR-3/AC-3 scope narrowed** to *agent-recorded watchlist-direction signals* (signals ingested outside the agent path, and buy/sell signals, do not keep an entry alive). Accompanied by a **separate one-shot operator backfill** (DBA-reviewed, reads ingest data, seeds expiry rows for existing SIGNAL entries) to clear the existing stale backlog. Rejected: analysis sweeper (new ingest system grant weakens features 224/225).
- **Strategy-bound SIGNAL entries are pruned like any other.**
- **Silent removal accepted** (ledger event is the only audit; no UI code change, list refreshes on refocus/remount/mutation) and **add-then-prune accepted** for an already-expired signal (feature 127 `@AC-1` add path is NOT changed).
- Gate: **run another round** (round 2) — not yet approved.

### Session 2026-10-31 — sdd-design Phase 1 round 2 — user decisions

Round 2: proposer added never-waiting `SKIP LOCKED` per-watchlist prune (found `UpdateBinding`/`UpdateBindings` lock in reverse order, watchlist_repo.go:337/347, 371/402), insert-count-aware add path, Go operator backfill (REPORT/APPLY), real-DB concurrency tests T1-T4 + `portfolio-db-test` CI job. Adversary verdict NEEDS WORK, **no Floor breach**; round-1 objections verified closed in code.

Folded in without a decision: overwrite (not merge) a leftover expiry row when the binding is freshly inserted; FR-2/FR-3 reworded to "agent-recorded watchlist signals since the entry was last added" and FR-7 says the backfill counts every watchlist-direction row the owner has; AC-2/AC-4 reworded, AC-12 corrected (replace-all preserves client-sent `source`), rename-preserves-SIGNAL test, T4 mirrors repo lock order + reverse interleaving; backfill digest dropped (REPORT/APPLY share code; APPLY refuses if `seed_expired` grew); unused partial index dropped, `FOR NO KEY UPDATE` on parent; `portfolio-db-test` wired into the aggregate CI gate; tick **Agent** in Consumer Surface(s).

**Explicit user sign-offs (AskUserQuestion, 2026-10-31):**
- **Version skew:** a provenance-less SIGNAL add on a tracked entry **untracks** it (deletes its expiry row; re-running the idempotent backfill re-seeds), so deploy order does not matter; **and the pause switch is restored** (`portfolio.watchlist.signal_prune_interval_seconds` bounds `[0,86400]`, `0` = skip the prune and re-check every 300s).
- **Failed renewal add accepted as a residual risk** (early prune at the old expiry until the next non-deduplicated ingest); no agent retry added.
- **Backfill REPORT also lists `untracked_no_signal` SIGNAL entries** (user, symbol) for manual removal; no automatic deletion.
- Gate: **run a third round** — not yet approved.

### Session 2026-10-31 — sdd-design Phase 1 round 3 — user decisions

Round 3: proposer finalized the design (untrack restricted to SIGNAL-sourced adds, overwrite-on-fresh-insert vs update-only merge, `NewPool` export, T0-T7 tests, FR-1..FR-7 / AC-1..AC-14 drafts). Adversary verdict NEEDS WORK, **no Floor breach**. Folded in without a decision: backfill CLI never deletes bindings itself — it MARKS approved untracked entries by upserting an expiry row (`valid_until = now()`, `signal_id` NULL, new `reason` smallint enum UNSPECIFIED/EXPIRED/UNTRACKED_NO_SIGNAL per C-04) and the in-service prune deletes them (single deleter, no CLI ledger/mTLS access, no `UpdateBinding` deadlock) emitting a distinct `portfolio.watchlist.signal_entry_removed_untracked` {user_id, watchlist_id, symbol, strategy_id, reason}; `strategy_id` added to the `signal_entry_expired` payload (ledger-rebuildable removals); runbook documents `TRUNCATE portfolio.watchlist_signal_expiry` as the immediate emergency stop (every restart runs a tick; raising the interval is not a pause) with portfolio rollback as second line; interval bounds `[60,86400]`, `<=0` reads 300, `1..59` clamps to 60 (dual-form test rows); REPORT lists each row to be removed `(owner, watchlist_id, symbol, strategy_id)`; T7 fixtures `" aapl"`/`"AAPL"` and a legacy-owner row; FR-3 "never pruned" scoped to the recurring prune; AC-1..AC-7 frozen, AC-8..AC-17 written fresh.

**Explicit user sign-offs (AskUserQuestion, 2026-10-31):**
- **Untracked removal scope: "Remove strictly as amended"** — the backfill removes every SIGNAL entry with no `direction='watchlist'` signal row under the owner's OWN user id, **knowingly accepting the adversary's warning** that pre-feature-224 signal rows were reassigned to `SEED_USER_ID` (ingest migration `013_signal_ownership_templates.up.sql:70`) so real users' entries can appear untracked while their signal is still live (this contradicts FR-3 for those users). Rejected options: legacy-owner match that never removes (adversary-recommended) and list-only. Mitigation kept inside the choice: REPORT must print per-owner counts and flag owners that have zero signal rows under any owner id, and removal remains bounded by `--expect-untracked N` with the exact rows listed for the DBA.
- **No pin-on-add:** a MANUAL add of an existing SIGNAL entry stays first-writer-wins (no change to feature 127); recorded as residual risk.
- Gate: **run a fourth round** — not yet approved.

### Session 2026-11-02 — sdd-design amendment (quick), round 1 — operator decisions

- **Trigger:** 278 merged (`631028eb`). Its shrink-only `config-wiring` baseline makes the 227-D2 unseeded waiver fail CI. **Operator decision: seed the key via a config migration; no baseline entry.** Recon amendment appended to `recon.md`.
- **Round-1 synthesis:**
  - Config migration `035_portfolio_signal_prune_interval` lands **inside Step 11** with the reader. Seeding in Step 13 or a separate step was rejected because it leaves `read-unseeded` commits.
  - A Step 14 migration parse test guards `value_type 'int'`, 2 env rows, `user_id` NULL, value within `[60,86400]`, and the down scope. 278's check ignores `value_type`, and the seed equals the default (ledger fails.md:2333).
  - Step 11 verifies with `--final --json` and zero findings for this key. The step-time run is a form-mismatch guard only (`PENDING` never fails, `check-config-wiring.mjs:706`).
  - Idempotence holds by `ON CONFLICT … DO NOTHING`. CI never re-runs 035 (`migration-rerun.sh` replays only the 224/225 list).
  - Governance: config team plus DBA review for 035. Advisory `/sdd-review impl-spec` re-run on the changed steps.
  - New `@AC-19`; AC-14 unchanged.
  - **Config migration number 035 is reserved here**, re-checked at Step 11 and at the integration-PR gate.
- **Operator decision (2026-11-02):** the 035 down migration deletes **global rows only** (`user_id IS NULL`), never per-user overrides it did not create. This deviates from the 033 precedent on purpose. Then run another round.

_From: Session 2026-10-31 — sdd-design Phase 0 (Recon)_

- C-16: no CHANGE found; soft spot = platform `@AC-7` (do not lock/hide manual remove on SIGNAL rows).

_From: Step 16 — backfill DB tests [done] (2026-11-02)_

  - `StrictUntrackedRemoval` (AC-16): REPORT has the `UNTRACKED … strat-3 1 Y` and `NO_OWN_SIGNALS` lines. A `live - 1` bound refuses with zero writes. APPLY marks `(now, NULL)`, and the tick returns a `PrunedEntry` with nil `SignalID` and `strat-3`.
