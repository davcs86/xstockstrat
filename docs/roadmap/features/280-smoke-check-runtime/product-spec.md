# Product Spec: smoke-check-runtime

**Created**: 2026-10-30

---

## Problem Statement

Nothing verifies a feature on a live staging environment after it deploys: the `api-smoke` Playwright
specs run against a mock backend, `scripts/integration-test.sh` targets removed 80xx ports, and
`promote.yml` carries a manual "smoke-tested on dev" checkbox. Platform engineers and the agents that
build the next part of a feature have no durable, commit-attributed record of what worked on staging.

## User Story

As a platform engineer (and the SDD agent building a feature's next part), I want a staging-only service
that runs registered checks against the deployed environment and records every attempt against the
deployed commit, so that failures are tracked and can be corrected by the next feature part.

## Functional Requirements

FR-1. The service lists its registered checks (id, feature, part, `check_hash`) and the deployed commit
SHA; a check module that fails to load is reported as a load error, never dropped silently.
FR-2. Every endpoint requires the header `x-smoke-key` matching the config secret `smoke.api.key`; a
missing or wrong key is rejected with 401 and nothing executes; the service refuses to start without the
key.
FR-3. `POST /runs` executes named checks sequentially with a per-check timeout and outcomes
`PASS|FAIL|ERROR|TIMEOUT`; one run at a time; evidence is redacted and size-bounded.
FR-4. Checks read the database only through a dedicated read-only role inside read-only transactions with
a statement timeout.
FR-5. Checks call any backend's RPC as the smoke user, carrying `x-user-id`, `x-access-scope` (no admin
bit) and `x-trace-id`, but only RPCs annotated `idempotency_level = NO_SIDE_EFFECTS` (phase 1); every
invoked RPC is recorded in call order.
FR-6. Each run is recorded as one immutable JSON file on the `smoke-results` branch; a check is pending
for `(check_id, check_hash, env)` until a PASS exists; failed attempts are retained and queryable.
FR-7. Runs are triggered by the homelab post-deploy workflow step (staging only), a DO dev `POST_DEPLOY`
job that always exits 0, and an admin-gated `smoke_checks` tool on the staging agent.
FR-8. The service exists only in staging: absent from `.do/app.yaml` and from production homelab
renders, with no public listener.
FR-9. Phase 2: owner-scoped writes are allowed only for allowlisted RPCs, only while config key
`smoke.writes.enabled` is true, only in a staging environment label, never with the admin access-scope
bit; every created fixture is cleaned up after any outcome and leftovers are swept before the next run.
The initial allowlist is fixed at `/sdd-spec` time from the owner-scoped write scenarios and approved by
each target-service owner; AC-19 uses portfolio `CreateWatchlist` as the representative entry.
FR-10. Checks run as one dedicated non-admin smoke user configured in `smoke.rpc.user_id` (created once
per environment by an operator with `scripts/manage-users.py`); a missing value makes RPC checks report
ERROR while DB-only checks still run.

Design constraints (not behaviours): the key comparison is constant-time and unit-tested; the `smoke-`
fixture-name prefix is the smoke user's ownership convention and is documented in the service
`CLAUDE.md` (C-10c).

## Out of Scope

- Authoring checks inside `/sdd-execute` and splitting features into gated parts ("Project B": a
  separate follow-up feature that depends on this one's check format and result schema).
- Platform-wide or privileged writes (global config, backfill, deletion, restarts, secrets).
- System-user and admin identities; production verification; load/perf tests.
- An on-demand GitHub workflow; identity-issued tokens; a GitHub App token for the writer; auto-rollback.

## Affected Services

- `xstockstrat-smoke` — new service (Python, Starlette, port 9110, internal only). Root `CLAUDE.md`
  Service Registry, Inter-Service Dependencies, Connection Pool Budget and Key File Paths are updated in
  the same change.
- `xstockstrat-config` — two migrations, `SECRET_CALLER_ALLOWLIST` grant, tests, and the config proto
  annotation.
- `xstockstrat-agent` — `smoke_checks` tool, registered only when `SMOKE_ENDPOINT` is set.
- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`, `xstockstrat-indicators`,
  `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-ledger`, `xstockstrat-identity`,
  `xstockstrat-notify` — proto annotations only (no behavior change); phase 2 owner approval of which
  owner-scoped writes are allowlisted.
- Platform wiring (no service code): `docker-compose.yml`, `deploy/homelab/*`, `.do/app.dev.yaml`,
  `.github/workflows/{ci,docker-build,deploy,deploy-dev,deploy-homelab}.yml`, `scripts/gen-dev-certs.sh`,
  `scripts/mtls-dev-env.sh`.

**Recorded exception — HTTP surface.** Backends are gRPC-only, but the callers here (GitHub Actions, a DO
job, the agent) reach the service with a header key; the service is internal-only (tailnet or DO private
networking) and staging-only. Platform-lead approval is a gate below.

| Target | Presence | `SMOKE_ENDPOINT` seen by callers |
|---|---|---|
| docker-compose (local) | present, port 9110 | agent: `xstockstrat-smoke:9110` |
| homelab staging | present via compose profile `smoke`, port 9110 published to the tailnet | CI step: `${VM_IP}:9110`; agent: `xstockstrat-smoke:9110` |
| homelab production | absent | — |
| DO dev | present, `internal_ports [9110]`, no ingress | `POST_DEPLOY` job and agent: `${xstockstrat-smoke.PRIVATE_DOMAIN}:9110` |
| DO prod | absent | — |

## Consumer Surface(s)

- [ ] **UI** — none.
- [x] **Agent** — `xstockstrat-agent` MCP tool `smoke_checks` (actions `list`, `run`, `get_run`), admin-gated, registered only on a staging agent.
- [ ] **None** — not applicable: the agent tool is the Claude-facing surface; GitHub Actions and the DO job are machine triggers.

## Proto Contract Changes

- [ ] No proto changes required
- Non-breaking: `option idempotency_level = NO_SIDE_EFFECTS;` on pure-read RPCs across the ten service
  protos (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify,
  config); read-looking RPCs with side effects stay unannotated (`marketdata.GetFundamentals`,
  `GetFundamentalsMulti`, `GetLatestQuote`, `GetLatestPrice`, `analysis.ListOpportunities`,
  `EvaluateReadiness`, `GetWatchlistReadiness`, `config.GetSecret`). No new RPCs or messages.

## Config Key Changes

- `smoke.api.key` — secret (encrypted at rest; row namespace `smoke`, key `api.key`; `GetSecret` grant
  with `peerSan: xstockstrat-smoke`).
- `smoke.rpc.user_id` — string, default `''`, staging + production rows.
- `smoke.writes.enabled` — bool, default `false`, staging + production rows (phase 2).

## Database Changes

- [x] No schema changes to any service schema.
- Two `xstockstrat-config` migrations, each with an up+down pair, run in numeric order by
  `scripts/db-migrate.sh`: the first seeds `smoke.api.key` and `smoke.rpc.user_id` (phase 1), the second
  seeds `smoke.writes.enabled` (phase 2, so phase 1 ships without it). Feature 264 holds `034`; take the
  next two free numbers at implementation time (`035` and `036` at the time of writing).
- Connection route: `xstockstrat-smoke` connects direct (`:25060`) with `DB_POOL_MAX=1`, so the direct
  total in the Connection Pool Budget table goes from 8 to 9. The read-only role is a DBA-provisioned SQL
  file + runbook (no migration; no role-creation mechanism exists).

## Feature Workflow Notes

Branch: the operator pinned this work to `claude/smoke-test-deployment-0f1z5j` (PR #1359 → `main-dev`).
Every commit lands on that branch and one PR merges it; there are no step PRs, so no PR targets a
`claude/*` base. Approval gates (per docs/runbooks/feature-workflow.md and approval-flow.md):
- [x] 1 service owner approval per annotated proto (non-breaking)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [x] DBA review + service owner (read-only role; config migrations)
- [x] Platform lead (new service + HTTP exception); config team (new keys)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Known trap — Affected Services completeness:** resolved. The list above enumerates every
  proto-owning service and wiring file; `/sdd-review` re-derived it from the codebase.
- [x] **Known trap — agent tool count (six surfaces):** resolved by ruling. `smoke_checks` is
  conditionally registered and excluded from the 45-tool parity surfaces; AC-16 pins it. The agent owner
  confirms in PR review.
- [x] **Known trap — grpcio vs `uv.lock`:** resolved as a requirement. The `/sdd-spec` step that
  regenerates stubs must cross-check the minimum `grpcio` against every Python service's `uv.lock`,
  including the new one.
- [x] **Known trap — env naming:** resolved. Smoke env labels are `homelab-staging` and `do-dev`; config
  rows are `staging`/`production`; the write guard tests membership in the staging label set, and a unit
  test pins that no comparison mixes the vocabularies.
- [x] **Known trap — deploy-time ACs never run:** resolved. AC-14/15/17/18/26 are proven offline
  (workflow-structure and render tests) and then on the first real staging deploy, recorded in
  `context.md` before `launched`.
- [x] Does the Python protobuf runtime expose `idempotency_level` on method descriptors? Deferred to
  `/sdd-design` Phase 0 (recon spike). Fallback: review convention plus the `rpcs_invoked` audit trail.
- [x] Does the trading service accept an offline/paper account for phase-2 order fixtures? Deferred to
  `/sdd-design` Phase 0 recon; if not, trading fixtures stay out of the phase-2 allowlist.
- [x] Tailnet ACL for `tag:ci` → the smoke port (external homelab-edge repo). Deferred to the
  implementation-spec step "homelab post-deploy trigger" as a named external prerequisite.
- [x] Does a failing DO `POST_DEPLOY` job fail the whole deployment, and is the smoke private domain
  reachable from a job? Deferred to the implementation-spec step "DO dev component + POST_DEPLOY job",
  which verifies both before the job is wired.
