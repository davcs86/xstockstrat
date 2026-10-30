# Design: smoke-check-runtime

**Created**: 2026-10-30
**Rounds**: 5 (quick mode extended at the operator's request to the hard cap; termination: approved with accepted open risks)
**Approved by**: user @ 2026-10-30T04:30:00Z
**Grounded in**: recon.md (incl. "Addendum 2026-10-30")

---

## Chosen Approach

A new staging-only Python service, `services/xstockstrat-smoke`, built from the ingest skeleton
(`app/mtls.py`, `app/config/watcher.py`, `tests/conftest.py:48`; recon.md Codebase Map) with the agent's
uvicorn startup (`agent/app/main.py:91-246`). It runs a catalog of named checks baked into its image and exposes
`GET /checks`, `POST /runs`, `GET /runs/{id}` on 9110. Consumer surface (C-14): the admin-gated `smoke_checks`
tool on a staging agent plus two machine triggers (homelab post-deploy step, DO `POST_DEPLOY` job).

- **Transport and authorization (no shared key).** The listener is HTTPS with mutual TLS built from the service's own
  `MTLS_*` PEMs (`CERT_REQUIRED`, platform CA). Authorization is a SAN allowlist `{xstockstrat-agent,
  xstockstrat-smoke-trigger}`, implemented by subclassing uvicorn's `H11Protocol` and overriding `connection_made`,
  mapping `scope['client']` → SAN (spike passed on uvicorn 0.47.0 + httpx 0.28.1: allowed SANs 200, another platform
  leaf 403, no cert → connection error, wrong-SAN server rejected by `sni_hostname` pinning). The subclass is passed
  explicitly (`http='auto'` with `uvicorn[standard]` would bypass it) and a startup self-check plus test fail if it is
  bypassed. All clients (agent, homelab runner, DO job) pin the server name `xstockstrat-smoke` with
  `check_hostname=True` + the httpx `sni_hostname` extension; PEM temp files are unlinked before serving. There is no
  `smoke.api.key`, `x-smoke-key`, `GetSecret` grant or secret migration (the operator asked whether a secret is needed
  inside the mesh; backends already trust `x-user-id` from any mTLS peer, so a shared key added copies and rotation
  cost without raising the bar).
- **Execution.** Checks are async coroutines run in-process, sequentially, under `asyncio.wait_for`; a CI AST lint
  over `app/checks/**` rejects blocking or escape-hatch imports (`os`, `subprocess`, `socket`, `grpc`, `asyncpg`) and
  top-level calls; a watchdog thread (heartbeat, `LOOP_STALL_S=30`) ends the process if the loop is blocked — exit 70 in
  strict mode, an ERROR run file and exit 0 in record-only mode. One run at a time (409 with `Retry-After`, no holder
  disclosure); `RUN_LOCK_HOLD_S` bounds a hold; run ids are `uuid4().hex`. Evidence is a flat dict of scalars, long
  strings truncated, key-name and value-pattern redaction (also on failure messages and gRPC details), 4096-byte cap.
- **Reads.** DB: dedicated read-only role (`xstockstrat_<env>_smoke_ro`, DBA-provisioned SQL + runbook), `fetch`/
  `fetchval` only inside a read-only transaction with `SET LOCAL statement_timeout` (`read_budget.py:46,71`);
  startup asserts not-superuser / no write privilege / `default_transaction_read_only=on` and **degrades** to per-check
  ERROR (lazy pool) instead of exiting. RPC: `policy.decide(method)` over local descriptors allows only
  `idempotency_level = NO_SIDE_EFFECTS`; plus a **BENIGN_READS mechanism** (operator-approved override of the
  phase-1 anti-goal/FR-5) with each entry's side effect named, a runtime guard (portfolio reads refuse if the smoke
  user owns a broker account), descriptor-pool tests and a test-only entry — **zero enabled entries** until a check needs
  one. `config.GetSecret` is hard-denied. Every call carries the header trio as the smoke user (non-admin, never
  `system`).
- **Records.** Each run is one immutable JSON file `smoke-results/<env>/<UTC>-<run_id>.json` on an orphan branch
  `smoke-results` (schema `schema/run-file.v1.json`, `additionalProperties: true`, `schema_version` bumped by phase 2),
  including `deployed_sha` (baked at build; the build fails without it) and `triggered_by` (peer SAN). Pending is
  computed by a stdlib `smoke_client` from `(check_id, check_hash, env)`; `check_hash` = sha256(CHECKS_API_VERSION ‖
  the check's own source). Exit codes per mode: strict (homelab) exits 1 on a red result or recorder failure;
  record-only (DO) always exits 0 and logs `SMOKE_RECORD_FAILED`/`SMOKE_RUN_LOST`.
- **Homelab (staging).** Smoke lives in a **staging-only overlay** `deploy/homelab/compose.smoke.yml`; `compose.yml`
  and the production render stay byte-identical. For staging the shipped file is the overlay-merged
  `docker compose … config --no-interpolate --format json | jq 'del(.name,.networks)'` (proven by a staging dry run
  before merge); the digest resolver, render check and render test become target-aware (13 images production, 14
  staging), `render-assert.jq` gains a `smoke` class (read-only DSN, pool `"1"`, healthcheck timing ≥ the 90 s config
  wait, restart/logging, port 9110 bound to `SMOKE_BIND_ADDR`), and every overlay-dependent step is gated on staging
  **and** the overlay file existing (older image tags still deploy). Port 9110 is published on the tailnet address
  (`vars.SMOKE_BIND_ADDR`, checked == `VM_IP`). The GitHub deploy job runs a read-only smoke step with a trigger leaf
  minted from the CA it already holds, uploads the run file as an artifact, and a separate `record` job
  (`contents: write`, no tailnet/SSH secrets) pushes it with `GITHUB_TOKEN`.
- **DO dev.** `.do/app.dev.yaml` gets an internal-only component (`internal_ports [9110]`) and a `POST_DEPLOY` job
  running `app.trigger --mode record-only` with its own trigger-leaf envs (jobs inherit only app-level envs) and the
  PAT as a `type: SECRET` env; the PAT is confined by a ruleset to `smoke-results`. Trigger-leaf placeholders use a
  non-prefixed name (`YOUR_DEV_SMOKE_TRIGGER_MTLS_{CERT,KEY}`) to avoid the `deploy.yml` prefix-substitution collision
  with `YOUR_DEV_MTLS_CERT_SMOKE`; the leftover-placeholder guard and `workflow_call` secrets are extended.
- **Certs.** `xstockstrat-smoke` joins `gen-dev-certs.sh` `SERVICES` and the `mtls-dev-env.sh` pair list (every
  literal "12" → 13); the trigger leaf is minted inside the deploy jobs and stays **out** of `SERVICES`. `MTLS_SCOPE`
  is dropped.
- **Proto, BFF.** Annotate the pure-read RPCs of recon.md (10 protos) with `NO_SIDE_EFFECTS`; add a permanent
  `breaking: {use: [FILE], except: [RPC_SAME_IDEMPOTENCY_LEVEL]}` to `packages/proto/buf.yaml` (the annotation trips
  `buf breaking`; operator chose permanent over temporary). Because annotated methods become valid Connect GETs, the UI
  BFF `createDispatch` (`bffShared.ts:118-130`) returns 405 + `Allow: POST` for non-POST **before** the annotations
  ship; a real-stub test asserts allowlisted methods resolve `NO_SIDE_EFFECTS`.
- **Agent.** `smoke_checks(action: list|run|get_run)` is registered only when `SMOKE_ENDPOINT` is set (`host:port`,
  HTTPS, amendment recorded in root `CLAUDE.md`), `_require_admin` before any HTTP, plain `httpx` with the agent's leaf
  (not `egress.py`), excluded from the 45-tool surfaces.
- **Phase 2.** Migration `036` (`smoke.writes.enabled`, default false); one allowlisted write class (portfolio
  watchlist RPCs, request predicate: no `strategy_id` bindings, folded into `policy`), fixtures named
  `smoke-<run_id>`, async cleanups with deadlines, a janitor before each check, guards = flag ∧ staging label ∧ no admin
  bit. Soft-cleanup classes stay deferred to owner approval.
- **Delivery.** Slices (commits on the single PR branch, pushed one at a time so CI runs on each head): S0 contracts
  doc · S1 service core **with CI registration** · S2 run-file contract + recorder · S3 migration `035` (gated on
  feature 264's `034`) · S4 certs/compose/DO/docker-build/root `CLAUDE.md` · S5a BFF 405 + test · S5b annotations +
  stubs + buf (codegen host) · S6 homelab overlay/render/deploy steps/record job · S7 agent tool · S8 phase 2.

## Rejected Alternatives

- Route inside `xstockstrat-agent` — rejected: ships to production and gives the internet-facing agent DB reach.
- Ephemeral post-deploy job containers only, no endpoint — rejected: no on-demand triggering.
- `doctl apps console` / container exec as a trigger — rejected by the operator (broad token, bypasses the catalog).
- Shared `x-smoke-key` (config secret + GetSecret grant, or env secret) — rejected: copies in five places, rotation,
  a grant that production config would also honour; mTLS + SAN allowlist covers the actual callers.
- Key only on homelab — rejected: two authentication modes, same costs.
- A separate "trigger CA" — rejected: GitHub deploy jobs already hold the platform CA key (`deploy.yml:67-71,93-103`).
- SSH `gate smoke` verb for homelab — not chosen by the operator (homelab-only, unverified gate change).
- Subprocess per run — rejected by the operator: IPC, fork hazard with live gRPC channels, cleanup-after-kill semantics.
- Strict NO_SIDE_EFFECTS only (no benign list) — not chosen: would refuse almost all marketdata coverage.
- Annotating cache-fill reads `NO_SIDE_EFFECTS` — rejected: makes the proto contract say something false.
- Ledger as the result store / one recorder workflow — rejected: files on a branch written by each trigger path.
- Compose `profiles:` in `compose.yml` — kept only as a fallback if the staging dry run rejects the normalized file
  (it makes production resolve an unused smoke digest and breaks the 13-image render fixtures).
- Per-file `--exclude-path` or a temporary `ignore_only` for `buf breaking` — rejected: masks real breaks / needs a
  removal step that was already forgotten once (`fails.md` 202).
- `MTLS_SCOPE` env, reserved nullable phase-2 fields, a separate recorder image, GitHub-only recording — rejected
  (YAGNI / still need a DO write path).

## Open Risks

- [ ] External prerequisites unverified here: tailnet ACL `tag:ci` → VM:9110; the VM has no non-tailnet interface; the
  homelab-edge `smoke_ro` role and sizing — verify at slice S6 / first-deploy proof.
- [ ] DO `POST_DEPLOY` failure semantics and private-domain reachability from a job — verify with a throwaway job
  before wiring S4's DO job.
- [ ] Whether the homelab gate accepts the normalized shipped file / same project name — staging dry run before merge.
- [ ] Migration `035` must not reach any environment before feature 264's `034` — merge-order gate at S3.
- [ ] Merging to `main-dev` auto-deploys homelab staging when `HOMELAB_STAGING_ENABLED` is true, so every
  prerequisite (incl. the smoke DB password in staging `APP_ENV`) must exist before merge.
- [ ] The `record` job relies on the repo's default workflow permissions for `contents: write`.
- [ ] `H11Protocol` is uvicorn-internal API — pin uvicorn exactly; the hook-bypass test fails on upgrade.
- [ ] A smoke leaf is minted into production homelab `.env` (unused key material) because `SERVICES` is shared.
- [ ] Out of scope, recorded: stale feature-202 `--exclude-path trading/v1/trading.proto` in `ci.yml:145-148`.

## Constitution Rules Touched

- `C-03` — honored by: the header trio on every outbound RPC.
- `C-05` — honored by: `smoke.rpc.user_id`, `smoke.writes.enabled`; no secret keys.
- `C-07` — honored by: migrations `035`/`036` up+down, next free numbers after 264's `034`.
- `C-08`, `C-15` — honored by: every scenario mapped to a test layer; deploy-time-only ACs in a first-deploy proof list.
- `C-09` — honored by: `buf lint`/`breaking` + `buf-gen.sh` in S5b; permanent `except` recorded.
- `C-10` — honored by: every "12" literal, every deploy surface and the BFF are updated together.
- `C-11` — honored by: story → review → design (5 rounds) → ledger touch before any code.
- `C-14` — honored by: the agent tool is the named surface; the two machine triggers are listed.
- `C-16` — honored by: Business Rules Touched below; the CHANGE has the recorded sign-off.
- `C-18` — honored by: in-process execution, no new framework, overlay not profile, modules merged (no `scoped_writes`).
- `P-03` — honored by: external dependencies recorded as open risks and a first-deploy proof list, not assumed.
- `P-04` — honored by: each round's gate answered by the operator and recorded in `context.md`.
- `F-01` — honored by: only new migrations. `F-03` — honored: no step PRs; slices are commits on the one PR branch
  (operator constraint). `F-04` — honored: unfound items stay in recon "Not found". `F-06` — honored: direct pool total
  8 → 9, read-only class in `render-assert.jq`, budget table updated in S4. `F-07` — honored: tunables are named service
  constants with defaults in the service `CLAUDE.md`; operator-facing switches are config keys.

## Business Rules Touched (C-16)

- CHANGE `@AC-1 @feature-214` "The xstockstrat-agent MCP advertises no db_ tool" — re-scoped to "when
  `SMOKE_ENDPOINT` is unset" (a staging agent advertises 46); signed off by user @ 2026-10-30T04:30:00Z (context.md).
- EXTEND `@AC-9 @feature-183` — `smoke_checks` is a new admin-gated tool; `@AC-1/2/4 @feature-210` — the HTTP listener
  is mTLS fail-closed (the plaintext caveat is retired); `@AC-1/4 @feature-244`, `@AC-5/8 @feature-259`,
  `@AC-2 @feature-174` — the new Python service's getters, watcher reconnect and `smoke-` `client_id`.
- PRESERVE `@AC-25 @feature-224`; `@AC-10 @feature-147`; `@AC-3/5/6 @feature-196` (annotations change no field/enum);
  `@AC-5/6 @feature-210`, `@AC-6 @feature-224`, `@AC-9 @feature-196` (header trio; never `system`);
  `@AC-9 @feature-225`, indicators `@AC-1`, analysis `@AC-8/15` (empty `smoke.rpc.user_id` → ERROR, never PASS);
  `@AC-8 @feature-147`, `@AC-1/2 @feature-218` (no required variable added), `@AC-19 @feature-225` (replay-safe
  seeds). The secret/grant rules (`@feature-147` AC-1/1b/2/3/4/5/14/16, `@feature-254`, `@feature-224` AC-35,
  `@feature-166`) are untouched because no secret or grant is added.
