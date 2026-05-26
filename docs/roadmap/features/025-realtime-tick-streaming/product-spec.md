# Product Spec: realtime-tick-streaming

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Upgrade the trader UI chart panel (feature 014) from polling `GetBars` on a configurable interval to a persistent WebSocket or Server-Sent Events stream that pushes every market tick as it arrives from Alpaca, enabling sub-second price updates in the UI.

## Why It Seems Valuable

- The chart panel currently polls on an interval; "live" ticks feel like an obvious quality upgrade.
- WebSocket streaming is a standard pattern in trading UIs.
- The marketdata service already ingests Alpaca feed data — exposing it as a stream appears straightforward.

## Why It Is Not Worth Building

**1. The platform is strategy-driven, not human-execution-driven.**
Trading decisions are made in the analysis and indicators services based on aggregated signals, not by a human watching tick-level candles. The current 30-second poll interval is fully adequate for monitoring purposes — there is no action a user takes based on a 200ms price update that they cannot take on a 30-second update.

**2. Engineering cost is disproportionate.**
A correct implementation requires:
- New streaming RPCs in the marketdata proto (`StreamBars` or `StreamTicks`)
- `buf gen` + stub propagation across Go, Python, TypeScript
- WebSocket or SSE infrastructure in the Next.js trader frontend
- Backpressure handling (Alpaca sends ticks faster than the UI can render)
- Reconnect and re-subscription logic with gap detection
- Memory pressure management for an always-open connection per browser tab
- CI coverage for streaming paths

This is a full multi-week feature for a visual improvement with zero decision value.

**3. It solves a problem this platform does not have.**
HFT and manual day-trading UIs need tick streams. xstockstrat is a signal-aggregation and automated strategy platform where the human role is oversight and configuration, not real-time execution. Tick latency in the UI is irrelevant.

**4. Alpaca feed constraints.**
The Alpaca paper trading WebSocket feed has rate limits and connection constraints that complicate a multi-tab or multi-user scenario. Managing feed multiplexing inside the marketdata service adds operational complexity for no trading benefit.

## Conditions Under Which This Should Be Reconsidered

- The platform pivots to support active manual day trading alongside automated strategies, where a human is making execution decisions based on live price action.
- Multi-trader scenarios require live position monitoring across participants.
- Even then: implement as a dedicated streaming service or use a third-party charting library with built-in Alpaca WebSocket support rather than building custom streaming infrastructure.

## Affected Services

_Not applicable — demoted before any design._
