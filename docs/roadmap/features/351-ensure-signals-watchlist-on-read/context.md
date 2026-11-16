# Context: ensure-signals-watchlist-on-read

**Feature**: `docs/roadmap/features/351-ensure-signals-watchlist-on-read/feature.md`
**Product Spec**: `docs/roadmap/features/351-ensure-signals-watchlist-on-read/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/351-ensure-signals-watchlist-on-read/implementation-spec.md`

---

## Session 2026-11-16 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: operator report "system watchlist 'Signals' missing on Homelab staging; migrator didn't create it". Investigation: migration `011` adds column/indexes only; `EnsureSignalWatchlist` runs only from agent `ingest_signal(direction="watchlist")` (`app/tools.py:741-754`); staging `list_watchlists` shows only "DB workload test" and "Test"; Grafana Loki (30 d) has no "Watchlist auto-add failed" or portfolio EnsureSignalWatchlist errors.
- Operator decisions (AskUserQuestion): mechanism = lazy ensure on `ListWatchlists`; process = SDD story + design quick (not bug-triage). Rejected: cross-schema migration (violates single-schema rule), identity→portfolio ensure-on-create + backfill job.
- Assumptions recorded in the spec's Open Questions (fail-open, no max_per_user counting, first-page-only).
