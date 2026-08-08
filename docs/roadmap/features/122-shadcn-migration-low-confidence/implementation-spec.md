# Implementation Spec: shadcn-migration-low-confidence

**Status**: `pending`
**Created**: 2026-08-08
**Feature**: `docs/roadmap/features/122-shadcn-migration-low-confidence/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/shadcn-migration-low-confidence`

---

## Execution Summary

design.md's Chosen Approach declines FR-1 (both `OrderForm.tsx`/`EditOrderDialog.tsx` inline
messages) and FR-2 (`AuthForm.tsx`) outright — no code changes for either — and splits FR-3:
`AddAccountForm` migrates to `react-hook-form`, `EditCredentialsForm` (its sibling consumer of the
same `CredentialFields`) stays on the manual pattern for lack of e2e coverage to prove parity.
FR-4 triggers narrower than the product spec's literal text: `react-hook-form` only (no `zod`, no
`ui/form.tsx` — see design.md § Chosen Approach for the full rationale). Because AC-1 requires each
FR's decision recorded in `context.md` *before* any code is written for that item, Step 1 is a
`docs` step that writes all three decisions (including the two no-op declines) before Step 2 touches
any file. Steps 2–3 sequence the one thing that does change: add the dependency first, then write
the migration — per the ledger's 2026-08-05 (`trader-chart-panel`) trap, Step 3's Instructions defer
the exact `react-hook-form` call signature to execute time (after Step 2's `pnpm add` resolves a
real version) rather than assuming an API shape now.

## Step Dependencies

- Step 2 requires Step 1: AC-1 requires the FR-1/FR-2/FR-3 decisions recorded in `context.md`
  before any code-bearing step runs, even though FR-1/FR-2 produce no diff.
- Step 3 requires Step 2: `react-hook-form` must actually be installed (a resolved version in
  `pnpm-lock.yaml`) before its API surface can be verified and called — ledger 2026-08-05
  (`trader-chart-panel`, "defer exact API-call instructions until after that dependency is actually
  installed").
- No step depends on sibling feature `120-shadcn-migration-high-confidence` (`ui/alert.tsx`) —
  FR-1 declines regardless of 120's status (design.md § Chosen Approach), so this feature has zero
  cross-feature merge-order dependency.

---

### Step 1 — docs: Record FR-1/FR-2/FR-3 migrate-or-decline decisions in context.md

**Status**: `pending`
**Service**: `docs/roadmap/features/122-shadcn-migration-low-confidence/`
**Files**:
- `docs/roadmap/features/122-shadcn-migration-low-confidence/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Decisions to transcribe are already fully argued in `design.md` § Chosen Approach (lines 18–87)
  and § Rejected Alternatives (lines 101–124) of this feature's own directory — confirmed present
  via the Read in this session.
- AC-1 (`product-spec.md:111-112`): "Each of FR-1/FR-2/FR-3 has a recorded decision (migrate or
  decline) with a one-paragraph rationale in `context.md`, before any code is written for that
  item."

**TDD**: `N/A (docs-only, no executable logic)`

**Instructions**:
Append a `## FR Decisions (AC-1)` section to `context.md` with one entry per FR, each a short
paragraph (not a copy-paste of design.md — a reader-facing summary citing it):

1. **FR-1 — DECLINE** (`OrderForm.tsx:216`, `EditOrderDialog.tsx:82`): `ui/alert.tsx` does not
   exist in trunk (sibling `120-shadcn-migration-high-confidence` is `spec-ready`, not shipped);
   hand-authoring an Alert-shaped wrapper now risks a second, divergent implementation 120 would
   later have to reconcile, and the audit itself rated this a loose match. No code changes.
2. **FR-2 — DECLINE** (`AuthForm.tsx:28-93`, `CredentialsForm`): two static fields, browser-native
   `required` validation, zero e2e DOM coverage either direction — the existing `useState` + manual
   `fetch` is already the minimal correct implementation. No code changes.
3. **FR-3 — SPLIT**: `AddAccountForm` (`accountShared.tsx:259-332`) — **MIGRATE** to
   `react-hook-form`, justified by `e2e/trader/account-selector.spec.ts:63-92`'s existing
   reset-on-success assertion, which proves parity without new test authoring.
   `EditCredentialsForm` (`accountShared.tsx:116-167`) — **DECLINE**, no equivalent e2e coverage
   exists to prove AC2 parity for it, and authoring new e2e coverage to unblock a migration is
   disproportionate for this evaluate-then-decide feature. `CredentialFields` itself
   (`accountShared.tsx:51-113`) stays unchanged (plain controlled-input component) either way.
4. Note FR-4's narrowing explicitly: `react-hook-form` only — no `zod`, no `ui/form.tsx` — per
   design.md § Chosen Approach (no validation-shape gap zod closes at the one accepted call site;
   zero consumers for a `Form`/`FormField`/`FormItem`/`FormLabel`/`FormMessage` primitive set).

**Verification**:
`grep -n "## FR Decisions" docs/roadmap/features/122-shadcn-migration-low-confidence/context.md`
returns one match, and the section contains all four numbered items above (manual read-through —
this is a docs step, no automated check applies).

---

### Step 2 — service: Add the `react-hook-form` dependency to xstockstrat-ui

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify (repo-root lockfile; confirmed the only lockfile —
  `services/xstockstrat-ui/pnpm-lock.yaml` does not exist, `pnpm-workspace.yaml:1-3` lists
  `services/*` as a workspace package)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via `grep -rn "react-hook-form\|from 'zod'\|\"zod\"" services/xstockstrat-ui/src
  services/xstockstrat-ui/package.json` → zero matches (resolved during `/sdd-review`, restated in
  `product-spec.md:128-132` and `recon.md:133-137`). No version pinned anywhere in the repo today.
- `services/xstockstrat-ui/package.json:48-49` — `"react": "^18.3.1"`, `"react-dom": "^18.3.1"`
  already present; `react-hook-form` requires React ≥16.8 (hooks), so no React version conflict is
  possible at this dependency's install time — a compatibility check, not an assumption about the
  install itself.
- `pnpm-workspace.yaml:1-3` (`packages: - 'packages/proto/gen/ts'` / `- 'services/*'`) and root
  `pnpm-lock.yaml` (single workspace-wide lockfile, confirmed via `ls`) — `pnpm add` run from
  `services/xstockstrat-ui/` resolves against the workspace root lockfile.

**TDD**: `N/A (dependency addition only — no executable logic to test until Step 3)`

**Instructions**:
1. `cd services/xstockstrat-ui && pnpm add react-hook-form` — this adds a single entry to the
   `dependencies` block of `services/xstockstrat-ui/package.json` (pnpm keeps that block
   alphabetically sorted; the entry lands between the existing `"react-dom"` and `"recharts"`
   lines automatically — do not hand-edit position) and updates the root `pnpm-lock.yaml`.
2. Per the ledger trap (2026-08-05, `trader-chart-panel`): do **not** write or assume any
   `react-hook-form` call code in this step. This step installs the dependency only.
3. Capture the resolved version pnpm installs (`grep -A2 "'react-hook-form'" pnpm-lock.yaml` or
   `pnpm --filter xstockstrat-ui list react-hook-form`) and append one line to `context.md`
   recording it — this is the version Step 3 must verify its API surface against, not whatever
   version the current `react-hook-form` docs describe.

**Verification**:
```
grep -n '"react-hook-form"' services/xstockstrat-ui/package.json
grep -n "react-hook-form" pnpm-lock.yaml | head -5
```
Both must show a resolved semver (not empty). No `zod` entry should appear in either file
(`grep -n '"zod"' services/xstockstrat-ui/package.json pnpm-lock.yaml` → no match — confirms FR-4's
narrowing held).

---

### Step 3 — service: Migrate `AddAccountForm` to `react-hook-form`; note the intra-file split on `EditCredentialsForm`

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
- Two consumers of `AddAccountForm` confirmed via
  `grep -rn "AddAccountForm" services/xstockstrat-ui/src | grep -v accountShared.tsx`:
  `AccountManagementPanel.tsx:42` and `AccountsModule.tsx:162` — both re-render whatever
  `AddAccountForm` becomes; neither needs its own edit (they only import and render the component).
- `accountShared.tsx:116` — `export function EditCredentialsForm({` — the sibling consumer of
  `CredentialFields` that stays on the manual `useState` pattern per design.md's split decision;
  no e2e spec asserts its reset-on-success behavior (targeted grep in `recon.md` § FR-3 call site,
  confirmed no hit outside `account-selector.spec.ts`/`orders.spec.ts`, neither of which drives
  `EditCredentialsForm`'s own "Edit keys" flow).
- `ui/select.tsx` (function-component + `data-slot`, no `forwardRef` — `recon.md:109-113`) is the
  closest existing structural precedent for a controlled compound component in this codebase; no
  `ui/form.tsx` is being added (design.md — declined), so this step's only style constraint is: do
  not introduce a `forwardRef`-based component (matches the post-119 convention already in
  `ui/input.tsx`/`ui/button.tsx`).

**TDD**: `red-green required` (code-bearing `service` step). Per
`.claude/skills/sdd-execute/reference/tdd-gate.md` § Interaction with the existing flow: this is a
refactor with **no intended external behavior change** — `account-selector.spec.ts:63-92` already
passes against the pre-migration code, so a literal "fails before, passes after" run is not
obtainable by construction. Follow the documented escape hatch: record "red N/A — no behavior
change; `account-selector.spec.ts:63-92` is the characterization test" in the PR body and
`context.md`, then capture the **green** run (this step's Verification) both immediately before
(confirm it's green on the pre-migration tree — the baseline) and after the change (confirm it
stays green).

**Instructions**:
1. **Do not assume `react-hook-form`'s exact API before checking what Step 2 installed.** Before
   writing any call, inspect the installed package's TypeScript definitions (e.g.
   `services/xstockstrat-ui/node_modules/react-hook-form/dist/index.d.ts`, or run
   `pnpm --filter xstockstrat-ui exec tsc --noEmit` against a scratch `useForm` call) against the
   version captured in Step 2's `context.md` line — do not write code against react-hook-form's
   documented API from memory or an assumed major version (ledger 2026-08-05,
   `trader-chart-panel`).
2. Rewrite `AddAccountForm` (`accountShared.tsx:259-332`) to source `displayName`, `brokerType`,
   and `creds` from a single `react-hook-form` form instance instead of three separate `useState`
   calls, preserving every one of these observable behaviors unchanged (AC2 — "same submit flow"):
   - `displayName` keeps its `required` HTML constraint (the existing `<Input required
     placeholder="Display name" .../>` at `:297-302` — do not drop the native `required` attribute
     even if the form library also validates it, so browser-level constraint-validation behavior is
     byte-identical).
   - The broker `Select` (`:303-317`) stays a controlled component; changing it must still reset
     the credentials sub-state to `EMPTY_CREDENTIALS`, matching the existing `onValueChange`
     handler at `:305-308`.
   - `CredentialFields` (`:319-323`) keeps its existing `value`/`onChange`-controlled-component
     call contract unchanged (`accountShared.tsx:51-59` — do not make `CredentialFields` itself
     react-hook-form-context-aware; bridge the credentials sub-state from the form instance to
     `CredentialFields`'s plain `creds`/`onChange` props at the `AddAccountForm` call site only —
     this is design.md's explicit "resolves the strongest risk" rejection of rewriting
     `CredentialFields`).
   - `handleAddAccount`'s submit body (`:269-293`) — the `tradingClient.registerBrokerAccount` call
     (`:276-280`) and its `try/catch`/`submitting`/`error` handling (`:263-264`, `:271-273`,
     `:288-292`) — stays functionally identical; only the field-state source and the submit
     trigger move onto the form instance's submit handler.
   - On successful registration, the full reset currently done manually at `:285-287`
     (`setDisplayName('')`, `setBrokerType('1')`, `setCreds(EMPTY_CREDENTIALS)`) must be replicated
     via the form instance's reset mechanism (whatever the installed version's API calls it — see
     instruction 1) so that `account-selector.spec.ts:92`'s post-submit `''` assertion on the API
     Key field continues to pass.
3. At `accountShared.tsx:116` (`EditCredentialsForm`'s definition), add a one-line code comment
   immediately above the function noting that it deliberately stays on the manual `useState`
   pattern while its sibling `AddAccountForm` moved to `react-hook-form`, and why (no e2e coverage
   exists yet to prove reset-on-success parity for this consumer — design.md § Open Risks, third
   bullet) — so a future reader does not assume the split was accidental.
4. Do not touch `CredentialFields` (`:51-113`), `buildCredentialsJson` (`:39-48`), `AccountRow`
   (`:174-252`), `AccountManagementPanel.tsx`, or `AccountsModule.tsx` — all render/consume
   `AddAccountForm`/`CredentialFields` as-is and need no change (confirmed via the two-consumer
   grep above).

**Verification**:
```
cd services/xstockstrat-ui
pnpm lint
pnpm build
pnpm test:e2e -- e2e/trader/account-selector.spec.ts
```
All three must pass. `pnpm test:e2e -- e2e/trader/account-selector.spec.ts` in particular must show
`"Add Account form clears credential fields on success"` green — the concrete AC2 parity proof.
Also confirm no other touched-component spec regressed: FR-1/FR-2 produced zero diff (Step 1's
decisions), so `e2e/trader/order-form.spec.ts`, `e2e/auth.spec.ts`, and
`e2e/trader/orders.spec.ts` (which exercises `EditCredentialsForm`-adjacent account rows, left
unchanged) are unaffected by construction — re-run the full trader e2e directory as a final check:
`pnpm test:e2e -- e2e/trader/`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
