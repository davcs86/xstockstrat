# Context: droplet-compose-deploy  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: Proposal to move dev/staging compute off DO App Platform onto a single DO Droplet running the root `docker-compose.yml`, with Caddy doing TLS and blue/green swaps, DO Managed Postgres unchanged. Reached `spec-ready` (2026-07-31), never designed. Demoted 2026-10-24 in favour of `279-homelab-compose-deploy` after 279's product-spec overlap scan found both claimed the dev compose deploy path (`deploy-dev.yml`). 279 deploys via homelab-edge (tailnet, Caddy edge, forced-command gate on app VMs), keeps the DO deploys, leaves the root `docker-compose.yml` unchanged.
**Why (irrecoverable rationale)**: Motivation was the dev/staging topology being hand-synced across `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`; make the already-maintained compose file the single source of truth. Scope came from a plan-mode pros/tradeoffs analysis that was never an SDD artifact: keep DO Managed Postgres (no self-hosted TimescaleDB), dev/staging only (prod stays on App Platform), near-zero-downtime deploys a hard requirement (hence Caddy blue/green over bare `docker compose up -d`). Security was a reviewer because the move needs a new droplet-side secrets story with no registry-listed owner service.
**Rejected alternatives**:
- Docker Swarm (`docker stack deploy`) — compose-syntax quirks: `depends_on: condition:` and `deploy:` behave differently and would break the `db-migrator` → `service_completed_successfully` migration gate. Revisit only if Caddy hit a concrete blocker.
- Bare `docker compose up -d` — loses the near-zero-downtime behaviour App Platform gives for free.
- Self-hosted TimescaleDB on the droplet — rejected by user decision; no further reason recorded.
- Multi-droplet HA with a DO Load Balancer — deferred, single droplet only; a single-host SPOF was acceptable only as an explicit, consciously owned decision.
**Scars & gotchas**: No execute phase; spec-time traps only.
- The root `docker-compose.yml` publishes every service port (50051-50060, 5432, OTel 4317/4318/13133) on `0.0.0.0`; reusing it on a public host exposes the whole gRPC/DB surface unless ports bind to `127.0.0.1` or a firewall is added.
- Go services are distroless with no shell and had no compose healthcheck, so readiness gates cannot `curl`/`sh` them; 279 FR-5 resolved it with `grpc.health.v1` plus exec-form `/app/service healthcheck`.
- Retiring `.do/app.dev.yaml` strands feature 033's per-service OTel env vars; any move off it must carry dev OTel env provisioning.
**Permanent deviations**: none — nothing designed or shipped.
**Process gap exposed**: `docs/runbooks/approval-flow.md` has no category for infra-topology changes; Platform Lead was picked only as the closest documented category to "new service", and the confirmation was deferred to design and never done. Any future deploy-topology feature will hit this again.
**Reusable rule**: AC-2 required downtime to be *measured* — prove the blue/green swap actually achieves near-zero downtime rather than trusting the Caddy config. Review also flagged `docs/patterns/observability.md` (otel-collector dev-vs-prod split) as a likely-missed doc surface beyond the FR-8 list and told design to enumerate surfaces rather than trust the spec; the ledger has no deploy-topology entry (nearest lesson: C-10, shared surface moves together).
**Spec review corrections (minor)**: spec claimed 13 services (actual 12) and named the secret `ALPACA_SECRET` (actual `ALPACA_API_SECRET`).
**Cross-feature signal**: Successor 279 answered four of the open questions — Go readiness (`grpc.health.v1` + exec-form healthcheck); secrets via GitHub environment secrets or 1Password into a 0600 `.env`; one-shot `db-migrator` with `service_completed_successfully`; automatic rollback to the previous release. Renumbered 083 → 084 after colliding with `083-ui-revamp-opportunities-first` (already-recorded numbering-scan failure, fails.md:212).
**Deferred follow-ons**: unresolved by 279 (verify before relying): no resource budget was ever set for running all 12 services plus Caddy plus `otel-collector` on one host (the spec wanted a budget table like the DB connection-pool budget), and no number was ever set for the downtime budget. Otherwise moot: prod migration off App Platform and OS-hardening automation were deferred and are moot; any future attempt starts from 279.
**Ledger entries written**: insights.md (0), fails.md (0) — numbering-scan failure already recorded (fails.md:212); no new durable lesson.
**Runtime-invariant recommendations (→ /context-constitution)**: candidate — root `docker-compose.yml` is local-dev only and binds all ports to `0.0.0.0`; must not run unmodified on a reachable host. Verify against 279's state before filing.
**Pruned artifacts**: product-spec.md — last present at 1ed63958.
