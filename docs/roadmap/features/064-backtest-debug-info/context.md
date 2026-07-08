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

