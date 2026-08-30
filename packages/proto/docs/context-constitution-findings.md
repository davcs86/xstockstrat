# packages/proto — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Deprecated `string timeframe` fields say "Removed in a future release once all callers migrate" | The migration is stalled — `indicators.proto:49` never adopted the enum (still a plain `string timeframe = 6`) | `marketdata.proto:54` (`[deprecated=true]`) et al. vs `indicators.proto:49` (plain non-deprecated string) | Migrate indicators to the `Timeframe` enum, then complete the removal |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `common.v1.Decimal` (ISO-4217 decimal type) | zero references — money is `double` everywhere | `common.proto:28` (grep zero) |
| `common.v1.Error` (shared error envelope) | zero references — services rely on gRPC status codes | `common.proto:21` (grep zero) |

## Open questions (unresolved *why* — needs a maintainer)

- Closed-set values modeled as `string` despite the enum-preference rule and an existing enum: `analysis.TradeRecord.side` (though `trading.OrderSide` exists), `StrategyScore.rating` "A/B/C/D/F", `Order.time_in_force`. Are these cleanup targets (convert to enums) or intentionally open? `analysis.proto:160` (`TradeRecord.side`), `:229` (`StrategyScore.rating`), `:265` (`BacktestRunSummary.rating`); `trading.proto:49,99` (`time_in_force`) — status: **open**
- Is "return the bare domain type for a single natural return, wrapper only when >1 field" the intended RPC-shape rule (enabled by the buf lint exceptions), or legacy inconsistency to converge? — status: **open**

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
