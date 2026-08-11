# Context: consolidate-watchlist-signal

**Feature**: `docs/roadmap/features/127-consolidate-watchlist-signal/feature.md`
**Product Spec**: `docs/roadmap/features/127-consolidate-watchlist-signal/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/127-consolidate-watchlist-signal/implementation-spec.md`

---

## Session 2026-08-11 — sdd-story

- User asked where `ingest_signal` signals tagged `direction="watchlist"` go; research (via
  `codebase-discovery` subagent) found they land in `xstockstrat-ingest`'s `newsletter_signals`
  table as an inert label, non-actionable in `xstockstrat-analysis` scoring, with **no** code link
  to the platform's real `xstockstrat-portfolio` `Watchlist` mechanism (feature 058) — two concepts
  sharing a name only.
- User confirmed they should be consolidated ("otherwise that data goes useless") and, via
  `AskUserQuestion`, chose **auto-add on ingest**: when `ingest_signal` is called with
  `direction="watchlist"`, automatically add the symbol to the relevant portfolio watchlist.
- Created feature.md (status: draft), product-spec.md, context.md from the user story.
- Flagged as an unresolved Open Question (not decided here, per CLAUDE.md "don't assume — surface
  the fork"): `xstockstrat-portfolio` watchlists are strictly user-owned via the propagated
  `x-user-id` header, but `ingest_signal` derives no caller identity today and is called by both
  interactive and fully-automated flows (e.g. `form4-enhanced-ingest` skill) — whose watchlist an
  auto-added symbol belongs to is the central fork `/sdd-design` must resolve before implementation.
