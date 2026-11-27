# Implementation Spec: fix-fundsignal-scoring-correctness

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/309-fix-fundsignal-scoring-correctness/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/fix-fundsignal-scoring-correctness`
**Severity**: SEV-2
**Anchors read from**: `origin/main-dev@36aed60b` (read-only `git archive` snapshot). The feature branch tip
`9a9c62cf` sits on base `c4fd48b0a`, 166 commits behind `main-dev`; `/sdd-execute` BRANCH SYNC merges
`main-dev` before Step 1. Every `path:line` below is a `main-dev@36aed60b` line. Re-grep by the quoted
symbol before editing; a moved line is not a deviation, a missing symbol is (F-04).

---

## Execution Summary

The build order follows design.md: proto first (Steps 1-2), then the two producer fixes in
xstockstrat-analysis (formula input, Steps 3-5; direction gate, Steps 6-8), then conviction presence
across ingest, analysis and the agent (Steps 9-15). The spec ends at Step 15. The ingest retraction
migration with its assertion fixture and docs (former Steps 16-18) was dropped on 2026-11-27 by operator
ruling: the frozen retraction list is empty (§ Dropped Steps).
There is no xstockstrat-indicators code change (recon.md:60) and no new config key (`R-2`); indicators
gets one characterization test step. Consumer surfaces (C-14): the agent `ingest_signal` path changes in
Steps 13-14; `/insights/opportunities` (xstockstrat-ui) and MCP `list_opportunities` need no code change —
that is a design decision, not an omission (design.md § Consumer surfaces; no TS consumer of
`ExternalSignal` exists in `services/xstockstrat-ui/src`, re-grepped on `main-dev@36aed60b`).

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` formula input omits absent metrics | Step 4 (producer input), Step 5 (no pb / debt_to_equity sub-score of 1.0) |
| `@AC-2` lone low-scoring symbol is not `buy` | Step 7 |
| `@AC-3` explicit conviction 0.0 scored as 0.0 | Step 12 (scorer and screener path); Step 10 pins the store / read-back seam it depends on |
| `@AC-4` pre-246 fabricated signals no longer active | No step: closed by the recorded zero-row evidence (Operator Gate 1 results in context.md, 2026-11-27); not guarded by an automated test — flag for the C-16 promotion decision |
| `@AC-5` mcp_client explicit conviction 0.0 ingested as 0.0 | Step 10 |

## Operator Gates (P-03 — execute blocks and asks; never guesses)

All four gates are resolved by the 2026-11-27 operator rulings (`context.md` § Session 2026-11-27 — operator
rulings recorded by the orchestrator (verbatim)). No gate remains open and no step is blocked.

1. **Frozen retraction list — answered, empty.** The Step 16 read-only SELECT returned `(0 rows)` on DO
   staging and on homelab staging (`context.md` § Session 2026-11-27 — Operator Gate 1 read-only SELECT
   results). Production is out of scope. The union is empty, so there is no list to freeze and no migration
   to write (§ Dropped Steps).
2. **Retraction cutoff — moot.** The cutoff `2026-10-31T00:00:00Z` was a parameter of the dropped migration.
3. **O-14 / O-15 and the `@AC-5` wording — answered, "Confirm all three (Recommended)".**
   - O-14: stored wrong-direction `buy` rows from degenerate days expire naturally (up to
     `fundsignal.valid_days`, 90). No step retracts them.
   - O-15: opportunity rows built from retracted signals stay readable for up to about 24h
     (`opportunity.valid_window_hours`). No step triggers a recompute.
   - `@AC-5` (added by `/sdd-review impl-spec` with no operator in the loop) is confirmed as worded.
4. **Second cross-schema migration read — moot.** No migration reads `marketdata.fundamentals`; root
   `CLAUDE.md` § Database keeps its single recorded exception (analysis `029`).

**`@AC-4` handling.** The scenario stays in `acceptance.feature` (C-15: `@AC-*` ids are append-only) and is
not edited. It has no covering step and no automated test. It is closed by the two zero-row Operator Gate 1
results, which show no pre-246 fabricated row was active in either in-scope environment. This is a recorded
exception to the C-15 coverage rule; the operator will be asked before promotion (C-16) whether to accept it.

## Post-Deploy Checks (O-18 — withdrawn)

The O-18 per-environment checks (the `ingest 019: retracted N …` NOTICE count, the repeat SELECT, the
`marketdata.fundamentals absent` guard log line) belonged to the dropped migration and no longer apply.

## Step Dependencies

- Steps 1+2 land together: a `.proto` edit needs its `proto-gen` step (`step-constraints.md` §C). No
  descriptor-parity guard covers `ExternalSignal` (grep `ExternalSignal.DESCRIPTOR` in `services/` → no hit).
- Steps 3+4 land together: Step 3 turns the existing `test_ac3_formula_all_missing_skipped_partial_scored`
  red (`assert inputs["pe_ratio"] == 0.0`, `tests/test_fundsignal_loop.py:966`); Step 4 rewrites it.
- Step 5 [test] has no service step: the formula is already correct for honest input (recon.md:60).
- Steps 6+7 land together: Step 6 turns the lone-0.10 assertion of
  `test_map_directions_reference_scores_set_the_cuts` red (`tests/test_fundsignal_loop.py:1370`); Step 7 flips it.
- Step 8 [docs] requires Steps 3 and 6.
- Steps 9, 11 and 13 require Steps 1+2: they read or set `conviction_provided`.
- Step 10 [test] covers Step 9 [service]. Not a unit: no existing ingest test changes result under Step 9.
- Steps 11+12 land together: Step 11 turns `test_zero_conviction_uses_default_half` red
  (`tests/test_analysis_helpers.py:235`), because the MagicMock `_make_signal` makes
  `conviction_provided` truthy; Step 12 rebuilds the helper on a real proto.
- Step 14 [test] covers Step 13 [service]. Not a unit: no existing agent test changes result under Step 13.
- Step 15 [docs] requires Steps 9, 11 and 13.
- Steps 16-18 were dropped (§ Dropped Steps); the spec ends at Step 15 and no step needs an operator gate.
- The EXTEND of `services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature:34`
  (design.md § Business Rules Touched) is `@AC-5` in `acceptance.feature`, added by
  `/sdd-review impl-spec` on 2026-11-20 from the design.md wording. Step 10 covers it.
- Branch sync and merge friction (advisory, `/sdd-review impl-spec` 2026-11-20). The feature branch is
  166 commits behind `main-dev`; BRANCH SYNC runs before Step 1 and line numbers in this spec may
  drift after it (re-grep by symbol). Shared files with peers:
  - `services/xstockstrat-ingest/app/handlers/servicer.py` `_ingest_external_signal` and
    `app/engine/mcp_client_loop.py` are also edited by `fix-system-identity-paths` (313; its
    product-spec.md:46-47; `docs/roadmap/features/merge-order.md:404` on `main-dev`). 313 changes the
    identity / owner handling, Step 9 changes the conviction sentinel and the builder. Whichever
    merges second merges that function by hand and re-greps its anchors.
  - `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`: `fix-python-loop-supervision` (259)
    is `launched` on `main-dev`, so its `run_forever` rewrite is already in the `main-dev@36aed60b`
    anchors. Batch peers `fix-analysis-per-symbol-isolation` and `fix-analysis-evidence-dry` may edit
    `fundsignal_loop.py` or `scoring.py`; their specs were not read. Re-grep the Step 3, 6 and 11
    anchors after any merge of `main-dev`.
- `_MIN_CROSS_SECTION = 5` stays a module constant (D-6, `R-2`). It is calibrated to the default
  `fundsignal.buy_quantile` / `sell_quantile`, which are live keys, so a retuned quantile can make the
  gate misfit without any error. Step 7 pins the default calibration and Step 8 documents the
  coupling. Making it a config key is a possible follow-up feature, not part of this one.
- Accepted residuals with no step (design.md Open Risks): n ≥ 5 all-weak top quantile is `buy`; the
  budget-deferred mixed-label day (O-11); the deploy-boundary dedup duplicate (O-17).

---

### Step 1 — proto: add `conviction_provided` to `ExternalSignal`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify
- `packages/proto/docs/context-constitution.md` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint` / `buf breaking` pass; `packages/proto` owner — backward compatibility, naming; `xstockstrat-ingest` owner — signal normalization correctness; `xstockstrat-analysis` owner — strategy scoring determinism; `xstockstrat-agent` owner — MCP tool contract stability

**Codebase Evidence**:
- `packages/proto/ingest/v1/ingest.proto:126-138` — `message ExternalSignal`; last field `string user_id = 11;` (`:137`), so 12 is free.
- `:130` — `double conviction = 4;  // 0.0 – 1.0 confidence (0.0 if not provided by source)`.
- `:143-145` — `IngestSignalResponse.deduplicated` comment naming `(source, symbol, direction, conviction, valid_until)`.
- `packages/proto/docs/context-constitution.md:20` — **PROTO-7** names the sibling-flag pattern for a metric that stayed a plain `double`.
- In-file presence precedent: `optional double reliability_weight = 12;` on `SignalSource` (recon.md:69). Not used here (`R-5`).

**Lands with**: `Step 2`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. In `message ExternalSignal`, after `string user_id = 11;`, add `bool conviction_provided = 12;` with a comment: true when the sender set `conviction`, including an explicit 0.0; readers treat `conviction_provided || conviction != 0.0` as "given".
2. Rewrite the `conviction = 4` comment: 0.0–1.0; a 0.0 with `conviction_provided` unset means "not given". Field 4 stays a plain `double` (D-7).
3. In the `deduplicated` comment (`:143-145`), state that an explicit 0.0 and an omitted conviction are different dedup values.
4. In PROTO-7 (`packages/proto/docs/context-constitution.md:20`), add `ingest.proto#ExternalSignal` (`conviction` + `conviction_provided`) to the row's sibling-flag instances.
5. Record the `buf breaking` verdict in `context.md` (design.md § 3).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "$(git rev-parse --path-format=absolute --git-common-dir)#branch=feature/fix-fundsignal-scoring-correctness,subdir=packages/proto"
grep -n "conviction_provided = 12" ingest/v1/ingest.proto
```
The `--against` path is `<repo-root>/.git`; `subdir=` is mandatory (PLAT-10). If the local branch is not yet readable, use the ledger form `#ref=HEAD,subdir=packages/proto` (insights.md, 2026-08-19).
Run this only after BRANCH SYNC. The local `feature/fix-fundsignal-scoring-correctness` ref must be the synced tip; a stale local ref (166 commits behind `main-dev`) compares against an old `ingest.proto`. If the ref is stale or absent, use the `#ref=HEAD` form with the Step 1 edit uncommitted.

---

### Step 2 — proto-gen: regenerate ingest stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/ingest/v1/` — modify (generated)
- `packages/proto/gen/python/ingest/v1/` — modify (generated)
- `packages/proto/gen/ts/ingest/v1/` — modify (generated; includes `gen/ts/dist/` output of the same package)

**Reviewers**: inherited from Step 1

**Codebase Evidence**:
- `scripts/buf-gen.sh` exists; the root `CLAUDE.md` § Generating Proto Stubs makes it the only codegen entry.
- Stub directories confirmed by `ls`: `packages/proto/gen/{go,python,ts}/ingest/v1/`.

**Lands with**: `Step 1`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
Run `./scripts/buf-gen.sh` from the repo root and stage only the regenerated ingest stubs. Do not hand-edit generated files. If the diff touches a package other than ingest, stop: the toolchain pin has drifted (root `CLAUDE.md` § Version Bump Workflow).

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ | grep -v "ingest" ; test $? -eq 1
python3 -c "import sys; sys.path.insert(0,'packages/proto/gen/python'); from ingest.v1 import ingest_pb2; assert ingest_pb2.ExternalSignal.DESCRIPTOR.fields_by_name['conviction_provided'].number == 12"   # exit 0 (run from the repo root; KeyError before the stubs are regenerated)
./scripts/buf-gen.sh && git diff --quiet packages/proto/gen/ ; echo "second run clean: $?"   # after staging
```

---

### Step 3 — service: build the formula input from present metrics only

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `fundsignal_loop.py:565-589` — `_score_via_formula`; the input dict is built from raw scalars at `:571-578`; `if set(f.missing_metrics).issuperset(fundamentals):` at `:579`; `out[sym] = float(scores.get("composite", 0.0))` at `:586`.
- Reuse target (recon.md:66): `_builtin_score` at `:534-550` — `missing = set(f.missing_metrics)` then `if "<metric>" not in missing`.
- Strategy-path contract it must match: `services/xstockstrat-analysis/app/services/evaluator.py:586` ("omits the absent (`None`) metrics — omit-absent").

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
In `_score_via_formula`, build `fundamentals` only from the six keys (`pe_ratio`, `pb_ratio`, `dividend_yield`, `roe`, `debt_to_equity`, `eps`) that are not in `set(f.missing_metrics)`. Absence is keyed on `missing_metrics`, never on a zero value (D-1; 246 `@AC-2`). Replace the `issuperset` test with "the dict is empty → append to `unscored` and `continue`". Leave the `score_fundamentals` call, the `scores.get("composite", 0.0)` read and the `except` branch unchanged. No clamp is added (D-10).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -q
grep -n "issuperset" app/engine/fundsignal_loop.py ; test $? -eq 1
ruff check . && ruff format --check .
```

---

### Step 4 — test: formula-path input and the changed durable rules

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/tests/test_fundamentals_formula_operand.py` — modify (two stale docstring phrases)
- `services/xstockstrat-analysis/acceptance/fix-fundsignal-neutral-score.feature` — modify
- `services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_fundsignal_loop.py:949-973` — `test_ac3_formula_all_missing_skipped_partial_scored`; `inputs = dict(req.input_data)` at `:965`, the `dividend_yield` approx assertion at `:966`, `assert inputs["pe_ratio"] == 0.0` at `:967`.
- Helpers to reuse: `_identity_loop` (`:677`, canned `ExecuteFormula` composite 0.7), `_serve_rows` (`:888`), `_SYSTEM_FORMULA` (`:667`), `BUILTIN_SCORER_METRICS` (`:27`), `fundamentals_row` (`tests/conftest.py:57`), `_assert_system_identity` (`:704`).
- `acceptance/fix-fundsignal-neutral-score.feature:42` — "… with dividend_yield 0.013 and pe_ratio 0.0" (`@AC-3 @feature-246`).
- `acceptance/fundamentals-formula-inputs.feature:39` — stale "partial-row case diverges by design" comment (`@AC-4 @feature-201`); `:47-53` — `@AC-8 @feature-201` scenario title, second `Then`, and the trailing comment.
- `tests/test_fundamentals_formula_operand.py:8` and `:187-188` — docstrings saying the partial row "diverges from the producer".
- C-16 sign-off for all three CHANGEs: `context.md` § Session 2026-11-20 (operator decisions at the design gate).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. Rewrite `test_ac3_formula_all_missing_skipped_partial_scored`: replace the two input assertions with `assert set(inputs) == {"dividend_yield"}` and `inputs["dividend_yield"] == pytest.approx(0.013)`; name `@AC-1 @feature-309` in a docstring. The other assertions stay. RED today: `inputs` holds six keys.
2. Add `test_formula_partial_row_matches_strategy_omit_absent` in `TestUnscoredSymbols`: a row with only `pe_ratio` in `missing` and `roe=0.0` present → the `ExecuteFormula` input keys are exactly the other five, and `inputs["roe"] == 0.0` (a present zero is still sent). RED today: `pe_ratio` is present as 0.0.
3. C-13: every row is built with the existing `fundamentals_row` fixture; no new domain literal gains a second consumer.
4. `fix-fundsignal-neutral-score.feature:42`: the `Then` becomes "ExecuteFormula is called exactly once, as the system identity, with dividend_yield 0.013 as its only input".
5. `fundamentals-formula-inputs.feature`: delete the comment at `:39`; retitle the `@AC-8` scenario to "… and matches the producer"; its second `Then` becomes "the resulting composite matches the fundamentals signal producer's score for the same row, which also omits pe_ratio"; trim the "partial-row divergence … signed-off behavior" sentence from the trailing comment. Tags and scenario IDs are unchanged (C-15 append-only).
6. In `test_fundamentals_formula_operand.py`, change the two docstring phrases to say the producer omits the metric too.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py tests/test_fundamentals_formula_operand.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "conftest\|fundamentals_row" tests/test_fundsignal_loop.py | head -3
grep -n "pe_ratio 0.0\|diverges" acceptance/fix-fundsignal-neutral-score.feature acceptance/fundamentals-formula-inputs.feature ; test $? -eq 1
```

---

### Step 5 — test: pin `value_quality` on a dividend-only input and its [0,1] range

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_fundamentals_formula.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- `tests/test_fundamentals_formula.py:22` — `run(fundamentals, param_overrides=None)` runs `SOURCE` through the sandbox; `:37` `test_outputs_in_unit_range` (full row only); `:90` `test_missing_dividend_is_neutral_not_zeroing`.
- `app/formulas/fundamentals_value_quality.py:91-98` `_get` returns `None` for an absent key; `value_sub` / `quality_sub` fall back to 0.5 when their part list is empty; `composite = _clamp(value_weight * value_sub + quality_weight * quality_sub)`; `div_peak` default 0.04.
- No acceptance rule pins absent-key semantics for indicators (recon.md:101).

**TDD**: `red-green required` — red N/A (characterization; no behavior change in this service, tdd-gate.md escape). State it in the PR body and `context.md`.

**Covers**: `AC-1`

**Instructions**:
1. Add `test_dividend_only_input_has_no_pb_or_de_subscore`: `run({"dividend_yield": 0.013})` → `value == pytest.approx(0.325)`, `quality == 0.5`, `composite == pytest.approx(0.4125)`. This is the `@AC-1` "no pb or debt_to_equity sub-score of 1.0" clause.
2. Add a parametrized `test_composite_in_unit_range_on_partial_and_extreme_rows` (D-10 scale contract): an empty input, single-metric inputs, and out-of-band values (negative `pe_ratio`, `roe` 5.0, `debt_to_equity` 50) all keep `value`, `quality` and `composite` in [0,1].
3. C-13: inputs are scenario one-offs passed inline to the existing `run` helper; no second consumer.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run pytest tests/test_fundamentals_formula.py -q
uv run pytest --cov=app --cov-fail-under=50
ruff check . && ruff format --check .
```

---

### Step 6 — service: degenerate-only side gate in `_map_directions`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `fundsignal_loop.py:591-608` — `_map_directions(scores, buy_quantile, sell_quantile, reference_scores=())`; `ordered = sorted([*scores.values(), *reference_scores])` at `:597`; `buy_cut` / `sell_cut` at `:598-599`; `if s >= buy_cut:` tested first at `:602`.
- `:793-802` — `_quantile`, `idx = int(round(q * (len(sorted_values) - 1)))`.
- `:278-280` — the only caller, passing `reference_scores=[v for v in prior.values() if v is not None]` (the 260 fold; recon.md:67).
- Module constants live at `:41-60` (`_FUNDSIGNAL_CALLER`, `_BUILTIN_BANDS`). `_NEUTRAL_SCORE` and `_MIN_CROSS_SECTION`: **Not found** — both are new (D-14).
- Operator decision 2026-11-20 (option A): degenerate-only gate, side tie-break at 0.5; the always-on gate and the absolute-score-cut variant are rejected.

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add two module constants next to `_BUILTIN_BANDS`: `_NEUTRAL_SCORE = 0.5` and `_MIN_CROSS_SECTION = 5`. They are fixed invariants, not config (D-6; F-07 not breached). One comment line: 5 is calibrated to the default 0.80 / 0.20 quantiles.
2. In `_map_directions`, keep `ordered` and both `_quantile` cuts byte-identical. After them compute `degenerate = len(ordered) < _MIN_CROSS_SECTION or buy_cut <= sell_cut` — counted over the folded set (D-9).
3. When `degenerate`: `buy` iff `s >= buy_cut and s > _NEUTRAL_SCORE`; `sell` iff `s <= sell_cut and s < _NEUTRAL_SCORE`; otherwise `hold`.
4. When not degenerate, the existing three-way branch runs unchanged.
5. Update the docstring to name the degenerate rule. Do not change `_quantile` or the caller.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -q
grep -n "_NEUTRAL_SCORE = 0.5\|_MIN_CROSS_SECTION = 5" app/engine/fundsignal_loop.py
ruff check . && ruff format --check .
```

---

### Step 7 — test: direction gate, calibration and the built-in score range

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_fundsignal_loop.py:249-262` — `TestScoreDirection` (`test_quantile_buckets` `:250`, `test_builtin_score_deterministic` `:258`).
- `:1353-1364` — `test_ac9_one_symbol_retry_keeps_day_wide_direction` (260 `@AC-9`): folded set 0.10 / 0.50 / 0.70 / 0.90, asserts `sell`.
- `:1366-1370` — `test_map_directions_reference_scores_set_the_cuts`; the lone-0.10 assertion at `:1370` expects `{"AAPL": "buy"}`.
- `:1327-1351` — `test_ac8_lost_response_retry_resends_identical_signal` compares the resent direction to the sent one only, so it stays green.
- Explicit-universe pattern: `:150-154` (`fundsignal.universe_source` = `explicit`, `fundsignal.explicit_symbols`).
- Checked with a throwaway script of the Step 6 rule: `test_quantile_buckets` and 260 `@AC-9` keep their labels; a lone 0.05 is `sell`, a lone 0.9 `buy`, a lone 0.5 `hold`; at 0.80 / 0.20 on distinct scores every n in 5..50 has a non-empty hold band and a buy share ≤ 40%, and n = 4 has an empty hold band and a 50% buy share.
- No other test asserts a producer direction (grep `direction` over `tests/test_fundsignal*.py`, `tests/test_analysis_servicer.py` `TestRunFundamentalsScan`).

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. `test_map_directions_reference_scores_set_the_cuts` (`:1370`): the lone-0.10 expectation becomes `{"AAPL": "sell"}`. This test has no `@AC` tag.
2. Add `test_ac2_lone_low_scoring_symbol_is_not_buy` (`@AC-2 @feature-309`): `_identity_loop` with the explicit universe of one symbol, a row with `pe_ratio=40.0`, `roe=0.0`, `eps=-1.0` and `pb_ratio` / `debt_to_equity` in `missing`, `_db.fetch` returning no stored scores, then `run_once()` (non-dry-run). Assert exactly one `IngestSignal` and `signal.direction != "buy"`. RED today: direction is `buy`.
3. In `TestScoreDirection` add `test_lone_score_follows_its_side` (0.05 → `sell`, 0.9 → `buy`, 0.5 → `hold`, 0.51 → `buy`, 0.49 → `sell`) and `test_small_cross_sections_take_the_degenerate_branch` (for n = 2..4 with every score below 0.5, no symbol is `buy`).
4. Add `test_min_cross_section_calibrated_to_default_quantiles` (O-10; `R-7` forbids the cut-rank form): for n = 5..50 on distinct scores at 0.80 / 0.20, the non-degenerate labels have at least one `hold` and a buy share ≤ 0.40; for n = 4 that property fails when computed from `_quantile` directly; assert `fundsignal_module._MIN_CROSS_SECTION == 5`.
5. Add `test_builtin_score_stays_in_unit_range` (D-10): `_builtin_score` over full, partial and out-of-band rows returns a value in [0,1] or `None`.
6. Leave `test_quantile_buckets` and 260 `@AC-9` untouched; both must pass.
7. C-13: rows use `fundamentals_row` / `_fund`; score vectors are scenario one-offs.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_fundsignal_loop.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "conftest\|fundamentals_row" tests/test_fundsignal_loop.py | head -3
```

---

### Step 8 — docs: producer scoring and direction contract

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/docs/fundsignal.md` — modify
- `services/xstockstrat-analysis/docs/fundamentals-guard.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/fundsignal.md:18` — "Unscored symbols (feature 246)" bullet; it says "a partial formula row still sends wire 0.0 for its missing inputs". On `main-dev` this text moved out of `CLAUDE.md`; design.md's `CLAUDE.md:160` / `:419` anchors no longer exist.
- `docs/fundamentals-guard.md:12` — "the partial-row case diverges by design — see `@AC-8`".
- `CLAUDE.md:259-262` — key rows `fundsignal.scoring_formula_id`, `fundsignal.buy_quantile`, `fundsignal.sell_quantile`, `fundsignal.min_conviction_to_emit`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `docs/fundsignal.md:18`: a partial formula row now omits its missing inputs; an empty input is unscored.
2. `docs/fundsignal.md`: add a direction bullet — the gate is degenerate-only (folded set below `_MIN_CROSS_SECTION` = 5, or `buy_cut <= sell_cut`), with the side tie-break at `_NEUTRAL_SCORE` = 0.5; 5 is calibrated to the default quantiles while `buy_quantile` / `sell_quantile` are live keys; an n ≥ 5 all-weak cross-section still labels its top quantile `buy`; in the degenerate branch the hold band is exactly 0.5.
3. `docs/fundamentals-guard.md:12`: replace the "diverges by design" clause with "the producer omits absent metrics too".
4. `CLAUDE.md`, `fundsignal.scoring_formula_id` row: add the scale contract — a system scoring composite is in [0,1] with 0.5 neutral; no clamp (D-10). On the `buy_quantile` row add a pointer to the degenerate rule in `docs/fundsignal.md`.

**Verification**:
```bash
grep -n "wire 0.0\|diverges by design" services/xstockstrat-analysis/docs/fundsignal.md services/xstockstrat-analysis/docs/fundamentals-guard.md ; test $? -eq 1
grep -n "_MIN_CROSS_SECTION" services/xstockstrat-analysis/docs/fundsignal.md
grep -n "0.5 neutral" services/xstockstrat-analysis/CLAUDE.md
```

---

### Step 9 — service: conviction presence on ingest write, read-back and the mcp_client builder

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- `servicer.py:1346` — `_ingest_external_signal`; comment at `:1364-1365` ("0.0 passes and is stored as NULL" on `:1365`); range check `:1366`; write sentinel `:1386` `conviction = signal.conviction if signal.conviction > 0.0 else None`.
- The same `conviction` binds into the `newsletter_signals` INSERT (`:1398-1416`) and the `signal_dedup_claims` upsert (`:1419-1446`, `IS DISTINCT FROM EXCLUDED.conviction` at `:1432-1433`).
- `servicer.py:1534` — `QuerySignals`; builder at `:1628-1637`; read-back sentinel `:1633` `conviction=float(row["conviction"]) if row["conviction"] is not None else 0.0`.
- `mcp_client_loop.py:88-94` — `_build_external_signal`; `conviction=item["conviction"]` at `:94`. Conviction is mandatory there: `app/extractors/mcp_client.py:45` drops an item without a numeric in-range conviction.
- Storage accepts 0: `conviction NUMERIC(4,3) CHECK (conviction BETWEEN 0 AND 1)`, nullable (`migrations/001_newsletter_signals.up.sql:14`). No schema change.
- No other conviction site in `services/xstockstrat-ingest/app` (grep).
- Header propagation: no new outbound call is added.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Write (`:1386`): `conviction = signal.conviction if (signal.conviction_provided or signal.conviction != 0.0) else None`. The range check stays. Rewrite the comment at `:1364-1365`: an explicit 0.0 is stored as 0; an omitted conviction is stored as NULL.
2. Do not special-case 0 against a legacy NULL in the dedup upsert (`R-8`).
3. `QuerySignals` builder (`:1628-1637`): for a non-NULL row set `conviction=float(row["conviction"])` and `conviction_provided=True`; for a NULL row leave both unset (D-8).
4. `_build_external_signal` (`mcp_client_loop.py:90-94`): add `conviction_provided=True` unconditionally.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_ingest_servicer.py tests/test_mcp_client_loop.py -q
grep -n "conviction_provided" app/handlers/servicer.py app/engine/mcp_client_loop.py
ruff check . && ruff format --check .
```

---

### Step 10 — test: explicit-zero store, read-back and mcp_client presence

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- `tests/test_ingest_servicer.py:2160-2215` — `TestIngestSignalConvictionValidation`, built on a real `ingest_pb2.ExternalSignal` (`_make_signal_req` `:2169`); `_servicer_full_happy_path` (`:2181`) uses `transaction_conn(...)` but does not return `conn`; `test_in_range_conviction_proceeds` (`:2209`) carries the "0.0 … stored NULL" comment (`:2210-2211`).
- `tests/_helpers.py:25` — `transaction_conn` returns `(db, conn)`; the INSERT is `conn.fetchrow` call 0 (conviction = positional `args[4]`), the claim upsert is call 1 (conviction = `args[6]`).
- `tests/test_ingest_servicer.py:1947-1986` — `TestQuerySignals`; `test_populates_ingested_at` (`:1961`) shows the `db.fetch` row-dict shape.
- `tests/test_mcp_client_loop.py:94-115` — `test_cycle_parses_and_ingests_signal` reads the built signal from `servicer._ingest_external_signal.await_args.args[0]`; `_item` (`:338`), `_run_cycle_with` (`:342`).
- `TestIngestSignal._make_signal_req` (`:1666`) is a MagicMock with `conviction = 0.8` (`:1674`); both branches of the new predicate store 0.8, so it is left as is.
- No test stores a 0.0 today (recon.md:73).

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
1. In `TestIngestSignalConvictionValidation` add `test_explicit_zero_conviction_is_stored_as_zero`: a real `ExternalSignal(conviction=0.0, conviction_provided=True)`, its own `transaction_conn`, then assert `conn.fetchrow.await_args_list[0].args[4] == 0.0` and `…[1].args[6] == 0.0` (both `is not None`). RED today: `conviction_provided` is unknown / the value is `None`.
2. Add `test_omitted_conviction_is_stored_as_null`: the same request without the flag → both arguments are `None` (the not-given pin).
3. Fix the comment in `test_in_range_conviction_proceeds`: 0.0 without the flag is stored NULL.
4. In `TestQuerySignals` add `test_conviction_presence_round_trip`: rows with `conviction` `Decimal("0.000")`, `None` and `0.9` → `(conviction_provided, conviction)` is `(True, 0.0)`, `(False, 0.0)`, `(True, 0.9)`.
5. In `test_mcp_client_loop.py` add `test_explicit_zero_conviction_marks_presence` via `_run_cycle_with` and `_item(conviction=0.0)`: the built signal has `conviction == 0.0` and `conviction_provided is True`. With test 1 (the stored 0) this covers `@AC-5`, the EXTEND next to `mcp-client-signal-source.feature:34`.
6. C-13: request and row literals are scenario one-offs; `_item` and `transaction_conn` are reused.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run pytest tests/test_ingest_servicer.py tests/test_mcp_client_loop.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "conftest\|_helpers" tests/test_ingest_servicer.py | head -3
```

---

### Step 11 — service: producer sets presence; scorer reads it

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — modify
- `services/xstockstrat-analysis/app/services/scoring.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, backtest reproducibility

**Codebase Evidence**:
- `fundsignal_loop.py:643` — `_emit_signal`; `ingest_pb2.ExternalSignal(` at `:654-661`, `conviction=float(conviction)` at `:658`.
- `scoring.py:10` — `compute_signal_score`; `:31` `conviction = sig.conviction if sig.conviction > 0 else 0.5`. The `return 0.5` at `:15` and after the loop are separate neutral returns and stay.
- Callers: `app/services/screener.py:285`; alias `_compute_signal_score = scoring.compute_signal_score` at `app/handlers/servicer.py:97` (its comment at `:96`).
- Other analysis readers already use `sig.conviction` literally (`app/handlers/servicer.py:5115-5116`, `:5644-5645`, `:5708`, `:5725-5726`, `:6928`); they are not changed (design.md § 3).
- Header propagation: no new outbound call; `_emit_signal` reuses the existing `IngestSignal` call and its `metadata`.

**Lands with**: `Step 12`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `_emit_signal`: add `conviction_provided=True` to the `ExternalSignal(...)` construction, unconditionally (D-8).
2. `scoring.py:31`: `conviction = sig.conviction if (sig.conviction_provided or sig.conviction != 0.0) else 0.5`. A legacy NULL row (flag unset, 0.0) keeps its 0.5 weight (`R-1`). No other line of `compute_signal_score` changes.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_helpers.py tests/test_screener.py tests/test_fundsignal_loop.py -q
grep -n "conviction_provided" app/engine/fundsignal_loop.py app/services/scoring.py
ruff check . && ruff format --check .
```

---

### Step 12 — test: emit presence, scorer zero and the real-proto signal helper

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_helpers.py` — modify
- `services/xstockstrat-analysis/tests/test_screener.py` — modify
- `services/xstockstrat-analysis/tests/test_fundsignal_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — strategy scoring determinism, backtest reproducibility

**Codebase Evidence**:
- `tests/test_analysis_helpers.py:182-194` — `_make_signal` returns a `MagicMock`; 16 call sites in the same file (`:208`..`:358`; 17 occurrences counting the def at `:182`), none elsewhere (grep `_make_signal\b` over `tests/`).
- `:235-239` — `test_zero_conviction_uses_default_half` (`_make_signal("buy", 0.0)`, asserts `> 0.5`): the only pin of `R-1`.
- `:241-271` — a real `ingest_pb2.ExternalSignal` is already used in this file (`:251`, `:266`; import at `:12`); `_seconds_to_datetime` at `:176`; `MagicMock` is still used by other tests (`:54`).
- `tests/test_screener.py:710-716` — `_in_window_signal(direction, conviction)` builds a real `ExternalSignal`; `:593-625` — a signal-weighted screen through `make_engine`; `:768-776` — the existing wrapper around `screener_mod.scoring.compute_signal_score`.
- Ledger: fails.md:726 (MagicMock proto stand-ins hide field bugs); insights.md 2026-11-04 fix-fundsignal-neutral-score (migrate the doubles first, behavior-neutral, then the RED tests).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. Rebuild `_make_signal` on a real `ingest_pb2.ExternalSignal(direction=…, conviction=…)`, keeping its signature; set `valid_from` / `valid_until` with `.FromDatetime(_seconds_to_datetime(sec))` only when the argument is > 0. This migration is behavior-neutral: all 16 call sites pass on the tree before Step 11.
2. Keep `test_zero_conviction_uses_default_half` and its assertion unchanged; it is the "not given → 0.5" pin. Never invert it (O-16).
3. Add its sibling `test_explicit_zero_conviction_scores_zero` (`@AC-3 @feature-309`): the same signal with `conviction_provided = True` → `_compute_signal_score(...) == pytest.approx(0.5)` (a buy adding 0.0), where the not-given signal gives 0.75. RED today: 0.75.
4. `tests/test_screener.py`: add `test_ac3_screen_scores_explicit_zero_conviction_as_zero` on the `:593` pattern with `_in_window_signal("buy", 0.0)` plus `conviction_provided=True`; capture the `compute_signal_score` return through the `:768` wrapper pattern and assert `pytest.approx(0.5)`. AC-3 is scoped to the screener path (D-4).
5. `tests/test_fundsignal_loop.py`: add `test_zero_score_emits_explicit_zero_conviction` — a built-in score of 0.0 (`pe_ratio=40.0`, `roe=0.0`, `eps=-1.0`, rest missing) at the default `fundsignal.min_conviction_to_emit` → the `IngestSignal` request has `conviction == 0.0` and `conviction_provided is True`.
6. C-13: `_make_signal` and `_in_window_signal` each keep their single home file; no literal gains a second consumer.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_analysis_helpers.py tests/test_screener.py tests/test_fundsignal_loop.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
grep -n "sig = MagicMock()" tests/test_analysis_helpers.py ; test $? -eq 1
```

---

### Step 13 — service: agent `ingest_signal` sets presence; tool docs follow

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify (docstring only)
- `services/xstockstrat-agent/app/prompts/signal_extraction.md` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `app/client.py:250-257` — `signal = ingest_pb2.ExternalSignal(...)`; `if conviction is not None: signal.conviction = conviction` at `:256-257`.
- `app/tools.py:759-762` — `ingest_signal` docstring: "conviction: float in (0.0, 1.0], optional … 0.0 (or an omitted conviction) is stored as NULL".
- `app/tools.py:350` — the default extraction prompt asks for "conviction above 0 and at most 1" from a fixed set; an explicit 0.0 is never sent by it, so it is not edited.
- `docs/runbooks/mcp-tools.md:269` — `conviction` row: "ingest stores an absent (or `0.0`) value as unset (NULL) and reads it back as `0.0` meaning "unknown confidence" (invariant INGEST-4)".
- `app/prompts/signal_extraction.md:64` — "0.0–1.0 — omit if not determinable from context".
- The tool name, parameters and return shape do not change; the tool count is unchanged.
- strat-lab skill (`plugins/strat-lab/skills/backtest/SKILL.md`): **Not found** — it has no ingest-conviction sentinel statement (its conviction text at `:260-263` is backtest diagnostics). No edit; `ingest_signal` is outside the tools `docs/patterns/strat-lab-plugin.md` binds to the skill.
- No test pins this doc text (grep `stored as NULL`, `(0.0, 1.0]` over `services/xstockstrat-agent/tests`).
- Header propagation: no new outbound call.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `client.py:256-257`: inside `if conviction is not None:` also set `signal.conviction_provided = True`.
2. `tools.py:759-762`: conviction is a float in [0.0, 1.0]; an omitted conviction is stored as NULL ("not given"); an explicit 0.0 is stored as 0 and scored as zero confidence.
3. `docs/runbooks/mcp-tools.md:269`: the same statement; keep the range-rejection sentence.
4. `signal_extraction.md:64`: keep "omit if not determinable"; add that 0.0 is a real zero, not "unknown".

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_client.py tests/test_tools.py tests/test_extraction_instructions.py -q
grep -n "conviction_provided" app/client.py
grep -n "unknown confidence" ../../docs/runbooks/mcp-tools.md ; test $? -eq 1
ruff check . && ruff format --check .
```

---

### Step 14 — test: agent client sets presence only when conviction is given

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability

**Codebase Evidence**:
- `tests/test_client.py:441-460` — `TestIngestSignalClient.test_ingest_signal_maps_deduplicated_field`: patches `app.client.mtls` with `_channel_cm()` (`:74`) and `ingest_pb2_grpc.IngestServiceStub`; the request is `mock_stub.IngestSignal.await_args.args[0]`.
- CI coverage threshold for the agent is 40 (`.github/workflows/ci.yml:476-478`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
In `TestIngestSignalClient` add, on the existing patch pattern:
1. `test_explicit_zero_conviction_sets_presence`: `conviction=0.0` → the sent signal has `conviction == 0.0` and `conviction_provided is True`. RED today: the flag is `False`.
2. `test_omitted_conviction_leaves_presence_unset`: no `conviction` → `conviction_provided is False`.
C-13: the arguments are scenario one-offs; no fixture home is created.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_client.py -q
uv run pytest --cov=app --cov-fail-under=40
ruff check . && ruff format --check .
```

---

### Step 15 — docs: conviction-presence invariant

**Status**: `done`
**Service**: `xstockstrat-ingest` (docs), `docs/runbooks/`
**Files**:
- `services/xstockstrat-ingest/docs/context-constitution.md` — modify
- `docs/runbooks/add-data-source.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-ingest/docs/context-constitution.md:18` — **INGEST-4**: "`0.0`/`0` mean "unset" for `conviction` on both write and read … Consumers must read `0.0` as *unknown confidence*".
- `docs/runbooks/add-data-source.md:358` — a proto snippet: `double conviction = 4;   // 0.0 – 1.0 (0.0 if not provided by source)`.
- The proto comment and PROTO-7 are in Step 1; the agent surfaces are in Step 13; `signal_extraction.md` is in Step 13.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Rewrite INGEST-4: presence is `conviction_provided or conviction != 0.0`; write stores NULL only when not given; read sets `conviction_provided` for every non-NULL row; a stored 0 is a real zero. State the surviving legacy sentinel: a pre-flag client that sends a deliberate 0.0 without the flag still reads as not given (0.5 in the analysis scorer). Refresh the row's anchors to the Step 9 symbols.
2. `add-data-source.md:358`: update the snippet comment and show `bool conviction_provided = 12;`.

**Verification**:
```bash
grep -n "conviction_provided" services/xstockstrat-ingest/docs/context-constitution.md docs/runbooks/add-data-source.md
grep -n "unknown confidence" services/xstockstrat-ingest/docs/context-constitution.md ; test $? -eq 1
```

---

## Dropped Steps

Removed from the step list on 2026-11-27 by operator ruling, so every remaining step status marker is
`pending` or `done`. The operator ruled "Drop 16-18 (Recommended)" (`context.md` § Session 2026-11-27 —
operator rulings recorded by the orchestrator (verbatim)). Reason common to all three: the frozen
retraction list is empty. The Step 16 read-only SELECT returned `(0 rows)` on DO staging and `(0 rows)` on
homelab staging; production is out of scope. The two zero-row results are the recorded evidence.

**Dropped step 16 — migration: ingest `019_retract_fabricated_fundsignals`.** It would have expired
pre-246 fabricated `0.5` fundamentals signals for data-less symbols by setting `valid_until` from a frozen
operator list, behind a `to_regclass('marketdata.fundamentals')` guard. With no row matching in either
in-scope environment there is nothing to expire; no migration and no cross-schema read are written.

**Dropped step 17 — test: migration-assertions fixture for ingest 019.** `scripts/migration-assertions/ingest-019.sql`
asserted Step 16 and was the only step that covered `@AC-4`. With Step 16 dropped it has nothing to
exercise. `@AC-4` is closed by the recorded zero-row evidence and carries no automated guard (§ Scenario
Coverage).

**Dropped step 18 — docs: second migration-time cross-schema read.** It would have amended
`docs/patterns/database.md`, root `CLAUDE.md` § Database and `services/xstockstrat-ingest/CLAUDE.md` for a
second migration-time cross-schema read. With no such read, the docs keep their single recorded exception
(analysis `029` reading `identity.users`) and stay correct.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 1 — proto: add `conviction_provided` to `ExternalSignal`
**Spec said**: `buf breaking --against "$(git rev-parse --path-format=absolute --git-common-dir)#branch=feature/fix-fundsignal-scoring-correctness,subdir=packages/proto"`; "If the ref is stale or absent, use the `#ref=HEAD` form with the Step 1 edit uncommitted."
**Actual**: Ran `#ref=5dfa9e1434ab60e689198e6e881bd45387371f53,subdir=packages/proto` (the synced dev-branch tip, edit uncommitted), inside the pinned `xstockstrat-codegen` image (buf 1.72.0).
**Reason**: The local `feature/fix-fundsignal-scoring-correctness` ref is stale (`bfb2f32d`; its `common.proto` differs from the tip). `#ref=HEAD` against the common git dir resolves the main checkout's HEAD (another branch, different `ingest.proto`), not this worktree's. buf is not installed on the host. **Disposition**: CI-equivalent fallback.

### Deviation: Step 2 — proto-gen: regenerate ingest stubs
**Spec said**: `./scripts/buf-gen.sh && …` run on the host.
**Actual**: The Verification block ran verbatim inside the pinned `xstockstrat-codegen` image (buf 1.72.0, Go plugins and grpcio-tools 1.80.0 pinned to CI `proto-freshness`), with the main checkout mounted read-only and its `packages/proto/gen/ts/node_modules` bind-mounted read-only so `tsc` could compile `gen/ts/dist`. The block ran twice: once before staging (line 3 printed `second run clean: 1`, as expected unstaged), then again after staging the regenerated stubs (`second run clean: 0`).
**Reason**: buf and grpcio-tools are not on the host, and the worktree has no `packages/proto/gen/ts/node_modules`. Line 3 says "after staging", so a single pre-staging run cannot satisfy it. **Disposition**: CI-equivalent fallback.

### Deviation: Step 9 — service: conviction presence on ingest write, read-back and the mcp_client builder
**Spec said**: `**TDD**: red-green required`, with the Verification block (the existing `test_ingest_servicer.py` / `test_mcp_client_loop.py` suites, a grep and ruff) as the run; Step 10 owns the new tests and is not a unit with Step 9.
**Actual**: The block passes before and after the change (210 passed both times; only its grep line changes, from no output to three hits). RED → GREEN was shown with an uncommitted scratch probe (`.sdd-logs/probe_step9.py`, five cases mirroring Step 10 tests 1, 2, 4 and 5): 3 failed / 2 passed before the change, 5 passed after. The probe is not staged; Step 10 commits the real tests.
**Reason**: No existing ingest test changes result under Step 9 (Step Dependencies), and Step 10's test files are outside Step 9's **Files** (F-08). **Disposition**: in-scope TDD evidence, no scope change.

### Deviation: Step 10 — test: explicit-zero store, read-back and mcp_client presence
**Spec said**: `**TDD**: red-green required`; RED "today: `conviction_provided` is unknown / the value is `None`".
**Actual**: Step 9 had already landed, so the new tests pass on the branch tip. RED ran the Verification block with the two Step 9 service files temporarily checked out from `faea4d0f` (pre-Step-9) and restored before GREEN: 3 failed (`test_explicit_zero_conviction_is_stored_as_zero`, `test_conviction_presence_round_trip`, `test_explicit_zero_conviction_marks_presence`). `test_omitted_conviction_is_stored_as_null` passes on both trees because it pins the unchanged not-given behaviour. That block printed `exit=0` because its last command (the grep) passed.
**Reason**: Step 9 lands before Step 10 (Step Dependencies; not an atomic unit). **Disposition**: in-scope TDD evidence, no scope change.

### Deviation: Step 13 — service: agent `ingest_signal` sets presence; tool docs follow
**Spec said**: `**TDD**: red-green required`, with the Verification block (the existing `test_client.py` / `test_tools.py` / `test_extraction_instructions.py` suites, two greps and ruff) as the run; Step 14 owns the new tests and is not a unit with Step 13.
**Actual**: The block printed `exit=0` before and after the change (239 passed both times; ruff runs last). Only its grep lines changed: before, the `conviction_provided` grep printed nothing and `unknown confidence` hit `mcp-tools.md:269`; after, `client.py:258` and no `unknown confidence` hit. RED → GREEN was shown with an uncommitted scratch probe (`.sdd-logs/probe_step13.py`, three cases mirroring Step 14 plus a non-zero case): 2 failed / 1 passed before the change, 3 passed after. The probe is not staged; Step 14 commits the real tests.
**Reason**: No existing agent test changes result under Step 13 (Step Dependencies), and `tests/test_client.py` is outside Step 13's **Files** (F-08). **Disposition**: in-scope TDD evidence, no scope change.

### Deviation: Step 14 — test: agent client sets presence only when conviction is given
**Spec said**: `**TDD**: red-green required`; RED "today: the flag is `False`".
**Actual**: Step 13 had already landed, so the new tests pass on the branch tip. RED ran the Verification block with `services/xstockstrat-agent/app/client.py` temporarily checked out from `385ce947` (pre-Step-13) and restored before GREEN: 1 failed (`test_explicit_zero_conviction_sets_presence`, `assert False is True`). `test_omitted_conviction_leaves_presence_unset` passes on both trees because it pins the unchanged not-given behaviour. That block printed `exit=0` because its last command (ruff) passed.
**Reason**: Step 13 lands before Step 14 (Step Dependencies; not an atomic unit). **Disposition**: in-scope TDD evidence, no scope change.

### Deviation: Steps 16-18 — dropped
**Spec said**: Steps 16-18 add ingest migration `019_retract_fabricated_fundsignals`, its `ingest-019.sql` assertion fixture and the cross-schema docs, behind Operator Gates 1, 2 and 4.
**Actual**: The three steps are removed from the step list and recorded in § Dropped Steps. Operator Gates 1, 2 and 4 are answered or moot; `@AC-4` has no covering step.
**Reason**: The operator's Step 16 SELECT returned `(0 rows)` on DO staging and homelab staging (production out of scope), and the operator ruled "Drop 16-18 (Recommended)" on 2026-11-27. **Disposition**: operator-approved scope reduction.
