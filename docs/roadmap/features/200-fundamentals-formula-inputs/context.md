# Context: fundamentals-formula-inputs

**Feature**: `docs/roadmap/features/200-fundamentals-formula-inputs/feature.md`
**Product Spec**: `docs/roadmap/features/200-fundamentals-formula-inputs/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/200-fundamentals-formula-inputs/implementation-spec.md`

---

## Session 2026-09-21 — sdd-story (initial + rescope)

- **Initial mis-scope (discarded):** first drafted as a "formula signal producer" — a background loop
  replicating feature 062. The user rejected it outright: "No. I don't want any loop or machinery. I
  want a regular formula that I can use in a strategy but with the same input and output as the
  current signal producer." Renamed `199-formula-signal-producer` → `200-fundamentals-formula-inputs`
  and rewrote all artifacts.
- **Corrected scope (user-confirmed):** a **fundamentals-fed custom formula usable as a strategy
  component** (`COMPONENT_KIND_CUSTOM_FORMULA`), with the **same input/output contract as the
  fundamentals scoring formula** (feature 063). No loop, no signal emission.
- **Data source = "both, by context" (user-confirmed):** point-in-time as-of each bar (feature 198
  PIT store, strict `filed_date < bar_date`) in a **backtest**; current snapshot
  (`GetFundamentalsMulti`) in **live/screener/readiness/opportunities**.
- **Key grounding (recon-lite, drives the design):**
  - `app/services/fundamentals_scoring.py` `score_fundamentals` already feeds a fundamentals dict to
    `ExecuteFormula` via `input_data` (Struct) and reads `output` (Struct: value/quality/composite).
  - `packages/proto/indicators/v1/indicators.proto`: `ExecuteFormulaRequest.input_data=3`,
    `ExecuteFormulaResponse.output=2` — the input/output contract ALREADY exists (scalars or arrays).
  - ⇒ The feature is almost entirely an **analysis-evaluator wiring** change (feed fundamentals into a
    formula component's `input_data`, PIT-vs-snapshot by context, map output→series). Likely **no
    proto and no indicators change** — strong reuse (user's "avoid rework" priority).
- **Central design fork (for /sdd-design):** how the evaluator knows a formula component needs
  fundamentals `input_data` vs bars — inferred from declared `FormulaParameter` names, a
  `FormulaDefinition` marker, or a component flag.
- **Other design questions:** fundamentals input set (producer's 6 vs feature-198 wider set);
  per-bar PIT recompute cost (recompute only at filing boundaries + carry-forward, reuse the 198
  as-of shape); gate reuse (`analysis.backtest.fundamentals.enabled` vs a dedicated key).
- **Known traps (ledger):** shared/seeded formula soft-delete degradation (fails.md:76, reuse
  ANALYSIS-6); real `Bar` fixtures + `bar.time` (fails.md:727); analysis test-helper config-accessor
  stubs (fails.md:1395); config value_type immutability for any new key (C-10(b)/F-11).
- **Consumer surface (C-14):** existing strategy-authoring surfaces (UI ComponentEditor/StrategyWizard,
  agent `manage_strategy`) + existing run_backtest/live/screener paths — no new page/tool.
- **Note:** the earlier product-spec review + overlap agents ran against the *producer* scope and are
  moot; re-run `/sdd-review fundamentals-formula-inputs product-spec` against this rewrite.
- **Branch:** feature 199 must NOT ride feature 198's branch/PR #1158 — needs its own branch off
  main-dev (pending explicit operator OK, since the session is currently on the 198 branch).

## Session 2026-09-21 — renumber 199 → 200

- User reported `199` is already claimed by another (unmerged) branch. Per the feature-numbering
  race rule (renumber the later run to the next free NNN), renamed `199-fundamentals-formula-inputs`
  → `200-fundamentals-formula-inputs` and updated all internal path references. `main-dev` had no
  199/200/201 feature dir; 200 chosen as next free. If 200 is also taken on another branch, renumber
  again to the next free.

## Session 2026-09-21 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS, no blockers). Status: draft → spec-ready.
- Warnings (advisory): (1) six Open Questions unchecked — all legitimate design forks routed to
  /sdd-design (central fork = how the evaluator distinguishes a fundamentals formula from a bars
  formula; must be closed in design before /sdd-spec); (2) C-10 integration completeness — the shared
  `_assemble_component_series` seam also feeds `GetIndicatorSeries`; added it to FR-3's snapshot-path
  enumeration (fixed this session).
- Overlap findings: CLEAN — no duplicate config key, no shared proto field number, no shared
  migration NNN. Soft/rebase source-file overlaps only (analysis servicer.py/evaluator.py vs
  193/194/187, all disjoint regions). Build-order dependency on feature 198 (reuses its PIT
  `_load_fundamentals` seam + `analysis.backtest.fundamentals.enabled` gate).
- Branch: relocated to its own `claude/fundamentals-formula-inputs-*` off main-dev (own PR); cleaned
  off the feature-198 branch (PR #1158 is feature-198-only again).

## Session 2026-09-21 — sdd-review product-spec (re-review, user-requested)

- Re-review after addressing the C-10 warning: **crit-10 (GetIndicatorSeries snapshot-path parity) CLEARED** — FR-3 now enumerates it and the shared `_assemble_component_series` seam claim verified (evaluator.py:368, GetIndicatorSeries→seam servicer.py:3290/3339). Verdict PASS WITH WARNINGS; no blockers. Status unchanged (already spec-ready).
- Remaining advisory warnings: (9) Open-Questions design forks — resolved by the in-progress /sdd-design; (4) build-order dependency on unmerged feature 198 (GetHistoricalFundamentals / _load_fundamentals / analysis.backtest.fundamentals.enabled / COMPONENT_KIND_FUNDAMENTAL are all on PR #1158, absent from main-dev) → add a merge-order.md row; /sdd-design recon confirms 198's real seams so /sdd-spec can cite real path:line (C-01).

## Session 2026-09-21 — sdd-design Phase 0 (recon)

- Wrote recon.md from 4 codebase-discovery digests (analysis, indicators, marketdata, ui) + scenario-recon (C-16).
- Key facts: ExecuteFormula input_data is an arbitrary Struct→`data` dict (arrays+scalars coexist) — no wire proto change needed; the fundamentals/technical distinction is pure caller convention with NO existing formula-input declaration (input_schema unvalidated) = the central design fork. Seeded fundamentals formula is author="system" and already mutation-protected (fails.md:76 closed). GetFundamentalsMulti snapshot live on main-dev (11 metrics, null-not-zero); feature-198 PIT layer entirely UNMERGED (dominant build-order dependency).
- C-16: PRESERVE feature-152 shared-seam no-look-ahead/no-forward-fill + 150/151 backtest reproducibility + 176 ExecuteFormula concurrency bound + 168 fundamentals-availability gate + 190 unavailable sentinel; EXTEND 152 @AC-4 (fundamentals-missing coverage gap). Carry-forward-vs-AC-3 tension flagged for design to state explicitly.

## Session 2026-09-21 — sdd-design Phase 1 (debate, full mode) → design-approved

- **Re-cut the branch off merged main-dev.** Feature 198 (the PIT fundamentals dependency) is now
  merged, so recon's dominant "198 unmerged" build-order risk was refreshed to RESOLVED with real
  citations (`servicer.py:1452`/`:1472`/`:5048`, `evaluator.py:69`, `live_loop.py:585`/`:597`).
  Verified on `origin/main-dev`: the seeded producer formula (`fundamentals_value_quality.py`) reads
  **no `close`** → it is fundamentals-only → the user's condition for disjoint categories (no hybrid
  use case) is satisfied.
- **2 rounds, full mode.**
  - **R1**: proposer floated `input_schema`-activation as the fundamentals-vs-bars routing signal;
    adversary rejected it (empty on the seeded formula, set by no authoring surface, unvalidated/
    mutable, **not fingerprinted** → regresses @AC-6 feature-152 reproducibility). User chose the
    additive `FormulaDefinition` field over the adversary's `StrategyComponent`-side field, plus
    "fundamentals + close" blend and the 198-merged new-branch sequencing.
  - **R2**: proposer resolved the five residuals (fingerprint residual accepted, no-forward-fill
    preserved, single gate, inherited concurrency, quiet-hold on missing); adversary confirmed the
    **epoch model** correct & bounded (O(filings) not O(bars)) but flagged the blend/look-ahead
    surface, the gate asymmetry, and the 4-place allow-list duplication.
- **User steer at the R2 gate — separation of concerns:** superseded the "fundamentals + close" blend
  with **two disjoint formula kinds** (indicator-only vs fundamentals-only, no in-formula blend);
  blends compose at the rule level. This **structurally dissolves** the look-ahead risk (a
  fundamentals-only formula never receives `close[]`, so an epoch value can't depend on bar position),
  restores exact producer parity, and keeps indicator-only formulas byte-identical.
- **Chosen approach (design.md):**
  - Additive `repeated FundamentalMetric fundamental_inputs` on `FormulaDefinition`
    (+ Register/Update requests); `FundamentalMetric` a **new closed enum** (11 canonical metrics +
    `_UNSPECIFIED=0`, C-04) = single source of truth, killing the 4-place hand-typed allow-list.
    Non-empty `fundamental_inputs` **is** the fundamentals-only category marker.
  - Analysis reads it off the **existing** `GetFormula` fetches (write-time `_fetch_formula_outputs`
    + live warmup prefetch) into a `{formula_id: [metric]}` map — **no new RPC**; threads a resolved
    `fundamentals` context into `_assemble_component_series`/`_compute_component` exactly like
    feature-152 `benchmark_bars`.
  - **Backtest** = per-metric as-of scalars via feature-198 `_fundamental_as_of_series`, **filing-
    boundary epochs**, one `ExecuteFormula` per epoch, scalar broadcast across the epoch span.
    **Snapshot** (live/screener/readiness/opportunities/GetIndicatorSeries) = one `ExecuteFormula`
    over `GetFundamentalsMulti`, broadcast across all bars.
  - **Degradation:** a declared-but-missing metric (`missing_metrics` / no row) → skip
    `ExecuteFormula`, emit `None`/hold (never fabricated `0.0`, never the feature-190 `"unavailable"`
    sentinel); a genuine crash still raises `FormulaExecutionError`.
  - **Single reused gate** `analysis.backtest.fundamentals.enabled` on all surfaces (no new key, no
    asymmetry). `source_symbol` × `fundamental_inputs` on one component rejected `INVALID_ARGUMENT`
    for v1. **No new semaphore** (inherits existing bounds → preserves @AC-5 feature-176).
- **Rejected:** `input_schema` fork (R1), `StrategyComponent` routing field (user pick), `repeated
  string fundamental_inputs`, in-formula blend, per-bar recompute, a second (snapshot) gate,
  snapshot-first/stack-on-198 sequencing (moot — 198 merged). All in design.md § Rejected Alternatives.
- **Constitution touched:** C-04 (closed enum), C-09 (additive proto — 1 indicators owner),
  C-10(c) (seeded formula mutation-protected; set via idempotent seed edit), C-14 (existing consumer
  surfaces made fundamentals-capable), C-16 (see below), C-18 (disjoint categories = SRP, enum =
  DRY, deferred HYBRID = YAGNI), C-05/F-07 (single reused gate via WatchConfig `get_bool`). **No
  Floor breach.**
- **C-16:** PRESERVE 152 (@AC-1/3/7 byte-identity + no-forward-fill), 150/151 (reproducibility),
  176 (@AC-5 concurrency), 168/190 (gate + unavailable-sentinel); EXTEND 152 @AC-4 (fundamentals-
  missing coverage). **No rule CHANGED → no C-16 sign-off** (the as-of hold-forward is a new branch,
  not a reinterpretation of AC-3).
- **Open Threads (from design Open Risks):** (1) fingerprint residual — editing formula-side
  `fundamental_inputs` doesn't bump the strategy fingerprint; same class as any formula-body edit,
  handled by the feature-086 soft-delete-on-read guard; accepted, no mitigation. (2) enum churn — a
  12th metric later means a proto enum add + regen (the intended single-source cost).
- **Known traps carried to /sdd-spec:** `get_bool` NOT stubbed in `make_servicer` (fails.md:1395) —
  the gate-read test step must add it; real `Bar` fixtures keyed on `bar.time` (fails.md:727) for the
  PIT/epoch and byte-identity tests.
- **Status:** `spec-ready` → `design-approved`. Termination: user-approved at the R2 gate.

## Session 2026-09-21 — sdd-design Phase 1, Round 3 (user-requested extra round)

- User asked for **another design round** on the already-approved (`design-approved`) design. Ran a
  full mediated R3: design-adversary attacked the standing disjoint-category design, proposer
  responded, both verified every claim against the code (P-02 mediated, orchestrator-synthesized).
- **Adversary verdict: NEEDS WORK** — not mere confirmation. Four MAJOR seam collisions R1–R2 missed,
  each grounded in real `path:line`:
  - **MAJOR-1** — the snapshot path (live/screener/opportunities/readiness/GetIndicatorSeries) does
    **not** flow through `_load_fundamentals` (that's the PIT/`GetHistoricalFundamentals` loader,
    `servicer.py:1452`); the only `GetFundamentalsMulti` uses are the producer/screener/blend-resolver,
    none feeding the evaluator operand. So the reused `analysis.backtest.fundamentals.enabled` gate did
    **not** gate the snapshot path — design.md's "one switch, no asymmetry" was false. And 198's *live*
    operand routes through the PIT loader (`live_loop.py:585`, gate `:597`), so 198 was **not** the
    snapshot-gating precedent design.md claimed.
  - **MAJOR-2** — `_definition_has_fundamental` (`servicer.py:5051`) + `_needs_eval_dates`
    (`evaluator.py:63`) match only `COMPONENT_KIND_FUNDAMENTAL`; a fundamentals *formula*
    (`CUSTOM_FORMULA`) is invisible → loader short-circuits `None` → formula fed nothing, silent hold.
    And the `{formula_id:[metric]}` map can't come from `_fetch_formula_outputs` (write-time, not
    persisted) — it must ride the eval-time `GetFormula` warmup prefetch.
  - **MAJOR-3** — producer reads `composite` (`fundsignal_loop.py:416`); evaluator bare-ref resolves to
    `value` (`evaluator.py:306`); `_compute_component` **drops scalar outputs** (`:381`) and requires a
    `value` series — so a scalar-returning formula would `FormulaExecutionError` today, and `@AC-1`
    (0.72 = composite) was unsatisfiable under bare-ref.
  - **MAJOR-4** — with the closed enum on `FormulaDefinition` validated at indicators `RegisterFormula`,
    a non-member is unrepresentable, so `@AC-6`'s ManageStrategy-path reject can't be exercised as
    written; analysis-side revalidation is vacuous.
  - **Obj-6** (198 `@AC-3/@AC-4` missing from PRESERVE) + **Obj-7** (enum DRY/home-of-truth: the enum is
    a 4th representation alongside marketdata fields + analysis `_FUNDAMENTAL_METRICS` + UI list).
  - **Conceded correct:** the epoch model is O(filings) and look-ahead is structurally impossible
    (no `close[]` fed) — with two spec pins (all-`None`/pre-first-filing epoch skips ExecuteFormula &
    emits None; epoch grouping from the per-metric as-of series incl. None-reset).
- **Proposer resolutions (verified):** MAJOR-1 → **two chokepoints, one key** (PIT loader +
  new `_load_fundamentals_snapshot` + live twin, both read the same gate; C-05 non-landmine — key is
  already the platform-wide fundamentals kill-switch; `.backtest.` token a pre-existing 198 misnomer,
  rename out of scope). MAJOR-2 → routing map from the **extended `GetFormula` warmup prefetch**
  (`declared_formula_warmups` / `_declared_formula_warmup`), new predicate
  `_definition_wants_fundamentals_formula`, `_needs_eval_dates` extended, `formula_fundamentals`
  threaded like feature-152 `benchmark_bars`; RpcError → fed `close` → `FormulaExecutionError`
  (fail-loud). MAJOR-3 → keep value-primary, **implement the deferred scalar-broadcast** so
  value/quality/composite all addressable; **edit `@AC-1` to gate on `fscore.composite`**. MAJOR-5 →
  fundamentals-only formula caches **0 warmup bars** at the prefetch. Obj-6 → add 198 PRESERVE.
- **The one sign-off item — MAJOR-4/Obj-7 (enum home):** proposer *recommended reversing* to
  `repeated string fundamental_inputs` validated against the existing `_FUNDAMENTAL_METRICS`
  (DRY, no cross-service enum, `@AC-6` exercisable on the ManageStrategy path). Put to the **user via
  AskUserQuestion; user chose to KEEP the closed `FundamentalMetric` enum** (C-04 compile-time proto
  safety), accepting the 4th-representation cost + one named enum→field-name lowering site (the analysis
  loader boundary) and relocating `@AC-6`'s reject to indicators `RegisterFormula` (reject the
  `FUNDAMENTAL_METRIC_UNSPECIFIED` sentinel). Recorded here as the explicit R3 decision.
- **acceptance.feature edits (ids preserved, C-15):** `@AC-1` body → gate on `fscore.composite` +
  three scalar outputs broadcast; `@AC-6` body → validation at indicators `RegisterFormula` on the
  enum sentinel.
- **Carried to /sdd-spec:** add `get_bool` to `make_servicer` (fails.md:1395); real `Bar` on `bar.time`
  (fails.md:727); assert the mid-window filing-boundary transition (fails.md:1853), not just ragged
  ends; seed edit (not raw DB backfill) to set the seeded formula's `fundamental_inputs` (C-10(c)).
- **Disjoint-kind decision untouched; no Floor breach; no rule CHANGED → no C-16 sign-off.** Status
  stays `design-approved`; R3 sharpened the mechanism, it did not re-open the phase gate.

## Session 2026-09-21 — sdd-design Phase 1, Rounds 4 & 5 (user-requested; full mode cap reached)

- User asked to run 1–2 more rounds depending on the adversary. R4 adversary attacked the post-R3
  design → **NEEDS WORK**; R5 proposer resolved the mechanism objections and one user fork was settled.
  Both agents verified every claim against merged `main-dev` (P-02 mediated).
- **R4 findings (all grounded):**
  - **Obj-1 (MAJOR, the fork):** design.md's "partial dict → producer parity" was **false**. The
    producer (`fundsignal_loop.py:404-411`) builds `input_data` unconditionally with proto3 scalars —
    an absent metric is passed as `0.0`, never omitted, never consulting `missing_metrics`; the seeded
    formula scores a missing PE as a hard `0.0` (`fundamentals_value_quality.py:131`). So omit-absent
    (design) ≠ producer on any partial row. `@AC-4` (full AAPL) / `@AC-5` (whole-row-missing INTC)
    covered neither — the partial case was unguarded.
  - **Obj-2 (MAJOR):** the branch was placed in `_compute_component` (`evaluator.py:334`), which has
    only `(comp, closes)` — no `eval_dates`/filings → `@AC-2` unsatisfiable; and the snapshot-row
    channel was unnamed (conflating it with the PIT `FundamentalPeriod` list would break
    `_fundamental_as_of_series`).
  - **Obj-3 (MAJOR, C-01):** "Migration: NONE" was wrong — `GetFormula` maps
    `parameters`/`outputs`/`warmup_period` but not `fundamental_inputs` (`indicators/servicer.py:454`);
    with no persistence the routing map is always empty → every fundamentals formula dead-routes to
    `FormulaExecutionError`.
  - **Obj-4 (MAJOR, C-10):** the map + `_needs_eval_dates` extension must be at all 6 evaluate surfaces;
    the warmup prefetch exists at only 2 (backtest, live); the warmup cache must stay `{id:int}`.
  - MINORs: two metric-name lists drift (Obj-5); C-14 badge "optional" (Obj-6, but the UI picker +
    `fscore.composite` operand already surface — `strategyCatalog.ts:213-244`); mixed scalar+list
    contract (Obj-7); snapshot fan-out sem/cache (Obj-8).
  - **Confirmed HOLDING (not manufactured):** 0-warmup can't shrink a sibling (`max`-monotonic,
    `warmup.py:138-147`); `@AC-1`'s `fscore.composite` trace resolves (`evaluator.py:247-248`); the
    two-site gate is C-05-clean; epoch/no-look-ahead reconfirmed.
- **R5 proposer resolutions (verified, folded into design.md):** branch → `_assemble_component_series`
  (`:459`) with a shared `_decode_formula_output` helper; snapshot row lowered to a **1-element
  `FundamentalPeriod`** (`date.min` sentinel) so PIT + snapshot share one `_fundamental_as_of_series`
  channel and one code shape; **indicators migration `006`** (`fundamental_inputs JSONB DEFAULT '[]'`,
  mirroring `003_formula_outputs`) + Register/Update writes + GetFormula mapping — **corrects Migration:
  NONE**, adds a DBA gate (C-07); routing map folded into the 2 prefetch sites (no new RPC there) + a
  bounded memoized `_formula_fundamentals` fan-out at the other 4 (honest new call); `_needs_eval_dates`
  signature extended and enumerated per-site (C-10); `_FUNDAMENTAL_METRICS = set(_FUNDAMENTAL_METRIC_DATA_KEY.values())`
  (one list); a minimal read-only C-14 badge in `ComponentEditor` (else follow-up
  `insights-fundamentals-formula-affordance`).
- **THE fork — Objection-1, user sign-off (AskUserQuestion):** partial-row feed. Options: **(a)** match
  the producer (proto-zero for absent) — exact FR-5 parity, no C-16 change, least mechanism, but
  penalizes non-reporting symbols and risks an early-window backtest-vs-live scoring skew; **(b)**
  omit-absent (neutral-drop) — better model, but diverges from the producer → FR-5 narrowed to
  fully-populated rows, a new `@AC-8`, and C-16-adjacent sign-off. **User chose (b).** Recorded as the
  explicit decision; option (a) is in Rejected Alternatives.
- **acceptance.feature edits (C-15, ids preserved):** `@AC-4` narrowed to "fully-populated rows";
  **new `@AC-8`** (partial-row: omit absent, neutral-drop, diverges from the producer's proto-zero).
  `product-spec.md` FR-5 narrowed; Proto/Database/Approval sections corrected (additive
  `fundamental_inputs` field + enum; indicators migration `006` + DBA gate).
- **Carried to /sdd-spec (unchanged + new):** `get_bool` in `make_servicer` (fails.md:1395); real `Bar`
  on `bar.time` + mid-window transition assertion (fails.md:727/1853); `MessageToDict` scalar/NaN→
  `FormulaExecutionError` in the shared decoder (fails.md:87); the seeded formula's `fundamental_inputs`
  set via the idempotent seed edit (C-10(c)); indicators migration `006` `.up`/`.down` (C-07).
- **No Floor breach; no existing durable rule CHANGED (198/152/151/150/176/168/190 all PRESERVE).** The
  FR-5 narrowing edits *this feature's own* not-yet-promoted scenarios (allowed pre-launch, C-15) and
  carried a user sign-off. Disjoint-kind + closed-enum decisions untouched. **Design converges at R5
  (full mode's cap) — no R6.** Status stays `design-approved`.

## Session 2026-09-21 — sdd-review product-spec (post-design re-review)

- Re-ran the AI review on the R3–R5-revised product-spec (spec-reviewer + feature-overlap subagents).
  **Result: PASS WITH WARNINGS — no blockers, no Floor breach.** All code-checkable claims verified
  against the repo: service names match the registry; proto field numbers free (`FormulaDefinition`
  `fundamental_inputs`=14, `RegisterFormulaRequest`=10, `UpdateFormulaRequest`=11); indicators migration
  `006` is genuinely next-free (on-disk `001`–`005`); the JSONB `ADD COLUMN … DEFAULT '[]'` mirrors the
  `003_formula_outputs` precedent; config key format + reuse OK.
- **Status kept `design-approved`** (NOT downgraded to `spec-ready`): the review re-ran on an
  already-designed feature, and the skill's PASS path (overwrite → `spec-ready`) is written for the
  `draft`→`spec-ready` gate; applying it here would regress the lifecycle and destroy the design phase.
  Deliberate orchestrator override, recorded here.
- **4 advisory warnings — all documentation drift, all addressed this session:**
  1. FR-7 prose was stale (said analysis `GetFormula`-at-write) → reworded to name indicators
     `RegisterFormula`/`UpdateFormula` enum-sentinel validation (matches `@AC-6`).
  2. Open Questions all unchecked (esp. OQ-2 "6 vs 11?" contradicting the Proto section) → all six
     marked `[x]` RESOLVED with pointers to the resolving `design.md` sections.
  3. DB section didn't state the paired `.down.sql`/run order → added.
  4. UI consumer surface was tentative ("may be none") → firmed to the read-only `ComponentEditor`
     badge the design ships (`strategyCatalog.ts:213-244` already surfaces the picker + `.composite`).
- **Overlap: no blocking collision.** Migration `006`, the additive proto field/enum, and the reused
  config key are all CLEAN. Only soft same-file (disjoint-region) rebases with 198/196 in the analysis
  dir. **Added a merge-order row:** `fundamentals-formula-inputs` (200) **must wait for**
  `historical-fundamentals-backtest` (198) — consumed-seam build-order dependency (198 is
  code-completed, not yet launched).
- **Next:** proceed to `/sdd-spec fundamentals-formula-inputs` (review clear, design approved).

## Session 2026-09-21 — sdd-spec

- Generated implementation-spec.md with **12 steps**. Status → `implementation-ready`.
- Consumed `recon.md` + `design.md` as authoritative; re-grounded every cited symbol against merged
  `main-dev` (line numbers had drifted from the design's write-time citations — spec cites the
  verified current lines).
- Key codebase findings (verified `path:line`):
  - Indicators last migration on disk is `005_add_formula_soft_delete` → next free is `006`; JSONB
    precedent is `003_formula_outputs` (`ADD COLUMN … JSONB NOT NULL DEFAULT '[]'`). `FormulaDefinition`
    next free proto field = 14; `RegisterFormulaRequest`=10, `UpdateFormulaRequest`=11.
  - Indicators persistence path confirmed end-to-end: repo `create`/`upsert`/`update` +`_to_dict`
    (`formulas_repository.py`), `RegisterFormula` (`servicer.py:242-270`), `UpdateFormula`
    (`:361-398`, `_FORMULA_MASKABLE_PATHS:24`), `GetFormula` mapping `_row_to_formula` (`:441-457`),
    validation seam `validate_outputs` (`parameters.py:81`), seed via `seed_formulas.py` upsert. The
    seeded fvq formula reads 6 metrics (PE/PB/DIVIDEND_YIELD/ROE/DEBT_TO_EQUITY/EPS).
  - Analysis evaluator: `_fundamental_as_of_series` (`evaluator.py:69`, strict `filed_date<d` T+1),
    `_needs_eval_dates` (`:60-66`, matches only source_symbol/COMPONENT_KIND_FUNDAMENTAL — must be
    extended for the formula), the fundamentals-only branch belongs in `_assemble_component_series`
    (after `:459-464`), and `fundamentals`/`benchmark_bars` already thread through
    evaluate/evaluate_with_series/evaluate_conditions_traced.
  - Analysis servicer: `_load_fundamentals` (`:1452`, gate `:1472` `get_bool
    analysis.backtest.fundamentals.enabled`), the **6** evaluate surfaces call it at 1595/2922/3174/
    3400/3833/3909/4376/4654, warmup prefetch exists only at backtest (`_declared_formula_warmup:1950`)
    + live (`declared_formula_warmups`); write-time seam `_validate_definition_proto:601` →
    `_fetch_formula_outputs:537`. `_definition_has_fundamental:5048` + `_fundamental_periods_from_response:5054`.
  - Producer divergence (@AC-8): `fundsignal_loop._score_via_formula:399-411` passes proto-zero for
    absent metrics unconditionally; `fundamentals_scoring.score_fundamentals` reads `output.composite`.
  - Traps carried into the test plan: `make_servicer` stubs no `get_bool` (fails.md:1395,
    `test_analysis_servicer.py:39-49`); real `Bar` via `_bar(sec,…)` `b.time.seconds` (fails.md:727);
    mid-window filing-boundary assertion (fails.md:1853); `MessageToDict` rejects NaN/Inf so a
    non-finite scalar is `FormulaExecutionError`, never fabricated (fails.md:87).
  - UI: badge goes in `ComponentEditor.tsx` CUSTOM_FORMULA branch (`selectedFormula:66`), reusing the
    FUNDAMENTAL-kind hint markup (`:143-146`); C-12 fixture in `e2e/fixtures/formulas.ts` + INVENTORY.
  - strat-lab backtest `SKILL.md:91-101` documents the 198 single-metric operand — must gain a
    fundamentals-formula section in the same PR (root CLAUDE.md manage_strategy/run_backtest rule).
- **Open thread carried to execute (design residual, `## Step Dependencies`):** the fundamentals-formula
  channel is PIT (`_load_fundamentals`) on backtest and snapshot (`_load_fundamentals_snapshot`) on the
  5 non-backtest surfaces. A strategy combining a single-metric `COMPONENT_KIND_FUNDAMENTAL` operand
  (198, always PIT) **and** a fundamentals-formula on a non-backtest surface is an unspecified
  co-occurrence; the write-time XOR guard (Step 8) covers only source_symbol+fundamental_inputs on one
  component. The spec keeps the two loaders on separate channels to preserve 198 byte-identically
  (C-16 PRESERVE `@AC-3` `@feature-198`); resolve/record at execute time.
- **Next:** `/sdd-review fundamentals-formula-inputs impl-spec`, then `/sdd-execute`.
