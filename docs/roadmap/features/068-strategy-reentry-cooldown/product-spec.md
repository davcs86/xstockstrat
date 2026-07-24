# Product Spec: strategy-reentry-cooldown

**Created**: 2026-07-24

---

## Problem Statement

`StrategyDefinition.entry_rule`/`exit_rule` are evaluated per-bar with no memory of recent trade
history: `_backtest_symbol_evaluated` (`services/xstockstrat-analysis/app/handlers/servicer.py:849`)
allows immediate re-entry — `if position == 0.0 and decision.entry:` fires on the very next bar with
no check of how recently the position on that symbol was exited. This was observed empirically
while validating a shadow recalibration of the `range_mean_reversion` strategy: a variant with a
tightened, more defensive exit rule stopped out of a losing WSM position and re-entered the same
still-declining symbol four times within about a month, each re-entry incurring a fresh loss plus
commission/slippage — worse win rate (66.7%→46.7%) and Sharpe (-0.55→-1.07) than a single longer
hold would have produced, despite the exit rule successfully defusing a comparable situation on a
different symbol (BX) where price genuinely reversed after the cooldown-shaped gap would have
occurred. Strategy authors need a way to suppress re-entry on a symbol for a period after an exit.

## User Story

As a strategy calibrator, I want strategies to enforce a configurable re-entry cooldown period per
symbol after an exit, so that a rule-based strategy cannot immediately whipsaw back into the same
symbol while a losing move is still in progress, and so that (by default) the cooldown is long
enough to avoid triggering U.S. wash-sale disallowance on a repurchase.

## Functional Requirements

FR-1. `StrategyDefinition` gains an optional `cooldown_days` field (calendar days, not trading-day
bar counts). `0`/unset means "use the platform default."

FR-2. A new config key `analysis.strategy.default_cooldown_days` (int, default `31`) supplies the
default when a strategy's `cooldown_days` is `0` — 31 calendar days is chosen specifically to sit
outside the IRS wash-sale window (30 calendar days before/after a sale at a loss), matching this
repo's existing "no hardcoded values in source" config convention and the `get_int` zero-trap
pattern already used by `analysis.scoring.shrinkage_days`.

FR-3. The cooldown is enforced per `(strategy_id, symbol)` pair: after an exit on that symbol, the
entry condition must not fire again until at least `cooldown_days` calendar days (measured via bar
timestamps, not trading-day bar counts — weekends/holidays must not shrink the effective wait) have
elapsed since the exit.

FR-4. The cooldown must be enforced identically in both the backtest engine
(`_backtest_symbol_evaluated`, `servicer.py`) and the live evaluation loop (`app/engine/live_loop.py`)
— this service's stated backtest/live parity invariant applies to the cooldown exactly as it does
to entry/exit evaluation itself.

FR-5. Default behavior applies the cooldown after **any** exit (win or loss), not only realized
losses, for implementation simplicity and consistency — a losing-exits-only variant is a legitimate
alternative (closer to the literal wash-sale rule, which only disallows loss claims) but adds
per-trade P&L-sign tracking to the cooldown gate; the design phase should weigh both and record the
choice.

FR-6. `ManageStrategy` register/update must accept and echo `cooldown_days`, and reject a negative
value with `INVALID_ARGUMENT` (mirroring existing definition-validation patterns in this service).

## Out of Scope

- Persisting cooldown/last-exit state across a service restart. The live loop's existing
  per-`(strategy_id, symbol)` transition state (`_last_state`, `live_loop.py:54`) is already
  in-memory-only and resets on restart; the cooldown's last-exit timestamp follows the same
  established pattern. Making that durable is a separate concern, not introduced by this feature.
- A losing-exits-only cooldown variant (see FR-5) — may be adopted during design, not assumed here.
- Applying a cooldown to non-`entry_rule`/`exit_rule` strategies (the legacy SMA-crossover fallback
  path, `_backtest_symbol`) — this feature targets the composable-rule (`active_definition`) path
  only, matching where the observed whipsaw behavior occurs.
- Retroactively recomputing existing `backtest_run_symbols` evidence cells or cross-stock scores.

## Affected Services

- `xstockstrat-analysis` — proto field, backtest engine cooldown gate, live-loop cooldown gate, new
  config key, `ManageStrategy` validation.
- `packages/proto` — additive field on `StrategyDefinition` (`analysis/v1/analysis.proto`), no other
  message changes anticipated.

## Proto Contract Changes

- [ ] No proto changes required
- [x] New field: `StrategyDefinition.cooldown_days` (`int32`, field number `9` — the next free
  number; existing fields 1–8 are `strategy_id`…`live_enabled`). Additive, non-breaking.

## Config Key Changes

- [ ] No new config keys
- [x] `analysis.strategy.default_cooldown_days` (int, default `31`) — wash-sale-safe default
  cooldown in calendar days, applied when a strategy's `cooldown_days` is `0`.

## Database Changes

- [x] No schema changes — cooldown state (per-symbol last-exit timestamp) is tracked in-memory,
  mirroring the existing `_last_state` transition-tracking pattern in `live_loop.py` (see Out of
  Scope).

## Feature Workflow Notes

Branch to create: `feature/strategy-reentry-cooldown` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto field addition + new config key — both
  non-breaking; `xstockstrat-analysis` is the sole affected service)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable, additive field only
- [ ] DBA review + service owner (schema migration) — not applicable, no schema change

## Acceptance Criteria

1. Registering/updating a strategy with `cooldown_days` set persists and round-trips the value via
   `ManageStrategy`; a negative value is rejected with `INVALID_ARGUMENT`.
2. A strategy with `cooldown_days` unset (`0`) uses `analysis.strategy.default_cooldown_days` (31)
   as its effective cooldown.
3. Backtest: given a symbol whose entry condition is true again the bar immediately after an exit,
   no new entry is recorded until at least the effective cooldown's worth of calendar days (by bar
   timestamp) have elapsed since that exit; this is covered by a unit test reproducing the WSM-style
   whipsaw shape (exit, entry-condition-still-true next bar, no re-entry until cooldown elapses).
4. Live loop: the same `(strategy_id, symbol)` cooldown gate suppresses an entry trigger within the
   cooldown window, verified by a test analogous to the backtest one.
5. A backtest re-run of the `range_mean_reversion_v2`/`v3` shadow strategies (or an equivalent
   synthetic fixture reproducing the WSM trade sequence) with the wash-sale-safe default cooldown
   shows no immediate re-entry into a symbol within 31 calendar days of exiting it.
6. `docs/patterns/config-governance.md` and `services/xstockstrat-analysis/CLAUDE.md` are updated
   with the new config key per the existing config-key documentation convention.

## Open Questions

- [ ] **Known trap (ledger `fails.md` 2026-07-01 — 056-open-positions-ui, duplication / C-10(b))**:
  this feature has exactly two enforcement paths (backtest engine, live loop) for the same
  cooldown rule — confirm the design phase specifies one shared cooldown-check helper (or two call
  sites against one shared function) rather than two independently-implemented copies, and that a
  parity test asserts both paths agree, mirroring the C-10(b) lesson from the portfolio
  `ListPositions`/`ListPortfolios` divergence.
- [ ] Should `cooldown_days` be included in the feature-065 cross-stock-score definition fingerprint
  (`_definition_fingerprint`, which hashes `definition_json` excluding only `display_name`/`active`/
  `live_enabled`)? Since it changes realized trading behavior, the existing fingerprint rule already
  implies "yes, include it" (any behavioral field is hashed by default) — flagging for explicit
  confirmation at design time since it means a `cooldown_days` change resets evidence eligibility,
  same as any other entry/exit rule change.
- [ ] Confirm FR-5's "any exit" default vs. a losses-only cooldown variant during design — the user
  story requested the wash-sale-safe *default value* (31 days) explicitly; whether the trigger
  condition is "any exit" or "losing exit only" is a separate, still-open design choice.
- [ ] Does the live-loop cooldown need to survive a service restart, or is in-memory-only
  (matching `_last_state`) acceptable for v1? Leaning toward "acceptable" (see Out of Scope) but
  flagging since a restart mid-cooldown would let an entry fire early.
