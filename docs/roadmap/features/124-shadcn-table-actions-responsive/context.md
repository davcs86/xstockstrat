# Context: shadcn-table-actions-responsive

**Feature**: `docs/roadmap/features/124-shadcn-table-actions-responsive/feature.md`
**Product Spec**: `docs/roadmap/features/124-shadcn-table-actions-responsive/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/124-shadcn-table-actions-responsive/implementation-spec.md`

---

## Session 2026-08-09 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from a user story following up
  directly on the just-merged `123-shadcn-migration-custom-composites` (feature 120-123 sequence):
  the user asked whether `Table` and `DropdownMenu` were adopted by the migration series and noted no
  `DropdownMenu` in table Actions columns, then asked to backlog (1) the `DropdownMenu` gap and (2)
  making tables responsive where horizontal scroll is missing.
- **Verified before writing FRs** (session tool calls, not assumed):
  - Repo-wide grep confirmed `src/components/ui/dropdown-menu.tsx` does not exist and is never
    imported anywhere. It was never one of the original 10 primitives feature 119 migrated (button,
    card, input, select, table, sheet, badge, separator, skeleton, combobox) and was never added by
    120–123. `DropdownMenu` is never mentioned in any of the 119–123 SDD artifacts (product-spec/
    design/recon/implementation-spec/context) — confirmed via a repo-wide grep across all five feature
    directories, zero hits.
  - Repo-wide grep for `<table\b` outside `src/components/ui/table.tsx` returned zero matches — every
    table in the app already routes through the shadcn `Table` primitive (feature 121, FR-11, closed
    the last two raw-`<table>` holdouts with a `grep "<table\b" && FAIL` acceptance gate). `Table`
    adoption is complete; FR-2's/FR-4's scope is therefore about the Actions-column affordance and
    horizontal-scroll *correctness*, not about missing the `Table` primitive itself.
  - Read `src/components/ui/table.tsx` directly: the `Table` component already wraps its `<table>` in
    `<div data-slot="table-container" className="relative w-full overflow-x-auto">` — so "some tables
    don't have horizontal scroll" is **not** a missing-wrapper bug (every `Table` usage gets one
    automatically). The real failure mode, per `docs/roadmap/ledger/insights.md`'s 2026-08-08 (feature
    083) entry, is a flex/grid ancestor without `min-w-0` silently defeating the wrapper's
    `overflow-x-auto` and pushing the whole page wide instead — FR-4 is scoped to auditing for that
    class of bug, not re-adding a wrapper that's already there.
  - Grepped every `src/app/**`/`src/components/**` file using `ui/table.tsx` for a multi-button Actions
    column: found 5 (`OrdersTable.tsx`, `authorized-apps/page.tsx` — single action, `config-ui/sources/
    page.tsx`, `config-ui/[namespace]/NamespaceEditor.tsx`, `insights/strategies/page.tsx`) — listed
    with exact current behavior in FR-2. No other table (positions, portfolio, formulas, screener,
    strategies detail's Past Runs, audit log) has a multi-action Actions column today.
  - Read `e2e/mobile-overflow.spec.ts`: an existing 14-route sweep at a 390px phone viewport asserting
    `document.documentElement.scrollWidth - clientWidth <= 1`, added by feature 083 specifically
    because a raw `<table>` overflow bug shipped past a content-only "matches the handoff" review.
    Diffed its `ROUTES` list against every table-bearing route found above — 5 gaps confirmed:
    `/accounts/authorized-apps`, `/insights/formulas`, `/config-ui/audit`,
    `/config-ui/<namespace>` (`NamespaceEditor`), `/trader/positions/<symbol>`.
  - **Ran a throwaway diagnostic** (written, run, and deleted — never committed) reusing
    `mobile-overflow.spec.ts`'s exact 390px-viewport/`scrollWidth` check against those 5 gap routes
    plus `/trader/orders` as a sanity re-check: all 6 reported **0px overflow** against the default
    mock-backend fixture data. This means the responsive gap is a genuine **coverage** gap (no
    assertion protects those routes from a future regression) rather than a currently-observable
    active bug under today's fixtures — the product spec is written honestly to reflect that
    distinction (FR-3 closes the coverage gap; FR-4 is an audit for the min-w-0-class bug under
    wider/more-realistic content, not a "fix N broken pages" claim). This matches the root CLAUDE.md
    norm against fabricating a defect that isn't actually there.
  - Read `docs/runbooks/reviewer-registry.md` — `xstockstrat-ui` service owner is the only applicable
    reviewer role (frontend-only change, no proto/migration/config-key work).
  - Read `docs/roadmap/ledger/fails.md`/`insights.md` for relevant traps: found and cited the
    2026-08-08 (feature 083) "matches the handoff" overflow entry in both files — folded into
    product-spec.md's `## Open Questions` as a named "Known trap" so `/sdd-design` and `/sdd-execute`
    don't substitute an eyeballed check for the automated sweep, per that entry's own stated rule.
- Left two genuine design forks as `## Open Questions` rather than pre-deciding them (root CLAUDE.md
  behavior #1): whether the single-action `authorized-apps` Disconnect button should convert to a
  `DropdownMenu` for consistency or stay a direct button, and what concrete "wide content" scenario
  each table's FR-4 audit should be grounded against.
- **Not yet run**: `/sdd-review shadcn-table-actions-responsive product-spec` (next action).
