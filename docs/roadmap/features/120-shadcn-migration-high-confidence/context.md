# Context: shadcn-migration-high-confidence

**Feature**: `docs/roadmap/features/120-shadcn-migration-high-confidence/feature.md`
**Product Spec**: `docs/roadmap/features/120-shadcn-migration-high-confidence/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/120-shadcn-migration-high-confidence/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Source: "The Component Ledger" shadcn/ui gap audit (published as an artifact this session), which
  read every file under `services/xstockstrat-ui/src/components/{auth,copilot,insights,mobile,shared,trader,ui}/`
  and swept `src/app/**/*.tsx` across all four segments in full. This feature covers only the 27
  occurrences the audit rated **high confidence**. The 22 medium-confidence and 4 low-confidence
  occurrences are split into sibling features `121-shadcn-migration-medium-confidence` and
  `122-shadcn-migration-low-confidence`, created in the same session.
- **Numbering note**: this feature was originally allocated `119` before discovering that `main-dev`
  had moved — a real, unrelated feature `119-shadcn-ui-migration` (shadcn CLI infra adoption:
  `components.json`, preset `bLTl5gh6`, Tailwind v4) merged concurrently while this audit was being
  turned into backlog features. Renumbered `119` → `120` (and the two sibling features up by one to
  `121`/`122`) to avoid the collision. Re-verified against post-119 `main-dev`: `ui/textarea.tsx`
  already exists (FR-6 adjusted to adopt it, not add it), and the `ChartPanel.tsx`/`RuleEditor.tsx` line
  ranges in FR-1 and FR-6 were re-checked and shifted from the original audit's citations (that
  migration also touched `ComponentEditor.tsx`, which this feature does not cite).
