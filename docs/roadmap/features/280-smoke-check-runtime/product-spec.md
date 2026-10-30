# Product Spec: smoke-check-runtime

**Created**: 2026-10-30
**Revised**: 2026-10-30 (design phase — mTLS-only listener, no shared key, slices S0–S8)

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
FR-2. Every endpoint is served only over mutual TLS: a client must present a leaf chained to the platform
CA whose SAN is in `{xstockstrat-agent, xstockstrat-smoke-trigger}`, otherwise the handshake fails or the
request is refused 403 and nothing executes; clients pin the server name `xstockstrat-smoke`; the service
refuses to start without its `MTLS_*` material, and its image cannot be built without the deployed SHA.
FR-3. `POST /runs` executes named checks sequentially with a per-check timeout and outcomes
`PASS|FAIL|ERROR|TIMEOUT`; one run at a time with a bounded lock hold; a watchdog ends the process if the
event loop is blocked (strict mode exit 70, record-only mode ERROR file and exit 0); checks are async-only
(linted); evidence is flat scalars, redacted and size-bounded.
FR-4. Checks read the database only through a dedicated read-only role inside read-only transactions with a
statement timeout; a role that is not read-only degrades to per-check ERROR without exiting the process.
FR-5. Checks call any backend's RPC as the smoke user, carrying `x-user-id`, `x-access-scope` (no admin bit)
and `x-trace-id`, only for RPCs annotated `idempotency_level = NO_SIDE_EFFECTS` plus an operator-approved
benign-reads mechanism (runtime guard, descriptor tests, zero enabled entries initially); every invoked RPC
is recorded in call order; `GetSecret` is never callable.
FR-6. Each run is recorded as one immutable JSON file on the orphan `smoke-results` branch, including
`deployed_sha` and `triggered_by`; a check is pending for `(check_id, check_hash, env)` until a PASS exists;
failed attempts are retained and queryable; recorder failures are handled per trigger mode.
FR-7. Runs are triggered by the homelab post-deploy workflow step (staging only, strict mode, recorded by a
separate job), a DO dev `POST_DEPLOY` job (record-only, always exits 0), and an admin-gated `smoke_checks`
tool on the staging agent.
FR-8. The service exists only in staging: absent from `.do/app.yaml`; the production homelab render is
byte-identical (smoke lives in a staging-only overlay); the staging port 9110 is bound to the tailnet
address; no public listener anywhere.
FR-9. Phase 2: owner-scoped writes are allowed only for allowlisted RPCs, only while config key
`smoke.writes.enabled` is true, only in a staging environment label, never with the admin access-scope bit;
every created fixture is cleaned up after any outcome and leftovers are swept before the next run. The
initial allowlist (portfolio watchlist RPCs) is approved by the portfolio owner.
FR-10. Checks run as one dedicated non-admin smoke user configured in `smoke.rpc.user_id` (created once per
environment by an operator with `scripts/manage-users.py`); a missing value makes RPC checks report ERROR
while DB-only checks still run.
FR-11. Annotated reads must not become fetchable by HTTP GET through the UI BFF: `dispatchConnect` rejects
non-POST requests with 405 and `Allow: POST` on the trader, insights and config-ui segments, before the
annotations ship.
FR-12. The pure-read RPCs of the ten service protos carry `NO_SIDE_EFFECTS`; `packages/proto/buf.yaml`
permanently excepts `RPC_SAME_IDEMPOTENCY_LEVEL` from `buf breaking`; the real generated stubs resolve the
annotation at runtime.

Design constraints (not behaviours): the `smoke-` fixture-name prefix is the smoke user's ownership
convention (documented in the service `CLAUDE.md`, C-10c); tunables are named service constants with
defaults in the service `CLAUDE.md` (F-07); uvicorn is pinned exactly because the SAN hook subclasses an
internal class.

## Out of Scope

- Authoring checks inside `/sdd-execute` and splitting features into gated parts ("Project B": a separate
  follow-up feature that depends on this one's check API and run-file schema).
- Platform-wide or privileged writes (global config, backfill, deletion, restarts, secrets).
- System-user and admin identities; production verification; load/perf tests; a shared API key.
- An on-demand GitHub workflow; GitHub App token for the writer; auto-rollback; `doctl` triggers.

## Affected Services

- `xstockstrat-smoke` — new service (Python, Starlette, port 9110, mTLS HTTPS, internal/tailnet only). Root
  `CLAUDE.md` Service Registry, Inter-Service Dependencies, Connection Pool Budget (direct 8 → 9) and Key File
  Paths are updated, plus a `SMOKE_ENDPOINT` amendment (an `_ENDPOINT` var carrying HTTPS mTLS `host:port`).
- `xstockstrat-config` — migration `035` (`smoke.rpc.user_id`) and, in phase 2, `036` (`smoke.writes.enabled`); no
  secret, no `SECRET_CALLER_ALLOWLIST` change.
- `xstockstrat-agent` — `smoke_checks` tool, registered only when `SMOKE_ENDPOINT` is set.
- `xstockstrat-ui` — `src/lib/bffShared.ts` non-POST 405 guard and tests (trader, insights, config-ui).
- `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`, `xstockstrat-indicators`,
  `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-ledger`, `xstockstrat-identity`,
  `xstockstrat-notify` — proto annotations only (no behaviour change); phase 2 owner approval of the allowlist.
- Platform wiring (no service code): `docker-compose.yml`, `deploy/homelab/*` (new `compose.smoke.yml`, render
  check/assert/test), `.do/app.dev.yaml`, `.github/workflows/{ci,docker-build,deploy,deploy-dev,deploy-homelab}.yml`,
  `scripts/{gen-dev-certs.sh,mtls-dev-env.sh,mtls-provision.sh,homelab-*}`, `packages/proto/buf.yaml`.

**Recorded exception — HTTP surface.** Backends are gRPC-only, but the callers here (the agent, a DO job, a GitHub
job) are not gRPC clients; the listener is HTTPS with mutual TLS, internal/tailnet-only and staging-only, so the
fail-closed mTLS rule of feature 210 is extended to it. Platform-lead approval is a gate below.

| Target | Presence | Caller reaches it as |
|---|---|---|
| docker-compose (local) | present, port 9110 | agent: `xstockstrat-smoke:9110` |
| homelab staging | present via overlay `compose.smoke.yml`, port 9110 published bound to `SMOKE_BIND_ADDR` (tailnet address) | GitHub job: `${VM_IP}:9110` with the trigger leaf; agent: `xstockstrat-smoke:9110` |
| homelab production | absent (compose.yml byte-identical) | — |
| DO dev | present, `internal_ports [9110]`, no ingress | `POST_DEPLOY` job and agent: `${xstockstrat-smoke.PRIVATE_DOMAIN}:9110` |
| DO prod | absent | — |

## Consumer Surface(s)

- [ ] **UI** — none (the BFF 405 guard is a hardening change, not a new surface).
- [x] **Agent** — `xstockstrat-agent` MCP tool `smoke_checks` (actions `list`, `run`, `get_run`), admin-gated, registered only on a staging agent.
- [ ] **None** — not applicable: the agent tool is the Claude-facing surface; the homelab step and the DO job are machine triggers.

## Proto Contract Changes

- [ ] No proto changes required
- `option idempotency_level = NO_SIDE_EFFECTS;` on pure-read RPCs across the ten service protos (trading,
  portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, config); read-looking RPCs with
  side effects stay unannotated (`marketdata.GetFundamentals`, `GetFundamentalsMulti`, `GetLatestQuote(s)`,
  `GetLatestPrice`, `BatchGet*`, `ListAssets`, `analysis.ListOpportunities`, `EvaluateReadiness`,
  `GetWatchlistReadiness`, `config.GetSecret`). No field, enum or number changes, no new RPCs.
- `packages/proto/buf.yaml` gains `breaking: {use: [FILE], except: [RPC_SAME_IDEMPOTENCY_LEVEL]}` (the annotation
  trips the default FILE category; operator chose a permanent exception, recorded in `context.md`).

## Config Key Changes

- `smoke.rpc.user_id` — string, default `''`, staging + production rows (phase 1, migration `035`).
- `smoke.writes.enabled` — bool, default `false`, staging + production rows (phase 2, migration `036`).
- Removed from the design: `smoke.api.key`, `SMOKE_API_KEY`, `x-smoke-key`.

## Database Changes

- [x] No schema changes to any service schema.
- Two `xstockstrat-config` migrations, each with an up+down pair, replay-safe (`ON CONFLICT DO NOTHING`), run in
  numeric order: `035` seeds `smoke.rpc.user_id`; `036` seeds `smoke.writes.enabled` (phase 2, so phase 1 ships
  without it). Feature 264 holds `034`: `035` must not reach any environment before `034` (merge-order gate; renumber
  to max+1 at merge if needed).
- Connection route: `xstockstrat-smoke` connects direct (`:25060`/`5432`) as a read-only role with pool max 1, so the
  direct total goes from 8 to 9 on staging and DO dev; `render-assert.jq` gets an explicit read-only class. The role is
  a DBA-provisioned SQL file + runbook (no migration; no role-creation mechanism exists).

## Feature Workflow Notes

Branch: the operator pinned this work to `claude/smoke-test-deployment-0f1z5j` (PR #1359 → `main-dev`). Slices
S0–S8 are commits on that branch pushed one at a time so CI runs on each head; there are no step PRs, so no PR
targets a `claude/*` base. Merging to `main-dev` auto-deploys homelab staging when `HOMELAB_STAGING_ENABLED` is
true, so every external prerequisite must exist before merge. Approval gates (per
docs/runbooks/feature-workflow.md and approval-flow.md):
- [x] Platform lead (new service + HTTP exception); config team (new keys); DBA + service owner (read-only role,
  config migrations)
- [x] Proto Reviewer + owners of the ten annotated protos (annotation-only; permanent `breaking` exception)
- [x] Portfolio owner approval of the phase-2 allowlist (phase 2 only)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] All design-phase questions are resolved in `design.md` (rounds 1–5, operator gates recorded in
  `context.md`).
- [x] Accepted open risks (carried into `design.md` Open Risks and the first-deploy proof list in `context.md`):
  tailnet ACL `tag:ci` → VM:9110 and no non-tailnet interface; homelab-edge `smoke_ro` role; DO `POST_DEPLOY`
  failure semantics and private-domain reachability; homelab gate acceptance of the shipped file; migration `035`
  ordering behind feature 264; reliance on default workflow permissions for the `record` job.
- [x] `@AC-1 @feature-214` ("advertised tool count is 45") is re-scoped to "when `SMOKE_ENDPOINT` is unset" — operator
  sign-off recorded in `context.md`.
