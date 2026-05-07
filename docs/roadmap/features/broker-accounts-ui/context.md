# Context: broker-accounts-ui

**Feature**: `docs/roadmap/features/broker-accounts-ui/feature.md`
**Product Spec**: `docs/roadmap/features/broker-accounts-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/broker-accounts-ui/implementation-spec.md`

---

## Session 2026-05-06T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.

## Session 2026-05-06T00:01:00Z — OQ resolution

- OQ-1 RESOLVED: Account Selector in global persistent header (root layout). Avoids per-page fetch duplication and prop drilling.
- OQ-2 RESOLVED: insights defaults to first account; "All Accounts" option aggregates client-side; selection in URL state for deep-link support.
- Control panel (RegisterBrokerAccount / DeregisterBrokerAccount UI) initially deferred, then REVERSED: brought into scope (FR-9 through FR-12). Personal-use context makes the security tradeoff acceptable. Credential fields use `<input type="password">`; inputs cleared on success; no credentials in state after submission.
- SSL/TLS: kept out of scope as a deployment concern. DO App Platform provides HTTPS automatically in production; self-hosted path is reverse proxy (nginx/Caddy). No application changes needed to support either.
- Story: expand `add-ikbr-account-support` scope into a new feature to surface broker accounts in the trader UI.
- Slug `broker-accounts-ui` chosen over literal first argument `expand` (action verb, not a feature name).
- This feature is the explicit UI follow-up deferred in `add-ikbr-account-support` product-spec "Out of Scope": "xstockstrat-trader UI changes: account_id and broker_type are available on Order proto; account selector UI and per-account portfolio view are follow-up features."
- No new proto, migrations, or config keys required — all backend RPCs are already defined by `add-ikbr-account-support`.
- Dependency noted: `feature/add-ikbr-account-support` must be merged to main-dev before this branch's integration PR can land.

## Session 2026-05-06T00:02:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: xstockstrat-trader and xstockstrat-insights both also modified by add-ikbr-account-support (in-progress). Advisory only — no FAIL-level conflicts (no shared migrations, proto fields, or config keys).
- Overlap findings: add-ikbr-account-support [in-progress] touches same two services. Ordering dependency already captured in product spec Feature Workflow Notes. merge-order.md manual entry recommended to make /sdd-execute guard enforceable.

## Session 2026-05-06T00:03:00Z — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings:
  - Broker account RPCs (ListBrokerAccounts, RegisterBrokerAccount, DeregisterBrokerAccount) and ListPortfolios are NOT yet in `packages/proto/gen/ts/trading/v1/trading_connect.ts` or `portfolio_connect.ts` on main-dev — add-ikbr-account-support Steps 3-18 are pending. All new Connect-RPC calls in this feature must use manual service descriptors matching the pattern at `services/xstockstrat-trader/src/lib/connectClients.ts` (MethodKind.Unary with `I: {} as any, O: {} as any`).
  - `zustand` is already in both `services/xstockstrat-trader/package.json` (L35) and `services/xstockstrat-insights/package.json` (L35) — no new dependency needed for state management.
  - `services/xstockstrat-trader/src/app/layout.tsx` currently has no React context provider wrapping children (L12-18) — a new `AccountProvider` must be inserted in Step 2.
  - `services/xstockstrat-insights/src/lib/connectTransport.ts` does not export `TRADING_BASE_URL` or `PORTFOLIO_BASE_URL` (confirmed at L28-44) — the insights portfolio route (Step 7) must declare its own base URL constants and those env vars must be added to the service CLAUDE.md and app specs.
  - Last migration numbers (not relevant — no migrations required): trading 001, portfolio 002; confirmed from add-ikbr-account-support impl-spec.
  - `services/xstockstrat-trader/e2e/mock-backend.ts` uses a Node.js HTTP server on port 9091; mock responses are keyed by Connect-RPC path. Steps 8-9 extend these mocks.
  - `merge-order.md` already has the blocking dependency entry for broker-accounts-ui → add-ikbr-account-support (confirmed at L19).

### Step 1 — Extend `connectClients.ts` with broker-account and portfolio-list service descriptors [done]
- Added `listBrokerAccounts`, `registerBrokerAccount`, `deregisterBrokerAccount` to `TradingServiceDef.methods` and `listPortfolios` to `PortfolioServiceDef.methods` in `services/xstockstrat-trader/src/lib/connectClients.ts`.
- Files modified: `services/xstockstrat-trader/src/lib/connectClients.ts`
- Deviations: none (pnpm install was required before build since node_modules were absent in the session; this is a session setup issue, not a spec deviation)

## Session 2026-05-07T00:00:00Z — sdd-execute
**Steps this session**: [1]
**Progress**: 1 done / 9 total
**Stopped at**: Step 1 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next

### Step 2 — Add `AccountContext` and `AccountProvider` to root layout in `xstockstrat-trader` [done]
- Created `src/context/AccountContext.tsx` with `BrokerAccount` type, `AccountContextValue` interface, `AccountContext`, `AccountProvider` (fetches `/api/accounts` on mount, auto-selects first active account), and `useAccountContext` hook. Modified `src/app/layout.tsx` to wrap `{children}` with `<AccountProvider>`.
- Files modified: `services/xstockstrat-trader/src/context/AccountContext.tsx`, `services/xstockstrat-trader/src/app/layout.tsx`
- Deviations: none

## Session 2026-05-07T00:01:00Z — sdd-execute
**Steps this session**: [2]
**Progress**: 2 done / 9 total
**Stopped at**: Step 2 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next

### Step 3 — Add `/api/accounts` route handler to `xstockstrat-trader` [done]
- Created `api/accounts/route.ts` (GET→ListBrokerAccounts, POST→RegisterBrokerAccount), `api/accounts/[id]/route.ts` (DELETE→DeregisterBrokerAccount), and `api/portfolio/accounts/route.ts` (GET→ListPortfolios). All three routes appear in the Next.js build output.
- Files modified: `services/xstockstrat-trader/src/app/api/accounts/route.ts`, `services/xstockstrat-trader/src/app/api/accounts/[id]/route.ts`, `services/xstockstrat-trader/src/app/api/portfolio/accounts/route.ts`
- Deviations: DELETE handler uses `_: Request` instead of `_req: NextRequest` — ESLint no-unused-vars error with no argsIgnorePattern; full detail in Deviation Log.

## Session 2026-05-07T00:02:00Z — sdd-execute
**Steps this session**: [3]
**Progress**: 3 done / 9 total
**Stopped at**: Step 3 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next

### Step 4 — Build `AccountSelector` and `AccountManagementPanel` components [done]
- Created `AccountSelector.tsx` (Select + gear Sheet button, reads from AccountContext, active accounts only) and `AccountManagementPanel.tsx` (account list with remove/confirm flow, add-account form with dynamic Alpaca/IBKR credential fields, credential cleanup on unmount).
- Files modified: `services/xstockstrat-trader/src/components/AccountSelector.tsx`, `services/xstockstrat-trader/src/components/AccountManagementPanel.tsx`
- Deviations: none

## Session 2026-05-07T00:03:00Z — sdd-execute
**Steps this session**: [4]
**Progress**: 4 done / 9 total
**Stopped at**: Step 4 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next
