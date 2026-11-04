# Product Spec: fix-analysis-admin-formula-refusal

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Revised**: 2026-11-04 (product-spec review: FRs, consumer surfaces, scope)

---

## Problem Statement

Indicators deliberately refuses an admin executing another user's formula (`PERMISSION_DENIED`
"admins cannot execute another user's formula", AC-28). Analysis mishandles that refusal on two read paths that
feature 275 did not cover (275 fixed only the backtest path):

- `_compute_opportunities` (`services/xstockstrat-analysis/app/handlers/servicer.py`, the broad
  `except grpc.RpcError` at `:5780-5790`) treats the refusal as an indicators transport outage, logs
  `_compute_opportunities: indicator RPC failed for <SYM>`, adds the symbol to `fetch_failed` and substitutes an empty
  readiness row — the symbol is reported as **data-unavailable** when the real cause is a permission refusal.
- `EvaluateReadiness` lets the same `AioRpcError` escape: ERROR
  `Unexpected [AioRpcError] raised by servicer method [/xstockstrat.analysis.v1.AnalysisService/EvaluateReadiness]`
  and the RPC aborts.

About 4.2k matching log lines in 7 days, in two bursts (2026-10-31: 3,298; 2026-11-02: 920); last seen
2026-11-02 04:07 UTC — dormant, not fixed (re-verified 2026-11-04, `context.md`).

## Functional Requirements

- **FR-1:** When indicators answers a component `ExecuteFormula` with `PERMISSION_DENIED` while `_compute_opportunities`
  evaluates a candidate, the row is **not** data-unavailable; it is marked as an **unreadable formula** (a state distinct
  from data-unavailable and from an evaluated `0/N` quiet row). Other strategies on the same symbol evaluate normally.
  The row stays **visible** in `ListOpportunities` at the default `min_conviction` — like the `muted`, `unavailable` and
  `fundamentals_unavailable` markers it is exempt from the conviction floor, and it sinks in the ranking rather than
  being dropped. A `NOT_FOUND` on the same call keeps its existing skip behaviour (unchanged).
- **FR-2:** The unreadable-formula state is a visible, distinct reason on the opportunity row, exposed to consumers
  (UI and agent) — not only in logs. The marker's field name and shape are decided in `/sdd-design` (a single boolean
  like `data_unavailable`, or a closed-set `reason` enum — C-04 prefers an enum); the scenarios say "the
  unreadable-formula marker".
- **FR-3:** `EvaluateReadiness` returns OK for a symbol whose component formula is unreadable (it does not abort and does
  not log ERROR `Unexpected [AioRpcError]`); that symbol's result is `0/0` conditions with the unreadable-formula marker
  and no fabricated PASS or FAIL. Every other caller of `compute_readiness_row` degrades the same way (C-10(b): no
  sibling path left stale): `_kick_readiness_refresh` (which backs the cache-only `GetWatchlistReadiness`), the readiness
  materializer, and the 300 s surgical heal `_retry_unavailable_symbols` (which must not re-stamp an unreadable row as
  "unavailable" nor retry it endlessly).
- **FR-4:** Genuine indicators outages (`UNAVAILABLE`, `DEADLINE_EXCEEDED`) keep the feature-185 data-unavailable
  behaviour exactly (including the 300 s surgical retry).
- **FR-5:** Unchanged: indicators' AC-28 admin-execute refusal; the backtest `raise_unreadable=True` mapping
  (`servicer.py:2116`, `@AC-5 @feature-224`, `@feature-275`); the live loop; and `FormulaExecutionError` timeouts still
  propagate as today (feature 185 deliberately never catches them).

## Reproduction Steps

1. As an admin (`x-access-scope` admin) whose own live strategy has a component formula **authored by another user**,
   compute opportunities or call `EvaluateReadiness` for a symbol covered by that strategy. (`EvaluateReadiness`
   resolves the strategy via `get_by_owner_and_id(caller_user_id, …)`, so the strategy must be the admin's own and only the
   formula foreign.)
2. Indicators `ExecuteFormula` returns `PERMISSION_DENIED`.
3. Opportunities rows come back data-unavailable; `EvaluateReadiness` aborts with ERROR.

## Root Cause Hypothesis

Feature 275 added `raise_unreadable` handling only on the backtest evaluator (`servicer.py:2116`); the opportunities
and readiness paths use the default evaluator, whose `_execute_formula` (`evaluator.py:256-273`) re-raises
`PERMISSION_DENIED`, plus a broad `except grpc.RpcError` that folds it into "outage". Simply passing
`raise_unreadable=True` would raise `FormulaExecutionError`, which is documented to propagate and would abort
`EvaluateReadiness` instead of fixing it — the target behaviour is per-symbol degradation; the mechanism is a design
decision. **Unconfirmed:** which caller identity / scheduled compute triggered the 2026-10-31 and 2026-11-02 bursts —
a recon question for `/sdd-design`. Another design input: the unreadable verdict is persisted in `readiness_cache`
(FAST-served within `stale_after_seconds`) — recon decides how the marker is persisted and how it heals when the
formula's visibility changes.

## Affected Services

xstockstrat-analysis (`_compute_opportunities`, `EvaluateReadiness`, `compute_readiness_row` and its callers),
xstockstrat-ui (consumer surface), xstockstrat-agent (consumer surface).

## Consumer Surface(s)

- [x] `xstockstrat-ui` `/insights/opportunities`, `/insights/watchlists` (readiness panel), the Signal-detail "Why this
  fired" panel (an `EvaluateReadiness` consumer) and the mobile sections (`components/mobile/SectionRenderer.tsx`,
  `sections.ts`, which also consume `dataUnavailable`): show a distinct "formula not readable by you" state (not the
  data-unavailable state, not a `0/N` quiet row), using the canonical state primitives (C-17). Own implementation step.
- [x] `xstockstrat-agent` MCP tool `list_opportunities` (the agent has no readiness tool): exposes the unreadable-formula
  marker on each row. Own implementation step.

(Both are in scope; each earns its own step in the implementation spec — C-14.)

## Fix Scope

- Proto: an **additive** field on the opportunity/readiness messages is anticipated (the existing precedent is
  `Opportunity.data_unavailable = 20` and `muted = 12`, `analysis.proto`); field shape and number are decided in
  `/sdd-design`, additive-only, with `buf lint` + `buf breaking` and the proto approval gate (C-04, C-09).
- Database: none anticipated — like `data_unavailable`, the state rides the existing provenance JSONB marker (no column).
- Config keys: none.
- Evaluator construction sites: the default-evaluator sites on the opportunities / readiness paths are in scope; the
  complete list is enumerated in recon (sites without `raise_unreadable` currently include several in `servicer.py` and
  `app/main.py`).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behaviour and pass after the fix
(Constitution **C-15**), plus characterization guards for the preserved rules (**C-16**). Plus: existing tests pass;
analysis, UI and agent smoke-tested on dev.

## Out of Scope

- Indicators' AC-28 refusal itself (`services/xstockstrat-indicators/app/handlers/servicer.py:244-249`) — unchanged.
- The backtest path (`raise_unreadable=True`) and the live loop — unchanged; the fix must not leak into their
  `PERMISSION_DENIED`→`FORMULA_ERROR` mapping (`@AC-5 @feature-224`, feature 275).
- Feature 215's `EvaluateReadiness` parity rule ("must not pass `failures`") — preserved.
- `FormulaExecutionError` timeouts (a separate failure: formula execution timed out after 5000 ms).
- Refactoring and performance work unrelated to the bug.
