# Design: shadcn-migration-low-confidence

**Created**: 2026-08-08
**Rounds**: 2 (full; termination: approved)
**Approved by**: sdd-design session, autonomous synthesis @ 2026-08-08T00:00:00Z — **no
`AskUserQuestion` (or `Task` subagent-spawn) tool was available in this session**; the
proposer/adversary debate and the final approval gate were run directly by the orchestrating
session rather than as an interactive user gate. This is flagged prominently in the final report
for the calling session/user to review and override if the reasoning below doesn't hold up —
treat the two decisions below as **provisional pending human confirmation**, not as a
Constitution **P-04**-compliant recorded user approval.
**Grounded in**: recon.md

---

## Chosen Approach

**FR-1 (Alert-shaped inline messages) — DECLINE both call sites.**
`OrderForm.tsx:215-217` and `EditOrderDialog.tsx:82` keep their plain `<p>` text unchanged.
`ui/alert.tsx` does not exist in trunk today (recon.md § FR-1 call sites — sibling
`120-shadcn-migration-high-confidence` is `spec-ready`, not `code-completed`); hand-authoring an
Alert-shaped wrapper ahead of 120 risks a second, likely-divergent primitive that 120 would later
need to reconcile — exactly the near-term duplication the shadcn audit and the DRY guard rail
exist to avoid. This also matches the audit's own "loose match" rating and FR-1's own example
rationale (a boxed alert is disproportionate next to a compact order-entry submit button).

**FR-2/FR-3 independence — decided independently, not coupled.**
Each is evaluated on its actual complexity and existing-duplication merits, not coupled for
cross-component consistency. Root `CLAUDE.md`'s "write the minimum" behavior (litmus: "would a
senior engineer call it overbuilt for what was requested?") and the DRY guard rail's actual scope
(`docs/patterns/dry-guard-rail.md` — repeated *constants, literals, types, helper functions*, not
"which form-wiring style a component happens to use") both argue against forcing a shared library
choice across two components with genuinely different validation shapes. Migrating `AuthForm`
purely so it matches `accountShared.tsx`'s choice, with no functional benefit at that call site,
is the "while I'm here" scope creep CLAUDE.md rule 2 prohibits.

**FR-2 (`AuthForm.tsx:28-93`) — DECLINE.** Two static fields, browser-native `required`
validation, zero e2e DOM coverage in either direction (recon.md § FR-2 call site —
`e2e/auth.spec.ts` tests the API route only). The existing `useState` + manual `fetch` + inline
`<p>` error (`:87`) is already the minimal correct implementation; react-hook-form/zod would add
indirection with no behavioral or validation-shape benefit here.

**FR-3 (`accountShared.tsx` `CredentialFields` + its two consumers) — split decision, migrate one
consumer only.**
- **`AddAccountForm` (`accountShared.tsx:259-332`) — MIGRATE** its internal state/submit wiring
  from `useState<CredentialState>` + manual `handleAddAccount` to `useForm<CredentialState>()` +
  `handleSubmit`. Concrete, testable justification: `e2e/trader/account-selector.spec.ts:63-92`
  ("Add Account form clears credential fields on success") already exercises exactly the
  reset-on-success behavior a Form-library migration must preserve — `form.reset()` replaces the
  manual `setCreds(EMPTY_CREDENTIALS)` at `accountShared.tsx:284`, and the existing e2e spec
  proves parity without new test authoring.
- **`EditCredentialsForm` (`accountShared.tsx:116-167`) — DECLINE for this feature.** No e2e spec
  covers its reset-on-success behavior (recon.md confirms this via targeted grep) — AC2's "same
  submit flow" claim would ship unverified for this consumer. Writing new e2e coverage to unblock
  a migration is disproportionate for this evaluate-then-decide feature's scope (out of scope per
  product-spec.md's own framing — this feature evaluates existing shape, it doesn't grow test
  surface to enable a migration). Recorded as a candidate for a future feature once e2e coverage
  exists for this consumer.
- **`CredentialFields` itself (`accountShared.tsx:51-113`) is unchanged.** It stays a plain
  controlled-input component (`value`/`onChange` props); `AddAccountForm` bridges it to
  `react-hook-form` via `register()`/`Controller` at the call site, not by making
  `CredentialFields` context-aware. This resolves recon.md's flagged "strongest risk" (a
  `CredentialFields` rewrite to consume `FormField`/`useFormContext` directly, which would need
  two different calling conventions for its two consumers since only one migrates).

**FR-4 — triggers, but narrower than the product spec's literal text: `react-hook-form` only, no
`zod`, no `ui/form.tsx`.**
- **`zod` is NOT added.** `CredentialFields`' only validation today is the native HTML `required`
  attribute per broker-conditional branch — `react-hook-form`'s built-in `register(name, {
  required: true })` fully replicates this with zero capability gap. AC2 requires "same
  validation messages, same submit flow" (no new UI) — a zod schema layer would either add no
  behavior beyond what `required: true` already gives, or would need new per-field error-message
  wiring that breaks AC2's "same" requirement. There is no concrete validation-shape gap zod
  closes at the one accepted call site.
- **`ui/form.tsx` (the shadcn `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/
  `FormMessage` primitive set) is NOT added.** The one accepted call site doesn't render
  `FormField`/`FormItem`/`FormLabel`/`FormMessage` — `CredentialFields` keeps its existing
  bare-`<Input>` rendering (no per-field label/message markup exists today, and AC2 forbids adding
  it). Building six JSX exports for zero consumers is exactly the speculative scaffolding CLAUDE.md
  rule 2 prohibits ("no abstraction, option, or 'while I'm here' scaffolding the task didn't ask
  for"). `/sdd-spec` should scope FR-4 to a single dependency addition
  (`services/xstockstrat-ui/package.json`) plus `AddAccountForm`'s internal rewrite — no new file
  under `src/components/ui/`.
- Version: per the ledger trap below, `/sdd-spec` pins and verifies `react-hook-form`'s installed
  API shape only after `pnpm add react-hook-form` actually runs — it does not write exact
  `useForm`/`register`/`handleSubmit` call-signature instructions against assumed documentation
  before that.

**Consumer surface (C-14):** all of the above reaches the `xstockstrat-ui` `/trader` segment —
`OrderForm`/`EditOrderDialog` (order entry, declined), `AddAccountForm` (account management panel
and full accounts page, migrated) — already-shipped, already-reachable UI; no new routes, no nav
registration needed (C-10(a) does not apply).

**Regression-test shape for the one thing that does change**: `AddAccountForm`'s rewrite is a
JSX component with a `useForm` hook, not a `cva()`-variants function — it does not fit the
`button.test.ts`/`badge.test.ts` pattern (recon.md's flagged test-shape gap). Since no `zod`
schema helper is being added either (see above), there is no pure-logic unit worth a `.test.ts`
file. Verification for `AddAccountForm` is the existing e2e spec
(`e2e/trader/account-selector.spec.ts:63-92`) re-run against the migrated component, per AC5.

## Rejected Alternatives

- **Migrate `EditCredentialsForm` alongside `AddAccountForm`** — rejected: no e2e coverage exists
  to prove AC2 parity for its reset-on-success behavior, and authoring new e2e coverage to enable
  the migration is out of this feature's proportionate scope.
- **Couple FR-2 and FR-3 (adopt react-hook-form for `AuthForm` too, for consistency)** — rejected:
  no functional or validation-shape benefit at `AuthForm`'s call site; "one form-wiring style
  everywhere" is not itself a DRY-guard-rail concern (that rail targets repeated constants/
  literals/types/helpers, not component-authoring style), and forcing the migration purely for
  consistency is speculative scope creep CLAUDE.md rule 2 prohibits.
- **Add `zod` alongside `react-hook-form` per FR-4's literal text** — rejected: no validation gap
  it closes beyond native `required` at the one accepted call site; would either be inert or force
  new per-field UI that breaks AC2's "same validation messages" requirement.
- **Add the full `ui/form.tsx` shadcn primitive set per FR-4's literal text** — rejected: zero
  consumers would exercise `FormField`/`FormItem`/`FormLabel`/`FormMessage`; `CredentialFields`
  keeps its existing bare-`Input` rendering. Building it now is scaffolding ahead of demand.
- **Rewrite `CredentialFields` itself to consume `FormField`/`useFormContext` directly** —
  rejected: would need two different calling conventions for its two consumers (only one of which
  migrates), adding real typing/prop-design complexity recon.md flagged as the round-1 "strongest
  risk," for no behavioral gain over bridging `react-hook-form`'s `register()` at the call site.
- **Hand-author a local Alert-shaped wrapper for FR-1 now, ahead of sibling 120** — rejected: would
  create a second, likely-divergent "Alert" implementation 120 would later need to reconcile or
  replace; the audit itself rated this a loose match, and the soft dependency on 120
  (product-spec.md's own wording) permits declining regardless of 120's status.

## Open Risks

- [ ] **FR-2/FR-3 independence and the FR-4 narrowing (no zod, no ui/form.tsx) are provisional,
  not user-confirmed** — this session had no `AskUserQuestion` tool. Flag prominently to the user
  before `/sdd-spec` treats this as final; if the user disagrees with the FR-4 narrowing in
  particular (it changes what the product spec's FR-4 literally asked for), re-run this design
  phase's Phase 1 with the user's steer. To be addressed before `/sdd-execute` begins on FR-4.
- [ ] **`react-hook-form`'s exact API shape is unverified against the installed version** — recon.md
  confirms no version is pinned anywhere in the repo today (fresh install, not an upgrade).
  `/sdd-spec` must not write exact `useForm`/`register`/`handleSubmit` call instructions before the
  step that runs `pnpm add react-hook-form` and inspects what actually installed (ledger:
  `docs/roadmap/ledger/insights.md` 2026-08-05, `trader-chart-panel`). To be addressed in the
  `/sdd-spec` step that adds the dependency.
- [ ] **`EditCredentialsForm` is left with the pre-existing manual pattern while `AddAccountForm`
  (its sibling consumer of the same `CredentialFields`) moves to `react-hook-form`** — an
  intra-file inconsistency accepted deliberately (see Rejected Alternatives) but worth a one-line
  code comment at `EditCredentialsForm`'s definition noting why, so a future reader doesn't assume
  it was missed. To be addressed in the `/sdd-spec` step that migrates `AddAccountForm`.

## Constitution Rules Touched

- `C-11` — honored: this design phase (`/sdd-design` full mode, 2 rounds) ran before any
  implementation write, per the mandatory SDD entry point.
- `C-14` — honored: Chosen Approach states the consumer surface (`/trader` segment,
  already-reachable, no new routes) for every FR decision, migrate or decline.
- `C-12`/`C-13` — honored: no new test data literals proposed; `AddAccountForm`'s verification
  reuses the existing `e2e/trader/account-selector.spec.ts` spec and the existing
  `BROKER_ACCOUNT_*` fixtures (`e2e/fixtures/accounts.ts`, per `INVENTORY.md:14`) rather than
  declaring new inline literals.
- `P-01`/`P-02` — **not fully honored in the mechanical sense**: no `Task` tool was available to
  spawn isolated `design-proposer`/`design-adversary` subagents, so both roles were argued
  directly by the orchestrating session rather than by separate isolated agents. The two-round,
  propose→attack→synthesize structure was still followed in full (see `context.md` for the
  round-by-round record), preserving the spirit of the mediated-debate principle even though the
  literal subagent-isolation mechanism wasn't available.
- `P-04` — **not honored as a live user gate**: no `AskUserQuestion` tool was available. The
  approval below is the orchestrating session's own synthesis, not a recorded live user choice —
  flagged in Open Risks above and in the final report.
- `F-11` (Floor) — no Floor breach identified in either round. This is a client-side UI wiring
  change with no DB/proto/migration/direct-push surface.
