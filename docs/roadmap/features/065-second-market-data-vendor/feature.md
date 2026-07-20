# Feature: second-market-data-vendor

**Lifecycle Status**: `idea`
**Development Branch**: _none yet — assigned when spec work begins_
**Created**: 2026-07-20
**Last Updated**: 2026-07-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-20 | `idea` | signal-source planning session | Captured from signal-source ranking discussion; run `/sdd-story second-market-data-vendor` to draft the product spec |

---

## Artifacts

- [Context Log](context.md) — decision log

---

## Summary

Add a second market data vendor alongside Alpaca — either upgrading the existing Alpaca
subscription to the consolidated SIP feed, or registering an additional provider (e.g.
Polygon.io) in the marketdata `source.Registry` — to improve quote quality, add datasets
Alpaca lacks, and provide cross-validation of stored OHLCV.

## Motivation

The platform's current Alpaca configuration runs the free plan's `iex` feed: single-exchange
quotes (~2–3% of US volume), 15-minute delayed, one WebSocket connection. Adequate for
15m-bar backtesting; weaker for live P&L accuracy and fill-price-sensitive strategies.
A second vendor (or SIP upgrade) would add, in rough priority order:

1. **Feed quality** — consolidated SIP/NBBO quotes across all exchanges in real time.
   The cheapest path is a config change (`marketdata.alpaca.feed=sip`) plus an Alpaca
   data-plan upgrade, with no new code.
2. **Adjacent datasets** — detailed corporate-action feeds, ticker-level news, options
   chains (relevant to feature 034), deeper reference data. Fundamentals are already
   covered by FMP (feature 059).
3. **Redundancy/validation** — cross-check `marketdata.ohlcv` for gaps and bad prints.

## Integration Notes (for future spec work)

- Bars belong in `xstockstrat-marketdata` behind the `source.DataSourceClient` interface,
  registered in the `source.Registry` (built for exactly this — see
  `docs/runbooks/add-data-source.md` Part 1). Not the ingest signal path.
- Follow the `marketdata.<source>.enabled` config convention established by FMP
  (feature 059); provider API keys via `secret.marketdata.<source>.api_key`.
- Decision to make in the product spec: SIP upgrade of the existing Alpaca integration
  vs. a genuinely separate vendor. The former is far cheaper; the latter adds datasets
  and redundancy.

## Next Action

Run `/sdd-story second-market-data-vendor` when this is prioritized.
