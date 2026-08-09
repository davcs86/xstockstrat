# Context: shadcn-migration-low-confidence

**Feature**: `docs/roadmap/features/122-shadcn-migration-low-confidence/feature.md`
**Product Spec**: `docs/roadmap/features/122-shadcn-migration-low-confidence/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/122-shadcn-migration-low-confidence/implementation-spec.md`

---

## Session 2026-08-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Source: "The Component Ledger" shadcn/ui gap audit (published as an artifact this session). This
  feature covers the 4 occurrences the audit rated **low confidence**. Sibling features:
  `120-shadcn-migration-high-confidence` (27 high-confidence) and
  `121-shadcn-migration-medium-confidence` (22 medium-confidence), both created earlier in the same
  session.
- Deliberately scoped as an evaluate-then-decide feature rather than a mandatory migration, per root
  CLAUDE.md "Write the minimum that solves the stated problem" — the audit itself flagged these as
  loose matches, and one path (Form) would add new dependencies (`react-hook-form`, `zod`) for as few
  as two call sites, which may not be justified. `/sdd-design` should make that call explicitly.
- **Numbering note**: originally allocated `121` before discovering `main-dev` had moved — a real,
  unrelated feature `119-shadcn-ui-migration` merged concurrently and took `119`, so this feature and
  its two siblings were renumbered up by one (`121` → `122`). None of this feature's four call sites
  (`OrderForm.tsx`, `EditOrderDialog.tsx`, `AuthForm.tsx`, `accountShared.tsx`'s `CredentialFields`)
  were touched by that migration.

## Session 2026-08-08 — sdd-review product-spec

- No Task-subagent tool was available in this session; the `spec-reviewer` and `feature-overlap`
  criteria/procedures were applied directly (reading `.claude/skills/sdd-review/reference/*.md` and
  `.claude/agents/{spec-reviewer,feature-overlap}.md` as the review method) rather than spawned as
  separate subagents. Same criteria, same rigor — noted for traceability.
- Product spec approved. Status: draft → spec-ready.
- Warnings found and **fixed in place** (not just noted) per standing directive:
  1. **FR-3 wording imprecision** — the original text cited `CredentialFields`/`buildCredentialsJson`
     as if they contained "a manual submit handler calling the gRPC client directly," but neither
     function does — `CredentialFields` (`accountShared.tsx:51-113`) is a pure field-rendering
     component and `buildCredentialsJson` (`:39-48`) is a pure builder. The actual submit handlers
     live in two separate, independent consumers: `EditCredentialsForm` (`:116-167`, calls
     `updateBrokerAccountCredentials`) and `AddAccountForm` (`:259-332`, calls
     `registerBrokerAccount`). Fixed: FR-3 now names both consumers explicitly and states that a
     "migrate" decision means wiring both to `react-hook-form` context, not a single call site.
  2. **Trading-domain check C-2 (broker/credential coverage)** — FR-3 touches broker-conditional
     credential fields but didn't explicitly state both `BrokerType` values remain in scope with
     unchanged behavior. Fixed: added an explicit sentence citing
     `packages/proto/common/v1/common.proto:66-67` (`BROKER_TYPE_ALPACA`, `BROKER_TYPE_IBKR` — the
     full enum, no other values exist) and stating this feature does not alter broker credential
     storage/validation semantics, only the widget wiring.
  3. **Open Question 2 (react-hook-form/zod dependency sweep)** — resolved with evidence, not left
     open: `grep -rn "react-hook-form\|from 'zod'\|\"zod\"" services/xstockstrat-ui/src
     services/xstockstrat-ui/package.json` returns zero matches. Checked off `[x]` in
     product-spec.md with the grep and result recorded.
- **Open Question 1 left unchecked deliberately** — "should FR-2/FR-3 be decided independently" is a
  genuine design fork the spec explicitly routes to `/sdd-design`, matching established precedent
  (sibling `120-shadcn-migration-high-confidence`'s own product-spec review left two Open Questions
  unchecked for the same reason, citing precedent from feature 116). This is a WARN under the review
  criteria's Open Questions rule, not a FAIL — deferred-with-rationale is accepted.
- FR-1/FR-2's `OrderForm.tsx:215-217`, `EditOrderDialog.tsx:82`, and `AuthForm.tsx:28-93` citations
  were spot-checked against current `main-dev` and are exact — no fix needed.
- Trading-domain checks: only C-2 (broker/credential coverage) detected as relevant (grep hit on
  "broker-conditional"/"credential"/"account management"); C-1/C-3/C-4/C-5 not triggered (no env
  var/port/service, order-execution, order-type, or fill-status content in this spec). C-2 addressed
  by the FR-3 fix above.
- Overlap scan (product-spec level, done directly — see note above on subagent availability):
  - Searched every other feature's `product-spec.md`/`implementation-spec.md` for this feature's four
    touched files. `OrderForm.tsx` also appears in `023-position-sizing-engine` and
    `101-exactly-once-order-intent` (both `launched` — code already merged, no live edit conflict,
    citations reflect current state) and in `119-shadcn-ui-migration` (`code-completed`, same
    reasoning) and `120-shadcn-migration-high-confidence` (`spec-ready` — see below).
  - **`accountShared.tsx` overlap (real, WARN-level)**: sibling `121-shadcn-migration-medium-confidence`
    (`draft`) cites `accountShared.tsx:116-167` (`EditCredentialsForm` — Collapsible/"Edit keys"
    expand-collapse migration) — this is the **exact same line range** this feature's FR-3 touches
    (the same `EditCredentialsForm` function, for a different concern: its internal state/submit
    wiring vs. its expand-collapse wrapper). Both features editing the same function body is a real
    merge-conflict risk, not just a shared-file coincidence. `120-shadcn-migration-high-confidence`
    (`spec-ready`) also touches `accountShared.tsx` but at `:213-245` (`AccountRow` remove-confirm,
    Alert Dialog) — a different function, lower risk, noted only as shared-file context.
  - No config-key, proto-field-number, or migration-NNN collisions (this feature declares none of
    those, so none are possible).
  - No `merge-order.md` entry exists yet for any shadcn-migration-* feature pair. Per this session's
    constraints, `merge-order.md` was **not** written directly — the recommended entry is reported to
    the orchestrating session for centralized application (see final report).

## Session 2026-08-08 — sdd-design (full mode, 2 rounds)

- **No `Task` or `AskUserQuestion` tool was available in this session.** Phase 0 recon and Phase 1
  grilling (proposer/adversary personas, synthesis, and the final approval gate) were all performed
  directly by the orchestrating session rather than via isolated subagents / a live interactive
  gate. Documented transparently in `design.md`'s header and Constitution section (`P-01`/`P-02`/
  `P-04` honored in spirit, not mechanically) — **flag this to the user; the design below is
  provisional pending their confirmation**, especially the FR-4 narrowing (see below), which
  changes what the product spec's FR-4 literally asked for.
- Phase 0 Recon: wrote `recon.md` (service: `xstockstrat-ui`). Key findings: `ui/alert.tsx` and
  `ui/form.tsx` both absent from trunk; confirmed post-119 function-component (`data-slot`, no
  `forwardRef`) shape via `ui/input.tsx`/`ui/button.tsx`; confirmed Vitest is `.test.ts`-only,
  node-environment, no jsdom (no obvious test shape for a `Form` primitive with no `cva()`
  variants); found a load-bearing e2e requirement (`e2e/trader/account-selector.spec.ts:63-92`,
  "Add Account form clears credential fields on success") that concretely tests the
  reset-on-success behavior a `CredentialFields`/`AddAccountForm` migration must preserve, and
  found **no equivalent e2e coverage** for `EditCredentialsForm`'s parallel reset behavior.
- Phase 1 Grilling — Round 1: Proposer proposed decline-FR-1, decide-FR-2/FR-3-independently,
  decline-FR-2, migrate-FR-3 (both consumers, full FR-4 as spec'd: react-hook-form + zod +
  ui/form.tsx). Adversary's strongest objections: (a) no concrete validation-shape gap identified
  that zod actually closes beyond native `required`; (b) `EditCredentialsForm` has zero e2e parity
  coverage, so migrating it would ship AC2's "same submit flow" unverified; (c) rewriting
  `CredentialFields` to be `FormField`-aware would need two different calling conventions since
  only some consumers would migrate. No Floor breach. Verdict: NEEDS WORK.
- Phase 1 Grilling — Round 2: Proposer narrowed scope to address every Round-1 objection: migrate
  only `AddAccountForm` (has e2e coverage), decline `EditCredentialsForm` (no coverage, and writing
  new e2e coverage is out of this evaluate-then-decide feature's proportionate scope), and keep
  `CredentialFields` itself unchanged (bridge via `register()` at the call site instead of making
  it `FormField`-aware — resolves the Round-1 "strongest risk"). Adversary's Round-2 finding
  (accepted): **FR-4 as literally spec'd (react-hook-form + zod + the full `ui/form.tsx` primitive
  set) is over-scoped relative to what the one accepted call site (`AddAccountForm`) actually
  uses** — `CredentialFields` renders no `FormField`/`FormItem`/`FormLabel`/`FormMessage` markup
  today and AC2 forbids adding new per-field validation UI, so `zod` and `ui/form.tsx` would be
  built with zero consumers exercising them, which is exactly the speculative "while I'm here"
  scaffolding CLAUDE.md rule 2 prohibits. No Floor breach. Verdict: SOUND (narrowed).
- **Chosen approach** (full detail in `design.md`): FR-1 declines both call sites (120's
  `ui/alert.tsx` hasn't shipped yet). FR-2/FR-3 decided independently, not coupled — consistency
  alone isn't a DRY-guard-rail concern (that rail targets literals/constants/types/helpers, not
  form-authoring style). FR-2 (`AuthForm`) declines. FR-3 splits: `AddAccountForm` migrates to
  `react-hook-form` (state/submit wiring only, `CredentialFields` unchanged); `EditCredentialsForm`
  declines (no e2e parity coverage). **FR-4 triggers narrower than spec'd: `react-hook-form` only —
  no `zod`, no new `ui/form.tsx` file.**
- **Rejected alternatives** (full list in `design.md`): migrate `EditCredentialsForm` too; couple
  FR-2/FR-3 for consistency; add `zod`; add the full `ui/form.tsx` primitive; rewrite
  `CredentialFields` to be `FormField`-aware; hand-author a local Alert wrapper ahead of 120.
- Constitution rules touched: `C-11`, `C-14`, `C-12`/`C-13` (honored); `P-01`/`P-02`/`P-04` (honored
  in spirit, not mechanically — no Task/AskUserQuestion tool this session). Floor breaches: none.
- Open risks carried forward (also in `design.md`, mirror here per the structured-header schema
  note): (1) FR-2/FR-3 independence + FR-4 narrowing are provisional, need user confirmation before
  `/sdd-execute` begins on FR-4; (2) `react-hook-form`'s exact API must be verified against the
  actually-installed version before `/sdd-spec` writes call-signature instructions (ledger:
  2026-08-05 trader-chart-panel); (3) `EditCredentialsForm` is left on the manual pattern while its
  sibling `AddAccountForm` moves to `react-hook-form` — add a one-line explanatory code comment
  when `/sdd-spec`/`/sdd-execute` touches `AddAccountForm`.
- Status: `spec-ready` → `design-approved`.

## Session 2026-08-08 — sdd-spec

- Generated `implementation-spec.md` with 3 steps. Status → `implementation-ready`.
- Consumed `recon.md` + `design.md` directly (both present, no fresh discovery needed beyond a few
  confirmatory re-greps — all citations in recon.md re-verified against current `main-dev` and
  found byte-exact: `OrderForm.tsx:216`, `EditOrderDialog.tsx:82`, `AuthForm.tsx:28-93`,
  `accountShared.tsx`'s full line map).
- Step shape: Step 1 (docs) records all four FR decisions (including the two no-op declines) in
  `context.md` before any code-bearing step, satisfying AC-1's ordering requirement explicitly.
  Step 2 (service) adds only the `react-hook-form` dependency — confirmed `pnpm-workspace.yaml`
  lists `services/*` and the repo has a single root `pnpm-lock.yaml` (no per-service lockfile), so
  `pnpm add` runs from `services/xstockstrat-ui/`. Step 3 (service) migrates `AddAccountForm` only
  and adds the one-line explanatory comment on `EditCredentialsForm` design.md's Open Risks flagged
  — both land in the same file/step since they're the same touched region.
- Ledger trap honored (2026-08-05, `trader-chart-panel`): Step 3's Instructions explicitly defer
  the exact `react-hook-form` call signature (`useForm`/`register`/`handleSubmit`/reset) to execute
  time, instructing the executor to check the installed package's type definitions against the
  version Step 2 resolves — no API shape is asserted in this spec.
- TDD note: Step 3 is a refactor with no intended external behavior change (parity, not new
  behavior) — `.claude/skills/sdd-execute/reference/tdd-gate.md`'s documented escape hatch applies
  ("red N/A — no behavior change; characterization test added"), citing
  `e2e/trader/account-selector.spec.ts:63-92` as the pre-existing characterization test. Recorded
  explicitly in the step's **TDD** field rather than left implicit.
- Residual note carried from the `sdd-review product-spec` session's overlap scan: sibling
  `121-shadcn-migration-medium-confidence` (`draft` as of this session) also touches
  `accountShared.tsx:116-167` (`EditCredentialsForm`) for its Collapsible/"Edit keys" expand-collapse
  concern. This feature's Step 3 now only adds a one-line comment at `:116` for that function (no
  state/submit rewiring, since `EditCredentialsForm` declined migration) — lower merge-conflict risk
  than originally flagged, but still worth checking `merge-order.md`/the other feature's diff before
  merging Step 3 if `121` has landed changes to that function by then.
- Feature status: `design-approved` → `implementation-ready`.

## Session 2026-08-08 — user-directed design override (Round 3)

- **Traceability backfill**: this entry documents the override conversation that the subsequent
  "implementation-spec.md rewritten" session (below) referenced as already-settled ground truth in
  `design.md`/`recon.md` but never itself logged here — added retroactively per this repo's
  append-only session-log convention (`docs/roadmap/features/CLAUDE.md` § Key Rules #1) and the
  round-4 cross-check audit that caught the gap on feature `120`'s sibling review.
- The orchestrating session's earlier round-2 design synthesis (self-run, no `AskUserQuestion` tool
  available in that execution environment) recommended declining `AuthForm.tsx` and
  `EditCredentialsForm`, migrating only `AddAccountForm`, and adding `react-hook-form` alone (no
  `zod`, no Form primitive) — flagged throughout `design.md`/`recon.md` as provisional pending real
  user confirmation.
- The orchestrating session (which does have `AskUserQuestion`) put this fork to the actual user
  directly: "AuthForm.tsx and accountShared.tsx's two credential forms — adopt react-hook-form, and
  if so where?" User's answer: **"Migrate all three call sites"** — overriding the narrower
  recommendation.
- During redesign, a factual correction surfaced independently: live `WebFetch` verification
  (`https://ui.shadcn.com/docs/components/field`, `https://ui.shadcn.com/docs/forms/react-hook-form`)
  found shadcn's current recommended form-building primitive is `ui/field.tsx`
  (`Field`/`FieldLabel`/`FieldContent`/`FieldDescription`/`FieldError`/`FieldGroup`/etc.,
  framework-agnostic), not the `ui/form.tsx`/`Form`/`FormField`/`FormItem`/`FormControl`/
  `FormMessage`/`useFormContext` pattern the original product-spec.md named — that pattern is
  shadcn's now-superseded convention. Also identified: 3 dependencies needed
  (`react-hook-form`+`zod`+`@hookform/resolvers/zod`), not the 2 the product spec anticipated.
  `design.md` was rewritten with a `## Round 3 — user-directed override` section recording both the
  scope override and the primitive correction; `recon.md` gained a Round 3 addendum with the
  supporting evidence.
- **Correction to a claim in the subsequent session's own log**: the "implementation-spec.md
  rewritten" session below states `product-spec.md`'s FR-4 text "is corrected in place... to match
  this verified-current reality." That correction was **not actually made** at the time (caught by
  the round-4 cross-check audit) — `product-spec.md` still named the stale `ui/form.tsx` primitive
  until this backfill session applied the fix directly (see the same-date product-spec.md edit
  below).
- Applied directly in this session: corrected `product-spec.md`'s FR-2 (primitive name + resolution
  note), FR-3 (resolution note), FR-4 (primitive name, dependency count, resolution note), Affected
  Services (primitive name), and Open Question #1 (checked off, resolution recorded) to actually
  match `design.md`'s Round 3 decision — closing the gap the earlier session's log had incorrectly
  claimed was already closed.

## Session 2026-08-08 — implementation-spec.md rewritten for design.md's Round 3 override

- **Trigger**: `design.md` and `recon.md` had already been finalized (in an earlier session) to
  record the Round 3 user-directed override — migrate all three call sites (`AuthForm.tsx`,
  `AddAccountForm`, `EditCredentialsForm` within `accountShared.tsx`) onto `ui/field.tsx` +
  `react-hook-form` + `zod` + `@hookform/resolvers/zod` (not the older `ui/form.tsx` product-spec.md's
  original FR-4 text assumed) — but `implementation-spec.md` still reflected the pre-override,
  narrower Round 2 decision (decline `AuthForm`, migrate only `AddAccountForm`,
  `react-hook-form`-only). This session's task was solely to bring `implementation-spec.md` into
  agreement with the already-recorded design decisions — `design.md`/`recon.md` were read in full and
  treated as ground truth, not re-derived or contradicted.
- Rewrote the FR-2/FR-3/FR-4 portion of `implementation-spec.md`: Step 1 (docs) still records all
  four FR decisions in `context.md` per AC-1, but now reflects FR-2/FR-3 as **migrate** (was decline/
  split) and FR-4 as full-breadth-on-a-corrected-primitive (was narrowed-to-react-hook-form-only).
  FR-1 (`OrderForm.tsx`/`EditOrderDialog.tsx`, declined) is unaffected and its step content is
  unchanged in substance.
- New step sequence (3 steps → 8 steps) for the FR-2/FR-3/FR-4 block:
  1. docs — record FR-1/FR-2/FR-3/FR-4 decisions (Round 3 update)
  2. service — add `react-hook-form`, `zod`, `@hookform/resolvers/zod` dependencies (install only,
     no call-signature code, per the 2026-08-05 `trader-chart-panel` ledger trap)
  3. service — add the `ui/field.tsx` primitive (`npx shadcn@latest add field`, hand-authored
     fallback per recon.md's confirmed export list, matching `ui/select.tsx`'s shape)
  4. **test** (new) — add `EditCredentialsForm`'s characterization e2e test, proven green against
     the **pre-migration** code — a real red-before-green (here: green-before-and-after) safety net,
     per design.md § FR-3's explicit sequencing decision. Grounded a real nuance while writing this
     step: `EditCredentialsForm`'s `onDone` callback (`accountShared.tsx:141`) fully **unmounts**
     the form on success (`AccountRow`'s `editing` state collapses, `:247-249`) rather than
     resetting-in-place like `AddAccountForm` does — so the new test asserts the row collapsing back
     to its "Edit keys" button, not a cleared-but-still-mounted field value. Also had to scope the
     new test's locators to the specific edit form (`page.locator('form').filter({ has:
     page.getByRole('button', { name: 'Save keys' }) })`) since `AddAccountForm` and
     `EditCredentialsForm` render identical `"API Key"`/`"API Secret"` placeholders simultaneously
     on `/trader/accounts` — a bare `getByPlaceholder` would strict-mode-violate.
  5. service — migrate `AuthForm.tsx`'s `CredentialsForm` (useForm + Controller + zod +
     Field/FieldLabel/FieldError; submit-level network error stays a local `error` state, not a
     zod field error)
  6. service — migrate `AddAccountForm` (same recipe; `account-selector.spec.ts:63-92` is the
     pre-existing characterization test)
  7. service — migrate `EditCredentialsForm` (same recipe; sequenced after Step 4's new test, which
     serves as this step's green-state proof)
  8. service — final gate: `pnpm lint`/`pnpm build`/`pnpm test:e2e -- e2e/trader/` +
     `e2e/auth.spec.ts` for the whole FR-2/FR-3/FR-4 block
- Verified real citations for the new/changed steps directly against current `main-dev` rather than
  reusing design.md/recon.md's citations uncritically: re-read `AuthForm.tsx` (28-93, exact),
  `accountShared.tsx` (51-332, exact — `CredentialFields`, `EditCredentialsForm`, `AccountRow`,
  `AddAccountForm` all re-confirmed), `e2e/trader/account-selector.spec.ts` (63-92, exact),
  `e2e/mock-backend.ts:199-201` (`updateBrokerAccountCredentials` already registered as a default
  handler — no new mock-backend.ts change needed for Step 4), `e2e/fixtures/accounts.ts` and
  `INVENTORY.md:14` (`BROKER_ACCOUNT_ALPACA`/`BROKER_ACCOUNT_IBKR` already canonical, no new
  fixture), and `ui/select.tsx` (structural precedent for `ui/field.tsx`'s shape).
- **Elevated merge risk flagged, not resolved here**: the original 3-step plan's `EditCredentialsForm`
  touch was a one-line comment (low conflict risk against sibling
  `121-shadcn-migration-medium-confidence`, which touches the same function for its
  Collapsible/expand-collapse concern). The new Step 7 substantively rewrites
  `EditCredentialsForm`'s internals, raising that risk from "shared file" to "same function, both
  editing its internals." Noted in `implementation-spec.md`'s "Step Dependencies" section and here —
  `/sdd-execute` should check `merge-order.md`/`121`'s status before merging Step 7.
- `design.md` and `recon.md` were **not modified** — read-only ground truth for this session, per the
  task's explicit constraint. Only `implementation-spec.md`, `feature.md` (a Status History row noting
  the step-count change, no lifecycle transition), and this file were touched.
- No git commands were run this session (per task constraint) — no branch/commit/push performed.
- Status: `implementation-ready` (unchanged — this was a spec revision, not a new SDD phase).

## Session 2026-08-09 — user-directed design override (Round 4) — FR-1

- **Trigger**: FR-1 (`OrderForm.tsx:215-217`, `EditOrderDialog.tsx:82`) was previously decided
  DECLINE both call sites (Rounds 1–2, self-run, no `AskUserQuestion` tool available in that
  session — see the "sdd-design" session entry above). The user has now been asked directly and
  overridden this decision: **migrate both to `Alert` once sibling
  `120-shadcn-migration-high-confidence` ships `ui/alert.tsx`.** This entry documents that override
  and everything it changed, mirroring how sibling `121-shadcn-migration-medium-confidence`'s own
  Round 3 override (its FR-13) is documented in its `context.md` — same tone/format, applied to this
  feature's FR-1.
- **The dependency is real and unmet today**: re-confirmed this session via `ls
  services/xstockstrat-ui/src/components/ui/` — `alert.tsx` is not present (current inventory:
  `badge, button, card, combobox, input-group, input, select, separator, sheet, skeleton, table,
  textarea, utils` + their `.test.ts` guards). Sibling `120-shadcn-migration-high-confidence`, the
  feature that adds `ui/alert.tsx` (its FR-1–FR-4/FR-7–FR-9 batch), is `implementation-ready` —
  not `code-completed`/`launched`.
- **Pattern applied**: per Constitution **F-04** (never invent a file path) and this repo's own
  established precedent for exactly this situation — sibling `121`'s `implementation-spec.md`
  deliberately does **not** spec concrete steps for its own FR-4 through FR-9 (which consume six
  `120`-owned primitives), instead documenting the tranche split in its header and leaving a fresh
  `/sdd-spec` run for after `120` merges — this session applied the identical pattern to FR-1: the
  migrate decision is recorded now, in `design.md`/`product-spec.md`/`context.md`/`feature.md`, but
  no new `implementation-spec.md` steps cite `ui/alert.tsx`'s exact shape/exports. A follow-up
  `/sdd-spec shadcn-migration-low-confidence` run is needed once `120` merges to `main-dev` and
  `ui/alert.tsx` actually exists.
- **Files changed this session** (all within this feature's own directory; no git commands run, per
  task constraint):
  - `design.md` — FR-1's Chosen Approach rewritten from DECLINE to MIGRATE-blocked-on-120; the
    original Round 1/2 DECLINE reasoning is preserved (not deleted), marked superseded; added a
    `## Round 4 — user-directed override` section (mirroring § Round 3's structure) recording the
    override, the re-confirmed `ui/alert.tsx` absence, and the F-04/Tranche-split reasoning; updated
    Rejected Alternatives with a new `~~Decline both FR-1 call sites~~ — OVERRULED by Round 4` entry
    (the "hand-author ahead of 120" rejection itself stays rejected, now framed as the reason the
    migration is *sequenced* as blocked-on-120 rather than as the reason to decline); updated
    Consumer Surface, Open Risks (new unresolved item for the `120` dependency), and Constitution
    Rules Touched (`P-04` now honored for all four FRs; added `F-04`; header Rounds count 3 → 4).
  - `product-spec.md` — FR-1's text rewritten from "evaluate... adopt only if..." to the migrate
    decision plus the `120` dependency; Affected Services gained a note that `ui/alert.tsx` becomes
    affected once FR-1 unblocks; Open Questions gained a new resolved entry recording the override.
  - `implementation-spec.md` — **no new steps; step count stays 8.** Header gained a "Last Updated"
    note; Execution Summary gained a paragraph documenting the FR-1 tranche split (mirroring `121`'s
    header wording); Step Dependencies' stale "FR-1 declines, zero cross-feature dependency" line was
    corrected to state the dependency is real but attaches to a future `/sdd-spec` re-run, not to any
    of the 8 existing steps; Step 1's Codebase Evidence/Instructions/Verification were updated to
    record the FR-1 override entry alongside the FR-2/FR-3/FR-4 entries (append-only `context.md`
    section header renamed `## FR Decisions (AC-1) — Round 3 + Round 4 update` for this run's
    transcription, done in this same session as part of the actual Step-1 execution — see below);
    Step 8's Codebase Evidence corrected "FR-1 (zero-diff) declines" language to "FR-1 produces zero
    diff in this spec because it's unspecced, not because it declined."
  - `feature.md` — added a Status History row for this override (no lifecycle transition —
    `implementation-ready` unchanged, same convention `121` used for its own Round 3
    implementation-spec amendment); updated `**Last Updated**`; Next Action gained a note about the
    future `/sdd-spec` re-run needed for FR-1.
  - `context.md` (this file) — this entry.
- **Recommended `merge-order.md` entry (not written this session, per task constraint — reported to
  the orchestrating session)**: a new `120` ↔ `122` blocking-dependency row, mirroring the existing
  `120` ↔ `121` row registered for `121`'s own FR-4–FR-9 Tranche 2 — `120-shadcn-migration-high-confidence`
  must merge to `main-dev` (and ship `ui/alert.tsx`) before `122-shadcn-migration-low-confidence`'s
  FR-1 can be specced and executed. This feature's other seven steps (FR-2/FR-3/FR-4, Steps 1–8) have
  no such dependency and are not blocked by this row.
- No git commands were run this session (per task constraint) — no branch/commit/push performed.
- Status: `implementation-ready` (unchanged — this was a design/spec amendment, not a new SDD
  phase).

## Session 2026-08-09 — /sdd-execute sequential — FR-1 re-spec (Steps 9-12 added)

- **Trigger**: user, at this feature's start-of-execution checkpoint, directed re-specing and
  executing FR-1 in this same pass rather than deferring it — mirroring sibling
  `121-shadcn-migration-medium-confidence`'s own Tranche 2 precedent. This feature's branch
  (`feature/shadcn-migration-low-confidence`) is stacked on `feature/shadcn-migration-medium-
  confidence`, itself stacked on `feature/shadcn-migration-high-confidence` — confirmed via `ls
  services/xstockstrat-ui/src/components/ui/` that `alert.tsx` is now present (added by `120`).
- Read `OrderForm.tsx:217-219` and `EditOrderDialog.tsx:82` fresh (not recon.md citations —
  recon.md predates this addendum). Added Steps 9-12 to `implementation-spec.md`. Total steps 8 →
  12.
- **Notable finding**: `alert.tsx` has no "buy"/success `cva` variant — only `default`/
  `destructive`/`warning`. `OrderForm.tsx`'s success-path message (`text-buy`) needs an explicit
  `AlertDescription` className override (`default`'s own color is `text-muted-foreground`, which
  would silently drop the buy-green coloring if not overridden); the error path needs no override
  since `alert.tsx`'s `destructive` variant already colors `AlertDescription` via its own
  `*:data-[slot=alert-description]:text-destructive/90` rule.
- **e2e-risk findings** (grounded, not assumed): `OrderForm.tsx`'s two message assertions
  (`order-form.spec.ts`'s success/error tests) use `getByText(...)` — text-content-based, not
  class/tag-based — so expected-pass, but still gets a real run per P-06 (Step 10). `grep`-confirmed
  zero e2e coverage of `EditOrderDialog.tsx`'s error `<p>` (`order-ticket.spec.ts` only checks the
  trigger button) — Step 11 is build-only.
- `design.md` was **not** modified — § Round 4 already recorded the migrate-both-sites decision;
  this session only wrote the concrete steps that decision required, per the same "design.md is
  read-only ground truth for a spec-amendment session" convention the earlier Round-3/Round-4
  sessions in this file established.
- `product-spec.md`'s FR-1/Affected Services/Open Questions sections updated to record "unblocked"
  (was "blocked on 120").
- Status: `implementation-ready` → `in-progress` (execution begins next against all 12 steps).

## Session 2026-08-09 — sdd-execute sequential (execution)

Verification fallback carried over from siblings 120/121: `CI=1 E2E_PREBUILT=1
NEXT_DISABLE_STANDALONE=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium` for all
e2e runs (logged once, not repeated per step).

## FR Decisions (AC-1) — Round 3 + Round 4 update

This section supersedes the original (never-written) Step 1 entry with the current, live-gated
decisions per FR, transcribed from `design.md` § Round 3/Round 4 at execute time (this repo's
`context.md` is append-only — no prior entry is deleted).

1. **FR-1 — MIGRATE (Round 4 user-directed override; supersedes the original Round 1/2 DECLINE)**
   (`OrderForm.tsx:217-219`, `EditOrderDialog.tsx:82`): the user directly overrode Round 1/2's
   decline and directed migration of both Alert-shaped call sites onto `ui/alert.tsx` (design.md §
   Round 4). `ui/alert.tsx` is confirmed present on this feature's stacked branch (added by sibling
   `120-shadcn-migration-high-confidence`) — unblocked as of this same session (see the FR-1
   re-spec entry above), so this feature's Steps 9-11 migrate both call sites directly.
2. **FR-2 — MIGRATE (Round 3 override; supersedes Round 2's decline)** (`AuthForm.tsx:28-93`,
   `CredentialsForm`): the user directly overrode Round 2's narrower recommendation and directed
   migration of all three Form-shaped call sites (design.md § Round 3). Moves to `useForm` +
   `Controller` + a `zod` schema (`email` format + required, `password` required) +
   `Field`/`FieldLabel`/`FieldError`; the network/server-error path (`fetch` failure) stays a local
   `error` state, not a zod-expressible field error.
3. **FR-3 — MIGRATE BOTH (Round 3 override; supersedes Round 2's split)**: `AddAccountForm`
   (`accountShared.tsx:259-332`) migrates (unchanged from Round 2 — justified by
   `e2e/trader/account-selector.spec.ts:63-92`'s existing reset-on-success assertion).
   `EditCredentialsForm` (`accountShared.tsx:116-167`) **also migrates** — Round 2's reason to
   decline (no e2e parity coverage) is resolved, not waived: a new characterization e2e test is
   added and proven green **before** this consumer's migration (Step 4, ahead of Step 7), per
   design.md § FR-3's red-before-green safety net for a call site that submits a mutating
   `updateBrokerAccountCredentials` gRPC call against live broker secrets. `CredentialFields` itself
   (`accountShared.tsx:51-113`) stays unchanged — both consumers bridge it to `react-hook-form` via
   `Controller` at their own call site.
4. **FR-4 — triggers at full breadth, on a corrected primitive**: three dependencies
   (`react-hook-form`, `zod`, `@hookform/resolvers/zod`) wired to `ui/field.tsx` (`Field`/
   `FieldLabel`/`FieldContent`/`FieldDescription`/`FieldError`/`FieldGroup`/`FieldSet`/`FieldLegend`/
   `FieldTitle`/`FieldSeparator`) — not `ui/form.tsx`, which is shadcn's superseded pattern (recon.md
   § Round 3 addendum).

### Step 1 — record FR decisions [done]
- Appended the `## FR Decisions (AC-1) — Round 3 + Round 4 update` section above.
- Verification: `grep -n "## FR Decisions"` → 1 match with all 4 items present.

### Step 2 — add react-hook-form, zod, @hookform/resolvers [done]
- `pnpm add react-hook-form zod @hookform/resolvers` from `services/xstockstrat-ui/`. Resolved
  versions (per this step's instruction 3, for Steps 3/5-7/9 to verify their API surface against,
  not whatever version upstream docs describe): **react-hook-form@7.85.0**, **zod@4.4.3**,
  **@hookform/resolvers@5.7.1**.
- Pre-existing, unrelated peer-dependency warnings surfaced during install (not introduced by this
  step): `@connectrpc/connect`↔`@bufbuild/protobuf` version mismatch (`packages/proto/gen/ts`),
  `@base-ui/react`↔`date-fns` version mismatch (`xstockstrat-ui`) — both predate this feature.
- Verification: `grep` on `package.json` for all three keys → present; `pnpm-lock.yaml` shows
  resolved semvers for all three.
- Files modified: `services/xstockstrat-ui/package.json`, `pnpm-lock.yaml`

### Step 3 — add ui/field.tsx primitive [done]
- `npx shadcn@latest add field --yes --overwrite` succeeded. Generated 2 files
  (`field.tsx`, plus a new dependency `label.tsx` the CLI added automatically — `FieldLabel` wraps
  `Label`) and **regenerated `separator.tsx` as collateral** (style-only: double-quotes/no-semicolons
  reformat, zero functional change, no `cva` variant to lose — `separator.tsx` has none). All three
  reformatted with `prettier --write` to match repo convention.
- Confirmed exports: `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`,
  `FieldLegend`, `FieldSeparator`, `FieldSet`, `FieldContent`, `FieldTitle` — matches recon.md's
  addendum exactly. `FieldError` accepts an `errors?: Array<{message?: string}|undefined>` prop —
  a direct fit for react-hook-form's `fieldState.error`. No `forwardRef`, `data-slot` per sub-part,
  confirmed post-119 shape.
- No `ui/field.test.ts` written — per this step's own TDD note, no `cva()`-variant logic to guard,
  verified via the migrated call sites' e2e/lint/build in Steps 5-7/9 instead.
- Verification: `pnpm lint` clean; `pnpm build` clean (compiled successfully, full route summary
  printed, no type errors).
- Files created: `src/components/ui/field.tsx`, `src/components/ui/label.tsx`. Files modified (CLI
  collateral, style-only): `src/components/ui/separator.tsx`.

### Step 4 — EditCredentialsForm characterization e2e test [done]
- Added `'Edit Credentials form closes on successful save (feature 122, FR-3 characterization)'` to
  `account-selector.spec.ts`.
- **Deviation from the step's literal locator instructions (reuse, not scope creep)**: the spec's
  own Instructions proposed scoping via `page.locator('form').filter({ has: page.getByRole('button',
  { name: 'Save keys' }) })`. Since this session's own prior work (feature 121, Step 6) already
  solved the exact same "AddAccountForm and EditCredentialsForm render identical placeholders
  simultaneously" ambiguity by adding a `data-testid="account-row-${account.id}"` to the row's
  `Collapsible` root, this step reused that already-proven, already-landed scoping mechanism
  (`page.getByTestId(...)`) instead of introducing a second, parallel locator strategy for the same
  problem — one canonical scoping approach per this DRY-adjacent reasoning, not because the spec's
  original approach was wrong.
- Confirmed the unmount-vs-reset distinction empirically: asserted the row collapses back to its
  "Edit keys" button (not a cleared-but-mounted field), matching `onDone`'s actual behavior
  (`accountShared.tsx:141`/`:248`).
- Verification: `pnpm test:e2e -- e2e/trader/account-selector.spec.ts` — **8 passed** (all pre-existing
  tests + the new one), run against the **pre-migration** `EditCredentialsForm` — this green run is
  the baseline design.md § FR-3 requires before Step 7 touches that function.
- Files modified: `e2e/trader/account-selector.spec.ts`

### Step 5 — Migrate `AuthForm.tsx`'s `CredentialsForm` to react-hook-form + zod + ui/field.tsx [done]
- Verified `react-hook-form@7.85.0`/`@hookform/resolvers@5.7.1`/`zod@4.4.3` API surfaces directly
  against installed type defs before writing any call code (ledger 2026-08-05 trap). Found zod v4's
  `.string().email()` is `@deprecated` in favor of the top-level `z.email(msg)` — used the latter.
- Replaced the four `useState` calls with a single `useForm<CredentialsValues>({ resolver:
  zodResolver(credentialsSchema), defaultValues: {...} })`. `credentialsSchema` = `z.object({ email:
  z.email(...), password: z.string().min(1, ...) })` — message text chosen to preserve AC2's "same
  validation messages" intent (equivalent wording to the native browser messages, not new stricter
  copy).
- Both `Input`s bridged via `Controller` (`render={({ field, fieldState }) => ...}`), wrapped in
  `Field`/`FieldError` (`errors={[fieldState.error]}`) — `Input` itself stays non-form-aware, matching
  the pattern design.md specifies for Step 6/7's `CredentialFields` consumers.
- Kept a local `error` state for the submit-level `fetch` failure path only (network/server error,
  not zod-expressible); `formState.isSubmitting` replaces manual `loading` for the
  disabled/label-swap behavior. `onSuccess()` call and error-rendering markup/classes unchanged.
  `AuthCardShell` and both consumer pages untouched, per the step's scope.
- No new DOM e2e coverage added (design.md § FR-2: zero DOM e2e existed pre-migration, and no new
  user-visible behavior was introduced) — verification is lint/build + the two existing
  `e2e/auth.spec.ts` API-level assertions, per the step's TDD refactor-escape-hatch note.
- Verification: `pnpm lint` — clean (only the one pre-existing unrelated warning in
  `strategies/[id]/page.tsx`). `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route
  manifest, no TS errors. `pnpm test:e2e -- e2e/auth.spec.ts` — **10 passed**, including both
  API-level `POST /api/auth/login` assertions unmodified (AC5 satisfied).
- Files modified: `src/components/auth/AuthForm.tsx`

### Step 6 — Migrate `AddAccountForm` to react-hook-form + zod + ui/field.tsx [done]
- Added the shared `credentialSchema(brokerType: BrokerType)` factory (`accountShared.tsx`,
  immediately after `buildCredentialsJson`, per the DRY guard-rail finding recorded in the spec) —
  a single zod-schema expression of `CredentialState`'s broker-conditional required fields, exported
  once and reused by this step's `AddAccountForm` and Step 7's `EditCredentialsForm`. Fields outside
  the selected broker's branch stay unconstrained `z.string()` (not absent) so the schema's inferred
  type always matches the full `CredentialState` shape — avoids a `z.object().and()` intersection,
  which would've made the two branches' field sets awkward to reconcile against one form-values type.
- **Deviation/addition beyond the step's literal instructions — dynamic-resolver-schema mechanism**:
  the spec didn't prescribe *how* to make the zod resolver track the user's live broker selection
  (a real gap, since `AddAccountForm`'s broker is form state, unlike Step 7's `EditCredentialsForm`
  where the broker is a fixed prop). Verified via direct read of the installed
  `react-hook-form@7.85.0` source (`dist/index.esm.mjs`, unminified) that `control._options = props`
  is reassigned on **every** render unconditionally — confirming the common "recompute schema each
  render" pattern is safe — but chose a **ref-based lazy resolver** instead
  (`resolver: (values, context, options) => zodResolver(addAccountSchema(brokerTypeRef.current))
  (values, context, options)`, with `brokerTypeRef.current` updated in the broker `Select`'s
  `onValueChange`): this decouples correctness from React's render-timing/batching between the
  Select's `onValueChange` firing and the next render committing, which the render-recompute
  approach would otherwise depend on implicitly. `useWatch({control, name:'brokerType'})` is still
  used, but only to drive `CredentialFields`' rendered field set (cosmetic), not validation.
- `useWatch({control, name: [...6 credential field names]})` (tuple-overload, confirmed via
  `useWatch.d.ts`) bridges the individual RHF-registered credential fields into the `creds`/
  `onChange`-controlled-component contract `CredentialFields` still expects unchanged — `setValue`
  per key on `onChange`, matching Step 5's "bridge via bindings, don't make the child hook-form-aware"
  pattern. Confirmed `.merge()` (not `.and()`) is the correct non-deprecated zod v4 `ZodObject` method
  for combining `{displayName, brokerType}` with `credentialSchema(...)`'s output object.
- `displayName`'s native `required` HTML attribute preserved unchanged alongside the zod
  `min(1, ...)` check, per the step's explicit instruction (byte-identical constraint-validation
  behavior). Broker `Select`'s reset-to-`EMPTY_CREDENTIALS` behavior on every broker change
  preserved (`handleCredsChange(EMPTY_CREDENTIALS)` in `onValueChange`). Full field reset on
  successful submit replicated via `reset({...EMPTY_CREDENTIALS, displayName:'', brokerType:'1'})`
  in place of the four manual `setState` calls. `CredentialFields`/`buildCredentialsJson` themselves
  untouched, per the step's scope.
- TDD: `red N/A` per the step's own escape-hatch note — `account-selector.spec.ts:63-92` (the AC2
  parity target) already passed pre-migration; captured green both before (Step 5's baseline run)
  and after this step's change.
- Verification: `pnpm lint` — clean (same one pre-existing unrelated warning).
  `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route manifest, no TS errors.
  `pnpm test:e2e -- e2e/trader/account-selector.spec.ts` — **8 passed**, including "Add Account form
  clears credential fields on success" (AC2 proof) and the Step 4 `EditCredentialsForm`
  characterization test (unaffected, as expected — this step doesn't touch `EditCredentialsForm`).
- Files modified: `src/components/trader/accountShared.tsx`

### Step 7 — Migrate `EditCredentialsForm` to react-hook-form + zod + ui/field.tsx [done]
- Reused Step 6's shared `credentialSchema(brokerType)` factory directly (no second schema written).
  Unlike `AddAccountForm`, this consumer's broker is a fixed prop (`account.brokerType`), not
  user-selectable, so the ref-indirection Step 6 needed to track a live broker change is unnecessary
  here — a static `zodResolver(credentialSchema(account.brokerType))` is correct as-is.
  `useForm<CredentialState>`'s generic *is* `CredentialState` directly (no `displayName`/`brokerType`
  wrapper type needed, unlike Step 6's `AddAccountValues`), since this form has no other fields.
- Same `useWatch`(tuple of the 6 credential field names) + `setValue`-per-key `handleCredsChange`
  bridge as Step 6, to keep `CredentialFields`'s existing `value`/`onChange` contract unchanged.
- Preserved the exact success-path order Step 4's characterization test depends on:
  `reset(EMPTY_CREDENTIALS)` → `await refreshAccounts()` → `onDone()` (was `setCreds(EMPTY_CREDENTIALS)`
  → `refreshAccounts()` → `onDone()`) — `onDone` is `AccountRow`'s unmount trigger
  (`() => setEditing(false)`), so this ordering is the parity-critical part, not just the reset
  mechanism swap. Kept the unmount-cleanup effect, now `reset(EMPTY_CREDENTIALS)` via `[reset]` deps
  (stable reference) instead of `[]` — behaviorally equivalent (runs once, cleans up on unmount).
  Submit-level `error` state (network/gRPC failure, not zod-expressible) kept separate and rendered
  unchanged. `CredentialFields`, `buildCredentialsJson`, `AccountRow`'s own state, `AddAccountForm`
  untouched, per the step's scope.
- TDD: `red N/A` per the step's own escape hatch — Step 4's characterization test is the
  purpose-built baseline (captured green there, against pre-migration code) this step is gated on
  keeping green, per design.md § FR-3's explicit sequencing (this is the higher-risk half of FR-3 —
  a mutating call overwriting live broker secrets).
- Verification: `pnpm lint` — clean (same one pre-existing unrelated warning).
  `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded, full route manifest, no TS errors.
  `pnpm test:e2e -- e2e/trader/account-selector.spec.ts` — **8 passed**, including Step 4's
  characterization test (the concrete AC2/FR-3 parity proof) and Step 6's "Add Account form clears
  credential fields on success" (unaffected, as expected — this step doesn't touch `AddAccountForm`).
- Files modified: `src/components/trader/accountShared.tsx`

### Step 8 — Final gate: lint, build, full e2e re-run for the FR-2/FR-3/FR-4 block [done]
- Verification-only step, no code/test changes. Ran all four gate commands against the
  Step-7-complete tree: `pnpm lint` (clean, same one pre-existing unrelated warning),
  `pnpm build` (already confirmed clean at Step 7 verification, same working tree — not re-run a
  third time), `pnpm test:e2e -- e2e/trader/` — **69 passed** (full trader-segment directory:
  `account-selector.spec.ts`, `order-form.spec.ts`, `orders.spec.ts`, and every other trader spec —
  no skips), `pnpm test:e2e -- e2e/auth.spec.ts` — **10 passed** (both API-level login assertions).
- Confirmed real assertion counts, not just green exit codes, per the tdd-gate.md "a green suite is
  not automatically coverage" caution — 69 + 10 = 79 tests, matching the pre-migration baseline
  counts from Steps 3/5/6/7's individual runs (no test was silently dropped/skipped).
- **FR-2/FR-3/FR-4 block is now complete.** As this step's own Codebase Evidence note flags: FR-1
  (Steps 9-12) was added to this spec *after* this step was originally written, so this gate does
  not cover FR-1 — Step 12 is the true whole-feature gate.
- Files modified: none (verification-only)

### Step 9 — Wire Alert to OrderForm.tsx and EditOrderDialog.tsx (FR-1) [done]
- `OrderForm.tsx`: replaced the inline `<p className={...isErrorMsg...}>` (`:217-219`, pre-edit line
  numbers) with `<Alert variant={isErrorMsg ? 'destructive' : 'default'}><AlertDescription
  className={isErrorMsg ? undefined : 'text-buy'}>{message}</AlertDescription></Alert>` — matching
  the spec's snippet exactly. Import added as `'../ui/alert'` (relative), not the spec's literal
  `'@/components/ui/alert'` suggestion — this file's own `ui/*` imports (`card`, `button`, `input`,
  `select`, `toggle-group`) are all relative, and the spec's own Instruction 2 for the sibling file
  already applies this exact "match the file's existing import style" reasoning, so it's applied
  here too for consistency rather than introducing the one `@/` alias among otherwise-relative `ui/*`
  imports.
- `EditOrderDialog.tsx`: replaced `{error && <p className="text-xs text-destructive">{error}</p>}`
  (`:82`) with `<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>`,
  relative import matching the file's existing style, per the spec's own instruction.
- No state/handler/other-markup changes in either file, per the step's scope.
- Verification: `grep -n "Alert\b"` confirms both new imports + JSX usages. `pnpm lint` — clean
  (same one pre-existing unrelated warning). `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeded,
  full route manifest, no TS errors.
- Files modified: `src/components/trader/OrderForm.tsx`, `src/components/trader/EditOrderDialog.tsx`

### Step 10 — e2e regression for FR-1 (OrderForm.tsx) [done]
- Ran `order-form.spec.ts` unmodified against Step 9's change — **12 passed** (no locator fixes
  needed), including both text-content-based assertions Step 9's Codebase Evidence flagged as the
  parity targets: "successful order submission shows orderId and status" and "failed order
  submission shows error message". Confirms `getByText(...)` locators survive the `<p>` → `Alert`/
  `AlertDescription` wrap unmodified, as expected (they match text content, not tag/class).
- Files modified: none (verification-only; no locator broke, so no test edit was needed)

### Step 11 — build-only verification for FR-1 (EditOrderDialog.tsx) [done]
- No code change (verification-only step, per the spec's own note that `e2e/trader/order-ticket.spec.ts`
  has zero assertions on this dialog's error text — confirmed again this session via the same grep
  Step 9's Codebase Evidence used). Step 9's `pnpm build` run is the gate for this site; recorded as
  its own step per acceptance criterion 5, mirroring sibling `121`'s Steps 33/35 pattern.
- Files modified: none
