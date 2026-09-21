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
FR-7. **Write-time validation:** a formula's declared fundamentals inputs are validated at
**formula-registration** write time — indicators `RegisterFormula`/`UpdateFormula` rejects an invalid
`fundamental_inputs` (`INVALID_ARGUMENT`). _(Updated by the /sdd-design R3 debate: because
`fundamental_inputs` is a **closed `FundamentalMetric` enum** on `FormulaDefinition`, a non-member is
structurally unrepresentable, so the only invalid value is the `FUNDAMENTAL_METRIC_UNSPECIFIED` zero
sentinel, and the natural enforcement point is indicators registration — not the analysis
`ManageStrategy`/`GetFormula`-at-write seam, which still runs for the ANALYSIS-6 soft-delete guard but
is no longer the input-set validator. Covered by `@AC-6`.)_

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
- `xstockstrat-ui` — a **read-only `ComponentEditor` badge** (design decided, R4/R5): when the picked
  formula declares `fundamental_inputs`, show a static "Fundamentals input — requires the fundamentals
  gate ON; use `.composite` for the headline" hint. The formula picker + `<ref>.composite` operand
  already surface (`strategyCatalog.ts:213-244`); no new route/write. (Deferral, if any, points at the
  named follow-up `insights-fundamentals-formula-affordance`.)
- `xstockstrat-agent` — **consumed unchanged**: `manage_strategy` already builds formula components.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `/insights` strategy builder (`ComponentEditor` / `StrategyWizard`): a formula
  component can be a fundamentals-scoring formula. The formula picker + `<ref>.composite` operand
  already surface it (`strategyCatalog.ts:213-244`); **the feature adds one read-only `ComponentEditor`
  badge** (a "fundamentals input / requires gate / use `.composite`" hint when the picked formula
  declares `fundamental_inputs`) — no new route, no write path (design R4/R5).
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
  eval-time routing map is always empty. Adds a **DBA** review gate (C-07). Ships the paired
  `006_add_formula_fundamental_inputs.up.sql` + `.down.sql` (the `.down` drops the column), run via
  `scripts/db-migrate.sh` after the on-disk `005` (C-07). Resolved in the `/sdd-design` R4/R5 debate.

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

_All resolved by the `/sdd-design` debate (see `design.md`); kept here as a resolved audit trail._

- [x] **How the evaluator knows a formula needs fundamentals vs bars** — RESOLVED: a non-empty
  `FormulaDefinition.fundamental_inputs` (the new closed enum) is the category marker; disjoint
  indicator-only vs fundamentals-only kinds. (`design.md` § Chosen Approach / Routing predicate.)
- [x] **Fundamentals input set** — RESOLVED: the **11-metric `FundamentalMetric` enum** vocabulary
  (the seeded producer formula declares its own subset of 6). Supersedes the earlier "6 vs 11?" framing
  — the Proto Contract Changes section above commits to the enum. (`design.md` § Declaration.)
- [x] **Per-bar PIT recompute cost** — RESOLVED: the **filing-boundary epoch model** — one
  `ExecuteFormula` per epoch (contiguous constant-as-of span), broadcast across the span → O(filings),
  not O(bars); reuses feature-198 `_fundamental_as_of_series`. (`design.md` § Backtest (PIT).)
- [x] **Gate reuse** — RESOLVED: reuse the existing feature-198 `analysis.backtest.fundamentals.enabled`
  (no new key), read at **two sites** (PIT loader + the new snapshot loader). (`design.md` § Gate.)
- [x] **Known trap — seeded formula protection (fails.md:76/:75):** the seeded `author="system"`
  formula stays mutation-protected (indicators `servicer.py:315-318`); its `fundamental_inputs` is set
  via the idempotent seed edit, never a raw DB backfill (C-10(c)). No new ownership sentinel.
- [x] **Known trap — real `Bar` fixtures + `bar.time` (fails.md:727):** carried into the test plan —
  PIT/epoch tests use real `Bar` protos keyed on `bar.time`, and assert a mid-window filing transition
  (fails.md:1853). Plus `get_bool` must be stubbed in `make_servicer` (fails.md:1395). (`design.md`
  Open Risks; carried to `/sdd-spec`.)
- [ ] **Known trap — analysis test-helper config accessors (fails.md:1395):** any gate read via a
  presence-aware accessor must be stubbed in the service test-helper factory.
