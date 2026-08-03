# Feature: watchlist-live-quotes

**Lifecycle Status**: `idea`
**Development Branch**: `feature/watchlist-live-quotes`
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | — → `idea` | /sdd-story (098) | Backlog follow-up split from `098-screener-watchlist-fidelity`: the live-quote UI elements (LAST price, intraday CHG %, Quotes tab) require a streaming quote feed the platform does not yet expose. Parked at `idea` — not scheduled. |

---

## Artifacts

- [Product Spec](product-spec.md) — backlog scope sketch (not yet reviewed)
- [Implementation Spec](implementation-spec.md) — _not yet generated_
- [Context Log](context.md) — _not yet generated_

---

## Summary

Add live-quote presentation to the Watchlists page — a LAST price column, an intraday CHG % column, and
a "Quotes" tab — once the platform exposes a streaming/realtime quote feed. Split out of feature 098
(`screener-watchlist-fidelity`), which delivered every **derivable** fidelity fix and explicitly
deferred these livestream-dependent elements here (C-14 named follow-up).

## Next Action

Not scheduled. Prerequisite: a realtime quote feed (streaming last/CHG) must exist as a backend
capability first — that backend feature is a blocker and does not exist today. When prioritized, run
`/sdd-story watchlist-live-quotes` to flesh out this spec, then the normal SDD pipeline.
