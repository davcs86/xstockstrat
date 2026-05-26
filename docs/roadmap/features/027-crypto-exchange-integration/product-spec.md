# Product Spec: crypto-exchange-integration

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Add Coinbase Advanced Trade and/or Binance as broker adapters alongside IBKR/Alpaca, with a new `BrokerType` enum value, exchange-specific order execution in the trading service, and crypto OHLCV ingestion in the marketdata service. The signal pipeline and analysis engine would then be able to route signals to crypto positions as well as equity positions.

## Why It Seems Valuable

- Crypto markets are liquid and highly volatile — a strategy engine with good signal extraction could find edges.
- The `BrokerType` enum in the proto already suggests extensibility for new brokers.
- Adding crypto diversifies the asset universe and potential return sources.

## Why It Is Not Worth Building

**1. Crypto and equity markets have incompatible microstructure — this is a fork, not an extension.**

| Dimension | Equities (current) | Crypto |
|---|---|---|
| Trading hours | 9:30am–4pm ET + pre/post | 24/7/365 |
| Session concept | Pre-market, regular, after-hours | None |
| Liquidity model | Centralized (NYSE, NASDAQ) | Fragmented across 50+ CEXes |
| Volume integrity | SEC-regulated reporting | Wash trading is endemic; volume is unreliable |
| Settlement | T+1 (US equities) | Varies by chain/CEX; can be instant or delayed |
| Regulatory | SEC, FINRA | Varies by jurisdiction; rapidly changing |

Every service that handles session logic (marketdata, trading, chart panel, pre/post market toggle feature 017) assumes the equity model. Crypto is not a configuration change — it is a different domain.

**2. The signal sources are equity-focused.**
The signal source registry (feature 008) is built around newsletter emails and financial website scrapers covering publicly traded companies. Crypto signals require entirely different extraction targets: on-chain metrics (Glassnode, Dune Analytics), social sentiment (Twitter/X volume, Discord activity), whale wallet tracking, and funding rates. None of these exist in the current agent or ingest pipeline.

**3. Crypto exchange API complexity is high.**
Each major CEX has different API authentication (Coinbase Advanced uses OAuth + HMAC, Binance uses HMAC with timestamp nonce), different order types, different WebSocket feed schemas, and different rate limit models. Implementing a correct, production-safe broker adapter for even one CEX is a multi-week project.

**4. Regulatory exposure increases.**
Crypto trading on behalf of users (even self-directed) is subject to evolving FinCEN, CFTC, and state-level money transmission rules in the US. Coinbase and Binance have both faced regulatory actions. Integrating their APIs creates association risk and may trigger KYC/AML obligations depending on how the platform is structured.

**5. It dilutes focus before the equity strategy is validated.**
The autonomous equity signal pipeline is not yet proven in live conditions. Adding a second asset class doubles the operational surface area before demonstrating that the first one works.

## Conditions Under Which This Should Be Reconsidered

- The equity strategy has operated profitably in live conditions for 6+ months.
- Crypto-specific signal sources (on-chain data, social sentiment) have been identified and validated as extractable by the agent.
- A separate `xstockstrat-crypto` platform is built with crypto-native microstructure assumptions, rather than retrofitting the equity platform.
- Regulatory counsel has confirmed that operating in crypto markets under the intended business model is compliant in target jurisdictions.

## Affected Services

_Not applicable — demoted before any design._
