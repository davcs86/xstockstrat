# packages/proto — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — timeframe-migration row extended with `BatchGetBarsRequest`; line hints re-stamped; all other findings still open); refreshed 2026-11-04 (branch `ccr-d09db3b6-ao7ybn` @ `9892b61` — nothing resolved; +2 doc-lie rows, +2 dead-field rows, 5 more closed-set strings, +4 asymmetry bullets). For triage/fixing, not governance.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Deprecated `string timeframe` fields say "Removed in a future release once all callers migrate" | The migration is stalled — `indicators.proto#ComputeIndicatorRequest.timeframe (~L60)` never adopted the enum (still a plain `string timeframe = 6`); likewise `marketdata.proto#BatchGetBarsRequest` (`string timeframe = 2`, not deprecated, ~L326) (found 2026-10-19) | `marketdata.proto#string timeframe = 10 [deprecated = true] (~L86)` et al. vs `indicators.proto#ComputeIndicatorRequest.timeframe (~L60)` and `marketdata.proto#BatchGetBarsRequest (~L324-326)` (plain non-deprecated strings) | Migrate indicators and `BatchGetBarsRequest` to the `Timeframe` enum, then complete the removal |
| `analysis.proto#StrategyDefinition.sector_param_overrides` (~L388-391) is commented "maskable" (found 2026-11-04) | The `ManageStrategyRequest` allowed-paths list (~L429-430; it now includes `denied_symbols` and `signal_eligible`) omits it, so an agent following the list gets `INVALID_ARGUMENT` on a masked update | `packages/proto/analysis/v1/analysis.proto#ManageStrategyRequest`, `#StrategyDefinition` | Decide which side is wrong (the proto comment or the servicer's allow-list) |
| `ledger.proto#ExportEventsRequest.event_type` (~L90-92) gives the example "fill,signal,pnl_snapshot,config_change,alert" (found 2026-11-04) | The ledger splits on `,` and matches `event_type = ANY` exactly (`ledgerServiceImpl.ts#exportEvents` ~L397-407); real event types are dotted (`order.created`, `order.filled`), and `pnl_snapshot` / `config_change` appear only in UI e2e fixtures — no emitter | `packages/proto/ledger/v1/ledger.proto#ExportEventsRequest`; `services/xstockstrat-ui/e2e/fixtures/ledgerEvents.ts` | Use real dotted examples |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `common.v1.Decimal` (ISO-4217 decimal type) | zero references — money is `double` everywhere | `common.proto#Decimal (~L28)` (grep zero) |
| `common.v1.Error` (shared error envelope) | zero references — services rely on gRPC status codes | `common.proto#Error (~L21)` (grep zero) |
| `analysis.NO_TRADE_REASON_INSUFFICIENT_CAPITAL = 3` | reserved-but-never-emitted enum value (documented placeholder "not emitted this version") — no action required, but a consumer must not branch on it expecting it to appear | `analysis.proto#NO_TRADE_REASON_INSUFFICIENT_CAPITAL (~L200)` |
| `analysis.proto#Opportunity.sparkline` (=17, ~L626) and `#SparklinePoint` (~L658) (found 2026-11-04) | Write-dead: zero hits for `sparkline` / `SparklinePoint` in `services/xstockstrat-analysis/app`, and `analysis/CLAUDE.md` says the enrichment fetches no bars — yet the field comment (~L616-618) still calls it a "READ-TIME live-market field" and the agent still projects it. Whether the UI still reads it was not checked | `analysis.proto#Opportunity`; `services/xstockstrat-agent/app/client.py#_opportunity_to_dict` |
| `analysis.proto#ScreenSymbolsRequest.evaluation_window` (=8, ~L543) (found 2026-11-04) | "Reserved/optional … deferred OQ-060-e" — zero hits in `services/xstockstrat-analysis/app` | `analysis.proto#ScreenSymbolsRequest` |

## Open questions (unresolved *why* — needs a maintainer)

- Closed-set values modeled as `string` despite the enum-preference rule and an existing enum: `analysis.TradeRecord.side` (though `trading.OrderSide` exists), `StrategyScore.rating` "A/B/C/D/F", ~~`Order.time_in_force`~~ (now the `TimeInForce` enum, 2026-10-14) — **and the set has WIDENED**: new siblings `analysis.OrderSnapshot.side` (~L871) and `analysis.ConditionEval.fn` (~L666, values `>,<,>=,<=,crosses_above,crosses_below`). Are these cleanup targets (convert to enums) or intentionally open? Note the counter-signal: `portfolio.proto` now uses enums freely (`POSITION_RISK_FLAG`, `POSITION_SOURCE`, `POSITION_SIDE`, `WATCHLIST_ENTRY_SOURCE`, all `_UNSPECIFIED=0`), so the asymmetry is sharper. `analysis.proto#TradeRecord.side (~L174)`, `#StrategyScore.rating (~L253)`, `#BacktestRunSummary.rating (~L290)`, `#ConditionEval.fn (~L666)`, `#OrderSnapshot.side (~L871)`; `trading.proto#time_in_force (~L58,118,198)` — status: **open** (2026-11-04: five more closed-set strings: `analysis.proto#FundamentalsScanSummary.status` (~L565), `trading.proto#GetTradingEnvironmentResponse.application_env` (~L296), `marketdata.proto#HistoricalFundamentalsPeriod.period_type` (~L268) and `GetHistoricalFundamentalsRequest.period_types` (~L296), `marketdata.proto#SectorHistoryRow.source` (~L383))
- Is "return the bare domain type for a single natural return, wrapper only when >1 field" the intended RPC-shape rule (enabled by the buf lint exceptions), or legacy inconsistency to converge? — status: **open**

## Asymmetries worth triage (2026-10-14)

- `trading.proto#ListOrdersRequest.user_id` and `StreamOrderUpdatesRequest.user_id` stay un-deprecated while the sibling mutation requests deprecated theirs; no in-proto comment says whether it is an owner filter, an identity, or a pending deprecation — status: **open**
- `trading_mode` is `[deprecated]` across `config.proto` (feature 147) but still live and un-deprecated in `portfolio.proto` and `trading.proto` — an agent copying the config pattern into those would be wrong; deliberate or pending removal? — status: **open**
- `InstantiateTemplate` returns the bare domain type in analysis (`StrategyDefinition`) and ingest (`SignalSource`) but a wrapper (`InstantiateTemplateResponse`) in indicators — feeds the RPC-shape question above — status: **open**
- `ConditionEval.fn` and `OrderSnapshot.side` (closed sets) are strings again after `portfolio` moved to enums — status: **open**
- `packages/proto/CLAUDE.md` does not mention the feature-224 admin-selector convention (PROTO-10).
- `notify.proto#MarkAlertReadRequest`, `RegisterPushSubscriptionRequest` and `UnregisterPushSubscriptionRequest` carry no `user_id` (header identity), while `StreamAlertsRequest`, `AcknowledgeAlertRequest` and `ListAlertsRequest.user_id` (~L83, 91, 99) are still live body fields; `ListAlertsRequest` also says "calling user" for `unread_only` / `unread_count` (~L103, 109). Accidental legacy, or a filter-versus-identity split the proto does not state? — status: **open** (found 2026-11-04)
- `trading.proto#SnapshotOfflinePositionsRequest.user_id` (~L336) is commented "caller identity (ownership + reconciliation payload)" — header-derived (so deprecate it like its siblings) or a live selector? Conflicts with PLAT-11 and the constitution's "not identity" gotcha — status: **open** (found 2026-11-04)
- `portfolio.proto#Watchlist.symbols` is deprecated (~L258) while the request-side `symbols` fields on `CreateWatchlistRequest` / `UpdateWatchlistRequest` / `AddWatchlistSymbolsRequest` are not and are still accepted as "legacy"; the comment at ~L271 ("user_id is intentionally absent from all request messages") sits above the watchlist block only, while earlier messages still carry a deprecated `user_id` — status: **open** (found 2026-11-04)
- `marketdata.proto#SectorHistoryRow.valid_from` (~L381) uses a `1900-01-01` epoch-seed sentinel. It is commented, but is it a contract consumers may rely on? — status: **open** (found 2026-11-04)


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-proto-contract-hygiene-defect`](../../../docs/reports/2026-10-19-proto-contract-hygiene-defect.md) | Proto contract hygiene drift — stalled timeframe migration, orphaned types, closed-set strings, mislabelled user_id |
| [`2026-10-19-trading-listorders-body-user-id-filter-defect`](../../../docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md) | Trading ListOrders/StreamOrderUpdates trust a body user_id filter where empty means all users |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
