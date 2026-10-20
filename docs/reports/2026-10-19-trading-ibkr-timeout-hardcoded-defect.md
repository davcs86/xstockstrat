# Defect: IBKR broker client ignores trading.broker.timeout_ms (hardcoded 10s)

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: config-value-ignored
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no
**Source**: `services/xstockstrat-trading/docs/context-constitution-findings.md` § Latent bugs, row 1

## Observed
The IBKR client builds its `http.Client` with a hardcoded 10s timeout. `IBKRConfig` has no timeout
field, so `instantiateBrokerLocked` cannot pass `trading.broker.timeout_ms` to IBKR the way it does
for Alpaca. Every IBKR call (`SubmitOrder`, `GetOrder`, `ListOrders`, and so on) waits up to 10s no
matter what is configured. A maintainer has confirmed this was an oversight.

## Expected
IBKR HTTP calls honour `trading.broker.timeout_ms` (default 5000), which CLAUDE.md documents as the
broker HTTP timeout.

## Reproduction
1. Set `trading.broker.timeout_ms=2000`.
2. Point an IBKR account's base URL at a black-holed host.
3. Place an order or let the fill poller run. Each IBKR call blocks for about 10s, not 2s.

## Evidence
`services/xstockstrat-trading/internal/broker/ibkr.go:46`
> const IBKRRequestTimeout = 10 * time.Second

`services/xstockstrat-trading/internal/broker/ibkr.go:61`
> httpClient:        &http.Client{Timeout: IBKRRequestTimeout},

`services/xstockstrat-trading/internal/broker/ibkr.go:24-31` (`IBKRConfig` has no `TimeoutMs` field)
> type IBKRConfig struct {

`services/xstockstrat-trading/internal/service/trading.go:3027` (Alpaca only)
> TimeoutMs: int(s.cfgW.GetInt("trading.broker.timeout_ms", 5000)),

## Root cause hypothesis
The timeout was never plumbed through `IBKRConfig`. `IBKRRequestTimeout` is also the floor in
`order_intent.go#staleThreshold`, so a fix must keep that formula consistent.

## Confidence
high
