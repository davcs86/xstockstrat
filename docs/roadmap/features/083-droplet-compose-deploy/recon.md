# Recon: droplet-compose-deploy

**Created**: 2026-07-31
**From**: product-spec.md
**Affected services**: Root-level orchestration (`docker-compose.yml`, `.github/workflows/deploy-dev.yml`, `docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`, root `CLAUDE.md`); all 12 `xstockstrat-<service>` services deploy unchanged (hosting only changes)

---

## Objective

Replace DO App Platform as the dev/staging deploy target with a single DO Droplet running the
repo's existing `docker-compose.yml`, fronted by a Caddy reverse proxy that provides TLS
termination and a blue/green swap so deploys stay near-zero-downtime. The DO Managed Postgres
cluster, all 12 services' business logic, and production (still on App Platform) are unchanged.

## Codebase Map

This is a platform/infrastructure feature — there is no single service's handler/servicer to map.
Instead, the "codebase" is the deployment orchestration surface itself:

- **`docker-compose.yml`** (repo root, 540 lines)
  - YAML anchors: `x-common-env` (`:15`), `x-db-url` (`:22`), `x-svc` — sets `networks: [xstockstrat]` +
    `restart: unless-stopped` (`:27-30`), `x-hc-defaults` — `interval: 5s, timeout: 3s, retries: 12,
    start_period: 5s` (`:36-40`)
  - Every service's port binding uses the short `"HOST:CONTAINER"` form, which Compose publishes to
    `0.0.0.0` by default — e.g. `xstockstrat-config` `"50060:50060"` (`:120-121`), `timescaledb`
    `"5432:5432"` (`:76-77`), full per-service list in Risks below.
  - `db-migrator` service: `build: {context: ., dockerfile: scripts/Dockerfile.migrate}`,
    `depends_on: timescaledb: {condition: service_healthy}`, `restart: "no"` (`:89-103`). Nine
    downstream services depend on it via `condition: service_completed_successfully` — e.g.
    `xstockstrat-config` (`:128-132`), `xstockstrat-ui` (`:483-484`) — this is the exact chain FR-6
    reuses for migration-gating.
  - `otel-collector` service: image `otel/opentelemetry-collector-contrib:0.103.0`, mounts
    `./packages/otel/otel-collector-config.yaml`, publishes `4317`/`4318`/`13133` (`:52-65`).
  - Healthchecks: present on `timescaledb`, `xstockstrat-config`, `-ledger`, `-identity`, `-notify`,
    `-indicators`, `-ingest`, `-analysis`, `-agent`. **Absent** on `xstockstrat-marketdata`
    (`:233-267`), `-portfolio` (`:382-410`), `-trading` (`:413-446`) — the three Go/distroless
    services (comment at `:35`: "Go (distroless): no healthcheck — distroless has no shell or nc")
    — and on `xstockstrat-ui` (`:449-498`, Node/Next, no block present).
  - `scripts/Dockerfile.migrate` is shared as-is between `docker-compose.yml:90-92` and
    `.do/app.dev.yaml:472` — a genuine reusable artifact for FR-6.
  - `scripts/wait-for-deps.sh` (91 lines) — generic TCP-probe readiness gate (`nc -z`/`/dev/tcp`),
    already invoked per-service via `WAIT_FOR` at container startup (e.g. `:145,178,212,284,320,359`).
    Reusable as the readiness-check *primitive*, but it currently runs inside containers at boot,
    not as an external blue/green health gate Caddy would need.

- **`.do/app.dev.yaml`** (486 lines, being replaced as the dev deploy target)
  - Ingress rules: `/agent` → `xstockstrat-agent` (`:12-16`), `/` → `xstockstrat-ui` (`:17-21`) —
    the exact public-surface boundary FR-2 must reproduce on the droplet.
  - `db-migrator` `PRE_DEPLOY` job (`:463-479`) — uses the same `scripts/Dockerfile.migrate`.
  - `type: SECRET` env vars (all `scope: RUN_TIME`): `BROKER_ACCOUNTS_ENCRYPTION_KEY` (trading,
    `:71-74`), `ALPACA_API_KEY`/`ALPACA_API_SECRET`/`FMP_API_KEY` (marketdata, `:125-136`),
    `MCP_AGENT_SECRET` (ingest/analysis/agent/notify, `:205-207,245-247,279-281,386-388`),
    `JWT_SECRET` (identity/ui, `:348-351,451-454`), `OTEL_EXPORTER_OTLP_HEADERS`
    (app-global, `:34-36`). This is the FR-5 secrets inventory.
  - `:8-9` carries a **stale comment** referencing the removed nginx proxy — not live behavior
    (App Platform's own `ingress:` block below it is what actually routes). Worth a cleanup note
    since this file is the one this feature retires.

- **CI deploy chain**: `deploy-dev.yml` → reusable `deploy.yml` → `docker-build.yml`
  - `doctl apps update ${{ secrets.DO_APP_ID }} --spec /tmp/app_spec_substituted.yaml
    --update-sources` (`deploy.yml:93`) is the exact command FR-6 replaces.
  - Placeholder substitution: `sed` for image org/tag, then a `python3 -c` heredoc for secret
    placeholders (`deploy.yml:52-88`) — reused *shape* (CI-owned substitution, not DO-dashboard
    entry) is the pattern the droplet secrets design should keep.
  - Deploy-completion wait loop: polls `doctl apps get-deployment --format Phase` up to 60×15s
    (`deploy.yml:108-126`) — the polling *shape* is reusable for a droplet health-poll, but it
    targets DO's deployment API today, not container/HTTP state.
  - `docker-build.yml` already builds and tags all 12 services to GHCR (`<short_sha>` +
    `latest-dev`) — FR-1's "no new build mechanism" is already true; nothing to change here.

- **`scripts/do-setup-check.sh`** (149 lines) — read-only App-Platform-oriented setup checklist
  (`doctl apps list`, `doctl databases list`, required GitHub secrets). Not droplet-aware; would
  need a droplet-equivalent check (SSH key presence, `doctl compute droplet list`) if this feature
  adds one, or can be left for a follow-up.

## Patterns to REUSE

- **Migration gating** → reuse `docker-compose.yml`'s existing `db-migrator` +
  `depends_on: condition: service_completed_successfully` chain (`docker-compose.yml:89-103` +
  nine dependent services) — already functionally equivalent to App Platform's `PRE_DEPLOY` job;
  no new mechanism needed for FR-6's migration-gating requirement.
- **Readiness probing primitive** → reuse `scripts/wait-for-deps.sh`'s `nc -z`/`/dev/tcp` TCP-probe
  logic as the basis for any droplet-side/Caddy-side readiness check, rather than inventing a new
  probe mechanism from scratch — it's already the repo's canonical "is this service up" check.
- **CI-owned secret substitution shape** → reuse the *pattern* (not the DO-specific mechanism) from
  `deploy.yml:52-88`: secrets live in GitHub Actions repo secrets and get substituted at deploy
  time by CI, never entered through a dashboard. `docs/setup/digitalocean.md:300,356` documents
  *why* this pattern exists (`doctl apps update --spec` resets DO-dashboard-set secrets to empty on
  every deploy) — that specific constraint disappears once App Platform is no longer the deploy
  target, but the underlying principle (CI-substituted, never manually re-entered) should carry
  forward to whatever droplet secrets mechanism is chosen.
- **`.env.example` three-file convention** → `.env.example:4-15` documents `.env.local`
  (committed, no secrets), `.env.fe.local` (committed, no secrets), `.env` (gitignored, real
  secrets) — reuse this existing convention's *shape* as the template for how droplet secrets are
  organized, rather than introducing a fourth, different file-naming scheme.
- **Migration image** → `scripts/Dockerfile.migrate` is already shared identically between compose
  and the DO App Platform `PRE_DEPLOY` job — no new migration-runner image needed for the droplet.

## Dependencies

- Proto/RPC: none — no service business logic changes.
- Migration: none — no new `.up.sql`/`.down.sql`; DB stays on DO Managed Postgres unchanged.
- Config keys: none. Confirmed the `secret.*` `xstockstrat-config` prefix does **not** apply here —
  `docs/patterns/config-governance.md:109` documents that feature 076 removed
  `secret.marketdata.fmp.api_key` because "no `secret://` resolver was ever built"; FMP/JWT/Alpaca
  secrets all use plain env vars, not the config service. This feature's secrets (FR-5) are
  app-spec/compose-level env vars, a different and currently-unimplemented-elsewhere mechanism —
  design should not conflate the two or assume `xstockstrat-config` can absorb this need.
- Inter-service edges: none new — all 12 services' existing gRPC call graph is unchanged; only the
  host they run on changes.
- New env vars / ports: none of the *application* env vars change. What's new is **infrastructure**
  config: Caddy's own config (a `Caddyfile` or equivalent — confirmed absent from the repo, see
  Risks), and whatever secrets-provisioning file/mechanism FR-5 lands on. Confirmed
  `BROKER_ACCOUNTS_ENCRYPTION_KEY` is not currently referenced anywhere in `docker-compose.yml` at
  all (only in `.env.example:48` and the DO deploy path) — if the droplet needs it wired into
  compose, that's a new addition to the compose file, not a rename of an existing one.

## Risks / Not-found

- **No existing Caddy/nginx/HAProxy/Traefik config anywhere in the repo.** Confirmed via
  `Glob **/Caddyfile*` (no results) and a repo-wide grep for `caddy|nginx.conf` — every hit is a
  documentation reference to the already-deprecated, removed nginx proxy
  (`docs/patterns/nginx-routing.md`). FR-2's Caddy layer is genuinely new, not resuming dormant
  infra — the design phase should treat it as greenfield, with correspondingly more scrutiny on
  its blue/green swap logic and TLS cert renewal path.
- **No existing SSH-based deploy, droplet-provisioning, secrets-templating, or droplet health-poll
  script anywhere in `scripts/` or `.github/workflows/`.** Grepped for `ssh|scp|rsync|droplet` —
  no real hits (one false positive in `check-duplication.sh`). FR-5/FR-6/FR-7's droplet-side
  tooling must be written from scratch; there is nothing to extend.
- **No secrets-manager tooling exists anywhere in the repo** (no `sops`, `age`, `vault`, `1Password`
  CLI usage). The only `doctl` usage today is App Platform app/project/database operations, never
  secret storage. FR-5's "exact mechanism" open question is genuinely unresolved by any existing
  pattern — the design phase must decide it from first principles (a plain restricted-permission
  `.env` file following the existing `.env.example` convention's shape is the closest existing
  analog, per Patterns to REUSE above; a full secrets manager would be new infrastructure).
- **`MCP_AGENT_SECRET` and `OTEL_EXPORTER_OTLP_HEADERS` are NOT part of the CI-substitution
  pipeline today** — unlike `JWT_SECRET`/`ALPACA_*`/`BROKER_ACCOUNTS_ENCRYPTION_KEY`, these two are
  `type: SECRET` with no `value:` placeholder and no substitution step in `deploy.yml`
  (`.do/app.dev.yaml:34-36,205-207,245-247,279-281,386-388`) — they rely on manual DO-dashboard
  entry today. A droplet migration must account for these two differently than the other secrets,
  since there's no existing CI step to model their provisioning on.
- **Every application service port in `docker-compose.yml` publishes to `0.0.0.0` by the short
  `"HOST:CONTAINER"` binding syntax** — all 12 app services plus `timescaledb` (`5432`) and
  `otel-collector` (`4317/4318/13133`). FR-3 requires rewriting these (e.g. to `"127.0.0.1:PORT:PORT"`
  or removing the host publish entirely) — this is a real edit to the file, not something already
  droplet-safe. `timescaledb`'s port matters even though the DB itself stays on DO Managed Postgres,
  if any droplet-local Postgres tooling or debugging container is ever added later — flagged for
  design awareness, not a scope change.
- **Three Go services have no healthcheck at all** (`xstockstrat-marketdata`, `-portfolio`,
  `-trading` — distroless images, no shell/`nc`), and neither does `xstockstrat-ui`. Product-spec's
  own Open Questions already flags this; recon confirms the exact absence with line ranges above.
  Caddy's blue/green swap needs *some* readiness signal for these four services before routing
  traffic to a new container set — this is a concrete design decision, not a hypothetical.
- **Doc-surface list is larger than FR-8 currently names.** FR-8 lists only
  `docs/setup/digitalocean.md`, `docs/patterns/ci-overview.md`, and root `CLAUDE.md`. Recon found
  at least these additional living-doc surfaces with dev-App-Platform-specific content that would
  go stale:
  - `docs/patterns/observability.md:5-6,16` — exact text: "Local dev: Services push OTLP to
    otel-collector:4317 (Docker Compose)... Production: Services push OTLP directly to Grafana
    Cloud OTLP gateway (no collector needed on DO App Platform)." Once dev runs on the droplet
    (still Docker Compose, still has an otel-collector container per FR nothing-changes-here), this
    text likely stays *accurate* — dev keeps the collector-per-compose pattern — but the doc's own
    dev/prod framing implicitly assumes dev = App Platform, which becomes misleading.
  - `docs/setup/grafana-cloud.md:3,15-16,139-158` — Step 4 heading "Production Setup (DO App
    Platform)" currently doubles as the dev instructions; needs an explicit droplet carve-out.
  - `docs/setup/alpaca.md:75,136-144,277` — "Set them only as encrypted environment variables in DO
    App Platform"; Branch → Deployment Reference table names `.do/app.dev.yaml` for dev.
  - `docs/patterns/frontend-auth.md:248,268,271` — required-env-var table cites `.do/app.dev.yaml`;
    contributor checklist items tell people to add new UI env vars/routes there.
  - `docs/patterns/docker-build.md:409-424,459-467,478-480,595` — "Digital Ocean Compatibility" +
    "Service Readiness and Healthchecks" section states "DO App Platform... has no depends_on" as
    the rationale for the `WAIT_FOR` env-var pattern. This rationale becomes environment-dependent
    once dev is a droplet running real Compose `depends_on`.
  - **`docs/patterns/config-startup.md:9,44`** — states "DigitalOcean App Platform starts all
    services concurrently — there is no depends_on ordering... This has no effect on DigitalOcean
    App Platform, which ignores depends_on entirely." **This claim becomes literally false for the
    dev environment** once it runs on a droplet via Compose, which *does* honor `depends_on` —
    this is a genuine new finding beyond what product-spec.md's Open Questions anticipated, and the
    strongest concrete instance of the C-10 "shared surface" risk the spec already flagged in the
    abstract.
  - `docs/runbooks/mcp-tools.md:23-25` — agent endpoint framing names "the DO App Platform" as
    where `/agent` prefix routing happens.
  - `docs/CLAUDE.md:39`, `docs/setup/CLAUDE.md:9` — index-file one-liners pointing at
    `digitalocean.md` framed as "dev/prod App Platform apps."
  - `docs/context-constitution.md:39` (PLAT-N3) — gRPC keepalive is tuned to survive "idle DO App
    Platform GOAWAYs"; worth a design-phase check on whether Caddy/droplet networking reproduces
    the same idle-connection behavior this norm was tuned against, or whether the tuning becomes
    unnecessary/needs adjustment for the droplet path.
  - Lower priority / advisory only: `docs/patterns/nginx-routing.md` (already marked deprecated),
    `docs/launch-pdfs/*.md` (marketing decks, not operational docs), and historical
    `docs/roadmap/features/<NNN>/{implementation-spec,context}.md` files for already-`launched`
    features (append-only records, not living docs — not expected to be retroactively rewritten).
  - This list should be reconciled into an explicit FR-8/AC-8 scope decision during Phase 1
    grilling — recon does not resolve which of these get updated, only that FR-8's current
    three-file list under-counts the real surface.
- **`fails.md`/`insights.md`**: confirmed at `/sdd-story` time and re-confirmed here — no entry
  specifically about CI/CD or deploy-topology changes. The applicable pattern remains the general
  **C-10** "a shared surface must be updated everywhere" family (2026-07-01 entries), which this
  recon's doc-surface findings now make concrete rather than abstract.

## Recommended Scope

Advisory only — not binding on `/sdd-spec`:

1. **Caddy + droplet compose skeleton**: adapt `docker-compose.yml` port bindings (FR-3), add a
   `Caddyfile` (new) implementing the blue/green swap + TLS for the `/agent` and `/` paths (FR-2).
2. **Readiness signal for the four healthcheck-less services** (marketdata, portfolio, trading, ui)
   — resolve the Open Question on whether to add lightweight healthchecks or infer readiness
   another way, since Caddy's swap needs *something* to gate on.
3. **Secrets provisioning mechanism** (FR-5) — decide the concrete mechanism (leaning
   restricted-permission `.env` file per the `.env.example` convention, per Patterns to REUSE)
   and explicitly handle the `MCP_AGENT_SECRET`/`OTEL_EXPORTER_OTLP_HEADERS` gap (no existing
   CI-substitution path for these two today).
4. **CI/CD rework** (FR-6/FR-7): replace `deploy-dev.yml`'s `doctl apps update` call with an
   SSH/API-driven droplet deploy + rollback script, reusing `db-migrator`'s existing gating chain
   and `wait-for-deps.sh`'s probe logic where applicable.
5. **Documentation sweep** (FR-8): reconcile the expanded doc-surface list above into an explicit,
   complete set — `config-startup.md`'s "DO ignores depends_on" claim is the highest-priority fix
   since it becomes factually wrong, not just stale.
6. **Downtime-budget number + droplet sizing** — both explicit Open Questions in product-spec.md;
   no codebase evidence resolves either, they're operational decisions for the grilling phase.
