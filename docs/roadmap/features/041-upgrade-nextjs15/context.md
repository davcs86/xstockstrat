# Context: upgrade-nextjs15  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Insights and config-ui were realigned to Next.js 15.5.15 (matching trader), staying on React 18.3.1 with unchanged OTel pins. What shipped went well beyond the 7-step spec: E2E test infra for all three frontends was rewritten to real gRPC/H2C mock backends, and several files outside the originally-cited targets needed fixes only discoverable by running the build/tests (context.md Steps 2–6, 2026-05-31).
**Why (irrecoverable rationale)**: Version choices (15.5.15 pin, stay-on-React-18, no OTel bump, keep the standalone-path workaround) were all decided by "trader already runs this combo in production" — not by upstream compatibility docs (product-spec.md Open Questions, resolved 2026-05-31, since deleted).
**Rejected alternatives**:
- React 19 bump — rejected; trader validated Next 15 + React 18 in prod, no Radix/charting gate needed (context.md Session 2026-05-31 sdd-spec).
- Keeping test-mocking hooks (`createConnectTransport`/`httpOverride`) inside production `connectClients.ts` — rejected post-hoc; user explicitly disliked "hacky harness solutions in production code" (implementation-spec.md Deviation Log, Steps 3&6).
**Scars & gotchas**:
- Next.js 15 enforces the `PageProps` `Promise<T>` constraint on **client** components too (not just server components/route handlers) — surfaced only via build failure, not by static scanning. Fix pattern is `React.use(params)`, not `await` (implementation-spec.md Deviation Log, Step 2; repeated in config-ui Step 5).
- `eslint-config-next@15` newly errors on `<a>` for same-app navigation — forced converting same-basePath links to `<Link>` while keeping cross-app (`/trader`, `/insights`) links as `<a>` with lint-disable, because `<Link>` mishandles basePath across apps (context.md Step 5, config-ui).
- A spec-cited target file (`analysis/report/[id]/route.ts`) had already been deleted by feature 044's concurrent merge — the real fix landed in an unanticipated file (`strategies/[id]/page.tsx`) (implementation-spec.md Deviation Log).
- Feature 003 (`formula-management-ui`) also edits `xstockstrat-insights/package.json` — flagged merge-conflict risk (context.md sdd-review session, 2026-05-31).
**Permanent deviations**:
- Spec said: async-params fix only in named Route Handler file → shipped: fix in a client-component page file instead, because the original target was deleted upstream (implementation-spec.md Deviation Log, Step 2).
- Spec implied test mocking via production-code HTTP override → shipped: pure `createGrpcTransport` in production + `connectNodeAdapter+http2` real gRPC mock backends in E2E harness only, per explicit user direction; canonicalized in `docs/patterns/nextjs-frontends.md` §4 (implementation-spec.md Deviation Log, Steps 3&6).
**Cross-feature signal**:
- Fixing insights/config-ui E2E infra exposed the same stale HTTP/1.1 mock-backend pattern in trader, out of original scope — one root cause, fixed across all three frontends in the same pass (implementation-spec.md Deviation Log; context.md "Post-completion" entry).
- This feature was part of a deliberately-parallel 4-feature batch (033/041/045/044) off main-dev — explains why deleted/moved files kept surfacing mid-execution (context.md Session 2026-05-30 sdd-story).
**Deferred follow-ons**: none stated beyond feature 045 (UI consolidation) proceeding independently, already tracked as its own feature.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
