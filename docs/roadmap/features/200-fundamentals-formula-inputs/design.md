# Design: fundamentals-formula-inputs (feature 200)

Debated, user-approved architecture (sdd-design Phase 1, **full** mode — 2 rounds). Every claim cites
`recon.md` `path:line`. Supersedes the initial `formula-signal-producer` mis-scope.

## Chosen Approach

A custom formula is one of **two disjoint kinds**, and its kind alone drives execution:

- **Indicator-only formula** (declares no fundamental inputs): today's behavior, **byte-identical** —
  fed `{"close": closes}`, returns a per-bar series (`evaluator.py:297-338`). Untouched.
- **Fundamentals-only formula** (declares `fundamental_inputs`): fed **only** those fundamentals as
  `ExecuteFormula.input_data` scalars (byte-parity with the signal producer's `score_fundamentals`,
  `fundamentals_scoring.py:19-72`), returns a **scalar** score, which the evaluator **broadcasts**
  across the bar span it applies to. Never fed `close`.

There is **no in-formula blend** (the earlier "fundamentals + `close`" decision is superseded — see
Rounds). Blends are composed at the **rule level**: an indicator-only component + a fundamentals-only
component combined in the `entry_rule`/`exit_rule` tree (the platform's existing composition model).
This was gated on a use-case check: the **Fundamentals Signal Producer's** own scoring formula
(`fundamentals_value_quality.py`) reads no `close` (verified on merged `main-dev`), so no current
consumer needs a hybrid. A `HYBRID` category is a documented follow-on if demand appears (YAGNI, C-18).

**Declaration (indicators, Decision 1).** Add `repeated FundamentalMetric fundamental_inputs` to
`FormulaDefinition` (+ the matching field on `RegisterFormulaRequest`/`UpdateFormulaRequest`) —
`indicators.proto:132-148`. `FundamentalMetric` is a **new closed enum** (the 11 canonical metrics:
`market_cap, pe_ratio, pb_ratio, dividend_yield, eps, beta, roe, debt_to_equity, price, year_high,
year_low`) with a `_UNSPECIFIED=0` sentinel (C-04). The enum is the **single source of truth** for the
metric set — killing the "11 names hand-typed in 4 places" duplication the adversary flagged (C-18);
`marketdata.Fundamentals` field names remain the wire mapping. A non-empty `fundamental_inputs` **is**
the "fundamentals-only" category marker (no separate flag). Indicators validates enum membership at
`RegisterFormula`/`UpdateFormula` (structural, automatic for a closed enum).

**Analysis evaluator.** Analysis reads `fundamental_inputs` off the **existing** `GetFormula` fetches
— write-time `_fetch_formula_outputs` (`servicer.py:535-558`) and the live warmup prefetch
`declared_formula_warmups` (`evaluator.py:341-366`) — into a `{formula_id: [metric]}` map; **no new
RPC**. A resolved `fundamentals` context is threaded into `_assemble_component_series`/
`_compute_component` (`evaluator.py:368,297`) exactly like feature-152's `benchmark_bars`. For a
fundamentals-only component:
- **Backtest (PIT):** per metric, the as-of scalar via feature-198 `_fundamental_as_of_series`
  (`evaluator.py:69`, strict `filed_date < bar_date`) off `_load_fundamentals` (`servicer.py:1452`);
  detect **filing-boundary epochs** (contiguous spans where the metric tuple is constant), call
  `ExecuteFormula` **once per epoch** with that epoch's scalars, and broadcast the scalar across the
  epoch span → **O(filings), not O(bars)**. Because a fundamentals-only formula never receives
  `close[]`, the epoch value cannot depend on bar position and **no future bar can leak** — the
  slice-and-stitch correctness/​look-ahead risk the adversary raised is **structurally impossible**,
  not a trusted invariant.
- **Snapshot (live / screener / readiness / opportunities / GetIndicatorSeries):** one `ExecuteFormula`
  with the `GetFundamentalsMulti` snapshot (`marketdata_service.go:1256`), broadcast across all bars.
- **Degradation (FR-6):** if a declared metric is in the symbol's `missing_metrics`
  (`marketdata.proto:194-221`, null-not-zero) or the symbol has no fundamentals row, **skip
  `ExecuteFormula` and emit `None`** for that span (quiet hold) — never a fabricated `0.0`, never the
  feature-190 `"unavailable"` sentinel (which is reserved for a bars/price fetch failure). A genuine
  formula crash still raises `FormulaExecutionError` unchanged (`evaluator.py:311-313`).

**Gate (single, reused).** The fundamentals-formula operand reuses feature-198's
`analysis.backtest.fundamentals.enabled` on **all** surfaces (backtest + snapshot), enforced at the
`_load_fundamentals`/snapshot chokepoint exactly as 198 gates its single-metric operand — **one
switch, no new key, no config-ui seed gap, no gate asymmetry** (C-18/C-05/C-10).

**Write-time validation & fingerprint.** A `source_symbol` component that also declares
`fundamental_inputs` is rejected `INVALID_ARGUMENT` at strategy write for v1 (a component is a
benchmark operand XOR a fundamentals-formula operand) — resolves the undefined composition the
adversary flagged; benchmark-fundamentals blends are deferred. The formula-component metric declaration
rides the existing `GetFormula`-at-write seam (`servicer.py:535`) + ANALYSIS-6 soft-delete guard
(`:586`).

**Concurrency.** No new semaphore: the new `ExecuteFormula` calls happen inside
`_assemble_component_series`, inheriting the existing bounds — backtest is serial per symbol
(`component_sem=None`), opportunities fan-out under `analysis.opportunity.max_concurrent_candidates`
(`servicer.py:431`), live under `analysis.engine.max_strategies_per_cycle` — preserving `@AC-5`
feature-176.

## Rejected Alternatives

- **`input_schema`-activation as the routing signal** (R1 proposer) — rejected: empty on the seeded
  formula, set by no authoring surface (a user formula silently misroutes), unvalidated/mutable, and
  not fingerprinted. Would regress `@AC-6` feature-152 + reproducibility.
- **`StrategyComponent` routing field** (R1 adversary's pick) — rejected by the user in favor of the
  formula-side `FormulaDefinition` field (Decision 1); the fingerprint residual (below) is accepted.
- **`repeated string fundamental_inputs`** (R2 proposer) — rejected for the **enum** (C-04 closed set;
  enum is the single source of truth, eliminating the 4-place allow-list duplication). `extra_metrics`
  (open keys) are out of scope for v1 (the closed 11 cover the producer + feature-198 operand).
- **In-formula `fundamentals + close` blend** (Decision 2, R2) — **superseded** by disjoint categories
  after the user's separation-of-concerns question: it removes the epoch-slice/look-ahead risk
  entirely, keeps existing formulas byte-identical, restores exact producer parity, and pushes blends
  to the (more auditable) rule level. Cost: no single-formula technical×fundamental math (deferred
  `HYBRID` follow-on).
- **Per-bar recompute** — rejected: the epoch model is correct for the scalar contract at O(filings);
  per-bar would multiply `ExecuteFormula` volume against `recon.md:128-129` / `@AC-5` feature-176.
- **A second (snapshot) config gate** — rejected: reuse the one 198 gate on all surfaces (no
  asymmetry, no seed gap).
- **Snapshot-path-first / stack-on-198 sequencing** — moot: feature 198 is now merged to `main-dev`,
  so both paths build off `main-dev` on one branch.

## Open Risks

- **Fingerprint residual (accepted):** `fundamental_inputs` is formula-side, so editing it changes a
  strategy's backtest/grade without bumping the strategy's `definition_json` fingerprint
  (`_definition_fingerprint`, `servicer.py:704`). This is the **same class** as editing any formula
  body (strategies reference formulas by `formula_id`; formula edits already aren't fingerprinted) and
  is handled by the feature-086 soft-delete-on-read guard. Accepted, no mitigation. → context.md Open Threads.
- **Enum churn:** adding a 12th canonical metric later means adding an enum value in `packages/proto`
  and regenerating — the intended single-source cost (vs. a silent stale hand-typed list). → Open Threads.
- **`get_bool` test-stub gap** (fails.md:1395): `make_servicer` stubs only `get_float/get_str/get_int/
  *_present` (`tests/test_analysis_servicer.py:35-55`); the gate-reading test step must add `get_bool`.
- **Real `Bar` fixtures** (fails.md:727): the PIT/epoch and byte-identity tests use real `Bar` protos
  keyed on `bar.time`, never `bar.timestamp`/MagicMock.

## Constitution Rules Touched

- **C-04** — closed-set enum (`FundamentalMetric`) with `_UNSPECIFIED=0`, over free strings. Honored.
- **C-09** — additive proto (`fundamental_inputs`, `FundamentalMetric`); `buf lint`/`buf breaking` +
  `./scripts/buf-gen.sh`; non-breaking → 1 owner (indicators) approval.
- **C-10(c)** — the seeded `author="system"` fundamentals formula is mutation-protected already
  (`servicer.py:315-318`); its `fundamental_inputs` is set via the idempotent seed edit, never a raw DB
  backfill.
- **C-14** — consumer surfaces (UI `ComponentEditor`/`StrategyWizard`, agent `manage_strategy`) already
  reach formula components; feature makes them fundamentals-capable (formula picker "just works"; a
  read-only `fundamental_inputs` badge is optional).
- **C-16** — see Business Rules Touched.
- **C-18** — disjoint categories (SOLID single-responsibility per kind), enum single-source (DRY),
  no hybrid / no second gate / no new semaphore (YAGNI). Trade-off recorded: deferred `HYBRID`.
- **C-05/F-07** — single reused config gate, read via `WatchConfig` (`get_bool`), no hardcode.

## Business Rules Touched (C-16)

- **PRESERVE** `@AC-1`/`@AC-3`/`@AC-7` `@feature-152` — indicator-only formulas byte-identical; the
  benchmark left-join no-forward-fill path (`evaluator.py:400-428`) is untouched; the fundamentals
  as-of hold-forward is a distinct branch (a fundamentals-only formula never enters the benchmark join).
- **PRESERVE** `@AC-3`/`@AC-4`/`@AC-10` `@feature-151`, `@AC-3`/`@AC-5` `@feature-150` — backtest
  no-look-ahead + byte-for-byte legacy reproducibility + derived-grade math, for runs with no
  fundamentals-only formula.
- **PRESERVE** `@AC-5` `@feature-176` — inherited concurrency bounds; no new sem.
- **PRESERVE** `@AC-1` `@feature-168` (fundamentals-availability gate), `@AC-3` `@feature-190`
  (`"unavailable"` sentinel semantics — quiet hold does NOT map to it).
- **EXTEND** `@AC-4` `@feature-152` — add a fundamentals-missing coverage/degradation case.
- No existing rule is **CHANGED** → no C-16 sign-off required. (The as-of hold-forward is a *new*
  branch, not a reinterpretation of AC-3's daily-bar no-forward-fill.)

## Rounds

2 (full mode). R1: proposer's `input_schema` fork rejected by the adversary (not fingerprinted →
reproducibility regression); user chose the `FormulaDefinition` field + fundamentals+close +
198-merged-new-branch. R2: proposer resolved the five residuals (fingerprint accepted, no-forward-fill
preserved, single gate, inherited concurrency, quiet-hold); adversary confirmed the epoch model correct
& bounded but flagged blend/look-ahead + gate/DRY specifics; user then **superseded the blend** with
disjoint categories (this document), which structurally dissolves the blend risks. No Floor breach.
Termination: user-approved at the R2 gate.
