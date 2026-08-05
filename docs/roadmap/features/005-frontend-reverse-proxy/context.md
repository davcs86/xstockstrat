# Context: frontend-reverse-proxy  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped an nginx reverse proxy (`services/xstockstrat-nginx/Dockerfile` + root `nginx.conf`) that path-routed `/trader`, `/insights`, `/config-ui` to three independently-built Next.js frontends, each given a matching `basePath`. All 6 steps landed as specced with no scope cuts. (Note: this entire nginx layer was later removed by feature 045 `ui-consolidation-nextjs`, which consolidated the three frontends into one Next.js UI — see `docs/patterns/nginx-routing.md`, marked deprecated/historical, and root CLAUDE.md.)
**Why (irrecoverable rationale)**: Nginx picked over Traefik or app-level routing for "simplicity and battle-tested reliability" (context.md 2026-05-11 decision 1); path-based routing picked over subdomains specifically to dodge multi-domain TLS/DNS complexity (decision 2); Next.js `basePath` (not bare `assetPrefix`) picked because it's the only mechanism that also fixes internal `<Link>`/asset resolution, not just static asset URLs (decision 3).
**Rejected alternatives**:
- Traefik / application-level routing — lost to nginx's simplicity/maturity, no further tradeoff analysis recorded (context.md L16).
- Subdomain-based routing — lost because it would require multi-domain TLS and DNS management (context.md L17).
- `assetPrefix`-only config — lost because it doesn't fix Next.js internal routing/links, only assets (context.md L18).
**Scars & gotchas**:
- `Dockerfile.nginx` spec said repo root; shipped at `services/xstockstrat-nginx/Dockerfile` instead — treat any new infra component as its own `services/` dir for consistency/future CI filtering (implementation-spec.md Deviation Log, Step 2).
- The execute-loop sandbox had no Docker daemon, so `nginx -t` / `docker build` / `docker compose up` verification for Steps 1, 2, and 6 could never run in-session; only structural checks (brace counts, YAML indentation) were possible, with real verification deferred to actual deploy (implementation-spec.md Deviation Log, Steps 1/2/6; context.md sessions 2026-05-11/12 repeatedly).
- `xstockstrat-config-ui` was already broken before this feature touched it (missing `@types/pg`, `createNodeHttpTransport` not exported from `@connectrpc/connect-node`) — surfaced only because Step 5's basePath change forced the first build in a while; fixed inline as scope creep with user sign-off (context.md session 2026-05-12 late; implementation-spec.md Deviation Log Step 5).
- `proxy_pass http://trader_backend;` (no trailing slash) is required to keep the `/trader` prefix on the forwarded URI — trailing slash would strip it and break basePath routing (implementation-spec.md L135) — now moot since nginx was later removed, but was a real trap while it lived.
**Permanent deviations**: design said `Dockerfile.nginx` at repo root -> shipped `services/xstockstrat-nginx/Dockerfile` -> because the team treats every infra piece as a first-class `services/` directory (implementation-spec.md Deviation Log Step 2).
**Cross-feature signal**: This feature's whole architecture (nginx path routing + per-app basePath) was superseded by feature 045's single consolidated Next.js UI — a full reverse pivot, not an extension. Already captured in `docs/patterns/nginx-routing.md` and root CLAUDE.md; not re-litigated here.
**Deferred follow-ons**: TLS/HTTPS termination and advanced auth middleware (JWT/OAuth2) were explicitly deferred to "Phase 2" (product-spec.md Open Questions) — moot post-045 but shows the intended next step at the time.
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
