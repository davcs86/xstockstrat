# Context: screener-data-readiness-polling

**Feature**: `docs/roadmap/features/117-screener-data-readiness-polling/feature.md`
**Product Spec**: `docs/roadmap/features/117-screener-data-readiness-polling/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/117-screener-data-readiness-polling/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Grounding: this feature is a direct follow-on to the same-day bug fix in PR #902
  (`docs/reports/2026-08-08-screener-fundamental-criteria-silently-inert.md`), which made
  `INSUFFICIENT_DATA` honest and added the "Fundamentals pending" vs "Insufficient data" badge
  distinction the user is now asking to make live/self-updating via polling.
- User explicitly confirmed scope: "Include indicators and fundamentals in scope" — both
  `SCREEN_KIND_FUNDAMENTAL` (no `gap`) and the technical kinds
  (`SCREEN_KIND_TECHNICAL_INDICATOR`/`SCREEN_KIND_TECHNICAL_FORMULA`, has a `gap`) are in scope,
  not just fundamentals.
- Key finding during story-writing that shapes the default design lean: both underlying data
  sources are already read-through caches that self-heal on a later request — marketdata
  `GetFundamentalsMulti` (FMP) and `GetBars` (Alpaca, "on a first-page DB miss falls back to a
  live Alpaca historical fetch... persists the bars, and re-reads" per
  `services/xstockstrat-marketdata/CLAUDE.md`) — so a client-side "just re-issue the same scan"
  design is plausible without new backend state. Flagged as the primary Open Question for
  `/sdd-design` to pressure-test against the FMP daily-quota/Alpaca-rate-limit cost of naive
  full-rescan polling (FR-5, Open Questions).
- User explicitly declined full "notify when populated" (persisted scan + push notification via
  `xstockstrat-notify`) in the prior turn — that was scoped out in the PR #902 report as needing
  its own `/sdd-story`. This feature is the client-visible-polling middle ground the user then
  picked ("badges and polling mechanism").
- Ledger traps surfaced and carried into product-spec Open Questions: `fix-mcp-screener-correctness`
  (coverage_gaps must be computed before truncation — relevant if design touches `screener.py`
  diagnostics again) and `durable-observable-backfills` (never assume a migration NNN — `ls` the
  directory first, only relevant if design overturns the no-DB-changes default).
- Consumer surface (C-14): UI only (`/insights/screener`). Agent surface not touched — the
  `screen_symbols` MCP tool already exposes the same status/gap fields a caller could poll itself.

Next: review product-spec.md, then run `/sdd-review screener-data-readiness-polling product-spec`.
