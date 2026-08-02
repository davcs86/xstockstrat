# Product Spec: watchlist-live-quotes (BACKLOG — idea)

**Created**: 2026-08-02
**Status**: backlog sketch — not reviewed, not scheduled.

---

## Problem Statement

The feature-083 Watchlists design shows, per symbol, a **LAST** price and an intraday **CHG %**, plus a
**Quotes** tab alongside the Readiness tab. These require a streaming/realtime last-trade + change feed.
The platform's `xstockstrat-marketdata` service stores OHLCV **bars** (historical/close), not a live
last-trade/quote stream, and no service currently pushes realtime quotes to the UI. Feature 097 fixed
every fidelity gap that could be derived from existing RPCs and deferred these here.

## User Story

As a trader, I want each watchlist symbol's live price and today's change alongside its signal
readiness, and a Quotes view, so that I can weigh "how ready" against "what the tape is doing" in one
place.

## Blocking Prerequisite

**A realtime quote capability must exist first.** This is not a UI-only feature: it needs a backend
source of live last-price/change (e.g. a marketdata streaming quote RPC or a snapshot-quote RPC fed by
the broker/Alpaca feed) that the `/insights` BFF can call. Options to evaluate when scheduled:
- A `marketdata` snapshot-quote RPC (last trade + prior close → CHG %) polled by the UI, or
- A streaming quote subscription (gRPC server-stream) surfaced through the BFF.

Until that backend exists, this feature is blocked.

## Out of Scope (of the derivable feature 097)

Everything here was deliberately excluded from 097 to keep 097 derivable-only. See
`docs/roadmap/features/097-screener-watchlist-fidelity/product-spec.md` § Out of Scope and its
`context.md` C-14 override note.

## Open Questions

- [ ] Snapshot-poll vs. server-stream for quote delivery, and the connection-budget impact.
- [ ] Whether CHG % is vs. prior close (derivable once a live last exists) or vs. open.
- [ ] Whether the Quotes tab reuses the readiness master-detail shell from 097 or is a separate view.
