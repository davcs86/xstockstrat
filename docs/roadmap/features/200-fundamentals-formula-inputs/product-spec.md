# Product Spec: fundamentals-formula-inputs

**Created**: 2026-09-21

---

## Problem Statement

A strategist can author a fundamentals-**scoring** formula today, but only the Fundamentals Signal
Producer (feature 062/063) can run it — it feeds the formula a fundamentals `input_data` Struct via
`ExecuteFormula` and reads a composite `output`. Inside a **strategy**, a
`COMPONENT_KIND_CUSTOM_FORMULA` component is fed only OHLCV `closes`, so the same fundamentals-scoring
formula cannot be used as a strategy operand. The user wants exactly that: a regular formula with the
**same input/output contract as the signal producer's scoring formula**, usable as a component inside
a strategy's entry/exit rules — with no background loop or signal emission.

## User Story

As a strategist, I want a custom formula that consumes fundamentals as inputs and returns a score
(the same input/output as the fundamentals signal producer's scoring formula) to be usable as a
component in a strategy, so that my fundamentals scoring can drive entry/exit rules directly.

## Functional Requirements

FR-1. A `COMPONENT_KIND_CUSTOM_FORMULA` strategy component may be a **fundamentals-scoring formula**:
when evaluated, the strategy evaluator supplies the symbol's fundamentals as the `ExecuteFormula`
`input_data` Struct (the same contract `score_fundamentals` uses today) and maps the formula's
`output` score onto the component's series that entry/exit rules reference.
FR-2. **In a backtest, the fundamentals are point-in-time as-of each bar** — resolved from the
feature-198 PIT store with the strict `filed_date < bar_date` (T+1) carry-forward, so a fundamentals
formula in a backtest never sees a filing before it was filed (no look-ahead).
FR-3. **In live / screener / readiness / opportunities / `GetIndicatorSeries` evaluation, the
fundamentals are the current snapshot** (marketdata `GetFundamentalsMulti` cache) — the same inputs
the signal producer's formula receives. (`GetIndicatorSeries`, the Symbol-page series consumer, rides
the same shared `_assemble_component_series` seam, so it is enumerated here for snapshot-path parity —
the review's C-10 integration-completeness note.)
FR-4. The component's output reduces to a series the **same way other formula components do** (primary
`value`, or a declared `<ref_name>.<series>` output), so rule-operand referencing is unchanged and a
fundamentals formula composes with technical operands in one condition tree.
FR-5. **One formula, one contract (fully-populated rows):** a fundamentals-scoring formula authored
once behaves identically whether invoked by the existing fundamentals signal producer (062/063) or as
a strategy component — the `input_data`/`output` shape and the fundamentals input set do not diverge —
**for symbols whose declared metrics are all present**. _(Narrowed by the /sdd-design R4/R5 debate,
user decision option b: on a **partial** row the strategy path **omits** absent metrics — neutral-drop,
no penalty — whereas the producer passes proto-zero `0.0`, so the two diverge on partial rows. See
`design.md` and `acceptance.feature` `@AC-4` (full-row parity) + `@AC-8` (partial-row divergence). User
sign-off recorded in `context.md`.)_
FR-6. **Graceful degradation, no fabrication:** a formula execution failure, or fundamentals
unavailable for a symbol/bar, degrades that component to `None`/hold for that span (never a fabricated
`0.0` score) and never aborts the backtest/evaluation.
FR-7. **Write-time validation:** a fundamentals-scoring formula component is validated at strategy
write time — the fundamentals inputs it consumes are checked against the allowed fundamentals input
set — reusing the existing formula-component validation seam (`GetFormula`-at-write, feature 067/152).

## Out of Scope

- Any background loop, scheduler, or signal emission (explicitly rejected by the user — this is not a
  producer). No change to `app/engine/fundsignal_loop.py` or feature 062/063 behavior.
- The single-metric `COMPONENT_KIND_FUNDAMENTAL` operand (feature 198) is unchanged; this feature is
  about **formula** components that combine multiple fundamentals into a score.
- A new signal source, config-ui page, or agent tool beyond what strategy authoring already exposes.
- Fundamentals inputs to a formula used in the **screener's technical-criterion** path beyond what
  falls out of the shared evaluator seam (design confirms the blast radius).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — **primary**: the strategy-evaluator formula-component path builds the
  fundamentals `input_data` (PIT-as-of-bar in backtest via the feature-198 `_load_fundamentals`
  seam; snapshot via `GetFundamentalsMulti` in live/screener) and maps the `output` to the
  component series; plus write-time validation.
- `xstockstrat-indicators` — **consumed unchanged**: `ExecuteFormula` already accepts `input_data`
  (Struct) and returns `output` (Struct). Design confirms whether a formula needs to *declare* it
  consumes fundamentals inputs (a possible additive `FormulaDefinition` surface) or whether that is
  inferred.
- `xstockstrat-marketdata` — **consumed unchanged**: `GetHistoricalFundamentals` (PIT, feature 198)
  and `GetFundamentalsMulti` (snapshot).
- `xstockstrat-ui` — possibly a `ComponentEditor` affordance to mark/pick a fundamentals-scoring
  formula (design decides; may be none).
- `xstockstrat-agent` — **consumed unchanged**: `manage_strategy` already builds formula components.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `/insights` strategy builder (`ComponentEditor` / `StrategyWizard`): a formula
  component can be a fundamentals-scoring formula. Whether a new affordance is required (vs. the
  existing formula picker just working) is a design question; the surface itself is the existing
  strategy-authoring page — no new route.
- [x] **Agent** — `xstockstrat-agent` `manage_strategy`: already registers formula components; a
  fundamentals-scoring formula rides that existing tool (documented, no new tool). Backtests run via
  the existing `run_backtest`.
- [ ] **None.**

The capability is realized through the **existing** strategy-authoring surfaces and the existing
backtest/live/screener evaluation paths — this feature makes an already-reachable component kind
fundamentals-capable, rather than adding a new surface.

## Proto Contract Changes

- [x] **Additive proto change (design decided).** `ExecuteFormula`'s wire is unchanged
  (`input_data`/`output` Structs already carry scalars). But a formula must **declare** it consumes
  fundamentals inputs: `/sdd-design` chose an **additive `repeated FundamentalMetric fundamental_inputs`**
  on `FormulaDefinition` (+ `RegisterFormulaRequest`/`UpdateFormulaRequest`), `FundamentalMetric` a
  **new closed enum** (11 metrics + `_UNSPECIFIED=0`, C-04) — non-breaking (C-09). `buf lint`/`buf
  breaking` + `./scripts/buf-gen.sh`; 1 indicators owner.

## Config Key Changes

- [ ] No new config keys (preferred) — the PIT path reuses the existing
  `analysis.backtest.fundamentals.enabled` gate (feature 198); the snapshot path needs none
  (screener/producer already use snapshot ungated).
- OR (design decides): a dedicated gate if the reviewers want fundamentals-formula components toggled
  independently of the single-metric operand.

## Database Changes

- [x] **One indicators migration (design decided — corrected from "none").** The analysis PIT store
  and marketdata fundamentals cache are reused unchanged, BUT indicators must **persist**
  `fundamental_inputs`: migration **`006_add_formula_fundamental_inputs`** (`ALTER TABLE
  indicators.formulas ADD COLUMN fundamental_inputs JSONB NOT NULL DEFAULT '[]'`, mirroring the
  `003_formula_outputs` JSONB precedent) — without it `GetFormula` can't return the field and the
  eval-time routing map is always empty. Adds a **DBA** review gate (C-07). Resolved in the
  `/sdd-design` R4/R5 debate.

## Feature Workflow Notes

Branch to create: `feature/fundamentals-formula-inputs` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] Service owner approval: `xstockstrat-analysis` (evaluator/loader wiring) **and** `xstockstrat-indicators` (additive `fundamental_inputs` proto field + enum + persistence)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive, C-09)
- [x] **DBA review + service owner** — indicators migration `006_add_formula_fundamental_inputs` (design R4/R5; corrects the earlier "no schema change")

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **How the evaluator knows a formula component needs fundamentals `input_data` vs bars
  (design):** infer from the formula's declared `FormulaParameter` names matching the fundamentals
  set, a `FormulaDefinition` marker, or a component-level flag? This is the central design fork.
- [ ] **Fundamentals input set (design):** the producer's scoring path feeds 6 fields (`pe_ratio`,
  `pb_ratio`, `dividend_yield`, `roe`, `debt_to_equity`, `eps`). Does a strategy formula get the same
  6, or the wider feature-198 metric set (`market_cap`, `beta`, `price`, `year_high`, `year_low`)?
  FR-5 (one contract) pulls toward matching the producer's 6; confirm.
- [ ] **Per-bar PIT recompute cost (design):** in a backtest the as-of fundamentals change only at
  filing boundaries, so the composite should be recomputed **only when the as-of inputs change** and
  carried forward — not one `ExecuteFormula` per bar per symbol. Confirm the carry-forward/dedup
  strategy (reuse the feature-198 as-of carry-forward shape).
- [ ] **Gate reuse (design):** reuse `analysis.backtest.fundamentals.enabled`, or mint a dedicated
  gate? (Config value_type immutability — any new key is new, never a rewiden — fails.md C-10(b)/F-11.)
- [ ] **Known trap — shared/seeded formula protection (fails.md:76):** a strategy binding to a
  fundamentals-scoring formula must degrade gracefully when that formula is soft-deleted/edited
  (reuse the feature-086 soft-delete-on-read guard, ANALYSIS-6); do not introduce an `author="system"`
  sentinel without a governance entry.
- [ ] **Known trap — real `Bar` fixtures + `bar.time` (fails.md:727):** the PIT path keys on bar
  dates (`bar.time`, never `bar.timestamp`); tests use real `Bar` protos, not `MagicMock`.
- [ ] **Known trap — analysis test-helper config accessors (fails.md:1395):** any gate read via a
  presence-aware accessor must be stubbed in the service test-helper factory.
