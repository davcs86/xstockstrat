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
