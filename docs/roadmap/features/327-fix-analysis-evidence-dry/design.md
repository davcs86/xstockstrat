# Design: fix-analysis-evidence-dry

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Two independent fixes inside `xstockstrat-analysis`. `xstockstrat-indicators` is only read (existing
`GetFormula`); it gets no code change. No proto, migration, config key, pool or env-var change.

**Consumer surface (C-14).** Internal-only. No UI segment or Agent tool gains or loses a field. The
observable effects reach consumers through existing RPCs: `ScoreStrategy` and the headline grade in
`ListStrategies` / `GetStrategyReport` stop aggregating pre-edit evidence, `RunBacktest` can add one
run warning, and `ScoreStrategy` gains one new UNAVAILABLE message and one new NOT_FOUND message.

**Line numbers.** `servicer.py` cites below are the ones recorded in the debate register (round-3
tree). The feature branch base (`c4fd48b0a`, recon.md "Tree") and current `origin/main-dev` differ by
a few lines (for example `_definition_fingerprint` is at `:7285` in recon and `:7333` on main-dev).
The symbol names are authoritative; `/sdd-spec` re-greps every line.

### AC-2 — entry-backfill live gate (D-1)

- `entry_backfill.run_once` replaces the re-typed literal at
  `services/xstockstrat-analysis/app/engine/entry_backfill.py:65` (recon.md Codebase Map, "Defect
  site") with `await StrategiesRepository(db_pool).list_live_enabled()`
  (`app/repositories/strategies.py:212-231`), inside the existing try/except → warning → return
  (`entry_backfill.py:63-69`).
- It never binds `LIVE_ENABLED_PREDICATE_SQL` by name (R-3): `list_live_enabled` reads the module
  global at call time (`strategies.py:19`).
- Red-first tests in `tests/test_entry_backfill.py`: capture the SQL, and monkeypatch
  `app.repositories.strategies.LIVE_ENABLED_PREDICATE_SQL` to a narrowed predicate and assert
  nothing is selected.

### AC-1 — formula-aware evidence fingerprint (D-2 to D-11)

Scope is the evidence sites only (D-3). The readiness callers (`servicer.py:4011`, `:4208`, `:4294`,
`:5257-5267`, `:6107`; recon.md Codebase Map, "The 7 call sites") stay on `_definition_fingerprint`.
Old cells are kept and simply stop matching (D-4).

1. **Pure helpers** beside `_definition_fingerprint` (`servicer.py:7285`, recon.md Codebase Map).
   - `_formula_digest(formula)`: sha256 over the D-5 BEHAVIOURAL fields of `FormulaDefinition`
     (`packages/proto/indicators/v1/indicators.proto:118-136,162-182`), DISPLAY fields excluded. A
     descriptor-walk test asserts BEHAVIOURAL ∪ DISPLAY covers every field. Pin tests: changing
     `author` or a description leaves the digest unchanged; changing `source` changes it.
   - `_evidence_fingerprint(definition_json, digests)` (D-9):
     - empty digests → byte-identical to `_definition_fingerprint` (D-2);
     - otherwise `def_hash + '.' + sha256(sorted 'fid=digest' pairs joined by ';')`.
     - Hex never contains `.`, so the two shapes cannot collide. The column is TEXT.
2. **Single read (D-6).** No new `GetFormula` resolver (R-4).
   - A `digests` out-param goes on `_formula_fundamentals` (`servicer.py:1914-1947`) and on
     `_declared_formula_warmup` / `_prefetch_formula_warmups` (`:2525-2566`; recon.md Patterns to
     REUSE, "lazy one-GetFormula-per-distinct-formula_id cache").
   - In the warmup helper the digest is written inside the `if formula_id not in cache` block
     (`:2541-2555`), because `formula_warmup_cache` is `dict[str, int]` (`:967`).
   - The fundamentals cache value becomes `_FormulaRead(metrics, digest)`. `digest` is the hex
     string, `_UNREADABLE` on NOT_FOUND / PERMISSION_DENIED (`UNREADABLE_FORMULA_CODES`,
     `app/services/evaluator.py:104`), or `None` on an outage. The return map stays
     `{fid: metrics}`.
   - Annotation-only edits at `:5067` (heal) and `:5642` (opportunities). `:2906` and `:3092-3100`
     only pass the cache through.
3. **New owner-scoped repository read**
   `BacktestRunSymbolsRepository.latest_formula_fingerprint(user_id, strategy_id, def_hash)`.
   - `SELECT definition_fingerprint FROM analysis.backtest_run_symbols WHERE user_id=$1 AND
     strategy_id=$2 AND starts_with(definition_fingerprint,$3) ORDER BY completed_at DESC LIMIT 1`,
     with `$3 = def_hash || '.'`.
   - Only the `(user_id, strategy_id)` equality prefix of the 026 index is used, then an in-memory
     sort. Document it that way; no byte-range predicate (R-8).
   - The exact-match reads `fetch_eligible` and `fetch_all_for_fingerprint`
     (`app/repositories/backtest_run_symbols.py:67,88`) are unchanged, so bare legacy cells are
     never selected (R-5 honoured).
   - A `real_pg` test covers it.
4. **`_run_backtest` (D-7, D-10, D-11).**
   - Remove the early fingerprint at `:916-924`.
   - After the formula-map build (`:986-999`), set `run_fingerprint` only when every CUSTOM_FORMULA
     fid has a real digest. Otherwise it is `None`, for an outage and for a refusal alike. A
     refusal loses nothing, because it makes every symbol FORMULA_ERROR (`evaluator.py:267-271`).
   - Append the "formula version unavailable — rerun" run warning at `:1335-1336`, for an outage
     (a `None` digest) only. A rerun cannot fix a refusal.
   - Seed a run-level cache with `_FormulaRead` for each real digest plus
     `_FormulaRead([], _UNREADABLE)` for each refused fid, and pass it as `formula_cache` into
     `_recompute_headline` at `:1409-1415` — one `GetFormula` per formula per run (C-18).
   - Branch the `:1416-1417` log on `_FormulaVersionUnknown`.
5. **`_fetch_and_aggregate` (`:2859-2915`).**
   - Bind the `formula_cache`, `failures` and meta defaults once and reuse them for
     `_exclude_refused_cells`.
   - When CUSTOM_FORMULA components exist, call `_formula_fundamentals(digests=...)` first:
     - a `None` digest raises `_FormulaVersionUnknown(_GradeInputsUnknown)` carrying `formula_id`,
       before any cell read;
     - an `_UNREADABLE` digest resolves the fingerprint through `latest_formula_fingerprint`; `None`
       there takes the existing no-evidence path, with a distinct NOT_FOUND message naming the
       unreadable formula (today `:2683-2685` says "run a backtest");
     - otherwise the fingerprint is the composite.
   - `ScoreStrategy` (`:2654-2659`) branches on the error type: gate on → the pinned
     "fundamentals availability unknown — grade unchanged"; gate off → UNAVAILABLE
     "formula version unavailable — grade unchanged".
   - All four callers are covered: `:2647` (ScoreStrategy), `:1409` (RunBacktest), `:3096` (boot
     `recompute_unscored_pairs`) and `:3391` (ManageStrategy UPDATE).
6. **ManageStrategy UPDATE guard (`:3384-3395`) — binding operator decision, 2026-11-20.**
   - Pop the in-memory grade only when `_definition_fingerprint` of the old `definition_json`
     differs from that of the new one.
   - The old JSON comes from the locked row (`current['definition_json']` in `_apply`), not from
     the earlier `pre` read (`:3316`).
   - An unchanged `def_hash` still recomputes, but an outage keeps the grade.
   - Pin test: a rename while `GetFormula` is UNAVAILABLE keeps the grade.
   - A behavioural edit during an outage still clears the grade. That is correct and is recorded
     as a limitation.
7. **Acceptance and docs.**
   - New 327 scenarios: `@AC-3` (a score-time refusal grades on the newest formula-aware evidence,
     never on pre-feature cells), `@AC-4` (gate off plus a `GetFormula` outage → UNAVAILABLE with
     the distinct message), `@AC-5` (a rename during an outage keeps the grade).
   - Amend `tests/test_grade_fundamentals_exclusion.py:501-506` to mock
     `latest_formula_fingerprint`.
   - Rewrite ANALYSIS-3 and ANALYSIS-7
     (`services/xstockstrat-analysis/docs/context-constitution.md:19,23`) and `docs/scoring.md`.
   - Record the limitations: readiness `valid_until`; the headline stays stale until the next
     recompute; a behavioural UPDATE during an outage clears the grade; a refusal grades on the
     last readable version; with mixed refused and readable formulas the newest composite is used
     as a whole; if indicators is not ready at boot, the boot recompute leaves CUSTOM_FORMULA pairs
     unscored.
   - `context.md` records OQ1/OQ2 and the operator acknowledgement of the unrecoverable refused
     population (028 template instances and the 029 blend).

**Build order.** AC-2 → helpers → `_FormulaRead` threading → repository method → `_run_backtest` →
`_fetch_and_aggregate` → UPDATE guard → owner-isolation test (`:3100`) → test_ac23 amendment →
acceptance scenarios and docs.

**Recon correction (O-24, C-07).** recon.md says the last analysis migration is `027` and the next
free number is `028`. That holds only for the feature-branch base. On `origin/main-dev`,
`028_seed_strategy_templates` and `029_seed_fundamentals_blend_strategy` exist, so any future
per-cell fallback would be `030`. This design needs no migration.

## Rejected Alternatives

- `R-1` Hash `FormulaDefinition.updated_at` into the evidence fingerprint — rejected because the seed
  upsert sets `updated_at = NOW()` on every indicators boot (`formulas_repository.py:70`), so
  fingerprints would churn on every restart.
- `R-2` Widen all 7 `_definition_fingerprint` callers (readiness included) — rejected because of
  blast radius: it forces an async resolver into the sync `:4294` caller, and readiness has its own
  validity window. The limitation is documented instead.
- `R-3` Name-bound import of `LIVE_ENABLED_PREDICATE_SQL` into `entry_backfill` — rejected because it
  freezes a copy at import time and defeats the AC-2 monkeypatch test.
- `R-4` A separate `GetFormula` digest resolver alongside the warmup prefetch — rejected because it
  breaks the single-fetch contract (`servicer.py:970-977`) and lets warmup and fingerprint disagree.
- `R-5` Leave refused formulas out of the digest — rejected because pre-feature cells carrying the
  definition-only hash become eligible again whenever the formula is refused, and it does not
  preserve `@AC-23`.
- `R-6` Hash an "unreadable" sentinel at score time so a refused formula clears the grade — rejected
  because it is a C-16 CHANGE to `@AC-23 @feature-289`; superseded by the composite plus the
  newest-suffix refusal fallback.
- `R-7` Keep the unconditional pop on UPDATE and record the outage grade loss as a limitation —
  rejected because it breaks `@AC-2 @feature-194`: a rename keeps `def_hash`, the write-path outage
  is swallowed (`:729-736`), and the swallowed recompute error (`:3394-3395`) leaves no grade.
- `R-8` A byte-range predicate for the prefix query — rejected because under the non-C collation of
  DO Postgres punctuation does not sort in byte order, so rows can be silently missed or included.
- `R-9` A per-cell `formula_digests` JSONB column (analysis migration 030) — rejected because it
  needs DBA approval and migration cost for a SEV-3 fix that the composite resolves without one.

Considered but not locked in the register (no `R-n`): a newest-suffix fallback on a gate-off outage
(contradicts D-8), and a positional per-formula suffix (extra complexity and longer keys; it is the
remedy if the mixed-formula limitation below is later rejected).

## Open Risks

- [ ] The UPDATE pop guard could be built against the stale `pre` read (`:3316`) instead of the
  locked row, letting concurrent updates race — to be addressed at the UPDATE-guard step (pin test).
- [ ] Strategies whose formula is refused at rollout and that hold only pre-feature evidence go to an
  unrecoverable NOT_FOUND, including 028 template instances and the 029 blend (O-18) — to be
  addressed at the `_fetch_and_aggregate` step (distinct NOT_FOUND message) and the docs step
  (operator acknowledgement, user communication).
- [ ] With mixed refused and readable formulas, edits to the readable formula are not enforced while
  another formula is refused (O-19) — accepted limitation; recorded at the docs step.
- [ ] Ordering by `completed_at` may pick a slightly older composite when runs are concurrent —
  accepted; noted at the repository-method step.
- [ ] The fallback query sorts in memory over a strategy's cells, so its cost grows with the cell
  count (O-20) — documented at the repository-method step.
- [ ] An indicators outage now affects gate-off `ScoreStrategy` and every recompute path; boot-time
  scoring depends on indicators being ready (O-23) — pinned by `@AC-4`, recorded at the docs step.
- [ ] One-time evidence reset for every CUSTOM_FORMULA strategy (D-4); readiness and headline
  staleness remain documented limitations — docs step and rollout note in the integration PR.
- [ ] Owner isolation of digests rests on the per-owner formula cache (`:3092-3100`), which shares
  one `failures` dict. The isolation test is load-bearing — owner-isolation test step.
- [ ] Line numbers in this design are from the round-3 tree; the feature branch base predates
  analysis migrations 028/029 — `/sdd-spec` re-greps every cite and rebases on `origin/main-dev`.
- [ ] Register bookkeeping: O-11 and O-17 to O-24 still read `open` in debate.md, because no status
  transition was supplied at approval. O-17 (the only blocking one) is resolved by the binding
  operator decision of 2026-11-20 (step 6); the rest are adopted above or carried as the risks in
  this list — first step of `/sdd-spec` confirms each is covered by a numbered step.

## Constitution Rules Touched

No Floor (`F-*`) item is touched: no proto, migration, config literal, pool change or
owner-agnostic read. Floor breaches: none.

- `C-07` — honored by: no migration; the stale "next free is 028" claim is corrected above (030).
- `C-10` — honored by: ANALYSIS-3, ANALYSIS-7, `docs/scoring.md` and the known limitations are
  rewritten in the same feature.
- `C-11` — honored by: full-mode debate, 3 rounds, operator approval at the gate.
- `C-13` — honored by: new tests reuse the existing fixture homes (`tests/test_entry_backfill.py`
  `_strategy_row()`, the servicer harness); no ad-hoc duplicate fixtures.
- `C-15` — honored by: 327 `acceptance.feature` gains `@AC-3`, `@AC-4` and `@AC-5` next to
  `@AC-1` and `@AC-2`.
- `C-16` — honored by: every affected durable `@AC-*` is classified below; no guarantee is altered,
  and the operator sign-off of 2026-11-20 is recorded in context.md.
- `C-18` — honored by: digests ride the existing single formula read; the run-level `_FormulaRead`
  seed (refused fids included) keeps it at one `GetFormula` per formula per run.
- `P-02` — honored by: proposer and adversary exchanged only the mediated synthesis.
- `P-03` — honored by: the limitations and the unrecoverable refused population are recorded, not
  silently accepted.

## Business Rules Touched (C-16)

Operator decision reference for every line below: **operator @ 2026-11-20, design gate**
(context.md, session 2026-11-20 — sdd-design). The decision makes the UPDATE guard binding and
gives C-16 sign-off for the `@AC-23 @feature-289` treatment and the gate-off availability coupling
as synthesized. As synthesized, neither is a CHANGE: the round-3 composite fingerprint keeps
`@AC-23` as written, and the gate-off coupling is an EXTEND. There is therefore no CHANGE line.

- PRESERVE `@AC-23 @feature-289` "With the fundamentals gate on, a refused formula no longer blocks
  ScoreStrategy; an outage still does"
  (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`) — not
  regressed by: a refusal resolves through `latest_formula_fingerprint` and still succeeds; an
  outage keeps the pinned message. Signed off by operator @ 2026-11-20 (context.md).
- PRESERVE `@AC-2 @regression @feature-194` "a rename of an existing dirty strategy does not change
  its fingerprint" (`.../acceptance/fix-strategy-signal-params-dead-keys.feature:18-23`) — not
  regressed by: the pop-only-on-`def_hash`-change guard against the locked row, with a pin test.
  Binding per operator @ 2026-11-20 (context.md).
- PRESERVE `@AC-6 @feature-152` "manage_strategy normalizes source_symbol and folds it into the
  fingerprint" (`.../acceptance/market-regime-benchmark-operand.feature`) — not regressed by:
  `def_hash` is unchanged and the formula part is additive.
- PRESERVE `@AC-11 @feature-215` "The derived grade excludes refused symbols without deleting
  evidence" (`.../acceptance/block-fundamentals-strategy-on-etf.feature`) — not regressed by: cells
  are never deleted; old cells stop matching (D-4).
- PRESERVE `@AC-4 @feature-262` "A failed live-strategies read ends the backfill quietly"
  (`.../acceptance/fix-analysis-owner-scope.feature`) — not regressed by: the read stays inside the
  existing try/except → warning → return.
- PRESERVE `@AC-6 @feature-262` "The strategies repository offers no owner-agnostic read or write"
  (same file) — not regressed by: reuse of `list_live_enabled`; no new repository method there.
- EXTEND `@AC-1` (327) — the fingerprint follows referenced formula content.
- EXTEND `@AC-2` (327) — the backfill selects through `LIVE_ENABLED_PREDICATE_SQL`.
- EXTEND `@AC-3` (327, new) — a score-time refusal grades on the newest formula-aware evidence.
- EXTEND `@AC-4` (327, new) — gate off plus a `GetFormula` outage aborts UNAVAILABLE with a distinct
  message. This is the gate-off availability coupling; signed off by operator @ 2026-11-20
  (context.md).
- EXTEND `@AC-5` (327, new) — a rename during a `GetFormula` outage keeps the grade.
