# Context: symbol-page-section-nav

**Feature**: `docs/roadmap/features/139-symbol-page-section-nav/feature.md`
**Product Spec**: `docs/roadmap/features/139-symbol-page-section-nav/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/139-symbol-page-section-nav/implementation-spec.md`

---

## Session 2026-08-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from the user story: group the
  unified Symbol page's (feature 125) many stacked sections into a same-page navigation pattern.
- Consumer surface (C-14): **UI `/trader`** — reorganizes the existing `/trader/positions/[symbol]`
  page; no new route/nav entry (C-10 already satisfied by feature 096/125).
- No proto / config / DB changes — UI-only, single service (`xstockstrat-ui`).
- **Merge-order**: depends on feature 125 (`unified-symbol-page`, PR #958) landing first — it
  reorganizes the exact page 125 builds; must be sequenced after 125 in
  `docs/roadmap/features/merge-order.md`.
- **Pattern deliberately left open** (tabs vs. sticky anchor-nav vs. accordion) — to be debated at
  `/sdd-design`, since it drives the fetch-lifecycle (FR-7), deep-linking (FR-5), and mobile (FR-4)
  trade-offs.
- **Ledger trap surfaced** (`fails.md` 2026-08-09 `shadcn-migration-high-confidence`): shadcn
  primitives with built-in implicit roles/labels collide with `getByRole`/`getByLabel` e2e locators —
  directly relevant if `Tabs` (role="tab"/"tablist") is chosen. Recorded in product-spec Open Questions.
