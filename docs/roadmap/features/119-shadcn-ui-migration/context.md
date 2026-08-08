# Context: shadcn-ui-migration

**Feature**: `docs/roadmap/features/119-shadcn-ui-migration/feature.md`
**Product Spec**: `docs/roadmap/features/119-shadcn-ui-migration/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/119-shadcn-ui-migration/implementation-spec.md`

---

## Session 2026-08-08T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story: "use
  shadcn/UI following all their formal tools, not the current custom tailwind theme."
- Recon at story time: `src/components/ui/` already mimics shadcn conventions closely (`cva`,
  `cn()`, Radix primitives, CSS-variable HSL tokens matching shadcn's default token names almost
  exactly — this is the Nocturne dark theme, feature 083). No `components.json` exists anywhere
  in the repo. 11 files under `src/components/ui/`, 35 files under `src/` import from it.
  `combobox.tsx` has no direct shadcn registry equivalent (shadcn composes `command` + `popover`).
- Branch note: harness assigned `claude/shadcn-ui-migration-4w5bn4`, found based on a stale commit
  (pre-dates 892-903 series); reset to `origin/main-dev` tip (`7c432aa`) per root CLAUDE.md
  "Harness Default Branch" rule before starting SDD work.
