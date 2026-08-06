# Context: wire-fe-auth  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped JWT session auth (cookie-based, `jose`/Edge-compatible) into all three Next.js frontends plus a three-header (`x-user-id`/`x-access-scope`/`x-trace-id`) propagation layer across all 10 backend services, growing from a 12-step to a 16-step plan as scope expanded mid-flight (context.md L26-36, L50-58).
**Why (irrecoverable rationale)**: Frontend is the sole auth boundary — no Bearer token is ever forwarded to backends; backends trust `x-user-id`/headers only from internal callers because nginx strips them at the edge (context.md L14-15, L32-33). A shared `@xstockstrat/auth` workspace package was explicitly rejected in favor of per-service file duplication "to avoid pnpm workspace dep complexity for a small utility file" (context.md L42).
**Rejected alternatives**:
- Shared `@xstockstrat/auth` pnpm workspace package — lost to per-service duplicated `auth.ts` (context.md L42; OQ-1).
- Importing `IDENTITY_HTTP_ENDPOINT`/`IDENTITY_BASE_URL` from each service's `connectTransport.ts` — lost because that file imports `@connectrpc/connect-node`, which crashes in the Edge Runtime where `middleware.ts`/`auth.ts` run (implementation-spec.md L803-811, Deviation Log).
- A shared, nginx-routed, SSO-capable login app — lost to per-frontend `/login` pages, explicitly deferred "for future SSO consideration" rather than rejected outright (product-spec.md:104, OQ-2; echoed context.md L23).
**Scars & gotchas**:
- config-ui tsconfig `@/*` alias: `["./src/*", "./app/*"]` double-prefixed `@/app/lib/auth` to `./app/app/lib/auth` (webpack build error only, not lint) — fixed with root-relative `["./*"]` (implementation-spec.md L813-821, Steps 8-9).
- `xstockstrat-indicators` had zero outbound gRPC stubs despite the spec assuming ingest-stub calls to propagate — spec had drifted from the actual Phase-3-built self-contained service (implementation-spec.md L828-832; context.md "Open Items" L204-205).
- Python asyncio background tasks (`ingest._run_backfill` via `create_task`) cannot safely read the gRPC `context` after the parent RPC returns — propagation metadata must be extracted and passed in before spawning (implementation-spec.md L834-837).
- nginx syntax verification could not run (`nginx -t`, no Docker socket) — shipped on manual inspection only (implementation-spec.md L823-826).
- `xstockstrat-ingest` coverage was sub-40% pre-feature; Step 16 added tests for `http_server.py`/`telemetry.py` opportunistically, but `main.py` was deliberately left at 0% and untested — its module-level `raise RuntimeError` guard (DATABASE_URL check) "makes import-time testing impractical without extensive mocking," an intentional, reasoned gap rather than an oversight (implementation-spec.md L839-842).
**Permanent deviations**:
- design said import endpoint constants from `connectTransport.ts` -> shipped inlined `process.env.IDENTITY_HTTP_ENDPOINT` per file -> because Edge Runtime can't load `@connectrpc/connect-node` (Deviation Log, Steps 2-3).
- product-spec said 12 steps -> shipped 16 -> because `/sdd-review` mandated a Step 16 test step and mid-design scope expanded to add `x-access-scope`/`x-trace-id` (context.md L26-35, L52-55).
**Cross-feature signal**: Recommended executing `wire-fe-auth` before `formula-management-ui` (003) since both touch `xstockstrat-insights`/`xstockstrat-indicators` shared files (context.md L57).
**Deferred follow-ons**: If ledger/ingest stubs are ever added to `xstockstrat-indicators`, thread `propagation_meta` at that time (context.md "Open Items" L204-205).
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
