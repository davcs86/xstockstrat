# Context: backtest-debug-info

**Feature**: `docs/roadmap/features/064-backtest-debug-info/feature.md`
**Product Spec**: `docs/roadmap/features/064-backtest-debug-info/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/064-backtest-debug-info/implementation-spec.md`

---

## Session 2026-07-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: user posted a screenshot of the strategy backtest run (symbol LLY, 0 trades / 0% return,
  data coverage sufficient) and asked for "more debugging information … a table day by day with
  OHLCV and indicators data."
- User decisions captured up front (AskUserQuestion):
  - **Debug scope**: Full diagnostics (OHLCV + indicators + warm-up markers + per-bar signal scores
    + entry/exit/conviction decision + why-no-trade summary).
  - **Delivery**: Always included in the `RunBacktest` response (no opt-in request flag).
  - **Approach**: Spec-first — write the product spec for review before writing any code.
- Recon notes for the design/spec phase:
  - `RunBacktest` returns `BacktestResult` (`packages/proto/analysis/v1/analysis.proto:54`);
    already carries `trades`, `status`, `coverage_gaps`.
  - Two engine paths in `services/xstockstrat-analysis/app/handlers/servicer.py`:
    `_backtest_symbol` (legacy SMA crossover — computes fast/slow SMA, tech_signal, signal_score,
    combined conviction) and `_backtest_symbol_evaluated` (evaluator path).
  - `app/services/evaluator.py` computes `component_series` (all output series, no look-ahead) but
    `evaluate()` returns only `list[BarDecision]` — component series would need to be exposed for
    diagnostics.
  - Bar fields available: open/high/low/close/volume/vwap/time
    (`packages/proto/marketdata/v1/marketdata.proto:44`).
  - UI target: `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` (metrics grid +
    equity curve + existing `INSUFFICIENT_DATA` coverage-gap/backfill card, feature 053).
- Ledger `fails.md` is empty — no prior trap to design around. Chief self-identified risks recorded as
  OQ-1 (no look-ahead / warm-up definition) and OQ-2 (always-included response size).

Next: `/sdd-review backtest-debug-info product-spec`.

## Session 2026-07-08 — spec refinement (open-question resolution)

User answered the four open questions; spec updated in place:

- **OQ-1 (qq-1) — warm-up definition → RESOLVED (Option B, rule-referenced, union of entry+exit
  refs).** Explained the tradeoffs: Option A ("any component unresolved") is cheapest but
  false-flags warm-up when an unused long-lookback component exists — misleading the exact "why 0
  trades" case; Option C ("declared lookback") is elegant for built-ins but doesn't generalize to
  custom formulas. Chose B (reuses the evaluator's `_validate_rule_refs` walk; legacy SMA path is the
  specialization "until both SMAs resolve"). Position-aware refinement deferred. User may still elect
  simpler Option A at /sdd-design. → FR-4.
- **OQ-2 (qq-2/qq-3) — response size → RESOLVED via a global range cap.** User: "Limit all backtests
  to 2 calendar years" and confirmed 2y is acceptable (~504 daily rows/symbol). Added FR-4b + new
  config key `analysis.backtest.max_range_days` (int, default 730), owned by xstockstrat-analysis.
  Behavior = **reject** over-cap requests with `INVALID_ARGUMENT` (not silent clamp), UI constrains
  date pickers. This is a broader contract change affecting ALL RunBacktest callers, not just
  diagnostics.
- **OQ-4 (qq-4) — signals → RESOLVED.** No newsletter signals this version; `signal_score` stays 0 on
  the evaluator path, real only on the legacy signal-weighted path. Field retained + documented. →
  FR-4a.
- **OQ-3 (agent tool)** left open — verify at /sdd-spec that `run_backtest` MCP tool tolerates the
  larger (now 2-year-bounded) response.

Governance delta from this session: feature now adds 1 config key (was "no new config keys"). Reviewer
set unchanged — the `config` category maps to the analysis service owner, already listed.

## Session 2026-07-08 — OQ-1 → Option C + custom-formula warm-up (scope addition)

User: "oq-1. Option C. Include in the scope to make custom formulas to set a warmup period."

- **OQ-1 re-resolved to Option C (declared lookback)**, superseding the prior Option-B choice.
  Warm-up length = max lookback of the *referenced* components; bar `i` warm-up iff `i < length`. →
  FR-4 rewritten.
- **Scope addition (FR-4c): custom formulas can declare a `warmup_period`** — this is the piece that
  makes Option C generalize (its original weakness). Grounded against real contracts:
  - `indicators.proto`: `FormulaDefinition` (field 12), `RegisterFormulaRequest`/`UpdateFormulaRequest`
    gain `warmup_period` (additive).
  - `indicators.formulas` is DB-backed (migrations `001_formulas`, `002_formula_parameters`,
    `003_formula_outputs` add JSONB columns) → new **migration `004_formula_warmup`** (ADD COLUMN
    `warmup_period INT NOT NULL DEFAULT 0`).
  - Formula authoring UI at `services/xstockstrat-ui/src/app/insights/formulas/{new,[id]}/page.tsx`
    gains a Warm-up period input.
  - analysis reads it via `GetFormula` (servicer already fetches formula metadata for validation).
- **New OQ-5**: define the per-built-in-indicator lookback (`_INDICATOR_WARMUP` alongside
  `_INDICATOR_SERIES`): simple indicators → `period`; `MACD` → slow+signal; `STOCH` → k+d.
- **Governance / scope-creep note**: feature grew from 3 areas (proto/analysis/ui) to 5
  (adds `xstockstrat-indicators` service + a DB migration). Reviewers updated in feature.md to add the
  indicators owner and DBA. This is a deliberate, user-requested expansion — flagged here so
  /sdd-design weighs whether to split the formula-warmup piece into its own feature if it complicates
  the review/merge.

## Session 2026-07-08 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`.
- `spec-reviewer` verdict: all code-checkable claims verified (service names vs registry; config-key
  format; proto field numbers — `indicators.proto` `warmup_period` 12/9/9 all free, `analysis.proto`
  `diagnostics` = 14 additive; `_UNSPECIFIED=0` sentinels present per C-04; migration `004` correct
  next number per F-01; all file paths resolve). Sole FAIL: criterion 9 (two unchecked open questions).
- **Blocker resolved in-spec** (not deferred): OQ-3 → agent `run_backtest` omits `diagnostics` from
  its projected result (UI-facing only; keeps agent context lean). OQ-5 → FR-4 built-in lookback uses
  a declared `_INDICATOR_WARMUP` table (period-based → period; MACD → slow+signal; STOCH → k+d), exact
  ±1 constants pinned by a unit test at /sdd-spec. All OQs now `[x]`.
- `feature-overlap` verdict: CLEAN — no config-key/proto-field/migration-number collision; no
  merge-order entry needed. Draft neighbors `031-strategy-performance-dashboard`,
  `032-walk-forward-backtesting` share the backtest theme but declare no concrete overlap (note only).
- Warnings: none. Overlap findings: none.

## Session 2026-07-08 — OQ-3 revised + sdd-design

- User revised OQ-3: the agent `run_backtest` tool now **includes** the `diagnostics` array (was
  "omit to stay lean") so the agent can reason over per-bar data and **suggest strategy/indicator
  changes**. FR/Affected-Services + OQ-3 updated accordingly. This is a deliberate reversal for the
  diagnostic-advisor use case; response bounded by the 2-year cap.


