# docs/patterns/ — Implementation Patterns

Reusable implementation patterns for new services. Each file is a self-contained guide that should be read **only when relevant** — see the Context Guide in the root `CLAUDE.md` for when to read each one.

| File | Read when |
|---|---|
| `frontend-auth.md` | Creating or modifying a Next.js frontend service |
| `nginx-routing.md` | Adding a new frontend to the nginx reverse proxy |
| `header-propagation.md` | Adding a new backend service (Go, Python, or Node.js) |
| `git-subtree.md` | Syncing a service to/from its individual GitHub repo |
| `config-governance.md` | Writing any service that reads runtime config (naming, scoping, startup) |
| `database.md` | Adding or modifying DB schemas and migrations |
| `observability.md` | Wiring OTel into a service or configuring Grafana Cloud |
| `ci-overview.md` | Debugging CI failures, checking coverage thresholds, understanding deploys |
