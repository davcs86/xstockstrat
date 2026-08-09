# Design: shadcn-migration-low-confidence

**Created**: 2026-08-08
**Rounds**: 3 (full; termination: approved — Round 3 is a user-directed override, see § Round 3
below, not a further adversarial round)
**Approved by**: Rounds 1–2 were an autonomous synthesis (no `AskUserQuestion`/`Task` tool
available that session — see the Round 1–2 history preserved in `context.md`). **Round 3 is a
live, recorded user decision**: the user was shown Round 2's narrower recommendation directly and
explicitly overrode it to migrate all three call sites onto the full recipe. This satisfies
Constitution **P-04** as a recorded user approval for FR-2/FR-3/FR-4 — the thing Round 2's Open
Risks flagged as missing. FR-1 is unaffected by the override (still declined; see below).
**Grounded in**: recon.md (including its 2026-08-08 Addendum, appended for this round)

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

**FR-2/FR-3 independence — SUPERSEDED by Round 3's user override.** Round 2 decided each
independently on its own complexity/duplication merits; the user has since explicitly directed
that all three call sites migrate together onto the same recipe, superseding that independence
reasoning outright (see § Round 3 below). The paragraph is kept here, struck by the override, so a
future reader can see the reasoning Round 2 actually used before the user changed the scope — it
is not itself wrong, it was simply overridden by a decision Round 2 didn't have the tool to solicit.

**FR-2 (`AuthForm.tsx:28-93`) — MIGRATE (Round 3 override; Round 2 had declined).** `CredentialsForm`
moves from `useState<string>` × 4 (`email`/`password`/`error`/`loading`) + manual `fetch` +
inline `<p>` error (`:87`) to `useForm()` + `Controller` + a `zod` schema
(`z.object({ email: z.string().email(...), password: z.string().min(1, ...) })` — see FR-4) +
`ui/field.tsx`'s `Field`/`FieldLabel`/`FieldError`. Concrete parity target: `error`/`loading` state
stays local to the component (`formState.isSubmitting` replaces manual `loading`, a submit-level
`setError` still needed for the `fetch` failure path since that's a network/server error, not a
field-validation error zod can express). Zero e2e DOM coverage today
(`e2e/auth.spec.ts` is API-only) means there is no existing characterization test at risk of
regressing, but also none to lean on for parity proof — Verification for this call site is a
manual/lint/build check plus the two existing API-level `auth.spec.ts` assertions (agnostic to the
form's internal implementation, per recon.md's FR-2 finding), not a new DOM e2e spec (the email/
password fields' only behavior today is native `required` + basic email format via `type="email"`,
which the zod schema's `.email()` reproduces one-for-one — no new user-visible behavior is
introduced that would need new coverage to characterize).

**FR-3 (`accountShared.tsx` `CredentialFields` + its two consumers) — MIGRATE BOTH (Round 3
override; Round 2 had migrated only `AddAccountForm`).**
- **`AddAccountForm` (`accountShared.tsx:259-332`) — MIGRATE**, unchanged from Round 2's reasoning:
  its internal state/submit wiring moves from `useState<CredentialState>` + manual
  `handleAddAccount` to `useForm()` + `Controller`. Concrete, testable justification:
  `e2e/trader/account-selector.spec.ts:63-92` ("Add Account form clears credential fields on
  success") already exercises exactly the reset-on-success behavior this migration must preserve —
  `form.reset()` replaces the manual `setDisplayName('')`/`setBrokerType('1')`/
  `setCreds(EMPTY_CREDENTIALS)` at `accountShared.tsx:285-287`, and the existing e2e spec proves
  parity without new test authoring.
- **`EditCredentialsForm` (`accountShared.tsx:116-167`) — MIGRATE (new under the override; Round 2
  had declined this consumer specifically for lack of e2e coverage).** The override does not waive
  AC2's "same submit flow" requirement, and Round 2's reason to decline — no e2e spec proves
  reset-on-success parity for this consumer — is still true today (recon.md's addendum
  re-confirms). **Decision: add a new characterization e2e test for `EditCredentialsForm` FIRST,
  as a preceding step, before migrating it** — a red-before-green safety net matching the
  TDD-gate escape-hatch pattern already used for `AddAccountForm` (capture-green-before-and-after
  on a behavior-preserving refactor), except here there is no existing green test to capture, so
  one must be authored before the refactor rather than merely re-run after it. This is the more
  conservative reading of root `CLAUDE.md` behavior 4 ("define success up front, then loop until
  verified") applied to a call site the design has already flagged, twice, as untested — migrating
  it with zero coverage in either direction would mean AC2's parity claim ships as an assertion,
  not a proof. The alternative (accept the risk, migrate anyway, no new test) was considered and
  rejected: this consumer directly submits a mutating gRPC call
  (`updateBrokerAccountCredentials`) that overwrites a live broker account's stored secrets, so an
  undetected reset-on-success regression would silently leave stale credentials in the form state
  visible to the next user interaction — a correctness-with-user-visible-consequence risk, not a
  cosmetic one, which crosses the line from "disproportionate to add new test surface" (Round 2's
  reasoning, when the call site was out of scope entirely) to "necessary before touching a
  live-secrets submit path" (now that the user has put it in scope). The new test mirrors
  `account-selector.spec.ts:63-92`'s shape: navigate to an account row, click "Edit keys"
  (`AccountRow.tsx`'s existing toggle at `accountShared.tsx:215-217`), fill the broker's credential
  fields, submit, and assert the fields are cleared (mock `UpdateBrokerAccountCredentials` per
  `e2e/mock-backend.ts:199`'s existing handler name, reusing `BROKER_ACCOUNT_ALPACA`/
  `BROKER_ACCOUNT_IBKR` fixtures already registered in `INVENTORY.md:14` — no new fixture).
- **`CredentialFields` itself (`accountShared.tsx:51-113`) is unchanged**, exactly as Round 2
  decided and the user's override did not touch: it stays a plain controlled-input component
  (`value`/`onChange` props); both consumers bridge it to `react-hook-form` via `Controller` at
  their own call site, not by making `CredentialFields` itself context-aware. This still resolves
  recon.md's flagged "strongest risk" (a `CredentialFields` rewrite needing two different calling
  conventions) — migrating both consumers now removes the *reason* that risk existed (only one
  consumer migrating), but the mitigation (keep `CredentialFields` a dumb controlled component) is
  worth keeping regardless, since `CredentialFields` has no submit/validation concerns of its own
  to move onto `react-hook-form` — only its two consumers do.

**FR-4 — triggers at the product spec's originally-intended breadth, but the primitive itself is
corrected: `react-hook-form` + `zod` + `@hookform/resolvers/zod` + `ui/field.tsx` (NOT
`ui/form.tsx`).**
- **`zod` IS added** (reversing Round 2's decline). With all three call sites now migrating,
  `AuthForm`'s email-format check (`type="email"` today has no explicit validation beyond browser
  native email-format checking) and `accountShared.tsx`'s two broker-conditional required-field
  sets both get expressed as schemas: `z.object({ email: z.string().email(msg), password:
  z.string().min(1, msg) })` for `AuthForm`; a per-broker-branch schema for `CredentialFields`'
  consumers (`{ apiKey: z.string().min(1, msg), apiSecret: z.string().min(1, msg) }` for Alpaca,
  `{ consumerKey, accessToken, accessTokenSecret, ibkrAccountId }` each `z.string().min(1, msg)`
  for IBKR — accountShared.tsx:20-27's `CredentialState` fields, IBKR branch confirmed 4 fields at
  `:62-94`, Alpaca branch 2 fields at `:96-112`). Every schema is scoped to
  required-string-equivalent checks only — **no stricter validation than what exists today**
  (native `required` per field, `type="email"` for `AuthForm`'s email input) — per AC2's "same
  validation messages, same submit flow" and this task's explicit validation-summary constraint.
- **`@hookform/resolvers/zod` IS added** — the glue package (`zodResolver`) wiring a `zod` schema
  into `useForm`'s `resolver` option; confirmed as a separate install target (not a transitive
  dependency of either `react-hook-form` or `zod` alone) from the live install command at
  `https://ui.shadcn.com/docs/forms/react-hook-form` (recon.md's 2026-08-08 addendum). Three
  packages total, not the two product-spec.md's original FR-4 text named.
- **`ui/field.tsx` is added — NOT `ui/form.tsx`.** Verified live (WebFetch, 2026-08-08,
  `https://ui.shadcn.com/docs/components/field`): shadcn's current recommended primitive is
  `Field`/`FieldLabel`/`FieldContent`/`FieldDescription`/`FieldError`/`FieldGroup`/`FieldSet`/
  `FieldLegend`/`FieldTitle`/`FieldSeparator` — framework-agnostic (works with plain `useState`,
  react-hook-form, TanStack Form, or Formisch), not the older `Form`/`FormField`/`FormItem`/
  `FormLabel`/`FormControl`/`FormMessage` set wired to `useFormContext` that product-spec.md's
  original FR-4 text named (that set is shadcn's *older* pattern; recon.md's addendum has the full
  citation trail). The react-hook-form integration guide
  (`https://ui.shadcn.com/docs/forms/react-hook-form`) uses `Controller`/`useForm` directly from
  `react-hook-form`, combined with `Field`/`FieldLabel`/etc., rather than a `FormField`-wraps-
  `useFormContext` indirection layer. All three call sites render `Field`/`FieldLabel`/
  `FieldError` around their existing `Input`s — this is genuinely new per-field label/error markup
  (unlike Round 2's declined scope, where the one accepted call site rendered no such markup), but
  it is markup `ui/field.tsx`'s own docs describe as the minimal usage shape, not an
  over-engineered addition — and AC2's "same validation messages" is satisfied by the messages
  themselves staying the same text (e.g. the browser's native "required" message text is
  replaced 1:1 by a zod message string with equivalent wording), not by there being zero visible
  error UI. Structural precedent: `ui/select.tsx` (compound, `radix-ui` import, `data-slot`
  per sub-part, no `forwardRef`) — `ui/field.tsx` should match that shape, not shadcn's classic
  `forwardRef` template (recon.md addendum).
- Version: per the ledger trap below, `/sdd-spec`/`/sdd-execute` pin and verify all three packages'
  installed API shape only after `pnpm add react-hook-form zod @hookform/resolvers/zod` actually
  runs — instructions do not assert exact `useForm`/`Controller`/`zodResolver` call signatures
  against assumed documentation before that (ledger 2026-08-05, `trader-chart-panel`).

**Consumer surface (C-14):** all of the above reaches the `xstockstrat-ui` `/trader` segment
(`AddAccountForm`/`EditCredentialsForm`, account management panel and full accounts page) and the
root `/auth/login` + OAuth agent-authorize pages (`AuthForm`'s `CredentialsForm`) —
already-shipped, already-reachable UI; no new routes, no nav registration needed (C-10(a) does not
apply). `OrderForm`/`EditOrderDialog` (FR-1) remain declined, unaffected by the override.

**Regression-test shape**: all three migrated components are JSX with a `useForm` hook, not
`cva()`-variants functions — none fit the `button.test.ts`/`badge.test.ts` pattern (recon.md's
flagged test-shape gap, still true even with `zod` schemas added, since the schemas are inline
per-component, not separately exported pure-logic modules worth a `.test.ts` file on their own).
Verification is e2e, per call site: `AddAccountForm` reuses the existing
`e2e/trader/account-selector.spec.ts:63-92` spec (AC2 parity, unmodified assertion);
`EditCredentialsForm` gets its **new** characterization e2e spec (added before its migration step,
per the decision above) re-run after migrating; `AuthForm` has no DOM e2e today and none is added
(no new user-visible behavior to characterize, per the FR-2 rationale above) — its existing
`e2e/auth.spec.ts` API-level assertions plus `pnpm lint`/`pnpm build` are its verification, per
AC5.

## Rejected Alternatives

- **~~Migrate `EditCredentialsForm` alongside `AddAccountForm`~~ — Round 2 rejection, OVERRULED by
  Round 3.** Round 2's stated reason (no e2e coverage exists to prove AC2 parity, and authoring new
  coverage is out of this evaluate-then-decide feature's proportionate scope) no longer applies:
  the user's override put this consumer in scope, and the "authoring new coverage is
  disproportionate" calculus flips once a live-secrets-mutating submit path is actually being
  migrated (see § FR-3 above) — the new e2e test is now a prerequisite, not an out-of-scope
  nice-to-have.
- **~~Couple FR-2 and FR-3 (adopt react-hook-form for `AuthForm` too, for consistency)~~ — Round 2
  rejection, OVERRULED by Round 3.** Round 2's "no functional benefit, consistency alone isn't a
  DRY concern" reasoning was sound for an autonomous design decision; it is superseded by an
  explicit user directive, which is a stronger reason than either "consistency" or "DRY" alone —
  P-04 user approval is not something an adversarial design round can out-argue.
- **~~Add `zod` alongside `react-hook-form` per FR-4's literal text~~ — Round 2 rejection,
  OVERRULED by Round 3.** Round 2's "no validation gap it closes beyond native `required`" was
  true and remains true (this feature does not add stricter validation than exists today — see
  § FR-4 above); it's added anyway now because the user directed the full recipe, and a `zod`
  schema expressing the *same* required/format checks as today's native `required`/`type="email"`
  is not itself a validation-shape change, only a wiring change.
- **~~Add the full `ui/form.tsx` shadcn primitive set per FR-4's literal text~~ — Round 2
  rejection, still correctly rejected, but for a different reason now.** Round 2 rejected it
  because zero consumers would exercise it; that's moot once the override adds three consumers.
  It stays rejected because it's **the wrong primitive** — verified live that shadcn's current
  primitive is `ui/field.tsx`, not `ui/form.tsx` (recon.md addendum, § Round 3 below). `ui/form.tsx`
  is not being built under any scope, migrated or not.
- **Rewrite `CredentialFields` itself to consume `Controller`/`useFormContext` directly** —
  still rejected, now on cleaner grounds: with both consumers migrating there's no longer a
  "two different calling conventions" problem (Round 1's original objection), but there's also no
  new reason to add one — `CredentialFields` has no submit/validation logic of its own to move
  onto `react-hook-form`, only its two consumers do, so making it context-aware would add an
  indirection layer with no consumer needing it directly (both bridge via `Controller` at their
  own call site instead).
- **Hand-author a local Alert-shaped wrapper for FR-1 now, ahead of sibling 120** — still rejected,
  unaffected by the override (FR-1 is not part of the user's directive): would create a second,
  likely-divergent "Alert" implementation 120 would later need to reconcile or replace; the audit
  itself rated this a loose match, and the soft dependency on 120 (product-spec.md's own wording)
  permits declining regardless of 120's status.
- **Migrate `EditCredentialsForm` without adding new e2e coverage first (accept the risk)** —
  rejected (Round 3, new alternative): considered as the minimal-diff option once the override put
  this consumer in scope, but rejected because `EditCredentialsForm` submits a mutating call
  (`updateBrokerAccountCredentials`) against live broker credentials with zero existing
  characterization coverage in either direction — shipping AC2's "same submit flow" claim
  completely unverified for a secrets-mutation path is a correctness risk root CLAUDE.md's
  "define success up front, then loop until verified" behavior argues against accepting silently.

## Round 3 — user-directed override

Round 2 (`context.md`'s Phase 1 record) concluded, autonomously, a narrower scope than the product
spec's literal FR-2/FR-3/FR-4 text: decline `AuthForm`, migrate only `AddAccountForm` (not its
sibling `EditCredentialsForm`), and narrow FR-4 to `react-hook-form` alone (no `zod`, no
`ui/form.tsx`). That round's own Open Risks flagged this explicitly as **provisional** — the
session had no `AskUserQuestion` tool, so nothing in Round 2 was a recorded live user choice under
Constitution **P-04**.

Two things changed since Round 2, both grounded before this section cites them:

1. **The user was asked directly and overrode the narrowing.** Shown Round 2's recommendation, the
   user explicitly directed: migrate all three call sites (`AuthForm.tsx`, `AddAccountForm`, and
   `EditCredentialsForm` within `accountShared.tsx`) onto the full shadcn Form recipe. This is not
   this design phase re-arguing itself to a different conclusion — the adversarial reasoning in
   Round 1/2 was sound for an autonomous design decision made without the ability to ask; a direct
   user instruction is categorically a stronger signal than an adversarial round's own risk
   calculus, and per this repo's root behavior 1 ("don't assume — ask, and surface tradeoffs"),
   once asked, the answer governs. FR-1 (`OrderForm.tsx`/`EditOrderDialog.tsx`, declined) is
   unaffected — the user's directive names only the three Form-shaped call sites, not the two
   Alert-shaped ones.
2. **The primitive itself changed out from under the product spec.** Independent of the user's
   scope override, a live verification (WebFetch, 2026-08-08, against
   `https://ui.shadcn.com/docs/components/field` and
   `https://ui.shadcn.com/docs/forms/react-hook-form`) found that shadcn's currently-recommended
   Form-adjacent primitive is `ui/field.tsx` (`Field`/`FieldLabel`/`FieldDescription`/`FieldError`/
   etc., framework-agnostic) combined with `Controller`/`useForm` used directly from
   `react-hook-form` — not the `ui/form.tsx`/`Form`/`FormField`/`FormItem`/`FormControl`/
   `FormMessage`-wraps-`useFormContext` primitive product-spec.md's original FR-4 text named. That
   older pattern is still real (shadcn's docs still describe it as a supported pattern), but it is
   not the one shadcn's own docs currently lead with, and there is no reason to build the
   *older* primitive when this feature is adding the dependency fresh (recon.md's addendum has the
   full citation trail; the evidence was appended there before design.md — this section — cites
   it, per this repo's "ground before you write" convention). This finding is independent of the
   user's scope override — it would apply even if the user had kept Round 2's narrower FR-2/FR-3
   scope, because it corrects the product spec's own factual premise about which primitive exists,
   not the question of how many call sites should use it.

Both changes are folded into a single Round 3 rather than run as a fresh adversarial round: the
scope question was settled by direct user instruction (nothing left to debate), and the primitive
question was settled by live documentation verification (a factual correction, not a design
tradeoff). Constitution **P-04** is satisfied for FR-2/FR-3/FR-4 as of this round — no further
`AskUserQuestion` gate is needed before `/sdd-spec`/`/sdd-execute` proceed on the new scope, though
the `EditCredentialsForm` e2e-coverage sequencing decision (§ FR-3 above) should still be surfaced
in the PR description as a design choice the user did not separately confirm.

## Open Risks

- [x] ~~FR-2/FR-3 independence and the FR-4 narrowing are provisional, not user-confirmed~~ —
  **resolved by Round 3**: the user was asked directly and overrode the narrowing. See § Round 3.
- [ ] **`react-hook-form`/`zod`/`@hookform/resolvers/zod`'s exact API shapes are unverified
  against the installed versions** — recon.md confirms no version is pinned anywhere in the repo
  today for any of the three (fresh install, not an upgrade). `/sdd-execute` must not write exact
  `useForm`/`Controller`/`zodResolver` call instructions before the step that runs `pnpm add
  react-hook-form zod @hookform/resolvers/zod` and inspects what actually installed (ledger:
  `docs/roadmap/ledger/insights.md` 2026-08-05, `trader-chart-panel`). To be addressed in the
  dependency-install step.
- [ ] **`ui/field.tsx`'s exact export shape/props are unverified against what `npx shadcn@latest
  add field` actually generates** — the WebFetch verification confirms the export *names*
  (`Field`, `FieldLabel`, `FieldDescription`, `FieldError`, etc.) and that the primitive is
  framework-agnostic, but not byte-exact prop signatures; `/sdd-execute` should run the CLI add
  command and read the generated file rather than hand-author `ui/field.tsx` from the docs
  snippet alone, consistent with this codebase's existing `npx shadcn@latest add <name>` workflow
  (`services/xstockstrat-ui/CLAUDE.md` § Styling). To be addressed in the `ui/field.tsx` step.
- [ ] **`EditCredentialsForm`'s new characterization e2e test must land and pass BEFORE its
  migration step, not alongside it** — this is the red-before-green safety net decided in § FR-3
  above; sequencing it as a genuinely separate, earlier step (not folded into the same commit/PR
  as the migration) is what makes it a real characterization test rather than a test written to
  match the already-migrated code. To be addressed by `/sdd-spec`'s step ordering.
- [ ] **`AuthForm`'s migration has no e2e safety net in either direction** (unchanged from before
  the override — recon.md confirms `e2e/auth.spec.ts` is API-only) — accepted deliberately (see
  § FR-2 above: no new user-visible behavior is introduced that would need new coverage), but if a
  reviewer disagrees, adding a minimal DOM-level e2e spec for the login form is the fallback,
  flagged here rather than silently assumed sufficient.

## Constitution Rules Touched

- `C-11` — honored: this design phase (`/sdd-design` full mode, Rounds 1–2, plus the Round 3
  user-directed override recorded here) ran before any implementation write, per the mandatory SDD
  entry point.
- `C-14` — honored: Chosen Approach states the consumer surface (`/trader` segment plus the root
  `/auth/login` + OAuth agent-authorize pages, all already-reachable, no new routes) for every FR
  decision, migrate or decline.
- `C-12`/`C-13` — honored: `AddAccountForm`'s verification reuses the existing
  `e2e/trader/account-selector.spec.ts` spec and the existing `BROKER_ACCOUNT_*` fixtures
  (`e2e/fixtures/accounts.ts`, per `INVENTORY.md:14`); `EditCredentialsForm`'s new
  characterization e2e test (§ FR-3) also reuses those same canonical fixtures — no new inline
  literals proposed for either.
- `P-01` — **fully honored throughout**: the orchestrating session held sole write/commit/branch
  authority in every round; no subagent ever wrote to a file. (Corrected 2026-08-09 — an earlier
  version of this bullet lumped P-01 in with P-02's real gap below; P-01 itself was never at risk.)
- `P-02` — **Rounds 1–2 not fully honored in the mechanical sense**: no `Task` tool was available to
  spawn isolated `design-proposer`/`design-adversary` subagents, so both roles were argued directly
  by the orchestrating session instead of two genuinely isolated agents. The two-round,
  propose→attack→synthesize structure was still followed in full (see `context.md`). Round 3 is not
  an adversarial round (see above), so P-02 doesn't apply to it either way.
- `P-04` — **now honored** for FR-2/FR-3/FR-4: Round 3 is a live, recorded user decision that
  overrides Round 2's autonomous synthesis. This is exactly the kind of confirmation Round 2's own
  Open Risks flagged as missing (the prior version of this file said "not honored as a live user
  gate" — that gap is what Round 3 closes for these three FRs; FR-1's "decline" call remains a
  Round 1/2 self-run synthesis, not a live-gated one). **Note (2026-08-09 cross-check audit)**: P-04
  also requires the phase-gate transition be recorded as a `feature.md` Status History row, not only
  a `context.md` session entry — `feature.md`'s history table was missing the
  `design-approved → implementation-ready` row the `/sdd-spec` session's `context.md` entry
  describes; added retroactively (see `feature.md`).
- `P-06` (red-before-green) — **honored, and previously uncited despite being this design's central
  mechanism**: Step 4 (a new characterization test, proven green against pre-migration code) gates
  Step 7 (`EditCredentialsForm`'s migration) — the `tdd-gate.md` refactor escape hatch, cited by name
  11 times across `design.md`/`implementation-spec.md`, is precisely P-06's documented alternative
  to literal red-then-green for a behavior-preserving change. Added to this list 2026-08-09 (round-4
  cross-check audit finding) — the reasoning was always correct, only the ID citation was missing.
- `F-11` (Floor) — no Floor breach identified in either round. This is a client-side UI wiring
  change with no DB/proto/migration/direct-push surface.
