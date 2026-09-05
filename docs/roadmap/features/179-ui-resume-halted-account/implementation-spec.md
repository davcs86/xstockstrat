# Implementation Spec: ui-resume-halted-account

**Status**: `pending`
**Created**: 2026-09-05
**Feature**: `docs/roadmap/features/179-ui-resume-halted-account/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/ui-resume-halted-account`

---

## Execution Summary

UI-only feature against the pre-existing admin-only `ResumeAccount` RPC — **no** proto, migration,
config, or backend change (`design.md` § Chosen Approach). Build bottom-up: first extract the shared
`HALT_SOURCE` render map (Step 1, C-10 same-PR) and build the reusable `HaltBadge` leaf (Step 2), then
wire the admin-gated BFF route (Step 3) and the optimistic-clear context method (Step 4). Steps 5–6
land the indicator + Resume control on the two account-management surfaces (`AccountRow`,
`AccountSelector`). Steps 7–8 are the test layer: a halted fixture + a stateful mock handler (Step 7),
then one Playwright spec (Step 8) that covers every acceptance scenario.

`xstockstrat-ui` is a frontend with **no CI coverage threshold** (`spec-template.md` coverage table:
`n/a` for the UI segments) — behavioral verification is the Playwright e2e suite, not a per-step
`--cov-fail-under`. Steps 1–6 are `service` steps whose red-before-green anchor is the Step 8 e2e spec
(declared in Step Dependencies), authored to fail against the pre-implementation tree.

**Consumer surface (C-14):** the product spec names exactly one — **UI `/trader`** account-management
(indicator + Resume control). Steps 5–6 land it on the rendered `/trader/accounts` surface
(reached inside `AppShell`, `src/app/trader/accounts/page.tsx` — already nav-reachable, so no new
`PLATFORM_SUBNAV` registration is required). The Agent surface is explicitly **no change** (product
spec § Consumer Surface(s)).

### Scenario Coverage (C-15)

Every `@AC-*` in `acceptance.feature` is covered by the single Playwright spec in **Step 8**:

| Scenario | Covered by | Supporting steps |
|---|---|---|
| `@AC-1` (FR-2) halt indicator shown on account-mgmt surface | Step 8 | 1, 2, 5 |
| `@AC-2` (FR-3) Resume control only for a halted account | Step 8 | 5 |
| `@AC-3` (FR-1/FR-4) Resume clears the halt; headers carried | Step 8 | 3, 4 |
| `@AC-4` (FR-4) resume on a non-halted account is a benign no-op | Step 8 | 3, 7 |
| `@AC-5` (FR-5) non-admin cannot resume | Step 8 | 3, 5 |
| `@AC-6` (FR-3) Resume requires a reason-surfacing confirmation | Step 8 | 5 |

## Step Dependencies

- Step 2 (HaltBadge) requires Step 1: `HALT_SOURCE` must live in `opportunityShared.tsx` before Steps
  5–6 import both `HaltBadge` and `HALT_SOURCE` from shared homes (Step 2's `HaltBadge` itself does
  not import `HALT_SOURCE`, but the badge-row render in Step 5 uses both).
- Step 5 (AccountRow) requires Steps 2, 3, 4: the row renders `<HaltBadge/>` + `HALT_SOURCE` EnumBadge
  and its Resume action calls the Step 3 BFF route then Step 4 `applyAccountUpdate`.
- Step 6 (AccountSelector) requires Step 2: renders `<HaltBadge iconOnly/>`.
- Step 8 (e2e) is the **paired red-before-green test** for Steps 1–6 (`spec-template.md` § Test step
  pairing rule / P-06). It requires Step 7 (halted fixture + stateful mock handler). Authored to fail
  against the pre-implementation tree (no indicator, no Resume control, no BFF route).
- Step 3 introduces a new outbound gRPC call (`tradingClient.resumeAccount`) but **reuses** the
  propagating `forward`/`forwardAdmin` helper (`bffShared.ts:60-76`), so header propagation (C-03) is
  inherited, not re-implemented.

---

### Step 1 — service: Extract `HALT_SOURCE` to `opportunityShared` and rewire the positions page

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — Trading UI correctness, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- `HALT_SOURCE` is today a **non-exported module-local** const at `src/app/trader/positions/page.tsx:41-46`,
  with the comment `// Halt-source labels — an exhaustive Record<Enum, EnumRender> ... Kept local`
  (`:41-42`): `const HALT_SOURCE: Record<HaltSource, EnumRender> = { [HaltSource.UNSPECIFIED]: {label:'—',role:'secondary'}, [HaltSource.BRACKET_PROTECTION]: {label:'Bracket protection',role:'paper'}, [HaltSource.RECONCILIATION]: {label:'Reconciliation',role:'sell'} }`.
- The positions page imports `EnumBadge`, `type EnumRender` from `@/lib/opportunityShared` (`:11`) and
  the `HaltSource` value enum from `@xstockstrat/proto/trading/v1/trading_pb` (`:23`); it renders
  `<EnumBadge render={HALT_SOURCE[selectedAccount.haltSource]} />` at `:368`.
- `opportunityShared.tsx` already exports the sibling maps (`OPPORTUNITY_ACTION` `:27`, `POSITION_RISK_FLAG`
  `:42`, `SOURCE_HEALTH` `:50`), `EnumRender` `:16`, and `EnumBadge` `:61` — the canonical home for
  `Record<Enum, EnumRender>` maps.
- **Server-bundle trap (fails.md:1652):** `opportunityShared.tsx` is transitively imported by server
  code (`traderBff.ts:24` → `copilot.ts` → `OPPORTUNITY_ACTION`). Only a **React-free data map** may be
  added. `HALT_SOURCE` is data-only (`HaltSource` is a plain generated-enum value import, no
  `React.createContext`) — safe. Do **not** move `HaltBadge` (Step 2, lucide/tooltip) here.

**TDD**: N/A (pure refactor — no behavior change; guarded by tsc's exhaustive-`Record<HaltSource,…>`
check and the existing `e2e/trader/positions-reconciliation.spec.ts` regression, which still asserts
`Account halted:` + the `Reconciliation` badge).

**Covers**: —

**Instructions**:
1. In `src/lib/opportunityShared.tsx`: add a value import of `HaltSource` from
   `@xstockstrat/proto/trading/v1/trading_pb`, and add an **exported** `HALT_SOURCE` map identical to
   the current local const (all three keys: `UNSPECIFIED`→`{label:'—',role:'secondary'}`,
   `BRACKET_PROTECTION`→`{label:'Bracket protection',role:'paper'}`,
   `RECONCILIATION`→`{label:'Reconciliation',role:'sell'}`), placed alongside the other exported maps.
   Carry a one-line constraint comment ("exhaustive — adding a `HaltSource` value breaks tsc").
2. In `src/app/trader/positions/page.tsx`: **delete** the local `const HALT_SOURCE` (`:43-46`) **and**
   its two-line `// Kept local ...` comment (`:41-42`); add `HALT_SOURCE` to the existing
   `@/lib/opportunityShared` import (`:11`). Leave the `:368` render call unchanged.
3. Keep the `HaltSource` value import at `:23` only if still referenced after the move; if the page no
   longer references `HaltSource` directly, remove that import to satisfy lint.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "export const HALT_SOURCE" src/lib/opportunityShared.tsx        # → present
grep -n "Kept local\|const HALT_SOURCE" src/app/trader/positions/page.tsx # → no local const, comment gone
```
`pnpm run build` (real `next build`) must pass — proves the data-only map did not drag a React import
into the server bundle (fails.md:1652). Then `pnpm exec playwright test e2e/trader/positions-reconciliation.spec.ts`
stays green (regression: the positions-page indicator is unchanged).

---

### Step 2 — service: New `HaltBadge` client leaf

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/HaltBadge.tsx` — create

**Reviewers**: xstockstrat-ui owner — Trading UI correctness, UI/UX consistency (C-17)

**Codebase Evidence**:
- `Badge` primitive has an **`app-specific`** `warning` variant confirmed at
  `src/components/ui/badge.tsx:25`: `warning: 'border-transparent bg-yellow-500/20 text-yellow-400'`
  (the raw color lives inside the primitive's `cva`, the sanctioned home under C-17). Sibling variants
  `buy`/`sell` `:21-22`, `info` `:26`.
- `Tooltip` primitive exists: `src/components/ui/tooltip.tsx` (`Tooltip`/`TooltipTrigger`/`TooltipContent`).
- lucide-react is the icon lib in use (e.g. `AccountSelector.tsx:5` imports `Settings, AlertTriangle`
  from `lucide-react`); `Ban` is a valid lucide-react glyph.
- Distinctness rationale (design.md § Chosen Approach step 2): `warning` (amber) deliberately avoids
  the three-red collision with the credential-invalid `destructive` badge and the `RECONCILIATION`
  `HALT_SOURCE` (`role:'sell'`, red).

**TDD**: `red-green required` (paired test: Step 8 — the badge is asserted visible on the halted row).

**Covers**: —

**Instructions**:
1. Create `src/components/trader/HaltBadge.tsx`, a `'use client'` leaf. Props:
   `{ reason?: string; iconOnly?: boolean }`.
2. Render a `<Badge variant="warning">` containing a leading lucide `Ban` icon (as a direct-child svg,
   matching the `Badge` `[&>svg]` slot used by `EnumBadge`) and, unless `iconOnly`, the label `Halted`.
3. Wrap the badge in `Tooltip`/`TooltipTrigger`/`TooltipContent`; the tooltip content is
   `Halted: {reason}` when `reason` is non-empty, else `Halted`. Distinctness = icon + label + amber
   (C-17: no hardcoded color at this call site — the amber comes from the `warning` variant).
4. **Accessibility (C-17):** the badge must carry a unique accessible name even in `iconOnly` mode —
   set `aria-label={reason ? `Halted: ${reason}` : 'Halted'}` on the badge (the icon-only compact form
   has no visible text). React auto-escapes `reason` (system-generated `halt_reason`), so no manual
   escaping is needed.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "variant=\"warning\"\|Ban\|aria-label" src/components/trader/HaltBadge.tsx
```
No hardcoded hex/`oklch`/`hsl`/`bg-yellow-*` literal in this file (C-17): `grep -nE "#[0-9a-fA-F]{3,6}|oklch|hsl\(|bg-\[|text-\[" src/components/trader/HaltBadge.tsx` returns nothing.

---

### Step 3 — service: Register the admin-gated `resumeAccount` BFF route

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: xstockstrat-ui owner — Connect-RPC call safety, environment scope correctness; Security — auth scope (privileged mutation reaching a broker account; BFF must not widen scope at the edge)

**Codebase Evidence**:
- The `TradingService` router block in `traderBff.ts:28-58` registers the broker-account methods as
  one-line `forward(...)` handlers (`listBrokerAccounts` `:51`, `registerBrokerAccount` `:52`,
  `deregisterBrokerAccount` `:53`, `updateBrokerAccountCredentials` `:54-56`, `getTradingEnvironment`
  `:57`). New registration slots inside this block (before the closing `});` at `:58`).
- `forwardAdmin` exists at `src/lib/bffShared.ts:72-76` — `forward(call, { admin: true })`; `forward`
  (`:60-69`) runs `requireSession` (`:65`) → `requireAdminScope` (`:66`, throws
  `PermissionDenied` unless `hasAdminScope`, `:47-51`) → calls with `backendHeaders(claims, ctx)` (`:67`),
  which sets `x-user-id` / `x-access-scope` / `x-trace-id` (`:38-44`). This mirrors the RPC's
  `RequireAdminScope` server-side **without widening scope** (FR-1/FR-5). Reference `forwardAdmin`
  registrations: `insightsBff.ts:79,87`, `configUiBff.ts:66` (per recon).
- The `resumeAccount` method **already exists** on the generated `TradingService` (proto RPC
  `packages/proto/trading/v1/trading.proto:43`, `ResumeAccountRequest{account_id=1,reason=2}` `:299-302`,
  `ResumeAccountResponse{account=1}` `:304-306`). The BFF `tradingClient` (`@/lib/connectClients`) and
  the browser `tradingClient` (`src/lib/browserClients/tradingClient.ts` — `createClient(TradingService,…)`)
  both expose it with no client-file edit. Confirmed absent from the codebase today:
  `grep -rn "resumeAccount\|ResumeAccount" src/ e2e/` → no matches.

**TDD**: `red-green required` (paired test: Step 8 — non-admin rejection + admin success drive this
route through the real `dispatchConnect`).

**Covers**: —

**Instructions**:
1. In `traderBff.ts`, add `forwardAdmin` to the `@/lib/bffShared` import (`:17-23`).
2. Inside the `TradingService` block, after `getTradingEnvironment` (`:57`), register:
   `resumeAccount: forwardAdmin((req, opts) => tradingClient.resumeAccount(req, opts)),`.
   Do **not** add a per-call `userId` injection — `ResumeAccountRequest` carries only `account_id`/`reason`
   and the RPC resolves the caller from the propagated `x-user-id` header (matching the other broker-account
   forwards).
3. No browser-client change (`resumeAccount` is already on the generated client — see Evidence).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "resumeAccount: forwardAdmin" src/lib/traderBff.ts   # → present
grep -n "forwardAdmin" src/lib/traderBff.ts                  # → imported + used
```
Header propagation (C-03) is inherited from `forward`'s `backendHeaders` (`bffShared.ts:67`) — confirm
the new call reuses `forwardAdmin`, not a hand-rolled handler:
`grep -n "resumeAccount" src/lib/traderBff.ts` shows the single `forwardAdmin` registration and nothing
that bypasses `backendHeaders`. Behavioral proof is Step 8's non-admin (`PermissionDenied`) and admin
(success) cases through the real router.

---

### Step 4 — service: `AccountContext.applyAccountUpdate` (optimistic full-replace)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/context/AccountContext.tsx` — modify

**Reviewers**: xstockstrat-ui owner — Trading UI correctness

**Codebase Evidence**:
- `AccountProvider` holds `accounts` via `useState<BrokerAccount[]>([])` (`AccountContext.tsx:28`);
  `fetchAccounts` replaces the whole array (`setAccounts(fetched)` `:35`) inside a `try/catch` whose
  catch is empty — `// non-fatal — leave existing state intact` (`:41-43`). This swallowed catch is why
  a post-resume refetch failure would otherwise leave the row showing halted (design.md step 4).
- `AccountContextValue` (`:13-23`) exposes `accounts`, `refreshAccounts` (`:64` → `fetchAccounts`);
  `useAccountContext()` `:71-75`.
- `ResumeAccountResponse.account` is always a full `recordToProtoAccount` (per recon
  `trading.go:2651`) — never sparse, so a full-replace + fail-loud is correct, not a sparse merge
  (design.md § Rejected Alternatives).

**TDD**: `red-green required` (paired test: Step 8 — the indicator clears in place from the resume
response even before the background refetch settles).

**Covers**: —

**Instructions**:
1. Add `applyAccountUpdate: (account: BrokerAccount) => void` to `AccountContextValue` (`:13-23`).
2. Implement it in `AccountProvider` as a `useCallback`:
   `if (!account?.id) throw new Error('applyAccountUpdate: missing account.id')` (fail-loud, no silent
   mask), then `setAccounts(prev => prev.map(a => a.id === account.id ? account : a))` (full replace of
   the matching row; referentially safe because `fetchAccounts` already replaces objects wholesale).
3. Expose it on the `value` object (`:60-66`).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "applyAccountUpdate" src/context/AccountContext.tsx   # → in the type, the impl, and value
```
Behavioral proof is Step 8's admin resume-clears case (indicator clears from the response, independent
of the refetch).

---

### Step 5 — service: Halt indicator + admin-gated Resume action on `AccountRow`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/accountShared.tsx` — modify

**Reviewers**: xstockstrat-ui owner — Trading UI correctness, UI/UX consistency; Security — auth scope (Resume is admin-gated in the UI; enforcement is the Step 3 BFF/RPC)

**Codebase Evidence**:
- `AccountRow` (`accountShared.tsx:257-344`). The **badge row** at `:295-304` renders
  **unconditionally** (name `:296`, broker `Badge` `:297`, `CredentialStatusBadge` `:298`, optional id
  `:299-303`) — it is **not** inside the `account.isActive` gate that wraps the `RowActionsMenu` at
  `:306-330`. Placing the halt indicator here means it survives a `halted && !isActive` (deregistered-
  while-halted) row (design.md step 5; open risk: `isActive` × `halted` orthogonal, `trading.go:2720`).
- `RowActionsMenu` (`src/components/shared/RowActionsMenu.tsx:51-138`) takes `actions: RowAction[]`;
  a `RowAction` with `confirm:{title,description}` (`:37-42`) routes through a shared `AlertDialog`
  whose `AlertDialogDescription` renders `confirm.description` (`:118`) and whose action `onSelect`
  runs **only on confirm** (`:122-132`); dismiss/cancel leaves state untouched (`:110-113,121`). The
  existing `Remove` action (`:311-326`) is the reference shape.
- `useIsAdmin()` (`src/hooks/useLiveStrategies.ts:41-52`) — a `useQuery` hitting `/api/auth/me`, whose
  route returns `{ isAdmin: claims.roles?.includes('admin') }` (`src/app/api/auth/me/route.ts:11`).
- `BrokerAccount` halt fields: `account.halted` (bool), `account.haltReason` (string),
  `account.haltSource` (`HaltSource`) — proto `trading.proto:242-245` (Connect-JSON camelCase).
- Imports available in-file: `useAccountContext` (`:10`), `RowActionsMenu` (`:19`), `Badge` (`:14`).

**TDD**: `red-green required` (paired test: Step 8 — indicator shown, control admin-only, confirm-then-clears).

**Covers**: —

**Instructions**:
1. Import `HaltBadge` (`./HaltBadge`), `EnumBadge` + `HALT_SOURCE` (`@/lib/opportunityShared`),
   `useIsAdmin` (`@/hooks/useLiveStrategies`), and the `tradingClient` browser client (already imported
   `:11`).
2. In the **badge row** (`:295-304`), after `CredentialStatusBadge` (`:298`), render **gated strictly
   on `account.halted === true`**: `<HaltBadge reason={account.haltReason} />`, the React-escaped
   `account.haltReason` text, and `<EnumBadge render={HALT_SOURCE[account.haltSource]} />`. The strict
   `=== true` gate keeps a stray `UNSPECIFIED` badge off every non-halted/OFFLINE row (@AC-2/159 —
   design round-1 fix #3).
3. Add an admin-gated **Resume** action to the existing `RowActionsMenu.actions` array
   (`:310-327`, inside the `:306` `isActive` gate — a deregistered account cannot be resumed into the
   broker pool): include it only when `useIsAdmin().data === true && account.halted`. Shape:
   ```
   { label: 'Resume', onSelect: handleResume, disabled: resuming,
     confirm: { title: 'Resume account',
       description: <>Resume {account.displayName}? Halt reason: {account.haltReason}. This clears the halt and re-enables order placement.</> } }
   ```
   The `description` surfaces `halt_reason` (FR-3 / @AC-6); React escapes it.
4. Add `handleResume` (mirroring `handleRemove` `:274-286`): a `resuming` `useState`; call
   `const { account: updated } = await tradingClient.resumeAccount({ accountId: account.id })`, then
   `applyAccountUpdate(updated)` (pull from `useAccountContext()`), then a background
   `refreshAccounts()` (already destructured `:267`). Wrap in `try/finally` to reset `resuming`.
5. Pull `applyAccountUpdate` from `useAccountContext()` (`:267`).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "HaltBadge\|HALT_SOURCE\|useIsAdmin\|resumeAccount\|applyAccountUpdate\|account.halted === true" src/components/trader/accountShared.tsx
```
No hardcoded color literal added (C-17). Behavioral proof: Step 8 (@AC-1/2/3/5/6).

---

### Step 6 — service: Halt marker on `AccountSelector` (icon + folded gear dot)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AccountSelector.tsx` — modify

**Reviewers**: xstockstrat-ui owner — Trading UI correctness, UI/UX consistency

**Codebase Evidence**:
- `AccountSelector` (`AccountSelector.tsx:14-77`): `activeAccounts = accounts.filter(a => a.isActive)`
  (`:16`); per-option render at `:37-52` (credential `AlertTriangle` `:40-42`, name `:43`, broker badge
  `:44-46`); collapsed gear-dot boolean `hasCredentialIssue` (`:20-24`) drives the destructive dot at
  `:69-72`. `selected` credential badge `:56`.
- `activeAccounts` filter is unchanged by this feature — a halted account stays listed (@AC-3/157
  preserved, design.md § Business Rules).

**TDD**: `red-green required` (paired test: Step 8 — halt icon on the selected/halted option + gear dot).

**Covers**: —

**Instructions**:
1. Import `HaltBadge` from `./HaltBadge`.
2. In the per-option `<span>` (`:39-50`), render `<HaltBadge iconOnly reason={account.haltReason} />`
   when `account.halted === true` (beside the existing credential `AlertTriangle`).
3. Rename the collapsed-issue boolean `hasCredentialIssue` → `hasAccountIssue` (`:20`, used `:69`) and
   OR in halt: keep the credential-`INVALID`/`UNKNOWN` predicate and add `|| a.halted === true`, so a
   halted **non-selected** account still signals when the dropdown is collapsed (design round-2 fix #4).
   The gear dot stays `bg-destructive` (`:71`) — it is a generic "needs attention" marker; the
   halt-specific distinct marker is `HaltBadge` on the option/row (locked decision, context.md round 2).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "HaltBadge\|hasAccountIssue\|a.halted === true" src/components/trader/AccountSelector.tsx
grep -n "hasCredentialIssue" src/components/trader/AccountSelector.tsx   # → gone (renamed)
```
Behavioral proof: Step 8 selector/gear-dot assertions.

---

### Step 7 — test: Halted-account fixture + stateful mock `resumeAccount` handler

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/accounts.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify

**Reviewers**: xstockstrat-ui owner — Trading UI correctness

**Codebase Evidence**:
- Fixtures: `e2e/fixtures/accounts.ts` — `BROKER_ACCOUNT_ALPACA` (`:15-22`), `_IBKR` (`:24-31`),
  `_OFFLINE` (`:47-54`), `BROKER_ACCOUNTS = [ALPACA, IBKR]` (`:57`). Field names are Connect-JSON
  camelCase (file header `:1-10`). Catalog row for this file: `INVENTORY.md:15`.
- Mock backend trader `TradingService` block (`mock-backend.ts:242-306`): `listBrokerAccounts` (`:291`)
  returns `{ accounts: BROKER_ACCOUNTS }`; `deregisterBrokerAccount` (`:297`), `updateBrokerAccountCredentials`
  (`:300`), `getTradingEnvironment` (`:304`). **No `resumeAccount` handler exists** (confirmed:
  `grep -rn "resumeAccount" e2e/` → none).
- C-12 (test-data inventory): the halted account is a new domain object → gets a fixture module entry +
  `INVENTORY.md` row in this step.

**TDD**: N/A (test infrastructure — no product behavior; consumed by Step 8's red-before-green run).

**Covers**: —

**Instructions**:
1. In `accounts.ts`, add and export `BROKER_ACCOUNT_HALTED` — **`isActive: true` + `halted: true`
   together** (the load-bearing invariant, else the Resume action is unreachable and Step 8 greens
   vacuously — fails.md:1650 / context.md round 3 fix #1):
   `{ id: 'halted-001', displayName: 'Halted Alpaca', brokerType: 1, isPaper: true, isActive: true, credentialStatus: 1, halted: true, haltReason: 'bracket flatten failed', haltSource: 1 }`
   (`haltSource: 1` = `HALT_SOURCE_BRACKET_PROTECTION`, per proto `trading.proto:221`). A one-line
   comment states the `isActive && halted` invariant.
2. Update the `INVENTORY.md:15` Broker-accounts row to list `BROKER_ACCOUNT_HALTED` and note its
   consumer (`e2e/trader/account-resume.spec.ts`).
3. In `mock-backend.ts`, add a `resumeAccount` handler to the **trader** `TradingService` block (after
   `getTradingEnvironment` `:304`) that returns success **unconditionally**:
   `async resumeAccount() { return { account: { ...BROKER_ACCOUNT_ALPACA, halted: false } }; }`.
   Unconditional success is required so Step 8's non-admin test proves `PermissionDenied` can originate
   **only** from `forwardAdmin`, never the backend (design.md step 7; context.md round 2 fix #3). Import
   `BROKER_ACCOUNT_ALPACA` if not already in scope in that block.

**Verification**:
```
cd services/xstockstrat-ui
grep -n "BROKER_ACCOUNT_HALTED\|isActive: true" e2e/fixtures/accounts.ts   # → halted + isActive together
grep -n "BROKER_ACCOUNT_HALTED" e2e/fixtures/INVENTORY.md                  # → catalog row updated
grep -n "resumeAccount" e2e/mock-backend.ts                                # → handler present
pnpm run lint
```

---

### Step 8 — test: Playwright spec covering every acceptance scenario

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/account-resume.spec.ts` — create

**Reviewers**: xstockstrat-ui owner — Trading UI correctness; Security — auth scope (non-admin rejection path)

**Codebase Evidence**:
- Halt-mock pattern to reuse: `e2e/trader/positions-reconciliation.spec.ts:56-100` intercepts the
  **browser→BFF** fetch via
  `page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', route => route.fulfill({ body: JSON.stringify({ accounts: [ { ...BROKER_ACCOUNT_ALPACA, halted:true, haltReason, haltSource:2 }, BROKER_ACCOUNT_IBKR ] }) }))`
  then `addAuthCookie` + `page.goto` + `expect(getByText(/Account halted:/)).toBeVisible()`.
- Auth helpers: `e2e/helpers/auth.ts` — `addAdminCookie(page)` (roles `['admin']`, `:71-73`) and
  `addAuthCookie(page)` (no roles = non-admin, `:64-66`); `signTestJwt` `:29`.
- Rendered surface: `/trader/accounts` → `AccountsModule` (`src/app/trader/accounts/page.tsx`) →
  `AccountRow` rows (`AccountsModule.tsx:173-175`, no status filter applied by default `:31-42`, so a
  halted `isActive` account is listed in the default view). `AccountSelector` renders in the trader
  header/shell.
- **In-place refetch, no remount** (fails.md:1650): assert the halt clears on the already-mounted
  `/trader/accounts` page after confirm — never via `page.reload()`.

**TDD**: `red-green required` — authored to **fail** against the pre-implementation tree (no `HaltBadge`,
no Resume action, no `resumeAccount` BFF route), pass after Steps 1–7. This is the paired test for
Steps 1–6 (`spec-template.md` § Test step pairing rule / P-06). `xstockstrat-ui` has **no coverage
threshold** (`spec-template.md` coverage table = `n/a`); e2e is the verification mechanism.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6`

**Instructions**: create `e2e/trader/account-resume.spec.ts` importing fixtures from `../fixtures`
(`BROKER_ACCOUNT_HALTED`, `BROKER_ACCOUNT_ALPACA`, `BROKER_ACCOUNT_IBKR`) and auth helpers from
`../helpers/auth` (C-12 — no inline domain literals). Cases:

- **@AC-1** (admin, `addAdminCookie`): `page.route` `ListBrokerAccounts` → `[BROKER_ACCOUNT_HALTED,
  BROKER_ACCOUNT_ALPACA]`; goto `/trader/accounts`; assert the halted row shows the `Halted` badge, the
  reason text `bracket flatten failed`, and the `HALT_SOURCE` badge `Bracket protection` — with **no
  order placed** (page load only).
- **@AC-2** (admin): same two-account route (one halted, one healthy); open each row's actions menu;
  assert the halted row exposes a **Resume** item and the healthy row does **not**.
- **@AC-3** (admin, stateful): a closure `let resumed = false`. `page.route` `ListBrokerAccounts` →
  returns `BROKER_ACCOUNT_HALTED` while `!resumed`, else `{ ...BROKER_ACCOUNT_HALTED, halted:false }`.
  Do **not** intercept `ResumeAccount` — let it hit the real BFF (`forwardAdmin` → mock-backend
  `resumeAccount` success). Click Resume → confirm the dialog → set `resumed = true` inside the
  `ListBrokerAccounts` route handler on the next call. Assert **in place** (no reload): the `Halted`
  badge disappears and the Resume action is gone. (Header propagation — `x-user-id`/`x-access-scope`/
  `x-trace-id` — is structurally carried by `forwardAdmin`'s `backendHeaders`, Step 3; the visible
  clear proves the round-trip succeeded.)
- **@AC-4** (admin, non-halted no-op): issue a **direct** BFF call via
  `page.evaluate(() => fetch('/trader/api/xstockstrat.trading.v1.TradingService/ResumeAccount', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ accountId:'alpaca-default' }) }).then(r => r.status))`
  and assert `200` (the mock backend returns success unconditionally; benign no-op through the
  idempotent RPC).
- **@AC-5** (non-admin, `addAuthCookie`): `page.route` `ListBrokerAccounts` → halted account; goto
  `/trader/accounts`; assert the halted row shows **no** Resume action (open the actions menu; Resume
  absent). Then issue the same direct `fetch` to `.../ResumeAccount` via `page.evaluate` and assert the
  response status is `403` (Connect maps `PermissionDenied`) — proving `forwardAdmin` rejects at the
  edge even though the mock backend would succeed (isolates @AC-4/169).
- **@AC-6** (admin): `page.route` halted account; click Resume; assert a confirmation dialog appears
  showing the reason `bracket flatten failed`; assert **no** `ResumeAccount` request fires until
  confirm (track with a `page.route`/request listener on `**/TradingService/ResumeAccount`); dismiss
  the dialog and assert the row is still halted.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
pnpm exec playwright test e2e/trader/account-resume.spec.ts --project=chromium
```
All six scenarios pass. Confirm fixture imports (C-12):
`grep -n "from '../fixtures'\|from '../helpers/auth'" e2e/trader/account-resume.spec.ts`. Run once more
to confirm no flake on the stateful @AC-3 case (the assertion waits for the settled post-refetch frame,
never a `reload()`).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
