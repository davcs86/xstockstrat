# Design: cross-stock-score-derivation

**Created**: 2026-07-12
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-07-13
**Grounded in**: recon.md

---

## Chosen Approach

### Evidence cells with executed-definition fingerprints

Per-symbol evidence cells are captured inside `RunBacktest`'s loop at the point where
`trades`/`daily_eq` are still per-symbol (recon.md § Codebase Map, `servicer.py:298-300`):
`m = _compute_metrics(daily_eq, trades, daily_eq[0])` — the symbol's own seed equity, because
equity compounds sequentially across symbols (`servicer.py:261-262`, `:272`, `:283`; curves
seeded at `:519`/`:713`) — with `trading_days = len(daily_eq) - 1` (the `_compute_metrics`
convention, `servicer.py:1378`) and `total_trades = len(trades)`. Cells are buffered and
flushed only when the run's status is `BACKTEST_STATUS_OK` (`servicer.py:349-352`);
`_InsufficientData`/errored symbols already `continue` past the capture point
(`servicer.py:301-325`). **Zero-trade cells are persisted AND count as evidence** (user
decision): with the existing component math they score ≈0.30 (sharpe 0, win-rate 0,
drawdown 1.0) — non-participation is cross-stock evidence of non-generalization.

Every cell carries a `definition_fingerprint TEXT NULL` — the identity of the definition the
run **executed**:

- Module-level `_definition_fingerprint(definition_json) -> str`: sha256 of
  `json.dumps(core, sort_keys=True, separators=(",", ":"))` where `core` drops the
  non-behavioral keys `{display_name, active, live_enabled}` (exactly the
  column-authoritative fields — `servicer.py:1332-1337`), so renames and live-toggles never
  reset evidence.
- The hash is **always computed from a DB-returned `analysis.strategies` row's
  `definition_json`** (post-`_to_dict` decode, `strategies.py:14-24`), never from a request
  proto — both write paths (`create`/`update`) serialize via
  `MessageToDict(..., preserving_proto_field_name=True)` (`servicer.py:993-995`,
  `:1002-1004`), so per-row self-consistency is structural.
- Stamped on a run's cells iff the `strategy_id_ref` branch resolved a repo row
  (`servicer.py:219-232`) AND `request.strategy_id == request.strategy_id_ref`. Otherwise
  NULL: inline-definition runs (deterministically — never hash a pre-storage dict),
  legacy-SMA fallback, id-mismatch, unregistered ids. NULL can never match an eligibility
  hash — inline forgery, wrong-engine evidence, and the mid-run-UPDATE race are all
  structurally closed.

### Storage — migration 007

`services/xstockstrat-analysis/migrations/007_backtest_run_symbols.{up,down}.sql` (next after
006 — recon.md § Dependencies):

- `CREATE TABLE analysis.backtest_run_symbols`: `backtest_id`, `strategy_id NOT NULL`,
  `symbol`, `sharpe_ratio`/`max_drawdown`/`win_rate`/`total_return` (double), `total_trades`
  int, `trading_days` int, `definition_fingerprint TEXT NULL`, `range_start`/`range_end`
  TIMESTAMPTZ NULL, `completed_at TIMESTAMPTZ DEFAULT NOW()`; PK `(backtest_id, symbol)`;
  index `(strategy_id, definition_fingerprint, symbol, (total_trades > 0) DESC,
  trading_days DESC, completed_at DESC)` serving the eligibility read below.
- `ALTER analysis.backtest_runs ADD range_start/range_end TIMESTAMPTZ NULL` (schema at
  `006_backtest_runs.up.sql:5-21`; pre-existing rows stay valid).
- `ALTER analysis.strategy_scores ADD n_symbols INT NOT NULL DEFAULT 0,
  total_trading_days INT NOT NULL DEFAULT 0, provisional BOOL NOT NULL DEFAULT FALSE`
  (defaults keep existing rows hydrating — `005_strategy_scores.up.sql:1-8`).
- **No `analysis.strategies` ALTER** (the round-1 `definition_updated_at` column is deleted
  by the fingerprint model). Down: drop table + drop the five added columns.

### Eligibility read and dedup (traded-first)

New `BacktestRunSymbolsRepository` (style mirror of `backtest_runs.py:19-73`; `insert_many`
with ON CONFLICT DO NOTHING, `fetch_eligible`, `_to_dict`):

```sql
SELECT DISTINCT ON (symbol) * FROM analysis.backtest_run_symbols
WHERE strategy_id = $1 AND definition_fingerprint = $2
ORDER BY symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC
```

One cell per symbol; **traded cells always outrank zero-trade cells** (user decision c2), then
most trading days, then newest — a long no-fire window can never shadow a shorter traded one;
zero-trade evidence stands only for symbols where the definition has never traded.

### Scoring core and aggregation

Extract module-level `_score_from_metrics(metrics, w_s, w_d, w_w) -> (overall, components)`
and `_grade(overall) -> str` from `_score_from_result` (`servicer.py:1234`; clamps
`:1246-1248`, blend `:1250`, thresholds `:1256-1265`); `_score_from_result` keeps its exact
signature and delegates — callers `:370`/`:849` and their tests stay green (ledger insight
2026-07-08 sibling pattern). New pure `_aggregate_cells(scored_cells, k)`:
`headline = (Σ wᵢ·sᵢ + 0.5k)/(Σwᵢ + k)` with `wᵢ = trading_days`; **components shrunk
identically with weights renormalized `wᵢ/Σw` inside the aggregator** (user decision) so
displayed components always reconcile with the grade; non-finite components filtered
(`servicer.py:893` precedent); `Σw == 0` → treated as zero evidence (clear path), never
equal-weights. Config: `analysis.scoring.shrinkage_days` (250),
`min_evidence_symbols` (3), `min_evidence_days` (500) via the `get_float`/`get_int` fallback
pattern (`servicer.py:367-369`) — no seed migration (recon.md § Dependencies precedent);
the `get_int` zero-trap (`watcher.py:68`) is documented, not fought.
`provisional = n_symbols < floor_s OR total_days < floor_d`.

### Recompute orchestration

One private `_recompute_headline(strategy_id, *, strategy_row=None)` + inner
`_recompute_headline_locked` guarded by per-strategy `asyncio.Lock`s. **The strategy row is
resolved before entering the lock path** (no lock-dict leak from ad-hoc ids), and trigger
sites that already hold the lock call the **inner** variant only (non-reentrant
`asyncio.Lock` — a no-deadlock regression test is mandatory). Flow: unregistered → None
(no headline, no write — OQ-3); compute current fingerprint; `fetch_eligible`; empty →
in-memory `pop` + `StrategyScoresRepository.delete` (new method), return None; else
aggregate → `StrategyScore` with provenance fields → `_persist_strategy_score`
(`servicer.py:881`, extended upsert with the three provenance columns; `hydrate_scores`/
`_row_to_score` `:930`/`:1312` round-trip them, with `.get(..., default)` tolerance for
pre-007 rows).

Triggers:

- **`RunBacktest`**: per-run `_score_from_result` kept for the history row only; the
  headline upsert at `servicer.py:373` is **deleted**. After cells flush +
  `_persist_backtest_run` (extended with `range_start/range_end`, always set post-defaulting
  `:250-258`), call the recompute best-effort (`try/except log.warning`), OK-status-gated,
  ordered **before** the unguarded ledger emit at `:387`.
- **`ManageStrategy UPDATE`** (`servicer.py:1000-1014`): after the repo update succeeds,
  under the lock: **unconditional in-memory `pop` first**, then best-effort recompute with
  `strategy_row=row` (RETURNING * — `strategies.py:57-67`). The UPDATE never fails on
  recompute error; paired test: clears in-memory even with a failing scores repo.
- **`ScoreStrategy`** (`servicer.py:830`) repurposed: drop the `self._backtests` read
  (`:841-847`); `_strategies_repo is None` → UNAVAILABLE (parity `:984-986`); unregistered →
  NOT_FOUND "strategy not registered"; cells read failure → UNAVAILABLE with **no state
  mutation before the abort**; zero eligible cells → clear (pop + **non-best-effort DB
  delete** — user-initiated RPC surfaces the error, closing the zombie-grade-via-hydrate
  hole), then NOT_FOUND "no eligible evidence — run a backtest"; else derive, persist,
  guarded ledger emit (`:866-877`), return. `ScoreStrategyRequest.range` is documented as
  ignored under the new semantics.

### Proto (additive only)

`StrategyScore` gains `int32 evidence_symbols = 5; int32 evidence_days = 6;
bool provisional = 7;` (fields 1–4 — recon.md § Codebase Map). `BacktestRunSummary` gains
`google.protobuf.Timestamp range_start = 15; range_end = 16` (precedent `:173`).
`buf lint`/`buf breaking` + `./scripts/buf-gen.sh` (C-09).

### Callers — UI and MCP agent both send `strategy_id_ref`

- **UI**: `[id]/page.tsx:80-86` adds `strategyIdRef: id` — UI runs now execute the registered
  composable definition via `_backtest_symbol_evaluated` (`servicer.py:271-281`) instead of
  silently falling back to legacy SMA, and earn fingerprinted evidence. Bogus direct-URL ids
  get NOT_FOUND surfaced via existing `runError` handling (`page.tsx:70-73`). Mock backend
  ignores extra fields (`mock-backend.ts:431`); add an assertion the request carries
  `strategyIdRef === strategyId`.
- **MCP agent** (in scope — user decision): `services/xstockstrat-agent/app/client.py:148-153`
  adds `strategy_id_ref=strategy_id` (+ test + tool-doc line), killing the two-callers
  divergence (fails.md 2026-07-01 / C-10(b) shape) at birth.

### UI display

- Shared `src/lib/scoreDisplay.ts`: `ratingVariant`/`scoreColor` de-duplicated from
  `strategies/page.tsx:15,:22` and `insights/page.tsx:219` (recon.md third-render-site
  finding), plus `formatSymbolYears` with a named `TRADING_DAYS_PER_YEAR = 252` constant
  commented as mirroring the Python source (`servicer.py:1379`).
- Detail score card title → **"Strategy Grade"** + evidence caption ("Derived from N symbols
  · X symbol-years — individual runs are graded separately"); Past Runs header → **"Run
  score"** + Range column with a placeholder for NULL legacy rows; provisional →
  `Badge variant="secondary"` (`strategies/page.tsx:90` precedent) on **all three surfaces**
  including the dashboard (C-10).
- Cleared-state handling: `useStrategyReport` gains a retry predicate skipping
  `Code.NotFound`; the detail page renders an explicit "Strategy Grade" empty-state card
  when the report is NOT_FOUND/absent (post-clear this is a common state —
  `servicer.py:948-953`), with the form and Past Runs untouched.
- E2E: replace the `getByText('Strategy Score')` assertion
  (`backtest-coverage.spec.ts:52`) with the both-labels test (OQ-5); extend fixtures
  (`mock-backend.ts:398-424`, `:497-512`, `:513-553`) and dashboard specs with the new
  fields + provisional assertions; new cleared-state case.

### Docs

`services/xstockstrat-analysis/CLAUDE.md`: config-key table (three new keys), scoring section
(derivation, fingerprint classes incl. the entry/exit-rule string-canonicalization
sensitivity, OQ-1 calibration anchors, OQ-4 staleness — `ScoreStrategy` is the manual
refresh, OQ-6 correlated-breadth caveat, `get_int` zero-trap, the
`analysis.strategy.scored` event staying ScoreStrategy-only, `backtest_run_symbols` retention
gap). Ledger-events table updated. Root `CLAUDE.md` config-key registry entry.

### Deploy ordering

Migration 007 must apply before the service change deploys (the extended upsert references
the new columns); the DO `db-migrator` PRE_DEPLOY job handles this, but the spec orders the
migration step before service steps explicitly.

## Rejected Alternatives

- **Timestamp eligibility (`completed_at > strategies.updated_at`, FR-2a literal)** —
  rejected: `set_live_enabled`/`deactivate` also bump `updated_at` (`strategies.py:74`,
  `:87`), wiping evidence on routine toggles; and it leaves wrong-engine UI evidence, inline
  forgery, and the mid-run-UPDATE race open (round-1 blocking finding B1).
- **New `definition_updated_at` column (round-1 proposer)** — rejected: closes the toggle
  trap but none of the three B1 vectors; the fingerprint subsumes it with no strategies
  ALTER and no clock semantics.
- **`definition_version` counter (FR-3 literal, no revert-resurrection)** — rejected by user
  sign-off: evidence describes a definition's content, not a timeline; reverting to a
  previously-tested definition legitimately restores its evidence base. Costs a strategies
  ALTER and forfeits resurrection.
- **Zero-trade cells excluded from evidence (round-2 proposer)** — rejected by user decision:
  non-participation is cross-stock evidence of non-generalization; the traded-first dedup
  clause removes the shadowing hazard that made exclusion attractive.
- **Zero-trade cells scored neutral (0.5) / down-weighted** — rejected: extra bookkeeping,
  blurs what `n_symbols` provenance means.
- **Pure-prior (0.5/C) response from `ScoreStrategy` on zero cells** — rejected: erases the
  "Not scored yet" state and contradicts FR-3's cleared-on-UPDATE semantics.
- **Unshrunk component scores** — rejected: headline would not equal the blend of displayed
  components; users couldn't reconcile the grade.
- **Equal-weights fallback when Σw == 0** — rejected: zero-day evidence must not mint a grade.
- **SQL-side shrinkage aggregation** — rejected: per-strategy cell counts are small; the pure
  Python aggregator is unit-testable against OQ-1's closed-form anchors.
- **Hashing `inline_definition` payloads for honest inline runs** — rejected: pre-storage
  dicts canonicalize differently from DB rows; matches would be unpredictable. Inline is
  deterministically NULL.
- **Fingerprint stored once on `backtest_runs` + join** — rejected: keeps the eligibility
  read a single-table `DISTINCT ON` served by one index.
- **Agent parity out of scope** — rejected by user decision: one line + test now beats a
  documented second-class caller (fails.md C-10(b) shape).
- **Recompute-all at boot** — rejected at OQ-4 (product spec); hydrate stays as-is.

## Open Risks

- [ ] **Fingerprint canonicalization sensitivity**: `entry_rule`/`exit_rule` are JSON-encoded
  strings inside `definition_json` — a client that parses-and-re-stringifies turns a no-op
  save into an evidence reset (spurious reset, never a false match; visible and recoverable).
  Mitigate with fingerprint-stability unit tests (create → get_by_id → hash == post-no-op
  -update hash; rename-stable; rule-change-differs; NULL classes) — target: service-cells step.
- [ ] **Correlated-symbol breadth inflation** (OQ-6, accepted): revisit trigger is misleading
  observed rankings; successor is sector-capped weights via feature-059 sector data — target:
  post-launch observation, not this feature.
- [ ] **Zero-trade grade semantics are a visible behavior shift**: a strategy that trades
  nowhere now grades ≈F once run broadly (previously last-run-wins could show anything).
  Document in the service CLAUDE.md scoring section — target: docs step.
- [ ] **`backtest_run_symbols` retention** (one row per symbol per run, NULL-fingerprint rows
  are evidence-dead): documented out-of-scope gap alongside the existing `strategy_scores`
  one — target: docs step.
- [ ] **Concurrent-runs last-writer staleness** is closed by the per-strategy lock only
  within one process (the service is single-process asyncio; fine today) — note in docs.

## Constitution Rules Touched

- `C-01` — honored: every design claim above cites recon.md-verified `path:line`; both
  debate agents spot-verified anchors (`:298-300`, `:373`, `:387`, proto 5/15, migrations).
- `C-02` — honored: context.md read at boot; decisions recorded there as they happened.
- `C-04` — honored: new proto fields are plain scalars/Timestamps (no closed string sets);
  `rating` stays a string (pre-existing surface, unchanged).
- `C-05` — honored: three new keys follow `<service>.<category>.<key>` under the existing
  `analysis.scoring` category; declared in service + root CLAUDE.md; no secrets involved.
- `C-07` — honored: migration is `007_backtest_run_symbols.{up,down}.sql`, next in sequence.
- `C-08`/`P-06` — honored: every service step pairs tests (fingerprint stability, DISTINCT ON
  SQL via mock-pool pattern, shrinkage anchors from OQ-1, Σw==0, UPDATE-clears-with-failing-
  repo, ScoreStrategy no-mutation-before-abort, no-deadlock regression, hydrate tolerance for
  pre-007 rows); red-before-green at execute time.
- `C-09` — honored: proto step runs `buf lint`/`buf breaking` + `./scripts/buf-gen.sh` with
  committed stubs.
- `C-10` — honored: (b)-analog closed twice — run-score vs strategy-grade divergence by
  labeling + both-labels e2e; caller divergence by fingerprint + UI/agent `strategy_id_ref`
  parity; shared `scoreDisplay.ts` + provisional treatment across all three render surfaces
  with fixture/spec updates. (a) nav N/A (no new route); (c) seeded-resource N/A.
- `C-11` — honored: this design phase is the mandated grounding; full 2-round debate run.
- `P-01`/`P-02` — honored: orchestrator-only writes; proposer/adversary mediated, never saw
  each other's raw output.
- `P-03`/`P-04` — honored: all deviations user-signed (see context.md): FR-2a fingerprint
  eligibility; FR-3 rename-no-reset AND revert-resurrection; side-effectful NOT_FOUND;
  zero-trade cells counted (traded-first dedup); agent client in scope (Affected Services
  amended); `analysis.strategy.scored` event asymmetry.
- `P-05` — honored: context.md updated per session/decision.
- `F-01` — honored: all schema changes in new migration 007; nothing applied is edited.
- `F-02`/`F-03` — honored: work flows via the feature branch and PRs only.
- `F-04` — honored: unfound items stayed in recon "Risks / Not-found"; nothing invented.
- `F-06` — honored: no new pool; existing asyncpg pool reused (budget stays 2).
- `F-07` — honored: all tunables via ConfigWatcher with code fallbacks (no hardcoded values;
  the 252 UI constant is a display-formatting mirror of an existing engine constant, not a
  config value).
- `F-11` — honored: no Floor breach was flagged in either round.
