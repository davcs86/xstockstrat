# Recon: fundamentals-formula-inputs (feature 200)

Grounded codebase dossier (sdd-design Phase 0). Every claim is `path:line`-cited from the per-service
`codebase-discovery` digests; unfound things are in **Risks / Not-found**, never guessed (F-04, P-03).

## Objective

Let a **custom formula used as a strategy component** (`COMPONENT_KIND_CUSTOM_FORMULA`) consume
**fundamentals as inputs** — the same `input_data`→`output` contract as the fundamentals *scoring
formula* (feature 063) — so a strategist authors one fundamentals-scoring formula and drives strategy
entry/exit rules with it. Fundamentals are **context-dependent**: point-in-time as-of each bar in a
backtest (feature-198 PIT store), current snapshot in live/screener/readiness/opportunities/GetIndicatorSeries.
No background loop, no signal emission.

## Codebase Map

**xstockstrat-indicators** (last migration `005`):
- `ExecuteFormula` handler: `input_data` Struct → `MessageToDict` → sandbox `data` dict, verbatim —
  `app/handlers/servicer.py:133,145-153`; sandbox injects it as `data`, params as `params` —
  `app/services/sandbox.py:159-165`; formula assigns `result` → `output` Struct — `sandbox.py:170-171`,
  `servicer.py:181-186`. **The sandbox is input-shape-agnostic: arrays and scalars coexist in `data`.**
- `FormulaDefinition`: `input_schema` map<string,string> (field 9, "expected input keys/types") is
  **legacy advisory, NOT validated** — `packages/proto/indicators/v1/indicators.proto:132-148`,
  `services/xstockstrat-indicators/CLAUDE.md:51`; `parameters` (10) / `outputs` (11) / `warmup_period`
  (12) are the validated declarations. `GetFormula` DB→proto mapping — `servicer.py:441-457`.
- Seeded fundamentals-scoring formula `fundamentals_value_quality.py` (id `d1ff5e6b-…`,
  `AUTHOR="system"`, `IS_PUBLIC=True`): reads `pe_ratio/pb_ratio/dividend_yield/roe/debt_to_equity/eps`
  from `data`, outputs `quality/composite`(+implicit `value`) — `app/formulas/fundamentals_value_quality.py:22-28,128-176`.
  **System-author mutation protection EXISTS** (Update/Delete refuse `author="system"` with
  PERMISSION_DENIED) — `servicer.py:315-318,412-415` (fails.md:76 trap already closed).

**xstockstrat-analysis** (last migration `023` on main-dev; next free `024`):
- Custom-formula compute: `_compute_component` dispatch — `app/services/evaluator.py:276`; CUSTOM_FORMULA
  request builds `input_data={"close": closes}`, numeric `comp.params`→`input_params` (never mixed) —
  `evaluator.py:297-310`; response parse `MessageToDict(resp.output)`, strict `len(raw)==n` else
  `FormulaExecutionError`, requires a `"value"` series — `evaluator.py:311-338`.
- Single seam `_assemble_component_series(comp, closes, eval_dates, benchmark_bars=None)` behind
  backtest/live/readiness/opportunities/GetIndicatorSeries — `evaluator.py:368`; empty `source_symbol`
  delegates to `_compute_component` (`:398`).
- Consumer call sites (main-dev line numbers): backtest `_backtest_symbol_evaluated` `servicer.py:1512`;
  `EvaluateReadiness` `:2790`; `_compute_opportunities` `:3861`; `GetIndicatorSeries` `:3290`; live
  `_eval_pair` `app/engine/live_loop.py`.
- Write-time formula validation: `_fetch_formula_outputs` GetFormula per component, `allowed={"value"}∪outputs`
  — `servicer.py:542-558`; `_refuse_deleted_bindings` (ANALYSIS-6) — `:586`; `_validate_definition_proto`
  — `:599-613`; ManageStrategy REGISTER `:2395/:2470/:2506`, UPDATE `:2566`.
- Snapshot fundamentals: `fundsignal_loop._paced_fetch` `GetFundamentalsMulti` → `{symbol: Fundamentals}`
  — `app/engine/fundsignal_loop.py:346-372`; screener — `app/services/screener.py:187-192`;
  `score_fundamentals` I/O — `app/services/fundamentals_scoring.py:19-72` (whole raw dict→`input_data`,
  reads `output.{value,quality,composite}`).
- Test factory `make_servicer()` stubs `get_float/get_str/get_int/get_int_present/get_float_present`
  (**not `get_bool`**) — `tests/test_analysis_servicer.py:35-55`; real `Bar` builder `_bar(sec,…)` sets
  `b.time.seconds` — `:1385-1395`; `conftest.py` is a proto-path shim only.

**xstockstrat-marketdata** (`GetFundamentalsMulti` fully wired):
- RPC `marketdata.proto:44`; `Fundamentals` message fields 1–12 = the 11 metrics + symbol, plus
  `extra_metrics(13) as_of(14) currency(15) source(16) stale(17) missing_metrics(18)` —
  `marketdata.proto:200-221`. **Null-not-zero contract**: a `0.0` is real only if absent from
  `missing_metrics` (`:194-199`). Handler `internal/handler/marketdata_handler.go:182-191`; service
  cache/fetch `internal/service/marketdata_service.go:1256-1302`. **No `filed_date` field** (only `as_of`).

**xstockstrat-ui**:
- `ComponentEditor` custom-formula branch: Combobox over `formulas.map(f=>f.formulaId)`, pre-fills
  numeric params, renders params (not inputs) — `src/components/insights/ComponentEditor.tsx:56,68-77,114-176`;
  `StrategyComponentDraft` mirrors proto, **no inputs field** (`:31-37`). `StrategyWizard` maps drafts
  → ManageStrategy verbatim — `StrategyWizard.tsx:180-203`; collects declared `outputs`→`FormulaOutputsMap`
  (`:150-163`). `operandRefs` custom-formula branch emits bare ref + `<ref>.<output>` — `strategyCatalog.ts:213-262`.
  `FUNDAMENTAL_METRICS` (11, `DEFAULT_FUNDAMENTAL_METRIC='pe_ratio'`) — `strategyCatalog.ts:130-154`.
- e2e: reusable `FORMULA_RSI/FORMULA_MACD/FORMULAS` (`e2e/fixtures/formulas.ts`), strategy fixtures,
  `strategy-authoring.spec.ts` exercises ComponentEditor + captures the ManageStrategy payload.

## Patterns to REUSE (anti-duplication core)

- **`score_fundamentals` I/O contract** (`fundamentals_scoring.py:19-72`) — the exact "fundamentals dict
  → `input_data`, read `output.composite`" shape; the strategy path must match it (FR-5). Reuse, do not re-derive.
- **`_assemble_component_series` seam** (`evaluator.py:368`) — the single place the fundamentals input
  injection belongs, so all consumers inherit it (mirrors how feature 198 threaded its operand).
- **The `input_data` Struct** already carries arbitrary keys → **no proto change needed** for the wire;
  fundamentals scalars ride alongside `close`.
- **feature-198 `_load_fundamentals` PIT preload + `_fundamental_as_of_series` carry-forward** — the
  backtest PIT source + as-of alignment (once 198 is available; see Risks).
- **`GetFundamentalsMulti` snapshot** (`marketdata_service.go:1256`) — the live/screener/GetIndicatorSeries source.
- **Write-time GetFormula validation** (`servicer.py:542-558`) + **ANALYSIS-6 soft-delete guard**
  (`:586`) — the seam to validate a fundamentals-consuming formula and degrade a deleted one.
- **UI**: `strategyCatalog.FUNDAMENTAL_METRICS`, the `Combobox` formula picker, `FORMULA_*` e2e fixtures.
- **System-author protection** (indicators `servicer.py:315-318`) — already guards the seeded formula.

## Existing Business Rules (C-16 — the design-adversary's regression guard)

- **PRESERVE** `@AC-2`/`@AC-3` `@feature-152` (`analysis/acceptance/market-regime-benchmark-operand.feature`) — the shared `_assemble_component_series` "value at t uses only data ≤ t; missing input → hold/false; **no forward-fill**" discipline.
- **PRESERVE** `@AC-1` `@feature-152` — empty operand reproduces existing components byte-for-byte (non-fundamentals formulas unchanged; cf. this feature's @AC-7).
- **EXTEND** `@AC-4` `@feature-152` — insufficient-history coverage-gap: add a *fundamentals-missing* gap case alongside the benchmark-history one.
- **PRESERVE** `@AC-6` `@feature-152` — manage_strategy folds the component into the definition fingerprint (grade eligibility).
- **PRESERVE** `@AC-7` `@feature-152` — live evaluator resolves the component; missing datum → hold, not crash.
- **PRESERVE** `@AC-3` `@feature-151`; `@AC-4`/`@AC-10` `@feature-151`; `@AC-3`/`@AC-5` `@feature-150` — backtest no-look-ahead + byte-for-byte legacy reproducibility + derived-grade math unperturbed for no-fundamentals runs.
- **PRESERVE** `@AC-5` `@feature-176` (`indicators/acceptance/analysis-concurrency-offload.feature`) — the bounded off-loop `ExecuteFormula` concurrency + timeout (feature 200 raises call volume).
- **PRESERVE** `@AC-1` `@feature-168` — the "symbol must actually have fundamentals" availability gate.
- **PRESERVE** `@AC-3` `@feature-190` — a fundamentals-missing symbol surfaces as the `"unavailable"` opportunities sentinel, not a queue break.
- **CARRY-FORWARD ambiguity (design must resolve):** fundamentals are held-forward from their as-of/filing date until the next report — correct PIT, but superficially resembles the forward-fill `@feature-152 @AC-3` forbids for *daily benchmark bars*. Different operand type ⇒ not a change to AC-3, **but design.md must state the fundamentals alignment explicitly and confirm it does not weaken AC-3 for the shared seam**; altering the seam's forward-fill for any operand would be a **CHANGE needing user sign-off** (C-16).
- **C-16 blind spot:** feature 198's `@AC-*` are not in the durable suites (198 unmerged); read them from `origin/<198 branch>` `acceptance.feature` directly, don't assume this recon covers them.

## Dependencies

- **Proto:** likely NONE for the wire (`ExecuteFormula.input_data` already a Struct). A *declaration*
  mechanism (how the evaluator knows a formula wants fundamentals) MAY need an additive `FormulaDefinition`
  field OR may reuse the unvalidated `input_schema` (design fork).
- **Migration:** NONE (reuses feature-198 PIT store + marketdata cache). Next free analysis NNN would be 024 if one were needed.
- **Config:** reuse feature-198 `analysis.backtest.fundamentals.enabled` (no new key) — but that key is unmerged (see Risks).
- **Inter-service edges:** analysis→indicators `ExecuteFormula` (existing), analysis→marketdata `GetFundamentalsMulti` (existing) + `GetHistoricalFundamentals` (feature-198, unmerged). No new env var / port.
- **Consumer surfaces (C-14):** UI `ComponentEditor`/`StrategyWizard` (existing), agent `manage_strategy` (existing) — no new page/tool.

## Risks / Not-found

- **⚠ DOMINANT — feature 198 (PIT) is entirely unmerged on `main-dev`.** No `_load_fundamentals`,
  `_fundamental_as_of_series`, `GetHistoricalFundamentals`, `HistoricalFundamentalsPeriod`, `filed_date`,
  or `analysis.backtest.fundamentals.enabled` exists on `main-dev` (confirmed by both the analysis and
  marketdata digests). Feature 200's branch is off `main-dev`, so its **backtest PIT path has a hard
  build-order dependency on feature 198 (PR #1158)**. Delivery options (design/gate decision): (a) stack
  feature 200 on the 198 branch; (b) ship the snapshot path first and the PIT/backtest path after 198
  merges; (c) block feature 200 until 198 merges. Needs a merge-order.md row.
- **Central design fork:** no existing mechanism lets a formula declare it needs fundamentals inputs
  (`input_schema` is unvalidated). Options: activate `input_schema`; add an additive declared-inputs
  field; a `StrategyComponent` flag; or infer from declared names. The evaluator needs *some* signal so
  it only PIT-fetches for formulas that actually consume fundamentals (fetch cost).
- **Snapshot has no `filed_date`** — the live/screener path is inherently "as of now"; only the backtest
  path needs PIT. Confirms the "both by context" split.
- **`get_bool` not stubbed** in `make_servicer` (fails.md:1395) — a gate-reading test step must add it.
- **Real `Bar` fixtures** required (`bar.time`, not `bar.timestamp`) — fails.md:727.
- **ExecuteFormula call-volume increase** — a per-bar recompute in backtest would be O(bars×symbols);
  the design must recompute only when the as-of fundamentals change (filing boundaries) + carry forward.
- Doc/tree drift: analysis `CLAUDE.md` cites migrations 026/027/028 not on disk (other unmerged features) — not a feature-200 blocker.

## Recommended Scope (advisory — for the debate + /sdd-spec)

1. **Declaration mechanism** for "this formula consumes fundamentals inputs X" (the central fork).
2. **Analysis evaluator**: in `_assemble_component_series`/`_compute_component`, when a formula component
   declares fundamentals inputs, build the fundamentals `input_data` (PIT-as-of-bar in backtest, snapshot
   elsewhere), merge with `close`, call ExecuteFormula, map `output` → the component series (carry-forward
   at filing boundaries in backtest).
3. **Write-time validation**: the declared fundamentals inputs are in the allowed set (reuse GetFormula seam).
4. **Tests** (analysis): PIT no-look-ahead, snapshot path, degradation, byte-identity for non-fundamentals formulas.
5. **UI/agent**: surface/allow authoring such a formula component (may be minimal — the picker already lists formulas).
6. **Sequencing**: resolve the feature-198 dependency (stack / snapshot-first / block).
</content>
