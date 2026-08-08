# Context: shadcn-migration-medium-confidence

**Feature**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/feature.md`
**Product Spec**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/121-shadcn-migration-medium-confidence/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Source: "The Component Ledger" shadcn/ui gap audit (published as an artifact this session). This
  feature covers the 22 occurrences the audit rated **medium confidence**. Sibling features:
  `120-shadcn-migration-high-confidence` (27 high-confidence occurrences, created first in the same
  session) and `shadcn-migration-low-confidence` (4 low-confidence occurrences, created next).
- **Dependency noted**: six of this feature's FRs (FR-4 through FR-9) extend primitives that
  `120-shadcn-migration-high-confidence` adds (`alert-dialog`, `tabs`, `toggle-group`, `alert`,
  `checkbox`, `accordion`). This feature should not reach `implementation-ready` execution on those FRs
  before `120-shadcn-migration-high-confidence` merges to `main-dev`, or `/sdd-spec` needs to sequence
  around it explicitly. Flagged in product-spec.md Open Questions for `/sdd-design` and `/sdd-spec` to
  register in `docs/roadmap/features/merge-order.md`.
- **Numbering note**: `main-dev` moved during this session — a real, unrelated feature
  `119-shadcn-ui-migration` (shadcn CLI infra adoption: `components.json`, preset `bLTl5gh6`, Tailwind
  v4) merged while this backlog was being written, taking `119`. All three sibling backlog features
  from this audit (`120`/`121`/`122`) were renumbered up by one to avoid the collision; every "depends
  on 119" phrasing in this feature's own FRs means its sibling `120-shadcn-migration-high-confidence`,
  not the real `119-shadcn-ui-migration` — corrected after an initial draft conflated the two.
