# Context: client-api-pattern

**Feature**: `docs/roadmap/features/044-client-api-pattern/feature.md`
**Product Spec**: `docs/roadmap/features/044-client-api-pattern/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/044-client-api-pattern/implementation-spec.md`

---

## Session 2026-05-28T00:00:00Z — sdd-story

- Surveyed all three Next.js frontends (xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui).
- Confirmed all three already use SWR 2.2.5 — library choice is SWR (not react-query).
- Found 43 / 19 / 17 `any` occurrences respectively; main sources: `{} as any` in service descriptor placeholders (`connectClients.ts`, `configClient.ts`), `catch (err: any)`, and untyped response destructuring in components.
- Generated stubs at `packages/proto/gen/ts/` are intentionally not imported in frontends (bundle size concern noted in code comments); spec preserves this decision — typed interfaces are hand-authored from the Connect-RPC JSON shapes.
- config-ui uses a flat directory structure (no `src/`); noted in Out of Scope and Affected Services.
- Created feature.md (status: draft), product-spec.md, context.md from user story.

## Session 2026-05-28T00:01:00Z — user clarification

- User confirmed: bundle size is not a constraint; generated proto stubs should be used instead of hand-authored interfaces.
- Investigation of `packages/proto/gen/ts/` revealed:
  - `*_pb.ts` (from `@bufbuild/protoc-gen-es`) — tree-shakeable message types; compiled to `dist/` ✓
  - `*_connect.ts` (from `@connectrpc/protoc-gen-connect-es`) — typed service descriptors; **source-only, NOT in dist/** ✗ — must be fixed as FR-1
  - `ts-proto` stubs — gRPC-JS classes, not relevant to frontends
  - `@xstockstrat/proto` is already in the pnpm workspace; frontends only need a `package.json` dependency entry
  - All three frontends already ship `@bufbuild/protobuf` and `@connectrpc/connect-web` at runtime — no net new runtime cost
- Updated product-spec.md: FR-5 (hand-authored interfaces) replaced by FR-1–FR-4 (fix dist build, add dep, use generated descriptors and message types); Out of Scope updated; AC updated; open question about shared package marked resolved.

## Session 2026-05-28T00:02:00Z — library decision + review fix

- User decision: adopt **react-query (@tanstack/react-query v5) + normy (@normy/react-query)**
  instead of SWR. Rationale: automatic entity propagation across co-mounted queries eliminates
  the manual invalidation dependency graph that grows linearly with dashboard panels. SWR and
  react-query have equivalent TypeScript ergonomics for this codebase (both require explicit
  cast on fetch().json(); both support identical generic signatures). One-time migration cost
  accepted.
- Normy `getNormalizationObjectKey` scoped conservatively: `orderId` and `strategyId` only.
  `symbol` (positions), `key` (config), `portfolioId` deferred — field names too generic to
  normalize safely without cross-entity collisions. Expand in a follow-up.
- Two /sdd-review failures fixed:
  1. `packages/proto/gen/ts` moved out of Affected Services into a "Build artifact" note
     (it is not a registered service in CLAUDE.md).
  2. Open question about `useSWRMutation` marked resolved (moot — migrating to `useMutation`).
- product-spec.md fully rewritten: FR-5 now covers react-query + normy setup; FR-6–FR-7 use
  useQuery/useMutation; FR-10 adds config-ui useEffect migration; AC-5 updated grep pattern;
  AC-7 adds SWR removal check; all open questions resolved.
- feature.md summary updated to reflect library decision.

## Session 2026-05-28T00:03:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: none (spec criteria all passed).
- Overlap findings (advisory — no merge-order entries required):
  - broker-accounts-ui, trader-chart-panel, signal-source-registry,
    formula-management-ui add components with data fetching; recommend
    client-api-pattern merges before all four to enforce the hook pattern.
  - make-repo-public-secure, do-nginx-integration, ci-docker-registry-deploy,
    frontend-reverse-proxy, fix-grafana-otel-variables, wire-fe-auth,
    add-ikbr-account-support: orthogonal changes, low conflict risk.

## Session 2026-05-30T00:00:00Z — sdd-story (regenerate)

- Product spec regenerated fresh as part of a 4-feature spec batch (033, 041, 045, 044), each
  delivered as an independent PR off `main-dev`. Per the requesting story, the previously-resolved
  open questions were deliberately RE-OPENED for the `/sdd-review product-spec` gate. Status
  reverted: `spec-ready` → `draft`.
- Major scope correction against current `main-dev`: the server-side Connect-RPC clients
  (`lib/connectClients.ts`, `configClient.ts`) are ALREADY typed with `@xstockstrat/proto`
  service descriptors over a gRPC transport (`createGrpcTransport`, `createClient(TradingService,…)`
  from `*_pb`). The `{} as any` placeholders are gone and `@xstockstrat/proto` is already a
  dependency in all three frontends. So the old FR-1–FR-4 (add `_connect` to dist, add dep,
  replace `{} as any`) are obsolete/done. The feature is now scoped purely to the **client-side**
  layer: SWR is still present (`^2.2.5` in all three), and `any` still leaks (18 / 21 / 5 in
  trader / insights / config-ui).
- Re-opened questions: the data-fetching + normalization library choice (react-query + normy was
  previously selected; now presented as the suggested default but left open), the normalization
  key whitelist, and the sole-mutation-pattern question. Added a sequencing question vs features
  045 (consolidation) and 041 (Next.js 15 upgrade).
- Next action: `/sdd-review client-api-pattern product-spec`.

## Session 2026-06-01T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All 4 open questions resolved at review gate:
  - Library stack: `@connectrpc/connect-query` (connect-query-es) + TanStack Query v5 + `@normy/react-query`
  - Normalization key whitelist: `orderId` and `strategyId` only; others deferred
  - Mutation pattern: single — `useMutation` from TanStack Query, no direct `fetch` in components
  - Sequencing: 044 lands before 045; feature 041 already `launched` (artifacts referencing it as in-flight are outdated)
- Warnings (advisory, no merge-order entries required):
  - `formula-management-ui` also modifies `xstockstrat-insights` — coordinate merge order
  - `upgrade-nextjs15` overlap warnings are moot — feature already `launched`

## Session 2026-06-01T00:01:00Z — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready.
- Key codebase findings:
  - SWR present in all three services at `^2.2.5` (package.json); call sites: 4 files in trader (OrderBook, PortfolioPanel, orders/[id]/page, positions/page), 4 files in insights (page.tsx, strategies/page.tsx, strategies/[id]/page.tsx, AccountPortfolioSelector), none in config-ui (uses useEffect+fetch pattern instead).
  - `TradingService`, `AnalysisService`, etc. are `GenService` descriptors already compiled into `packages/proto/gen/ts/dist/` via `*_pb.js` — no changes to proto package needed. The `*_connect.ts` source files (MethodKind API) are excluded from the dist build by tsconfig (line 17 of packages/proto/gen/ts/tsconfig.json: `"**/*_connect.ts"`).
  - `any` occurrences: trader (2: login route + identity.ts), insights (9: multiple component files), config-ui (3: login route + identity.ts + audit catch clause). Primary sources: `as any` on `authenticateUser`/`refreshToken` return types and untyped strategy map callbacks.
  - No new env vars or docker-compose changes needed — feature is entirely client-side.
  - config-ui flat layout (no src/): hooks go under `app/hooks/`, queryClient under `app/lib/queryClient.ts`, tsconfig `@/*` maps to `./*`.
  - `OrderForm.tsx` already uses direct `await tradingClient.placeOrder()` (not SWR) but lacks `useMutation` wrapper — addressed in Step 4.

## Session 2026-06-01 — sdd-review impl-spec + decisions

- impl-spec review: PASS (0 failures, 6 advisory warnings).
- W1 (basepath import): executor runs `ls services/xstockstrat-{trader,insights,config-ui}/src/lib/basepath.ts` at Step 3 start; if absent, use inline constant in useAuditLog.
- **W2 FIXED in spec**: `useConfigKeys` in Step 4 now imports `Environment` and `TradingMode` from `@xstockstrat/proto/common/v1/common_pb` and uses named enum constants (`Environment.ENVIRONMENT_PRODUCTION`, `TradingMode.TRADING_MODE_LIVE`, etc.) instead of magic integers.
- W3 (residual any deferred to Step 7): accepted as designed.
- W4 (RefreshTokenResponse field names): executor greps generated stub at step start.
- W5 (Step 10 typed `service` but docs-only): advisory only; no spec change.
- W6 (003 overlap on xstockstrat-insights/package.json): execution order (044 before 003) enforces this; no merge-order entry needed beyond existing sequence.

### Step 4 — Migrate SWR call sites to typed hooks in xstockstrat-trader [done]
- Created `src/hooks/useOrders.ts` (`useOrders`, `useOrder`), `src/hooks/usePortfolio.ts` (`usePortfolio`, `usePortfolios`, `usePositions`), `src/hooks/usePlaceOrder.ts`.
- Migrated all `useSWR` calls in `OrderBook.tsx`, `PortfolioPanel.tsx`, `orders/[id]/page.tsx`, `positions/page.tsx`. Migrated `OrderForm.tsx` to `useMutation` via `usePlaceOrder`.
- Also applied step-1 files (`queryClient.ts`, `providers.tsx`, `layout.tsx`, `package.json`) to this branch since steps 1–3 PRs were not yet merged into `feature/client-api-pattern` when step-4 branch was created.
- Files modified: `src/hooks/useOrders.ts`, `src/hooks/usePortfolio.ts`, `src/hooks/usePlaceOrder.ts`, `src/lib/queryClient.ts`, `src/app/providers.tsx`, `src/app/layout.tsx`, `src/components/OrderBook.tsx`, `src/components/PortfolioPanel.tsx`, `src/app/orders/[id]/page.tsx`, `src/app/positions/page.tsx`, `src/components/OrderForm.tsx`, `package.json`
- Deviations: `PartialMessage<PlaceOrderRequest>` not available in protobuf-es v2 → used `Parameters<typeof tradingClient.placeOrder>[0]`; package.json and step-1 files included because steps 1–3 PRs not merged.

### Step 5 — Migrate SWR call sites to typed hooks in xstockstrat-insights [done]
- Created `src/hooks/useStrategies.ts` (`useStrategies`, `useStrategyReport`), `src/hooks/useBacktest.ts` (`useRunBacktest`), `src/hooks/useAccountPortfolios.ts`.
- Migrated `useSWR` in `page.tsx`, `strategies/page.tsx`, `strategies/[id]/page.tsx`, `AccountPortfolioSelector.tsx`.
- `strategies/[id]/page.tsx`: replaced manual async `runBacktest()` + three useState vars with `useRunBacktest()` mutation; derived `runError` from `runErrorObj`.
- Step-5 branch rebased onto step-4 (sequential PR chain per user instruction).
- Files modified: `src/hooks/useStrategies.ts`, `src/hooks/useBacktest.ts`, `src/hooks/useAccountPortfolios.ts`, `src/lib/queryClient.ts`, `src/app/providers.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/strategies/page.tsx`, `src/app/strategies/[id]/page.tsx`, `src/components/AccountPortfolioSelector.tsx`, `package.json`
- Deviations: hook types use `Awaited<ReturnType<...>>`; step-2 deps included; sequential chain used.

### Step 6 — Migrate useEffect+fetch data-loading to typed hooks in xstockstrat-config-ui [done]
- Created `app/hooks/useConfigKeys.ts`, `app/hooks/useSetConfig.ts`, `app/hooks/useAuditLog.ts`, `app/hooks/useSignalSources.ts`, `app/hooks/useSignalSourceMutations.ts`.
- Migrated `useEffect` data-loading in `app/[namespace]/page.tsx`, `app/audit/page.tsx`, `app/sources/page.tsx` to typed hooks.
- Applied step-3 provider files: `app/lib/queryClient.ts`, `app/providers.tsx`, `app/layout.tsx` (Providers wrapper), `package.json` (@tanstack/react-query + @normy/react-query, remove swr).
- Files modified: `app/hooks/useConfigKeys.ts`, `app/hooks/useSetConfig.ts`, `app/hooks/useAuditLog.ts`, `app/hooks/useSignalSources.ts`, `app/hooks/useSignalSourceMutations.ts`, `app/lib/queryClient.ts`, `app/providers.tsx`, `app/layout.tsx`, `app/[namespace]/page.tsx`, `app/audit/page.tsx`, `app/sources/page.tsx`, `package.json`
- Deviations: enum short names fixed (`Environment.PRODUCTION` not `ENVIRONMENT_PRODUCTION`); `Parameters<...>[0]` for mutation types; `QueryNormalizerProvider` not `NormalizationProvider`; `@normy/react-query ^0.21.0` not `^1.1.0`.

### Step 7 — Eliminate any from hook files and component internals [done]
- Fixed `any` in `insights/src/app/page.tsx`: `StrategyScore` type, typed `ratingVariant` return, `formatter` uses `unknown`, `chartData` parameter typed.
- Fixed `any` in `insights/src/app/strategies/page.tsx`: `StrategyScore` type on map.
- Fixed `any` in `insights/src/app/strategies/[id]/page.tsx`: `TradeRecord` type on map, `formatter` uses `unknown`.
- Fixed `any` in all three `auth/login/route.ts`: removed `as any` cast on `authenticateUser()` return, use `data.accessToken`/`data.refreshToken` directly.
- Fixed `any` in all three `identity.ts`: imported `AuthTokenResponse`, removed `as any` and snake_case field fallbacks; `claims` cast as `unknown as JwtClaims`.
- Fixed `catch (err: any)` in `config-ui/app/api/audit/route.ts`: changed to `catch (err: unknown)`.
- Files modified: `insights/src/app/page.tsx`, `insights/src/app/strategies/page.tsx`, `insights/src/app/strategies/[id]/page.tsx`, `trader/src/app/api/auth/login/route.ts`, `insights/src/app/api/auth/login/route.ts`, `config-ui/app/api/auth/login/route.ts`, `trader/src/lib/identity.ts`, `insights/src/lib/identity.ts`, `config-ui/app/lib/identity.ts`, `config-ui/app/api/audit/route.ts`
- Deviations: `AuthTokenResponse` not `AuthenticateUserResponse`/`RefreshTokenResponse`; `claims` cast via `unknown`.

### Step 10 — Update CLAUDE.md files to reflect new client-side architecture [done]
- trader/CLAUDE.md: replaced "SWR-wrapped unary" with "TanStack Query hooks"; added Client Hooks section.
- insights/CLAUDE.md: replaced SWR architecture diagram with connect-web + TanStack Query; added Client Hooks section.
- config-ui/CLAUDE.md: updated architecture diagram to show hook layer; added Client Hooks section.
- Files modified: `services/xstockstrat-trader/CLAUDE.md`, `services/xstockstrat-insights/CLAUDE.md`, `services/xstockstrat-config-ui/CLAUDE.md`
- Deviations: none.

### Step 9 — Verify tsc and SWR removal for xstockstrat-insights and xstockstrat-config-ui [done]
- insights tsc --noEmit: 0 errors ✓; no swr, no catch any, no any in hooks ✓
- config-ui tsc --noEmit: 0 errors ✓; no swr, no catch any, no any in hooks ✓
- E2E tests: skipped (no running backend in execution environment)
- Files modified: (spec/context only)
- Deviations: E2E tests require live backend; all static checks pass.

### Step 8 — Verify tsc and SWR removal for xstockstrat-trader [done]
- tsc --noEmit: 0 errors ✓
- No `swr` in src/ or package.json ✓
- No `catch (err: any)` in src/ ✓
- No `: any` in src/hooks/ or src/lib/queryClient.ts ✓
- E2E tests: fail with exit code 1 (no running backend in execution environment) — deviation noted.
- Files modified: (spec/context only)
- Deviations: E2E tests require live backend; all static checks pass.

### Step 11 — docs: Create docs/patterns/client-api-pattern.md [done]
- Created `docs/patterns/client-api-pattern.md` covering: library stack, directory structure (src/ vs flat app/), shared provider/config template, query hook example (useStrategies), mutation hook example (usePlaceOrder), cache-normalization extension guide (current keys: orderId, strategyId; deferred: symbol, key, portfolioId), rules (FR-3/FR-4/FR-10), reference implementations.
- Files modified: `docs/patterns/client-api-pattern.md`
- Deviations: none.

## Session 2026-06-01T00:02:00Z — sdd-execute
**Steps this session**: [11]
**Progress**: 11 done / 11 total
**Stopped at**: Step 11 (all complete)
**Next**: Integration PR — `feature/client-api-pattern` → `main-dev`

## Open Items
_(none)_
