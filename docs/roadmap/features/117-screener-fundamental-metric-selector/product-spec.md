# Product Spec: screener-fundamental-metric-selector

**Created**: 2026-08-07

---

## Problem Statement

On the Screener page (`/insights/screener`), a criterion with kind "Fundamental" requires the user
to hand-type a metric name into a free-text field (pre-seeded with `pe_ratio`). The backend
(`xstockstrat-analysis`) already restricts fundamental metric names to a fixed set of 11 known
fields and only rejects an unrecognized name *after* the scan has run against fetched fundamentals
— so a typo (e.g. `pe_ration`) silently reaches the server and fails late instead of being
prevented at entry time. The sibling "Technical indicator" kind on the same page already avoids
this problem: its metric field is a real `<select>` backed by a static frontend catalog.

## User Story

As an analyst using the Screener, I want the Fundamental criterion's metric field to be a dropdown
of valid metric names (not free text), so that I can't submit a scan with a mistyped or unsupported
fundamental field and lose the run to a late server-side rejection.

## Functional Requirements

FR-1. In `services/xstockstrat-ui/src/app/insights/screener/page.tsx`, when a criterion row's
`kind` is `ScreenKind.FUNDAMENTAL`, the metric-name control must be a dropdown (Radix `Select`,
matching the existing `select.tsx` primitive already used elsewhere on this page for the watchlist
target picker) rather than the current free-text `<Input>`.

FR-2. The dropdown's options are a new frontend catalog of fundamental metric names, added to
`services/xstockstrat-ui/src/lib/strategyCatalog.ts` alongside `BUILTIN_INDICATORS`, mirroring the
backend's `_FUNDAMENTAL_FIELDS` set in `services/xstockstrat-analysis/app/services/screener.py`:
`market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`, `eps`, `beta`, `roe`, `debt_to_equity`,
`price`, `year_high`, `year_low`. Each option gets a short human-readable label (e.g.
`pe_ratio` → "P/E ratio"), same convention as `BUILTIN_INDICATORS`.

FR-3. Existing criterion rows created before this change (or the page's own default seeded row,
`metricName: 'pe_ratio'`) must still render correctly — `pe_ratio` is a valid option in the new
catalog, so the default continues to work unchanged.

FR-4. Switching a criterion row's `kind` away from `FUNDAMENTAL` and back must not leave a stale,
now-invalid `metricName` selected; the row should fall back to the catalog's first option (or the
existing seeded default) the same way the Technical indicator field already resets/initializes today.

FR-5. No backend or proto change: `ScreenCriterion.metric_name` stays a plain `string` wire field.
The frontend catalog only narrows what the *UI* offers; it does not change server-side validation
(`_validate_fundamental_metrics` in `screener.py` keeps enforcing the same 11-field set it enforces
today).

## Out of Scope

- Extending the catalog to cover `Fundamentals.extra_metrics` (FMP's open-ended per-symbol extra
  fields) — that set isn't statically enumerable and isn't exposed by any RPC today.
- Adding the two missing `ScreenKind` values (`SCREEN_KIND_TECHNICAL_FORMULA`,
  `SCREEN_KIND_SIGNAL`) to the `KIND_OPTIONS` dropdown — unrelated pre-existing gap, not part of
  this story.
- Converting the page's other native `<select>` elements (kind, comparator) to Radix `Select` —
  out of scope; only the fundamental metric field is being converted in this pass.
- Any backend `ListMetrics`-style RPC to serve the catalog dynamically — the frontend catalog is a
  static mirror of the backend's fixed `_FUNDAMENTAL_FIELDS` set, same pattern already accepted for
  `BUILTIN_INDICATORS` (see `strategyCatalog.ts` "keep in sync" doc comment).

## Affected Services

- `xstockstrat-ui` — Screener page criterion-row UI and the shared strategy/metric catalog file.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` segment `/insights` (Screener page, existing route
  `/insights/screener`): the Fundamental criterion's metric field changes from a free-text input to
  a select dropdown. No new route; this is a control-level change on an already-reachable page.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/screener-fundamental-metric-selector` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change)

## Acceptance Criteria

1. Adding a criterion with kind "Fundamental" shows a dropdown of the 11 known fundamental metric
   names (with readable labels) instead of a free-text box.
2. It is no longer possible to type an arbitrary/misspelled string into the Fundamental metric
   field — only catalog values are selectable.
3. The default/seeded criterion row still shows `pe_ratio` ("P/E ratio") selected.
4. Running a scan with a Fundamental criterion still sends the same `metricName` string wire value
   the backend already accepts (e.g. `"pe_ratio"`) — `ScreenCriterion.metric_name` behavior is
   unchanged.
5. The Technical indicator field's existing dropdown behavior is unaffected.

## Open Questions

- None — the metric universe, labels convention, and target component are all fully determined by
  existing code (`_FUNDAMENTAL_FIELDS`, `BUILTIN_INDICATORS`, `select.tsx`).
