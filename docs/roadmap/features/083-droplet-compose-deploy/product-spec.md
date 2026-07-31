# Product Spec: droplet-compose-deploy

**Created**: 2026-07-31

---

## Problem Statement

The dev/staging environment's deployment topology is currently described in three separate places
(`docker-compose.yml` for local dev, `.do/app.dev.yaml` for the DO App Platform dev app, and
`.do/app.yaml` for prod) that must be kept in sync by hand. The platform owner wants to centralize
dev/staging orchestration around the single, already-actively-maintained `docker-compose.yml` by
running it on a DigitalOcean Droplet instead of DO App Platform, while preserving the near-zero-
downtime deploy behavior App Platform currently provides for free.

## User Story

As the platform owner, I want the dev/staging environment's compute layer hosted on a DO Droplet
running `docker-compose.yml`, so that dev/staging orchestration has one source of truth instead of
two divergent spec formats, without losing near-zero-downtime deploys or introducing new
single-point-of-failure risk that isn't consciously accepted.

## Functional Requirements

FR-1. The dev/staging environment's 13 application services (per root `CLAUDE.md` Service
Registry) run on a single DO Droplet via `docker-compose.yml`, pulling the same pre-built GHCR
images the current dev pipeline already produces (`docker-build.yml`) — no new build mechanism.

FR-2. A Caddy reverse proxy on the droplet handles TLS termination and a blue/green swap between
old/new container sets on deploy, replacing App Platform's implicit rolling-restart + managed-TLS
behavior. Caddy fronts only the two paths that are public today (`/agent` → `xstockstrat-agent`,
`/` → `xstockstrat-ui`, per `.do/app.dev.yaml`'s ingress rules) — the public surface boundary does
not widen.

FR-3. `docker-compose.yml`'s service port bindings are tightened so that only the ports Caddy (and
any operator SSH tooling) need are reachable beyond `127.0.0.1` on the droplet — closing the gap
where the file, as it exists for local dev, publishes every service's port (`50051`-`50060`,
`5432`, OTel ports 4317/4318/13133) to `0.0.0.0`.

FR-4. The DO Managed Postgres cluster continues to serve dev/staging exactly as it does today; no
self-hosted Postgres/TimescaleDB container is introduced, and the existing 20-connection pool
budget (root `CLAUDE.md` § Connection Pool Budget) is unaffected by this migration.

FR-5. Secrets currently marked `type: SECRET` in `.do/app.dev.yaml` (`JWT_SECRET`,
`ALPACA_API_KEY`/`ALPACA_SECRET`, `BROKER_ACCOUNTS_ENCRYPTION_KEY`, `MCP_AGENT_SECRET`, OTel
headers, etc.) are provisioned on the droplet through a mechanism that keeps them out of git and
out of any built image layer. The exact mechanism (restricted-permission `.env` file vs. a
secrets manager) is an explicit open question for `/sdd-design`, not decided here.

FR-6. `.github/workflows/deploy-dev.yml` is reworked to deploy to the droplet (SSH- or
DO-API-driven) instead of `doctl apps update $DO_DEV_APP_ID --spec .do/app.dev.yaml`, and includes
a migration-gating step that blocks the deploy on migration failure — reusing
`docker-compose.yml`'s existing `db-migrator` service + `depends_on: service_completed_successfully`
chain, which already mirrors App Platform's `PRE_DEPLOY` job-kind behavior.

FR-7. A minimal rollback path exists on the droplet — re-pointing the compose file's `image:` tags
to the previous known-good GHCR SHA and re-running the blue/green swap — as the droplet-side
equivalent of App Platform's one-command deployment-history rollback.

FR-8. `docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`, and root `CLAUDE.md` are
updated to describe the new dev/staging deployment topology once implemented.

## Out of Scope

- **Production migration.** Production stays on DO App Platform (`.do/app.yaml`, `main` branch
  deploys) for this feature. A follow-up feature would migrate prod after this one is validated.
- **Self-hosting the database.** DO Managed Postgres stays as-is; no TimescaleDB container is
  promoted to production use.
- **Horizontal scaling / multi-droplet HA.** Single droplet only. A DO Load Balancer + multiple
  droplets is a future escalation, not part of this feature.
- **Docker Swarm adoption.** Caddy blue/green (not Swarm) is the approach carried in from the
  pre-story pros/tradeoffs analysis — Swarm's compose-syntax quirks (`depends_on: condition:`,
  `deploy:` fields behaving differently under `docker stack deploy`) made it a worse fit. This can
  be revisited only if `/sdd-design` finds a concrete blocker with the Caddy approach.
- **Full OS hardening automation** (fail2ban, unattended-upgrades, intrusion detection) beyond the
  baseline needed to stand the droplet up securely. A candidate for a later feature unless
  `/sdd-design` determines a specific control is required before go-live.

## Affected Services

This is a platform/infrastructure change, not a service business-logic change:

- **Root-level orchestration** — `docker-compose.yml`, `.github/workflows/deploy-dev.yml`,
  `docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`, root `CLAUDE.md`.
- All 13 `xstockstrat-<service>` services (per the Service Registry) deploy **unchanged** —
  only how they're hosted changes. No gRPC contract, business logic, or service `CLAUDE.md`
  changes are anticipated unless the secrets-provisioning design (FR-5) requires a service to read
  a secret differently, which would be a scoped follow-up decided at `/sdd-design`.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/droplet-compose-deploy` (branch from `main-dev`)
Approval gates required (per `docs/runbooks/feature-workflow.md` and `docs/runbooks/approval-flow.md`):
- [ ] Platform Lead approval — this is a cross-service deployment-topology change (the closest
      documented category to "new service" in the Approval Flow matrix); confirm the exact gate at
      `/sdd-design` since infra-topology changes aren't explicitly enumerated in
      `docs/runbooks/approval-flow.md` today.
- [ ] Security review of the secrets-provisioning mechanism (FR-5) before go-live.

## Acceptance Criteria

1. All 13 services from the Service Registry run on the droplet via `docker-compose.yml` and pass
   their existing healthchecks (or an added equivalent for the Go services, which currently have
   none — see Open Questions).
2. A deploy to dev (triggered by a push to `main-dev`) completes with **measured** downtime on the
   public paths (`/agent`, `/`) at or below a threshold pinned at `/sdd-design` — proving the
   blue/green swap actually achieves near-zero-downtime rather than assuming the Caddy config
   accomplishes it.
3. No service port other than the ones intentionally exposed (via Caddy and/or a DO Cloud
   Firewall rule) is reachable from outside the droplet — verified with a port scan against the
   droplet's public IP.
4. No secret value (`JWT_SECRET`, Alpaca keys, etc.) appears in git history, a committed file, or
   a `docker image history` / layer inspection of any built image.
5. The dev-never-live invariant (`TRADING_MODE=paper`, `ALPACA_PAPER=true`,
   `ALPACA_BASE_URL=https://paper-api.alpaca.markets`, per `docs/runbooks/feature-workflow.md`)
   still holds after migration — verified by inspecting the droplet's running container env.
6. Migrations run and gate the deploy — a broken migration blocks the blue/green swap, at parity
   with today's `PRE_DEPLOY` behavior.
7. A rollback to the previous image SHA is demonstrated end-to-end at least once during
   implementation/testing.
8. `docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`, and root `CLAUDE.md` reflect the
   new dev deployment topology (checked by `/context-scrubber scan` per this repo's teardown
   convention before the final PR).

## Open Questions

- [ ] Exact secrets-provisioning mechanism for the droplet (restricted-permission `.env` file vs.
      a secrets manager) — resolve in `/sdd-design`.
- [ ] Droplet sizing (vCPU/RAM) sufficient to run all 13 services + Caddy + `otel-collector`
      concurrently without resource starvation — needs a resource budget analogous to root
      `CLAUDE.md`'s DB connection-pool budget table.
- [ ] Whether the Go services in `docker-compose.yml` (distroless images, no shell — currently no
      healthcheck) need a healthcheck added so Caddy's blue/green swap can gate on their readiness,
      or whether readiness is inferred another way.
- [ ] Concrete downtime-budget number for AC-2 — not specified by the requester; pin a number at
      `/sdd-design`.
- [ ] **Known trap check**: no `docs/roadmap/ledger/fails.md` or `insights.md` entry was found
      specifically about CI/CD or deploy-topology changes. The closest applicable pattern is the
      recurring **C-10** "a shared surface must be updated everywhere" family — this feature
      touches multiple documentation surfaces (`docs/setup/digitalocean.md`,
      `docs/patterns/ci-overview.md`, root `CLAUDE.md`, and possibly `docs/patterns/observability.md`
      for the `otel-collector` dev-vs-prod split) that must all move together. `/sdd-design` should
      enumerate them explicitly rather than relying on this spec's list being exhaustive.
