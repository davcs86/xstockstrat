# Recon: fix-portfolio-signal-expiry-backfill

**Created**: 2026-11-17
**From**: product-spec.md
**Tree**: feature/fix-portfolio-signal-expiry-backfill@3c838adf ≡ origin/feature/fix-portfolio-signal-expiry-backfill (the discovery digests were UNSTAMPED; every `path:line` below was re-grepped at this tree)
**Affected services**: xstockstrat-portfolio
**Severity**: SEV-3

---

## Objective

The one-shot `backfill-signal-expiry` APPLY can race a signal ingest for the same system-watchlist SIGNAL binding. When it loses, it leaves a due `portfolio.watchlist_signal_expiry` row (`valid_until ≈ now()`, `signal_id NULL`) next to a live signal, and the next prune tick wrongly removes the binding (FR-1, `@AC-1`). The fix must serialize the APPLY writes against the add path, so that either the mark writes nothing ("changed since REPORT") or the add path rescues it. `TestBackfill_IngestRaceNeverLeavesEntryRemovable` stays the regression guard and must not be weakened or skipped (operator decision, 2026-11-17).

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Entry point (backfill subcommand): `services/xstockstrat-portfolio/cmd/server/backfill.go:20`, flag set `backfill-signal-expiry`. It requires the pooled `:25061` `DATABASE_URL` (`backfill.go:31`).
  - Backfill driver: `RunBackfill` at `internal/repository/signal_expiry_backfill.go:125`.
    - REPORT reads through `readBackfillState` (`:202`) in a RepeatableRead read-only tx (`:203`).
    - The APPLY loop (`:157-183`) runs one **pool autocommit** `pool.Exec(ctx, stmt, c.watchlistID, c.symbol)` per candidate (`:167`). `RowsAffected()==0` is counted as `changed since REPORT` (`:174-176`).
  - Race site, mark: `backfillMarkSQL` (`signal_expiry_backfill.go:114-121`) is `INSERT … SELECT … now(), NULL … AND NOT EXISTS (own watchlist signals) ON CONFLICT DO NOTHING`. The join to `portfolio.watchlists` (`:118`) is a plain read and takes no row lock.
  - Suspected race site, seed: `backfillSeedSQL` (`:101-112`) inserts `m.valid_until, m.id` from the owner's newest own signal, using the same snapshot-then-`ON CONFLICT DO NOTHING` shape.
  - Add path: `WatchlistRepo.AddSymbols` (`internal/repository/watchlist_repo.go:300`) runs in one tx, in this order:
    1. `touchWatchlistTx` (`:307`)
    2. `insertBindingsTx` (`:310`)
    3. `applyExpiryIntentTx` (`:314`)
  - `touchWatchlistTx` (`watchlist_repo.go:502`) is `UPDATE portfolio.watchlists SET updated_at = now() …`. It takes the parent row lock, and so do `RemoveSymbols` (`:331`) and the update paths (`:371`, `:426`).
  - `applyExpiryIntentTx` (`watchlist_repo.go:547`). Its doc comment at `:545-546` says the caller must hold the parent watchlist row lock.
    - For a freshly inserted binding it upserts (`ON CONFLICT DO UPDATE`).
    - For an existing SIGNAL binding it reads `source`, then runs `mergeSignalExpirySQL`.
    - `UntrackSymbols` deletes expiry rows.
  - `mergeSignalExpirySQL` (`watchlist_repo.go:293-296`) is **UPDATE-only**. Comment at `:291-292`: "a backfill-marked row (signal_id NULL) is rescued. Add path only — the backfill never merges."
  - Service caller: `PortfolioService.AddWatchlistSymbols` (`internal/service/portfolio_service.go:2464`). Intent is built by `expiryIntentFor` (`:2081`).
  - Prune locking, PORTFOLIO-18 (out of scope): `internal/repository/signal_expiry_repo.go:70` (`… FROM portfolio.watchlists … FOR NO KEY UPDATE SKIP LOCKED`), plus `:90` and `:152` (`FOR UPDATE SKIP LOCKED`). The invariant is in `services/xstockstrat-portfolio/docs/context-constitution.md:30`.
  - Last migration: `018_watchlist_signal_expiry.up.sql` (`services/xstockstrat-portfolio/migrations/`). The expiry FK to `watchlists` is `ON DELETE CASCADE` (`018…up.sql:5`).
  - Config-read pattern: not touched. The backfill reads no config keys.
  - Tests in `internal/repository/signal_expiry_backfill_dbtest_test.go` (`//go:build dbtest`, line 1):
    - Regression guard: `TestBackfill_IngestRaceNeverLeavesEntryRemovable` (`:443`). It runs 10 racing iterations. The failure message "entry left due … while a live signal exists" is at `:493-495`, followed by `mustPrune` and `assertSource`.
    - Deterministic-interleave precedent: `TestBackfill_IngestInterleavingSkipsChanged` (`:349`). It polls `pg_stat_activity` with `wait_event_type = 'Lock'` (`:400-403`).
    - Local helpers: `seedWatchSignal` (`:24`), `cleanupIngest` (`:40`), `backfillReport` (`:63`), `backfillApply` (`:83`), `mustApply` (`:90`). Shared helpers (`testPool`, `seedWatchlist`, `seedBinding` …) live in `dbtest_helpers_test.go`.
  - Runbook: `docs/runbooks/signal-watchlist-expiry-backfill.md` §7 "Step B: APPLY" (`:135`). Lines `:150-153` say APPLY writes "one autocommit `INSERT … ON CONFLICT DO NOTHING` per row" and "recomputes the class from ingest at statement time".

### Confirmed mechanism (from the code above)

1. The mark statement's READ COMMITTED snapshot predates the signal commit, so `NOT EXISTS` passes.
2. `AddSymbols` holds the parent lock, but the mark never asks for it. Its `mergeSignalExpirySQL` runs while the mark row is uncommitted or not yet inserted, so it updates 0 rows. An UPDATE does not see an uncommitted insert, and the two writes do not conflict.
3. The mark commits a due `signal_id NULL` row. Nothing rescues it.

The seed path has the same shape analytically. It can commit the owner's older (possibly already-expired) `valid_until` after a merge that found no row. This has not been observed, and design decides FR-2 / `@AC-2`.

## Patterns to REUSE

- **Serialize APPLY against the add path** → reuse the parent-row lock that is already the documented serialization point (`applyExpiryIntentTx` contract, `watchlist_repo.go:545-546`). Two forms exist:
  - `touchWatchlistTx`-style `UPDATE portfolio.watchlists … WHERE watchlist_id = $1` (`watchlist_repo.go:502`)
  - `SELECT … FROM portfolio.watchlists WHERE watchlist_id = $1 FOR NO KEY UPDATE` (the prune's lock form at `signal_expiry_repo.go:70`, without `SKIP LOCKED`)

  The candidate is to wrap each APPLY candidate in its own short tx: lock the parent row, then run the existing seed or mark SQL unchanged, then commit. Under READ COMMITTED the INSERT's snapshot is taken after the lock is granted:
  - If the add path committed first, the mark sees the committed signal (`NOT EXISTS` fails), so 0 rows, which is the `changed since REPORT` outcome.
  - If the mark committed first, the add path blocks in `touchWatchlistTx` until the mark commits. Its merge then sees the mark row and rescues it (the existing `@AC-17` contract).
- **Outcome accounting** → reuse `RowsAffected()==0 → changed since REPORT` (`signal_expiry_backfill.go:174-176`). No new outcome, counter, or output line is needed.
- **Deterministic RED for `@AC-1` (C-15)** → reuse the second-connection + open-tx + `pg_stat_activity` polling technique from `TestBackfill_IngestInterleavingSkipsChanged` (`signal_expiry_backfill_dbtest_test.go:349`, `:400-403`).
  - Candidate (design to confirm): hold an uncommitted conflicting expiry insert for the same PK in a side tx. This parks the mark's `ON CONFLICT` with a snapshot that predates the signal.
  - Then commit the signal and run `AddSymbols`. Its merge updates 0 rows on the buggy code.
  - Then roll back the side tx, so the mark lands due. This fails deterministically before the fix.
  - After the fix, the mark tx holds the parent lock, so `AddSymbols` must run in a goroutine and is rescued once the backfill tx commits.
  - The existing 10-iteration race test is kept unchanged alongside it.
- **Test helpers** → reuse `backfillReport`/`backfillApply` (`:63`/`:83`), `seedWatchSignal` (`:24`), and the shared helpers in `dbtest_helpers_test.go`. Do not add a new fixture home (C-13).

## Existing Business Rules (preserve / extend)

The fix is internal serialization and invisible at the RPC level. Verdicts are PRESERVE or EXTEND only, with no CHANGE.

- **PRESERVE** `@AC-17 @FR-7 @feature-281` "A marked entry is rescued by a live signal before the next tick" (`services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`) — a live signal rescues a backfill mark, and a signal already past `valid_until` is not rescued. This is the rescue contract of `mergeSignalExpirySQL`. 359 must keep both halves.
- **EXTEND** `@AC-17 @FR-7 @feature-281` "A marked entry is rescued by a live signal before the next tick" (same file) — 359 `@AC-1` adds the case where the signal commits while APPLY runs, so the mark row is not yet committed when the merge runs. The sequential rescue stays as is.
- **PRESERVE** `@AC-16 @FR-7 @feature-281` "Strict untracked removal, including the accepted pre-224 legacy-owner case" (same file) — genuinely untracked bindings are still marked. APPLY refuses on an `--expect-untracked` mismatch before writing. The entry is removed on the next tick. The fix must not stop marking.
- **PRESERVE** `@AC-15 @FR-7 @feature-281` "Backfill seeds expiry for existing entries from the owner's signal rows" (same file) — REPORT writes nothing. APPLY seeds `valid_until`/`signal_id` from the newest signal. Locking the seed must not change its output. This is the likely home of a seed-path EXTEND if design confirms FR-2.
- **PRESERVE** `@AC-13 @FR-6 @feature-281` "Each removal emits one owner-visible event of the right kind" (same file) — the untracked-mark removal emits exactly one `signal_entry_removed_untracked` event. Event kind and payload are unchanged.
- **PRESERVE** `@AC-9 @FR-3 @feature-281` "A SIGNAL add without dated provenance untracks the entry" (same file) — no provenance means the expiry row is deleted. This guards any change to `applyExpiryIntentTx`.
- **PRESERVE** `@AC-8 @FR-2 @FR-3 @feature-281` "A renewed signal extends the entry's life" (same file) — the merge extends `valid_until`.
- **PRESERVE** `@AC-18 @FR-2 @feature-281` "Invalid signal provenance is rejected" (same file) — InvalidArgument and no writes. Validation stays before any lock or write.
- **PRESERVE** `@AC-12 @FR-5 @feature-281` "The prune never waits on a concurrent rebind" (same file) — PORTFOLIO-18. A backfill tx holding the parent lock makes the prune `SKIP LOCKED` that list for one tick. It does not wait.
- **PRESERVE** `@AC-2`, `@AC-3`, `@AC-4`, `@AC-5`, `@AC-6`, `@AC-7`, `@AC-10`, `@AC-11` (`@feature-281`, same file) — the core prune semantics, only indirectly at risk:
  - removal on expiry
  - all signals expired
  - open-ended entries are never pruned
  - MANUAL entries are never pruned
  - the prune is idempotent
  - the expired event
  - non-agent signals do not keep an entry alive
  - a manual add does not pin an entry
- **PRESERVE** `@AC-7 @FR-4 @feature-170` and `@AC-8 @FR-4 @feature-170` (`services/xstockstrat-portfolio/acceptance/watchlist-bulk-default-strategy.feature`) — default-strategy resolution on `AddWatchlistSymbols`.
- **PRESERVE** `@AC-2 @FR-2`, `@AC-6 @FR-5`, `@AC-8 @FR-2` (`@feature-282`, `services/xstockstrat-portfolio/acceptance/filter-otc-symbols.feature`) — the servability filter on the add path stays fail-open.
- **PRESERVE** `@AC-6 @FR-2 @FR-7 @feature-127` "EnsureSignalWatchlist is idempotent and coexists with a same-named manual list" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`) — one system_managed list per user.
- **PRESERVE** `@AC-2 @FR-2 @feature-167` "Rebind preserves the entry's per-binding source on a system-managed list" (`services/xstockstrat-portfolio/acceptance/watchlist-single-strategy-update.feature`).
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-127` "A watchlist-direction signal adds the symbol to the caller's system-managed watchlist" (`docs/sdd/business-rules/platform.feature`) — the upstream trigger of the race. It is already superseded by 282 for unservable symbols.
- **PRESERVE** `@AC-3 @FR-4 @feature-127` (`docs/sdd/business-rules/platform.feature`) — a deduplicated ingest does not re-trigger the auto-add.
- **PRESERVE** `@AC-7 @FR-8 @FR-9 @feature-127` "A system-managed watchlist cannot be deleted via API or UI" (`docs/sdd/business-rules/platform.feature`) — do not alter the expiry FK `ON DELETE CASCADE`.
- Not impacted: the other xstockstrat-portfolio suites. None touches the expiry table, the backfill, or add-path locking. `platform.feature` lines 797-2696 were covered by grep, not a line-by-line read.

## Dependencies

- Proto/RPC: none.
- Migration: none. The next free number would be `019`, but none is needed.
- Config keys: none.
- Inter-service edges: none new. The existing ingest → portfolio `AddWatchlistSymbols` edge is unchanged.
- New env vars / ports: none.

## Risks / Not-found

- **Seed-path race (open question → design):** analytically the same shape as the mark. One wrapper fix would cover both. Design decides whether to add FR-2 and an append-only `@AC-2`.
- **Ordering assumption, not verified in ingest code:** the fix relies on the signal row committing before `AddSymbols` starts. The test does this (autocommit insert, then `AddSymbols`). Recon did not verify that the production ingest → portfolio call order guarantees it. Design should confirm or argue it is not needed, since a mark that lands first is rescued by the later merge either way.
- **Lock mode choice:** `FOR NO KEY UPDATE` and `touchWatchlistTx`'s non-key `UPDATE` conflict with each other, so either serializes. An `UPDATE … SET updated_at` would bump `updated_at` as a visible side effect, while the `SELECT … FOR NO KEY UPDATE` form does not. Design picks one.
- **PgBouncer:** the backfill runs on the pooled `:25061` URL (`backfill.go:31`). A short explicit tx per candidate is compatible with transaction pooling. Lock waits are bounded by `AddSymbols` tx length.
- **PORTFOLIO-18 interaction:** while the backfill holds a list's lock, the prune skips that list for the tick (`SKIP LOCKED`, `signal_expiry_repo.go:70`). This is consistent with `@AC-12`, and the prune locking itself stays out of scope.
- **The alternative fix site (`applyExpiryIntentTx` / `mergeSignalExpirySQL` → upsert-on-add) risks a silent CHANGE** to `@AC-9` (untrack with no provenance), `@AC-17` (a past signal is not rescued), and the "untracked entry stays untracked" comment at `watchlist_repo.go:291`. If design goes this way, the debate must address it.
- **Feature 354 overlap:** 354 edits the `ListByUser` / constructor region of `watchlist_repo.go` (`:107-141`) and `dbtest_helpers_test.go` (`seedNamedWatchlist`, `seedWatchlist` delegate). A backfill-side fix touches neither, so it is rebase-only. If 359 edits `dbtest_helpers_test.go`, add a soft merge-order row (354 first).
- **Runbook §7 wording** (`docs/runbooks/signal-watchlist-expiry-backfill.md:150-153`, "one autocommit `INSERT …` per row") becomes inaccurate under a per-candidate tx. Spec should include a doc touch.
- **No production test hook exists** for forcing the interleaving. The deterministic RED must be built in test code only (pattern above). Do not add a production seam (CLAUDE.md "minimum").
- **Not read by discovery:** `.claude/skills/sdd-design/reference/recon-checklist.md`, the full prune body in `signal_expiry_repo.go`, and the bodies of the helpers in `dbtest_helpers_test.go`.
- **Ledger:** no `fails.md`/`insights.md` entry matched portfolio expiry, backfill race, row locks, or READ COMMITTED snapshot traps (grepped). There is no applicable prior trap.

## Recommended Scope

Advisory, and not binding.

1. **test (RED):** add a deterministic forced-interleaving dbtest for `@AC-1` (the mark path, plus the seed path if design adopts FR-2) in `signal_expiry_backfill_dbtest_test.go`, using the `:349` technique. Leave `TestBackfill_IngestRaceNeverLeavesEntryRemovable` (`:443`) byte-for-byte unchanged. Verify it fails on current code.
2. **service:** in `RunBackfill`'s APPLY loop (`signal_expiry_backfill.go:157-183`), run each candidate in a short tx that first locks the parent `portfolio.watchlists` row, then executes the unchanged seed or mark SQL. Keep the `RowsAffected` mapping. Leave `watchlist_repo.go` untouched.
3. **docs:** update runbook §7 (`:150-153`) wording, and add an optional one-line note in `services/xstockstrat-portfolio/CLAUDE.md` / PORTFOLIO constitution if the lock order becomes a new invariant.

Verify with `go test -tags dbtest -race -count=1 -run 'TestBackfill_' ./internal/repository/...`, run from `services/xstockstrat-portfolio` with `PORTFOLIO_DB_TEST_URL` set. Also run the full portfolio `go test` + golangci-lint with `GOWORK=off`.
