# Context: shadcn-migration-custom-composites

**Feature**: `docs/roadmap/features/123-shadcn-migration-custom-composites/feature.md`
**Product Spec**: `docs/roadmap/features/123-shadcn-migration-custom-composites/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/123-shadcn-migration-custom-composites/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user request. Fourth backlog
  feature from "The Component Ledger" shadcn/ui gap audit; siblings
  `120-shadcn-migration-high-confidence`, `121-shadcn-migration-medium-confidence`,
  `122-shadcn-migration-low-confidence` were created earlier in the same session.
- Scope came directly from the user's own list of four items: Combobox, chart-library consolidation,
  grouping the reorderable-list-editor + rule-condition-builder finds into one composite, and
  converting `StrategyWizard`'s step indicator to "the shadcn questionnaire."
- **Verified before writing FRs** (session tool calls, not assumed):
  - Read current `src/components/ui/combobox.tsx` and `components.json` — confirmed the Combobox
    finding is **already resolved** by `119-shadcn-ui-migration` (it's the real
    `@base-ui/react`-backed shadcn `radix-rhea`-style recipe now, not the pre-119 self-built wrapper
    the original audit flagged). FR-1 is verification-only, not a migration.
  - `WebSearch` + `WebFetch` on `ui.shadcn.com/docs/react/questionnaire` confirmed a real shadcn
    `Questionnaire` primitive exists (this is new since this session's training-data cutoff) — API is
    `Root`/`Item`/`Title`/`Choices`/`Choice`/`Input`/`Progress`/`Navigation`, single-answer-per-step
    semantics. Its docs show an npm-package install (`pnpm add @shadcn/react`), not this repo's usual
    `npx shadcn@latest add <name>` CLI-vendored-source pattern — flagged as an Open Question for
    `/sdd-design` to confirm before committing.
  - `WebSearch` confirmed shadcn's official `Chart` component (composition over `recharts` via
    `ChartContainer`/`ChartTooltipContent`, not a wrapper).
  - Checked `package.json`: both `recharts` (^2.12.7) and `lightweight-charts` (^4.2.0) are present as
    independent deps, confirming the three-way chart split (recharts / lightweight-charts / inline SVG)
    is real and unconsolidated.
  - Checked `src/hooks/useListEditor.ts` — confirmed already shared by `OutputEditor.tsx` and
    `ParameterEditor.tsx`; `RuleEditor.tsx`'s condition-tree builder does not use it.
  - Re-read current `main-dev` for line citations: `StrategyWizard.tsx` step indicator is now
    `:159-178` (was `:158-178` at original audit time, negligible drift); `RuleEditor.tsx`'s visual
    condition-tree builder is now `:179-325` (was `:172-272` at audit time — shifted because
    `119-shadcn-ui-migration` touched this file for its Combobox API rewrite).
- Two of the four items (chart-library scope for `ChartPanel.tsx`, and Questionnaire install
  path/shell-vs-restructure scope for `StrategyWizard.tsx`) are deliberately left as explicit
  `/sdd-design` decisions (FR-5, FR-9/FR-10) rather than pre-decided here, per root CLAUDE.md behavior
  #1 ("don't assume — ask, and surface tradeoffs") — both are genuine architecture forks with real
  tradeoffs on either side, not something a `/sdd-story` pass should silently pick.
