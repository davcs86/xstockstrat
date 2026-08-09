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

## Session 2026-08-08 — sdd-design COMPLETION (design-approved)

- Phase 0 Recon: `recon.md` (services: `xstockstrat-ui`; key reuse patterns: post-119
  plain-function-component/`data-slot` shape for all 8 new primitives, `button.tsx`/`badge.tsx`'s
  app-specific `cva` variant convention).
- Phase 1 Grilling: **4 rounds** (full mode, user-directed to run 3 and 4 beyond the mandated
  minimum of 2). Chosen approach: four ordering tiers (adopt-existing warm-up → per-primitive
  add+lowest-risk-wire interleaved → remaining no-e2e-risk sites → confirmed e2e-risk sites via
  mandatory red-before-green two-step), all 27 FR-cited call-site occurrences now explicitly
  tiered. Rejected: batching all 8 primitives before any call-site validation (F-09 rework risk);
  single-step component-swap+e2e-update (no red-before-green checkpoint); a bare-`Alert`
  replacement of `CardNotice.tsx`'s wrapper (visual-chrome scope creep).
  - Rounds 1-2: established the tier structure, fixed a scope gap (FR-12's primitive range
    omitted FR-5 Checkbox) and a stale fallback-authoring recipe in `product-spec.md`.
  - Round 3 (user-requested): closed two concrete, non-cosmetic bugs — `AlertDialogAction`'s
    default auto-close racing `accountShared.tsx`'s async `handleRemove` (needs
    `event.preventDefault()`); `CardNotice.tsx`'s Alert migration silently dropping
    `role="alert"` on its `error` tone (needs an explicit `role` prop, independent of the
    Card/CardContent chrome decision).
  - Round 4 (user-requested): closed a completeness gap — 3 of the 27 FR-cited occurrences
    (`CardNotice.tsx`, both `SectionRenderer.tsx` sites) were discussed in the design's prose but
    never placed in a tier, traced back to `recon.md`'s own risk sweep never naming them either.
    Also corrected the "five tiers" framing (item 5 was a cross-cutting note) and widened the
    Toggle Group ARIA-role verification to both its consumers, not just one.
- Constitution rules touched: C-01, C-10(a), C-14, DRY guard rail, F-09, P-06, P-03. Floor
  breaches: none in any round.
- Status: `spec-ready` → `design-approved`. Approved by user via `AskUserQuestion` after round 4.
- Next: `/sdd-spec shadcn-migration-high-confidence`.

## Session 2026-08-09 — sdd-spec

- Generated `implementation-spec.md` with **36 steps**. Status → `implementation-ready`.
- All 27 FR-cited call sites re-verified directly against current `main-dev` (Read, not just
  recon.md's citations) — every line range in product-spec.md FR-1 through FR-11 matched the actual
  file content, including the FR-5 off-by-one (`FormulaWorkspace.tsx:278-285`) and the two
  post-119 line-range corrections in FR-1/FR-6 (`ChartPanel.tsx`, `RuleEditor.tsx`). All 7 e2e spec
  citations recon.md flagged as load-bearing (`strategy-authoring.spec.ts`, `screener.spec.ts`,
  `orders.spec.ts`, `order-form.spec.ts`, `copilot.spec.ts`, `watchlists.spec.ts`,
  `nav-reachability.spec.ts`) were independently re-read and confirmed to match recon.md's
  line:content citations exactly.
- Step structure follows design.md's four tiers converted to concrete numbered steps: Steps 1-3
  (warm-up: Skeleton, Badge, Textarea), Steps 4-34 (8 new primitives in FR order — each add-step
  bundles the primitive file + its FR-12 `<name>.test.ts` in one step, immediately followed by its
  lowest-risk wire, then remaining no-e2e-risk wires, then any confirmed e2e-risk call site as a
  mandatory two-step red/green pair per P-06), Step 35 (full-suite verification + the AC-6 manual
  screenshot compare for `config-ui/audit/page.tsx`, which has no e2e spec), Step 36 (context.md
  documentation of every red-before-green outcome, per AC-6).
- Key sequencing decisions made at spec time (not individually pinned by design.md, so documented
  here for traceability):
  - Toggle Group's app-specific `buy`/`sell` variant lands with the primitive-add (Step 9), since
    both its consumers are tier-4/e2e-risk with no interim low-risk wire — confirmed against
    design.md's explicit "no interim wire in this tier" carve-out.
  - Checkbox's two consumers (`FormulaWorkspace.tsx`, `ParameterEditor.tsx`) are both no-e2e-risk,
    so they are wired together in one step (Step 24) rather than split into a "first wire" +
    "remaining" pair — design.md's tier-3 text lists both together under "remaining," which reads
    as both landing in the same no-e2e-risk pass.
  - `PlatformHeader.tsx`'s FR-7 (Breadcrumb) and FR-8 (Accordion) are interleaved as Steps 25-30 in
    the exact order design.md specifies: Breadcrumb add → Breadcrumb's no-e2e-risk wire
    (`NamespaceEditor.tsx`, `config-ui/audit/page.tsx`) → Accordion add → Accordion's wire
    (`PlatformHeader.tsx` mobile nav) → Breadcrumb's tier-4 pair (`PlatformHeader.tsx` desktop
    breadcrumb) — Accordion's wire intentionally lands ahead of Breadcrumb's own tier-4 pair on the
    same file, per design.md's explicit note that Accordion "ships... ahead of Breadcrumb's
    two-step... since it needs no red/green round-trip."
- Three items are deliberately left as **execute-time verification, not spec-time assertions**
  (per P-03 — do not assert an unconfirmed fact): (1) Toggle Group's actual rendered ARIA role
  (`role="button"` vs `"radio"`/`"radiogroup"`) — Step 9 instructs confirming this against the
  CLI-generated file; (2) Breadcrumb's default `aria-label` case/forwarding on `PlatformHeader.tsx`
  — Step 29's red run is the confirmation, not an assumption; (3) Progress's fill mechanism (inline
  `style={{width}}` vs a Radix `Indicator` `transform`) — Step 31 instructs confirming this before
  Steps 32-34 consume it.
- No design/scope deviation from `design.md`/`product-spec.md` — this session only converted the
  approved tiers into concrete, evidence-cited numbered steps.
- Next: `/sdd-review shadcn-migration-high-confidence impl-spec`.

## Session 2026-08-09 — sdd-execute sequential (Steps 1-3)

- **Verification fallback (applies for the rest of this feature)**: `pnpm test:e2e` under plain
  `pnpm dev` hits the sandboxed environment's on-demand-route-compilation timeout (Playwright's local
  10s test timeout vs. Next dev's first-hit JIT compile) — the exact "Playwright dev-server harness
  times out" case `reference/sequential-mode.md`'s verification fallbacks anticipates. Switched to the
  CI-equivalent path for every e2e run this feature: `CI=1 E2E_PREBUILT=1 NEXT_DISABLE_STANDALONE=1
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`, with `pnpm build` run once under
  `NEXT_DISABLE_STANDALONE=1` beforehand so `pnpm start` can serve it. This mirrors `playwright.config.ts`'s
  own documented CI path (build once, serve production bundle, wider CI timeouts) — not a weakened
  check. Logged once here per the sanctioned staging exception; not repeated per step below.

### Step 1 — Adopt Skeleton in insights/page.tsx and auth/login/page.tsx (FR-11) [done]
- Replaced the raw `animate-pulse` div in `insights/page.tsx` (equity-curve loading placeholder) and
  the three raw `animate-pulse` divs in `auth/login/page.tsx` with `<Skeleton>`, using `className`
  overrides (`cn()`/`twMerge` confirmed a caller `bg-*` class replaces the base `bg-muted`).
- Verification: `pnpm build` clean; `pnpm test:e2e -g "insights"` (112 passed) and `-g "auth"` (41
  passed) — no spec asserts on the old `animate-pulse` markup.
- Files modified: `src/app/insights/page.tsx`, `src/app/auth/login/page.tsx`
- Deviations: none (beyond the session-level verification fallback above).

### Step 2 — Adopt Badge for CopilotRail.tsx "beta" pill (FR-10) [done]
- Replaced the raw `<span>` pill with `<Badge variant="secondary" className="text-[10px] uppercase
  tracking-wide">` — `secondary` chosen over `outline` as the closer match to the original
  `bg-muted`/`text-muted-foreground` filled look (`outline` is border-only/transparent).
- Verification: `pnpm build` clean; `pnpm test:e2e -g "copilot"` (4 passed) — `copilot.spec.ts`
  asserts on `copilot-queue-summary`/`copilot-concentration`/rail visibility testids, not the beta
  pill's markup, confirmed unaffected.
- Files modified: `src/components/copilot/CopilotRail.tsx`
- Deviations: none.

### Step 3 — Adopt Textarea in FormulaWorkspace.tsx and RuleEditor.tsx (FR-6) [done]
- Replaced all three raw `<textarea>` elements (`FormulaWorkspace.tsx` Description + Input-JSON
  fields, `RuleEditor.tsx` JSON mode) with `<Textarea>`, passing each site's own `min-h-*`/tone
  modifier via `className`. `RuleEditor.tsx`'s `aria-label={\`${label} JSON\`}` preserved verbatim.
- Verification: `pnpm build` clean; `pnpm test:e2e -g "strategy-authoring"` (23 passed) and
  `-g "formula"` (9 passed) — `getByLabel('Entry rule JSON')`/`'Exit rule JSON'` still resolve.
- Files modified: `src/components/insights/FormulaWorkspace.tsx`, `src/components/insights/RuleEditor.tsx`
- Deviations: none.
