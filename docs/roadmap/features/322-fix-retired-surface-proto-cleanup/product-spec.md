# Product Spec: fix-retired-surface-proto-cleanup

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-trading-mode-axis-retained-defect.md, docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md, docs/reports/2026-10-19-proto-contract-hygiene-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Retired trading_mode axis still plumbed through watchers, marketdata and service docs

Report: [docs/reports/2026-10-19-trading-mode-axis-retained-defect.md](../../../reports/2026-10-19-trading-mode-axis-retained-defect.md)

- **Observed:** feature 147 removed the `trading_mode` config axis and `config.proto` marks every
  `trading_mode` field deprecated/ignored, yet: Python watchers (analysis/indicators/ingest) read
  `TRADING_MODE` and set `trading_mode` on `WatchConfigRequest`; Go watchers (trading/portfolio/marketdata)
  keep `resolveTradingMode` and an unread `w.tradingMode`; Node `configWatcher.ts` (config/identity/ledger/notify)
  sends `TRADING_MODE_UNSPECIFIED`; marketdata sets an unread `alpaca.ClientConfig.Paper` and the seeded
  `marketdata.alpaca.paper` key has no reader; eight service `CLAUDE.md` env blocks list `TRADING_MODE=paper`.
  Still live: trading uses the env as the `trading.broker.paper` fallback.
- **Expected:** finish the removal, or document precisely which consumer still uses `TRADING_MODE`.

### Server-side opportunity sparkline removed but acceptance, proto field and agent projection remain

Report: [docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md](../../../reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md)

- **Observed:** live enrichment calls only `BatchGetLatestPrice` (UI fetches its own bars), but durable
  `@AC-8` still requires "BatchGetBars once for all 30 symbols (sparkline)"; `Opportunity.sparkline` (17) is
  never populated; the agent projects an always-empty `o.sparkline`; `analysis.opportunity.sparkline_bars` is
  inert yet seeded and bounded; migration 028's TTL-key description still says "live-quote/sparkline memo".
- **Expected:** drop the `BatchGetBars` step from `@AC-8`; deprecate `Opportunity.sparkline` (keep the field
  number); remove the dead agent projection; retire or annotate the inert key.

### Proto contract hygiene drift — stalled timeframe migration, orphaned types, closed-set strings, mislabelled user_id

Report: [docs/reports/2026-10-19-proto-contract-hygiene-defect.md](../../../reports/2026-10-19-proto-contract-hygiene-defect.md)

- **Observed:** (1) `ComputeIndicatorRequest.timeframe` and `BatchGetBarsRequest.timeframe` are plain,
  non-deprecated strings while siblings promise removal; (2) `common.v1.Decimal` / `common.v1.Error` have no
  references; (3) closed sets modelled as `string`: `TradeRecord.side`, `StrategyScore.rating`,
  `ConditionEval.fn`, `OrderSnapshot.side`; (4) `SnapshotOfflinePositionsRequest.user_id` is labelled
  "caller identity" but not deprecated, though the handler overwrites it from `x-user-id`.
- **Expected:** migrate the two string timeframes to the `Timeframe` enum; deprecate/document the orphaned
  common types; decide enum-vs-open for the closed-set strings; mark `SnapshotOfflinePositions.user_id`
  `[deprecated = true]` like its sibling mutation requests.

## Reproduction Steps

1. trading_mode: compare root `CLAUDE.md` § Config Governance with the watcher/marketdata evidence;
   `grep -rn "\.Paper\b\|alpaca.paper" services/xstockstrat-marketdata services/*/app services/*/src` — no reader.
2. sparkline: read `services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature:24`;
   `grep -rn sparkline services/xstockstrat-analysis/app` → no matches; read the agent projection.
3. proto: read `marketdata.proto` deprecated timeframes vs `indicators.proto:60` / `marketdata.proto:333`;
   grep `Decimal|Error` in `packages/proto/**/*.proto` → definitions only; read `trading.proto:336` vs
   `services/xstockstrat-trading/internal/handler/trading.go` (`req.Msg.UserId = extractUserID(ctx)`).

## Root Cause Hypothesis

- Feature 147 deprecated the `trading_mode` proto fields server-side but left client resolvers, the marketdata
  `Paper` plumbing and per-service doc env blocks.
- The sparkline moved client-side (flagged by feature 227) without a sweep of the durable acceptance suite,
  proto, agent projection and config metadata.
- Incremental per-feature proto evolution without a cleanup pass.

Current sites (spot-checked at 0fecb24d): `resolveTradingMode` in `services/xstockstrat-{trading,portfolio,marketdata}/internal/config/config.go`;
`trading_mode=` in `services/xstockstrat-{analysis,indicators,ingest}/app/config/watcher.py`; marketdata `Paper` at
`cmd/server/main.go:99` / `internal/alpaca/client.go:50`; `opportunities-latency-fix.feature:24`;
`analysis.proto:626` (`sparkline = 17`); `services/xstockstrat-agent/app/client.py:899-900`;
`migrations/028_analysis_opportunity_keys.up.sql:112`; `indicators.proto:60`, `marketdata.proto:333`;
`common.proto:21,28`; `analysis.proto:174,254,671,879`; `trading.proto:336`.

## Affected Services

- packages/proto (config, analysis, indicators, marketdata, trading, common)
- xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest (Python watchers; analysis acceptance)
- xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata (Go watchers; marketdata `Paper`)
- xstockstrat-config, xstockstrat-identity, xstockstrat-ledger, xstockstrat-notify (Node watchers; config seeds)
- xstockstrat-agent (sparkline projection; `SnapshotOfflinePositions` caller)

## Fix Scope

- [x] Proto changes anticipated: **yes** — deprecate `Opportunity.sparkline`, timeframe enum migration,
  `SnapshotOfflinePositions.user_id` deprecation, orphaned common types, possible closed-set enums.
- [x] Database migrations anticipated: **yes (config seeds)** — retiring/annotating `analysis.opportunity.sparkline_bars`,
  `marketdata.alpaca.paper` and correcting the 028 description need a new config migration (applied migrations are never edited).
- [x] Config key changes anticipated: **yes** — the inert `analysis.opportunity.sparkline_bars` and unread
  `marketdata.alpaca.paper` keys are retired or annotated.

## Open Questions

1. `trading_mode`: finish the removal everywhere, or keep `TRADING_MODE` only as trading's
   `trading.broker.paper` fallback and document it (coordinate with feature 321 open question 2)?
2. Closed-set strings (`TradeRecord.side`, `StrategyScore.rating`, `ConditionEval.fn`, `OrderSnapshot.side`):
   enum or open string, per field? The report leaves this decision open.
3. Orphaned `common.v1.Decimal` / `Error`: deprecate-and-document or remove?
4. `analysis.opportunity.sparkline_bars`: retire the key or annotate it as inert?
5. Is the timeframe enum migration (adding enum fields, deprecating two strings) in this bug's scope, or split out?
6. Editing durable `@AC-8` in `services/xstockstrat-analysis/acceptance/` changes a promoted business rule
   — confirm the C-16 handling.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; `buf lint` + `buf breaking` pass;
affected service(s) smoke-tested on dev.

## Out of Scope

- Trading's `trading.broker.paper` seeding / fallback semantics (feature 321).
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
