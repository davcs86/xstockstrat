# Context: droplet-compose-deploy

**Feature**: `docs/roadmap/features/083-droplet-compose-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/083-droplet-compose-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/083-droplet-compose-deploy/implementation-spec.md`

---

## Session 2026-07-31 — sdd-story

- Preceded by an ad hoc pros/tradeoffs analysis of DO App Platform vs. a DO Droplet + Docker
  Compose, done in plan mode before this feature was formalized. That analysis (not itself an SDD
  artifact) grounded the following user decisions, carried into this feature's scope:
  - **Database**: keep DO Managed Postgres — do not self-host TimescaleDB on the droplet.
  - **Scope**: dev/staging only for now — production stays on DO App Platform.
  - **Downtime tolerance**: near-zero-downtime deploys must be preserved, which is why the design
    direction (Caddy blue/green, not a bare `docker compose up -d`) was carried into FR-2 rather
    than left as an open question.
- Created feature.md (status: `draft`), product-spec.md, context.md from the user story above.
- Reviewers snapshotted from `docs/runbooks/reviewer-registry.md`: Platform Lead (cross-service
  architecture — closest match for a deployment-topology change) and Security (secrets handling,
  since FR-5 introduces a new droplet-side secrets story with no registry-listed owner service).
- Checked `docs/roadmap/ledger/fails.md` and `insights.md` for a directly relevant known trap —
  none found specifically about CI/CD or deploy-topology changes. Flagged the general C-10
  "shared surface must move together" pattern as the closest applicable lesson in the product
  spec's Open Questions, since this feature touches several documentation surfaces that must all
  update in step.
- Next step: `/sdd-review droplet-compose-deploy product-spec`, then `/sdd-design
  droplet-compose-deploy` (full mode recommended given the cross-cutting infra scope, not `quick`).

## Session 2026-07-31 — sdd-review product-spec

- Criteria pass (`spec-reviewer`): **PASS WITH WARNINGS**. No Floor (`F-*`) breach, no blocker.
  Two findings were factual errors in the spec and were corrected in this session:
  - FR-1/Affected Services/AC-1 claimed **13** application services; root `CLAUDE.md` § Service
    Registry, `docker-compose.yml`, and `.do/app.dev.yaml` all list **12**. Fixed throughout
    `product-spec.md`.
  - FR-5 named the secret env var `ALPACA_SECRET`; the actual key in `.do/app.dev.yaml:129-132`
    is `ALPACA_API_SECRET`. Fixed.
  - Also added a one-line provider-agnostic clarification to FR-5 (C-2 trading-domain check):
    the secrets-provisioning mechanism change affects only how broker credentials reach the
    runtime, not order-execution/broker-integration logic, and isn't Alpaca-specific.
  - Remaining warnings left as-is (correctly scoped `/sdd-design` deferrals, not spec defects):
    AC-2's downtime threshold is intentionally unquantified pending design; the 5 Open Questions
    items are legitimate design-phase decisions; FR-8's doc-update list may be incomplete
    (`docs/patterns/observability.md` flagged as a possible missed surface) — carried forward as
    an explicit item for `/sdd-design` to close, not assumed resolved by this spec.
- Overlap pass (`feature-overlap`): **CLEAN**. No FAIL-level collision (config key / proto field /
  migration number) with any in-flight feature. `docker-compose.yml` and `.do/app.dev.yaml` touches
  from features 033 (observability) and 076 (FMP secret env) are already merged to trunk — 083
  builds on top of them, not racing them. One design tension flagged for `/sdd-design` (not a
  merge-order collision): feature 033 wires per-service OTel env vars into `.do/app.dev.yaml`,
  which 083 retires as the dev deploy target — dev-side OTel env provisioning needs to move to the
  droplet's `docker-compose.yml`/secrets mechanism.
- Outcome: **PASS**. Status: `draft` → `spec-ready`.
- Next step: `/sdd-design droplet-compose-deploy` (full mode).

## Session 2026-07-31 — sdd-design (Phase 0 Recon + Phase 1 Grilling, 5 rounds, full mode)

**Phase 0 Recon**: 3 parallel `codebase-discovery` passes (deployment orchestration files, doc
surfaces needing updates, existing secrets-handling patterns) wrote `recon.md`. Key findings: no
existing Caddy/nginx/SSH-deploy/secrets-manager tooling anywhere in the repo (all of FR-2/FR-5/FR-6/
FR-7 are greenfield); every service port in `docker-compose.yml` publishes to `0.0.0.0`; 3 Go
services (distroless) + `xstockstrat-ui` have no healthcheck; the doc-surface list needing FR-8
updates is much larger than product-spec's original 3 files (10+ surfaces, including
`docs/patterns/config-startup.md`'s "DO ignores depends_on" claim, which becomes literally false
once dev runs on a droplet).

**Phase 1 Grilling — 5 rounds** (hard cap for full mode, all mandated 2+ met and extended by user
request):

- **Round 1**: Proposed full blue/green (dual Compose stacks, Caddy admin-API swap). **BLOCKED**:
  adversary found an unmitigated **F-06** Floor breach — both stacks' DB pools open simultaneously
  during every swap would transiently need ~40 connections against the repo's hard 20-connection
  budget. User steered: drop blue/green for single-stack rolling restart, accepting brief per-service
  restart gaps over atomic zero-downtime (informed tradeoff, not default).
- **Round 2**: Revised to single-stack rolling restart, `DATABASE_URL` parameterization, `timescaledb`
  gating via `profiles:`, real Go readiness checks, `IMAGE_TAG`-based rollback, two-layer concurrency
  lock. Adversary verdict: **NEEDS WORK** — the `timescaledb` profile-gating claim was factually
  incomplete (6 services besides `db-migrator` still hard-depend on it; nothing activates the profile
  for local dev, a real workflow regression) and reopened an F-06-adjacent transient-pool-doubling
  concern. User steered: run another round to fix the functional defect before approving.
- **Round 3**: Fixed the `timescaledb` dependency chain (strip `depends_on: timescaledb` from all 7
  sites, replace `db-migrator`'s with a `wait-for-deps.sh`-based container-level probe; the other 6
  sites' existing `db-migrator: service_completed_successfully` chain substitutes), committed to
  strict no-overlap recreate (closes F-06 cleanly), added `COMPOSE_PROFILES=local-db` +
  auto-remediation, `lb_try_duration` for AC-2, a Security review gate mapping, and an SSH
  forced-command restriction. Adversary verdict: **NEEDS WORK** — verified F-06 genuinely clean and
  the 7 depends_on sites checked out exactly, but found the `COMPOSE_PROFILES` delivery mechanism
  didn't actually work as described (`setup-env.sh` never reads `.env.example`) and
  `scripts/Dockerfile.migrate` was missing a `COPY wait-for-deps.sh` it needed. User steered: run
  another round to fix these concrete bugs, AND (separately) approved expanding scope to add minimal
  gRPC client retry-on-`UNAVAILABLE` for the 10 internal services blue/green had been protecting —
  since dropping blue/green left them with zero downtime mitigation and no existing retry logic
  exists anywhere in this codebase (confirmed by grep). This is a real, recorded **C-11** scope
  amendment, not a silent default.
- **Round 4**: Fixed all 3 concrete bugs (setup-env.sh heredoc edit, bootstrap.sh auto-append,
  `db-migrator` switched to GHCR image-pull + Dockerfile COPY fix) and designed the gRPC retry
  mechanism per language (Go: `WithDefaultServiceConfig` alongside existing `clientKeepAlive`;
  Python: channel-creation-site options, not per-RPC-site; Node: single shared interceptor). Found
  and named the `PlaceOrder`/`ReplaceOrder`/`CancelOrder` exclusion requirement (`ClientOrderID` is
  minted fresh server-side, so a retry-after-actual-execution would double-order — verified against
  `trading.go:337-341`). Adversary verdict: **NEEDS WORK** — every code claim checked out precisely,
  but (a) the retry work was never in product-spec.md's scope with no C-11 sign-off yet recorded, and
  (b) the PlaceOrder safety exclusion's only real enforcement point (Node — Go/Python never call
  `PlaceOrder` at all) depended on an unverified Connect interceptor API's method-name filtering.
  User steered: considered and rejected Consul Connect as the retry mechanism (would need a sidecar
  per service on a droplet sized for 13 containers, plus a new mTLS story — disproportionate to the
  problem), then chose to keep the simpler grpc-service-config approach and fix the Node safety gap.
- **Round 5**: User added a **new constraint mid-debate**: DO App Platform must stay live in parallel
  with the droplet during a validation/coexistence period, cutting over only once proven — not an
  instant switch. Supplementary `codebase-discovery` confirmed a real safety issue: `xstockstrat-
  trading` and `xstockstrat-analysis` both run always-on background loops with **no idempotency
  keys** on their ledger emits — two live instances against the shared dev DB would produce
  duplicate ledger events/alerts. Also found `xstockstrat-marketdata`'s WS streaming has an Alpaca
  free-tier single-connection-per-account limit, and `xstockstrat-ingest`'s boot-time job
  reconciliation would wrongly fail jobs genuinely running on the other instance. Designed
  `VALIDATION_MODE` env flag (gates trading/analysis's background loops at the launch site, since
  their existing config knobs don't actually pause execution — only credential-health's does),
  explicit cutover criteria/mechanism/decommissioning. Adversary verdict: **NEEDS WORK** at the hard
  cap — found the ingest mitigation (manual pre-boot check) was operationally impossible given
  automated `deploy-droplet` runs, and that marketdata's two already-documented always-on pollers
  (distinct from the lazy WS path) were left ungated despite having a working `interval_ms<=0` pause
  mechanism already available — an unverified "policy-only, no gate" absence claim, same trap this
  repo's `fails.md` has caught twice before (080/081 entries). No round 6 exists; the orchestrator
  applied the adversary's own proposed fixes directly (ingest: `VALIDATION_MODE`-gate
  `reconcile_interrupted` itself; marketdata: config-set both interval_ms to 0 during coexistence;
  explicit pause-App-Platform-first cutover ordering with a bounded blackout budget instead of
  "immediately adjacent"; the env-template flip to `VALIDATION_MODE=false` moved to cutover time
  itself, not 2 weeks later; AC-9's verification scoped to only run within the isolated cutover
  window). Presented the final synthesis at the round-5 terminal gate; user approved.

**Outcome**: **APPROVED** at the round-5 hard cap. Status: `spec-ready` → `design-approved`.
`recon.md` and `design.md` written.

**Two scope amendments recorded** (Constitution C-11, explicit user sign-off at each gate, not
silently absorbed): (1) gRPC client retry-on-`UNAVAILABLE` across 8 of 12 services; (2) a
migration/coexistence phase (`VALIDATION_MODE` flag + explicit cutover mechanism) keeping DO App
Platform live in parallel until the droplet is validated. **`product-spec.md` needs new FRs for
both before `/sdd-spec` runs** — design.md carries the current scope record but the product spec
should be the source of truth going into implementation planning.

**Ledger write due**: `docs/roadmap/ledger/fails.md` gets a new `scope-creep` entry (see next
session) — this feature's own design.md names it as a strong first instance of a category that
existed in the ledger schema but had never been populated: three individually-justified rounds of
incremental scope expansion cumulatively drifted an "infra-only, no business-logic changes"
product-spec into touching core service startup code across 8 of 12 services.

Next step: log the `fails.md` entry, then update `product-spec.md`'s FRs, then
`/sdd-spec droplet-compose-deploy`.
