# Defect: Proto contract hygiene drift — stalled timeframe migration, orphaned types, closed-set strings, mislabelled user_id

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: contract-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: packages/proto, xstockstrat-indicators, xstockstrat-marketdata, xstockstrat-analysis, xstockstrat-trading, xstockstrat-agent
**Config-only fix possible**: no
**Source**: `packages/proto/docs/context-constitution-findings.md` § Documentation that lies row 1, § Dead code rows 1-2, § Open questions row 1; `docs/context-constitution.md` PLAT-11 landmine

## Observed
1. Timeframe migration stalled: deprecated `string timeframe` fields promise removal "once all
   callers migrate", but `ComputeIndicatorRequest.timeframe` and `BatchGetBarsRequest.timeframe` are
   still plain, non-deprecated strings.
2. `common.v1.Decimal` and `common.v1.Error` have zero references in any `.proto`.
3. Closed-set values modelled as `string` despite the enum-preference rule (and an existing
   `trading.OrderSide`): `TradeRecord.side`, `StrategyScore.rating`, `ConditionEval.fn`, `OrderSnapshot.side`.
4. `SnapshotOfflinePositionsRequest.user_id` is labelled "caller identity" but is not deprecated; the
   handler overwrites it from `x-user-id` (the body value is ignored), and the agent sends both.

## Expected
Migrate the two string timeframes to the `Timeframe` enum; deprecate/document the orphaned common
types; decide enum-vs-open for the closed-set strings; mark `SnapshotOfflinePositions.user_id`
`[deprecated = true]` ("resolved from x-user-id; body ignored") like its sibling mutation requests.

## Reproduction
1. Read `marketdata.proto:85` vs `indicators.proto:60` and `marketdata.proto:326`.
2. Grep `Decimal|Error` in `packages/proto/**/*.proto` (excluding `gen/`) → only the definitions.
3. Read `trading.proto:332` vs `services/xstockstrat-trading/internal/handler/trading.go:90`.

## Evidence
`packages/proto/marketdata/v1/marketdata.proto:85`
> // DEPRECATED: use timeframe_enum. Removed in a future release once all callers migrate.

`packages/proto/indicators/v1/indicators.proto:60`
> string timeframe = 6;

`packages/proto/marketdata/v1/marketdata.proto:326`
> string timeframe = 2;

`packages/proto/common/v1/common.proto:21,28`
> message Error {
> message Decimal {

`packages/proto/analysis/v1/analysis.proto:174,253,666,871`
> string side = 2;
> string rating = 4; // A/B/C/D/F
> string fn = 4;  // >, <, >=, <=, crosses_above, crosses_below
> string side = 6;

`packages/proto/trading/v1/trading.proto:332`
> string user_id = 2;              // caller identity (ownership + reconciliation payload)

`services/xstockstrat-trading/internal/handler/trading.go:89-90`
> // Caller identity from the trusted x-user-id header the edge injects.
> req.Msg.UserId = extractUserID(ctx)

`services/xstockstrat-agent/app/client.py:2310,2321`
> user_id=user_id,
> resp = await stub.SnapshotOfflinePositions(req, metadata=_metadata(("x-user-id", user_id)))

## Root cause hypothesis
Incremental per-feature proto evolution without a cleanup pass; each item is individually harmless
but misleads agents copying patterns from the contracts.

## Confidence
high
