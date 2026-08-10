# Recon: shadcn-migration-low-confidence

**Created**: 2026-08-08
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Evaluate 4 low-confidence shadcn/ui-gap-audit findings in `xstockstrat-ui` — two one-line inline
success/error paragraphs loosely shaped like `Alert` (`OrderForm.tsx`, `EditOrderDialog.tsx`), and
two manually-wired forms loosely shaped like shadcn's `Form` recipe (`AuthForm.tsx`'s
`CredentialsForm`; `accountShared.tsx`'s `CredentialFields` and its two consumers) — and migrate
only where the primitive earns its cost, recording an explicit decision either way.

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15 / TypeScript, Node 22)
  - Preset config: `services/xstockstrat-ui/components.json` — `"style": "radix-rhea"` (preset
    `bLTl5gh6`, feature 119). Styling conventions: `services/xstockstrat-ui/CLAUDE.md:24-58`.
  - `ui/` primitive inventory today (`ls services/xstockstrat-ui/src/components/ui/`):
    `badge, button, card, combobox, input-group, input, select, separator, sheet, skeleton, table,
    textarea, utils` + `badge.test.ts`/`button.test.ts`. **No `alert.tsx` and no `form.tsx`
    exist** — confirmed absent, matches the audit.
  - **Component shape convention (post-119, confirmed 3 files)**: `ui/input.tsx` — plain
    `function Input({ className, type, ...props }: React.ComponentProps<'input'>)`, `data-slot`
    prop, `cn()` from `@/components/ui/utils`; `ui/button.tsx:7-44` — `cva()` variants object with
    `// app-specific` comments marking hand-added functional variants (`buy`/`sell`), plain
    function component (no `React.forwardRef`, no `.displayName`) at `button.tsx:46+`. Any new
    primitive this feature adds (`ui/form.tsx`, if FR-4 triggers) must match this shape, not the
    classic shadcn `forwardRef` template.
  - **Vitest test pattern (confirmed via `vitest.config.ts`)**: `environment: 'node'`,
    `include: ['src/**/*.test.ts']` (note: `.test.ts`, **not** `.test.tsx`) — no jsdom, no
    `@testing-library/react`. `ui/button.test.ts`/`badge.test.ts` are pure logic assertions on the
    exported `cva` variants function (`expect(buttonVariants({ variant: 'buy' })).toContain(...)`).
    **Risk this raises for FR-4** (see Risks below): `Form`/`FormField`/`FormControl` are thin JSX
    wrappers around `react-hook-form`'s `useFormContext` with no `cva()` variants of their own —
    there is no obvious `.test.ts`-shape logic to assert the way `button.test.ts` does.
  - `services/xstockstrat-ui/vitest.config.ts:9-14` already sets `resolve.alias: { '@': './src' }`
    — the `@/...`-alias Vitest-resolution trap from feature 119 (ledger insight below) is already
    fixed in trunk; a `ui/form.tsx` using `@/components/ui/utils`-style imports would resolve fine.

### FR-1 call sites (Alert-shaped)

- `OrderForm.tsx:215-217` — `{message && (<p className={...isErrorMsg ? 'text-destructive' :
  'text-buy'}>{message}</p>)}`. Citation confirmed exact.
- `EditOrderDialog.tsx:82` — `{error && <p className="text-xs text-destructive">{error}</p>}`.
  Citation confirmed exact.
- **`ui/alert.tsx` does not exist in trunk today.** Sibling `120-shadcn-migration-high-confidence`
  (status `spec-ready`, not yet `code-completed`/`launched`) is the feature that would add it
  (its FR-1–FR-4/FR-7–FR-9 batch of 8 new primitives includes Alert). FR-1's "adopt if 120 has
  shipped" condition is currently **not satisfied** — 120 has not shipped.
- e2e coverage of these two message paragraphs: `e2e/trader/order-form.spec.ts:77,80,100` use
  `page.getByText(/Order placed:.*FILLED/)`, `getByText(/qty 5, stop 148.25/)`,
  `getByText('Insufficient buying power')` — **text-content matchers**, not role/testid. A boxed
  `Alert` wrap that preserves the exact rendered text would not break these, but a decision to
  decline (keep the plain `<p>`) is zero-risk by construction. No e2e spec found for
  `EditOrderDialog.tsx`'s error text specifically (targeted, non-exhaustive grep).

### FR-2 call site (Form-shaped, AuthForm)

- `AuthForm.tsx:28-93` — `CredentialsForm` (`useState` for `email`/`password`/`error`/`loading`,
  manual `fetch('/api/auth/login')`, inline `{error && <p className="text-sm text-destructive">
  {error}</p>}` at `:87`). Citation range `28-93` is exact (function starts line 28, file ends at
  line 93 = function's closing brace).
- **e2e coverage**: `e2e/auth.spec.ts` tests only `POST /api/auth/login` directly
  (`page.request.post(...)`) — no DOM interaction with the login page's `<form>`. Grepped every
  spec mentioning `auth/login`/`AuthForm`/`CredentialsForm` across `e2e/**/*.spec.ts`; every hit
  outside `auth.spec.ts` is a redirect-URL assertion, not a form-field selector. **Zero DOM-level
  e2e risk for a `Form`-library migration here** — AC5's "e2e passes for every spec covering a
  touched component" resolves to `auth.spec.ts`'s two API-level tests, which are agnostic to the
  form's internal implementation.

### FR-3 call site (Form-shaped, accountShared)

- `accountShared.tsx:39-48` — `buildCredentialsJson(brokerType, creds)`, pure builder, no submit
  handler.
- `accountShared.tsx:51-113` — `CredentialFields({ brokerType, creds, onChange })`, pure
  field-rendering component (controlled inputs via `onChange` callback), no submit handler. Two
  branches: `BrokerType.IBKR` (4 fields: Consumer Key, Access Token, Access Token Secret, IBKR
  Account ID) and the Alpaca default (2 fields: API Key, API Secret). Confirmed against
  `packages/proto/common/v1/common.proto:64-67` — only two `BrokerType` values exist
  (`BROKER_TYPE_ALPACA = 1`, `BROKER_TYPE_IBKR = 2`), both handled.
- **Two independent consumers, each with its own submit handler** (this refines the product spec's
  original FR-3 wording, already fixed during `/sdd-review` — see `context.md`):
  - `EditCredentialsForm` (`accountShared.tsx:116-167`) — calls `CredentialFields` at `:155`,
    submits via `tradingClient.updateBrokerAccountCredentials` at `:143-146`, resets state to
    `EMPTY_CREDENTIALS` on success (`:147`).
  - `AddAccountForm` (`accountShared.tsx:259-332`) — calls `CredentialFields` at `:325-329`,
    submits via `tradingClient.registerBrokerAccount` at `:271-275`, resets state to
    `EMPTY_CREDENTIALS` on success (`:284`).
- **Load-bearing e2e finding**: `e2e/trader/account-selector.spec.ts:63-92` — test `"Add Account
  form clears credential fields on success"` fills `getByPlaceholder('Display name')`,
  `getByPlaceholder('API Key')`, `getByPlaceholder('API Secret')`, submits, then asserts
  `getByPlaceholder('API Key')` has value `''` (`:92`). This is exactly the manual
  `setCreds(EMPTY_CREDENTIALS)` reset behavior. A `react-hook-form` migration of `AddAccountForm`
  must replicate this via `form.reset()` (or equivalent) — a concrete, testable parity requirement
  for AC2 ("same submit flow"), not just a general caution. `e2e/trader/account-selector.spec.ts:59-60`
  also asserts `getByRole('heading', { name: 'Add Account' })` — unaffected by a Form-library swap.
  No equivalent e2e spec found for `EditCredentialsForm`'s "Edit keys" flow specifically (targeted
  grep; `account-selector.spec.ts` and `orders.spec.ts` were the only account-form-adjacent specs
  found).

## Patterns to REUSE

- Existing `ui/input.tsx`, `ui/button.tsx` — all four call sites already use these; a `Form`
  migration wraps them in `FormControl`, it does not replace them.
- `ui/select.tsx` (function-component + `data-slot`, no `forwardRef`) is the most structurally
  similar existing primitive to what `ui/form.tsx` would be — a controlled/context-driven
  compound component. Model `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage`
  on that same function-component + `data-slot` shape, per the confirmed post-119 convention
  above (not shadcn's classic `forwardRef` template).
- `ui/button.test.ts`/`badge.test.ts` pattern for FR-4's mandated regression test, **if** the
  primitive has `cva()`-shaped logic to assert — flagged as an open design question below because
  `Form` primitives typically don't.
- Test-data inventory (`e2e/fixtures/INVENTORY.md:14`): `BROKER_ACCOUNT_ALPACA`,
  `BROKER_ACCOUNT_IBKR`, `BROKER_ACCOUNT_NEW` (`e2e/fixtures/accounts.ts`) are the canonical
  fixtures already used by `account-selector.spec.ts` — any new/modified e2e assertion for FR-3
  reuses these (Constitution **C-12**), not new inline literals.
- Auth helpers: `e2e/helpers/auth.ts` (`addAuthCookie`, etc.) — already used by every spec; no new
  auth helper needed for FR-2/FR-3 test changes.

## Dependencies

- Proto/RPC: none. `BrokerType` enum (`packages/proto/common/v1/common.proto:64-67`) is read-only
  reference for FR-3, not modified.
- Migration: none.
- Config keys: none.
- Inter-service edges: none — this feature only re-wires client-side form state/validation and
  rendering; `tradingClient.updateBrokerAccountCredentials`/`registerBrokerAccount`,
  `/api/auth/login`, and `tradingClient.placeOrder`/`updateOrder` calls are unchanged (AC2).
- New dependencies (conditional on FR-4): `react-hook-form`, `zod`. Confirmed absent from
  `services/xstockstrat-ui/package.json` and from every file under `services/xstockstrat-ui/src`
  (`grep -rn "react-hook-form\|from 'zod'\|\"zod\"" services/xstockstrat-ui/src
  services/xstockstrat-ui/package.json` — zero matches, resolved as part of `/sdd-review`). No
  version currently pinned anywhere in the repo for either package.
- New env vars / ports: none.

## Risks / Not-found

- **FR-1's soft dependency on 120 is currently unmet.** `120-shadcn-migration-high-confidence` is
  `spec-ready`, not `code-completed`/`launched` — `ui/alert.tsx` does not exist in trunk. FR-1 can
  (per product-spec's own wording) decline regardless of 120's status; this is not a hard blocker,
  but if this feature's design/implementation lands before 120's, FR-1's only real option today is
  "decline, or hand-author a minimal `Alert`-shaped wrapper duplicating what 120 will later add" —
  the latter is exactly the kind of near-term duplication the audit and DRY guard rail exist to
  avoid. Flagging as a design input, not resolving it myself.
- **FR-4 test-shape gap**: no existing `.test.ts` precedent exists for a compound-context primitive
  with no `cva()` variants (`Form`/`FormField`/`FormControl`/`FormMessage` are pure JSX/context
  wrappers). If FR-4 triggers, `/sdd-spec` needs a concrete answer for what the mandated regression
  test (mirroring `button.test.ts`) actually asserts — or an explicit decision that no meaningful
  `ui/form.test.ts` exists and coverage instead comes from the (already-required) e2e/manual parity
  check on the migrated call site(s).
- **Ledger trap (`docs/roadmap/ledger/insights.md`, 2026-08-05 — "trader-chart-panel — reuse")**:
  "A spec was written against a library's documented (newer) API before the dependency was
  actually installed; the installed version resolved to an older major with a different API
  surface" (evidence: feature `014-trader-chart-panel`, v5 API spec'd vs. v4.2.3 shipped). "Rule it
  implies: when a spec step adds a new npm dependency, defer exact API-call instructions until
  after that dependency is actually installed (or pin the version and verify its API before
  drafting code)." Directly applicable to FR-4 — `/sdd-spec` must not write exact
  `react-hook-form`/`zod` API call instructions (e.g. `useForm`, `zodResolver`, `z.object(...)`
  shape) before the step that runs `pnpm add react-hook-form zod` and pins a version. No version is
  pinned anywhere in this repo today for either package — this is a fresh install, not an upgrade,
  so the risk is "spec assumes an API shape that doesn't match whatever `pnpm add` resolves,"
  not a major-version mismatch specifically.
- **Ledger trap (`docs/roadmap/ledger/insights.md`, 2026-08-08 — "shadcn-ui-migration — reuse",
  Vitest `@/*` alias)**: already mitigated in trunk (`vitest.config.ts:9-14` — confirmed above),
  but any newly-added `.test.ts` file should still be run as part of the full Vitest suite (not
  just the new file) per that entry's own rule, since the failure mode surfaces on an unrelated
  file's import graph.
- **No `## Not found` gaps** — all four call sites, their consumers, and their e2e coverage were
  located and cited above.

## Recommended Scope

Advisory step grouping (not binding — `/sdd-design` Phase 1 and `/sdd-spec` decide final shape):

1. FR-1 (Alert evaluation, `OrderForm.tsx`/`EditOrderDialog.tsx`) is independent of FR-2/FR-3/FR-4
   — no shared dependency, can be scoped/decided/executed on its own regardless of the other
   three's outcome.
2. FR-2 (`AuthForm.tsx`) and FR-3 (`accountShared.tsx`) both feed the FR-2/FR-3-independence
   question product-spec.md explicitly routes to this design phase — Phase 1 should resolve
   that fork before either FR-2 or FR-3's own migrate/decline decision is finalized, since the
   fork's outcome determines whether FR-4 (and its two new dependencies) triggers at all, and for
   how many of FR-3's two consumers.
3. If FR-4 triggers, sequence it as: (a) add dependencies + pin versions, (b) verify installed API
   shape against docs, (c) author `ui/form.tsx` + resolve the test-shape gap above, (d) migrate the
   accepted call site(s) — each of FR-2's one consumer and/or FR-3's two consumers
   (`EditCredentialsForm`, `AddAccountForm`) is independently migratable once `ui/form.tsx` exists,
   so they can be separate steps with their own e2e/manual verification (`AddAccountForm`'s
   `form.reset()`-on-success parity is the one concretely testable behavior to verify per the
   `account-selector.spec.ts:92` finding above).

## Addendum 2026-08-08 — user override + primitive correction (post-design Round 2)

Appended after Round 2's design was already approved (provisionally) and after the calling session
put the FR-2/FR-3/FR-4 narrowing in front of the user directly (this session had no
`AskUserQuestion` tool available; the follow-up did). Two independent findings, both grounded before
`design.md`'s Round 3 cites them:

**1. User-directed scope override (explicit, not inferred).** The user was shown Round 2's
narrower recommendation (decline `AuthForm`, migrate only `AddAccountForm`, `react-hook-form` only —
no `zod`/`ui/form.tsx`) and **explicitly overrode it**: migrate all three call sites
(`AuthForm.tsx`'s `CredentialsForm`, `accountShared.tsx`'s `AddAccountForm`, and
`accountShared.tsx`'s `EditCredentialsForm`) onto the full recipe (react-hook-form + zod + the
shadcn Form/Field primitive). This satisfies Constitution **P-04** as a live, recorded user
decision — the thing Round 2's Open Risks flagged as missing. It supersedes Round 2's FR-2/FR-3
narrowing outright; it does not touch FR-1 (`ui/alert.tsx` still doesn't exist in trunk, unaffected
by this override).

**2. The shadcn `Form` primitive shadcn recommends today is not `ui/form.tsx`.** Verified live
(WebFetch, 2026-08-08) against shadcn's own docs site:

- `https://ui.shadcn.com/docs/components/field` — the current primitive is **`ui/field.tsx`**,
  exporting `Field`, `FieldLabel`, `FieldContent`, `FieldDescription`, `FieldError`, `FieldGroup`,
  `FieldSet`, `FieldLegend`, `FieldTitle`, `FieldSeparator`. It is explicitly **framework-agnostic**
  — documented as working with plain `useState`, react-hook-form, TanStack Form, or Formisch — unlike
  `ui/form.tsx`'s `FormField`-wraps-`useFormContext` indirection, which is react-hook-form-specific.
  Basic usage renders `Field` > `FieldLabel`/`Input`/`FieldDescription`, no context provider needed
  for the non-RHF case.
- `https://ui.shadcn.com/docs/forms/react-hook-form` — the react-hook-form integration guide uses
  `Controller`/`useForm`/`useFieldArray` **directly from `react-hook-form`**, combined with the
  `Field` family above, rather than a `Form`/`FormField` wrapper layer. Install command:
  `npm install react-hook-form zod @hookform/resolvers/zod` — **three** packages, not the two
  (`react-hook-form` + `zod`) product-spec.md's original FR-4 text anticipated.
  `@hookform/resolvers/zod` is the glue package (`zodResolver`) connecting `useForm`'s `resolver`
  option to a `zod` schema; it is not a transitive dependency of either `react-hook-form` or `zod`
  alone.
- **Conclusion**: `product-spec.md`'s FR-4, which names `Form`/`FormField`/`FormItem`/`FormLabel`/
  `FormControl`/`FormMessage` wired to `useFormContext`, describes shadcn's **older** pattern.
  `design.md`'s Round 3 targets `ui/field.tsx` + `Controller`/`useForm` instead, and
  `product-spec.md`'s FR-4 text is corrected in place (not silently diverged from) to match this
  verified-current reality, per this repo's "fix the spec, don't paper over drift" convention.
- Structural precedent for `ui/field.tsx`'s compound shape (same reasoning as before, now
  re-confirmed): `ui/select.tsx` (compound, `radix-ui` package import, `data-slot="select-*"` per
  sub-part, no `forwardRef`) is the closest existing shape in this codebase — `ui/field.tsx` should
  match it, not shadcn's classic `forwardRef` template. `ui/input.tsx` (plain function, `data-slot`,
  `cn()`, no `forwardRef`) is the precedent for individual field controls staying as they are.

**3. `EditCredentialsForm` e2e coverage gap — still unresolved as of this addendum.** Round 2's
finding stands: `account-selector.spec.ts` and `orders.spec.ts` are the only account-form-adjacent
specs, and neither drives `EditCredentialsForm`'s "Edit keys" flow. Now that the user has overridden
scope to include this consumer, `design.md`'s Round 3 must decide explicitly whether to add a new
characterization e2e test for it before migrating (red-before-green safety net matching the
TDD-gate escape-hatch pattern already used for `AddAccountForm`) or accept the risk — this is not
resolved by the override itself, which only settled *whether* to migrate, not *how safely*.

No new dependencies, proto, config, or DB findings beyond what the original recon.md sections above
already established — this addendum is scoped to the override and the primitive correction only.
