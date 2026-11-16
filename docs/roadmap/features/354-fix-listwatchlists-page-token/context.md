# Context Log: fix-listwatchlists-page-token

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-16 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md` (Issues disabled): ListWatchlists next_page_token skips the row at every page boundary
- Severity: SEV-2 (environment dev) — not config-only
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1, @AC-2), context.md
- Affected services (from report): xstockstrat-portfolio (fix); callers xstockstrat-analysis, xstockstrat-agent (read-only behavior-change check)
- Root cause hypothesis: token taken from look-ahead row `wls[pageSize]` instead of last returned row `wls[pageSize-1]` in `WatchlistRepo.ListByUser`
- Recommended design depth: quick → `/sdd-design fix-listwatchlists-page-token quick` (rationale: SEV-2 per design-depth-rubric Bugs; single service, no proto/migration/config)
- Development branch: `ccr-fix-listwatchlists-page-token` (harness ccr-* off main-dev; user approved Track C, option 1)
- Scope fences: do not touch twin report `...-listpositions-...` (other session) or `docs/roadmap/features/351-*` (mid-design elsewhere)
- Required proof (from session brief): dbtest real-backend full traversal at page_size 1 via a named-seed variant of `seedWatchlist` (signature unchanged; helper sets lock_timeout=500ms) + a unit-level test; red-before-green
