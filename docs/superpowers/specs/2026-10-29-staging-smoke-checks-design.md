# Staging smoke-check runtime — design (Project A)

Status: draft for approval. Companion Project B (SDD integration) is brainstormed after this one is approved.

## Intent

After a feature (or a part of one) deploys to staging, prove it works on the live environment —
DB state, service behaviour, wiring — and keep a durable record, tied to the deployed commit, that the
next feature part can read and correct against. Today nothing verifies a live deploy: the `api-smoke`
Playwright specs run against a mock backend, `scripts/integration-test.sh` targets removed 80xx ports,
and `promote.yml` carries a manual "smoke-tested on dev" checkbox.

## Goals

- Infra-agnostic: a target is only `endpoint + auth key + environment label`. No check or runner knows
  whether staging is DO App Platform, a homelab VM, or local compose.
- Runner-agnostic: GitHub Actions, a Claude session, and post-deploy jobs all call the same HTTP contract.
- Every result carries the deployed commit SHA and a hash of the check definition.
- Failures are first-class, durable, queryable records (not just a red job) so a follow-up feature part can
  correct them.
- Run-once semantics per environment: a check is *pending* until it has a green attempt there.

## Non-goals

- Arbitrary SQL or script bodies over the wire. Prod verification. Load/perf tests. Replacing CI e2e.
- Auto-rollback on smoke failure. Authoring checks during `/sdd-execute` and splitting features into
  gated parts (Project B).

## Anti-goals (failure even if it "works")

- A check that mutates staging data, in the DB or through any service RPC.
- A leaked key that yields data exfiltration or code execution. With cross-service reads in scope, the key
  also gates read access to every internal service, so catalog-only execution, the read-RPC allowlist, mTLS
  and no public listener are all load-bearing.
- A green result not attributable to the commit actually deployed.
- A skipped or errored check reported as a pass.

## Constraints

- Backends are gRPC-only today; this service adds a recorded HTTP exception (platform-lead approval).
- New service approval (platform lead); DB role migration (DBA + service owner); new config keys
  (owner + config team). See `docs/runbooks/approval-flow.md`.
- Inter-service mTLS is fail-closed (`MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT`); DB connection pool budget in
  root `CLAUDE.md` must be re-checked.
- Homelab staging is tailnet-only; Claude cloud sessions cannot join the tailnet.
- DO dev (app `xstockstrat-staging`, `.do/app.dev.yaml`): every backend is `internal_ports` only; only
  `xstockstrat-agent` (9000) and `xstockstrat-ui` (3000) have HTTP ingress. GitHub Actions cannot reach an
  internal-only component directly.
- Calling other services requires, per target service: an mTLS peer identity for the smoke service, an
  `x-internal-caller` allow-list grant, and a decision on `x-user-id` (the reserved `system` identity is
  currently honoured only for analysis's fundamentals producer). Each target service's owner approves.

## Approaches considered

1. Route inside `xstockstrat-agent`: least new infrastructure, native MCP, but the same image ships to
   prod (gated by config, not absent) and the agent would hold a DB credential. Rejected.
2. **New staging-only service (chosen).** Own image, HTTP surface, read-only DB role and pool; absent from
   the prod app specs, so production exposure is impossible by construction.
3. Ephemeral post-deploy job containers, no endpoint. Rejected: removes on-demand triggering from GitHub
   and Claude.

## Decisions made by the user

- Service accepts **names + parameters of registered, read-only checks only** (DB queries and verification
  scripts); the catalog ships in the runner image of the deployed commit.
- Auth is a secret key in a request header.
- Checks are added to the catalog by feature execution (merge of the feature/part PR). **Run once** per
  environment; failures are **tracked and logged** so the next part can fix them.
- Triggers: GitHub Actions, Claude, post-deploy jobs. Claude reaches the service through a **tool on the
  staging MCP (`xstockstrat-agent`) that calls the new service**.
- Features needing intermediate checks are split into parts so the checks can run between them (Project B).
- Checks may **read the DB and call any internal service** (read-only, per the anti-goals above).
- Environments in scope: **homelab staging and DO dev (`xstockstrat-staging`)**. Not production. Pending
  state is tracked per environment.

## Proposals (my calls — not yet agreed)

- **Name:** `xstockstrat-smoke`.
- **Contract:** `GET /checks` (catalog + per-env pending/green/red), `POST /runs` (`{checks:[…]}` or
  `{pending:true}`), `GET /runs/{id}`, `GET /results?feature=&part=`.
- **Result record:** `run_id, check_id, feature, part, env, commit_sha, check_hash, outcome
  (PASS|FAIL|ERROR|TIMEOUT), started_at, duration_ms, trigger, evidence`. Evidence is size-bounded and
  redacted (no secrets, no raw PII rows).
- **Store:** append-only events in `xstockstrat-ledger` — `event_type=smoke.check.attempted`,
  `stream_key=smoke:<env>:<check_id>`, `idempotency_key=<run_id>:<check_id>`, platform-scoped (no
  `user_id`). Pending = catalog − checks with a PASS attempt. Needs recon: platform-scoped write ACL,
  `QueryEvents` filtering by `stream_key`/`event_type`, retention.
- **Auth:** key held as an encrypted config secret (`GetSecret`), constant-time compare, rotation via
  config. Identity-issued short-lived tokens are the upgrade path.
- **DB:** dedicated read-only role, `statement_timeout`, small dedicated pool; pooled-vs-direct decided
  against the Connection Pool Budget table.
- **Concurrency:** one in-flight run per environment; per-check timeout; checks idempotent by construction.
- **Post-deploy policy:** a red smoke result marks the deployment check failed and annotates the commit;
  it does **not** trigger rollback (the homelab VM already rolls back on an unhealthy release; smoke
  failure is feature-level information).
- **Claude path:** staging-instance agent tools `run_smoke_checks` / `get_smoke_results` call the service
  over HTTP with the same key, so there is one contract. The tools must not register on a prod agent.

## Calls made after the builder check (mine; veto any)

- **Service calls are allowlisted, not free-form.** A check declares the RPCs it uses; the runner's client
  wrapper permits only RPCs on a reviewed read-only allowlist (explicit method list, not a `Get*`/`List*`
  name heuristic). Mutating RPCs are unreachable from check code.
- **Release SHA:** one short-SHA tag covers all images in a release. The smoke image is built from the same
  commit, receives the SHA at build, and runs after the health gate. DO path to be verified in recon.
- **Store:** ledger first; fallback is a smoke-owned write schema under a role separate from the read-only
  check role. Resolved in recon before implementation planning.
- **Pending keyed on `(check_id, check_hash, env)`.** An edited check is pending again; a FAIL clears only
  via a later PASS of the same key. A PASS stays green on later commits — regression detection is out of
  scope (CI and permanent suites own it).
- **Reachability:** no public listener on the smoke service in either environment.
  - Homelab: GitHub Actions and post-deploy jobs join the tailnet as `deploy-homelab.yml` already does.
  - DO dev: the service is `internal_ports` only; it is triggered by a `POST_DEPLOY` job inside the app
    and by Claude through the agent's public route. GitHub Actions on-demand runs against DO dev go through
    the agent tool or a redeploy, not a direct call.
  - Claude: one agent tool per environment's agent; never registered on a prod agent.

## Left to the builder

Implementation language (lean Python 3.13/uv); check manifest and file layout; SQL assertion format and
script sandboxing (non-root, read-only, no mutating egress); exact ledger payload shape; how the agent tool
is gated off in prod; deploy-pipeline wiring in `deploy-homelab.yml` and the DO path; CI job and coverage.
