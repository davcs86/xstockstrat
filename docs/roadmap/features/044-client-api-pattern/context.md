# Context: client-api-pattern  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Replaced SWR with TanStack Query v5 + `@normy/react-query` across all three Next.js frontends, wrapping every read/write in named typed hooks and eliminating `any` from the client→route-handler boundary. Delivered as 11 sequential step-branches chained onto each other rather than each off the feature branch.
**Why (irrecoverable rationale)**:
TanStack Query + normy chosen over SWR because normy's automatic entity propagation eliminates the manual per-panel invalidation graph SWR requires as dashboards grow (context.md 2026-05-28T00:02:00Z). Normalization keys restricted to `orderId`/`strategyId` — `symbol`/`key`/`portfolioId` judged too generic to normalize without cross-entity collisions (context.md same session).

**Shipped-vs-design divergence (core FR, never logged as a deviation)**: product-spec.md FR-1, re-confirmed at the 2026-06-01T00:00:00Z `/sdd-review` gate (context.md), explicitly chose `@connectrpc/connect-query` to generate typed TanStack Query hooks directly from proto service descriptors. What shipped (context.md Steps 4–6, `implementation-spec.md`) is hand-written wrapper hooks calling plain `useQuery`/`useMutation` against the pre-existing `browserClients.ts` clients — `connect-query` is declared in every `package.json` (confirmed `services/xstockstrat-ui/package.json:25`) but has zero imports anywhere in shipped `src/` (confirmed by grep). Unlike the smaller type-signature deviations, this reversal of a re-decided FR was never entered in the Deviation Log during Steps 4–6, and only `docs/patterns/client-api-pattern.md:17` records the resulting fact ("not used directly... Connect clients were already in place") without noting it reversed a deliberately re-chosen library.
**Rejected alternatives**:
- Hand-authored TS interfaces (original FR-5) — lost once bundle-size concern was debunked (context.md 2026-05-28T00:01:00Z).
- Broader normalization key set — lost to collision risk; deferred.

**Scars & gotchas**:
- protobuf-es v2 dropped `PartialMessage<T>`; use `Parameters<typeof client.method>[0]` for mutation types — recurred Steps 4–6.
- `@normy/react-query`'s real API is `QueryNormalizerProvider`, actual version `^0.21.0` not spec-assumed `NormalizationProvider`/`^1.1.0` (Step 6).
- protobuf-es v2 enums use short names (`Environment.PRODUCTION`) not long form (Step 6).
- Both auth RPCs share one `AuthTokenResponse` — no split response types (Step 7).
- `services/xstockstrat-ui/src/lib/identity.ts:19` double-casts `claims` with no code comment; judged safe only because no caller reads it — silent `undefined` risk for future callers (Step 7).
- E2E skipped Steps 8–9 (no live backend) — accepted, recurring gap.

**Permanent deviations**: scope narrowed to client-only (server clients already typed by 2026-05-30 re-story); step branches chained sequentially per user instruction rather than off the feature branch (Step 5).
**Cross-feature signal**: 044 must land before 045, 003, and any feature adding data-fetching components, so they inherit the hook pattern (context.md 2026-05-28T00:03:00Z, 2026-06-01T00:00:00Z).
**Deferred follow-ons**: expand normy key whitelist to `symbol`/`key`/`portfolioId`.
**Ledger entries written**: insights.md (2), fails.md (3) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
