# Implementation Spec: shadcn-migration-low-confidence

**Status**: `pending`
**Created**: 2026-08-08
**Last Updated**: 2026-08-09 (FR-1 unblocked — `ui/alert.tsx` confirmed present on this stacked
branch; Steps 9-12 added covering FR-1's migration + verification + whole-feature gate; step count
8 → 12)
**Feature**: `docs/roadmap/features/122-shadcn-migration-low-confidence/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/shadcn-migration-low-confidence`

---

## Execution Summary

design.md's Round 3 (a live, recorded user override of Round 2's autonomous, narrower synthesis —
see design.md § Round 3) supersedes this spec's original 3-step shape. **FR-2/FR-3 now both migrate, at full breadth**: `AuthForm.tsx`'s
`CredentialsForm` (Round 2 had declined it), and **both** consumers of `accountShared.tsx`'s
`CredentialFields` — `AddAccountForm` (Round 2's only accepted call site) **and**
`EditCredentialsForm` (Round 2 had declined it for lack of e2e coverage; the override adds a new
characterization test to close that gap instead of declining). **FR-4 triggers at the product
spec's original breadth, on a corrected primitive**: three dependencies (`react-hook-form`, `zod`,
`@hookform/resolvers/zod` — not the two originally named) wired to `ui/field.tsx` (`Field`/
`FieldLabel`/`FieldError`/etc.) — **not** `ui/form.tsx`, which product-spec.md's original FR-4 text
named but which a live doc verification (recon.md's 2026-08-08 addendum) found is shadcn's *older*,
now-superseded pattern.

**FR-1 (`OrderForm.tsx`/`EditOrderDialog.tsx`) now also migrates (design.md § Round 4,
2026-08-09) — specced below as Steps 9-11.** The user directly overrode the design phase's earlier
DECLINE for FR-1: both call sites wrap their existing message text in `Alert`. This feature's branch
is stacked on `feature/shadcn-migration-medium-confidence`, itself stacked on
`feature/shadcn-migration-high-confidence` — a fresh `ls services/xstockstrat-ui/src/components/ui/`
this session confirms `alert.tsx` **is now present** (added by `120`), so per the user's explicit
direction to re-spec and execute FR-1 in this same pass (mirroring how sibling
`121-shadcn-migration-medium-confidence` re-specced its own Tranche 2 once its blocking primitives
became available on its stacked branch), concrete steps are added: Step 9 (service) migrates both
call sites, Step 10 (test) runs the e2e regression for `OrderForm.tsx` (which has real e2e coverage:
`order-form.spec.ts`'s success/error message assertions), Step 11 (test) is a build-only
verification note for `EditOrderDialog.tsx` (confirmed no e2e coverage of its error-message
rendering). Step 12 is the new whole-feature (FR-1 + FR-2/FR-3/FR-4) verification gate, superseding
the narrower Step 8 (kept as-is below — Step 8 already ran and passed against FR-2/FR-3/FR-4 before
FR-1 was added; Step 12 is the final all-inclusive re-run). FR-2/FR-3/FR-4 above have no
cross-feature primitive dependency (`ui/field.tsx` is a new primitive this feature adds itself, not
one owned by a sibling) and are specced at full breadth in Steps 2–8 below, unchanged by this
addendum.

Because AC-1 still requires each FR's decision recorded in `context.md` *before* any code is
written for that item, Step 1 remains a `docs` step, now updated to record FR-1's overridden migrate
decision (blocked on `120`) alongside FR-2/FR-3/FR-4's overridden migrate decisions (citing
design.md § Round 3 for FR-2/FR-3/FR-4 and § Round 4 for FR-1 as the P-04 approval records). Steps
2–3 add the shared scaffolding both migrations need (dependencies, then the
`ui/field.tsx` primitive) before any call site is touched, per the ledger's 2026-08-05
(`trader-chart-panel`) trap: Step 2's Instructions install the three packages only and defer the
exact `useForm`/`Controller`/`zodResolver` call shape to the steps that actually call them, after a
real version resolves. Step 4 is the **new** step design.md's § FR-3 mandates: a characterization
e2e test for `EditCredentialsForm`'s "Edit keys" flow, authored and proven **green against the
pre-migration code** — a separate, earlier step, not folded into Step 7's migration, so it is a real
red-before-green (here: green-before-and-after) safety net rather than a test written to match
already-migrated code. Steps 5–7 migrate the three call sites in the order design.md discusses them
(`AuthForm` → `AddAccountForm` → `EditCredentialsForm`), with `EditCredentialsForm`'s migration
(Step 7) sequenced strictly after its characterization test (Step 4) so that test can serve as
Step 7's green-state proof. Step 8 is a single final gate (lint/build/e2e) covering the whole
FR-2/FR-3/FR-4 block.

## Step Dependencies

- Steps 2, 3, and 4 each require Step 1: AC-1 requires the FR-1/FR-2/FR-3 decisions (now: migrate
  (blocked on `120`)/migrate/migrate) recorded in `context.md` before any code-bearing step runs.
- Steps 5, 6, and 7 (the three migrations) each require **both** Step 2 (dependencies installed —
  their code imports `react-hook-form`/`zod`/`@hookform/resolvers/zod`) and Step 3 (`ui/field.tsx`
  exists — their JSX renders `Field`/`FieldLabel`/`FieldError`). Steps 2 and 3 do not depend on each
  other (installing the npm packages and generating the `ui/field.tsx` file are independent
  operations) — sequenced dependencies-then-primitive only for spec readability.
- Step 7 (`EditCredentialsForm` migration) additionally requires Step 4: the new characterization
  e2e test must exist and be proven green against the **pre-migration** code before Step 7 changes
  that code — this is design.md § FR-3's explicit red-before-green (here: green-before-and-after)
  sequencing decision, restated as an Open Risk in design.md. Step 7 also requires Step 6's
  `credentialSchema` factory (added there, imported here) — both consumers of `CredentialFields`
  share one schema, not two independently-authored ones (DRY guard rail; round-4 cross-check audit
  finding, 2026-08-09).
- Step 8 requires Steps 1–7 complete: it is the single final verification gate for the whole
  FR-2/FR-3/FR-4 block.
- **Steps 9-11 (FR-1) depend only on Step 1** (the recorded FR-1 decision) and on `ui/alert.tsx`
  existing on this stacked branch (confirmed present, owned by sibling
  `120-shadcn-migration-high-confidence`) — they do not depend on any of Steps 2-8 (FR-1 touches
  `OrderForm.tsx`/`EditOrderDialog.tsx`, disjoint files from FR-2/FR-3/FR-4's `AuthForm.tsx`/
  `accountShared.tsx`). Step 10 requires Step 9 (the e2e regression runs against the migrated
  markup). Step 11 requires Step 9 (the build-only gate runs against the migrated markup).
- **Step 12 requires Steps 1-11 complete**: the whole-feature (FR-1 + FR-2/FR-3/FR-4) verification
  gate, superseding Step 8's narrower FR-2/FR-3/FR-4-only scope.
- **Elevated overlap risk with sibling `121-shadcn-migration-medium-confidence`** (draft as of the
  `sdd-review product-spec` session — see `context.md`'s overlap scan): that feature's own FR touches
  `accountShared.tsx:116-167` (`EditCredentialsForm`) for a Collapsible/"Edit keys" expand-collapse
  concern — the **same function** Step 7 here rewires internally. The original 3-step plan only added
  a one-line comment at `:116` (low conflict risk); Step 7 now substantively rewrites the function
  body (state/submit wiring), which raises the merge-conflict risk from "shared file" to "same
  function, both editing its internals." Check `docs/roadmap/features/merge-order.md` and `121`'s
  current diff/status before merging Step 7 if `121` has landed changes to `EditCredentialsForm` by
  then.

---

### Step 1 — docs: Record FR-1/FR-2/FR-3/FR-4 decisions in context.md (Round 3 + Round 4 overrides)

**Status**: `done`
**Service**: `docs/roadmap/features/122-shadcn-migration-low-confidence/`
**Files**:
- `docs/roadmap/features/122-shadcn-migration-low-confidence/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Decisions to transcribe are fully argued in `design.md` § Chosen Approach (lines 18–149+, FR-1's
  MIGRATE-blocked-on-120 rewrite included), § Rejected Alternatives, § Round 3, and § Round 4 (the
  FR-1 override) of this feature's own directory — confirmed present via the Read in this session.
- AC-1 (`product-spec.md:111-112`): "Each of FR-1/FR-2/FR-3 has a recorded decision (migrate or
  decline) with a one-paragraph rationale in `context.md`, before any code is written for that
  item."
- `design.md` § Round 3 is the live, recorded **P-04** user approval this step transcribes for
  FR-2/FR-3/FR-4 — the prior implementation-spec.md's Step 1 recorded these as provisional/
  autonomous (no live user gate); that is now superseded. `design.md` § Round 4 (2026-08-09) is the
  separate, later live **P-04** user approval this step transcribes for FR-1 — it supersedes the
  Round 1/2 DECLINE this step's own original text recorded.
- Confirmed this session: `ls services/xstockstrat-ui/src/components/ui/` still shows no
  `alert.tsx` — FR-1's migrate decision is recorded now, but its actual code steps stay unspecced
  (see Execution Summary's tranche-split paragraph and Step Dependencies) until sibling `120` ships
  it.

**TDD**: `N/A (docs-only, no executable logic)`

**Instructions**:
Append a `## FR Decisions (AC-1) — Round 3 + Round 4 update` section to `context.md` with one entry
per FR, each a short paragraph (not a copy-paste of design.md — a reader-facing summary citing it),
and an explicit note that this supersedes the original Step 1 entry (do not delete the original
entry — `context.md` is append-only):

1. **FR-1 — MIGRATE, blocked on sibling `120` (Round 4 override; supersedes the original Round 1/2
   DECLINE)** (`OrderForm.tsx:216`, `EditOrderDialog.tsx:82`): the user directly overrode Round 1/2's
   decline and directed migration of both Alert-shaped call sites onto `ui/alert.tsx` (design.md §
   Round 4). `ui/alert.tsx` still does not exist in trunk today (sibling
   `120-shadcn-migration-high-confidence` is `implementation-ready`, not `code-completed`/
   `launched`) — per Constitution F-04, no concrete migration steps are written in this spec; a
   follow-up `/sdd-spec` run plans them once `120` merges. No code changes in this feature's
   current 8 steps.
2. **FR-2 — MIGRATE (Round 3 override; supersedes Round 2's decline)** (`AuthForm.tsx:28-93`,
   `CredentialsForm`): the user directly overrode Round 2's narrower recommendation and directed
   migration of all three Form-shaped call sites (design.md § Round 3). Moves to `useForm` +
   `Controller` + a `zod` schema (`email` format + required, `password` required) +
   `Field`/`FieldLabel`/`FieldError`; the network/server-error path (`fetch` failure) stays a local
   `error` state, not a zod-expressible field error.
3. **FR-3 — MIGRATE BOTH (Round 3 override; supersedes Round 2's split)**: `AddAccountForm`
   (`accountShared.tsx:259-332`) migrates (unchanged from Round 2 — justified by
   `e2e/trader/account-selector.spec.ts:63-92`'s existing reset-on-success assertion).
   `EditCredentialsForm` (`accountShared.tsx:116-167`) **also migrates now** — Round 2's reason to
   decline (no e2e parity coverage) is resolved, not waived: a new characterization e2e test is
   added and proven green **before** this consumer's migration (Step 4, ahead of Step 7), per
   design.md § FR-3's red-before-green safety net for a call site that submits a mutating
   `updateBrokerAccountCredentials` gRPC call against live broker secrets. `CredentialFields` itself
   (`accountShared.tsx:51-113`) stays unchanged — a plain controlled-input component; both
   consumers bridge it to `react-hook-form` via `Controller` at their own call site.
4. **FR-4 — triggers at full breadth, on a corrected primitive**: three dependencies
   (`react-hook-form`, `zod`, `@hookform/resolvers/zod` — not the two product-spec.md's original
   FR-4 text named) wired to `ui/field.tsx` (`Field`/`FieldLabel`/`FieldContent`/`FieldDescription`/
   `FieldError`/`FieldGroup`/`FieldSet`/`FieldLegend`/`FieldTitle`/`FieldSeparator`) — **not**
   `ui/form.tsx`, which recon.md's 2026-08-08 addendum found (live WebFetch against
   `https://ui.shadcn.com/docs/components/field` and `.../docs/forms/react-hook-form`) is shadcn's
   older, superseded pattern. This corrects product-spec.md's FR-4 text in place, per this repo's
   "fix the spec, don't paper over drift" convention (already applied in recon.md's addendum).

**Verification**:
`grep -n "## FR Decisions (AC-1) — Round 3 + Round 4 update" docs/roadmap/features/122-shadcn-migration-low-confidence/context.md`
returns one match, and the section contains all four numbered items above (manual read-through —
this is a docs step, no automated check applies).

---

### Step 2 — service: Add `react-hook-form`, `zod`, `@hookform/resolvers/zod` to xstockstrat-ui

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify (repo-root lockfile; confirmed the only lockfile —
  `services/xstockstrat-ui/pnpm-lock.yaml` does not exist, `pnpm-workspace.yaml:1-3` lists
  `services/*` as a workspace package)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via `grep -rn "react-hook-form\|from 'zod'\|\"zod\"\|@hookform/resolvers"
  services/xstockstrat-ui/src services/xstockstrat-ui/package.json` → zero matches for all three
  (resolved during `/sdd-review`, restated in `product-spec.md:128-132`, `recon.md:133-137`, and
  recon.md's addendum). No version pinned anywhere in the repo today for any of the three — a fresh
  install, not an upgrade.
- `services/xstockstrat-ui/package.json` — `"react": "^18.3.1"`, `"react-dom": "^18.3.1"` already
  present; `react-hook-form` requires React ≥16.8 (hooks), so no React version conflict is possible
  at install time. `@hookform/resolvers` requires `react-hook-form` as a peer — both installed in
  the same command below, so no ordering gap.
- `@hookform/resolvers/zod` is the glue package (`zodResolver`) wiring a `zod` schema into
  `useForm`'s `resolver` option — confirmed as a separate, non-transitive install target from the
  live install command at `https://ui.shadcn.com/docs/forms/react-hook-form`
  (`npm install react-hook-form zod @hookform/resolvers`) — recon.md's 2026-08-08 addendum. Three
  packages total, not the two product-spec.md's original FR-4 text named.
- `pnpm-workspace.yaml:1-3` (`packages: - 'packages/proto/gen/ts'` / `- 'services/*'`) and the root
  `pnpm-lock.yaml` (single workspace-wide lockfile, confirmed via `ls`) — `pnpm add` run from
  `services/xstockstrat-ui/` resolves against the workspace root lockfile.

**TDD**: `N/A (dependency addition only — no executable logic to test until Steps 5–7)`

**Instructions**:
1. `cd services/xstockstrat-ui && pnpm add react-hook-form zod @hookform/resolvers` — adds three
   entries to the `dependencies` block of `services/xstockstrat-ui/package.json` (pnpm keeps that
   block alphabetically sorted; do not hand-edit position) and updates the root `pnpm-lock.yaml`.
2. Per the ledger trap (2026-08-05, `trader-chart-panel`): do **not** write or assume any
   `react-hook-form`/`zod`/`@hookform/resolvers` call code in this step. This step installs the
   dependencies only.
3. Capture the resolved version of each package pnpm installs (`grep -A2
   "'react-hook-form'\|'zod'\|'@hookform/resolvers'" pnpm-lock.yaml`, or
   `pnpm --filter xstockstrat-ui list react-hook-form zod @hookform/resolvers`) and append the three
   lines to `context.md` — these are the versions Steps 3 and 5–7 must verify their API surface
   against, not whatever version the current upstream docs describe.

**Verification**:
```
grep -n '"react-hook-form"' services/xstockstrat-ui/package.json
grep -n '"zod"' services/xstockstrat-ui/package.json
grep -n '"@hookform/resolvers"' services/xstockstrat-ui/package.json
grep -n "react-hook-form\|@hookform/resolvers" pnpm-lock.yaml | head -10
```
All three `package.json` greps and the `pnpm-lock.yaml` grep must show a resolved semver (not
empty).

---

### Step 3 — service: Add the `ui/field.tsx` shadcn primitive

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/field.tsx` — create

**Reviewers**: `xstockstrat-ui` service owner — no reviewer beyond standard UI-primitive review;
this file has no gRPC/secrets surface

**Codebase Evidence**:
- `services/xstockstrat-ui/CLAUDE.md` § Styling: "Adding a primitive not yet in
  `src/components/ui/`: `npx shadcn@latest add <name>`." — the CLI is this codebase's canonical
  workflow for new primitives, confirmed already in use for `ui/select.tsx` et al. (feature 119).
- `recon.md`'s addendum (WebFetch, 2026-08-08, `https://ui.shadcn.com/docs/components/field`):
  confirmed export names — `Field`, `FieldLabel`, `FieldContent`, `FieldDescription`, `FieldError`,
  `FieldGroup`, `FieldSet`, `FieldLegend`, `FieldTitle`, `FieldSeparator` — framework-agnostic
  (works with plain `useState`, react-hook-form, TanStack Form, or Formisch); no `forwardRef`,
  `data-slot` per sub-part (design.md § FR-4, recon.md's addendum § 2). design.md's Open Risks flags
  this export list as name-verified but not byte-exact-prop-verified — this step's job is to close
  that gap by running the CLI rather than hand-authoring from the docs snippet alone.
- `ui/select.tsx` (`services/xstockstrat-ui/src/components/ui/select.tsx:1-186`) is the closest
  existing structural precedent confirmed this session: `'use client'`, plain function components
  (no `React.forwardRef`), `data-slot="select-*"` per sub-part, `cn()` from
  `@/components/ui/utils`, named exports at the bottom (`export { Select, SelectContent, ... }`).
  `ui/field.tsx` should match this shape.
- `services/xstockstrat-ui/components.json` — `"style": "radix-rhea"` (preset `bLTl5gh6`, feature
  119) — the CLI add command applies this preset automatically; no manual preset re-application
  needed for a single new primitive (only `apply --preset` regenerates existing files wholesale).

**TDD**: `N/A (no cva()-variant logic to unit-test — design.md § "Regression-test shape": none of
this feature's touched components fit the button.test.ts/badge.test.ts pattern; ui/field.tsx is
verified via the three migrated call sites' e2e/lint/build in Steps 5–8, not a standalone
ui/field.test.ts)`

**Instructions**:
1. **Primary path**: `cd services/xstockstrat-ui && npx shadcn@latest add field` — generates
   `src/components/ui/field.tsx` against the repo's `components.json` preset. Read the generated
   file afterward; do not assume its exact prop signatures from the docs snippet (design.md's Open
   Risks — the CLI output is ground truth, the docs snippet is not byte-exact).
2. **Hand-authored fallback** (only if the CLI is unavailable/fails in the execution environment):
   author `field.tsx` exporting the ten names listed in Codebase Evidence above, matching
   `ui/select.tsx`'s shape (`'use client'`, plain function components, `data-slot` per sub-part,
   `cn()` from `@/components/ui/utils`, no `forwardRef`) rather than shadcn's classic `forwardRef`
   template.
3. Do not modify `ui/select.tsx`, `ui/input.tsx`, `ui/button.tsx`, or any other existing primitive
   in this step — this step adds one new file only.
4. Do not wire `field.tsx` into any call site yet — that happens in Steps 5–7. This step's scope is
   the primitive file only.

**Verification**:
```
ls services/xstockstrat-ui/src/components/ui/field.tsx
grep -n "^export" services/xstockstrat-ui/src/components/ui/field.tsx
cd services/xstockstrat-ui && pnpm lint && pnpm build
```
The file exists, exports at minimum `Field`, `FieldLabel`, `FieldError` (the three this feature's
call sites use — the others may be present unused, that's the CLI's normal output shape, not scope
creep), and `pnpm lint`/`pnpm build` pass with the new unconsumed file present.

---

### Step 4 — test: Add EditCredentialsForm characterization e2e test (must pass pre-migration)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/account-selector.spec.ts` — modify (add one new test to the
  existing `test.describe('AccountSelector', ...)` block)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, config mutation safety

**Codebase Evidence**:
- design.md § FR-3 (lines 60–84) and § Open Risks (third bullet): this test **must land and pass
  BEFORE** the `EditCredentialsForm` migration step (Step 7) — "a red-before-green safety net...
  except here there is no existing green test to capture, so one must be authored before the
  refactor rather than merely re-run after it." Sequencing it as a genuinely separate, earlier step
  is what makes it a real characterization test.
- `accountShared.tsx:116-167` (`EditCredentialsForm`) — `handleSubmit` (`:130-147`) calls
  `tradingClient.updateBrokerAccountCredentials({ accountId: account.id, credentialsJson:
  buildCredentialsJson(...) })` (`:135-138`), then on success: `setCreds(EMPTY_CREDENTIALS)`
  (`:139`), `await refreshAccounts()` (`:140`), `onDone()` (`:141`).
- **`onDone` unmounts the form, it does not merely reset its fields**: `AccountRow`
  (`accountShared.tsx:174-252`) renders `EditCredentialsForm` conditionally —
  `{account.isActive && editing && <EditCredentialsForm account={account} onDone={() =>
  setEditing(false)} />}` (`:247-249`). Calling `onDone()` sets `editing` to `false`, which
  unmounts the entire form (collapsing the row back to its "Edit keys"/"Remove" button pair,
  `:213-222`). This differs from `AddAccountForm`, which stays mounted and only clears its field
  values on success (`account-selector.spec.ts:63-92`'s existing assertion pattern does not
  transfer literally — see Instructions below).
- `e2e/mock-backend.ts:199-201` — `updateBrokerAccountCredentials()` is already registered as a
  default handler on the merged mock gRPC server (`async updateBrokerAccountCredentials() { return
  { account: BROKER_ACCOUNT_ALPACA }; }`), active for every e2e test via `global-setup.ts`'s
  `startMockBackend()` — no new mock-backend.ts handler or `page.route` override is needed for the
  update call itself, only for `ListBrokerAccounts` (see Instructions).
- `e2e/fixtures/accounts.ts` — `BROKER_ACCOUNT_ALPACA` (`id: 'alpaca-default'`, `brokerType: 1`,
  `isActive: true`) is the canonical fixture already registered in `INVENTORY.md:14`; this step
  reuses it, no new fixture (`BROKER_ACCOUNT_IBKR` is also available in the same file/inventory
  entry if a future reviewer wants IBKR-branch coverage too — out of scope for this minimal
  characterization test, which only needs one branch to prove the reset-on-success mechanism).
- `e2e/trader/account-selector.spec.ts:63-92` ("Add Account form clears credential fields on
  success") is the test this new one mirrors the *shape* of (`page.route` override →
  `addAuthCookie` → `page.goto('/trader/accounts')` → fill → submit → assert) — but not the exact
  assertion, per the unmount-vs-reset distinction above.
- Both `AddAccountForm` and `AccountRow`/`EditCredentialsForm` render on the same
  `/trader/accounts` page simultaneously (`AccountsModule.tsx:149,162`), and both
  `AddAccountForm`'s `CredentialFields` and `EditCredentialsForm`'s `CredentialFields` render
  identical placeholders (`"API Key"`/`"API Secret"` for the Alpaca branch,
  `accountShared.tsx:96-113`) — a bare `page.getByPlaceholder('API Key')` after opening "Edit keys"
  matches **two** elements (strict-mode violation). Scope to the edit form specifically (see
  Instructions).

**TDD**: `N/A escape hatch, inverted — this step's entire purpose is a new characterization test
against unmodified (pre-migration) code, so there is no "red" phase to capture: the required proof
is that the new test goes GREEN immediately on first run, against the current
`EditCredentialsForm` implementation, with zero production-code changes in this step. If it fails on
first run, the test itself is wrong (or the described behavior is misunderstood), not a missing
behavior to implement — per `.claude/skills/sdd-execute/reference/tdd-gate.md`'s refactor escape
hatch, applied to a test-only step rather than a service step.`

**Instructions**:
1. In `e2e/trader/account-selector.spec.ts`, add a new `test(...)` inside the existing
   `test.describe('AccountSelector', ...)` block (do not create a new file — this keeps all
   account-management e2e coverage in one place, matching the existing organization).
2. `await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', ...)` to
   `fulfill` with `{ accounts: [BROKER_ACCOUNT_ALPACA] }` — a single-account override (mirrors
   `:63-92`'s pattern) so exactly one "Edit keys" button exists on the page, avoiding a
   multi-match locator.
3. `addAuthCookie(page)`, then `page.goto('/trader/accounts')`.
4. Click the row's "Edit keys" button: `page.getByRole('button', { name: 'Edit keys' }).click()`
   (unambiguous — only one account row is present per the route override above).
5. **Scope all further locators to the edit form, not the page**, to avoid colliding with
   `AddAccountForm`'s identical placeholders: `const editForm = page.locator('form').filter({ has:
   page.getByRole('button', { name: 'Save keys' }) });` — `"Save keys"` (`accountShared.tsx:159`)
   is unique to `EditCredentialsForm`'s submit button (`AddAccountForm`'s is `"Add Account"`).
6. Within `editForm`: fill `getByPlaceholder('API Key')` and `getByPlaceholder('API Secret')` with
   test values, then click `getByRole('button', { name: 'Save keys' })`.
7. Assert the form has closed (the actual reset-on-success behavior for this consumer — see
   Codebase Evidence): `await expect(page.getByRole('button', { name: 'Edit keys' }))
   .toBeVisible({ timeout: 5000 })` (the row collapsed back to its default state) — **not** an
   assertion that a field value is `''`, since the form unmounts rather than staying open with
   cleared fields.
8. Do not modify any production code in this step — `accountShared.tsx` is untouched here.

**Verification**:
```
cd services/xstockstrat-ui
pnpm test:e2e -- e2e/trader/account-selector.spec.ts
```
The new test must show **green**, run against the pre-migration `EditCredentialsForm` — this green
run is the baseline proof design.md § FR-3 requires before Step 7 touches that function. Also
confirm the existing `"Add Account form clears credential fields on success"` test in the same file
is unaffected (still green) — the `ListBrokerAccounts` route override is scoped per-test by
Playwright, so the new test's override does not leak into the existing one.

---

### Step 5 — service: Migrate `AuthForm.tsx`'s `CredentialsForm` to react-hook-form + zod + ui/field.tsx

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/auth/AuthForm.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Auth/login correctness, no secret values rendered
in UI

**Codebase Evidence**:
- `AuthForm.tsx:28-93` — `CredentialsForm({ submitLabel, loadingLabel, onSuccess })`: `useState`
  for `email`/`password`/`error`/`loading` (`:37-40`); `handleSubmit` (`:42-63`) calls
  `fetch('/api/auth/login', { method: 'POST', headers: {...}, body: JSON.stringify({ email,
  password }) })` (`:47-51`), on `res.ok` calls `onSuccess()` (`:53`), else sets `error` from the
  response body or a generic message (`:55-56`), and on a thrown/network error sets a distinct
  network-error message (`:58-59`); `finally` clears `loading` (`:61`). Error text renders at `:87`
  (`{error && <p className="text-sm text-destructive">{error}</p>}`).
- Both `Input`s use native `required` plus `type="email"` on the email field (`:68-75`, `:78-85`)
  as their only validation today — no explicit format-check code beyond the browser's native
  `type="email"` behavior.
- design.md § FR-2 (lines 34–48): zod schema `z.object({ email: z.string().email(msg), password:
  z.string().min(1, msg) })`; `formState.isSubmitting` replaces manual `loading`; a submit-level
  `error` state is still needed for the `fetch` failure path, since that is a network/server error,
  not a field-validation error zod can express — it is **not** replaced by `FieldError`.
- design.md § Regression-test shape (line 153–156): no new e2e coverage for this call site — zero
  DOM e2e exists today (`e2e/auth.spec.ts` is API-only, confirmed by recon.md § FR-2 call site), and
  no new user-visible behavior is introduced (the zod `.email()` check reproduces `type="email"`'s
  native format check one-for-one, per AC2's "same validation messages"). Verification is
  lint/build + the two existing API-level `auth.spec.ts` assertions.
- `AuthForm.tsx` has two consumers rendering `CredentialsForm` (the login page and the OAuth
  agent-authorize page, per `product-spec.md`'s Consumer Surface) — neither needs its own edit,
  both only import and render the component with different label props.

**TDD**: `N/A — no DOM e2e exists or is added for this call site (design.md § FR-2: no new
user-visible behavior to characterize). Verification is pnpm lint/build plus the two existing
e2e/auth.spec.ts API-level assertions, which are implementation-agnostic and already pass against
the pre-migration code — capture them green both immediately before and after this step's change,
per the tdd-gate.md refactor escape hatch (no literal red phase obtainable for a parity-preserving
refactor with zero DOM coverage to fail in the first place).`

**Instructions**:
1. **Do not assume the installed packages' exact API before checking what Step 2 installed.**
   Inspect the installed packages' TypeScript definitions (or a scratch `tsc --noEmit` check)
   against the versions captured in Step 2's `context.md` lines before writing any call — do not
   write code against `react-hook-form`/`zod`/`@hookform/resolvers` from memory or an assumed
   version (ledger 2026-08-05, `trader-chart-panel`).
2. Replace the four `useState` calls (`:37-40`) with a single `useForm` instance whose `resolver`
   is `zodResolver` of the schema `z.object({ email: z.string().email(<message>), password:
   z.string().min(1, <message>) })` — pick message text that preserves AC2's "same validation
   messages" intent (equivalent wording to today's native browser messages, not new stricter
   copy).
3. Replace the two `<Input>` elements (`:68-75`, `:78-85`) with `Field`/`FieldLabel`/`FieldError`
   wrapping the same `Input`s, each bridged to the form instance via `Controller` (do not make
   `Input` itself react-hook-form-aware — bridge via `Controller`'s render props at this call site,
   matching the pattern design.md specifies for `CredentialFields`' consumers in Step 6/7). Keep
   each `Input`'s `type`, `placeholder`, and `disabled={loading}`/`disabled={formState.isSubmitting}`
   props unchanged.
4. Replace manual `loading` with `formState.isSubmitting` (design.md § FR-2) for the `disabled`/
   label-swap behavior (`:74`, `:84`, `:88-89`).
5. Keep a local `error` state (or equivalent) for the `fetch` failure path only — this is a
   submit-level network/server error, not a zod-expressible field error. On submit: call `fetch`
   exactly as today (`:47-51`), and on non-`res.ok` or thrown error, set this state with the same
   messages as today (`:55-56`, `:58-59`); render it at the same visual spot as today's `:87`
   (`{error && <p className="text-sm text-destructive">{error}</p>}`), unchanged text/classes.
6. On success, call `onSuccess()` exactly as today (`:53`) — no change to that prop contract.
7. Do not touch `AuthCardShell` (`:14-25`) or either consumer page — this step's scope is
   `CredentialsForm` only.

**Verification**:
```
cd services/xstockstrat-ui
pnpm lint
pnpm build
pnpm test:e2e -- e2e/auth.spec.ts
```
All three must pass; `auth.spec.ts`'s two API-level `POST /api/auth/login` assertions must remain
green unmodified (AC5) — they are agnostic to `CredentialsForm`'s internal implementation, so a
regression here would indicate a behavior change, not a test-shape mismatch.

---

### Step 6 — service: Migrate `AddAccountForm` to react-hook-form + zod + ui/field.tsx

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/accountShared.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, config mutation safety,
Connect-RPC call safety

**Codebase Evidence**:
- `accountShared.tsx:259-332` — current `AddAccountForm`: `useState<string>` for `displayName`
  (`:261`) and `brokerType` (`:262`), `useState<CredentialState>` for `creds` (`:265`) seeded from
  `EMPTY_CREDENTIALS` (`:29-36`), `useState<boolean>`/`useState<string|null>` for `submitting`/
  `error` (`:263-264`); `handleAddAccount` (`:269-293`) calls
  `tradingClient.registerBrokerAccount({ displayName, brokerType: brokerTypeNum,
  credentialsJson: buildCredentialsJson(...) })` (`:276-280`), then on success resets
  `displayName`/`brokerType`/`creds` to their initial values (`:285-287`); the broker `Select`
  (`:303-317`) resets `creds` to `EMPTY_CREDENTIALS` on every `onValueChange` (`:305-308`) — a
  behavior to preserve, not just the final-submit reset; `CredentialFields` is called at `:319-323`
  with the `creds`/`onChange` controlled-component contract (`accountShared.tsx:51-59`).
- `e2e/trader/account-selector.spec.ts:63-92` — "Add Account form clears credential fields on
  success": fills `getByPlaceholder('Display name')`, `getByPlaceholder('API Key')`,
  `getByPlaceholder('API Secret')`, clicks `getByRole('button', { name: /add account/i })`, asserts
  `getByPlaceholder('API Key')` has value `''` afterward (`:92`) — the concrete parity target this
  step must keep passing, unmodified.
- `e2e/fixtures/accounts.ts:34-40` (`BROKER_ACCOUNT_NEW`) is the fixture the spec's
  `RegisterBrokerAccount` mock returns — already registered in `INVENTORY.md:14`; this step adds no
  new fixture.
- Two consumers of `AddAccountForm` confirmed via `grep -rn "AddAccountForm"
  services/xstockstrat-ui/src | grep -v accountShared.tsx`: `AccountManagementPanel.tsx:42` and
  `AccountsModule.tsx:162` — both re-render whatever `AddAccountForm` becomes; neither needs its own
  edit (they only import and render the component).
- design.md § FR-4: schema for the Alpaca branch — `{ apiKey: z.string().min(1, msg), apiSecret:
  z.string().min(1, msg) }`; for the IBKR branch — `{ consumerKey, accessToken, accessTokenSecret,
  ibkrAccountId }` each `z.string().min(1, msg)` (`accountShared.tsx:20-27`'s `CredentialState`
  fields, IBKR branch confirmed 4 fields at `:62-94`, Alpaca branch 2 fields at `:96-112`).
  `displayName` also required (existing native `required`, `:297-302`). `CredentialFields` itself
  (`:51-113`) is not edited by this step — only `AddAccountForm`'s call site changes — so no
  line-number drift is expected here.
- **DRY guard rail (round-4 cross-check audit finding, 2026-08-09)**: `AddAccountForm` (this step)
  and `EditCredentialsForm` (Step 7) both need the identical broker-conditional required-field
  schema above — `CredentialState`/`buildCredentialsJson` (`:19-48`) are already the single source
  of truth for this field list (per this file's own header comment, `:3-6`: "exist in exactly one
  place"). Writing the schema independently at each consumer's call site would duplicate that list
  a second and third time — exactly what the DRY guard rail exists to prevent (see
  `docs/patterns/dry-guard-rail.md`). **This step adds one shared schema factory**, not two
  independent schemas — see Instruction 2 below.
- `ui/select.tsx` (function-component + `data-slot`, no `forwardRef`) is the closest existing
  structural precedent for a controlled compound component in this codebase (recon.md); no
  `forwardRef`-based component should be introduced here either, matching the post-119 convention
  already in `ui/input.tsx`/`ui/button.tsx`.

**TDD**: `red N/A — no behavior change; account-selector.spec.ts:63-92 already passes against the
pre-migration code, so a literal "fails before, passes after" run is not obtainable by construction.
Per .claude/skills/sdd-execute/reference/tdd-gate.md's escape hatch: record "red N/A — no behavior
change; account-selector.spec.ts:63-92 is the characterization test" in the PR body and context.md,
then capture the GREEN run (this step's Verification) both immediately before (baseline on the
pre-migration tree) and after the change (confirm it stays green).`

**Instructions**:
1. **Do not assume the installed packages' exact API before checking what Step 2 installed** — same
   caution as Step 5, instruction 1.
2. **Add one shared `credentialSchema(brokerType: BrokerType)` factory function**, co-located with
   `CredentialState`/`buildCredentialsJson` (`accountShared.tsx:19-48`, immediately after
   `buildCredentialsJson`) — not exported per-consumer, exported once from `accountShared.tsx` and
   imported by both this step's `AddAccountForm` and Step 7's `EditCredentialsForm`. It returns the
   Alpaca-branch `z.object({ apiKey: z.string().min(1, msg), apiSecret: z.string().min(1, msg) })`
   or the IBKR-branch `z.object({ consumerKey, accessToken, accessTokenSecret, ibkrAccountId })`
   (each `z.string().min(1, msg)`) per the Codebase Evidence above, switching on `brokerType` the
   same way `buildCredentialsJson` already does — this is the single place the field list is
   expressed as a schema, mirroring how `CredentialState`/`CredentialFields` are already the single
   place it's expressed as a type/renderer. Neither this step nor Step 7 writes its own inline
   schema.
3. Rewrite `AddAccountForm` (`accountShared.tsx:259-332`) to source `displayName`, `brokerType`, and
   `creds` from a single `react-hook-form` form instance instead of four separate `useState` calls,
   using `credentialSchema(brokerType)` (Instruction 2) as the credentials portion of the form's
   resolver schema, preserving every one of these observable behaviors unchanged (AC2 — "same
   submit flow"):
   - `displayName` keeps its `required` HTML constraint (`<Input required placeholder="Display
     name" .../>` at `:297-302`) — do not drop the native `required` attribute even though the zod
     schema also validates it, so browser-level constraint-validation behavior is byte-identical.
   - Wrap `displayName`'s `Input` in `Field`/`FieldLabel`/`FieldError`, bridged via `Controller`.
   - The broker `Select` (`:303-317`) stays a controlled component (bridged via `Controller`'s
     render props, since `Select` is a Radix compound component, not a plain `Input`); changing it
     must still reset the credentials sub-state to `EMPTY_CREDENTIALS`, matching the existing
     `onValueChange` handler at `:305-308`.
   - `CredentialFields` (`:319-323`) keeps its existing `value`/`onChange`-controlled-component call
     contract unchanged (`accountShared.tsx:51-59`) — do not make `CredentialFields` itself
     react-hook-form-context-aware; bridge the credentials sub-state from the form instance to
     `CredentialFields`'s plain `creds`/`onChange` props at the `AddAccountForm` call site only
     (design.md's explicit "resolves the strongest risk" rejection of rewriting `CredentialFields`).
     `CredentialFields`'s own per-field `required` markers stay native HTML `required`, not
     `Field`/`FieldError`-wrapped — `CredentialFields` itself is out of scope for this feature
     (design.md § FR-3).
   - `handleAddAccount`'s submit body (`:269-293`) — the `tradingClient.registerBrokerAccount` call
     (`:276-280`) and its `try/catch`/`submitting`/`error` handling (`:263-264`, `:271-273`,
     `:288-292`) — stays functionally identical; only the field-state source and the submit trigger
     move onto the form instance's submit handler. Keep the submit-level `error` state (network/gRPC
     failure) separate from zod field errors, same reasoning as Step 5.
   - On successful registration, the full reset currently done manually at `:285-287`
     (`setDisplayName('')`, `setBrokerType('1')`, `setCreds(EMPTY_CREDENTIALS)`) must be replicated
     via the form instance's reset mechanism (whatever the installed version's API calls it — see
     instruction 1) so `account-selector.spec.ts:92`'s post-submit `''` assertion on the API Key
     field continues to pass.
4. Do not modify `CredentialFields` (`:51-113`) or `buildCredentialsJson` (`:39-48`) themselves —
   Instruction 2 only *adds* the new `credentialSchema` factory immediately after
   `buildCredentialsJson`, it does not edit either existing function. Also do not touch `AccountRow`
   (`:174-252`), `EditCredentialsForm` (`:116-167` — that is Step 7's scope),
   `AccountManagementPanel.tsx`, or `AccountsModule.tsx`.

**Verification**:
```
cd services/xstockstrat-ui
pnpm lint
pnpm build
pnpm test:e2e -- e2e/trader/account-selector.spec.ts
```
All three must pass. `"Add Account form clears credential fields on success"` must show green — the
concrete AC2 parity proof. Also confirm the new `EditCredentialsForm` characterization test added in
Step 4 in the same file is still green (this step does not touch `EditCredentialsForm`, so it should
be unaffected by construction — confirm, don't assume).

---

### Step 7 — service: Migrate `EditCredentialsForm` to react-hook-form + zod + ui/field.tsx

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/accountShared.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, config mutation safety
(this consumer submits a mutating call against live broker credentials — design.md § FR-3 flags it
as the higher-risk of the two `CredentialFields` consumers), Connect-RPC call safety

**Codebase Evidence**:
- `accountShared.tsx:116-167` — `EditCredentialsForm({ account, onDone })`: `useState` for `creds`
  (`:124`, seeded `EMPTY_CREDENTIALS`), `submitting`/`error` (`:125-126`); an unmount-cleanup effect
  resets `creds` (`:128`); `handleSubmit` (`:130-147`) calls
  `tradingClient.updateBrokerAccountCredentials({ accountId: account.id, credentialsJson:
  buildCredentialsJson(account.brokerType, creds) })` (`:135-138`), then on success:
  `setCreds(EMPTY_CREDENTIALS)` (`:139`), `await refreshAccounts()` (`:140`), `onDone()` (`:141`) —
  `onDone` is `AccountRow`'s `() => setEditing(false)` (`:248`), which **unmounts** the whole form
  (see Step 4's Codebase Evidence for the full unmount-vs-reset distinction).
- `CredentialFields` is called at `:155` with the same `brokerType`/`creds`/`onChange` controlled
  contract as `AddAccountForm` uses (`accountShared.tsx:51-59`) — same bridging approach as Step 6:
  `Controller` render props at this call site, `CredentialFields` itself untouched.
- design.md § FR-3 (lines 60–84): this consumer's migration is the higher-risk half of FR-3 — it
  directly submits a mutating gRPC call that overwrites a live broker account's stored secrets, so
  this step's characterization coverage (Step 4) is a **prerequisite**, not optional. design.md's
  rejected-alternatives list explicitly considered and rejected migrating without new coverage.
- Step 4's new test (`e2e/trader/account-selector.spec.ts`, "Edit Credentials form closes on
  successful save" or equivalent title chosen in that step) is the green-state baseline this step
  must keep passing — re-run it as this step's own proof, not just a general "run the suite" check.
- Elevated merge-conflict risk with sibling `121-shadcn-migration-medium-confidence` (see this
  file's top-level "Step Dependencies" note) — both features edit `EditCredentialsForm`'s body.
  Check `merge-order.md`/`121`'s current status before merging this step.

**TDD**: `red N/A — no intended behavior change (AC2 parity); Step 4's new characterization test is
the baseline, captured green there (before this step, against the pre-migration code) and must
remain green after this step's migration (this step's Verification) — the tdd-gate.md refactor
escape hatch, using a test authored specifically for this purpose (Step 4) rather than a
pre-existing one, per design.md § FR-3's explicit sequencing decision.`

**Instructions**:
1. **Do not assume the installed packages' exact API before checking what Step 2 installed** — same
   caution as Steps 5 and 6.
2. Rewrite `EditCredentialsForm` (`accountShared.tsx:116-167`) to source `creds` from a single
   `react-hook-form` form instance instead of `useState`, using the **shared `credentialSchema
   (brokerType)` factory Step 6 added** (co-located with `CredentialState`/`buildCredentialsJson`,
   `accountShared.tsx:19-48`) as the form's resolver schema — **do not write a second, independent
   schema for this consumer**; import and reuse Step 6's factory exactly as `AddAccountForm` does.
   Preserve every one of these observable behaviors unchanged (AC2 — "same submit flow"):
   - `CredentialFields` (`:155`) keeps its existing `value`/`onChange`-controlled-component call
     contract unchanged — bridge via `Controller` render props at this call site only, same pattern
     as Step 6's `AddAccountForm`. Do not rewrite `CredentialFields` itself.
   - `handleSubmit`'s body (`:130-147`) — the `tradingClient.updateBrokerAccountCredentials` call
     (`:135-138`) and its `try/catch`/`submitting`/`error` handling — stays functionally identical;
     only the field-state source and the submit trigger move onto the form instance's submit
     handler. Keep the submit-level `error` state (network/gRPC failure) separate from zod field
     errors.
   - On success: replicate `setCreds(EMPTY_CREDENTIALS)` → `refreshAccounts()` → `onDone()`
     (`:139-141`) in the same order, using the form instance's reset mechanism in place of
     `setCreds(EMPTY_CREDENTIALS)` (whatever the installed version's API calls it — see instruction
     1). `onDone()` must still fire on success exactly as today, since it is `AccountRow`'s unmount
     trigger — do not drop or reorder this call relative to `refreshAccounts()`.
   - The unmount-cleanup effect (`:128`, `React.useEffect(() => () => setCreds(EMPTY_CREDENTIALS),
     [])`) should be replicated using the form instance's reset mechanism if the chosen API needs
     an explicit unmount reset, or dropped if the form instance's own lifecycle already discards
     state on unmount (whichever the installed version's semantics require — verify against the
     installed types, do not assume).
   - Error rendering at `:156` (`{error && <p className="text-xs text-destructive">{error}</p>}`)
     stays for the submit-level (network/gRPC) error, unchanged text/classes/position.
3. Wrap the per-field markup rendered inside `CredentialFields`'s consumers with `Field`/
   `FieldLabel`/`FieldError` **only where this call site itself renders fields directly** — since
   all of `EditCredentialsForm`'s fields are rendered via `CredentialFields` (not inline here), this
   step's `Field`/`FieldLabel`/`FieldError` usage is limited to whatever `Controller` render-prop
   wrapping is needed at the bridging point; do not add new fields or new markup beyond what
   parity requires.
4. Do not touch `CredentialFields` (`:51-113`), `buildCredentialsJson` (`:39-48`), `AccountRow`'s
   own state (`:181-200`, `:213-245` — the confirm/remove flow, untouched by this feature),
   `AddAccountForm` (Step 6's scope, already migrated), `AccountManagementPanel.tsx`, or
   `AccountsModule.tsx`.

**Verification**:
```
cd services/xstockstrat-ui
pnpm lint
pnpm build
pnpm test:e2e -- e2e/trader/account-selector.spec.ts
```
All three must pass. The Step-4 characterization test must show green — the concrete AC2
parity/green-state proof this step is gated on. Also confirm `"Add Account form clears credential
fields on success"` (Step 6's target) remains green — this step does not touch `AddAccountForm`, so
it should be unaffected by construction.

---

### Step 8 — service: Final gate — lint, build, and full e2e re-run for the FR-2/FR-3/FR-4 block

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: none (verification-only step; no code or test changes)

**Reviewers**: `xstockstrat-ui` service owner — sign-off gate for the whole FR-2/FR-3/FR-4 block

**Codebase Evidence**:
- AC5 (`product-spec.md:119-120`): "`pnpm lint` and `pnpm build` pass; `pnpm test:e2e` passes for
  every spec covering a touched component." Steps 5–7 each verified their own touched call site;
  this step is the consolidated final check across all three FR-2/FR-3/FR-4 call sites. (**Note**:
  at the time this step was written, FR-1 had no code steps in this spec — Steps 9-11 were added
  afterward once `ui/alert.tsx` became available on this stacked branch. This step ran and passed
  before that addition; Step 12 is the true whole-feature gate covering FR-1 too.)
- Touched-component spec inventory for this block: `e2e/auth.spec.ts` (Step 5, `AuthForm`),
  `e2e/trader/account-selector.spec.ts` (Steps 4, 6, 7 — `AddAccountForm` and
  `EditCredentialsForm`). `e2e/trader/order-form.spec.ts` and any `EditOrderDialog`-adjacent spec
  are unaffected by this step's own scope (FR-2/FR-3/FR-4 only) — re-run them anyway as a
  regression backstop, not because this step's own changes touched them.
- `e2e/trader/orders.spec.ts` exercises account-row-adjacent flows (per the original spec's Step 3
  evidence) — re-run as part of the full `e2e/trader/` directory check below, since `AccountRow`
  (`accountShared.tsx:174-252`) itself is unchanged but renders the now-migrated
  `EditCredentialsForm`.

**TDD**: `N/A (verification-only step; no new code or test authored — reruns the gates Steps 3, 5,
6, and 7 already captured individually, as a single final confirmation for the whole
FR-2/FR-3/FR-4 block)`

**Instructions**:
1. `cd services/xstockstrat-ui && pnpm lint`
2. `pnpm build`
3. `pnpm test:e2e -- e2e/trader/` — full trader-segment directory (covers `account-selector.spec.ts`,
   `order-form.spec.ts`, `orders.spec.ts`, and any other trader spec).
4. `pnpm test:e2e -- e2e/auth.spec.ts` — the two API-level login assertions (Step 5's call site).
5. If any spec fails, do not mark this step done — return to the step that owns the failing
   behavior (Steps 5–7) rather than patching the failure here; this step is a gate, not a fix
   point.

**Verification**:
All four commands in Instructions must exit 0, with no skipped/pending tests in the touched specs
(confirm actual assertion counts, not just a green exit code — per
`.claude/skills/sdd-execute/reference/tdd-gate.md`'s "a green suite is not automatically coverage"
caution).

---

### Step 9 — service: Wire Alert to OrderForm.tsx and EditOrderDialog.tsx (FR-1)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify (`:217-219`)
- `services/xstockstrat-ui/src/components/trader/EditOrderDialog.tsx` — modify (`:82`)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence** (re-read this session):
- `OrderForm.tsx:217-219` — `{message && (<p className={\`text-xs ${isErrorMsg ? 'text-destructive' :
  'text-buy'}\`}>{message}</p>)}`. `message`/`isErrorMsg` are `useState` (`:70-71`); success renders
  `text-buy` (e.g. "Order placed: mock-order-001 (FILLED) — qty 5, stop 148.25"), failure renders
  `text-destructive` (e.g. "Insufficient buying power"). `alert.tsx` has no "buy"/success variant —
  only `default`/`destructive`/`warning` — so the success case needs an explicit `AlertDescription`
  className override (`alert.tsx`'s own default is `text-muted-foreground`, which would silently
  drop the `text-buy` coloring if not overridden).
- `e2e/trader/order-form.spec.ts:65-81,83-101` — two tests assert this paragraph's text content via
  `getByText(...)` (not a class-based locator): "successful order submission shows orderId and
  status" and "failed order submission shows error message". Both should survive a like-for-like
  `Alert` wrap since they match text content, not the `<p>` tag or its class.
- `EditOrderDialog.tsx:82` — `{error && <p className="text-xs text-destructive">{error}</p>}`.
  `error` is `useState` (`:26`), only ever the destructive/error case (success closes the sheet via
  `onOpenChange(false)`, `:46` — no inline success message exists at this site).
- `e2e/trader/order-ticket.spec.ts` (the only spec referencing this dialog) only asserts the "Edit
  order" trigger button's visibility (`:23,36`) — no assertion targets this error `<p>`, confirmed
  via grep this session (zero hits for "error"/"destructive"/"Save changes").

**TDD**: expected-pass e2e-risk site for `OrderForm.tsx` (Step 10 runs the real suite, doesn't
assume); `EditOrderDialog.tsx` has no e2e coverage of this element (Step 11, build-only).

**Instructions**:
1. `OrderForm.tsx`: import `{ Alert, AlertDescription } from '@/components/ui/alert'`. Replace the
   `<p>` (`:217-219`) with:
   ```tsx
   {message && (
     <Alert variant={isErrorMsg ? 'destructive' : 'default'}>
       <AlertDescription className={isErrorMsg ? undefined : 'text-buy'}>
         {message}
       </AlertDescription>
     </Alert>
   )}
   ```
   `variant="destructive"` already colors `AlertDescription` via `alert.tsx`'s own
   `*:data-[slot=alert-description]:text-destructive/90` rule — no extra className needed for the
   error case. The success case needs the explicit `text-buy` override since `default` has no such
   rule.
2. `EditOrderDialog.tsx`: import `{ Alert, AlertDescription } from '../ui/alert'` (matching this
   file's existing relative-import style, e.g. `'../ui/input'`). Replace the `<p>` (`:82`) with:
   ```tsx
   {error && (
     <Alert variant="destructive">
       <AlertDescription>{error}</AlertDescription>
     </Alert>
   )}
   ```
3. Do not touch either file's state management, submit handlers, or any other markup.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "Alert\b" src/components/trader/OrderForm.tsx src/components/trader/EditOrderDialog.tsx
pnpm lint
pnpm build
```

---

### Step 10 — test: e2e regression for FR-1 (OrderForm.tsx)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: `services/xstockstrat-ui/e2e/trader/order-form.spec.ts` — verification-only unless a
locator breaks

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**: Step 9's evidence — both assertions use `getByText(...)`, text-content-based,
not class- or tag-based.

**TDD**: expected-pass e2e-risk pair — run unmodified first and record the actual result, per P-06,
same pattern used throughout this feature's siblings (120/121) for `asChild`/primitive-swap sites.

**Instructions**: Run `order-form.spec.ts` unmodified against Step 9. If a case fails, fix Step 9's
markup (the text content must render identically) rather than the test's locator.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/trader/order-form.spec.ts
```

---

### Step 11 — test: build-only verification for FR-1 (EditOrderDialog.tsx, no e2e coverage exists)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: none

**Reviewers**: none

**Codebase Evidence**: Step 9's confirmed-absent grep (`e2e/trader/order-ticket.spec.ts` has zero
assertions on this dialog's error text).

**TDD**: N/A.

**Instructions**: No code change — `pnpm build` (already run in Step 9) is the gate; recorded as its
own step so acceptance criterion 5 isn't silently assumed satisfied for this site, mirroring sibling
`121`'s Steps 33/35 pattern for its own no-e2e-coverage sites.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build
```

---

### Step 12 — test: Whole-feature (FR-1 + FR-2/FR-3/FR-4) verification gate

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: none — verification-only, runs after Steps 1-11

**Reviewers**: `xstockstrat-ui` service owner — full review scope (final gate)

**Codebase Evidence**: same AC5 as Step 8, now covering the full 4-FR feature scope (Steps 1-7
FR-2/FR-3/FR-4 + Steps 9-11 FR-1).

**TDD**: N/A.

**Instructions**: No code change. Run the complete lint/build/e2e suite once every step in this spec
(1-11) has landed, to catch any cross-step interaction Steps 8/10/11's narrower checks might have
missed individually.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint && pnpm build && pnpm test:e2e
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
