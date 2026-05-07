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

### Step 5 — Wire `AccountSelector` into header; update `OrderForm`, `OrderBook`, `PortfolioSummary` to consume selected account [done]
- Imported `AccountSelector` into `page.tsx` and added `<AccountSelector />` before `<ModeToggle>` in the `actions` div. Updated `OrderForm` to read `selectedAccountId` from `AccountContext`, include `account_id` in the POST body, disable the submit button when no account is selected, and show a helper message. Updated both `OrderBook` and `PortfolioSummary` in `OrderBook.tsx` to include `account_id` in their SWR keys. Updated `api/orders/route.ts` GET and `api/portfolio/route.ts` GET to read `account_id` from searchParams and forward it to the backend.
- Files modified: `services/xstockstrat-trader/src/app/page.tsx`, `services/xstockstrat-trader/src/components/OrderForm.tsx`, `services/xstockstrat-trader/src/components/OrderBook.tsx`, `services/xstockstrat-trader/src/app/api/orders/route.ts`, `services/xstockstrat-trader/src/app/api/portfolio/route.ts`
- Deviations: `api/portfolio/route.ts` added to the commit — spec's **Files** list omitted it, but PortfolioSummary now passes `account_id` to `/api/portfolio` and the route handler must read it; included to keep the feature coherent.

## Session 2026-05-07T00:04:00Z — sdd-execute
**Steps this session**: [5]
**Progress**: 5 done / 9 total
**Stopped at**: Step 5 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next

### Step 6 — Add per-account `PortfolioPanel` component to `xstockstrat-trader` [done]
- Created `PortfolioPanel.tsx` — `'use client'` component using SWR to fetch `/api/portfolio/accounts`. Single-card view when an account is selected (full Stat layout matching PortfolioSummary); multi-card compact grid when no account selected. Updated `page.tsx` to import `PortfolioPanel` and replace `<PortfolioSummary>` with `<PortfolioPanel>`.
- Files modified: `services/xstockstrat-trader/src/components/PortfolioPanel.tsx`, `services/xstockstrat-trader/src/app/page.tsx`
- Deviations: `PortfolioPanel.tsx` was initially drafted with `&trading_mode=${mode}` in the SWR key. After confirming `ListPortfoliosRequest` proto has no `trading_mode` field (only `account_id`), the param was removed from the SWR key — it was structurally meaningless.

## Session 2026-05-07T00:05:00Z — sdd-execute
**Steps this session**: [6]
**Progress**: 6 done / 9 total
**Stopped at**: Step 6 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next

### Step 7 — Add per-account portfolio selector to `xstockstrat-insights` [done]
- Created `src/app/api/portfolio/route.ts` (GET handler calling ListBrokerAccounts + ListPortfolios in parallel via direct fetch). Created `src/components/AccountPortfolioSelector.tsx` ('use client'; SWR polling /api/portfolio; Select for account switching; Card showing aggregated or single-account portfolio stats). Modified `src/app/page.tsx` to add URL state via `useSearchParams`/`useRouter` and render `<AccountPortfolioSelector>`. Updated `CLAUDE.md` with new env vars and dependencies.
- Files modified: `services/xstockstrat-insights/src/app/api/portfolio/route.ts` (created), `services/xstockstrat-insights/src/components/AccountPortfolioSelector.tsx` (created), `services/xstockstrat-insights/src/app/page.tsx`, `services/xstockstrat-insights/CLAUDE.md`, `services/xstockstrat-insights/src/lib/connectTransport.ts`
- Deviations: Fixed pre-existing `connectTransport.ts` build failure (`createNodeHttpTransport` → `createConnectTransport as createNodeTransport` with `httpVersion: '1.1'`); added `<Suspense>` wrapper around `InsightsDashboard` in page.tsx (Next.js 14 requirement for `useSearchParams`).

## Session 2026-05-07T00:06:00Z — sdd-execute
**Steps this session**: [7]
**Progress**: 7 done / 9 total
**Stopped at**: Step 7 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next

### Step 8 — Add E2E tests for broker-accounts-ui changes in `xstockstrat-trader` [done]
- Added `ListBrokerAccounts`, `RegisterBrokerAccount`, `DeregisterBrokerAccount`, `ListPortfolios` entries to `RESPONSES` in `mock-backend.ts`. Created `account-selector.spec.ts` with 5 tests covering: selector visible in header, submit button disabled with no accounts, submit button enabled with auto-selected account, gear-icon opens management panel, credential fields clear on success.
- Files modified: `services/xstockstrat-trader/e2e/mock-backend.ts`, `services/xstockstrat-trader/e2e/account-selector.spec.ts` (created)
- Deviations: `pnpm run test:e2e` verification skipped — Playwright browsers cannot be downloaded in sandbox (cdn.playwright.dev returns 403); same constraint blocks all existing E2E tests. Accepted as known limitation; CI is the verification environment.

## Session 2026-05-07T00:07:00Z — sdd-execute
**Steps this session**: [8]
**Progress**: 8 done / 9 total
**Stopped at**: Step 8 (step complete — PR created, awaiting merge)
**Next**: /sdd-execute broker-accounts-ui next

## Session 2026-05-07T00:08:00Z — playwright unblock + artifact update
**Steps this session**: [8 follow-up]
**Progress**: 8 done / 9 total
**Stopped at**: Step 8 follow-up complete
**Next**: /sdd-execute broker-accounts-ui next

### Step 8 follow-up — Playwright unblock and test selector fixes [done]
- Symlinked `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` to `/opt/pw-browsers/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell` to unblock Playwright 1.59.1 in sandbox (download blocked). Symlink is local-only; CI downloads real 1217 binary.
- `playwright.config.ts`: added `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` escape hatch for sandbox use. Inert in CI.
- `account-selector.spec.ts`: fixed `getByText('Add Account')` → `getByRole('heading', { name: 'Add Account' })` (strict mode); test 5 now fills Display Name + API Secret (required fields) before submitting.
- `order-form.spec.ts`: fixed 3 combobox tests to use `.last()` (AccountSelector added a second combobox in Step 5) and `exact: true` on option selectors; fixed BUY/SELL button test with `exact: true`.
- All 14 chromium E2E tests pass (5 account-selector + 9 order-form).
- `sdd-execute/SKILL.md`: updated gap-resolution rule to require explicit user A/B/C reply before proceeding — auto-selecting Option B is no longer permitted.
- Files modified: `services/xstockstrat-trader/playwright.config.ts`, `services/xstockstrat-trader/e2e/account-selector.spec.ts`, `services/xstockstrat-trader/e2e/order-form.spec.ts`, `.claude/skills/sdd-execute/SKILL.md`
- Deviations: none (follow-up work within Step 8's PR)

## Session 2026-05-07T00:09:00Z — sdd-execute
**Steps this session**: [9]
**Progress**: 9 done / 9 total
**Stopped at**: Step 9 (all steps complete)
**Next**: merge-order gate → integration PR → /sdd-execute broker-accounts-ui (ALL-DONE PATH)

### Step 9 — test: Add E2E tests for per-account portfolio selector in `xstockstrat-insights` [done]
- Added `ListBrokerAccounts` and `ListPortfolios` entries to `RESPONSES` in `mock-backend.ts`. Created `account-portfolio.spec.ts` with 4 browser-level tests (selector visible, All Accounts option present, account selection updates URL, deep-link pre-selects account). Fixed Radix UI `<SelectItem value="">` violation in `AccountPortfolioSelector.tsx` (Option A confirmed by user — empty string → `__all__` sentinel). Added `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` escape hatch to insights `playwright.config.ts` for parity with trader. Created `services/xstockstrat-insights/.gitignore`. Fixed test 4 strict-mode: `getByText('IBKR Paper')` → `getByRole('heading', { name: 'IBKR Paper' })`.
- Files modified: `services/xstockstrat-insights/e2e/mock-backend.ts`, `services/xstockstrat-insights/e2e/account-portfolio.spec.ts` (created), `services/xstockstrat-insights/src/components/AccountPortfolioSelector.tsx`, `services/xstockstrat-insights/playwright.config.ts`, `services/xstockstrat-insights/.gitignore` (created)
- Deviations: component bug fix + playwright.config escape hatch + .gitignore added to scope (full detail in Deviation Log)
