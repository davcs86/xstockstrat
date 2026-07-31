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

FR-1. The dev/staging environment's 12 application services (per root `CLAUDE.md` Service
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
`ALPACA_API_KEY`/`ALPACA_API_SECRET`, `BROKER_ACCOUNTS_ENCRYPTION_KEY`, `MCP_AGENT_SECRET`, OTel
headers, etc.) are provisioned on the droplet through a mechanism that keeps them out of git and
out of any built image layer. The exact mechanism (restricted-permission `.env` file vs. a
secrets manager) is an explicit open question for `/sdd-design`, not decided here. This is
provider-agnostic: it changes only how broker credentials reach the runtime, not order-execution
or broker-integration business logic — it applies uniformly to any broker account type
`BROKER_ACCOUNTS_ENCRYPTION_KEY` protects, not only Alpaca.

FR-6. `.github/workflows/deploy-dev.yml` is reworked to deploy to the droplet (SSH- or
DO-API-driven) instead of `doctl apps update $DO_DEV_APP_ID --spec .do/app.dev.yaml`, and includes
a migration-gating step that blocks the deploy on migration failure — reusing
`docker-compose.yml`'s existing `db-migrator` service + `depends_on: service_completed_successfully`
chain, which already mirrors App Platform's `PRE_DEPLOY` job-kind behavior.

FR-7. A minimal rollback path exists on the droplet — re-pointing the compose file's `image:` tags
to the previous known-good GHCR SHA and re-running the blue/green swap — as the droplet-side
equivalent of App Platform's one-command deployment-history rollback.

FR-8. `docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`, and root `CLAUDE.md` are
updated to describe the new dev/staging deployment topology once implemented. (Per `/sdd-design`,
the actual surface is larger — also `docs/patterns/observability.md`, `docs/setup/alpaca.md`,
`docs/patterns/frontend-auth.md`, `docs/runbooks/mcp-tools.md`, `docs/CLAUDE.md`/`docs/setup/
CLAUDE.md` index lines, and `docs/context-constitution.md`'s PLAT-N3 check — see `design.md` § 10.
Highest priority: `docs/patterns/config-startup.md` and `docs/patterns/docker-build.md` both assert
"DO App Platform has no `depends_on`," which becomes literally false once dev runs on a droplet
with real Compose `depends_on`.)

**FR-9** (scope amendment, recorded via `/sdd-design` rounds 3-4, user sign-off per Constitution
C-11 — see `context.md` § sdd-design). Dropping blue/green (FR-2, forced by an F-06 DB-pool Floor
breach) removes any downtime mitigation for the 10 services Caddy doesn't front. Minimal client-side
gRPC retry-on-`UNAVAILABLE` is added across `xstockstrat-trading`, `-portfolio`, `-marketdata`
(Go: `grpc.WithDefaultServiceConfig` alongside existing `clientKeepAlive`), `-indicators`, `-ingest`,
`-analysis`, `-agent` (Python: retry options at channel-creation sites), and `-ui` (Node: a
**separate** `makeRetryTransport()` factory used by 9 of the 10 backend clients — `tradingClient`
keeps the original, non-retrying `makeTransport()`). `TradingService.PlaceOrder`/`ReplaceOrder`/
`CancelOrder` are excluded from retry everywhere: `ClientOrderID` is minted fresh server-side per
call, so retrying after an already-executed request would double-order. Full mechanics, the
per-language edit sites, and the exclusion's structural (not filter-dependent) enforcement in Node
are in `design.md` § 8.

**FR-10** (scope amendment, recorded via `/sdd-design` round 5, user sign-off per Constitution
C-11). DO App Platform's dev app stays live in parallel with the droplet for an explicit
validation/coexistence period — not an instant cutover. A `VALIDATION_MODE` env flag (default
false) gates `xstockstrat-trading`'s three background pollers and `xstockstrat-analysis`'s two
background loops at their launch sites (their existing per-poller interval configs don't actually
pause execution), plus `xstockstrat-marketdata`'s two background pollers via the existing
`interval_ms<=0` config gate, plus a skip of `xstockstrat-ingest`'s boot-time job-reconciliation
call — all four confirmed to have always-on write paths against the shared dev DB with no
cross-instance deduplication, which would otherwise double-fire ledger events/alerts if both
environments ran live simultaneously. Cutover pauses DO App Platform first (bounded blackout),
then flips the flag and redeploys — never the reverse, to avoid a window where both are live at
once. Full cutover criteria, sequencing, CI/CD wiring, and the decommissioning step are in
`design.md` § 9.

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

Root-level orchestration is unchanged in kind from the original framing — `docker-compose.yml`,
`.github/workflows/deploy-dev.yml`, `docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`,
root `CLAUDE.md`. **FR-9 and FR-10 (recorded scope amendments) do touch service code** — this is no
longer purely infra-only:

- **Deploy-topology only (no code change)**: `xstockstrat-portfolio`, `-identity`, `-notify`,
  `-config`, `-ui` (beyond FR-9's Node transport-factory addition), `-agent` (beyond FR-9's Python
  channel-options addition), `-ledger`.
- **FR-9 (gRPC retry)**: `-trading`, `-portfolio`, `-marketdata` (Go dial-site edits),
  `-indicators`, `-ingest`, `-analysis`, `-agent` (Python channel-option edits), `-ui` (Node
  transport-factory split).
- **FR-10 (migration/coexistence)**: `-trading`, `-analysis` (new `VALIDATION_MODE`-gated launch
  sites), `-marketdata` (config-gated pause, no code change), `-ingest` (`VALIDATION_MODE`-gated
  skip of boot-time reconciliation).
- Per `docs/runbooks/reviewer-registry.md`'s Service Owners table, each service in the FR-9/FR-10
  lists needs its owner's review — this is a real governance footprint beyond the original
  infra-only framing, not a formality.

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

1. All 12 services from the Service Registry run on the droplet via `docker-compose.yml` and pass
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
9. (FR-10) Log/process inspection confirms zero fill-poller/position-sync/live-loop/marketdata-
   poller cycles ran on the droplet while `VALIDATION_MODE=true` during the coexistence soak,
   verified only within the ordered, isolated cutover window (never as a standalone check while
   both environments hold live shared-DB access — see `design.md` § 9).

## Open Questions

All items below were resolved during `/sdd-design`'s 5-round debate — see `design.md` for the
full reasoning and `context.md` for the round-by-round narrative. Remaining unresolved items are
tracked as `design.md` § Open Risks, not here.

- [x] Secrets-provisioning mechanism: restricted-permission (`chmod 600`) `.env` file, CI-populated
      over SSH — `design.md` § 6.
- [x] Droplet sizing: `s-4vcpu-8gb` (RAM estimated ~5.3-5.8Gi steady-state; CPU explicitly left
      unbudgeted as an open risk for load-testing) — `design.md` § Open Risks.
- [x] Go-service healthchecks: a new TCP-dial binary baked into the 3 distroless Dockerfiles;
      `xstockstrat-ui` reuses the existing `nc -z` pattern — `design.md` § 4.
- [x] AC-2 downtime-budget number: Caddy `lb_try_duration 10s` on the two public paths; internal
      services get FR-9's retry mechanism instead, tracked as a separate qualitative criterion, not
      folded into AC-2's measured number — `design.md` § 1, § 8.
- [x] Known-trap check: no direct `fails.md` entry existed for CI/CD/deploy-topology changes at
      story time. This feature's own design debate produced two new `fails.md` entries instead — a
      `scope-creep` entry (first instance of that category) recording how FR-9/FR-10 drifted from
      the original infra-only framing despite every individual step being explicitly approved.
