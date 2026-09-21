# Design: fundamentals-formula-inputs (feature 200)

Debated, user-approved architecture (sdd-design Phase 1, **full** mode — **5 rounds**, the cap). Every
claim cites `recon.md` `path:line`. Supersedes the initial `formula-signal-producer` mis-scope. R3–R5
(user-requested extra rounds) corrected load-bearing seam claims R1–R2 papered over and settled two
user forks — see **Rounds** and the `(R3)`/`(R4/R5)` markers below; the disjoint-kind decision and the
closed-enum decision were confirmed sound and left untouched across all extra rounds.

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
  (`fundsignal_loop.py:416` `scores.get("composite")`). `@AC-1` was edited to gate on
  `fscore.composite`; bare-`fscore`→`value` is a documented mild footgun, mitigated by the UI
  emitting `<ref>.<output>` operands from declared outputs (`strategyCatalog.ts:213-262`). **(R4/R5)**
  the scalar decode + broadcast is factored into a shared helper `_decode_formula_output(formula_id,
  resp, expected_n=None)` reused by **both** the indicator-only list path (`len(raw)==n` enforced) and
  the fundamentals-only scalar-broadcast path (each finite scalar broadcast across the epoch/span);
  a NaN/Inf scalar still raises `FormulaExecutionError` (fails.md:87), and a formula that returns a
  **list** output on the fundamentals path is out of contract (v1 seed is all-scalar).

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

**(R4/R5) Persistence — there IS an indicators migration (the prior "Migration: NONE" was wrong).**
For `GetFormula` to return `fundamental_inputs` at eval time, indicators must persist it: **migration
`006`** (next free NNN; last on disk `005_add_formula_soft_delete`) `ALTER TABLE indicators.formulas
ADD COLUMN fundamental_inputs JSONB NOT NULL DEFAULT '[]'` — mirroring the `003_formula_outputs`
JSONB precedent (a JSON array of `FundamentalMetric` enum ints). Plus the write in `RegisterFormula`
(mirror `servicer.py:253-254`) and `UpdateFormula`'s field-mask (mirror `:361-364/:395-396`), and the
`GetFormula` DB→proto mapping at `indicators/servicer.py:454` (today maps `parameters`/`outputs`/
`warmup_period`, not this). **Without this the routing map is always empty → every fundamentals formula
dead-routes to `FormulaExecutionError`** (the fail-loud residual would be the *normal* path). Approval
adds **DBA review** on the migration (C-07) alongside the 1 indicators owner (C-09). The seeded formula's
`fundamental_inputs` (its 6: PE_RATIO, PB_RATIO, DIVIDEND_YIELD, ROE, DEBT_TO_EQUITY, EPS) is set via
the idempotent seed edit (`seed_formulas.py`), never a raw DB backfill (C-10(c)).

**Analysis evaluator. (R3 — routing-map source corrected; R4/R5 — per-site precision.)** The
`{formula_id: [metric-data-key]}` map is built at **eval time** off `GetFormula`, **not** from
`_fetch_formula_outputs` (`servicer.py:537`) which runs at `ManageStrategy` **write** time and is not
persisted. It is **not** a single "no new RPC" story — the warmup prefetch that already issues one
`GetFormula` per formula component exists at **only 2 of the 6** evaluate surfaces (backtest
`_declared_formula_warmup`, live `declared_formula_warmups` `evaluator.py:399-424`); the other 4
(readiness/opportunities/GetIndicatorSeries/materializer) build no warmup cache. So **(R4/R5)**:
- at **backtest + live**, fold the `fundamental_inputs` read into the **same** prefetch `GetFormula`
  (no new RPC there) — populating a **separate parallel `fund_map`**, never overloading the warmup
  cache whose value must stay an `int` (`warmup.py:143` does `int(cache.get(id,0) or 0)`);
- at the other 4 surfaces, a **new shared builder `_formula_fundamentals(definition, meta, *,
  cache=None)`** issues a **bounded, per-pass-memoized** `GetFormula` fan-out (one per distinct
  formula id; `cache` dedups across symbols in an opportunities/materializer pass, mirroring
  `_load_fundamentals`'s `cache` arg) — recorded honestly as a new call at those 4 sites.
The map is built **before** the per-symbol loader loop, so it is available to the loader predicate and
to the evaluator routing at every site.

**Routing predicate (R3) + branch placement (R4/R5).** `_definition_has_fundamental` (`servicer.py:5048`)
matches **only** `COMPONENT_KIND_FUNDAMENTAL`, so a strategy whose only fundamentals consumer is a
`CUSTOM_FORMULA` would short-circuit the loader to `None` and the formula would be fed nothing (silent
hold). A **new predicate** `_definition_wants_fundamentals_formula(definition, formula_fund_map)` returns
True when any `CUSTOM_FORMULA` component's `formula_id` maps to a non-empty declared-input list; **both**
loaders short-circuit on `_definition_has_fundamental(...) OR _definition_wants_fundamentals_formula(...)`.
**(R4/R5, C-10 — all 6 sites):** the routing map + `_needs_eval_dates(definition, formula_fund_map)`
(`evaluator.py:60-66`, signature extended) must be wired at **every** evaluate surface — backtest
(`servicer.py:1595`), EvaluateReadiness (`:2922`), GetIndicatorSeries (`:3400`), ListOpportunities
(`:3833/:3909`), the readiness materializer (`:4376/:4654`), and live (`live_loop.py:628`) — because a
site that computes `eval_dates` without the map returns `False` → `eval_dates=None` → the branch
broadcasts nothing → silent hold. The `formula_fundamentals` map threads through `evaluate`/
`evaluate_with_series`/`evaluate_conditions_traced`/`_assemble_component_series` exactly like
feature-152's `benchmark_bars`. **The fundamentals-only branch lives in `_assemble_component_series`
(`evaluator.py:426-464`), NOT `_compute_component`** — `_compute_component(comp, closes)` (`:334`) has
neither `eval_dates` nor the filing list, so it structurally cannot do PIT epochs (this would make
`@AC-2` unsatisfiable); the branch sits right after the existing `COMPONENT_KIND_FUNDAMENTAL` block
(`:459`), gated on `comp.formula_id ∈ formula_fund_map`. Indicator-only components stay
**byte-identical** through `_compute_component` (@AC-7). **Residual (R3):** an unreachable `GetFormula`
caches empty, so a fundamentals formula then routes as indicator-only, is fed `close`, and raises
`FormulaExecutionError` — **fail-loud**, not a silent wrong score. For a fundamentals-only component:
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
  FR-6/@AC-5).
- **Partial-row feed — OMIT ABSENT (R4/R5, user decision, option b).** When a symbol has *some* (not
  all) declared metrics, the `input_data` dict **omits** the absent/`missing_metrics` keys entirely, so
  the formula's `_get` returns `None` for them and only the **present** sub-parts are averaged (a
  non-reporting symbol is **not** penalized). This **diverges** from the producer, which passes
  proto-zero `0.0` for every declared key unconditionally (`fundsignal_loop.py:404-411`) — so the seeded
  formula scores a producer-fed missing PE as a hard `0.0` (`:131`) but a strategy-fed missing PE as
  a neutral drop. **FR-5 is therefore narrowed** to "identical I/O for **fully-populated** rows"
  (`@AC-4`), with a **new `@AC-8`** covering the partial-row divergence. This is a **CHANGE** to FR-5's
  guarantee → **user sign-off recorded** (context.md; option (a) proto-zero-parity was declined). The
  rejected alternative (a) would have preserved exact parity but penalized non-reporting symbols and
  risked an early-window backtest-vs-live scoring skew — see Rejected Alternatives.
- **Snapshot (live / screener / readiness / opportunities / GetIndicatorSeries): (R3 — separate
  loader; R4/R5 — 1-epoch unification + sem/cache.)** This path does **not** flow through
  `_load_fundamentals` (the PIT/`GetHistoricalFundamentals` loader). A **new sibling
  `_load_fundamentals_snapshot(definition, symbol, meta, formula_fund_map, *, sem=None, cache=None)`**
  mirrors its shape: short-circuit `None` if no fundamentals-formula component is present, read the
  **same** gate (below), call `GetFundamentalsMulti([symbol])` (`marketdata_service.go:1256`). It
  **must** carry the same `sem`+`cache` each site already passes to `_load_fundamentals`
  (`servicer.py:1453`) so the per-symbol fan-out stays bounded and dedups within a pass (preserving
  `@AC-5` feature-176); a **deferred** better-alternative is one 50-wide `GetFundamentalsMulti(chunk)`
  batch per pass (producer-style, `fundsignal_loop.py:346`). **(R4/R5) One code shape:** the snapshot
  row is lowered into a **one-element `list[FundamentalPeriod]`** with a `filed_date` sentinel
  (`date.min`) strictly before every bar, so the **same** `_fundamental_as_of_series` (`evaluator.py:69`)
  broadcasts it across all `n` as a single degenerate epoch — the PIT and snapshot paths share one
  `fundamentals: list[FundamentalPeriod]` channel and one branch; the only discriminator is which loader
  ran. The `input_data` dict is built from that channel **identically for fully-populated rows** to how
  the producer builds it (`fundamentals_scoring.py:44-46`), so `@AC-4` holds for full rows (partial rows
  diverge by design, `@AC-8`). `@AC-3` ("no `GetHistoricalFundamentals` on the live path") is satisfied
  structurally.
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
`evaluator.py:399-424`). This writes `int 0` into the existing `{formula_id:int}` warmup cache (the
`fundamental_inputs` list lives in the **separate** parallel `fund_map`, never overloading the cache
value into a tuple — `warmup.py:143` needs an `int`). `required_prefix_bars` maxes over components
(`warmup.py:138-147`), and `max` is monotonic, so a `0`-warmup fundamentals formula **cannot shrink** a
sibling indicator component's prefix *(adversary conceded R4)* — no `@AC-4`/`@AC-7 @feature-152`
regression. Prevents spurious warmup bars that would raise a false `INSUFFICIENT_DATA`/`CoverageGap`.

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
- **Partial-row = proto-zero parity (option a, R4/R5)** — **declined by the user** in favor of
  omit-absent (option b). (a) would pass all declared keys with `0.0` for absent metrics, byte-matching
  the producer (`fundsignal_loop.py:404-411`) and preserving FR-5/@AC-4 exactly with no C-16 change and
  the least mechanism. Rejected because it **penalizes** a symbol for every metric its filing didn't
  report (seeded formula scores missing PE as a hard `0.0`, `:131`), and over a long PIT window with
  sparse early filings this can systematically depress early-window backtest composites vs the fuller
  live snapshot — a backtest-vs-live scoring skew `@AC-4`'s single-as-of parity test would not catch.
  The user accepted the C-16 cost of (b) (FR-5 narrowed, new `@AC-8`) to get the better model.
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
- **(R4/R5) New `GetFormula` fan-out at 4 of 6 evaluate surfaces (accepted):** readiness/opportunities/
  GetIndicatorSeries/materializer have no warmup prefetch, so `_formula_fundamentals` adds one memoized
  `GetFormula` per distinct formula id per pass there (bounded by the per-pass `cache`). Recorded
  honestly, not hidden behind "no new RPC". Deferred better-alternative: a 50-wide batched
  `GetFundamentalsMulti` per pass on the snapshot path. → Open Threads.
- **(R4/R5) Partial-row producer divergence (accepted, C-16 sign-off):** option (b) omit-absent means a
  fundamentals formula's partial-row score in a strategy differs from the same formula's score in the
  producer. FR-5 is narrowed to full rows + `@AC-8` guards the divergence; the user signed off. The
  modeling upside (no penalty for non-reporting symbols, no early-window skew) is why (a) was declined.

## Constitution Rules Touched

- **C-04** — closed-set enum (`FundamentalMetric`) with `_UNSPECIFIED=0`, over free strings. Honored.
- **C-01** *(R4/R5)* — the eval-time routing map is only grounded once `fundamental_inputs` is
  **persisted** and returned by `GetFormula`; the design now carries that mechanism (migration `006` +
  Register/Update writes + GetFormula mapping) rather than the false "Migration: NONE".
- **C-07** *(R4/R5)* — indicators migration `006_add_formula_fundamental_inputs` (`.up.sql`/`.down.sql`),
  `NNN` = last (`005`) + 1; JSONB precedent `003_formula_outputs`. Adds a **DBA** review gate.
- **C-09** — additive proto (`fundamental_inputs`, `FundamentalMetric`); `buf lint`/`buf breaking` +
  `./scripts/buf-gen.sh`; non-breaking → 1 owner (indicators) approval + DBA on the migration.
- **C-10(c)** — the seeded `author="system"` fundamentals formula is mutation-protected already
  (`servicer.py:315-318`); its `fundamental_inputs` is set via the idempotent seed edit, never a raw DB
  backfill.
- **C-14** *(R4/R5 — no longer "optional").** The UI already surfaces it: `operandRefsForComponent`
  (`strategyCatalog.ts:213-244`) emits `<ref>.<output>` per declared output (so `fscore.composite`/
  `fscore.quality` appear in the rule dropdown) and the `Combobox` picker lists the formula — no
  surfacing gap. The residual footgun (gate-OFF default + bare-`fscore`→`value` = a silently-inert rule)
  is closed by scoping a **minimal read-only badge** in `ComponentEditor.tsx` (when the picked formula's
  `fundamental_inputs` is non-empty: "Fundamentals input — requires the fundamentals gate ON; use
  `.composite` for the headline") — one read-only affordance, no new route/write. If deferred, C-14
  requires the named follow-up **`insights-fundamentals-formula-affordance`** (recorded in context.md
  Open Threads); the design ships the badge.
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
- No existing **durable** rule is **CHANGED** → no C-16 sign-off required. (The as-of hold-forward is a
  *new* branch, not a reinterpretation of AC-3's daily-bar no-forward-fill.)
- **(R4/R5) Feature-200's own FR-5 narrowed + new `@AC-8`.** FR-5 is narrowed from "identical I/O,
  producer vs strategy" to "identical for **fully-populated** rows" (`@AC-4`), with **new `@AC-8`**
  covering the partial-row omit-absent divergence. This edits *this feature's own* not-yet-promoted
  acceptance scenarios (C-15, allowed pre-launch) — **not** a C-16 CHANGE to an existing durable rule —
  but because it changes a product-spec FR guarantee it carried a **user sign-off** (option b, recorded
  in context.md), which is now on record.

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
No Floor breach; still no rule CHANGED → still no C-16 sign-off. Approved at the R3 gate.

**R4 (user-requested).** Adversary re-attacked the post-R3 design → **NEEDS WORK** on the freshest
seams: (1, MAJOR) FR-5 "producer parity" is false on partial rows — the producer passes proto-zero for
absent metrics, the design omitted them → different composite, unguarded by any `@AC`; (2, MAJOR) the
branch was placed in `_compute_component`, which lacks `eval_dates`/filings → `@AC-2` unsatisfiable, and
the snapshot-row channel was unnamed; (3, MAJOR, C-01) "Migration: NONE" is wrong — `fundamental_inputs`
has no persistence path, so the routing map would always be empty; (4, MAJOR, C-10) the map +
`_needs_eval_dates` extension weren't proven across all 6 evaluate surfaces, and the warmup prefetch
exists at only 2 of them; plus MINORs (enum-list drift, C-14 badge, mixed scalar+list, snapshot
fan-out). The adversary **confirmed** 0-warmup (`max`-monotonic), the `@AC-1` `fscore.composite` trace,
the two-site gate, and epoch/no-look-ahead all hold.

**R5 (final; cap).** Proposer resolved the mechanism objections (2–8) — branch → `_assemble_component_series`
with a shared `_decode_formula_output`; snapshot lowered to a 1-epoch degenerate `FundamentalPeriod` so
PIT + snapshot share one channel; indicators migration `006` + Register/Update writes + GetFormula
mapping (correcting Migration: NONE); routing map folded into the 2 prefetch sites + a bounded memoized
`_formula_fundamentals` fan-out at the other 4, with `_needs_eval_dates` extended and enumerated per-site;
one derived metric list; the C-14 read-only badge. The one fork (Objection-1, partial-row semantics)
went to the **user, who chose option (b) omit-absent** — accepting the C-16-adjacent cost (FR-5 narrowed
to full rows + new `@AC-8`, sign-off recorded) for the better model (no penalty on non-reporting symbols,
no early-window backtest-vs-live skew). No Floor breach; no existing durable rule CHANGED.
**Termination: user-approved at the R5 gate (full mode's cap); status remains `design-approved`; design
converges — no R6.**
