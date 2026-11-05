# Product Spec: fix-analysis-admin-formula-refusal

**Type**: bug
**Defect report**: `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04
**Revised**: 2026-11-05 (product-spec review: FRs, consumer surfaces, scope)

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

- **FR-1:** When indicators refuses a component formula the caller cannot read — `NOT_FOUND` or `PERMISSION_DENIED` on `ExecuteFormula` — and the
  rule being traced **references** that component (FR-6), the row/result is **not** data-unavailable; it is marked **unreadable formula** (a state
  distinct from data-unavailable and from an evaluated `0/N` quiet row). This holds on **every path that traces readiness** — the
  `ListOpportunities`-triggered recompute, the daily opportunity refresh and readiness materializer (owner-only metadata, which answers `NOT_FOUND`),
  `EvaluateReadiness`, `_kick_readiness_refresh`, and the 300 s heal. Other strategies on the same symbol evaluate normally. The row stays **visible**
  in `ListOpportunities` at the default `min_conviction` — like the `muted`, `unavailable` and `fundamentals_unavailable` markers it is exempt from the
  conviction floor. (Operator decision 2026-11-05, replacing the earlier "`NOT_FOUND` keeps its skip": a scope-dependent marker is erased by the
  scheduled passes and never shown to non-admin owners.)
- **FR-2:** The state is exposed to consumers (UI and agent), not only in logs, as the additive proto field `bool formula_unreadable` —
  `Opportunity` field 25 and `SymbolReadiness` field 6 (a bool, like `data_unavailable`/`muted`/`fundamentals_unavailable`; persisted as the
  `"formula_unreadable"` provenance token and the `readiness_json` key, no migration). It is mutually exclusive with `data_unavailable` and
  `fundamentals_unavailable` (precedence `fundamentals_unavailable` > `unavailable` > `formula_unreadable`), is never an `Opportunity.source` or
  `available_sources` facet, and the UI copy is neutral ("formula not readable": the refusal also covers missing formulas and legacy-author rows).
  Rank/action: a **non-held** unreadable row has action UNSPECIFIED, conviction and signal axis 0 and composite NULL; a **held** row keeps its
  resolved action (REDUCE on a sell signal or firing exit; otherwise the existing monitored-holding fallback) and its signal axis, with conviction 0
  and a signal-only composite (operator decision 2026-11-05; a C-16 CHANGE of the feature-083 two-axis ranking for non-held unreadable rows).
- **FR-3:** `EvaluateReadiness` returns OK for a symbol whose referenced component formula is unreadable (it does not abort and does not log ERROR
  `Unexpected [AioRpcError]`); the result is `0/0` conditions with the marker and no fabricated PASS or FAIL, a real `bar_epoch >= 0` (RESOLVED, never
  the `-1` UNKNOWN sentinel). Every other caller of `compute_readiness_row` degrades the same way (C-10(b)): `_kick_readiness_refresh` (which backs the
  cache-only `GetWatchlistReadiness`), the readiness materializer, and the 300 s surgical heal `_retry_unavailable_symbols` (which must not re-stamp an
  unreadable row as "unavailable" nor retry it endlessly). The verdict is terminal until the next recompute / new bar / TTL / definition change.
- **FR-4:** Genuine indicators outages (`UNAVAILABLE`, `DEADLINE_EXCEEDED`) keep the feature-185 data-unavailable
  behaviour exactly (including the 300 s surgical retry).
- **FR-5:** Unchanged: indicators' AC-28 admin-execute refusal; the backtest `raise_unreadable=True` mapping (`servicer.py:2115`, `@AC-5
  @feature-224`, `@feature-275`); the live loop (`app/main.py:157`); `GetIndicatorSeries`; write-time validation; and `FormulaExecutionError` timeouts
  still propagate as today (feature 185 deliberately never catches them). **Changed with `analysis.backtest.fundamentals.enabled` ON (operator
  sign-off 2026-11-05, a C-16 CHANGE; see FR-7):** a refused `GetFormula` is no longer a fundamentals outage in the backtest and ScoreStrategy.
- **FR-6:** Marking is **referenced-only**: only an unreadable component the *traced rule* references (`referenced_refs`) produces the marker; an
  unreferenced refused component is skipped exactly as today with one log line, so an entry-only foreign formula leaves a held position's firing exit
  intact and an exit rule that references it yields `0/0` (no fabricated REDUCE). A genuine error in any other component (timeout, `UNAVAILABLE`) still
  propagates.
- **FR-7:** The fundamentals availability classification treats a refused `GetFormula` (`NOT_FOUND`/`PERMISSION_DENIED`) as "not a fundamentals
  formula" (no failure recorded) for every caller of `_formula_fundamentals`, so with the gate ON the refusal reaches `ExecuteFormula` and produces
  the same marker on the opportunity/heal paths as on the readiness paths. Real `GetFormula` outages still read UNKNOWN. With the gate OFF there is
  zero change. Consequences with the gate ON: backtest (both start branches) reports the symbol as FORMULA_ERROR instead of "fundamentals fetch
  failed — rerun"; ScoreStrategy / grade recompute no longer abort on it. The live loop's `declared_formula_fundamentals` is unchanged.


## Reproduction Steps

1. As an admin (`x-access-scope` admin) whose own live strategy has a component formula **authored by another user**,
   compute opportunities or call `EvaluateReadiness` for a symbol covered by that strategy. (`EvaluateReadiness`
   resolves the strategy via `get_by_owner_and_id(caller_user_id, …)`, so the strategy must be the admin's own and only the
   formula foreign.)
2. Indicators `ExecuteFormula` returns `PERMISSION_DENIED`.
3. Opportunities rows come back data-unavailable; `EvaluateReadiness` aborts with ERROR.

## Root Cause Hypothesis

Feature 275 added `raise_unreadable` handling only on the backtest evaluator (`servicer.py:2116`); the opportunities
and readiness paths use the default evaluator, whose `_execute_formula` (`evaluator.py:256-275`) re-raises
`PERMISSION_DENIED`, plus a broad `except grpc.RpcError` that folds it into "outage". Simply passing
`raise_unreadable=True` would raise `FormulaExecutionError`, which is documented to propagate and would abort
`EvaluateReadiness` instead of fixing it — the target behaviour is per-symbol degradation; the mechanism is a design
decision. **Unconfirmed:** which caller identity / compute triggered the 2026-10-31 and 2026-11-02 bursts — a recon question for
`/sdd-design`. Narrowed by code reading: the daily opportunity refresh (`servicer.py:5982`) and the readiness
materializer (`:6031`) build their metadata with `owner_metadata()` (`app/identity.py:6-10`), which carries only `x-user-id`
and drops `x-access-scope`; indicators returns `PERMISSION_DENIED` only when it sees the admin bit (`indicators
servicer.py:245`), otherwise `NOT_FOUND` (skipped). So the refusal can only arise on the paths that propagate the
inbound scope — `EvaluateReadiness`, `_kick_readiness_refresh`, the heal, and the `ListOpportunities`-triggered
recompute (`:4894`) — not the scheduled passes (to be confirmed in recon). Another design input: the unreadable verdict is persisted in `readiness_cache`
(FAST-served within `stale_after_seconds`) — recon decides how the marker is persisted and how it heals when the
formula's visibility changes.

## Affected Services

xstockstrat-analysis (`_compute_opportunities`, `EvaluateReadiness`, `compute_readiness_row` and its callers),
xstockstrat-ui (consumer surface), xstockstrat-agent (consumer surface).

## Consumer Surface(s)

- [x] `xstockstrat-ui` `/insights/opportunities`, `/insights/watchlists` (readiness panel), `/trader/positions/[symbol]`
  (the "Why this fired" panel, `SignalReadiness.tsx` — an `EvaluateReadiness` consumer) and the mobile sections (`components/mobile/SectionRenderer.tsx`,
  `sections.ts`, which also consume `dataUnavailable`): show a distinct "formula not readable by you" state (not the
  data-unavailable state, not a `0/N` quiet row), using the canonical state primitives (C-17). Own implementation step.
- [x] `xstockstrat-agent` MCP tool `list_opportunities` (the agent has no readiness tool): exposes the unreadable-formula
  marker on each row. Own implementation step.

(Both are in scope; each earns its own step in the implementation spec — C-14.)

## Fix Scope

- Proto: **additive** `bool formula_unreadable = 25` on `Opportunity` and `bool formula_unreadable = 6` on `SymbolReadiness`
  (`analysis.proto:603-654`, `:673-679`; decided in `design.md`; the precedent is `Opportunity.data_unavailable = 20` / `muted = 12`), with
  `buf lint` + `buf breaking`, `./scripts/buf-gen.sh` and the proto approval gate (C-04, C-09).
- Database: none anticipated — like `data_unavailable`, the state rides the existing provenance JSONB marker (no column).
- Config keys: none.
- Evaluator construction sites: the default-evaluator sites on the opportunities / readiness paths are in scope; the
  complete list is enumerated in recon (sites without `raise_unreadable` currently include several in `servicer.py`).
  `app/main.py:157` is the live-loop evaluator and is explicitly **excluded** (FR-5).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behaviour and pass after the fix
(Constitution **C-15**), plus characterization guards for the preserved rules (**C-16**). Plus: existing tests pass;
analysis, UI and agent smoke-tested on dev.

## Out of Scope

- Indicators' AC-28 refusal itself (`services/xstockstrat-indicators/app/handlers/servicer.py:244-249`) — unchanged.
- The backtest path (`raise_unreadable=True`) and the live loop — unchanged; the fix must not leak into their
  `PERMISSION_DENIED`→`FORMULA_ERROR` mapping (`@AC-5 @feature-224`, feature 275). The live loop therefore still skips a refused component and may
  fire/alert on an OR-rule branch while the queue shows the row as "formula not readable" (accepted, `design.md` Open Risks).
- The genuine-outage batch loss in the readiness kick/materializer/heal and the symbol-wide `fetch_failed` bleed — filed as
  `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md`.
- Measuring the blast radius of the unified refusal (an operator read-only SQL join + `app.maintenance.legacy_authors` report mode, in `design.md`).
- Feature 215's `EvaluateReadiness` parity rule ("must not pass `failures`") — preserved.
- `FormulaExecutionError` timeouts (a separate failure: formula execution timed out after 5000 ms).
- Refactoring and performance work unrelated to the bug.
