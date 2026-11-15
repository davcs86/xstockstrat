# Context Log: fix-symbol-page-alerts-ui

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md`: Symbol page and alerts drawer UI defects
- Source: operator report from staging (homelab) on 2026-11-15, with screenshots; root causes from read-only recon the same day
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): `xstockstrat-ui`
- Root cause hypothesis: see product-spec.md § Root Cause Hypothesis
- Recommended design depth: quick → `/sdd-design fix-symbol-page-alerts-ui quick` (rationale: SEV-3, single service, no proto/migration/config, clear root causes — rubric says skip, raised to quick because the operator asked for a full redesign of the Fundamentals card (a layout fork to debate once))
- Development branch: feature/fix-symbol-page-alerts-ui
- Operator decisions (2026-11-15): Fundamentals card gets a **full redesign** consistent with the rest of the symbol page (abbreviation acceptable, not mandated); strategy-less chip label defaults to the **row source**; drawer shows **unread only** (stored + live) with mark-read and a refreshing badge.
- Related, tracked separately: 342-chart-series-palette, 343-backtest-inline-backfill, 344-alert-detail-page, 340-fix-fundamentals-roe-unit, 341-fix-indicator-pane-warmup.

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (6; none blocking):
  - C-15, FR-1 bound not exercised (@AC-1 used a 10-integer-digit market cap) — **resolved**: @AC-1 is now a Scenario Outline covering `6726553623.93` (the reported value) and `3450000000000.00` (13 integer digits).
  - C-15, FR-5 "each alert once" had no scenario — **resolved**: added @AC-9 (an alert both streamed and stored appears once; badge `1`).
  - C-15, FR-8 never compared the Notifications page unread count with the badge — **resolved**: @AC-3 now also asserts the Notifications page shows 1 unread alert.
  - C-15, FR-9 scenarios cover only the Notifications page — **resolved**: FR-9 now states all three pages render the one shared component, so the scenarios exercise it on the Push notifications card only.
  - Code-ground drift, Root Cause line refs — **resolved**: re-grepped `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`; `:1089` is the `Market cap` `fmtUsd` value (not a grid), `:1120` the Fundamentals grid, `:842,901` the other stat grids, `:444` the chip label. Spec wording clarified; recon should still re-verify line numbers.
  - C-14, BFF route registration for `MarkAlertRead` is conditional ("if the drawer's segment does not already expose it") — **open, for /sdd-design**: recon must settle whether a route registration is needed.
- Overlap findings: WARN — one soft, rebase-only file collision with peer `344-alert-detail-page` (status draft): both edit the header Alerts drawer rows in `src/components/trader/AlertStream.tsx` (339 FR-5/FR-6 unread-only list + mark-read vs 344 FR-4 drawer-row links; 344 product-spec.md:79 already says "order 339 first or record it in merge-order.md"). No config, proto or migration collisions; peers 340–343 have no concrete file overlap. Land 339 before 344.
- Recommended design depth: quick (SEV-3, single service, no proto/migration/config; one layout fork — the Fundamentals card redesign — to debate once)

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Fundamentals card gets a full redesign consistent with the rest of the symbol page; abbreviating large values is acceptable but not mandated; the page's other stat grids get the same overflow guard.
- A strategy-less opportunity chip is labelled from the row's source by default, never the ticker.
- The Alerts drawer shows unread alerts only (stored plus live), offers mark-read, and the badge refreshes on mark-read and on a streamed alert.
- The shared switch must render checked when checked wherever it is used.
