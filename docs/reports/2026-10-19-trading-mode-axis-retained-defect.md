# Defect: Retired trading_mode axis still plumbed through watchers, marketdata and service docs

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-marketdata, xstockstrat-portfolio, xstockstrat-trading, xstockstrat-config, xstockstrat-identity, xstockstrat-ledger, xstockstrat-notify
**Config-only fix possible**: no
**Source**: `docs/context-constitution-findings.md` § Documentation that lies row "TRADING_MODE"; `docs/context-constitution.md` PLAT-8 ("`resolveTradingMode`/`w.tradingMode` linger")

## Observed
Root `CLAUDE.md` says feature 147 removed the `trading_mode` config axis (paper/live derives from
environment), and `config.proto` marks every `trading_mode` field deprecated/ignored. Residue:
- Python watchers (analysis/indicators/ingest) read the `TRADING_MODE` env and still set the
  deprecated `trading_mode` on `WatchConfigRequest`.
- Go watchers (trading/portfolio/marketdata) keep `resolveTradingMode` and assign the
  `w.tradingMode` field, which is never read; trading's comment still claims tradingMode scopes requests.
- Node `configWatcher.ts` (config/identity/ledger/notify) still sends `TRADING_MODE_UNSPECIFIED`.
- marketdata sets `alpaca.ClientConfig.Paper` from `TRADING_MODE`, but `Paper` is never read by the
  client; the seeded `marketdata.alpaca.paper` key has no reader at all.
- Eight service `CLAUDE.md` env blocks still list `TRADING_MODE=paper  # paper | live`.
Not dead everywhere: trading still uses the env as the fallback for `trading.broker.paper`.

## Expected
Either finish the removal (drop resolvers, request fields, the unread `Paper` field/key and the doc
env lines) or document precisely which consumer still uses `TRADING_MODE` (trading broker fallback).

## Reproduction
1. Read root `CLAUDE.md` § Config Governance ("the old `trading_mode` config axis was removed").
2. Compare with the evidence lines below.
3. `grep -rn "\.Paper\b\|alpaca.paper" services/xstockstrat-marketdata services/*/app services/*/src` — no reader.

## Evidence
`services/xstockstrat-analysis/app/config/watcher.py:49,63`
> self._trading_mode = resolve_trading_mode(os.environ.get("TRADING_MODE", "paper"))
> trading_mode=self._trading_mode,

`services/xstockstrat-trading/internal/config/config.go:79,100`
> // applicationEnv/tradingMode scope every WatchConfig request to this deployment's own config rows.
> tradingMode: resolveTradingMode(tradingMode),

`services/xstockstrat-trading/internal/config/config.go:145`
> // trading_mode is deprecated and ignored by the config server; paper/live derives from

`services/xstockstrat-ledger/src/services/configWatcher.ts:50`
> tradingMode: TradingMode.TRADING_MODE_UNSPECIFIED,

`services/xstockstrat-marketdata/cmd/server/main.go:100`
> Paper:            cfg.TradingMode == "paper",

`services/xstockstrat-marketdata/internal/alpaca/client.go:49`
> Paper            bool

`services/xstockstrat-trading/internal/service/trading.go:2515` (live fallback)
> return s.cfgW.GetBool("trading.broker.paper", s.cfg.TradingMode == "paper")

`services/xstockstrat-ledger/CLAUDE.md:117` (same line in analysis:590, identity:90, indicators:206, ingest:175, notify:113, portfolio:170)
> TRADING_MODE=paper                     # paper | live

## Root cause hypothesis
Feature 147 deprecated the proto fields server-side but left client resolvers, the marketdata
Paper plumbing and per-service doc env blocks in place.

## Confidence
high
