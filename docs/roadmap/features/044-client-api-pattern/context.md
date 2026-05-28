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
