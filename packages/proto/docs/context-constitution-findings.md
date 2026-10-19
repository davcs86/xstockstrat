# packages/proto — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — timeframe-migration row extended with `BatchGetBarsRequest`; line hints re-stamped; all other findings still open). For triage/fixing, not governance.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Deprecated `string timeframe` fields say "Removed in a future release once all callers migrate" | The migration is stalled — `indicators.proto#ComputeIndicatorRequest.timeframe (~L60)` never adopted the enum (still a plain `string timeframe = 6`); likewise `marketdata.proto#BatchGetBarsRequest` (`string timeframe = 2`, not deprecated, ~L326) (found 2026-10-19) | `marketdata.proto#string timeframe = 10 [deprecated = true] (~L86)` et al. vs `indicators.proto#ComputeIndicatorRequest.timeframe (~L60)` and `marketdata.proto#BatchGetBarsRequest (~L324-326)` (plain non-deprecated strings) | Migrate indicators and `BatchGetBarsRequest` to the `Timeframe` enum, then complete the removal |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `common.v1.Decimal` (ISO-4217 decimal type) | zero references — money is `double` everywhere | `common.proto#Decimal (~L28)` (grep zero) |
| `common.v1.Error` (shared error envelope) | zero references — services rely on gRPC status codes | `common.proto#Error (~L21)` (grep zero) |
| `analysis.NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3` | reserved-but-never-emitted enum value (documented placeholder "not emitted this version") — no action required, but a consumer must not branch on it expecting it to appear | `analysis.proto#NO_TRADE_REASON_INSUFFICIENT_CAPITAL (~L200)` |

## Open questions (unresolved *why* — needs a maintainer)

- Closed-set values modeled as `string` despite the enum-preference rule and an existing enum: `analysis.TradeRecord.side` (though `trading.OrderSide` exists), `StrategyScore.rating` "A/B/C/D/F", ~~`Order.time_in_force`~~ (now the `TimeInForce` enum, 2026-10-14) — **and the set has WIDENED**: new siblings `analysis.OrderSnapshot.side` (~L871) and `analysis.ConditionEval.fn` (~L666, values `>,<,>=,<=,crosses_above,crosses_below`). Are these cleanup targets (convert to enums) or intentionally open? Note the counter-signal: `portfolio.proto` now uses enums freely (`POSITION_RISK_FLAG`, `POSITION_SOURCE`, `POSITION_SIDE`, `WATCHLIST_ENTRY_SOURCE`, all `_UNSPECIFIED=0`), so the asymmetry is sharper. `analysis.proto#TradeRecord.side (~L174)`, `#StrategyScore.rating (~L253)`, `#BacktestRunSummary.rating (~L290)`, `#ConditionEval.fn (~L666)`, `#OrderSnapshot.side (~L871)`; `trading.proto#time_in_force (~L58,118,198)` — status: **open**
- Is "return the bare domain type for a single natural return, wrapper only when >1 field" the intended RPC-shape rule (enabled by the buf lint exceptions), or legacy inconsistency to converge? — status: **open**

## Asymmetries worth triage (2026-10-14)

- `trading.proto#ListOrdersRequest.user_id` and `StreamOrderUpdatesRequest.user_id` stay un-deprecated while the sibling mutation requests deprecated theirs; no in-proto comment says whether it is an owner filter, an identity, or a pending deprecation — status: **open**
- `trading_mode` is `[deprecated]` across `config.proto` (feature 147) but still live and un-deprecated in `portfolio.proto` and `trading.proto` — an agent copying the config pattern into those would be wrong; deliberate or pending removal? — status: **open**
- `InstantiateTemplate` returns the bare domain type in analysis (`StrategyDefinition`) and ingest (`SignalSource`) but a wrapper (`InstantiateTemplateResponse`) in indicators — feeds the RPC-shape question above — status: **open**
- `ConditionEval.fn` and `OrderSnapshot.side` (closed sets) are strings again after `portfolio` moved to enums — status: **open**
- `packages/proto/CLAUDE.md` does not mention the feature-224 admin-selector convention (PROTO-10).

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
