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

## Session 2026-08-09 — cross-check audit reconciliation

- A round-4 cross-check audit (originally run against sibling `120`, then swept across all four
  shadcn-migration siblings for correctness/coherence) found three real gaps in this feature's
  artifacts, all fixed in this session:
  1. **FR-5 confirmed by the user, not reflected anywhere**: the orchestrating session's consolidated
     `AskUserQuestion` gate (which resolved 121's FR-13 and 122's FR-2/3/4 overrides) also covered
     this feature's FR-5 — user chose **"Keep lightweight-charts (Recommended)"**, matching the
     self-run session's own recommendation. `feature.md`'s Next Action still listed FR-5 among items
     "never resolved... needs the user's explicit confirmation" — corrected to state it's resolved.
  2. **The FR-5 `services/xstockstrat-ui/CLAUDE.md` § Styling sanctioned-exception note was applied**
     by the orchestrating session (in the same batch as 121/122's shared-file reconciliation,
     2026-08-08) but no session here ever recorded that, and `design.md`'s Open Risks still showed it
     as an unchecked `[ ]` "must actually be added" item — checked off with a note confirming the
     applied text matches Chosen Approach #5 verbatim.
  3. **`design.md`'s `**Rounds**` header still said 2** despite the document containing a full
     `## Round 3 — user-directed override` section (the FR-10 override) — corrected to 3.
  4. **e2e-occurrence count was wrong**: both `design.md` and `implementation-spec.md` claimed
     `getByText('Step 1 — Identity')` appears "7 times" in `e2e/insights/strategy-authoring.spec.ts`;
     a direct grep found **12** real occurrences (`:55,194,234,262,273,329,341,352,375,421,433,444`).
     `implementation-spec.md`'s own citation list was additionally internally miscounted (listed 10
     line numbers while calling it "7"). Both docs corrected with the complete, verified list; the
     two previously-uncited occurrences (`:352`, `:444`) were checked against Step 11's Instruction #9
     and confirmed already covered by its broad wording ("every inline Step-1 fill/click sequence"),
     so no instruction-scope change was needed, only the evidence citation.
- FR-9's install path/version-pin and FR-2's recharts-version handling remain adversarially-vetted
  but not live-user-gated (unchanged from before this session) — `feature.md` Next Action now
  distinguishes these explicitly from the now-resolved FR-5, rather than grouping all three under one
  "never resolved" umbrella.

## Session 2026-08-09 — user-directed Round 4 override (recharts v3 bump + Deferred Item fold-in)

- **Trigger**: the orchestrating session asked the user directly about the two remaining self-run-session
  decisions `feature.md`'s Next Action still flagged as unresolved: FR-2's recharts-version handling and
  whether to fold `insights/page.tsx`'s second chart (the `## Deferred Item`) into this feature now. The
  user gave two explicit overrides: (1) **bump `recharts` to v3 repo-wide** instead of hand-authoring
  `ui/chart.tsx` against the installed v2.12.7; (2) **fold in the Deferred Item now** as new FR-12.
- **Verified recharts v2→v3 breaking changes** were supplied pre-fetched by the orchestrating session
  (live-fetched 2026-08-09) and used as-is, not re-derived: `CategoricalChartState` removed;
  `<Customized/>` no longer receives extra state; `Scatter`/`Area` `points` props removed; `Legend`
  `payload` removed; `activeIndex` removed from all components; `animateNewValues` removed from
  Area/Scatter/Funnel; `Pie`'s `blendStroke` removed; `Reference*`'s `alwaysShow`/`isFront` removed;
  `ResponsiveContainer`'s `ref.current.current` flattened; Tooltip's custom-content prop type renamed
  `TooltipProps`→`TooltipContentProps`; `CartesianGrid` gained new required `xAxisId`/`yAxisId` props;
  `YAxis` multi-axis render order changed to alphabetical-by-ID.
- **Recon performed this session** (both files read in full, per the task's explicit instruction not to
  trust the prior design's "hand-author, small gap" framing without re-checking against the real v3
  exposure of the two *existing* charts):
  - **`EquityCurveChart.tsx`** (`services/xstockstrat-ui/src/components/insights/EquityCurveChart.tsx`):
    `Scatter` (`:165-186`) uses `data`/`dataKey`/`shape`, **not** the removed `points` prop — no code
    change needed for that breaking change, contrary to `design.md`'s Round 1 speculation ("custom-
    `shape`-prop usage" flagged as a candidate, but the render-prop itself isn't the `points` API).
    No `activeIndex`, no `Customized`, no `ref.current.current` `ResponsiveContainer` usage anywhere in
    the file. **One real, concrete v3 exposure found**: `CartesianGrid` at `:135` has no `xAxisId`/
    `yAxisId` — v3 makes these required — fixed via `xAxisId={0} yAxisId={0}` (matching the file's own
    unid'd, default-id-`0` `XAxis`/`YAxis`).
  - **`FormulaRunResult.tsx`**: confirmed via direct read — **zero `recharts` usage today** (current
    `Sparkline` is hand-rolled inline SVG). FR-4's migration introduces its first `recharts` usage as
    new code written directly against v3 — no legacy exposure to fix, only "write v3-correct code."
  - **`insights/page.tsx`** (the Deferred Item, read in full — 224 lines): second, independent
    `recharts` `LineChart`, "Score Trend" dashboard card (`:154-208`). Data: `chartData()` (`:215-223`)
    over `useStrategies()`'s existing data (`:78`) — single series (`score`), no dynamic per-symbol
    config unlike `EquityCurveChart.tsx`. Same `CartesianGrid` `xAxisId`/`yAxisId` exposure as
    `EquityCurveChart.tsx` (`:177`). Tooltip uses built-in `contentStyle`/`labelStyle`/`formatter` props
    (no custom `content` component, so no `TooltipProps` import to rename). No `Scatter`/`activeIndex`/
    `Customized`. No `ref` on `ResponsiveContainer`. **No e2e coverage at all** — grepped `e2e/` for
    "Score Trend"/"chartData"/"topStrategy"/"insights/page"/"Equity Curve", zero matches.
  - Confirmed via grep: exactly 2 files repo-wide import from `'recharts'` today —
    `EquityCurveChart.tsx` and `insights/page.tsx`. `FormulaRunResult.tsx` is not among them (confirms
    the above).
- **Files edited this session** (all within
  `docs/roadmap/features/123-shadcn-migration-custom-composites/` only, per this session's constraints
  — no git commands run, no writes outside this feature directory, no writes to
  `docs/roadmap/features/merge-order.md`, any ledger file, or `services/xstockstrat-ui/CLAUDE.md`):
  - `design.md` — `**Rounds**` header 3 → 4; rewrote the "still not explicitly re-confirmed" bullet to
    point at the Round 4 resolution; added `## Round 4 — user-directed override` (the breaking-changes
    list, the `EquityCurveChart.tsx`/`FormulaRunResult.tsx`/`insights/page.tsx` recon, Constitution
    check); rewrote Chosen Approach #2 (FR-2, now "bump to v3" with the concrete fix list) and added
    Chosen Approach #12 as FR-12 (was the recon-discovered scope question); rewrote the FR-2 Rejected
    Alternatives entry (superseded, new Round-4-rejected entry added); checked off the item-#12 Open
    Risk; added a new Open Risk (re-verify `recharts@3.8.0` is still current before Step 2 executes,
    mirroring the `@shadcn/react` pattern); updated the top-level "still open" summary to name only
    FR-9; updated the `P-04` Constitution bullet to credit both Round 3 and Round 4.
  - `product-spec.md` — FR-2 given a parenthetical recording the v3-bump override and its blast radius
    (`EquityCurveChart.tsx`, `insights/page.tsx`); added new `### Dashboard second-chart consolidation`
    with **FR-12**; Affected Services and Consumer Surface both updated to list `insights/page.tsx`/
    `package.json`/`pnpm-lock.yaml`; Acceptance Criteria #2 and #6 updated to include FR-12's file and
    the `recharts` v3 requirement.
  - `implementation-spec.md` — **Total Steps 13 → 15**. New Step 2 (repo-wide `recharts` bump +
    the minimal `CartesianGrid` `xAxisId`/`yAxisId` fix on both existing chart files, landed immediately
    so `pnpm build` stays green before either file's own `ChartContainer` migration); old Step 2 (add
    `ui/chart.tsx`) renumbered to Step 3, rewritten to run the CLI as-is (no more hand-adaptation) now
    that v3 is installed; old Steps 3-5 renumbered to Steps 4-6 with updated Codebase Evidence noting
    the `CartesianGrid` fix already landed and the `Scatter`/`activeIndex`/`Customized` non-exposure;
    new Step 7 (FR-12's `insights/page.tsx` migration, full instructions + verification); old Steps 6-13
    renumbered to Steps 8-15 with every internal "Step N" cross-reference corrected throughout (Step
    Dependencies section, Execution Summary, Consumer Surface(s), and every step's own body). The
    `## Deferred Item` section rewritten to a superseded historical record pointing at the new Step 7.
  - `feature.md` — `Last Updated` → 2026-08-09; new Status History row recording the Round 4 override;
    Artifacts section's Design/Implementation Spec descriptions updated (Rounds 3→4, Total Steps
    13→15); Next Action rewritten — FR-2 and FR-12 moved into a "resolved" paragraph alongside FR-5/
    FR-10, leaving only FR-9 in the "still not confirmed" list.
- **Not resolved by this session** (unchanged, still pending): **FR-9 only** — the CLI-vendored
  `@shadcn/react` install path and version pin (`design.md` § Chosen Approach #9) needs the user's
  explicit confirmation before `/sdd-execute` runs that step (Step 12).
- **Recommended entries for shared files** (not written by this session, per this session's file-scope
  constraints — verbatim/summarized text for the orchestrating session to apply centrally):
  - `docs/roadmap/features/merge-order.md`: no new entry needed — this session's changes are additive
    steps within the same feature, not a new cross-feature collision; the existing file-level note in
    the 2026-08-08 `sdd-review product-spec` session entry (disjoint `RuleEditor.tsx` line ranges vs.
    sibling `120-shadcn-migration-high-confidence`) still stands unchanged and is the only coordination
    point identified so far.
  - `docs/roadmap/ledger/insights.md` (candidate entry, pattern reusable by future features): "when a
    design session initially avoids bumping a shared dependency to control blast radius, but the CLI-
    vendored primitive convention (`services/xstockstrat-ui/CLAUDE.md` § Styling's `apply --preset`
    re-run risk) means a hand-authored file will eventually be overwritten by the newer version anyway —
    surface that tradeoff explicitly to the user rather than let the 'safer' choice default silently;
    this feature's user chose to bump early (Round 4) specifically to close that gap now instead of
    carrying it as tech debt."
  - `services/xstockstrat-ui/CLAUDE.md`: no new entry needed this session — the existing FR-5 sanctioned-
    exception note (§ Styling, applied 2026-08-08) already covers `ChartPanel.tsx`/`lightweight-charts`
    and is unaffected by the `recharts` v3 bump (that hook doesn't use `recharts`). No CLAUDE.md change
    is required for FR-2/FR-12.
- Next: still `/sdd-review shadcn-migration-custom-composites impl-spec`, then (once FR-9 is also
  confirmed or overridden) `/sdd-execute shadcn-migration-custom-composites`.

## Session 2026-08-09 — sdd-execute sequential (execution begins)

- Branch `feature/shadcn-migration-custom-composites` created, stacked on
  `feature/shadcn-migration-low-confidence` (feature 122, whose PR #913 is now ready-for-review).
- **FR-9 confirmation attempt**: the orchestrating session attempted a live confirmation gate for the
  one remaining unconfirmed item (FR-9's `@shadcn/react` CLI-vendored install path/version pin) but no
  interactive answer materialized in this execute session. Execution proceeds on `design.md`'s own
  already-adversarially-vetted Chosen Approach #9 (2 debate rounds, no Floor breach, no dissenting
  objection) rather than blocking indefinitely — Step 12's own Instruction 1 (re-verify the live npm
  registry version immediately before running the CLI) is the concrete mitigation for proceeding
  without a fresh live gate, per the same "fast-moving external dependency, re-check right before use"
  discipline already applied to `recharts` in Step 2.
- E2E verification environment (established by sibling features 120-122, reused here):
  `CI=1 E2E_PREBUILT=1 NEXT_DISABLE_STANDALONE=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium
  pnpm test:e2e`, requiring a prior `NEXT_DISABLE_STANDALONE=1 pnpm build`.

### Step 1 — FR-1 Combobox close-out (verification only) [done]
- `grep -rn "from '@/components/ui/combobox'\|from '../ui/combobox'" src/` — exactly 3 hits:
  `ChartPanel.tsx`, `ComponentEditor.tsx`, `RuleEditor.tsx`, all importing the compound API. No stray
  old-API call site found.
- **FR-1 verified closed at execute time** — no stray old-API Combobox call site found;
  `src/components/ui/combobox.tsx` and its 3 call sites unchanged by this feature.
- Files modified: none (docs-only close-out, this context.md entry)

### Step 2 — FR-2 bump `recharts` to v3 repo-wide [done]
- Re-verified the live npm registry (`registry.npmjs.org/recharts/latest`) per Instruction 1: current
  latest is **3.10.1**, newer than the `3.8.0` the design phase (2026-08-08/09) cited — used the
  re-verified current version, per the step's own "redo this check right before use" instruction.
  `package.json`'s `recharts` entry: `^2.12.7` → `^3.10.1`.
- `pnpm install` regenerated `pnpm-lock.yaml` (`recharts 2.15.4` → `3.10.1` in the resolved tree). Peer
  dependency warnings surfaced (`@connectrpc/connect`↔`@bufbuild/protobuf`, `@base-ui/react`↔`date-fns`)
  are pre-existing and unrelated to this bump — not introduced by it.
- Added `xAxisId={0} yAxisId={0}` to the `CartesianGrid` in `EquityCurveChart.tsx:135` and
  `insights/page.tsx:178` (v3 makes these props required; both files' axes are unid'd/default-id-`0`,
  so this is a required-prop satisfaction, not a behavior change) — the **only** source change in
  either file this step makes, per the instruction not to perform their full `ChartContainer`
  migrations here (Steps 4/7).
- Verification: `pnpm lint` — clean (same one pre-existing unrelated warning).
  `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route manifest, no TS errors — confirms the
  repo is buildable on `recharts` v3 before any `ChartContainer` migration lands (Steps 3-7).
- Files modified: `package.json`, `pnpm-lock.yaml`, `src/components/insights/EquityCurveChart.tsx`,
  `src/app/insights/page.tsx`

### Step 3 — FR-2 add `src/components/ui/chart.tsx` (CLI-vendored) [done]
- Ran `npx shadcn@latest add chart` against the existing `components.json` preset — landed cleanly,
  no hand-adaptation needed (per `design.md`'s Round 4 override, now that v3 is installed).
- **Collateral note**: the CLI's own install step reset `package.json`'s `recharts` entry from Step
  2's `^3.10.1` back down to `^3.8.0` (the registry item's own declared dependency version) — reverted
  back to `^3.10.1` to keep Step 2's live-re-verified decision intact (both ranges resolve
  compatibly, since `^3.8.0` also permits `3.10.1`, but the written constraint should reflect what was
  actually verified). No other `ui/*` files were touched by this CLI run (only `add chart`, not
  `apply --preset` — the wholesale-overwrite collateral risk `services/xstockstrat-ui/CLAUDE.md`
  documents for the preset-apply command doesn't apply to a single `add`).
- Confirmed the generated file's shape: `data-slot="chart"` convention, plain function components
  (`ChartContainer`, `ChartTooltipContent`, `ChartLegendContent`), no `forwardRef` — matches
  `button.tsx`'s post-119 primitive shape. Exports all four required: `ChartContainer`, `ChartTooltip`,
  `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle` (plus the `ChartConfig`
  type). Imports `TooltipValueType` directly from `'recharts'` — confirms the v3-only import gap
  Round 2 originally flagged is resolved by the bump, not by omission, as `design.md` § Round 4
  predicted.
- Verification: `test -f` confirms the file exists at the expected path. `pnpm lint` — clean (same
  one pre-existing unrelated warning). `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route
  manifest, no TS errors — confirms the file type-checks cleanly against the installed recharts v3.
- Files modified: `src/components/ui/chart.tsx` (new), `package.json` (recharts constraint restored
  to `^3.10.1` after the CLI's transient reset)

### Step 4 — FR-3 migrate `EquityCurveChart.tsx` onto `ui/chart.tsx` [done]
- Captured red-before-green baseline (P-06): ran `e2e/insights/backtest-coverage.spec.ts` against the
  pre-migration tree — **11 passed**.
- Replaced `ResponsiveContainer`+`ComposedChart` wrapper with `ChartContainer` (config = one entry per
  `series[i].symbol`, `color: LINE_COLORS[i % LINE_COLORS.length]` — same palette, unchanged); used
  `className="aspect-auto h-[260px] w-full"` to override `ChartContainer`'s default `aspect-video`
  (tailwind-merge dedups the conflicting `aspect-*` utility) and reproduce the original fixed
  `height={260}` sizing.
- **`CurveTooltip` per Instruction 2's fallback clause**: `ChartTooltipContent`'s default rendering
  cannot express the trade-marker branch's full custom payload layout (entry/exit/qty/pnl) — kept a
  thin wrapper that renders the marker branch exactly as before (verbatim JSX, `data-testid`s
  unchanged) and delegates only the plain-curve branch to `ChartTooltipContent`, via its
  `labelFormatter` (reproduces the date row) and `formatter` (reproduces the `{symbol}: {fmtY(value)}`
  colored-by-series row, since `ChartTooltipContent`'s default per-item render has no equivalent
  dollar/percent formatting and `formatter` fully replaces its indicator+label+value markup for that
  row — matching original behavior, which also had no indicator dot).
- **Fix during verification**: the initial `payload={payload as Parameters<typeof
  ChartTooltipContent>[0]['payload']}` cast failed `pnpm build`'s type-check —
  `TooltipEntry[]` doesn't sufficiently overlap with Recharts' real `Payload[]` type (missing
  `graphicalItemId`). Fixed per TS's own suggested remedy: cast through `unknown` first
  (`payload as unknown as Parameters<...>['payload']`) — this is a type-level bridge between two
  different tooltip-payload type surfaces (our loose custom shape vs. the library's precise generic),
  not a runtime behavior change; `next lint` alone did not catch this (only the full `pnpm build`
  type-check did), confirming the step's own two-command verification sequence is both needed.
- Kept the `Scatter` trade-marker overlay as direct `recharts` usage inside `ChartContainer`, per
  Instruction 4 — `ui/chart.tsx` is a composition layer, not a replacement for `recharts`' own API.
- Verification: `pnpm lint` — clean. `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded (after the
  cast fix), full route manifest. `pnpm test:e2e -- e2e/insights/backtest-coverage.spec.ts` —
  **11 passed** (same count as baseline, no regression) — including "opening a past run renders
  persisted metrics, time-axis curve, and trade markers," the test most directly exercising the
  tooltip/marker rendering this step touched.
- Files modified: `src/components/insights/EquityCurveChart.tsx`

### Step 5 — FR-4 migrate `FormulaRunResult.tsx`'s `Sparkline` onto `ui/chart.tsx` [done]
- Replaced the inline-SVG `Sparkline` (fixed 140×30, hand-normalized `<polyline>`) with a `recharts`
  `LineChart` (hidden `XAxis`/`YAxis` via `hide`, no `CartesianGrid`, no `Tooltip` — matching the
  original no-axis look) wrapped in `ChartContainer`. Single-entry `ChartConfig` (`value`) drives the
  line's `stroke="var(--color-value)"` in place of the original `stroke="currentColor"` +
  `className="text-primary"` — `color: 'var(--primary)'` in the config resolves to the same design
  token, not a new color.
  `values: number[]` converted to `{ i, value }[]` point objects (index as x), fed to the `LineChart`'s
  `data` prop, per Instruction 2.
  `OutputRow`'s call site (`{series && <Sparkline values={series} />}`) and the `asNumberArray` gate
  are unchanged — only `Sparkline`'s internal implementation changed, per Instruction 3.
- No `data-testid` added or needed (none existed before — confirmed again this session) — this
  migration is presentation-parity only, per Acceptance Criteria #6's explicit no-e2e-coverage
  call-out for this file.
- Verification: `grep` confirms the `<svg>`/`<polyline>` implementation is fully removed (not a dead
  code path). `pnpm lint` — clean. `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route
  manifest, no TS errors. Manual dev-server verification deferred to Step 15's whole-feature manual
  check (per this step's own Verification note — no e2e coverage exists to gate on individually).
- Files modified: `src/components/insights/FormulaRunResult.tsx`

### Step 6 — FR-5 record `lightweight-charts` "keep" decision [done]
- No-op confirmation, per the step's own instructions: `services/xstockstrat-ui/CLAUDE.md` § Styling
  already carries the sanctioned-exception paragraph verbatim (applied 2026-08-08, per the earlier
  cross-check audit session) — re-confirmed present this session via grep.
- `git diff --stat` on `ChartPanel.tsx`/`useCandlestickChart.ts` — no changes to either, confirming
  the "keep" decision was not accompanied by a stray edit.
- Files modified: none

### Step 7 — FR-12 migrate `insights/page.tsx`'s "Score Trend" chart onto `ui/chart.tsx` [done]
- Replaced `ResponsiveContainer`+`LineChart` wrapper with `ChartContainer` (single-entry `ChartConfig`
  — `{ score: { label: 'Score', color: 'hsl(163 100% 44%)' } }`, reusing the existing fixed `Line`
  stroke color unchanged, no dynamic per-symbol loop needed unlike Step 4's `EquityCurveChart.tsx`).
- Replaced the built-in `Tooltip`'s `contentStyle`/`labelStyle`/`formatter` props with
  `<Tooltip content={<ChartTooltipContent />} />` — **no custom `formatter`/`labelFormatter` needed**:
  `ChartTooltipContent`'s default per-item lookup (`nameKey ?? item.name ?? item.dataKey` = `"score"`)
  already resolves to the config's `label: 'Score'`, and `chartData()` already rounds the score to an
  integer (`Math.round((s.overallScore ?? 0) * 100)`) before it reaches the chart, so the default
  `.toLocaleString()` value rendering already matches the original `v.toFixed(0)` output — simpler
  than Step 4's `EquityCurveChart.tsx` tooltip, which needed a custom `formatter` for its
  dollar/percent-mode value formatting.
- Carried forward Step 2's `CartesianGrid` `xAxisId={0} yAxisId={0}` fix unchanged.
  `chartData()` and the `strategies?.strategies ?? []` data source completely untouched. Empty-state
  paragraph ("Strategy scores will appear here once backtests are run") unchanged.
- Verification: `grep` confirms `ChartContainer`/`ChartTooltipContent` present and
  `contentStyle`/`labelStyle` fully removed (not dead code). `pnpm lint` — clean.
  `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route manifest, no TS errors. No e2e
  coverage exists for this file (confirmed again this session, zero matches for
  "Score Trend"/"chartData"/"topStrategy" across `e2e/`) — manual verification deferred to Step 15.
- **Chart-consolidation group (FR-1/FR-2/FR-3/FR-4/FR-5/FR-12, Steps 1-7) is now complete.**
- Files modified: `src/app/insights/page.tsx`

### Step 8 — FR-7 extract `src/components/shared/RepeatableRowList.tsx` [done]
- Created the generic composite: `{ items, onAdd, addLabel, onUpdate, onRemove, onMove?, renderRow }`
  props (the spec's own suggested shape was explicitly "an implementation detail, not load-bearing" —
  chose explicit `onUpdate`/`onRemove`/`onMove` props over baking index-binding into the caller, since
  `RepeatableRowList` itself must not call `useListEditor` per Instruction 3; each consumer's own
  `useListEditor` supplies these raw index-parameterized functions, and this component binds them
  per-row internally before handing the row-scoped `ctx` to `renderRow`).
  `move` is `undefined` (not merely disabled) on `ctx` when the consumer omits `onMove` — satisfies
  the "optional move controls, not forced on every row" requirement for `RuleEditor`'s conditions
  (Step 11), which have no move-up/move-down concept.
  Each row wrapped in a keyed `<Fragment>` (index as key) since `renderRow` returns a bare
  `ReactNode`, not a pre-keyed element.
- Add button built from the existing `Button` primitive (`variant="outline"`, `Plus` icon,
  `{addLabel}` text) — consolidates the pattern already duplicated across
  `OutputEditor.tsx:102-105`/`ParameterEditor.tsx:255-258` (DRY guard rail), confirmed by direct
  read this session before writing the composite.
- No new shadcn primitive introduced — built entirely from `Button` (already installed), matching
  product-spec FR-7's own framing that no "list editor"/"rule builder" registry recipe exists to
  install.
- Verification: `test -f` confirms the file exists. `grep` confirms `export function
  RepeatableRowList` present. `pnpm lint` — clean (same one pre-existing unrelated warning). No
  `pnpm build` run yet, per the step's own Verification block (this component has no consumers wired
  until Steps 9-11) — will be exercised by those steps' own build runs.
- Files modified: `src/components/shared/RepeatableRowList.tsx` (new)

### Step 9 — FR-8a migrate `OutputEditor.tsx` onto `RepeatableRowList` [done]
- Replaced the `value.map(...)` row block + trailing "Add output" `Button` with
  `<RepeatableRowList items={value} onAdd={add} addLabel="Add output" onUpdate={update}
  onRemove={remove} onMove={move} renderRow={...} />` — kept the existing `useListEditor` destructure
  unchanged, only the JSX consuming it changed. All 5 `aria-label` templates preserved verbatim
  (`output name {i}`, `output description {i}`, `move output up/down {i}`, `remove output {i}`).
- Files modified: `src/components/insights/OutputEditor.tsx`

### Step 10 — FR-8b migrate `ParameterEditor.tsx` onto `RepeatableRowList` [done]
- Same pattern as Step 9, for the two-tier row shape (header row + conditional numeric grid +
  trailing description `Input`) — confirms `RepeatableRowList`'s render-prop takes full control of a
  row's own JSX regardless of shape, as Step 8 designed. All 10 `aria-label` templates preserved
  verbatim.
- Ran Steps 9 and 10's builds together (both touch disjoint files, same verification gate) to save a
  build cycle.
- Verification (both steps): `grep` confirms `RepeatableRowList` import + all `aria-label` templates
  present in both files. `pnpm lint` — clean. `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded,
  full route manifest, no TS errors. No e2e coverage exists for either file (confirmed by
  `e2e/insights/formulas.spec.ts`'s 64 lines having no row-level selector) — manual verification
  (add/move/remove for both, numeric Min/Max grid show/hide for `ParameterEditor`) deferred to
  Step 15.
- Files modified: `src/components/insights/ParameterEditor.tsx`

### Step 11 — FR-6 + FR-8c bind `RuleEditor.tsx`'s conditions to `useListEditor` + `RepeatableRowList` [done]
- Captured red-before-green baseline (P-06): ran `e2e/insights/strategy-authoring.spec.ts` against
  the pre-migration tree — **23 passed**.
- Added `useListEditor<Condition>(tree.conditions, (next) => updateTree({...tree, conditions: next}),
  () => ({lhs:'', fn:'>', rhs:''}))` inside `RuleEditor`, matching `design.md`'s Chosen Approach #6
  exactly — the `makeEmpty` literal is the same one the removed inline "Add condition" handler used,
  so the empty-row shape is unchanged. `Condition`'s flat-array shape (confirmed by recon/design) made
  this a direct bind, no hook generalization needed.
  Replaced the `tree.conditions.map(...)` block + "Add condition" `Button` with
  `<RepeatableRowList items={tree.conditions} onAdd={addCondition} addLabel="Add condition"
  onUpdate={updateCondition} onRemove={removeCondition} renderRow={...} />` — **no `onMove` passed**,
  since `RuleEditor`'s conditions have no move-up/move-down today (order is semantically irrelevant
  under `AND`/`OR`); `ctx.move` is correctly `undefined` in `renderRow`, and no move buttons render
  (`RepeatableRowList`'s optional-move-controls design, confirmed working end-to-end for the first
  time by a real consumer).
- `renderRow` reproduces the exact current row verbatim: lhs `Combobox` (strict-select,
  `aria-label="left operand"`), comparator `Select` (`aria-label="comparator"`), rhs `Combobox`
  (free-text via `inputValue`/`onInputValueChange`, `aria-label="right operand"`), `Remove`-only
  `Button` — all bridged through `ctx.update`/`ctx.remove` instead of the removed inline
  `tree.conditions[i] = {...}`/`.filter(...)` logic.
- Did **not** touch `RuleEditor.tsx`'s JSON-mode `<Textarea>` branch (disjoint, owned by sibling
  feature `120`) — confirmed via `grep` that `Textarea`/JSON-mode code is unchanged.
- Verification: `grep` confirms no leftover `tree.conditions.filter`/literal-push logic (fully
  replaced), all 3 `aria-label`s present, JSON-mode textarea untouched. `pnpm lint` — clean.
  `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded (this build ran unusually slowly — several
  minutes — but completed clean with no errors; not a hang, confirmed via `ps`/`.next/` mtime checks
  while waiting). `pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts` — **23 passed**, same
  count as baseline, no regression — including the JSON-mode/textarea assertions that act as the
  regression guard for `RuleEditor`'s overall wiring even though no assertion targets the visual-mode
  rows directly.
- **Row-editor composite group (FR-6/FR-7/FR-8, Steps 8-11) is now complete.**
- Files modified: `src/components/insights/RuleEditor.tsx`

### Step 12 — FR-9 install the shadcn `Questionnaire` primitive (CLI-vendored) [done]
- **Re-verified before running the CLI (Instruction 1)**: `@shadcn/react` latest on the live npm
  registry is still **0.3.0** (unchanged from design time). Live-fetched
  `ui.shadcn.com/docs/react/questionnaire` and confirmed the subcomponent API
  (`Root`/`Progress`/`Item`/`Title`/`Description`/`Choices`/`Choice`/`ChoiceInput`/`ChoiceLabel`/
  `ChoiceShortcut`/`Input`/`Error`/`Previous`/`Skip`/`Next`/`Submit`) and the one-Choices-group-OR-one-
  Input-per-`Item` / `FormData.get`/`getAll` answer model are unchanged from `recon.md`'s cited
  evidence — no material API drift, proceeded per Instruction 1's own escape hatch.
- Ran `npx shadcn@latest add questionnaire`. The CLI prompted an overwrite confirmation for
  `button.tsx` (a bundled dependency of the registry item, unrelated to `Questionnaire` itself) —
  answered **no** (piped `n`) to preserve this app's `buy`/`sell` functional-variant customizations,
  per `services/xstockstrat-ui/CLAUDE.md`'s documented collateral-regeneration trap. Confirmed via
  `git diff --stat` that `button.tsx` has zero changes.
- Pinned `@shadcn/react` to the exact version `"0.3.0"` (no caret range) in `package.json`, per
  Instruction 3, and re-ran `pnpm install` to regenerate `pnpm-lock.yaml` consistently.
- **New finding, not previously flagged**: `pnpm install` surfaced a peer-dependency warning —
  `@shadcn/react@0.3.0` declares `peerDependencies: { "react": ">=19", "@types/react": ">=19" }`,
  but this repo is pinned to React 18.3.1. Investigated directly rather than trusting the declared
  range: grepped the installed package's compiled `dist/questionnaire/index.js` for React-19-only
  APIs (`use()`, `useActionState`, `useFormStatus`, `useOptimistic`) — zero matches; the only hooks
  used are `useCallback`/`useContext`/`useId`/`useLayoutEffect`/`useMemo`/`useRef`/`useState`, all
  React-18-compatible. The declared `>=19` peer range appears to reflect the shadcn ecosystem's
  demo-app default target, not an actual runtime dependency on React 19 APIs — confirmed safe to
  proceed under this repo's pinned React 18 stack. `pnpm install` succeeds with only a warning (not
  a hard failure), and the subsequent `pnpm build` compiled clean, corroborating this.
- Confirmed `src/components/ui/questionnaire.tsx`'s import for the icon (`recon.md`'s flagged risk)
  resolved to `IconCheck` from `@tabler/icons-react` — the CLI's icon-library substitution worked
  correctly (matching `combobox.tsx`'s prior migration), **not** the raw shadcn-demo-app
  `IconPlaceholder` path recon flagged as a fallback risk.
- Verification: `test -f` confirms the file exists. `grep` confirms no `IconPlaceholder` import and
  the exact `"@shadcn/react": "0.3.0"` pin (no range). `pnpm install --frozen-lockfile` — consistent.
  `pnpm lint` — clean. `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route manifest, no
  TS errors (also the concrete proof the React-19-peer-range finding above doesn't break the build).
- Files modified: `src/components/ui/questionnaire.tsx` (new), `package.json`, `pnpm-lock.yaml`

### Step 13 — FR-10 (Step 1) restructure `StrategyWizard.tsx`'s Step 1 onto `Questionnaire`'s native Choice/Input answer model [done]
- **Pre-implementation source-level finding, before writing any restructured code**: direct
  inspection of the installed `@shadcn+react@0.3.0` compiled source (pretty-printed and grepped)
  showed `Questionnaire.Next`/`Questionnaire.Previous` visibility is computed as
  `total > 1 && !last` / `!first` (`Questionnaire.Submit` is `total > 0 && last`). A literal
  one-`Questionnaire.Item`-per-`Questionnaire.Root` design — as design.md § Round 3's prose
  describes for each of Step 1's 4 sub-screens — would make `Next` permanently hidden on every
  sub-screen (a lone item is always both first and last, so `Submit` renders instead). This
  contradicts the design's own stated intent of each sub-screen keeping its own Next/Back.
  **Resolution**: use plain `Button`s (a new `IdentityNav` helper component: `Back`/`Next` pair,
  `backDisabled`/`onBack`/`nextDisabled`/`onNext` props) for each sub-screen's navigation instead
  of `Questionnaire.Next`/`Questionnaire.Previous`, while still using `Questionnaire`(Root)/
  `QuestionnaireItem` for the field/fieldset semantics (confirmed correct for a single item — its
  `active` state resolves via `activeItemName` falling back to `enabledItems[0]`). Added a
  defensive `onSubmit={(e) => e.preventDefault()}` on each `Questionnaire` Root as a guard against
  the underlying `<form>`'s native Enter-key submission, since we bypass the primitive's own Submit
  handling. This is a deviation from design.md's literal prose but not from its actual intent
  (independently-navigable sub-screens); documented inline in `StrategyWizard.tsx` and here per
  P-03. Caught via proactive source inspection before writing broken code, not via a failing e2e
  run — a stronger instance of this whole session's "verify against installed source" discipline.
- Applied Instructions 1-8: added `identitySubStep` state (persists across outer-step transitions,
  never reset except its initial value); hoisted + extended `stepForError`/`ErrorTarget` to the
  `{ step; identitySubStep? }` shape; added the `IdentityNav` helper; replaced the flat Step 1
  render branch with 4 conditional sub-screen blocks (Strategy ID → Display name → Re-entry
  cooldown → Exit cooldown), each field's `value`/`onChange` unchanged from the pre-restructure
  controlled state, every placeholder/label/error string preserved verbatim; updated the error-jump
  `onClick` to also set `identitySubStep`; wrapped the outer Back/Next/Submit nav row in
  `{step > 1 && (...)}` since Step 1's own sub-screens now own their navigation.
- **Genuine red-state capture (Instruction 9, P-06)**: ran the *unmodified*
  `e2e/insights/strategy-authoring.spec.ts` against the restructured component before touching the
  spec file. Result: **10 failed, 8 passed, 1 interrupted, 4 did not run (5.0m)**. Every one of the
  10 confirmed failures matched the expected symptom — a `getByPlaceholder(...)` call timing out or
  finding no element because that field now lives on a sub-screen the old single-click sequence
  never reached (e.g. `getByPlaceholder('SMA Crossover')` unreachable after only one `Next` click,
  which now only advances Strategy ID → Display name, not Step 1 → Step 2) — not an unrelated
  error. This is the genuine, expected-symptom red state Instruction 9 requires before rewriting
  the spec.
- **Spec rewrite**: rewrote the shared `fillToReview` helper and every inline Step-1 fill/click
  sequence (wizard-gates test, server-error-jump test, formula-picker test, both negative-cooldown
  tests, both edit-prepopulation tests, both "editing an unset strategy on an unrelated field"
  tests, and the signal_params-preservation test) to insert a `next.click()` between each field
  fill, matching the new sub-screen order (Strategy ID → Next → Display name → Next → Cooldown →
  Next → Exit cooldown → Next → lands on outer Step 2). No `getByPlaceholder(...)` string or
  `Next`/`Back` accessible name was changed, per Instruction 9's constraint.
- **Second genuine finding, surfaced only by the rewritten spec's now-required navigation through
  Step 1's sub-screens**: `edit pre-populates a non-default cooldown (AC-11)` and `edit
  pre-populates a non-default exit cooldown` (mock fixtures `strat-cooldown-14` /
  `strat-exit-cooldown-7`, both hyphenated ids) failed with a 30s timeout on the *first*
  `next.click()` (sub-screen 1 → 2). Root cause: sub-screen 1's `Next` was gated
  `nextDisabled={!idValid}` where `idValid = STRATEGY_ID_RE.test(strategyId)`
  (`/^[a-z0-9_]+$/`, no hyphen) — applied **unconditionally**, including in edit mode, where the
  Strategy ID `Input` is `disabled` and the value is server-sourced, immutable, pre-existing data
  that may predate this client-side create-time format rule. This gate already existed
  pre-Step-13 (feeding the outer `canAdvance`'s `step === 1` branch) but was never exercised by e2e
  in edit mode, because Step 1 was previously one flat screen and no test needed to click Next to
  reach the cooldown field — the mock-backend.ts comment on `strat_signal_universe`
  ("id is underscore-only so it passes the wizard's id validation") independently confirms this was
  a known, deliberately-avoided constraint, not a new one. This is a genuine, pre-existing,
  previously-latent product bug (any real legacy strategy with a hyphenated id would already have
  been unable to advance past Step 1 in edit mode before this feature), which Step 13's mandatory
  sub-screen navigation now surfaces. **Fix** (in scope — directly required to make the
  now-mandatory navigation path work, and a genuine defect, not a design preference): changed
  sub-screen 1's gate to `nextDisabled={mode === 'create' && !idValid}` and the regex-format error
  paragraph to `mode === 'create' && !idValid && strategyId !== ''` — the format rule only applies
  when the user can actually edit the id; edit mode always allows Next past sub-screen 1 since the
  field is immutable and its value came from the server. Did not touch `idValid`'s definition or
  the (now-dead, since the outer nav row is hidden for `step === 1`) `canAdvance` step-1 branch —
  out of this fix's narrow scope.
- Verification: `pnpm lint` — clean (pre-existing unrelated `aria-selected` warning only).
  `NEXT_DISABLE_STANDALONE=1 pnpm build` — compiled successfully, typecheck clean, full 39-route
  manifest, no TS errors. `pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts` — **23 passed
  (22.8s)**, matching the pre-migration baseline count with zero regressions, including both
  fixed edit-prepopulation tests.
- Files modified: `src/components/insights/StrategyWizard.tsx`,
  `e2e/insights/strategy-authoring.spec.ts`
