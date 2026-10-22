# Recon: fix-fundsignal-emit-accounting

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (fix site), xstockstrat-ingest (dedup semantics; read-only unless design moves idempotency there)

---

## Objective

The fundamentals signal producer (`FundamentalsSignalLoop.run_once`) uses one `analysis.fundsignal_emitted` row for
both "claimed" and "emitted". A failed `IngestSignal` therefore blocks the symbol for the rest of the day and still
counts in `signals_emitted` (D-43). A failed `GetFundamentalsMulti` chunk vanishes from accounting, and the run still
ends `"completed"` (D-57). This SEV-2 fix makes failed emits retryable the same day and counts only accepted signals. It
also leaves no orphan claim after a `_SystemWriteRejected` abort, and reports failed-chunk symbols as deferred with a
new `"partial"` status.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point: `services/xstockstrat-analysis/app/main.py:180-194`. It constructs `FundamentalsSignalLoop`, stores it
    in `servicer._fundsignal_loop` (`:193`) and starts `run_forever()` (`:194`).
  - Handler/servicer: `RunFundamentalsScan` at `services/xstockstrat-analysis/app/handlers/servicer.py:3812` (manual
    path that shares `run_once`). The RPC is declared at `packages/proto/analysis/v1/analysis.proto:30`.
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). The next free
    number is **028**.
  - Config-read pattern: `self._cfg.get_int("analysis.fundsignal.daily_call_budget", default=200)`
    (`app/engine/fundsignal_loop.py:222`). `valid_days` is at `:232`, and `min_conviction_to_emit` is at `:229`.
  - Other key symbols (all in `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`):
    - `_SystemWriteRejected`: `:39`
    - `as_of_date = datetime.now(UTC).date()`: `:172`. It is not passed into `_emit_signal`.
    - `force` path: `DELETE FROM analysis.fundsignal_emitted WHERE source=$1 AND as_of_date=$2` at `:210-216`.
    - Non-force skip: `_already_emitted` is applied at `:218-219`, before the fetch.
    - `_paced_fetch` is called at `:223` and returns `(fetched, deferred, calls)`.
    - Emit loop: the `try` opens at `:235`, and `_ensure_source_registered` runs inside it at `:236`, before any claim.
    - Claim INSERT `... ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol`: `:242-254`. `row is None`
      → `continue` at `:255-256`.
    - `_emit_signal` call: `:257-259`. The conditional `UPDATE ... SET signal_id=$4` is at `:260-268`, and the
      **unconditional** `emitted += 1` is at `:269`.
    - `except _SystemWriteRejected` → `_abort_cycle(..., symbols_done=len(fetched), deferred=len(deferred),
      signals_emitted=emitted)`: `:270-278`. There is no claim cleanup.
    - Status: `status = "budget_deferred" if deferred else "completed"` at `:280`. The budget-specific
      `_emit_warning` is at `:281-285`, and `_finish(...symbols_done=len(fetched)...)` is at `:286-293`.
    - `_already_emitted`: `SELECT symbol FROM analysis.fundsignal_emitted WHERE source=$1 AND as_of_date=$2`
      (`:373-379`). It does not filter on `signal_id`.
    - `_paced_fetch(symbols, budget, metadata, chunk_size=50)`: `:381-407`. The `except Exception` logs and swallows
      at `:401-402`. `calls += 1; i += chunk_size` runs regardless (`:403-404`). `deferred = symbols[i:]` (`:406`)
      omits failed-chunk symbols.
    - `_ensure_source_registered`: `FAILED_PRECONDITION` → `_SystemWriteRejected` (`:512-516`).
    - `_emit_signal`: `valid_until = now + timedelta(days=valid_days)`, with `now = datetime.now(UTC)` per call
      (`:520-525`). It returns `resp.signal_id` (`:540`). `NOT_FOUND` → `_SystemWriteRejected` (`:542-546`). Any
      other error is logged and returns `None` (`:547-548`).
    - `_finish`: `:552-581`. It updates `fundsignal_runs` (`status`, `symbols_done`, `calls_spent`, `deferred_count`),
      emits the ledger event `analysis.fundsignal.run_completed` (`:564-568`) and builds `FundamentalsScanSummary`
      (`symbols_processed=symbols_done`, `deferred_count=deferred`, `status`).
    - `_abort_cycle` → ERROR `_emit_warning` + `_finish(status="failed")`: `:600-612`.
  - Schema:
    - `migrations/004_fundsignal_emitted.up.sql:6-15`. Columns are `symbol, source, as_of_date, signal_id bigint`
      (nullable), `score, direction, run_id` (FK → `fundsignal_runs`). `PRIMARY KEY (symbol, source, as_of_date)`.
      There is no state or timestamp column.
    - `migrations/003_fundsignal_runs.up.sql:9`. `status text NOT NULL DEFAULT 'running'`, with no CHECK constraint.
      The comment reads `running | completed | budget_deferred | failed`, so adding `"partial"` needs no migration.
- **`xstockstrat-ingest`** (Python)
  - Dedup claim: `services/xstockstrat-ingest/app/handlers/servicer.py:1039-1084`.
    - `INSERT INTO ingest.signal_dedup_claims ... ON CONFLICT (user_id, source, symbol, direction) DO UPDATE ... WHERE
      claimed_at < NOW() - make_interval(hours => $8::int) OR conviction IS DISTINCT FROM ... OR valid_until IS
      DISTINCT FROM ...`.
    - The window is `self._cfg.dedup_window_hours` (`:1065`), from config key `ingest.signals.dedup_window_hours`
      (default 24).
    - A claim miss raises `_DuplicateSignal` and returns the existing `signal_id` with `deduplicated=true`
      (`:1067-1084`).
    - Because the producer's `valid_until` changes on every call, a retry overwrites the claim and is not deduplicated
      today.
- **Proto**: `packages/proto/analysis/v1/analysis.proto:558` `message FundamentalsScanSummary`, with
  `:564 string status = 6; // "completed" | "budget_deferred" | "failed"`. The change is a comment-only edit.
- **Consumer surfaces** (pass-through, no code change expected):
  - Agent `run_fundamentals_scan`: `services/xstockstrat-agent/app/tools.py:1412` documents a return including
    `"deferred_count", "status"`.
  - UI: `services/xstockstrat-ui/src/app/config-ui/fundamentals-scan/page.tsx:101` (`summary.status` verbatim) and
    `:106` (`summary.deferredCount`).
- **Tests**: `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`.
  - Helpers:
    - `_make_cfg` (`:20`) and `_fund` (`:31`).
    - `_make_loop` (`:45`). It mocks the DB pool: `fetch` returns `[]` and `fetchrow` returns `{"symbol": "X"}`, so
      the claim always wins. `IngestSignal` returns `signal_id=123`.
    - `_rpc_error` (`:526`), `_identity_loop(ingest_responses=...)` (`:532`, uses `tests.conftest.RecordingStub`
      `conftest.py:83`), `_emitted_inserts` (`:549`) and `_scan_via_rpc` (`:569`).
  - Classes that will interact with the change:
    - `TestIdempotency` (`:95`): `test_already_emitted_skips_fetch_and_emit` `:97` and
      `test_conflict_claim_lost_skips_emit` `:107`.
    - `TestBudgetDefer` (`:155`): `test_paced_fetch_respects_budget` `:157` and `test_run_marks_deferred_and_warns`
      `:167`.
    - `TestSystemWriteRejected` (`:697`): `test_ingest_not_found_as_system_aborts_cycle` `:721`.
  - Real Postgres: the session `local_pg` fixture (`tests/conftest.py:368`) is used with `-m real_pg`. No existing
    real_pg test exercises `fundsignal_emitted`, and there is no stateful fake of the table.

## Patterns to REUSE

- **Unconfirmed-claim marker (OQ-1 option one)** → reuse the existing nullable `signal_id`
  (`004_fundsignal_emitted.up.sql:10`). A NULL row means "claimed, not confirmed", and no migration is needed. The
  confirm write is the existing `UPDATE ... SET signal_id=$4` (`fundsignal_loop.py:261-268`).
- **Releasing a claim** → follow the precedent of the `force` path's `DELETE FROM analysis.fundsignal_emitted ...`
  (`fundsignal_loop.py:211-215`). A per-symbol `DELETE ... WHERE symbol=$1 AND source=$2 AND as_of_date=$3 AND
  signal_id IS NULL` through the same `self._db.execute` handle covers both FR-1 (failed emit) and FR-3 (abort).
- **Same-day skip set** → narrow `_already_emitted` (`:373-379`) instead of adding a second reader. It is the only
  reader besides the claim INSERT, the UPDATE and the force DELETE, and nothing else in `services/` references
  `fundsignal_emitted`.
- **Failed-chunk bucket** → extend the existing per-chunk `except` in `_paced_fetch` (`:401-402`) to collect the
  chunk's symbols. Return them alongside `deferred = symbols[i:]` (`:406`). The only callers are `:223` and
  `test_fundsignal_loop.py:160`.
- **Operator alerting** → `_emit_warning` (WARNING, used at `:281-285`) and `_abort_cycle` (ERROR, `:600-612`). Keep
  the broadcast untargeted (`@AC-6 @feature-224`; peer 242 leaves `_emit_warning` untouched).
- **Run bookkeeping** → `_finish` (`:552-581`) already carries `status`, `symbols_done` and `deferred_count` to the
  DB, the ledger and the proto. FR-2 and FR-4 change only the values passed in, not `_finish`.
- **Test harness** → `_identity_loop` + `_rpc_error` for injecting an `IngestSignal` failure (e.g. `UNAVAILABLE`),
  and a `GetFundamentalsMulti.side_effect` in the style of `_make_loop`'s `_get_multi` for a failing chunk.
  `test_paced_fetch_respects_budget` shows how the 120-symbol, 50-chunk shape is built. Same-day retry (`@AC-1`) and
  the abort cleanup need row state: either a small dict-backed fake behind `fetch`/`fetchrow`/`execute` keyed by
  `(symbol, source, as_of_date)`, kept in the test file per C-13, or a `real_pg` test on `local_pg`.
- **Stable idempotency inputs (OQ-2)** → if design picks the deterministic option, derive `valid_until` from
  `as_of_date` (`:172`) + `valid_days`, not from `now`. This follows `fails.md:2118-2122` (keys from stable inputs,
  never a timestamp).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-37` "Fundamentals scan fails closed on a non-system scoring formula" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`). An aborted cycle makes no IngestSignal call and writes no `fundsignal_emitted` row. The claim reorder and orphan cleanup must keep this.
- **PRESERVE** `@AC-33` "A user cannot write as the system owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`). An ungranted `system` write to IngestSignal gets `PERMISSION_DENIED`. A retry path must keep the SAN-bound `analysis-fundsignal` grant.
- **PRESERVE** `@AC-9` "Ingested signals belong to the source owner and dedup per owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`). This is per-owner dedup. It matters for OQ-2 if idempotency moves to ingest (deterministic `valid_until`).
- **PRESERVE** `@AC-36` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature`). On a registration `FAILED_PRECONDITION` the cycle emits no signal and raises an ERROR alert. The abort must leave no claim row.
- **PRESERVE** `@AC-6` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`). Scoring keeps `x-user-id: system` + `x-internal-caller: analysis-fundsignal`.
- **PRESERVE** `@AC-26` "System-owned fundamentals signals are visible to every user" (`docs/sdd/business-rules/platform.feature`). Retried emits must still produce system-owned signals that `signal_eligible` strategies consume.
- **PRESERVE** `@AC-1` "The producer runs its first cycle promptly on a fresh deploy, not after a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`). Restructuring `run_once` must keep the prompt first run and source registration.
- **PRESERVE** `@AC-4` "A caught cycle error retries after retry_seconds, not a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`). The `"partial"` and aborted-cycle outcomes must not change which cases count as a caught error. Schedule errors belong to feature 259.
- **PRESERVE** `@AC-6` "A manual scan does not contaminate the scheduled cadence" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`). A manual `RunFundamentalsScan` shares `run_once` but never moves `blocked_until_ms`, including when the run ends `"partial"`.
- **PRESERVE** `@AC-6` "The enumerated universe is capped only when FMP is the active provider" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`). Universe and cap behavior are unchanged. The FR-4 deferral math starts from the resolved universe.
- **PRESERVE** `@AC-7` "A portfolio enumeration outage does not crash the producer cycle" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`). An enumeration outage still ends without raising. It is not a failed chunk, so it must not become `"partial"` or `"failed"`.
- **PRESERVE** `@AC-8` "both + portfolio outage degrades to the explicit CSV" (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`). Same as `@AC-7`.
- **PRESERVE** `@AC-10` "A user cannot ingest into another user's source" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature`). `NOT_FOUND` is the distinct `_SystemWriteRejected` trigger; FR-1 and FR-3 must keep telling it apart from transient errors.
- **PRESERVE** `@AC-4` (`@feature-166`) "MCP tool result is parsed into ExternalSignals and ingested" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`). A second identical cycle returns `deduplicated` true. Relevant only if OQ-2 touches ingest dedup.
- **PRESERVE** `@AC-2` (`@feature-173`) "A stored dedup_window_hours of 0 disables the dedup window, not the default 24" (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`). Relevant only if OQ-2 touches ingest's dedup window.
- **PRESERVE** `@AC-3` (`@feature-156`) "A hard crash mid-cycle re-runs promptly on restart, not after a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`). The schedule advances only after completion; a `"partial"` run must not change this.
- **PRESERVE** `@AC-3`, `@AC-4`, `@AC-5`, `@AC-9` (`@feature-154`) "Producer scores the enumerated union when universe_source is watchlists" and siblings (`services/xstockstrat-analysis/acceptance/fundsignal-watchlist-universe.feature`). The failed-chunk bucket must not alter universe membership; `@AC-9` ("no symbol permanently dropped" under non-FMP) is consistent with FR-4's deferred reporting.
- **PRESERVE** `@AC-1` (`@feature-168`) "Blend strategy runs on the fundamentals universe intersection" (`services/xstockstrat-analysis/acceptance/fundamentals-blend-universe.feature`). Downstream consumer of `source "fundamentals"` signals; recovered same-day emits only add signals.
- **Conditional CHANGE escalation (OQ-2).** If design moves idempotency into ingest (dedup key or `valid_until` semantics), ingest `@AC-9`/`@feature-224`, `@AC-4`/`@feature-166` and `@AC-2`/`@feature-173` become CHANGE candidates needing sign-off in `context.md`. An analysis-side deterministic `valid_until` keeps them PRESERVE.
- **No CHANGE found.** No promoted `@AC-*` asserts that a failed emit burns the day's claim, that `signals_emitted` counts failed emits, or that a failed chunk still ends `"completed"`. FR-1 to FR-4 are EXTEND-class and are carried by this feature's own `@AC-1` to `@AC-6`, which promote at launch (C-16).
- **Uncovered guarantee to keep.** Same-day idempotency for *confirmed* symbols ("same-day re-run emits nothing new and spends zero cache calls; `force=true` re-emits by clearing the day's rows first", `services/xstockstrat-analysis/CLAUDE.md:123`) is a code-and-docs claim only, and no `@AC` covers it. Design should add or confirm a scenario so the C-16 guard covers the narrowed `_already_emitted`.
- Coverage gap: the scenario-recon scan was Grep-filtered (`fundsignal|signals_emitted|deferred|GetFundamentalsMulti|RunFundamentalsScan`). The agent and UI consumer suites were not read. Both hits (`xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`, `xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) are likely watchlist-signal matches.

## Dependencies

- Proto/RPC: `FundamentalsScanSummary.status` (field 6) comment gains `"partial"`
  (`packages/proto/analysis/v1/analysis.proto:564`). It is comment-only with no field-number change, so no
  breaking-proto gate applies. Re-run `./scripts/buf-gen.sh` (C-09, `proto-freshness`). RPC `RunFundamentalsScan`
  (`:30`) is unchanged.
- Migration: **none** under OQ-1 option one (reuse nullable `signal_id`). Under option two, the next number is `028`
  for `services/xstockstrat-analysis/migrations/` (001 to 027 exist). Before fixing the number, re-derive it across
  the in-flight batch branches; 259 may add a table.
- Config keys: none new. The existing keys `analysis.fundsignal.daily_call_budget`, `analysis.fundsignal.valid_days`
  and `analysis.fundsignal.min_conviction_to_emit` stay as they are. Ingest's `ingest.signals.dedup_window_hours`
  (default 24) is read-only context for OQ-2.
- Inter-service edges (unchanged):
  - analysis → ingest `IngestSignal` (gRPC, system identity)
  - analysis → marketdata `GetFundamentalsMulti` (gRPC)
  - analysis → ledger `AppendEvent`
  - analysis → notify (alerts)
- New env vars / ports: none.
- Docs to update in the same PR:
  - `services/xstockstrat-analysis/CLAUDE.md:122`, the `budget_deferred` run state. Add `partial`.
  - `services/xstockstrat-analysis/CLAUDE.md:123`. It is stale: it says "ingest's `IngestSignal` does **not** dedup",
    but ingest has dedup per features 111/224. The claim-state semantics also change here.
  - `docs/runbooks/mcp-tools.md:845`, the status enumeration.
  - The `003_fundsignal_runs.up.sql:9` comment is in an applied migration, so per F-01 it is not edited. The
    `status` vocabulary is documented in CLAUDE.md and the proto comment instead.

## Risks / Not-found

- **OQ-1 (claim state).** Option one makes NULL `signal_id` mean "unconfirmed". It needs two things:
  - `_already_emitted` must skip only rows with `signal_id IS NOT NULL`.
  - The claim INSERT must let a later run take over a NULL row. Today `ON CONFLICT DO NOTHING` returns `None` for any
    existing row (`:247`, `:255-256`). Either delete the row on failure, or use an `ON CONFLICT ... DO UPDATE ...
    WHERE signal_id IS NULL` re-claim.

  A process crash between claim and confirm also leaves a NULL row, which option one would treat as retryable.
  Concurrent `run_once` invocations (loop + manual RPC) could then both re-claim a NULL row. Design must state the
  concurrency stance.
- **OQ-2 (retry idempotency).**
  - Ingest absorbs a retry only if conviction *and* `valid_until` are unchanged and the call falls inside the 24h
    window (`ingest servicer.py:1039-1066`).
  - A deterministic `valid_until` (`as_of_date` + `valid_days`) fixes the `valid_until` term. A same-day re-score
    with a different conviction would still create a second row.
  - Because the cross-sectional `_map_directions` recomputes over the retry run's (smaller) universe, the direction
    and conviction can differ on a retry. The direction is part of ingest's conflict key.
  - Applicable trap `fails.md:2627-2640`: a caller retrying through a dedup seam must check the returned status. Here,
    `deduplicated=true` with a returned `signal_id` must count as confirmed for FR-2. Design must decide whether a
    deduplicated retry counts toward `signals_emitted`.
- **FR-4 and `_paced_fetch` partial responses.** Today a chunk that *succeeds* but returns fewer fundamentals than
  requested silently drops the missing symbols too. FR-4 covers only the raised-exception case. Peer 255
  (`fix-marketdata-fundamentals-cache`) may change `GetFundamentalsMulti` partial semantics; re-check at 255's design.
- **Abort accounting.** `_abort_cycle` receives `signals_emitted=emitted`, so FR-2 applies to the abort path as well
  (`:277`). `_SystemWriteRejected` from `_ensure_source_registered` (`:236`, `:512-516`) fires before any claim, so FR-3
  cleanup is needed only for the `_emit_signal` NOT_FOUND path (`:542-546`).
- **Warning text.** The `_emit_warning` at `:281-285` says "daily call budget reached". With a failed chunk it would
  be wrong. A `"partial"` run needs its own (or combined) message.
- **Test-harness gap.** `_make_loop`'s `fetchrow` always returns a claim winner and `fetch` returns `[]`, so no
  existing test holds row state. The same-day retry `@AC` needs a stateful fake or `real_pg`.
  `test_run_marks_deferred_and_warns` (`:167`) and `test_ingest_not_found_as_system_aborts_cycle` (`:721`) assert
  current status values and must keep passing.
- **Merge overlap.**
  - `246-fix-fundsignal-neutral-score` (implementation-ready) edits the same `run_once` claim/skip/emit rows and the
    `_fund` / `_emitted_inserts` helpers. Merge 246 first, rebase 260. Add the `merge-order.md` row at /sdd-spec; none
    exists today.
  - 259 (`run_forever`/`_tick`), 244 (config read sites `:143,154`) and 215 (`analysis.proto`, different message) are
    rebase-only.
- **Applicable ledger traps.**
  - `fails.md:2118-2122`: idempotency inputs must be stable, never timestamp-derived. This is directly the OQ-2
    `valid_until` issue.
  - `fails.md:2689-2691`: an insert-only `ON CONFLICT DO NOTHING` guard needs a documented recovery path, and a test
    that writes without the input, re-runs, and asserts recovery. This is the D-43 shape exactly.
  - `fails.md:2846`: verify a loader reads the whole result (swallowed errors) before reading "absence". This applies
    to the failed-chunk symbols that look "not fetched".
- **Not found / not verified.**
  - Nothing reads `signal_id IS NULL` today.
  - No `"partial"` string exists anywhere in fundsignal code or docs.
  - No stateful fake of `fundsignal_emitted` exists.
  - Not opened: the `RunFundamentalsScan` servicer body beyond its location (`servicer.py:3812`) and
    `services/xstockstrat-analysis/docs/context-constitution.md`.
  - Not verified: whether ingest's dedup-claim INSERT and the `newsletter_signals` row insert share one transaction,
    which matters for the lost-but-committed response case.

## Recommended Scope

Advisory, not binding.

1. **Claim semantics (D-43, FR-1/FR-2/FR-3), analysis only.**
   - Adopt OQ-1 option one (NULL `signal_id` = unconfirmed, no migration).
   - Narrow `_already_emitted` to confirmed rows.
   - On a `None` emit, release the claim (`DELETE ... AND signal_id IS NULL`) or allow re-claim of NULL rows.
   - Increment `emitted` only when a `signal_id` is returned.
   - On `_SystemWriteRejected` from `_emit_signal`, delete the current symbol's NULL claim before `_abort_cycle`.
   - Tests: a stateful-fake (or `real_pg`) same-day retry, the abort cleanup with earlier confirmed rows kept, and
     `signals_emitted` excluding failures.
2. **Retry idempotency (OQ-2).** Pick either:
   - a deterministic `valid_until` derived from `as_of_date` + `valid_days` (small, analysis-only), plus an `@AC`
     asserting a lost-response retry is deduplicated by ingest, or
   - acceptance of the rare double row, plus an `@AC` documenting it.

   Ingest code stays unchanged in either case.
3. **Failed-chunk accounting (D-57, FR-4).**
   - `_paced_fetch` collects failed-chunk symbols.
   - The caller adds them to `deferred`.
   - Status precedence is `partial` > `budget_deferred` > `completed`.
   - The warning text is corrected.
   - Tests: AC-4 (60 symbols, first chunk fails) and AC-6 (120 symbols, budget 2 → `partial`, deferred 70,
     symbols_processed 50).
4. **Docs and proto comment.**
   - Edit the `analysis.proto:564` comment and run `./scripts/buf-gen.sh`.
   - Update analysis `CLAUDE.md:122-123` and `docs/runbooks/mcp-tools.md:845`.
   - Run the teardown context audit (root CLAUDE.md § Teardown).

Recommended design depth: **quick** is defensible if OQ-1 picks option one and OQ-2 stays analysis-side (no migration,
ingest read-only). Keep **full** if design adds a state column or moves idempotency into ingest.
