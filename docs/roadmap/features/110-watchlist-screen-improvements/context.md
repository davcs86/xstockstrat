# Context: watchlist-screen-improvements

**Feature**: `docs/roadmap/features/110-watchlist-screen-improvements/feature.md`
**Product Spec**: `docs/roadmap/features/110-watchlist-screen-improvements/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/110-watchlist-screen-improvements/implementation-spec.md`

---

## Session 2026-08-07T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story (screenshot of
  `/insights/watchlists` + three asks: move edit/delete actions into the readiness table, pick a
  strategy inline when adding a symbol, allow renaming a watchlist).
- Read `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx`,
  `src/components/insights/WatchlistDetail.tsx`, `src/components/insights/WatchlistReadiness.tsx`,
  `src/hooks/useWatchlists.ts` — confirmed `useUpdateWatchlist` and `useAddWatchlistSymbols` already
  support `bindings`, so this is scoped as UI-composition only (no proto/BFF/config/DB change).
- Checked `docs/roadmap/ledger/fails.md` / `insights.md` for watchlist traps: the FR-6/"fails-080"
  full-bindings-replace invariant (feature 097) and the "no-fabricated-binding" per-row caption
  lesson (098, pre-097, since superseded by per-symbol bindings) — both already respected by the
  FR-2/FR-4 requirement that a rebind/rename sends the full bindings set, never a partial one.

## Session 2026-08-07T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: (1) acceptance criteria are qualitative rather than quantitative — tighten into
  concrete e2e assertions at /sdd-spec time; (2) FR-2's "fails-080" label is a code-comment
  convention (`WatchlistDetail.tsx`/`useWatchlists.ts`), not a numbered `fails.md` ledger entry —
  harmless but could mislead a reviewer looking for that entry by number.
- Overlap findings: none (CLEAN). No active concurrent feature touches
  `/insights/watchlists`; note for awareness only — 099-watchlist-live-quotes (status `idea`) is a
  backlog follow-up targeting the same page (adds a LAST-price/CHG% column), not yet active.
