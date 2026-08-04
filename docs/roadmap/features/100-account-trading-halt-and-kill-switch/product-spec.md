# Product Spec: account-trading-halt-and-kill-switch

**Created**: 2026-08-04

---

## Problem Statement

There is currently no server-authoritative, caller-agnostic way to stop the platform from increasing
live exposure. A pause implemented only in the UI, the MCP agent, or the strategy scheduler can be
bypassed by any other order-placing caller (a different UI session, a scheduled job, an internal RPC).
Before unattended live trading is safe, a single kill switch enforced inside `xstockstrat-trading`
itself — the last hop before every broker call — must be able to stop all exposure-increasing order
flow regardless of origin.

## User Story

As a platform operator, I want a server-authoritative account trading state (`ACTIVE` / `REDUCE_ONLY`
/ `HALTED` / `EMERGENCY_FLATTEN`) enforced immediately before every broker order submission, so that a
single kill switch — automatic or manual — reliably stops new/increased exposure from any caller while
still allowing safe risk-reducing action.

## Functional Requirements

FR-1. `xstockstrat-trading` persists a per-broker-account `TradingState` (`ACTIVE`, `REDUCE_ONLY`,
`HALTED`, `EMERGENCY_FLATTEN`) and checks it synchronously immediately before every broker order
submission (place, replace) — not solely at the UI, agent, or strategy-scheduler layer.

FR-2. `HALTED` and `REDUCE_ONLY` reject exposure-increasing orders (new entries, size-increasing
replaces) but continue to permit order cancellation and risk-reducing closes.

FR-3. `EMERGENCY_FLATTEN` triggers cancellation of all working orders and closing of all open
positions for the account, then the account transitions to `HALTED`.

FR-4. The gate accepts automatic halt-trigger signals from other safety features as inputs: daily
realized loss threshold and intraday equity drawdown threshold (from `xstockstrat-portfolio`),
consecutive rejected/failed order count, broker auth/connectivity instability, a portfolio
reconciliation mismatch (feature 102), an unprotected live position beyond its SLO (feature 030),
stale market data (feature 106), an abnormal order rate, and config-service uncertainty for
risk-critical keys (e.g. the `WatchConfig` stream disconnecting while a risk-critical key's value is
stale). This feature owns the state machine and enforcement point; the specific trigger formulas are
each owned by the feature that produces the underlying measurement.

FR-5. A manual emergency-stop control transitions the account to `HALTED` or `EMERGENCY_FLATTEN`. No
caller — UI, agent, internal RPC — may bypass an active halt by asserting an administrative
`x-access-scope`.

FR-6. Every state transition is durably audited: actor (system trigger name, or operator user id),
trigger reason code, timestamp, and the supporting measurement(s).

FR-7. `TradingState` persists across `xstockstrat-trading` restarts — a service crash or redeploy must
not silently reset the account to `ACTIVE`.

FR-8. Recovery from `HALTED`/`EMERGENCY_FLATTEN` back to `ACTIVE` requires an explicit operator action;
the triggering condition clearing on its own does not auto-resume trading.

FR-9. The halt check is implemented as a single shared gate reused by every order-ingress code path
inside `xstockstrat-trading` (UI-originated, MCP-agent-originated, strategy-engine-originated,
scheduled-job-originated, internal RPC) — not duplicated per caller (see Known trap below).

## Out of Scope

- The exact numeric thresholds/formulas for each automatic trigger — each lives in the feature that
  produces the underlying measurement (102 reconciliation, 106 market-data gate, 030 protection SLO);
  this feature only defines the state machine and the input contract those features feed.
- Staged live-capital rollout limits — see feature 107.
- The operator-facing safety dashboard beyond a minimal current-state indicator — see feature 108.

## Affected Services

- `xstockstrat-trading` — owns `TradingState`, the enforcement gate, transition audit log, manual
  control RPC.
- `xstockstrat-portfolio` — source of daily realized loss / intraday drawdown measurements used as
  automatic-trigger inputs.
- `xstockstrat-config` — source of "risk-critical key uncertainty" signal (stale/disconnected
  `WatchConfig` stream for a `secret.*` or risk-threshold key).
- `xstockstrat-notify` — halt/recovery alert emission.
- `xstockstrat-ui` — manual halt/resume control and status banner.
- `xstockstrat-agent` — existing order-placement tool responses must surface the halt rejection reason
  (no new tool name).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment: `/trader` — new manual halt/resume control plus a persistent
  trading-state status banner, registered in `PLATFORM_SUBNAV` per **C-10(a)**.
- [x] **Agent** — existing trade-placement MCP tool(s) (no new tool): rejected-order responses gain a
  `HALTED`/`REDUCE_ONLY` reason code so the agent (and any strategy calling through it) sees why an
  order was refused.
- [ ] **None**

## Proto Contract Changes

- New RPCs on `TradingService` (exact names TBD at `/sdd-spec`): get current `TradingState`, set state
  manually (operator-only), and a way for order-placing RPCs to report the halt reason on rejection.
- New enum `TradingState` with `TRADING_STATE_UNSPECIFIED = 0` sentinel per root CLAUDE.md governance
  rule (prefer enums over strings for a closed, deployment-time-defined value set).

## Config Key Changes

- OR: list keys in `<service>.<category>.<key>` format — exact keys (e.g.
  `trading.risk.daily_loss_halt_pct`, `trading.risk.drawdown_halt_pct`,
  `trading.risk.max_consecutive_order_failures`) to be finalized at `/sdd-spec`; per root CLAUDE.md, no
  threshold may be hardcoded in source.

## Database Changes

- New migration in `services/xstockstrat-trading/migrations/`: a `trading_state` table (current state
  per account) and a `trading_state_transitions` audit table (actor, trigger, timestamp, measurements).

## Feature Workflow Notes

Branch to create: `feature/account-trading-halt-and-kill-switch` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. A halt (automatic or manual) propagates to every order ingress — UI, MCP, strategy engine,
   scheduled jobs, internal RPCs — with no code path able to submit an exposure-increasing order to
   the broker while `HALTED`/`EMERGENCY_FLATTEN` is active.
2. No caller can override an active halt by asserting an administrative `x-access-scope`.
3. `HALTED` rejects new/increasing exposure but still permits cancellations and risk-reducing closes.
4. `TradingState` persists across a `xstockstrat-trading` restart.
5. Every transition is audited with actor, trigger, timestamp, and supporting measurements.
6. Recovery from `HALTED`/`EMERGENCY_FLATTEN` requires an explicit operator action — never automatic.
7. A full outage of `xstockstrat-trading` is not itself relied upon as the kill-switch mechanism (the
   state and gate exist independently of any one caller being up).

## Open Questions

- [ ] **Known trap (ledger `fails.md` 2026-07-01, 060-screener-engine):** the new `/trader` halt
  control/banner must be registered in `PLATFORM_SUBNAV` and covered by a nav-reachability test — do
  not ship the control unreachable from the shared nav.
- [ ] Which service evaluates each automatic-trigger threshold in real time — a loop inside
  `xstockstrat-trading` itself, or does each producing feature (102/106/030) push a signal via RPC?
  Flag for `/sdd-design`.
- [ ] Should `EMERGENCY_FLATTEN` be reachable only automatically (via reconciliation finding an
  "impossible state") or also as a direct manual operator action distinct from `HALTED`? Flag for
  `/sdd-design`.
