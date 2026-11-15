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
