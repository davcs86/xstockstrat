# Context: shadcn-datatable-migration

**Feature**: `docs/roadmap/features/135-shadcn-datatable-migration/feature.md`
**Product Spec**: `docs/roadmap/features/135-shadcn-datatable-migration/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/135-shadcn-datatable-migration/implementation-spec.md`

---

## Session 2026-08-15 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User instruction: migrate ALL tables (native HTML, shadcn `Table`, or any other library) to the
  shadcn `DataTable` pattern, and ensure horizontal responsiveness (evaluate scrollable container vs
  other strategies per table). Explicit instruction to automate as much of the SDD pipeline as
  possible.
- Prior background check (this session, before /sdd-story) confirmed: no existing PR for branch
  `claude/migrate-tables-shadcn-datatable-jbccqa`, no pre-existing SDD feature covering this work.
  Related, already-`launched` sibling features (119–124) migrated raw `<table>` markup onto the
  shadcn `Table` *primitive* (not the TanStack `DataTable` pattern) — this feature is the next step
  up, not a duplicate of that work.
- Known trap surfaced from `docs/roadmap/ledger/fails.md` (2026-08-06,
  `083-ui-revamp-opportunities-first`): a table's horizontal-overflow regression on mobile was
  caught only by a later dedicated sweep (`e2e/mobile-overflow.spec.ts`), not at the fidelity-claim
  step. This feature's FR-5 requires the automated overflow assertion to land with each table's
  migration, reusing/extending that existing spec file rather than deferring to a final pass.
- Also relevant from the ledger (2026-08-08/2026-08-09, sibling shadcn-migration features
  121/122/123 and 120): (a) a nested subagent delegated an entire `/sdd-design` session cannot be
  assumed to have `Task`/`AskUserQuestion` access — genuine architecture forks must stay gated at
  the orchestrator level or be explicitly re-surfaced to the user; (b) shadcn's `Breadcrumb`
  primitive collided with Playwright `getByRole`/`getByLabel` locators on unrelated specs, only
  caught by a broader `-g` run — worth keeping in mind if this feature's design touches any nav/
  breadcrumb-adjacent markup incidentally.
