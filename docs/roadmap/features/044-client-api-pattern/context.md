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
