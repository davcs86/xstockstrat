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

## Session 2026-08-08 — user-directed FR-10 override (Step 1 restructure)

- **Trigger**: the orchestrating session asked the user directly whether FR-10 should really be
  shell-only for the entire wizard (the confirmation `design.md`'s header note and Open Risks had
  flagged as still pending, since no `AskUserQuestion` tool was available in the `/sdd-design`
  session that produced Round 1/2). The user was presented the literal option "Convert Step 1's 4
  independent fields to native Choice/Input answers" and **selected it, for Step 1 specifically**.
  Steps 2/3/4 stay shell-only, unchanged from Round 2's original conclusion — this is a narrow,
  explicit override, not a reopening of the whole FR-10 decision.
- **Correction to the framing that prompted this override**: Step 1 ("Identity") is 4 plain text/number
  fields (Strategy ID, Display name, Re-entry cooldown days, Exit cooldown days) — not symbol/side
  pickers. Verified directly against `services/xstockstrat-ui/src/components/insights/
  StrategyWizard.tsx` this session (not re-derived from recon/design, which already had this right —
  the correction was to a framing assumption made when the user was asked, not to any prior artifact).
- **Corrected/sourced evidence**: `design.md`'s Round 2 (point 3) cited "`recon.md` § Dependencies —
  `FormData.get(itemName)`/`getAll`" for `Questionnaire.Item`'s one-answer-per-`Item` model, but
  `recon.md` § Dependencies never actually contained that evidence at the time — it only had the
  recharts-version and `@shadcn/react`-maturity bullets. This session verified the claim directly via
  **two independent live `WebFetch` calls** against the shadcn `Questionnaire` docs and appended the
  finding to `recon.md` § Dependencies, so the citation is now real: `QuestionnaireItem` renders as a
  `fieldset`; each `Item` has a unique `name` that becomes the `FormData` key; `FormData.get(itemName)`
  reads one answer, `FormData.getAll(itemName)` reads a multi-checkbox answer (`multiple: true`); an
  `Item` supports one `Choice` group OR one optional `Input`, **not** multiple independently-named
  `Input` fields — no pattern exists for that. This drives the "4 fields → 4 `Item` screens" consequence.
- **Concrete design produced** (`design.md` § Round 3, full detail there): nested Step 1 sub-screens
  (not a flattened 7-top-level-screen wizard) — chosen because the outer `CardTitle`'s literal "Step 1
  — Identity" text stays valid across all 4 inner sub-screens (keeps 7 existing
  `getByText('Step 1 — Identity')` e2e assertions passing unmodified) and because the user's own
  framing ("Steps 2-4 stay... unchanged") reads as Steps 2/3/4 keeping their step-number identity, not
  being renumbered. `canAdvance`'s 4-predicate AND decomposes into 4 independent per-sub-screen gates
  (each predicate reused verbatim: `idValid`, `displayName.trim()!==''`, `cooldownParsed.valid`,
  `exitCooldownParsed.valid`). `stepForError` extended to also return an `identitySubStep` (1-4) when
  it targets Step 1, preserving the existing direct/ungated jump mechanism one level deeper. Back
  navigation persists `identitySubStep` across outer-step transitions (Back from Step 2 lands on
  sub-screen 4). Step 1's fields stay controlled-React-state-driven (not `FormData`-read-at-submit) to
  preserve live validation and edit-mode pre-population/disabling unchanged.
- **Confirmed, not hidden, consequence**: this is a real pacing change — Step 1 goes from one flat
  4-field screen to 4 sequential sub-screens (overall wizard screens: 4 → 7, counting sub-screens).
  `e2e/insights/strategy-authoring.spec.ts`'s Step-1 fill/click sequencing (the shared `fillToReview`
  helper plus every inline Step-1 sequence — effectively every test in the file that reaches past
  Step 1) needs a rewrite to insert an interstitial `Next` click between each field fill.
  `getByPlaceholder(...)` strings and the `Next`/`Back` accessible names are **unchanged** — only the
  number of clicks between them changes. This is now folded into `implementation-spec.md`'s revised
  Step 11 as a required instruction (#9), not a follow-up.
- **Files edited this session** (all within `docs/roadmap/features/123-shadcn-migration-custom-composites/`
  only, per this session's constraints — no git commands run, no writes outside this feature directory):
  - `design.md` — added a header addendum; added `## Round 3 — user-directed override` (full design);
    rewrote Chosen Approach #10; rewrote the FR-10 Rejected Alternatives entry (old entry marked
    superseded, new Round 3 rejected-flattening entry added); updated Open Risks (FR-10 checked off,
    new e2e-rewrite risk added); updated the P-04 Constitution note.
  - `recon.md` — appended the two-live-`WebFetch`-sourced `Questionnaire.Item` answer-model evidence to
    § Dependencies (the corrected citation); updated Recommended Scope item 9's footnote.
  - `implementation-spec.md` — **Total Steps 12 → 13**. Old Step 11 (shell-only for the whole wizard)
    split into new Step 11 (FR-10 Step 1 restructure — full concrete instructions, evidence, and
    verification, including the e2e-spec-rewrite instruction) and new Step 12 (FR-10 Steps 2-4 shell +
    FR-11 outer indicator, content unchanged from the old Step 11 minus Step-1-specific material);
    former Step 12 (whole-feature verification) renumbered to Step 13, with every internal
    "Step 12"/"Steps 1-11" cross-reference in Steps 4/7/8/9/10/13 corrected to match. Execution
    Summary, Consumer Surface(s), and Step Dependencies sections updated to match the new numbering.
  - `product-spec.md` — Out-of-Scope clause given a narrow, dated, cited exception for Step 1's
    restructure only; the general prohibition on wizard step-order/pacing changes stays in force for
    every other step and every other feature.
  - `feature.md` — new Status History row recording the override; Artifacts links updated (Design/
    Implementation Spec descriptions); Next Action section split FR-10 out of the "still needs
    confirmation" list into its own "FR-10 is resolved" paragraph.
- **Not resolved by this session** (unchanged, still pending): FR-5 (`lightweight-charts` keep-vs-
  replace), FR-9 (CLI-vendored `@shadcn/react` install, pinned version), FR-2's recharts-version
  handling (hand-author against v2 vs. bump to v3), and the `## Deferred Item`
  (`src/app/insights/page.tsx`'s second `recharts` chart) all still need the user's explicit
  confirmation before `/sdd-execute` runs any step touching them.
- **Not written this session, per this session's constraints** (`docs/roadmap/features/merge-order.md`,
  any ledger file, and `services/xstockstrat-ui/CLAUDE.md` were explicitly out of bounds) — recommended
  verbatim entries reported to the orchestrating session instead, including the **still-pending** FR-5
  sanctioned-exception note for `services/xstockstrat-ui/CLAUDE.md` § Styling (drafted in `design.md`
  § Chosen Approach #5 since the design session that produced Rounds 1-2, and confirmed **not yet
  applied** by any prior session — grepped `services/xstockstrat-ui/CLAUDE.md` § Styling this session
  and found no mention of `ChartPanel.tsx`, `lightweight-charts`, or "feature 123").
- Next: still `/sdd-review shadcn-migration-custom-composites impl-spec`, then (once FR-5/FR-9/FR-2/
  Deferred Item are also confirmed or overridden) `/sdd-execute shadcn-migration-custom-composites`.
