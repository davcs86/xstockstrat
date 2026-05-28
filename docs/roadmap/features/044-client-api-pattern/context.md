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
