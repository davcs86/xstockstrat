# Context: smoke-check-runtime

**Feature**: `docs/roadmap/features/280-smoke-check-runtime/feature.md`
**Product Spec**: `docs/roadmap/features/280-smoke-check-runtime/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/280-smoke-check-runtime/implementation-spec.md`

---

## Session 2026-10-30T03:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the approved
  brainstorm design (`docs/superpowers/specs/2026-10-29-staging-smoke-checks-design.md`), the
  verification-needs report and the draft plan (`docs/superpowers/plans/2026-10-29-staging-smoke-checks.md`).
- Operator constraint: stay on `claude/smoke-test-deployment-0f1z5j` (PR #1359 into `main-dev`); no
  `feature/` or `feature-steps/` branches. The SDD branch model is overridden for this feature.
- Settled by the operator before this session: staging-only service with a header-key HTTP API; catalog of
  named checks (no ad-hoc SQL); run-once with tracked failures; results as committed files on
  `smoke-results` written by a PAT on the DO job; homelab + DO dev; no `doctl`; phase 1 read RPCs, phase 2
  scoped writes right after; no system or admin identity.
- Known traps carried from the ledger are listed under Open Questions in the product spec.

## Session 2026-10-30T03:40:00Z — sdd-review product-spec

- First pass FAIL (criterion 9: nine unchecked Open Questions) plus warnings; overlap scan found feature
  264 already holds config migration `034`. Spec and scenarios revised; migrations now take the next two
  free numbers (`035`/`036` at the time of writing); AC-3/5/12/13/14/15/20/23 reworded or split, AC-25..32
  added; SMOKE_ENDPOINT is `host:port`; env labels `homelab-staging`/`do-dev` (config rows stay
  `staging`/`production`).
- Second pass: PASS WITH WARNINGS (0 blockers). Status: draft → spec-ready.
- Warnings carried forward: AC-10/20/27/28 "no gRPC channel was opened" needs a mocked channel-factory
  seam defined at `/sdd-spec`; confirm the single-branch (no step PRs) flow at `/sdd-design`; re-verify
  `035`/`036` at implementation time and on rebase.
- Overlap findings (warn-level, no FAIL): ordering dependency on 264's `034`; file-level overlaps on
  `ci.yml` (251, 266, 278), `.do/app.dev.yaml` (266), `agent/app/tools.py` (215, 249), and proto files
  (215, 242, 249, 256). No merge-order row written (no FAIL-level overlap; `merge-order.md` is shared and
  needs operator confirmation) — proposed row: `smoke-check-runtime (280) | fix-portfolio-snapshot-surface
  (264) | config migration ordering: 280 takes 035/036, after 264's 034 | No`.
- No demoted-feature duplicate (checked 22 demoted/canceled features).

## Session 2026-10-30T03:30:00Z — sdd-design (round 1 gate)

- Phase 0 recon written (`recon.md`). Round 1: proposer + adversary; adversary found no Floor breach, 5 blocking objections.
- Operator gate answers: read policy = strict `NO_SIDE_EFFECTS` + an owner-signed benign-reads list (explicit
  override of the phase-1 anti-goal / FR-5 for named cache-fill reads, with runtime guard + descriptor tests);
  check execution = in-process, async-only checks (AST lint + watchdog), not a subprocess per run; key handling =
  operator asked "Do we need a secret if the smoke service is in the same mesh?" (open fork, carried to round 2);
  approval = "Run another round" (no sign-off yet for re-scoping `@AC-1 @feature-214`).
- Adopted from the adversary without operator input: flat-scalar evidence with value redaction on messages and
  error details; async-only cleanups with deadlines; read-only DB role startup assertions + fetch/fetchval only;
  orphan `smoke-results` branch + ruleset confining the PAT; baked deployed SHA (refuse to start without it);
  separate homelab record job (artifact handoff); `check_hash` over own source + API version; compose smoke
  block with `:-` defaults only; UI BFF 405 guard for non-POST (annotated reads would otherwise be valid GETs —
  verified: trader/insights/config-ui `route.ts` export GET and `dispatchConnect` forwards `req.method`).
- New affected service from the adversary: `xstockstrat-ui` (`src/lib/bffShared.ts` + test).

## Session 2026-10-30T03:40:00Z — sdd-design (round 2 gate)

- Round 2: operator's key question ("Do we need a secret if the smoke service is in the same mesh?") answered by
  the proposer: drop `smoke.api.key`/`x-smoke-key`; serve 9110 over the platform mTLS (CERT_REQUIRED). Adversary
  agreed in direction; found: the "trigger CA" fallback is pointless (GitHub deploy jobs already hold the platform
  CA key — `.github/workflows/deploy.yml:67-71,93-103`), a CA-only check lets any of 13 mesh identities hold the
  one-run lock (add a SAN allowlist + trigger attribution), hostname pinning must be explicit, PEM temp files
  must be unlinked, leaf wiring spans every deploy surface (`gen-dev-certs.sh`, three literal "12"s, DO job envs).
- Operator gate answers: homelab trigger path = tailnet-published mTLS port with a `xstockstrat-smoke-trigger`
  leaf (not an SSH `gate smoke` verb); approval = "Run another round" (no `@AC-1 @feature-214` sign-off yet).
- External prerequisites (homelab-edge repo, unverified): tailnet ACL for `tag:ci` -> the VM's port 9110; the VM has
  no non-tailnet interface (or the port is bound to the tailnet address, which `deploy-homelab.yml:224` already
  resolves as `VM_IP`).

## Session 2026-10-30T04:10:00Z — sdd-design (rounds 3-4 gates)

- Round 3 (consolidation): adversary verdict APPROVE WITH CORRECTIONS (no Floor breach). Key corrections
  adopted: `buf breaking` flags annotations (`RPC_SAME_IDEMPOTENCY_LEVEL`, default FILE; `packages/proto/buf.yaml`
  has no `breaking:` block); homelab `:?` vs `:-` and the `IMAGE_SMOKE`/count fixtures; DO job write credential;
  `MTLS_SCOPE` must default to production; BFF 405 must ship before the annotations; `mtls-dev-env.sh` pair list
  and every literal "12". SAN allowlist SPIKE PASSED on uvicorn 0.47.0 + httpx 0.28.1 (allowed SANs 200,
  non-allowlisted platform leaf 403, no cert -> connection error, wrong-SAN server rejected by sni_hostname
  pinning); approach = override `H11Protocol.connection_made`, map `scope['client']` -> SAN (script kept in the
  session scratchpad `spike/san_spike.py`; becomes a real test in slice S1).
- Round 4 (delivery slicing, S0-S11): adversary NEEDS ANOTHER ROUND on eight blocking spec-level items
  (CI registered only in S7; buf exclusion cannot be removed in the same PR; compose-profile prod render breaks
  `homelab-render.test.sh`/`render-assert.jq`/digest resolution; undefined DB class and budget; `DATABASE_URL`
  vs `SMOKE_DATABASE_URL` and undefined `MTLS_SCOPE`; exit codes 0/1/70 vs AC-15/AC-26; migration 035 ordering vs
  feature 264's 034; S5 bundles three verification environments).
- Operator gate answers: buf policy = permanent `breaking.except: [RPC_SAME_IDEMPOTENCY_LEVEL]` (no removal
  step); approval = "Run final round 5" (hard cap reached after it; no `@AC-1 @feature-214` sign-off yet).
- Operator note: BENIGN_READS ships as mechanism + guard + test-only entry with zero enabled entries until a check
  needs one (to be acknowledged at final approval).

## Session 2026-10-30T04:30:00Z — sdd-design (rounds 5 + approval)

- Round 5 (final, hard cap): proposer produced the corrected slice list S0–S8; adversary verdict READY WITH CORRECTIONS
  (no Floor breach). Seven blocking wiring corrections are now part of `design.md`: trigger placeholder collision
  (`YOUR_DEV_SMOKE_TRIGGER_MTLS_*`), normalized shipped compose (`jq 'del(.name,.networks)'` + staging dry run),
  overlay assertions (no shared YAML anchors), older-image gating on the overlay file, record-only watchdog exit 0,
  lazy DB pool + build-time SHA check, and the corrected rollout (merge auto-deploys homelab staging).
- **Operator final gate: APPROVED** with these recorded sign-offs and acknowledgements:
  1. **CHANGE sign-off** for `@AC-1 @feature-214` ("advertised tool count is 45"): re-scoped to "when `SMOKE_ENDPOINT`
     is unset" (a staging agent with `smoke_checks` advertises 46; production stays 45). User @ 2026-10-30T04:30:00Z.
  2. Benign-reads override ships as **mechanism + runtime guard + a test-only entry, zero enabled entries**, until a check
     needs one (explicit override of the phase-1 anti-goal / FR-5, named side effects per entry).
  3. Accepted open risks (also in `design.md`): unverified external prerequisites (tailnet ACL, homelab-edge `smoke_ro`
     role, DO POST_DEPLOY semantics/reachability, homelab gate acceptance of the shipped file); migration `035` behind
     feature 264's `034`; reliance on default workflow permissions for the `record` job.
  4. buf policy (earlier gate): permanent `breaking.except: [RPC_SAME_IDEMPOTENCY_LEVEL]`.
- Status: spec-ready → design-approved. `/sdd-spec` is **not** run: the operator chose subagent-driven execution of
  `docs/superpowers/plans/2026-10-29-staging-smoke-checks.md`, which is being regenerated from this design (slices S0–S8).
  Scenario↔test traceability (C-15) is carried by `Covers: AC-n` lines in the plan's task steps.

### First-deploy proof checklist (must be recorded here before `launched`; C-15 / fails.md deploy-time-AC trap)

- [ ] Tailnet ACL `tag:ci` → homelab staging VM:9110 works; the VM has no non-tailnet interface on 9110.
- [ ] A DO job reaches `${xstockstrat-smoke.PRIVATE_DOMAIN}:9110`; the effect of a failing `POST_DEPLOY` job on the deployment is known.
- [ ] The read-only DB role exists (homelab + DO dev) and the startup role check passes live.
- [ ] The agent → smoke mTLS hop works with the real deployed leaves.
- [ ] The built image carries the baked `SMOKE_GIT_SHA`.
- [ ] The VM gate accepts the normalized shipped compose file (staging dry run) with the same project name.
- [ ] Live halves of AC-14, 15, 17, 18, 26 and 46–48 observed on a real staging deploy; a run file lands on `smoke-results` with the deployed SHA, from both homelab and DO dev.

## Session 2026-10-30 — S8 phase-2 scoped writes (plan Task 10)

- **Portfolio-owner allowlist approval (FR-9): PENDING.** Not granted by the implementing session. Until it is recorded
  here, `smoke.writes.enabled` stays `false` everywhere and the only write check is the reference-only
  `checks/_reference/watchlist_roundtrip.py`, which the catalog never serves (`_`-prefixed packages are linted, not
  loaded). Procedure: `docs/runbooks/smoke-user.md`.
- Config migration `036_smoke_writes_enabled` (bool, default `false`, staging + production, global), after `035`.
  The flag is re-read through the config watcher on every RPC call (`policy.live`), so a flip needs no restart.
- Predicate decision: "no `strategy_id` bindings" refuses any non-empty field named `*strategy_id` at any depth, i.e.
  `bindings[].strategy_id` **and** `default_strategy_id` (Create/Update), because the latter stamps strategy bindings on
  added symbols (portfolio.proto feature 170). Conservative superset of the design wording.
- Run files are now `schema_version: 2` (`writes_performed`, `cleanup`); `run-file.v1.json` unchanged. Readers select
  the schema by `schema_version`: the trigger recorder and, because the agent validated `get_run` bodies against a v1
  copy only, the agent's `smoke_client` (new byte copy `smoke_run_file.v2.json`). Without the agent change every
  `get_run` of a finished run would fail validation.
- Kill switch off also refuses cleanup deletes: such a check ends `ERROR` with `cleanup: FAILED`; leftovers are swept by
  the next janitor once writes are re-enabled.

## Session 2026-10-30 — execution complete (plan Tasks 1-11), pending CI and operator prerequisites

Status stays `design-approved` (`status.md` untouched): the operator/controller decides the transition. All code and doc
slices S0-S8 are implemented on `claude/smoke-test-deployment-0f1z5j` (PR #1359); nothing below the code is provisioned.

### Deviations from the design/plan, per task

- T1: run files are **per run** with `records[]` (design.md Records / AC-11), not per check; schema and contract text changed accordingly.
- T2: check modules live in the top-level package `checks/` (API in `app/check_api.py`); watchdog record-only ERROR file is a
  local-temp, best-effort artifact (accepted gap below).
- T3: strict mode exits **1** on a lost run; new marker `SMOKE_TRIGGER_FAILED` (not in the frozen contract) covers every other
  trigger-side failure; the PAT travels only via `SMOKE_RESULTS_PAT` -> `GIT_CONFIG_*` env (never argv/remote URL); lost run commits nothing (AC-35).
- T4: migration `035_smoke_rpc_user_id` gated behind feature 264's `034` (on origin/main-dev, not on this branch until merged);
  `consuming_service` seeded as `xstockstrat-smoke`.
- T5: unrequested `SMOKE_DB_PASSWORD` secret (`DEV_SMOKE_DB_PASSWORD`, placeholder `YOUR_DEV_SMOKE_DB_PASSWORD`); role/db names
  `xstockstrat_staging_smoke_ro` / `xstockstrat-staging` are implementation choices for the DBA to confirm; `git` installed in the smoke
  image for the `POST_DEPLOY` job; pool budget 8 -> 9.
- T6: all three BFF segments share `createDispatch`, so one 405 guard covers them; the `GET` export in the route files is now redundant.
- T7: 37 RPCs annotated `NO_SIDE_EFFECTS`; `config.WatchConfig` left **unannotated** (server stream); `ScreenSymbols` annotation means
  own side effects only (keep it out of smoke checks); `ValidateToken`/`GetOrder` become Connect GETs (revisit if the BFF guard relaxes);
  stubs regenerated with Go 1.27 for protoc-gen-go (older Go reformats `analysis.pb.go`).
- T8: homelab strict step collects only the NEW run file into artifact `smoke-run-<attempt>`; a separate `record` job (`contents: write`, no
  tailnet secrets) pushes with `GITHUB_TOKEN`; trigger child env drops the CA key. Deferred minors: SHA-pin `actions/{upload,download}-artifact@v7`,
  validate artifact JSON in `record`, skip `record` when no artifact, tighten the AC-47 allow-list.
- T9: agent `smoke_checks` registered only when `SMOKE_ENDPOINT` is set (uncounted; staging 46, production 45); agent pool-total test
  updated to 9; `jsonschema>=4.23.0` declared directly (already locked transitively).
- T10: agent `smoke_client` validates `get_run` bodies by `schema_version` (new byte copy `smoke_run_file.v2.json`); `_`-prefixed packages under
  `checks/` are linted but never served (`_reference/watchlist_roundtrip.py`); "no strategy_id bindings" predicate is the conservative
  superset (any `*strategy_id` at any depth, incl. `default_strategy_id`); cleanup grace holds the run **lock** only, bounded by
  `CLEANUP_GRACE_MAX_S` 60, so Retry-After is at most **960** (`RUN_LOCK_HOLD_S` 900 + 60); `SCOPED_WRITES` name predicate (`smoke-` prefix).
  Minor left: descriptor-name predicate (identity via `full_name`), non-message request `AttributeError`, `rpc.close` has no timeout,
  `check_hash` covers the check function only (not its janitor).

### Accepted gaps

- Record-only watchdog `ERROR` run file is local-temp, best-effort (AC-39 end-to-end is not claimed).
- Shipped-staging agent `environment` renders as a list (compose normalization) instead of a map; semantically equal, but it is part of the
  open "VM gate accepts the normalized file" risk.
- `hadolint`, `docker` (daemon), `shellcheck` were not run here; CI had not been confirmed on the final head when this was written.
- Durable acceptance text of `@AC-1 @feature-214` is not rewritten here (C-16 re-scope at launch).
- jscpd report-only clones: v1/v2 schemas and the agent byte-copies are inherent to "never edit v1".

### UNVERIFIED-HERE

GitHub/PAT auth against a real remote; DO job runtime (python, git in job image), `POST_DEPLOY` failure semantics and `PRIVATE_DOMAIN`
reachability from a job and from the agent component; DSN against the real DO host; actions behaviour on GitHub and artifact hand-off;
homelab-edge gate accepting the normalized shipped file; secret-scan on fixture PEM placeholders; real portfolio owner-scoping and paging
behaviour for the reference write check; live config flip over a real `WatchConfig`; migrations 035/036 with `scripts/db-migrate.sh` and 034
present; agent -> smoke call over the tailnet; docker image build (baked SHA).

### External-prerequisite checklist state (ALL PENDING; owners in `docs/runbooks/smoke-checks.md`)

- [ ] `DEV_SMOKE_RESULTS_PAT` + `smoke-results` ruleset (repo admin)
- [ ] `DEV_SMOKE_DB_PASSWORD` / `SMOKE_DB_PASSWORD` and the two `smoke_ro` roles (DBA)
- [ ] `SMOKE_BIND_ADDR` variable, tailnet ACL `tag:ci` -> VM:9110, homelab-edge gate acceptance (homelab/tailnet operators)
- [ ] Smoke user + `smoke.rpc.user_id`; migrations 035/036 after 034 (operator, DBA)
- [ ] Portfolio-owner approval of the write allowlist (FR-9) — **PENDING**; `smoke.writes.enabled` stays `false`

First-deploy proof (checklist above): **PENDING**, no item observed.

### Teardown reconciliation (feeds the PR body)

The `/context-forge:context-constitution refresh` skill is **unavailable** in this environment (not in the skill list). Manual
equivalent: re-read every context file touched by this branch (`git diff --name-only origin/main-dev...HEAD | grep -E 'CLAUDE.md|docs/(patterns|runbooks)/'`:
root `CLAUDE.md`, `services/xstockstrat-smoke/CLAUDE.md`, `services/xstockstrat-agent/CLAUDE.md`, `docs/patterns/{ci-overview,config-governance,docker-build,inter-service-mtls}.md`,
`docs/runbooks/{CLAUDE,inter-service-mtls-rollout,mcp-tools,smoke-checks,smoke-db-role,smoke-user}.md`) against the code.
Checked and confirmed: port 9110 and SAN allowlist; constants `RUN_LOCK_HOLD_S` 900, `CLEANUP_GRACE_MAX_S` 60, `CLEANUP_DEADLINE_S` 10,
`LOOP_STALL_S` 30, `DB_STATEMENT_TIMEOUT_MS` 5000 (grep of `app/`); 13 leaves (`gen-dev-certs.sh` SERVICES has 13; trigger leaf not in it); direct pool
total 9 (2+2+2+1+1+1); agent 45/46 tool wording; migrations 035/036 present; python-lint/test x5 matches the `ci.yml` matrix; run-file schemas v1/v2
exist; env var names `SMOKE_RESULTS_PAT`, `DEV_SMOKE_DB_PASSWORD`, `SMOKE_BIND_ADDR` match the workflows/specs.
Drift fixed: `smoke-checks.md` still said the agent tool was a "later slice" and lacked results-reading, prerequisite owners and first-deploy
proof (rewritten); root `CLAUDE.md` and `services/xstockstrat-smoke/CLAUDE.md` stated smoke DB access as `:25060` only, but the homelab overlay
uses `:5432` (clarified); Context Guide row now also lists `smoke-user.md`; runbook index row updated. Not changed: `docs/setup/digitalocean.md`
"13 services" wording (pre-existing, counts the staging app).
