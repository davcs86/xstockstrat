# Staging smoke-check runtime — design (Project A)

Status: draft for approval. Companion Project B (SDD integration: check authoring in `/sdd-execute`,
part-splitting and gating) is brainstormed after this one is approved.

## Intent

After a feature (or a part of one) deploys to staging, prove it works on the live environment — DB state,
service behaviour, wiring — and keep a durable record, tied to the deployed commit, that the next feature
part can read and correct against. Today nothing verifies a live deploy: the `api-smoke` Playwright specs
run against a mock backend, `scripts/integration-test.sh` targets removed 80xx ports, and `promote.yml`
carries a manual "smoke-tested on dev" checkbox.

## Goals

- Infra-agnostic: a target is only `endpoint + auth key + environment label`. No check or runner knows
  whether staging is DO App Platform, a homelab VM, or local compose.
- Runner-agnostic: GitHub Actions, a Claude session, and post-deploy jobs all use the same HTTP contract.
- Every result carries the deployed commit SHA and a hash of the check definition.
- Failures are first-class, durable, queryable records so a follow-up feature part can correct them.
- Run-once per environment: a check is *pending* until it has a green attempt there.

## Non-goals

- Arbitrary SQL or script bodies over the wire. Production verification. Load/perf tests. Replacing CI e2e.
- Platform-wide or privileged writes (global config, backfill, data deletion, restarts, secrets), and system
  or admin identities. Auto-rollback on smoke failure.
- `doctl apps console` / container shells as a trigger path.
- Authoring checks during `/sdd-execute` and splitting features into gated parts (Project B).

## Anti-goals (failure even if it "works")

- A phase-1 check that mutates staging, in the DB or through any service RPC.
- A phase-2 write that escapes the smoke user's scope, writes to the DB directly, touches a real-money
  broker account, or leaves a fixture behind after a failed or timed-out run.
- A leaked key that yields data exfiltration or code execution. With cross-service reads in scope the key
  gates read access to every internal service, so catalog-only execution, read-only enforcement, mTLS and
  no public listener are all load-bearing.
- A green result not attributable to the commit actually deployed.
- A skipped or errored check reported as a pass.
- A results commit that triggers a deploy, or a git write credential on the smoke service itself. The only
  accepted exception is the PAT on the DO `POST_DEPLOY` job (see Results location and writers).

## Constraints

- Backends are gRPC-only today; this service adds a recorded HTTP exception (platform-lead approval).
- New service approval (platform lead); DB role migration (DBA + service owner); new config keys
  (owner + config team). See `docs/runbooks/approval-flow.md`.
- Inter-service mTLS is fail-closed (`MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT`); the DB connection pool budget in
  root `CLAUDE.md` must be re-checked.
- Homelab staging is tailnet-only; Claude cloud sessions cannot join the tailnet.
- DO dev (app `xstockstrat-staging`, `.do/app.dev.yaml`): every backend is `internal_ports` only; only
  `xstockstrat-agent` (9000) and `xstockstrat-ui` (3000) have HTTP ingress. GitHub Actions cannot reach an
  internal-only component directly. `doctl` has no documented command to start a job on demand.
- Calling other services requires, per target service: an mTLS peer identity for the smoke service, an
  `x-internal-caller` allow-list grant, and a decision on `x-user-id` (the reserved `system` identity is
  currently honoured only for analysis's fundamentals producer). Each target service's owner approves.
- Staging deploys can skip intermediate SHAs: `deploy-homelab.yml` uses a per-environment concurrency group
  (GitHub keeps one pending run per group), so a part's merge commit may never deploy on its own.

## Evidence

`docs/reports/2026-10-30-smoke-verification-needs.md` classified 1,209 acceptance scenarios (blind re-rating
κ 0.67). Of the live-verifiable ones, read-only suffices for 26–34%, scoped writes are needed for 42–44% and
platform/privileged writes for 23–30%; half the read-only ones depend on pre-existing data. Among read-only
scenarios 91% need no user or one ordinary user; system identity is 3% and admin 7%, and the system cases
concern a specific peer service, which a generic system user cannot stand in for. Hence: phase 2 scoped
writes under the same non-admin identity, and no system or admin identity.

## Approaches considered

1. Route inside `xstockstrat-agent`: least new infrastructure, native MCP, but the same image ships to
   prod (gated by config, not absent) and the agent would hold a DB credential. Rejected.
2. **New staging-only service (chosen).** Own image, HTTP surface, read-only DB role and pool; absent from
   the prod app specs, so production exposure is impossible by construction.
3. Ephemeral post-deploy job containers, no endpoint. Rejected: removes on-demand triggering.
4. Exec into containers via `doctl apps console`. Rejected: needs a broad DO token, bypasses the catalog and
   key, and scripting it is undocumented.

## Decisions made by the user

- The service accepts **names + parameters of registered checks only**; the catalog ships in the runner image
  of the deployed commit. Auth is a secret key in a request header.
- Checks may **read the DB and call any internal service**. **Phase 1 is read RPCs only.** **Phase 2, right
  after phase 1, adds scoped writes**: owner-scoped mutating RPCs as the smoke user against disposable
  fixtures.
- Identity: one **dedicated non-admin smoke user**. No system user and no admin identity (see Evidence).
- Checks are added to the catalog by feature execution (merge of the feature/part PR). **Run once** per
  environment; failures are **tracked and logged** so the next part can fix them.
- Triggers: GitHub Actions, Claude, post-deploy jobs. Claude reaches the service through a **tool on the
  staging MCP (`xstockstrat-agent`) that calls the new service**.
- Environments: **homelab staging and DO dev (`xstockstrat-staging`)**; not production. Pending state is
  per environment.
- The durable result record is **a committed file** (the "dedicated artifact").
- `doctl` is not used.
- Result files go on a dedicated branch (`smoke-results`); the DO dev writer uses a PAT.
- Features needing intermediate checks are split into parts (Project B).

## Proposals (my calls — not yet agreed)

- **Name:** `xstockstrat-smoke`.
- **Contract:** `GET /checks` (catalog: `check_id, check_hash, feature, part`), `POST /runs`
  (`{checks:[…]}`), `GET /runs/{id}`.
- **The service keeps no durable history.** It holds a bounded buffer of recent runs so a recorder can fetch
  them; the committed files are the system of record. This drops the ledger from the design.
- **Result record:** `run_id, check_id, check_hash, feature, part, env, deployed_sha, outcome
  (PASS|FAIL|ERROR|TIMEOUT), started_at, duration_ms, trigger, rpcs_invoked, evidence`. Evidence is
  size-bounded and redacted (no secrets, no raw PII rows).
- **File layout:** one immutable JSON file per run — `smoke-results/<env>/<UTC>-<run_id>.json` — so
  concurrent writers never merge-conflict.
- **Pending is computed by the caller:** `GET /checks` minus the `(check_id, check_hash, env)` keys that
  have a PASS in the results files. An edited check is pending again; a FAIL clears only via a later PASS of
  the same key. A PASS stays green on later commits (regression detection stays with CI/permanent suites).
- **Deployed train head:** results attribute to the SHA actually deployed, which may be a train of several
  merges. A part's identity comes from the check's `feature`/`part` metadata, not from a SHA. A check is
  eligible when it is in the deployed image's catalog; Project B gates on "deployed SHA contains the part's
  merge commit" (`git merge-base --is-ancestor`). One short-SHA tag covers all images
  (`docker-build.yml` builds every service in one matrix); DO path to verify in recon.
- **Read-only enforcement without a per-check allowlist:** mark read RPCs `idempotency_level =
  NO_SIDE_EFFECTS` in the protos (non-breaking), and have the runner's client refuse any method whose
  descriptor lacks it. Phase 2 lifts this. Fallback if annotating is too heavy: review convention plus the
  `rpcs_invoked` audit trail.
- **Auth:** key held as an encrypted config secret (`GetSecret`), constant-time compare, rotation via
  config. Identity-issued short-lived tokens are the upgrade path.
- **DB:** dedicated read-only role, `statement_timeout`, small dedicated pool; pooled-vs-direct decided
  against the Connection Pool Budget table.
- **Concurrency:** one in-flight run per environment; per-check timeout.
- **Post-deploy policy:** a red result marks the deployment check failed and annotates the commit; it does
  not trigger rollback.
- **Reachability:** no public listener in either environment. Homelab: GitHub Actions and post-deploy jobs
  join the tailnet as `deploy-homelab.yml` already does. DO dev: the service is internal-only, triggered by a
  `POST_DEPLOY` job and by Claude through the agent's public route. The agent tools are never registered on
  a prod agent.

## Phase 2 — scoped writes (follows phase 1 directly; mechanics are my proposals)

- **Scope:** owner-scoped mutating RPCs called as the smoke user (non-admin) against fixtures the check
  creates. The DB role stays read-only; services own every write.
- **Enforcement:** a reviewed allowlist of scoped-write RPC names (`app/scoped_writes.py`), seeded from the
  RPCs the W2 scenarios exercise. An RPC that is neither annotated `NO_SIDE_EFFECTS` nor allowlisted is
  refused. Platform or privileged RPCs (`SetConfig`, `GetSecret`, backfill and deletion RPCs,
  `RunFundamentalsScan`, user and role management, `AppendEvent`) are never allowlisted.
- **Guards (all must hold or the write is refused and the check reports ERROR):** config key
  `smoke.writes.enabled` is true (default false, switchable live without a redeploy); the environment label
  is staging; every call carries the smoke user's id with no admin access-scope bit; trading fixtures use an
  offline or paper account only (to verify in recon).
- **Fixture lifecycle:** fixture names carry `smoke-<run_id>`; every created fixture registers a cleanup
  that runs last-in-first-out after PASS, FAIL, ERROR and TIMEOUT; each check may declare a janitor that
  removes leftover `smoke-*` fixtures owned by the smoke user before the check runs. A failed cleanup is
  recorded and makes the check ERROR, so leaks surface.
- **Records** gain `writes_performed` (mutating RPC names) and `cleanup` (`OK|FAILED|NONE`). Run-once still
  applies, and a write check must be safe to re-run because a FAIL stays pending.
- **Accepted residue:** append-only ledger and audit events from smoke writes accumulate under the smoke
  user.
- **Smoke user:** created once per environment by an operator (identity user creation is admin-only),
  recorded in `smoke.rpc.user_id`; runbook, not automation.

## Results location and writers (decided; mechanics are my proposals)

Result files live on a dedicated, non-deploying branch, `smoke-results` (user decision), so a results commit
can never trigger the `main-dev` deploy pipeline. Each trigger path commits its own run files:

- **GitHub Actions / homelab post-deploy job:** `GITHUB_TOKEN` with `contents: write`, scoped to the workflow.
- **DO dev `POST_DEPLOY` job:** runs the checks over private networking and pushes the run files with a
  **PAT** (user decision) held as a `type: SECRET` env var of that job only — never on the smoke service.
- **Claude:** the agent tool returns the run records; the session commits them to `smoke-results` through its
  GitHub access. An uncommitted run stays unrecorded, so its checks remain pending.
- Run files are unique per run, so concurrent pushes rebase trivially; the writer retries on non-fast-forward.

**Residual risk of the PAT.** A fine-grained PAT cannot be limited to one branch; with `contents: write` a
leak could push to any branch the rulesets don't protect. Mitigations to build in: fine-grained and
single-repo, `Contents` only (no `workflows`/`administration`), owned by a dedicated machine account, short
expiry with a rotation runbook, and `main-dev`/`main` rulesets verified to block it (`scripts/setup-branch-protection.sh`).
A GitHub App installation token is the stronger upgrade path if the residual risk is not acceptable.

## Left to the builder

Implementation language (lean Python 3.13/uv); check manifest and file layout; SQL assertion format and
script sandboxing; exact RPC-client wrapper; how the agent tool is gated off in prod; deploy-pipeline wiring
in `deploy-homelab.yml` and the DO path; shared writer helper (commit run files, rebase-retry); `smoke-results`
branch bootstrap and ruleset; PAT rotation runbook; CI job and coverage.
