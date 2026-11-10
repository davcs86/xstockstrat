# Product Spec: fix-ui-gating-gaps

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-ui-namespace-editor-non-admin-edit-defect.md, docs/reports/2026-10-19-ui-watchlist-inqueue-first-page-only-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Config-UI namespace editor shows Edit/Save to non-admins

Report: [docs/reports/2026-10-19-ui-namespace-editor-non-admin-edit-defect.md](../../../reports/2026-10-19-ui-namespace-editor-non-admin-edit-defect.md)

- **Observed:** `SetConfig` is admin-gated at the BFF (`requireAdminScope`), but `NamespaceEditor` renders the
  per-row Edit action for every user and never consults `useIsAdmin()`; a viewer/trader learns only on
  submit via a raw "Save error: Admin scope required". Not an authorization hole.
- **Expected:** non-admins see no Edit affordance (or an "Admin only" notice), matching sibling pages
  `config-ui/sources` and `config-ui/templates`.

### Watchlist "in queue" flag only sees the first loaded opportunity page

Report: [docs/reports/2026-10-19-ui-watchlist-inqueue-first-page-only-defect.md](../../../reports/2026-10-19-ui-watchlist-inqueue-first-page-only-defect.md)

- **Observed:** `WatchlistDetail` builds `inQueue` from `useOpportunities()` with no symbol filter and never
  pages; only loaded page(s) (page 1 ≤50 rows) are scanned, so a queued symbol ranked below them renders as
  not-in-queue in `WatchlistReadiness`.
- **Expected:** in-queue status reflects actual queue membership regardless of rank (e.g. filter by the
  watchlist's symbols server-side, or page through).

## Reproduction Steps

1. Namespace editor: log in as a non-admin (viewer); open `/config-ui/<namespace>`, a row's Actions menu →
   Edit; enter value + reason, Save → "Save error: Admin scope required".
2. Watchlist: seed a user's opportunity queue with >50 rows; add to a watchlist a symbol ranked below row 50;
   open the watchlist detail — it shows not-in-queue though `ListOpportunities` with `symbol=<it>` returns a row.

## Root Cause Hypothesis

- Feature 074 added the server-side admin gate without a UI gate; the shadcn migration (119/120) moved the
  logic into `NamespaceEditor.tsx` unchanged; `useIsAdmin` is never imported there.
- The feature-215 per-symbol filter fix was applied to the Signal-detail page only; the watchlist consumer
  still derives membership from the shared rank-paged cache.

Spot-check at 0fecb24d: `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx:164` (Edit
item, no `useIsAdmin`); `src/lib/configUiBff.ts:39` (`requireAdminScope`);
`src/components/insights/WatchlistDetail.tsx:74` (`useOpportunities()` unfiltered). `ListOpportunitiesRequest.symbol`
(`packages/proto/analysis/v1/analysis.proto`, field 6) is a single exact symbol.

## Affected Services

- xstockstrat-ui (config-ui segment, insights watchlist)

## Fix Scope

- [x] Proto changes anticipated: **no** — the existing single-symbol `ListOpportunities` filter or paging covers the report's suggested fixes.
- [x] Database migrations anticipated: **no** — UI only.
- [x] Config key changes anticipated: **no** — UI only.

## Open Questions

1. Namespace editor for non-admins: hide the Edit affordance, or show an "Admin only" notice like the sibling
   pages? (Report allows either.)
2. Watchlist in-queue: per-symbol filtered `ListOpportunities` calls, paging the full queue, or a multi-symbol
   server filter? The last needs a proto change (the filter is single-symbol) and would escalate design depth to full.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- The Signal-detail page per-symbol filter (fixed by feature 215).
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
