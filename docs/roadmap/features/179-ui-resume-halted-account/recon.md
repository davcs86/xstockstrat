# Recon: ui-resume-halted-account

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-ui, xstockstrat-trading (consumed, not modified)

---

## Objective

Add a `resumeAccount` trader-BFF route + a Resume control (with a halt-reason confirmation dialog) +
a halt indicator on the account-management surface, matching the `ResumeAccount` RPC's current
admin-only scope. No trading-service change. Closes the UI-trigger gap feature 169 deferred.

## Codebase Map

- **`xstockstrat-ui`** (Next.js) — the only modified service
  - Trader BFF handler map: `src/lib/traderBff.ts:51-56` (`listBrokerAccounts`/`registerBrokerAccount`/`deregisterBrokerAccount`/`updateBrokerAccountCredentials`, one-line `forward(...)`); `resumeAccount` slots after `:57`
  - Admin-gated BFF helper to REUSE: `forwardAdmin` `src/lib/bffShared.ts:72-76` (built on `forward` + `requireAdminScope` `:47-51,60-69`); reference registrations `insightsBff.ts:79,87`, `configUiBff.ts:66`
  - Account components: `AccountRow`/`accountShared.tsx:257`; `credentialStatus` badge `:298`; confirm-based destructive-action pattern `RowActionsMenu` with `confirm:{title,description}` `:308-328`; container `AccountsModule.tsx` (status filter `:38-40`); rendered surface `src/app/trader/accounts/page.tsx:5-13` (`/trader/accounts`, inside `AppShell` — C-10 reachable)
  - Halt indicator to REUSE: positions page `src/app/trader/positions/page.tsx:363-370` (`Account halted: {haltReason}` + `EnumBadge`); `HALT_SOURCE` badge map `:43-47`; enum from `trading_pb` `:23`; `EnumBadge`/`EnumRender` from `@/lib/opportunityShared`
  - Halt data path: `src/context/AccountContext.tsx:34` (`tradingClient.listBrokerAccounts({})` → `accounts: BrokerAccount[]`); `useAccountContext()` `:71`; `refreshAccounts()` for post-resume refresh
  - Client admin gate to REUSE: `useIsAdmin()` `src/hooks/useLiveStrategies.ts:41-48` (from `/api/auth/me`, server-derived `isAdmin`); server scope source `src/lib/auth.ts:79` (`ADMIN_SCOPE=0x04`), `hasAdminScope :95`
  - Confirm dialog primitive: shadcn `AlertDialog` `src/components/ui/alert-dialog.tsx`; ready-made wrapper `src/components/shared/RowActionsMenu.tsx:109-135` (renders AlertDialog from `confirm:{title,description,confirmLabel,cancelLabel}`, `onSelect` runs only on confirm)
  - Typed browser client: `src/lib/browserClients/tradingClient.ts` (baseUrl `/trader/api`)
  - Fixtures/mocks: `e2e/fixtures/accounts.ts:15-50` (`BROKER_ACCOUNT_*`); halt mock example `e2e/trader/positions-reconciliation.spec.ts:56-99` (spreads `halted:true, haltReason, haltSource:2` over `listBrokerAccounts`, asserts `/Account halted:/`)
- **`xstockstrat-trading`** (Go) — contract only, NOT modified
  - `ResumeAccount` RPC `packages/proto/trading/v1/trading.proto:43`; `ResumeAccountRequest{account_id=1, reason=2}` / `ResumeAccountResponse{account=1}` `:299-306`; doc "Admin-scope callers only. Idempotent" `:40-42`
  - Handler `internal/handler/trading.go:321`; `ResumeAccountSvc` `internal/service/trading.go:2748` (idempotent no-op if not halted `:2759`; DB-first clear `:2767`; in-memory clear `:2772`; ledger `account.halt.resumed` `:2779`; INFO notify `:2787`)
  - Admin-scope gate to MIRROR: `RequireAdminScope` `internal/service/trading.go:2749`; `AdminScope=0x04` `internal/middleware/authz.go:13`, check `:23` (empty/non-numeric scope → 0 = denied)
  - Halt fields returned by `ListBrokerAccounts`: `BrokerAccount.halted=9/halted_at=10/halt_reason=11/halt_source=12` `trading.proto:242-245`; `HaltSource` enum `:219-223` (UNSPECIFIED/BRACKET_PROTECTION/RECONCILIATION); populated by `recordToProtoAccount` `internal/service/trading.go:2664`, returned by `ListBrokerAccountsSvc` `:2637`

## Patterns to REUSE

- **BFF route** → `forwardAdmin` `bffShared.ts:72` (mirrors the RPC's admin-only gate at the edge without widening scope) — register `resumeAccount` after `traderBff.ts:57`.
- **Halt indicator** → copy the positions-page `HALT_SOURCE` map + `EnumBadge` render (`positions/page.tsx:43-47,363-370`) into the account row (`accountShared.tsx` near the `credentialStatus` badge `:298`).
- **Confirm dialog surfacing halt_reason** → `RowActionsMenu` `confirm:{title,description}` `accountShared.tsx:308-328` / `RowActionsMenu.tsx:109-135` — put `halt_reason` in the description; `onSelect` calls the resume mutation.
- **Client admin gate** → `useIsAdmin()` `useLiveStrategies.ts:41` to conditionally render the control.
- **Post-resume refresh** → `refreshAccounts()` on `AccountContext` `:34` (re-fetch `ListBrokerAccounts` → indicator clears).
- **Fixtures** → extend `e2e/fixtures/accounts.ts` with a halted account; reuse the `positions-reconciliation.spec.ts:56` halt-mock spread pattern (C-12).

## Existing Business Rules (preserve / extend)

All PRESERVE — the RPC is unchanged; UI additions are additive.
- **PRESERVE** `@AC-1 @feature-169` "ResumeAccount clears persistent + in-memory halt state" (`services/xstockstrat-trading/acceptance/resume-halted-account.feature`) — FR-4's indicator-clears-on-success depends on it.
- **PRESERVE** `@AC-2/@AC-3 @feature-169` — ledger `account.halt.resumed` + INFO alert fire on resume; the BFF route calls the same RPC, must not regress.
- **PRESERVE** `@AC-4 @feature-169` "rejects non-operator callers with PERMISSION_DENIED" — the who-may-resume enforcement. Titled "non-operator" but enforces admin-only; a `trader` caller is denied under either reading, so the admin-only approach preserves it. FR-1/FR-5 (BFF propagates scope without widening; RPC is the enforcement) rely on this.
- **PRESERVE** `@AC-6 @feature-169` "resume on a non-halted account is a no-op" — FR-4 idempotent benign no-op.
- **PRESERVE** `@AC-7 @feature-169` "reconciliation poller resumes ticking after resume" — backend side effect; UI path must not alter it.
- **PRESERVE** `@AC-3 @feature-157` "offline accounts appear alongside broker accounts in the selector" (`services/xstockstrat-ui/acceptance/offline-account-portfolios.feature`) — the surface FR-2 adds to must keep listing both.
- **PRESERVE** `@AC-2 @feature-159` "offline card hides broker-only fields" (`.../fix-offline-account-ui-gaps.feature`) — halt is broker-agnostic (applies to OFFLINE rows); the indicator must not resurface broker-only fields.
- **NET-NEW `@AC-*` (author here)**: no promoted rule guards the positions-page halt indicator or any credential/halt display; this feature's own `acceptance.feature` scenarios are net-new, not regressions.

## Dependencies

- Proto/RPC: none (`ResumeAccount` + halt fields already exist; consumed only).
- Migration: none.
- Config keys: none.
- Inter-service edges: UI BFF → trading `ResumeAccount` (new call from the UI; RPC pre-exists).
- New env vars / ports: none.

## Risks / Not-found

- **Scope decision (resolved conservative, flagged for override)**: RPC enforces admin-only; feature 169 FR-5 *intended* operator-or-admin, but `@AC-4` (the only promoted rule) only proves a `trader` caller is denied — it does NOT authorize an operator button. This feature matches admin-only; widening reopens the RPC and would be a C-16 CHANGE needing sign-off. **Correction to product-spec citation**: `docs/context-constitution-findings.md` does NOT actually record this admin-vs-operator discrepancy (recon could not find it); the discrepancy is real (RPC admin-only vs 169 FR-5 wording) but undocumented — do not cite findings as its source.
- **C-10 divergent action site**: control lives solely on account-mgmt; positions page stays indicator-only (avoid two action sites).
- **Broker-agnostic on OFFLINE rows**: adding the indicator to an offline account card must not resurface broker-only fields (`@AC-2 @feature-159`).
- **`AccountSelector.tsx`**: not fully read — confirm at spec time whether the halt indicator belongs there too (it's a second consumer of the account list).
- No `resumeAccount` in BFF/browser-client/e2e today — all net-new (small, well-templated).

## Recommended Scope

1. UI BFF: register `resumeAccount` via `forwardAdmin` (`traderBff.ts`). (FR-1)
2. UI: halt indicator on `AccountRow` reusing the positions-page `HALT_SOURCE`/`EnumBadge` pattern. (FR-2)
3. UI: admin-gated Resume control on the halted row with an `AlertDialog` confirm surfacing `halt_reason`; on confirm call the BFF route, then `refreshAccounts()`. (FR-3/FR-4/FR-5)
4. e2e: extend `accounts.ts` fixtures + a Playwright spec covering halted-indicator, admin-only visibility, confirm-then-resume-clears, non-admin-denied. (C-12)
