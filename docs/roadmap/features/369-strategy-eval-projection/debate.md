# Debate Register: strategy-eval-projection

**State**: in-debate
**Mode**: full (round cap lifted by operator override, context.md 2026-11-28)
**Rounds run**: 0

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 0 (pre-debate gate) | 2026-11-28 | /sdd-design | 3 (operator) | 4 | 0 | 0 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 0 (gate) | Read path scope: this feature stores entry and exit readiness per user, strategy and symbol and serves `EvaluateReadiness` and `GetWatchlistReadiness` from the projection behind `analysis.projection.read_source` (default `legacy`), with a parity test per RPC. The opportunity projection and `ListOpportunities` stay on the legacy path and move to program feature 4 (`pipeline-cutover`). Operator decision 2026-11-28; narrows FR-8. | recon.md § Opportunity and readiness read paths; context.md 2026-11-28 | settled |
| D-2 | 0 (gate) | Evaluation jobs read bars through a marketdata read that does not mark the symbol warm: marketdata gains an additive flag or RPC used only by these jobs. Adds marketdata to the affected services. Operator decision 2026-11-28. | `services/xstockstrat-marketdata/internal/service/marketdata_service.go:301`, `:854`, `:971`; 368 design.md § 17 | settled |
| D-3 | 0 (gate) | Parity observes the live loop without changing it: transitions are compared by reading the live loop's existing cooldown rows after the close, readiness against the legacy readiness values; pairs the live loop did not reach are reported as not comparable. Operator decision 2026-11-28. | analysis `app/repositories/strategy_cooldowns.py:27`, `:43`, `:59`; `app/engine/live_loop.py:358` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 0 (gate) | Serve `ListOpportunities` from the projection in this feature. | Opportunities are universe membership with fields derived from signals, positions, the deny list and grades; storing them all would bring that compute into the evaluation job. Operator chose D-1. | locked |
| R-2 | 0 (gate) | No read path at all in this feature. | Reads would switch at cutover untested in shadow. Operator chose D-1. | locked |
| R-3 | 0 (gate) | Read bars through the existing warming RPCs and accept the warm set growing to the whole universe. | Continuous vendor polling of every universe symbol, competing with 368's post-close fetch. Operator chose D-2. | locked |
| R-4 | 0 (gate) | Add a per-pair decision log to the live loop for exact parity. | Changes the live loop's hot path, against FR-11. Operator chose D-3. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
