# packages/proto — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`). For triage/fixing, not governance.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Deprecated `string timeframe` fields say "Removed in a future release once all callers migrate" | The migration is stalled — `indicators.proto:49` never adopted the enum (still a plain `string timeframe = 6`) | `marketdata.proto:54` (`[deprecated=true]`) et al. vs `indicators.proto:49` (plain non-deprecated string) | Migrate indicators to the `Timeframe` enum, then complete the removal |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `common.v1.Decimal` (ISO-4217 decimal type) | zero references — money is `double` everywhere | `common.proto:28` (grep zero) |
| `common.v1.Error` (shared error envelope) | zero references — services rely on gRPC status codes | `common.proto:21` (grep zero) |
| `analysis.NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3` | reserved-but-never-emitted enum value (documented placeholder "not emitted this version") — no action required, but a consumer must not branch on it expecting it to appear | `analysis.proto:189` |

## Open questions (unresolved *why* — needs a maintainer)

- Closed-set values modeled as `string` despite the enum-preference rule and an existing enum: `analysis.TradeRecord.side` (though `trading.OrderSide` exists), `StrategyScore.rating` "A/B/C/D/F", `Order.time_in_force` — **and the set has WIDENED**: new siblings `analysis.OrderSnapshot.side` (`:747`) and `analysis.ConditionEval.fn` (`:589`, values `>,<,>=,<=,crosses_above,crosses_below`). Are these cleanup targets (convert to enums) or intentionally open? Note the counter-signal: `portfolio.proto` now uses enums freely (`POSITION_RISK_FLAG`, `POSITION_SOURCE`, `POSITION_SIDE`, `WATCHLIST_ENTRY_SOURCE`, all `_UNSPECIFIED=0`), so the asymmetry is sharper. `analysis.proto:164` (`TradeRecord.side`), `:232` (`StrategyScore.rating`), `:268` (`BacktestRunSummary.rating`), `:589,:747`; `trading.proto:58,108,188` (`time_in_force`) — status: **open**
- Is "return the bare domain type for a single natural return, wrapper only when >1 field" the intended RPC-shape rule (enabled by the buf lint exceptions), or legacy inconsistency to converge? — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
