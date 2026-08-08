# Context: shadcn-migration-low-confidence

**Feature**: `docs/roadmap/features/122-shadcn-migration-low-confidence/feature.md`
**Product Spec**: `docs/roadmap/features/122-shadcn-migration-low-confidence/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/122-shadcn-migration-low-confidence/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Source: "The Component Ledger" shadcn/ui gap audit (published as an artifact this session). This
  feature covers the 4 occurrences the audit rated **low confidence**. Sibling features:
  `120-shadcn-migration-high-confidence` (27 high-confidence) and
  `121-shadcn-migration-medium-confidence` (22 medium-confidence), both created earlier in the same
  session.
- Deliberately scoped as an evaluate-then-decide feature rather than a mandatory migration, per root
  CLAUDE.md "Write the minimum that solves the stated problem" — the audit itself flagged these as
  loose matches, and one path (Form) would add new dependencies (`react-hook-form`, `zod`) for as few
  as two call sites, which may not be justified. `/sdd-design` should make that call explicitly.
- **Numbering note**: originally allocated `121` before discovering `main-dev` had moved — a real,
  unrelated feature `119-shadcn-ui-migration` merged concurrently and took `119`, so this feature and
  its two siblings were renumbered up by one (`121` → `122`). None of this feature's four call sites
  (`OrderForm.tsx`, `EditOrderDialog.tsx`, `AuthForm.tsx`, `accountShared.tsx`'s `CredentialFields`)
  were touched by that migration.
