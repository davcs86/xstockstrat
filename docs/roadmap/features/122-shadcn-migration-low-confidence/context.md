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
