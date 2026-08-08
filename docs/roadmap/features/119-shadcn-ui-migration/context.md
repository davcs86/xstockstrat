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

## Session 2026-08-08T00:30:00Z — sdd-design (Phase 0 + Phase 1, quick mode)

- Phase 0 Recon: wrote recon.md via `codebase-discovery` (service: `xstockstrat-ui`). Key facts:
  11 `src/components/ui/` files, 61 importers, no `components.json` anywhere, current theme
  already matches shadcn's CSS-variable token *names* (not necessarily values).
- Phase 1 Grilling (quick, 1 mandated round): `design-proposer` proposed preserving Nocturne HSL
  values on a generic `new-york`/`stone` base atop the existing Tailwind v3 stack.
  `design-adversary` raised 10 objections (no Floor breach) — most consequential: AC-2's
  attribution-comment mechanism doesn't survive `shadcn add --overwrite` (needs a mechanical
  regression-test guard, not a comment), the style choice was grounded in one coincidental file
  match, network/CLI-behavior risk was deferred to execute instead of checked now, and the
  Consumer Surface(s) checklist was missing `/accounts` (a real 4th segment).
- Orchestrator resolved all adversarial objections via live spikes in this sandbox (scratch-dir
  `shadcn add`/`init` runs): confirmed CLI/network reachability, confirmed `components.json`
  shape validity, confirmed React 18 `forwardRef` compatibility under `new-york`, confirmed
  `add` (not `init`) never touches `package.json`/`tailwind.config.js`/`globals.css`, ran an
  empirical `new-york` vs `default` diff comparison (642 vs 640 lines — a wash, `new-york`
  retained). Corrected product-spec.md's Consumer Surface(s)/AC-4 to name all 4 segments.
- **Mid-session user scope change** (after the quick-mode round had already produced a design):
  user rejected the "preserve Nocturne identity" premise outright — "I don't want to have a
  hybrid styling just to preserve the nocturne dark identity. I want to adopt full shadcn/UI. I
  already selected a preset that I want to use." Asked via `AskUserQuestion` which preset →
  user said "Stone" generically, then supplied a concrete tweakcn share ID: `bLTl5gh6`. Asked
  dark-only vs. light+dark → user chose **dark-only**.
- Static/API fetch of the tweakcn share link failed (client-rendered SPA, no public JSON API for
  arbitrary share IDs; a headless-Chromium spike also failed — this sandbox's outbound network
  policy blocks browser-automation traffic even to known-good hosts, confirmed by testing
  example.com/ui.shadcn.com through the same Playwright+proxy config). User then supplied the
  actual CLI command from tweakcn's own export panel: `pnpm dlx shadcn@latest apply --preset
  bLTl5gh6`. Ran it live in an isolated scratch copy of the repo (stripped the
  `@xstockstrat/proto: workspace:*` dependency so `pnpm install` could resolve standalone).
- **Live spike found a real, confirmed incompatibility**: preset `bLTl5gh6` (style
  `radix-rhea`) generates `globals.css` with `@import "shadcn/tailwind.css";` — the `shadcn` npm
  package has no such export (checked `node_modules/shadcn/package.json` `exports` map directly)
  — this preset targets Tailwind v4 and cannot resolve under this app's pinned Tailwind v3.4.3.
  Also confirmed: new dependency stack (`@base-ui/react`, unified `radix-ui`, `@tabler/icons-
  react`, `tw-animate-css`), OKLCH color tokens (not HSL), and — most consequentially — a fully
  rebuilt Base-UI-driven compound `Combobox` (the original round's premise that no shadcn
  equivalent exists was correct for generic shadcn but wrong for this specific preset). Surfaced
  all of this to the user via `AskUserQuestion` before proceeding further (C-11/P-04 — a
  Commandment-level scope change needs explicit sign-off, not a silent absorb).
- User chose **full adoption including the Tailwind v4 migration** (not the smaller "colors-only,
  stay on v3" alternative also offered).
- Rewrote product-spec.md (Problem Statement scope-decision note, FR-1..6, Out of Scope,
  Acceptance Criteria, Open Questions now resolved) and design.md (Chosen Approach superseded
  with the live-verified v4-migration + full-preset plan; original round's approach moved to
  Rejected Alternatives with its still-valid findings noted) to reflect this.
- Constitution rules touched: C-01, C-10, C-11, C-14, P-02, P-03, P-04, F-04. No Floor breach.
- Final `AskUserQuestion` design-approval gate presented (full 6-point summary) → user approved.
- Status: `draft` → `design-approved`. feature.md updated (Status History row, Artifacts links,
  Summary rewritten, Next Action → `/sdd-spec shadcn-ui-migration`).

## Session 2026-08-08T01:00:00Z — sdd-spec

- Generated `implementation-spec.md` with 11 steps. Status → `implementation-ready`.
- Reused `recon.md` + `design.md` as primary evidence; supplemented with fresh inline discovery
  (single-service feature) covering `package.json`, `tailwind.config.js`, `postcss.config.js`,
  `globals.css`, `tsconfig.json`, all 11 `src/components/ui/*.tsx` files (full content read), the
  3 combobox call sites (`ChartPanel.tsx`, `ComponentEditor.tsx`, `RuleEditor.tsx`), `vitest.config.ts`,
  `.github/workflows/ci.yml` (`node-lint`/`frontend-e2e-build`/`frontend-e2e`/`node-test` jobs),
  `.jscpd.json`, `e2e/` directory listing (all 4 segments confirmed present with specs), and
  `e2e/fixtures/INVENTORY.md`.
- Key codebase findings:
  - **Sequencing correction vs. design.md's suggested step order**: `apply --preset` (Step 2)
    overwrites `combobox.tsx` with the new compound API *and* `button.tsx`/`badge.tsx` with a `cva`
    object missing the `buy`/`sell`/`paper` variant keys, in the same regeneration pass — both
    break the whole-repo build immediately, before any reconciliation step runs. Resequenced so the
    combobox rewrite (Step 3) lands right after the preset apply (Step 2), and every intermediate
    step's `**Verification**` uses scoped `grep`/`tsc --noEmit` checks instead of a whole-repo
    `pnpm build`, deferring the first expected-passing full build to Step 7 (button/badge fix) and
    the definitive sweep to Step 10. This is a legitimate execution-ordering refinement over
    design.md's "Recommended step boundaries" list (guidance, not the Chosen Approach itself),
    recorded here per P-03 rather than silently reordered.
  - `vitest.config.ts:10`'s `test.include: ['src/**/*.test.ts']` glob is `.test.ts` only (not
    `.test.tsx`) — confirmed the AC-6 regression-guard tests can be plain `.ts` files
    (`buttonVariants`/`badgeVariants` are pure `cva()` functions, no JSX needed), placed at
    `src/components/ui/button.test.ts` / `badge.test.ts`, outside the `coverage.include:
    ['src/lib/**']` scope so they don't need to move (or risk lowering) the 40% threshold.
  - Confirmed via repo-wide grep: `lucide-react` has 19 importers outside `src/components/ui/` (must
    **not** be removed in the Step 9 dependency cleanup); the 4 individual `@radix-ui/react-*`
    packages (`react-dialog`, `react-select`, `react-separator`, `react-slot`) have zero consumers
    outside `src/components/ui/` on the pre-migration tree (safe to remove once every consumer file
    is regenerated/reconciled).
  - Confirmed via repo-wide grep: zero external call sites pass a `ref` prop into
    `Button`/`Badge`/`Input`/`Select` — corroborates design.md's React-18-`forwardRef`-drop finding.
  - `e2e/insights/strategy-authoring.spec.ts:268-291` ("formula picker filters by substring") is the
    one existing e2e test directly exercising a combobox call site
    (`getByLabel('formula', {exact:true})` on `ComponentEditor.tsx`) — the primary regression guard
    for the Step 3 combobox rewrite; `e2e/trader/chart-panel.spec.ts` has no direct combobox
    assertion (lower risk); `RuleEditor.tsx`'s lhs/rhs comboboxes are exercised only via JSON-mode in
    existing specs, not the visual picker.
  - No existing automated test asserts `Skeleton`'s `data-testid="skeleton"` or `TableRow`'s custom
    hover/selected classes — Step 5's reconciliation of those two files has no red-before-green
    target; verified by grep + the Step 10 full sweep instead.

## Session 2026-08-08T01:15:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 9 warnings, 1 note (advisory — did not block). Overlap scan: CLEAN (no
  collision with the only other in-flight feature, `096-position-and-order-detail-pages` — a
  benign shared-component dependency on `button.tsx`/`badge.tsx`, already covered by this
  feature's own Step 10 manual spot-check).
- All 9 warnings + the 1 note fixed in this same session (implementation-spec.md edited directly,
  before execution started — no F-09 concern, spec wasn't yet "during execution"):
  - [x] Steps 1, 3, 5, 6, 7 — added scoped `pnpm exec eslint <touched files>` to each step's
    Verification (the reviewer's core finding: no lint gate existed anywhere before Step 10).
  - [x] Step 2 — expanded the brace-expansion `Files` shorthand
    (`{badge,button,...}.tsx`) into 10 literal file paths (B2 criterion: no wildcards).
  - [x] Step 9 — no source files besides `package.json`/`pnpm-lock.yaml`; no eslint gate needed
    (not source-code-shaped), left as-is — reviewer flagged this gap generically across "every
    service step," but Step 9 has no `.ts`/`.tsx` file to lint.
  - [x] Step 10 — added whole-repo `pnpm run lint` (the first whole-repo lint pass in the spec)
    and restated the exact coverage gate (`coverage_threshold: 40`, `ci.yml:561-562`) explicitly
    in both Instructions and Verification, rather than only citing the config that enforces it.
  - [x] Step 11 — corrected two loose `CLAUDE.md` line-range citations: Language Versions &
    Tooling table is `:111-122` (not `:109-116`, which starts at the heading and stops short of
    the Vitest row); Version Bump Workflow's "Tool | Files to update" table is `:143-149` (not
    `:139-148`, which starts at the numbered-list item above the table).
- No Floor (`F-*`) risk found. No unresolved items remain.
- Next: `/sdd-execute shadcn-ui-migration`.
