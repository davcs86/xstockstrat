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

## Session 2026-08-08 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - FR-6/FR-9 "identical"/"one duplicated" class-string wording overstates the code — the cited
    strings differ per call site (different `min-h-*`, sizing, color classes); migration goal
    unaffected, wording should be tightened when `/sdd-spec` cites this evidence (C-01).
  - AC6 ("no visual regression") is qualitative rather than quantitative — acceptable per the
    review criteria's own WARN condition, but `/sdd-spec` should name which touched pages have
    existing e2e visual coverage vs. need manual screenshot compare.
  - Both Open Questions (data-testid/e2e-selector inventory; `PlatformHeader.tsx` FR-7/FR-8
    sequencing) remain unchecked — deferred to `/sdd-design`/`/sdd-spec` per established
    precedent (feature 116), not treated as a blocking ambiguity.
- Overlap findings (file-level WARNs only, no proto/config/DB FAIL):
  - `PlatformHeader.tsx` — this feature's FR-7 (Breadcrumb, `:260-269`) and FR-8 (Accordion,
    `:209-253`) vs sibling `121-shadcn-migration-medium-confidence`'s FR-13 Navigation Menu
    evaluation (`:156-291`, superset range). Both `draft`.
  - `trader/positions/[symbol]/page.tsx`, `trader/OrderForm.tsx`, `trader/OrdersTable.tsx` — this
    feature's FR-1/FR-2/FR-3 vs `096-position-and-order-detail-pages` and
    `101-exactly-once-order-intent` (both `implementation-ready`) — disjoint line ranges today,
    rebase risk only.
  - Recommend a soft (non-blocking) merge-order note once 120 reaches `implementation-ready`,
    covering `PlatformHeader.tsx` (vs 121) and the three trader files (vs 096/101).
  - `insights/screener/page.tsx` FR-2 citation (`:348-378`) should be re-verified at
    `/sdd-design` time — `117`/`118` (both `code-completed`, already on `main-dev`) touched
    other line ranges in the same file; no overlap today but trunk has moved since audit time.

## Session 2026-08-08 — product-spec warning fixes (user-directed)

- User directed: fix the review's advisory warnings rather than leave them noted-only, and use
  **full** design-debate mode (≥2 rounds) instead of `quick` for this and the sibling features.
- Edited `product-spec.md`:
  - FR-6/FR-9 wording tightened — "one duplicated"/"identical" class-string language replaced
    with an accurate description (same shape, different sizing/tone modifiers per site).
  - FR-5 citation corrected: `FormulaWorkspace.tsx:278-284` → `278-285` (recon.md-confirmed
    off-by-one).
  - AC3 wording aligned with the FR-6/FR-9 fix ("triplicated progress-bar shape" /
    "three related textarea class strings").
  - AC6 firmed up: named which touched pages/components have existing e2e coverage
    load-bearing on the replaced markup vs. which need a manual screenshot compare
    (`config-ui/audit/page.tsx` — no e2e spec found).
  - Both Open Questions closed `[x]` with their recon.md-sourced resolutions (e2e-selector
    inventory; `PlatformHeader.tsx` cross-feature sequencing scoped to 121 only).
- No scope change — wording/citation precision only. Product spec remains `spec-ready`.

## Session 2026-08-08 — sdd-design (full mode) — Round 1

- **Proposer**: five step-groups (new primitives+tests → adopt-existing → no-e2e-risk call
  sites → e2e-risk call sites paired same-step with spec updates → PlatformHeader.tsx's two
  FRs adjacent-last).
- **Adversary objections** (no Floor breach):
  1. Group 1's own FR range omitted FR-5 (Checkbox) — a real scope gap that would break Group
     3's Checkbox steps. **Fixed directly in product-spec.md FR-12** (range corrected to
     FR-1–FR-5, FR-7–FR-9; also corrected the stale `React.forwardRef`/`displayName` fallback
     recipe to match recon's confirmed post-119 function-component shape).
  2. `CopilotRail.tsx`'s Badge (FR-10) vs Alert (FR-4) edit — proposer's own "Badge+Alert"
     Group-4 label conflated two distinct FRs/groups; needs disambiguation in round 2 (product
     spec itself is fine — FR-4 and FR-10 cite disjoint line ranges).
  3. Batching all 8 primitives before any call-site validation risks an F-09 rework-after-close
     problem — a primitive whose default shape doesn't fit its consumer surfaces no signal
     until 3-4 groups later. Round 2 to interleave: pair each primitive with its lowest-risk
     consumer in adjacent steps.
  4. Group 4's same-step component-swap + e2e-spec-update lacks an explicit red-before-green
     (P-06) checkpoint. Round 2 to split into two steps per risky call site: swap first (run
     the *unmodified* spec, expect a selector-mismatch failure), then update the spec.
  5. Full-Vitest-suite-per-primitive only catches import-resolution breakage (the ledger's
     actual trap, already fixed at `vitest.config.ts`), not render/type correctness. Round 2 to
     add `pnpm build`/`tsc --noEmit` per primitive-add step.
  6. Progress (FR-9) per-site color differences unexamined for whether they're a semantically
     meaningful taxonomy (→ shared cva variant) vs. legitimately arbitrary. Round 2 to decide
     explicitly.
  7. FR-8 (Accordion) has no confirmed e2e risk but was deferred to last purely for file
     adjacency with FR-7 — weak rationale. Round 2 to reconsider tiering.
- Floor status: none unresolved.
- Full mode (user-directed) — round 2 mandatory before the approval gate. Feeding this
  synthesis to round 2.
