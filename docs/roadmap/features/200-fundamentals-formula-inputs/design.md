# Design: fundamentals-formula-inputs (feature 200)

Debated, user-approved architecture (sdd-design Phase 1, **full** mode — **3 rounds**). Every claim cites
`recon.md` `path:line`. Supersedes the initial `formula-signal-producer` mis-scope. R3 (user-requested
extra round) corrected four load-bearing seam claims R1–R2 papered over — see **Rounds** and the
`(R3)` markers below; the disjoint-kind decision itself was confirmed sound and untouched.

## Chosen Approach

A custom formula is one of **two disjoint kinds**, and its kind alone drives execution:

- **Indicator-only formula** (declares no fundamental inputs): today's behavior, **byte-identical** —
  fed `{"close": closes}`, returns a per-bar series (`evaluator.py:297-338`). Untouched.
- **Fundamentals-only formula** (declares `fundamental_inputs`): fed **only** those fundamentals as
  `ExecuteFormula.input_data` scalars (byte-parity with the signal producer's `score_fundamentals`,
  `fundamentals_scoring.py:19-72`), returns **scalar** outputs, which the evaluator **broadcasts**
  across the bar span it applies to. Never fed `close`. **(R3)** The seeded producer formula returns
  **three** scalars `{value, quality, composite}` (`fundamentals_value_quality.py:176`), where `value`
  is the *value sub-score* and `composite` is the headline. The **value-primary convention is kept**
  (bare `<ref>` → the `value` series, `evaluator.py:306/391`): a fundamentals-only component's new
  branch in `_compute_component` **decodes and broadcasts every scalar output** (not just lists), so
  `fscore` (=`value`), `fscore.quality`, and `fscore.composite` are all addressable. The headline
  score a rule gates on is the **dotted** `fscore.composite` — the field the producer reads
  (`fundsignal_loop.py:416` `scores.get("composite")`), so FR-5 parity holds. `@AC-1` was edited to
  gate on `fscore.composite`; bare-`fscore`→`value` is a documented mild footgun, mitigated by the UI
  emitting `<ref>.<output>` operands from declared outputs (`strategyCatalog.ts:213-262`).

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
`RegisterFormula`/`UpdateFormula` (structural, automatic for a closed enum) — **rejecting the
`FUNDAMENTAL_METRIC_UNSPECIFIED` zero-value sentinel `INVALID_ARGUMENT`**.

**(R3) Where FR-7/`@AC-6` is enforced (traceability relocation).** Because `fundamental_inputs` is a
closed enum on `FormulaDefinition`, a non-member is **structurally unrepresentable**, so the only
invalid value is the zero-value sentinel and the natural enforcement point is **indicators
`RegisterFormula`/`UpdateFormula`**, not the analysis `ManageStrategy` write. `@AC-6`'s scenario body
was moved to that path (id preserved, C-15). The user chose to **keep the enum** (R3 sign-off) over
the proposer-recommended `repeated string` reversal — see Rejected Alternatives — accepting the C-04
cost: the enum is a **4th representation** of the metric vocabulary (alongside `marketdata.Fundamentals`
fields, analysis `_FUNDAMENTAL_METRICS` `evaluator.py:122-134`, and UI `strategyCatalog.FUNDAMENTAL_METRICS`)
and needs **one** enum→field-name/`data`-key lowering site — the analysis loader boundary where the
`input_data` dict is built (§Analysis evaluator), which is the single place the map lives (never
re-hand-typed elsewhere).

**Analysis evaluator. (R3 — routing-map source corrected.)** The `{formula_id: [metric]}` map is
built at **eval time** from the **existing per-component `GetFormula` warmup prefetch** —
`declared_formula_warmups` (live, `evaluator.py:399-424`) and the backtest servicer's
`_declared_formula_warmup` sibling — **extended** to also read the declared `fundamental_inputs` off
the same `GetFormula` response; **no new RPC**. It is **not** read from `_fetch_formula_outputs`
(`servicer.py:537`): that runs at `ManageStrategy` **write** time and is **not persisted** on the
definition, so it is unavailable at `RunBacktest`/live eval. The prefetch already runs **before** the
per-symbol loader loop (to size warmup), so the map is available to both the loader predicate and the
evaluator routing.

**Routing predicate (R3).** `_definition_has_fundamental` (`servicer.py:5048`) matches **only**
`COMPONENT_KIND_FUNDAMENTAL`, so a strategy whose only fundamentals consumer is a `CUSTOM_FORMULA`
would short-circuit the loader to `None` and the formula would be fed nothing (silent hold). A **new
predicate** `_definition_wants_fundamentals_formula(definition, formula_fund_map)` returns True when
any `CUSTOM_FORMULA` component's `formula_id` maps to a non-empty declared-input list; **both** loaders
short-circuit on `_definition_has_fundamental(...) OR _definition_wants_fundamentals_formula(...)`, and
`_needs_eval_dates` (`evaluator.py:63`) gets the same extension so a backtest PIT run gets its bar-date
timeline. A `formula_fundamentals` routing map is threaded into `evaluate`/`evaluate_with_series`/
`evaluate_conditions_traced`/`_assemble_component_series`/`_compute_component` exactly like feature-152's
`benchmark_bars` (`evaluator.py:368,297`); `_compute_component` routes `comp.formula_id ∈ map` → the new
fundamentals-only branch, else the indicator-only path is **byte-identical** (@AC-7). **Residual (R3):**
an unreachable `GetFormula` (RpcError) caches empty (`evaluator.py:422`), so a fundamentals formula then
routes as indicator-only, is fed `close`, and raises `FormulaExecutionError` — **fail-loud**, not a
silent wrong score (matches the existing soft-delete degradation). For a fundamentals-only component:
- **Backtest (PIT):** per metric, the as-of scalar via feature-198 `_fundamental_as_of_series`
  (`evaluator.py:69`, strict `filed_date < bar_date`) off `_load_fundamentals` (`servicer.py:1452`);
  detect **filing-boundary epochs** and call `ExecuteFormula` **once per epoch**, broadcasting the
  scalar outputs across the epoch span → **O(filings), not O(bars)**. Because a fundamentals-only
  formula never receives `close[]`, the epoch value cannot depend on bar position and **no future bar
  can leak** — the look-ahead risk is **structurally impossible**, not a trusted invariant *(adversary
  conceded R3)*. **Two spec-time pins (R3):** (1) an epoch is a contiguous span where the tuple of
  **per-metric `_fundamental_as_of_series` values** is constant — derive it from the as-of series
  (which encodes the `None→value` T+1 step and a `value→None` metric-drop), **not** raw filing rows;
  (2) a **pre-first-filing / all-`None` epoch skips `ExecuteFormula` entirely and emits `None`** — never
  call the formula with an all-`None` dict (the seeded formula's `… else 0.5` fallbacks,
  `fundamentals_value_quality.py:152/170`, would otherwise **fabricate** a 0.5 composite, violating
  FR-6/@AC-5). A **partial** dict (some declared metrics present) **is** passed — the formula's `_get`
  returns `None` for absent keys and averages the present sub-parts (producer parity, FR-5).
- **Snapshot (live / screener / readiness / opportunities / GetIndicatorSeries): (R3 — separate
  loader.)** This path does **not** flow through `_load_fundamentals` (that is the PIT/
  `GetHistoricalFundamentals` loader). A **new sibling `_load_fundamentals_snapshot(definition, symbol,
  meta, formula_fund_map, …)`** mirrors its shape: short-circuit `None` if no fundamentals-formula
  component is present, read the **same** gate (below), call `GetFundamentalsMulti([symbol])`
  (`marketdata_service.go:1256`), return the one `Fundamentals` row (or `None`). The live loop carries
  its own twin (as it does for `_load_fundamentals`, `live_loop.py:585`). The `input_data` dict is built
  from the `Fundamentals` row **exactly as the producer builds it** for `score_fundamentals`
  (`fundamentals_scoring.py:44-46`), so `@AC-4`'s "same `input_data` keys" holds byte-for-byte. `@AC-3`
  ("no `GetHistoricalFundamentals` on the live path") is satisfied structurally.
- **Degradation (FR-6):** if a declared metric is in the symbol's `missing_metrics`
  (`marketdata.proto:194-221`, null-not-zero) or the symbol has no fundamentals row, **skip
  `ExecuteFormula` and emit `None`** for that span (quiet hold) — never a fabricated `0.0`, never the
  feature-190 `"unavailable"` sentinel (which is reserved for a bars/price fetch failure). A genuine
  formula crash still raises `FormulaExecutionError` unchanged (`evaluator.py:311-313`).

**Gate — two chokepoints, one key (R3 — corrected).** The prior "one switch at `_load_fundamentals`,
no asymmetry" claim was **false**: `_load_fundamentals` is the PIT loader, and the snapshot path
deliberately bypasses it (above). So the fundamentals-formula operand reads the **same**
`analysis.backtest.fundamentals.enabled` key at **two enforcement sites** — the PIT loader
(`servicer.py:1472`, `get_bool`, HasField) **and** the new `_load_fundamentals_snapshot`. One **key**,
two **sites** (honestly recorded; a future gate change touches both). This is **not** the 198 precedent
the prior draft claimed — 198's *live* operand routes through the PIT `_load_fundamentals`
(`live_loop.py:585`, gate `:597`); feature 200's snapshot path does not, hence the second site.
**C-05 key-name check — not a landmine:** that key is already the documented platform-wide fundamentals
kill-switch across **every** surface (backtest, live, readiness, materializer, `ListOpportunities`,
`GetIndicatorSeries` — see the key's row in `services/xstockstrat-analysis/CLAUDE.md`), so reusing it
here is same-domain, same `value_type` (bool), same read — **no rewiden, no new key, no config-ui seed
gap**, avoiding the C-10(b)/F-11 value_type-immutability cost of minting one. The `.backtest.` token is
a **pre-existing 198 misnomer**; renaming it is itself a config migration + immutability concern and is
**out of scope**.

**Write-time validation & fingerprint.** A `source_symbol` component that also declares
`fundamental_inputs` is rejected `INVALID_ARGUMENT` at strategy write for v1 (a component is a
benchmark operand XOR a fundamentals-formula operand) — resolves the undefined composition the
adversary flagged; benchmark-fundamentals blends are deferred. The formula-component metric declaration
rides the existing `GetFormula`-at-write seam (`servicer.py:535`) + ANALYSIS-6 soft-delete guard
(`:586`).

**Warmup — 0 bars for a fundamentals-only formula (R3).** A fundamentals-only formula consumes no
`close`, so its stored `FormulaDefinition.warmup_period` (a **bars** prefix) is meaningless. In the
extended `GetFormula` prefetch, when a formula's `fundamental_inputs` is non-empty, **cache its warmup
as `0`** regardless of the stored value (`declared_formula_warmups` / `_declared_formula_warmup`,
`evaluator.py:399-424`). Every `required_prefix_bars` caller then reads 0 for it with **no change to
`warmup.py`** (least mechanism) — preventing spurious warmup bars that would raise a false
`INSUFFICIENT_DATA`/`CoverageGap` and collide with `@AC-4 @feature-152`.

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
- **`repeated string fundamental_inputs`** — considered twice, **declined both times**. In R2 it lost
  to the enum on C-04 (closed set). **(R3)** the proposer *recommended reversing* to it — validated at
  the analysis write seam against the existing `_FUNDAMENTAL_METRICS` allow-list — arguing the enum is
  not truly a single source (`marketdata.Fundamentals` fields + analysis `_FUNDAMENTAL_METRICS` + UI
  list all persist, so the enum is a 4th representation + a lowering map, inside the input-shape-agnostic
  indicators sandbox). **The user reviewed the tradeoff at the R3 sign-off gate and chose to keep the
  closed enum** (C-04 compile-time proto safety), accepting the 4th-representation + one-lowering-site
  cost and the `@AC-6`-to-indicators relocation. So the enum stands by **explicit user decision**, not
  an unexamined premise. `extra_metrics` (open keys) remain out of scope for v1.
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
  keyed on `bar.time`, never `bar.timestamp`/MagicMock. Also (fails.md:1853) the epoch/broadcast RED
  test must assert the **mid-window** filing-boundary transition, not just ragged start/end, or the
  no-look-ahead assertion is toothless.
- **(R3) Two-site gate maintenance (accepted):** the gate is read at both the PIT loader and
  `_load_fundamentals_snapshot` (+ the live twin) — a future change to the gate logic must touch both.
  Recorded honestly rather than hidden behind a false "single chokepoint" claim. → Open Threads.
- **(R3) bare-`<ref>`→`value` footgun (mitigated):** a strategist referencing bare `fscore` gets the
  `value` sub-score, not the `composite` headline. Mitigated by the UI dropdown surfacing
  `<ref>.composite`; documented as a convention, not a defect.
- **(R3) `GetFormula` RpcError routes fundamentals formula as indicator-only:** an unreachable
  `GetFormula` during the warmup prefetch caches an empty map, so the formula is fed `close` and raises
  `FormulaExecutionError` — **fail-loud** (a formula-error diagnostic), never a silent wrong score.
  Matches the existing soft-delete degradation path; accepted.

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
- **PRESERVE** `@AC-3`/`@AC-4` `@feature-198` **(R3, Objection-6)** — the single-metric operand's
  as-of read hides a filing until the day *after* filed (strict `filed_date < bar_date`, T+1) and
  resolves with no look-ahead. Feature 200's backtest epoch model uses the **same**
  `_fundamental_as_of_series` (`evaluator.py:69`), so it inherits and must not weaken these. (198's
  scenarios promote into `services/xstockstrat-analysis/acceptance/` at 198 launch — this is a
  forward-reference PRESERVE; feature 200 must not regress them when its own `@AC-*` promote.)
- **PRESERVE** feature-198's `analysis.backtest.fundamentals.enabled` **gate-off ⇒ hold** semantics —
  now enforced on the snapshot loader too (two sites, one key): off ⇒ the operand reads all-`None`/hold
  on every surface.
- No existing rule is **CHANGED** → no C-16 sign-off required. (The as-of hold-forward is a *new*
  branch, not a reinterpretation of AC-3's daily-bar no-forward-fill.)

## Rounds

**3 (full mode).** R1: proposer's `input_schema` fork rejected by the adversary (not fingerprinted →
reproducibility regression); user chose the `FormulaDefinition` field + fundamentals+close +
198-merged-new-branch. R2: proposer resolved the five residuals (fingerprint accepted, no-forward-fill
preserved, single gate, inherited concurrency, quiet-hold); adversary confirmed the epoch model correct
& bounded but flagged blend/look-ahead + gate/DRY specifics; user then **superseded the blend** with
disjoint categories, which structurally dissolves the blend risks. Approved at the R2 gate.

**R3 (user-requested extra round).** Adversary returned **NEEDS WORK** — four MAJOR seam collisions
R1–R2 papered over: (1) the snapshot path does **not** flow through `_load_fundamentals`, so the
reused gate did not gate it ("single chokepoint" false); (2) `_definition_has_fundamental` matches only
`COMPONENT_KIND_FUNDAMENTAL`, so a fundamentals *formula* would silently get no inputs, and the metric
map cannot come from the write-time `_fetch_formula_outputs`; (3) bare-`<ref>` resolves to `value`, but
`@AC-1`/`@AC-4` assume the `composite` headline; (4) `@AC-6`/FR-7 validation no longer matches the
disjoint-kind + closed-enum model. Plus Obj-6 (feature-198 `@AC-*` missing from PRESERVE) and Obj-7
(enum DRY/home-of-truth). The **epoch model** and look-ahead impossibility were **conceded correct**.
Proposer resolved MAJOR-1/-2/-3/-5 + Obj-6 as seam-level mechanism fixes (two chokepoints/one key,
eval-time prefetch routing map + new predicate, scalar-broadcast keeping value-primary with `@AC-1` on
`fscore.composite`, 0-warmup, 198 PRESERVE) — none re-opens the disjoint-kind decision. MAJOR-4/Obj-7
(the one item needing sign-off) went to the **user, who chose to keep the closed `FundamentalMetric`
enum**, accepting the C-04 4th-representation cost and relocating `@AC-6` to indicators `RegisterFormula`.
No Floor breach; still no rule CHANGED → still no C-16 sign-off. **Termination: user-approved at the R3
gate; status remains `design-approved`.**
