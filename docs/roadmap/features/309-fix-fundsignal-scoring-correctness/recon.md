# Recon: fix-fundsignal-scoring-correctness

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached at origin/main-dev@c4fd48b0a (no `origin/feature/fix-fundsignal-scoring-correctness` yet; recon digests were UNSTAMPED, and the cited lines below were re-grepped on this tree)
**Affected services**: xstockstrat-analysis, xstockstrat-ingest, xstockstrat-indicators (consumer surfaces: `/insights/opportunities` in xstockstrat-ui, MCP `list_opportunities` in xstockstrat-agent)

---

## Objective

This feature closes four SEV-2 residuals of feature 246 on the fundamentals-signal pipeline (producer → ingest → scorer). The four fixes:

- The formula-path producer stops sending absent metrics as proto3 wire zeros.
- A lone or tiny scored cross-section no longer always maps to `buy`.
- An explicit conviction of 0.0 is scored as 0.0, not as neutral 0.5.
- Fabricated 0.5-conviction `system` fundamentals signals stored before 246 for data-less symbols are expired in every environment.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Producer loop `run_once`, score → direction → emit:
    - `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:275-282`: `buy_q`/`sell_q`/`min_conv` reads, `_map_directions(..., reference_scores=[v for v in prior.values() if v is not None])`, `valid_days = int_positive(...)`.
    - Min-conviction gate at `:290` (`if score < min_conv: continue`).
    - Claim insert into `analysis.fundsignal_emitted` at `:293-305`.
    - `_emit_signal(...)` at `:310`.
  - `prior` comes from `_already_emitted(source_slug, as_of_date)` at `fundsignal_loop.py:263`. The force path (`:256-261`) deletes the day's claims, so a force run has no reference scores.
  - Built-in scorer `_builtin_score` at `fundsignal_loop.py:533-550`. It skips each metric in `f.missing_metrics` and returns `None` when no parts remain. It does not score `dividend_yield`.
  - Formula scorer `_score_via_formula` at `fundsignal_loop.py:565-589`:
    - The input dict is built from raw proto3 scalars (`:571-578`), so all six keys are always present.
    - Only the all-missing case is skipped (`:579`, `set(f.missing_metrics).issuperset(fundamentals)`).
    - The composite is read with `scores.get("composite", 0.0)` (`:586`).
  - Direction mapping:
    - `_map_directions` at `fundsignal_loop.py:591-608`: `s >= buy_cut` is tested before `s <= sell_cut`, so when `buy_cut == sell_cut` the result is `buy`.
    - Nearest-rank `_quantile` at `fundsignal_loop.py:793-802` (`idx = int(round(q * (len(sorted_values) - 1)))`).
  - Formula call helper `score_fundamentals` at `services/xstockstrat-analysis/app/services/fundamentals_scoring.py:19`. Only raw fundamentals go in `input_data` (comment `:45`). It returns `out.get("composite", 0.0)` at `:71`.
  - Signal scorer `compute_signal_score` at `services/xstockstrat-analysis/app/services/scoring.py:10`. The defect is at `:31`, `conviction = sig.conviction if sig.conviction > 0 else 0.5`. `return 0.5` at `:15` (no signals map) and after the loop on `count == 0` are separate neutral returns and are not part of this defect. Callers: screener and backtest.
  - Other conviction consumers that already treat `sig.conviction` literally, with no 0.5 substitution:
    - `servicer.py:5029-5030` (best raw conviction)
    - `servicer.py:5518`, `:5556` and `:5573-5574` (opportunity thesis/direction)
    - `servicer.py:6749` (`effective_conviction = sig.conviction * source_weight * decay_multiplier`)
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). None of the four fixes is expected to need an analysis migration.
  - Config-read pattern: `self._cfg.get_float("fundsignal.buy_quantile", default=0.80)` at `fundsignal_loop.py:275` and `int_positive(self._cfg, "fundsignal.valid_days", 90)` at `:282`.
- **`xstockstrat-ingest`** (Python)
  - Handler `_ingest_external_signal` in `services/xstockstrat-ingest/app/handlers/servicer.py`:
    - Range check `0.0 <= signal.conviction <= 1.0` at `:1035`. The comment at `:1033-1034` documents "0.0 passes and is stored as NULL".
    - Write sentinel at `:1055`: `conviction = signal.conviction if signal.conviction > 0.0 else None`.
    - The same value is bound into the `newsletter_signals` INSERT and the `signal_dedup_claims` upsert. Dedup identity uses `conviction IS DISTINCT FROM EXCLUDED.conviction` (around `:1088-1112`, per digest).
  - Read-back in `QuerySignals`: SQL starts around `servicer.py:1275`. The read-back sentinel is at `:1302`: `conviction=float(row["conviction"]) if row["conviction"] is not None else 0.0`.
  - Grants and ownership: `_SYSTEM_GRANTS` at `servicer.py:108` and `_resolve_owner` at `:370` (per digest). `system` rows are written only by analysis, with the `analysis-fundsignal` grant and the mTLS SAN.
  - Invariant INGEST-4 at `services/xstockstrat-ingest/docs/context-constitution.md:23` says "`0.0`/`0` mean "unset" for `conviction` on both write and read". It must be rewritten if the sentinel changes.
  - Storage: `ingest.newsletter_signals.conviction NUMERIC(4,3) CHECK (conviction BETWEEN 0 AND 1)` is nullable (`migrations/001_newsletter_signals.up.sql:14`). The dedup table conviction is `NUMERIC(4,3)` (`009_signal_dedup_keys.up.sql:14`, `013_signal_ownership_templates.up.sql:93`). Storing 0.0 needs no schema change.
  - Last migration: `014_contract_signal_ownership.up.sql` (`services/xstockstrat-ingest/migrations/`).
  - Ingest has no fundamentals table, so the data-less predicate for report 4 cannot be evaluated in ingest SQL. The marketdata fundamentals cache is a separate service and database.
- **`xstockstrat-indicators`** (Python)
  - Formula `value_quality` at `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py`:
    - `_get(key)` returns `None` for a missing or `None` key (`:91-98`).
    - Each metric is scored only when present: `pb` at `:143-146` (`_lin(pb, pb_good=1.0, pb_bad=5.0)`), `de` at `:171-174` (`_lin(de, de_good=0.3, de_bad=2.0)`), `eps` at `:176-178`.
    - The empty-part sub-score is neutral 0.5 (`quality_sub` at `:180`, `value_sub` at `:162` per digest).
  - The formula is already correct for honest input. A 1.0 for pb/de comes only from the caller sending 0.0. **No indicators code change is expected.**
  - Seeding: idempotent via `app/services/seed_formulas.py`. Formula id `d1ff5e6b-6d9c-589d-b95e-defd862c702b` (UUIDv5, per the indicators CLAUDE.md).
  - Last migration: `007_private_formulas_templates` (not needed).

## Patterns to REUSE

- Omit absent metrics from the formula input → reuse `_builtin_score`'s `missing = set(f.missing_metrics)` / `if "<m>" not in missing` guard (`fundsignal_loop.py:533-550`). This matches the strategy-path omit-absent contract at `services/xstockstrat-analysis/app/services/evaluator.py:586-588`. Build the dict from present keys only; the existing `issuperset` skip at `:579` becomes "dict is empty → unscored". Absence is keyed on `missing_metrics`, never on a zero value (246 @AC-2: a real `roe` 0.0 is scored).
- Day-wide reference set for direction cuts → keep the 260 `reference_scores` fold (`fundsignal_loop.py:278`, `:595`). Any minimum-size or floor rule must count the folded set, not only the run's own scores (fails.md 2026-11-04 fix-fundsignal-emit-accounting, "reference set from the persisted full population").
- New tunables → seed in a config migration following `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:37-47` (namespace `analysis`, key `fundsignal.<key>`, one row each for dev and production). Add the reader-catalog row in the style of `041_heal_config_keys_to_reader_catalog.up.sql:63-76`. Read with `get_float` or `int_positive` like `fundsignal_loop.py:275-282`. Also add a row in the analysis CLAUDE.md key table and the Per-Feature Registered Keys log in `docs/patterns/config-governance.md`.
- Explicit-presence proto scalar → `optional double reliability_weight = 12;` on `SignalSource` (`packages/proto/ingest/v1/ingest.proto:184-187`; its comment explains explicit 0.0 vs omitted). It is the in-file precedent if `ExternalSignal.conviction` (`ingest.proto:127`, plain `double conviction = 4`) gains presence. The next free field number on `ExternalSignal` is 12, after `user_id = 11`. Changing field 4 in place to `optional` keeps the wire number.
- Regression test homes:
  - `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`: `test_quantile_buckets` `:250`, `test_ac3_formula_all_missing_skipped_partial_scored` `:949`, `test_ac9_one_symbol_retry_keeps_day_wide_direction` `:1353`, `test_map_directions_reference_scores_set_the_cuts` `:1366`.
  - `tests/test_analysis_helpers.py` and `tests/test_screener.py` (`compute_signal_score`).
  - `services/xstockstrat-ingest/tests/test_ingest_servicer.py`: F-9 conviction range tests from `:1429`, dedup tests at `:1047`/`:1144`. No test exercises a stored 0.0 today.
  - `services/xstockstrat-indicators/tests/test_fundamentals_formula.py`: `test_missing_dividend_is_neutral_not_zeroing` `:90`.
  - Run with `uv sync --extra dev && uv run pytest`. Analysis real-PG uses `-m real_pg`.

## Existing Business Rules (preserve / extend)

- **CHANGE** `@AC-8 @FR-5 @FR-6 @feature-201` "On a partial fundamentals row the strategy omits absent metrics (does not penalize) and diverges from the producer" (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature:47-53`). The producer now also omits absent metrics, so the strategy composite **matches** the producer. **Signed off 2026-11-10** (context.md, "operator decisions before /sdd-design"). Carry into design.md.
- **CHANGE (unflagged in product-spec; needs its own sign-off)** `@AC-3 @FR-3 @regression @feature-246` "Under a scoring formula, an all-missing row is skipped and a partial row is still scored" (`services/xstockstrat-analysis/acceptance/fix-fundsignal-neutral-score.feature:36-44`). Its Then step, "ExecuteFormula is called exactly once ... with dividend_yield 0.013 and pe_ratio 0.0", contradicts new AC-1: the input becomes dividend_yield only. The all-missing-skipped and DIVONLY-emitted clauses stay PRESERVE. The 2026-11-10 sign-off names only 201 @AC-8. Changing this one without its own sign-off in context.md is a silent C-16 regression.
- **PRESERVE** `@AC-4 @FR-5 @feature-201` "One formula, identical I/O in the producer and in a strategy — fully-populated rows" (`analysis/acceptance/fundamentals-formula-inputs.feature:33`). The full-row parity guarantee stands. Its "partial-row case diverges" comment goes stale and should be edited with the @AC-8 rewrite.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-246` "A metric reported as zero is scored, not treated as absent" (`analysis/acceptance/fix-fundsignal-neutral-score.feature:26`). A real 0.0 is present (ZRO conviction 0.30).
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-246` "Symbols with no usable fundamentals are not scored, ranked or emitted" (`fix-fundsignal-neutral-score.feature:14`). The direction fix must not re-admit unscored symbols into the cross-section.
- **PRESERVE** `@AC-9 @FR-1 @feature-260` "A one-symbol retry keeps the day's cross-sectional direction" (`analysis/acceptance/fix-fundsignal-emit-accounting.feature:85-96`). With 3 stored scores (0.90/0.70/0.50) plus AAPL 0.10 at 0.80/0.20, AAPL must still be `sell`. A minimum cross-section size larger than 4, or one counted over the run's own scores only, breaks this vector.
- **PRESERVE** `@AC-8 @FR-1 @FR-2 @feature-260` "A non-force retry after a lost IngestSignal response resends the same signal and counts the dedup" (`fix-fundsignal-emit-accounting.feature:70`). Direction and conviction stay deterministic on retry.
- **PRESERVE** `@AC-10 @FR-1 @feature-260` "A force run re-emits with a validity anchored at the run time, not the run date" (`fix-fundsignal-emit-accounting.feature:98`).
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-260` and `@AC-7 @FR-1 @regression @feature-260` (`fix-fundsignal-emit-accounting.feature:9`, `:62`). The claim/confirm flow must not be disturbed.
- **PRESERVE** `@AC-2 @regression @feature-160` "compute_signal_score reads the bar time from the correct proto field" (`analysis/acceptance/fix-signal-screen-crash.feature:14`).
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-245` "One symbol's non-RPC failure degrades only that symbol's row" (`analysis/acceptance/fix-screener-symbol-isolation.feature:5`). No new raise path out of the scorer.
- **PRESERVE** `@AC-6 @FR-3 @feature-224` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature:263`). Identity and formula contract are unchanged.
- **PRESERVE** `@AC-26 @FR-6 @feature-224` "System-owned fundamentals signals are visible to every user" (`platform.feature:297`). Retraction only expires rows; it does not change ownership or visibility of live signals.
- **PRESERVE** `@AC-36 @FR-4 @feature-224` "System slugs are reserved in both directions" (`platform.feature:319`).
- **PRESERVE** `@AC-23 @FR-11 @feature-224` "System special-cases are unchanged" (`platform.feature:290`). This applies only if value_quality is edited; the system formula stays API-immutable.
- **PRESERVE** `@AC-7 @FR-6 @feature-205` "An authored fundamentals formula behaves identically as a strategy component" (`platform.feature:208`). Omit-absent strengthens it.
- **EXTEND (only if a new `fundsignal.*` key is added)** `@AC-6 @FR-3 @regression @feature-244` "A trap-dependent site keeps the coded default for a stored zero" (`platform.feature:485`). A minimum-size or buy-floor key needs an explicit stored-zero decision.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-244` "A stored zero is honoured by the Python config getters" (`platform.feature:449`). `min_conviction_to_emit` 0.0 stays honoured.
- **PRESERVE** `@AC-9 @FR-5 @feature-224` "Ingested signals belong to the source owner and dedup per owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature:21`).
- **PRESERVE** `@AC-33 @FR-6 @feature-224` "A user cannot write as the system owner" (`ingest/acceptance/private-by-default-templates.feature:40`). Retraction is operator SQL or a migration, never a new RPC.
- **PRESERVE** (tag line not read) the mcp_client conviction pass-through, item 0.72 → ExternalSignal 0.72 (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature:34`). Regular convictions must round-trip unchanged under any `optional` or sentinel change.
- **EXTEND** the new feature AC-1..AC-4 (`acceptance.feature`), promoted at launch alongside the suites above.
- No existing acceptance rule for xstockstrat-indicators pins `value_quality` absent-key or pb/de band semantics (`services/xstockstrat-indicators/acceptance/` scanned).

## Dependencies

- Proto/RPC: **possibly** `ExternalSignal.conviction` (`packages/proto/ingest/v1/ingest.proto:127`, `double conviction = 4`) → `optional double conviction = 4` (field presence).
  - `buf breaking` must classify it. Proto3 `optional` on an existing scalar is wire-compatible but changes generated accessors, and the `HasField` semantics differ by language.
  - Needs `./scripts/buf-gen.sh` and the proto-freshness gate.
  - The `ingest.proto:141` dedup-key comment names `conviction`.
  - Reports 1, 2 and 4 need no proto change.
- Migration:
  - ingest next number **`015`** (`services/xstockstrat-ingest/migrations/`), only if report 4 retraction becomes a numbered data migration and/or a NULL-conviction backfill is chosen.
  - config next **`048`** (`services/xstockstrat-config/migrations/`), only if a new `fundsignal.*` key is added.
  - analysis next `028` and indicators next `008`: not expected.
  - Overlap: feature 318 (`fix-migration-tooling-safety`) touches the ingest migrations dir. Its product-spec lists ingest 001/004/010 replay exposure, which is an ordering gate.
- Config keys:
  - Existing:
    - `analysis.fundsignal.buy_quantile` (0.80)
    - `analysis.fundsignal.sell_quantile` (0.20)
    - `analysis.fundsignal.min_conviction_to_emit` (0.0)
    - `analysis.fundsignal.valid_days` (90)
    - `analysis.fundsignal.scoring_formula_id` ('')
    - All five are seeded in `008_analysis_fundsignal_keys.up.sql:34-47`.
  - Candidate new (OQ2): a minimum cross-section size and/or an absolute buy floor. **No such key exists today.**
- Inter-service edges, all existing, none new:
  - analysis → indicators `ExecuteFormula`/`GetFormula`, as `x-user-id: system` with `x-internal-caller: analysis-fundsignal` and SAN `xstockstrat-analysis`
  - analysis → ingest `IngestSignal`/`QuerySignals`
  - analysis → marketdata fundamentals (cached)
  - Report 4's data-less check needs the marketdata fundamentals cache. That is cross-database, so ingest SQL alone cannot evaluate it.
- New env vars / ports: none.

## Risks / Not-found

- **Unflagged C-16 CHANGE**: 246 @AC-3 (`fix-fundsignal-neutral-score.feature:42`) and the analysis CLAUDE.md "Unscored symbols (feature 246)" paragraph (`services/xstockstrat-analysis/CLAUDE.md:145`) both pin the wire-zero `pe_ratio 0.0` input. The `CLAUDE.md:404` "partial-row case diverges by design" line is stale too. Get an operator sign-off for 246 @AC-3 before `/sdd-spec`.
- **Direction rule vs 260 @AC-9**: the minimum size must count `reference_scores` and be ≤ 4, or the floor must be absolute and still leave AAPL 0.10 = `sell`.
  - A force run clears `prior` (`fundsignal_loop.py:256-261`), so its first run is the true lone-symbol case.
  - A lone *high* score: the design must decide what it is (buy via floor, or hold).
  - Decide what happens when `buy_cut == sell_cut` (tie order at `:602`).
  - Ledger fails.md (2026-11-04, fix-fundsignal-emit-accounting) names this defect as the first-run variant of a fourth-recurrence pattern and flags it as a Constitution-ID candidate.
- **Conviction sentinel (OQ3)**:
  - Options: proto `optional` + store 0.0 + read NULL as "not given", or keep the plain double and change only the analysis scorer.
  - Changing the write at `servicer.py:1055` changes dedup identity: a stored `0` is `IS DISTINCT FROM` a legacy NULL, so a resubmitted 0.0 after a NULL row counts as a new signal.
  - Legacy NULL rows (pre-fix 0.0 and true "not given") cannot be told apart, so the design needs an explicit interpretation.
  - The other analysis consumers (`servicer.py:5029`, `:5556`, `:6749`) already read 0.0 literally. Only `scoring.py:31` substitutes.
  - Agent and UI conviction readers (`services/xstockstrat-agent/app/tools.py`, `client.py`; ui `useOpportunities.ts` etc.) were not inspected for a 0.0 = unknown assumption.
- **Retraction (OQ4/5/6)**:
  - No existing RPC, script or migration expires `system` signals (searched migrations only; digest).
  - Approved in principle (context.md 2026-11-10). Still open:
    - mechanism: operator SQL vs migration `015` across every environment
    - how the candidate symbols are confirmed data-less (operator-supplied list vs marketdata cache lookup)
    - whether `ListOpportunities` recompute is triggered or the reader lag is accepted
  - The `valid_until` and `user_id` column semantics are taken from the spec and digest; the column set in `001` was not re-read in full.
  - `valid_until = now()` must not touch conviction or the dedup claim. Ingest dedup holds only while `valid_until` and conviction are unchanged.
  - The predicate is `conviction = 0.5`. A real computed 0.5 for a symbol with data must survive (AC-4 last step).
- **OQ5**: whether `scoring_formula_id` was ever set in any environment cannot be answered from the repo. If it was, the formula-path wire-zero rows are also retraction candidates.
- Not located or not read: the `_emit_signal` body and `valid_anchor` computation; the four defect reports themselves; the agent/UI conviction consumers; the opportunity-composite / signal_axis scenarios (does a 0.0-conviction signal now contribute 0 and shift a composite? unconfirmed).
- Ledger traps that apply:
  - fails.md "proto3 scalar zero masks absence" (201, `fails.md:2724-2726`): pin partial-row tests, don't trust "same keys".
  - fails.md `:1712-1721`: presence needs singular `optional`, not wrapper types in repeated fields.
  - fails.md 2026-11-04 stale-checkout recurrence (246): re-baseline on `origin/feature/<slug>` before debating.
  - fails.md `:2278`: an in-band sentinel is filtered by consumer floors. Relevant if a "not given" sentinel survives.

## Recommended Scope

Advisory; the grilling decides.

1. **Formula-path omit-absent** (analysis): build the `_score_via_formula` input from keys not in `missing_metrics`. An empty dict counts as unscored. Rewrite 201 @AC-8 (signed off) and 246 @AC-3 (pending sign-off), plus the analysis CLAUDE.md lines 145/404. No indicators change; add an indicators unit test pinning omitted pb/de as absent if wanted.
2. **Direction degeneracy** (analysis): add a minimum folded cross-section size and/or an absolute buy floor to `_map_directions`. If config-backed, add a config migration `048` + CLAUDE.md + registered-keys log + stored-zero decision (platform @AC-6 @feature-244). Keep 260 @AC-9.
3. **Explicit zero conviction** (analysis scorer ± ingest storage ± proto `optional`): fix `scoring.py:31`. Then decide the ingest write/read sentinel and the INGEST-4 rewrite, the dedup-identity impact and legacy NULL handling. A proto change goes in its own step with buf-gen.
4. **Retraction** (ingest data): operator SQL or ingest migration `015` expiring `user_id='system'`, `source='fundamentals'`, `conviction=0.5` rows for confirmed data-less symbols. Sequence it after feature 318's migration-tooling ordering gate, and record the DBA + ingest-owner approval in its PR.
