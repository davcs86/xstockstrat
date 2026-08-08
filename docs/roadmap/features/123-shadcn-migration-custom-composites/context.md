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

## Session 2026-08-08 — sdd-review product-spec

- Applied `.claude/skills/sdd-review/reference/product-spec-criteria.md` A3 core criteria directly (no
  `spec-reviewer`/`feature-overlap` subagents available in this session — no `Task` tool in the tool
  surface — so the criteria and overlap-check reference files were applied in-session against the spec
  and the live codebase instead of delegating).
- **Criteria pass**: A3 #1–#8, #10, #11 all ✓ PASS. #9 (Open Questions) started ⚠ WARN: 2 of 3 unchecked
  items (FR-5, FR-9/FR-10) are legitimate genuine-design-fork deferrals to `/sdd-design` (consistent
  with the pattern sibling `120-shadcn-migration-high-confidence` used and this repo's SDD lifecycle,
  where `spec-ready` precedes `design-approved`) — left open, not a defect. The third (e2e-parity grep
  caution) was **not** a genuine fork — it was actionable now, so it was resolved in place (see below)
  rather than left as a warning.
- **Trading-domain checks**: skipped — spec has no IBKR/Alpaca/broker/order-type/fill-handling content.
- **Overlap pass** (Mode A, applied manually per `reference/overlap-check.md`): only `spec-ready` /
  `implementation-ready` / `in-progress` / `code-completed` features count. Found: `120-shadcn-migration-
  high-confidence` (`spec-ready`) also modifies `xstockstrat-ui` — ⚠ WARN, same-service overlap, no
  config-key/proto/DB collision (120 lists no config keys, no proto, no schema changes either).
  `119-shadcn-ui-migration` (`code-completed`) already landed on `main-dev` — historical, not a live
  collision. `096-position-and-order-detail-pages` (`implementation-ready`) was checked file-by-file
  (`ChartPanel`/`RuleEditor`/`StrategyWizard`/`OutputEditor`/`ParameterEditor`/`EquityCurveChart`/
  `FormulaRunResult`/`useListEditor`/`ui/chart`) — no hits, clean. No FAIL-level overlap found (no
  merge-order.md entry needed).
  - File-level note (not a formal overlap-check finding, since Mode A is service-granularity only):
    `120` touches `RuleEditor.tsx:327-335` (a hand-rolled `<textarea>` → `ui/textarea.tsx` swap, FR-6 of
    *that* feature) while `123` touches `RuleEditor.tsx:179-325` (the visual condition-tree builder,
    this feature's FR-6/FR-8). Disjoint line ranges as of today, but both edit the same file — worth a
    merge-order coordination note if their execution windows overlap (see final report to the user).
- **Fixes applied directly to `product-spec.md`** (per standing directive — don't just note warnings,
  fix them):
  1. Grepped `e2e/insights/*.spec.ts` and `e2e/trader/*.spec.ts` for every selector load-bearing on the
     step indicator, rule editor, equity-curve chart, `ChartPanel`, and formula-row markup this feature
     touches. Findings, folded into a resolved Open Question:
     - `StrategyWizard.tsx:159-178`'s step-indicator `<ol>` itself carries **no** selector any e2e spec
       queries — `getByRole('button', {name: /Go to Step/})` in `strategy-authoring.spec.ts:254` is the
       *error-jump link* at `StrategyWizard.tsx:316`, a different element. `Questionnaire.Progress` can
       replace the `<ol>` freely; the `Next`/`Back`/`Create Strategy`/`Save Changes` button text must
       survive whatever FR-10 shell is chosen.
     - `RuleEditor.tsx:179-325`'s visual condition-tree rows carry no e2e selector either — only the
       `JSON` mode-toggle button and `getByLabel('Entry rule JSON'/'Exit rule JSON')` textareas are
       e2e-load-bearing, and those are outside FR-6's render branch.
     - `e2e/insights/backtest-coverage.spec.ts:168` asserts `getByTestId('equity-curve-chart')` — must
       be preserved on the new `ChartContainer` wrapper (FR-3).
     - `e2e/trader/chart-panel.spec.ts` is materially coupled to `lightweight-charts` itself: beyond the
       stable `getByTestId('chart-container')`, it waits on the `.tv-lightweight-charts` DOM class
       *`lightweight-charts` injects* as its async-readiness signal before the timeframe-switch test
       (`chart-panel.spec.ts:198-206`). A `recharts` migration would need to rewrite this readiness
       wait, not just swap chart internals — new evidence for `/sdd-design`'s FR-5 debate (does not
       pre-decide it).
     - `OutputEditor.tsx`/`ParameterEditor.tsx` row add/move/remove interactions have **zero** e2e
       selector coverage today (`e2e/insights/formulas.spec.ts` never interacts with a formula row) —
       FR-8's migration for those two files is not e2e-constrained but also not e2e-protected; flagged
       so `/sdd-design`/`/sdd-spec` don't silently assume coverage exists.
  2. Checked off the third Open Question with the above evidence (was previously the only genuinely
     actionable, non-deferred item in that section).
  3. Tightened Acceptance Criteria #6 from a general "passes for every spec covering a touched
     page/component" into the concrete spec-file/selector list above, plus an explicit call-out that
     FR-4/FR-8's sparkline and OutputEditor/ParameterEditor migrations rely on manual verification, not
     e2e regression protection.
  4. Also verified FR-1's Combobox close-out claim directly against the codebase (not just trusting the
     `/sdd-story` session's prior verification): `src/components/ui/combobox.tsx` is Base-UI-backed;
     all three call sites (`ChartPanel.tsx`, `ComponentEditor.tsx`, `RuleEditor.tsx`) import and use the
     full compound API (`Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/
     `ComboboxEmpty`) — confirms FR-1 is verification-only, no stray old-API call site. Also confirmed
     `useListEditor.ts`'s shape (flat `value: T[]` + `onChange` + `makeEmpty`) and that `RuleEditor.tsx`'s
     `RuleTree.conditions` is itself a flat `Condition[]` (not deeply nested despite the "tree" name) —
     so FR-6 binding `useListEditor<Condition>(tree.conditions, next => setTree({...tree, conditions:
     next}), ...)` looks directly feasible without generalizing the hook's shape; left as a design-time
     confirmation, not pre-decided here.
- **Result**: PASS WITH WARNINGS → both warnings resolved by direct edit (see above); no unresolved
  ✗ FAIL. Overall: **PASS**.
- Status: `draft` → `spec-ready`.
- Next: `/sdd-design shadcn-migration-custom-composites` (full mode — two genuine forks, FR-5 and
  FR-9/FR-10, both flagged for `AskUserQuestion`).

## Session 2026-08-08 — sdd-design (full mode)

- **No `Task` tool or `AskUserQuestion` tool was available in this execution session.** Phase 0 recon
  and Phase 1 grilling (2 rounds, full mode) were both run directly by this session rather than via
  `codebase-discovery`/`design-proposer`/`design-adversary` subagents, and the two genuine architecture
  forks the orchestrating session asked to be gated via `AskUserQuestion` (FR-5, FR-9/FR-10) — plus two
  more material decisions this session surfaced during recon (the recharts-version handling for FR-2,
  and a recon-discovered third `recharts` consumer in `insights/page.tsx`) — were decided on documented
  evidence instead of gated interactively. **All four need the user's explicit confirmation before
  `/sdd-execute`.** Full reasoning for each lives in `design.md`.
- **Phase 0 Recon** (`recon.md`): confirmed FR-1's Combobox close-out directly (all 3 call sites on the
  compound API). Found `useCandlestickChart.ts` has 3 consumers, not the 1 product-spec's Affected
  Services names for FR-5. Found `RuleEditor.tsx`'s `tree.conditions` is a flat array, directly
  `useListEditor`-bindable. Found `OutputEditor`/`ParameterEditor`/`RuleEditor` have 3 genuinely
  different row shapes (single-tier / two-tier-with-conditional-grid / no-move-controls) —
  `RepeatableRowList` must support all three, not assume one shape fits all. Verified live against the
  shadcn `radix-rhea` registry (`https://ui.shadcn.com/r/styles/radix-rhea/{chart,questionnaire}.json`):
  `chart.tsx`'s registry item declares `recharts@3.8.0` vs. this repo's installed `recharts@^2.12.7`
  (a real version-drift risk, same shape as the `trader-chart-panel` ledger entry);
  `questionnaire.tsx`'s registry item exists, matches this repo's post-119 primitive shape, and still
  depends on `@shadcn/react` even in its CLI-vendored form. Verified `@shadcn/react` directly against
  the npm registry: exists, `0.3.0`, created 2026-06-26, last modified 2026-08-05 (pre-1.0, actively
  changing). Grepped every `recharts` import in `src/` (prompted by the adversary's C-10 check in
  Round 1) and found a **third, previously-unnamed consumer**: `src/app/insights/page.tsx`'s dashboard
  "Score Trend" `LineChart` — same charting-fragmentation shape FR-2 exists to fix, not named in
  product-spec.
- **Phase 1 Grilling** (`design.md`, 2 rounds, self-run Proposer/Adversary/Synthesis given no
  subagents): **FR-2** — hand-author `ui/chart.tsx` against the installed `recharts` v2 (two small,
  mechanical omissions vs. the v3-targeted registry file), not bump `recharts` mid-feature. **FR-5** —
  **keep** `lightweight-charts` as a sanctioned exception (3 shared consumers, e2e coupling to its own
  injected DOM class, no first-party recharts candlestick geometry on the highest-consequence chart in
  the app, recharts itself mid-major-version churn). **FR-9** — adopt `Questionnaire` via the
  CLI-vendored path (`npx shadcn@latest add questionnaire`), pin `@shadcn/react` to an exact version
  given its pre-1.0 status. **FR-10** — **shell only (option a), for the whole wizard**: traced every
  step individually — Steps 2/3 fail Questionnaire's single-scalar-answer-per-`Item` model outright;
  Step 1's 4 fields are the closest fit but splitting them into 4 `Questionnaire.Item` screens would
  be a step-count/pacing UX redesign product-spec's Out-of-Scope excludes; Step 4 has no fields to
  collect. A per-step hybrid (b) for the simpler steps was considered and rejected on this evidence.
  **`insights/page.tsx`'s second chart** — recommended folding into FR-3-shaped scope at `/sdd-spec`
  time (same pattern, materially simpler than `EquityCurveChart.tsx`), flagged for confirmation rather
  than silently added since it expands the `/sdd-review`-approved Affected Services list.
- **Recommended entries for shared files** (not written by this session — see this session's
  constraints — verbatim text for the orchestrating session to apply centrally):
  - `services/xstockstrat-ui/CLAUDE.md` § Styling sanctioned-exception note: see `design.md` § Chosen
    Approach #5 for the exact text.
  - `docs/roadmap/ledger/insights.md` candidate entry (the hardcoded-hex-vs-CSS-variable follow-up for
    `useCandlestickChart.ts`, and the "verify a live shadcn registry item's declared npm-dependency
    version against what's actually installed before drafting code against it" pattern this session
    used for `chart.tsx`) — see final report to the orchestrating session for exact text.
- Constitution rules touched: `C-01`, `C-10`, `C-14`, `P-01`, `P-02` (spirit only — no subagents spawned),
  `P-04` (not fully honored — see above), `F-11` (no breach). No Floor violation in either round.
- Status: `spec-ready` → `design-approved`. **Next action requires user confirmation first** (see
  feature.md), then `/sdd-spec shadcn-migration-custom-composites`.

## Session 2026-08-08 — sdd-spec

- Generated `implementation-spec.md` with 12 steps, grounded against `design.md`'s Chosen Approach
  (reused `recon.md`'s Codebase Map as evidence; independently re-read every touched file this session
  — `EquityCurveChart.tsx`, `FormulaRunResult.tsx`, `useListEditor.ts`, `OutputEditor.tsx`,
  `ParameterEditor.tsx`, `RuleEditor.tsx`, `StrategyWizard.tsx`, `ChartPanel.tsx`,
  `useCandlestickChart.ts`, `services/xstockstrat-ui/CLAUDE.md`, `package.json`, `components.json`,
  `button.tsx`, and the three e2e spec files — to confirm recon's citations still hold and pin exact
  line numbers). Status → `implementation-ready`.
- Step order: 1 (FR-1 close-out, docs) → 2–5 (FR-2/3/4/5 chart consolidation) → 6–9 (FR-6/7/8
  repeatable-row composite) → 10–11 (FR-9/10/11 Questionnaire wizard shell) → 12 (whole-feature
  verification pass: `pnpm lint`/`pnpm build`/targeted `pnpm test:e2e` + the manual-check note for
  `FormulaRunResult.tsx`/`OutputEditor.tsx`/`ParameterEditor.tsx`, which have no e2e selector coverage
  per Acceptance Criteria #6).
- **Deliberate scope decision — did NOT write a step for `design.md`'s Chosen Approach #12**
  (`src/app/insights/page.tsx:176-199`'s second, independent `recharts` `LineChart`). `design.md`'s own
  Open Risks explicitly flag this as "not yet approved scope" requiring the orchestrating session's
  confirmation before `/sdd-spec` turns it into concrete steps — folding it in would expand
  product-spec's `/sdd-review`-approved Affected Services list, a Commandment-level decision (C-14/C-11)
  this skill does not have standing to make unilaterally. Recorded as a `## Deferred Item` in
  `implementation-spec.md` with the file/line evidence and the shape the follow-up step would take if
  confirmed, and flagged prominently in `feature.md`'s Next Action and the final report to the user.
- Key codebase findings (re-confirmed or newly pinned this session, beyond what `recon.md` already
  had): `package.json:50-51` — `recharts@^2.12.7` installed, `shadcn@^4.16.2` CLI already a dependency,
  no `@shadcn/react` yet (Step 10 adds it, pinned exact per the design's Open Risk). `button.tsx:1-46`
  confirms the post-119 primitive shape (`data-slot`-convention, `cva()`, no `forwardRef`) `ui/chart.tsx`
  and `ui/questionnaire.tsx` must both follow. `strategy-authoring.spec.ts` grep confirmed the exact
  line numbers for every `Next`/`Create Strategy`/`Save Changes`/`Go to Step`/`JSON` button assertion
  Step 9/11's Verification blocks cite. `RuleEditor.tsx:326-335`'s JSON-mode `<textarea>` is confirmed
  disjoint from this feature's `:179-325` visual-mode condition rows and explicitly excluded from Step 9
  (owned by sibling feature `120-shadcn-migration-high-confidence`, per the earlier overlap-check note).
- **Still unresolved** (not this skill's authority to resolve): `design.md`'s FR-5/FR-9/FR-10/FR-2
  decisions and the Deferred Item above all still need the user's explicit sign-off before
  `/sdd-execute` runs any step — flagged again in `feature.md`'s Next Action per Constitution **P-04**
  (phase-gate approval, recorded) and **C-11**/**C-14** (no unapproved scope expansion).
- Next: `/sdd-review shadcn-migration-custom-composites impl-spec`.
