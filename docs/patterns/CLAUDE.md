# docs/patterns/ — Implementation Patterns

Reusable implementation patterns for new services. Each file is a self-contained guide that should be read **only when relevant** — see the Context Guide in the root `CLAUDE.md` for when to read each one.

| File | Read when |
|---|---|
| `frontend-auth.md` | Creating or modifying a Next.js frontend service — auth, required files (incl. BFF + browser clients), session/header forwarding, Edge-runtime safety |
| `nextjs-frontends.md` | Anything else Next.js in a frontend — basePath, the BFF connect-web call chain (+ the handler-map basePath gotcha that 404s every RPC), browser typed-client data shape, how to verify a BFF route resolves, Suspense fallbacks, Radix hydration, middleware matcher, app icons |
| `nginx-routing.md` | Adding a new frontend to the nginx reverse proxy |
| `header-propagation.md` | Adding a new backend service (Go, Python, or Node.js) |
| `config-governance.md` | Writing any service that reads runtime config (naming, scoping, startup) |
| `config-startup.md` | Config service startup readiness — 90s timeout, healthcheck, per-language patterns |
| `database.md` | Adding or modifying DB schemas and migrations |
| `observability.md` | Wiring OTel into a service or configuring Grafana Cloud |
| `ci-overview.md` | Debugging CI failures, checking coverage thresholds, understanding deploys |
| `docker-build.md` | Docker build patterns, service healthchecks, `WAIT_FOR` entrypoint, `depends_on` conditions |
