# Context: ui-consolidation-nextjs  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Four containers (trader, insights, config-ui, nginx) collapsed into one `xstockstrat-ui` Next.js app with segment route groups instead of per-service top-level `basePath`, removing nginx as an operational surface entirely (feature.md:37; product-spec.md:8-16).
**Why (irrecoverable rationale)**: Removing nginx meant removing the mechanism (basePath-stripping) that the existing BFF handler-map key convention silently depended on — discovered by review, not design intent (context.md:87,94).
**Rejected alternatives**:
- Single flat `src/lib/browserClients.ts` (as spec'd) — rejected mid-execution for per-service files because a shared file has no natural single `baseUrl` once each segment targets a different BFF path (context.md:107,650-654).
- Shared `connectTransport.ts` — dropped for the same reason (context.md:652).
- Keeping `'/api'`-only handler-map keys — rejected once no top-level `basePath` exists; keys must include `/<segment>/api` (context.md:87,93-94).
**Scars & gotchas**:
- `next build`/`tsc` pass even when every BFF RPC 404s from a handler-map miss — undetectable by typecheck (implementation-spec.md:93; `docs/patterns/nextjs-frontends.md:342-345`).
- Brand-new workspace package has no lockfile entry — `pnpm install --frozen-lockfile` fails; must run unfrozen once first (context.md:657-658,110).
- `INDICATORS_ENDPOINT` dropped from `connectClients.ts` — ESLint `no-unused-vars` blocked the build once no BFF called indicators (context.md:661-663,109).
- Docker build verification never actually run locally (no daemon in sandbox) — deferred to CI (context.md:665-668).
- **Nesting an existing flat single-basePath app under a segment subdirectory breaks more than shared-lib imports — three distinct forms surfaced, none visible from reading the merged/fixed code**: (1) component relative imports (`./ui/*` → `../ui/*`) once components moved one level deeper (context.md:111); (2) a hardcoded same-app absolute cross-page import (`@/app/page` → `@/app/trader/page`) (context.md:114); (3) hardcoded top-level navigation `href`s inside AppShell components that assumed a flat top path — not an import statement, so grepping imports alone misses it — e.g. Insights AppShell internal nav (`/` → `/insights`, `/strategies` → `/insights/strategies`) and Trader AppShell logo link (`/` → `/trader`) (context.md:112-113). Lesson: a future segment-nesting change must check all three classes — relative imports, same-app absolute imports, and hardcoded nav hrefs — not just the two import forms.
**Permanent deviations**: none beyond the browser-client file-layout deviation above.
**Cross-feature signal**: `docs/patterns/nextjs-frontends.md` (lines 3,11,25,289-297) still documents the pre-045 per-service `basePath` + nginx-forwarding BFF-key convention as current — contradicts shipped `xstockstrat-ui` code and its own `CLAUDE.md`. A consolidation-style feature that changes a cross-cutting convention must update the general pattern doc in the same PR, not just the service-level `CLAUDE.md`.
**Deferred follow-ons**: `docs/patterns/nextjs-frontends.md` §1 and the "#1 BFF footgun" callout need a rewrite for the no-basePath architecture — flagged, not fixed.
**Ledger entries written**: insights.md (1), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - Candidate for a PLAT-*/UI-* note: `docs/patterns/nextjs-frontends.md` is stale post-045 — worth a constitution/finding entry pointing at `services/xstockstrat-ui/CLAUDE.md`.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
