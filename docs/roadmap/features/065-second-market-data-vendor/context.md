# Context Log — 065-second-market-data-vendor

Append-only session log. Read before touching any file in this feature directory.

---

## 2026-07-20 — Idea captured (signal-source planning session)

- Origin: a signal-source ranking exercise recommended seven candidate feeds for the
  platform. The "market data API vendor" candidate was found to overlap almost entirely
  with the existing Alpaca integration in `xstockstrat-marketdata` (IEX feed, free plan)
  plus FMP fundamentals (feature 059), so instead of being registered as a signal source
  it was parked here as a backlog item.
- Scope sketch in `feature.md`: SIP feed upgrade vs. second vendor (e.g. Polygon.io),
  integration via `source.DataSourceClient` + `source.Registry`, config conventions from
  feature 059.
- Related but distinct: the same session registered SEC EDGAR (8-K, Form 4) and PR
  Newswire as `mediated_simple_website` signal sources through the ingest registry, and
  fixed two registration blockers in `xstockstrat-ingest` (JSONB parameter serialization
  in `upsert_source`; missing `mediated_*` values in the `signal_sources.source_type`
  CHECK — migration 007).
- Status: `idea`. No product spec yet.
