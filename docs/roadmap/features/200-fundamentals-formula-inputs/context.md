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
