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

## Session 2026-11-16 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (2 review rounds).
- Round 1: FAIL — criterion 9 (4 unresolved Open Questions). Warnings: analysis callers of `ListWatchlists` unlisted, page-1 placement semantics, "(read-only)" doc wording, UI assumption. Fixed: FR-6/FR-7, AC-7..AC-9, Affected Services lists analysis + agent, Open Questions resolved with evidence.
- Round 2: PASS WITH WARNINGS. Fixed: second analysis caller `servicer.py` `_compute_opportunities` (~6008) added; FR-7/AC-9 extended to the `list_watchlists` tool docstring (`tools.py:2154`); Out of Scope reworded (FR-7 is docstring/runbook only). Left as-is (optional): AC-8 carries `@FR-1` for a rejection path.
- Overlap findings (WARN, rebase-only, no merge-order row): `portfolio_service.go` shared with specs 311, 312, 315, 317, 323, 326. Design must check: 326 (CreateWatchlist duplicate-name mapping, same watchlist domain), 312 (read-path identity — must not change the `EnsureSystemManaged` caller id), 323 (must not delete `EnsureSystemManaged`/watchlist repo helpers).
- **Carried to the design gate (author assumptions, NOT operator decisions):** (1) system list not counted against `watchlist.max_per_user`; (2) ensure failure is fail-open (WARN + list returned).
- Recommended design depth: quick (single service, no proto/DB/config change; overlaps rebase-level only).

## Session 2026-11-16 — sdd-design (Phase 0)

- Phase 0 Recon: wrote recon.md (services: portfolio, agent docs-only, analysis callers, ui consumer; key reuse: `EnsureSystemManaged` as used by `EnsureSignalWatchlist`, `refuseUnservable` fail-open WARN pattern, `fakeWatchlistStore`/`newSvc` test scaffolding). Business rules: 1 EXTEND (agent 148 @AC-1), 0 CHANGE, rest PRESERVE.
- Post-Recon escalation (rubric: ≥2 services incl. named surfaces + overlap findings): **operator chose Upgrade to full** (was quick). Design runs as a full debate (min 2, cap 5 rounds).
- **Operator decision (UI handling): No UI change.** The product spec's "no UI code change" stands. Operator-accepted consequences, recorded so they are not rediscovered as defects: (1) `/insights/watchlists` auto-selects Signals for a user with no other lists; (2) the "No watchlists yet" empty state is unreachable in production; (3) the screener "Add top N to…" picker lists Signals and can write MANUAL entries into the system list (provenance `source` stays first-writer-wins per feature 127).
- Spec tension carried into the debate: FR-1 "returned in the result" vs FR-6 (uuid-order page placement) — presence on the first-page response must be deterministic; cost of the ensure on a polled read path (3+ round trips) is a design question.
