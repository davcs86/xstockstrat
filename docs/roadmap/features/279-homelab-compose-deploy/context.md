# Context: homelab-compose-deploy

**Feature**: `docs/roadmap/features/279-homelab-compose-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/279-homelab-compose-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/279-homelab-compose-deploy/implementation-spec.md`

---

## Session 2026-10-24T00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Order deviation, recorded on purpose:** the code (compose file, workflow, Go health service, homelab-edge
  changes) was written in this session *before* `/sdd-story`. The operator was asked whether the Go health
  endpoint falls under the SDD Commandment and chose "run SDD story + quick design first" rather than waiving it.
  The pipeline therefore runs now, against code already written. The code was pushed as a `wip(279)` commit to the
  session branch (a repository stop hook requires pushed work); no PR is opened until `/sdd-design quick` approves,
  and any design objection lands as a follow-up commit before the PR.
- Operator decisions (asked and answered in-session, 2026-10-24): run in parallel with DO; `main-dev`→staging,
  `main`→production; real `grpc.health.v1` service on the Go services; migrations as a one-shot service per deploy;
  DB host `db.ts.natanddavehouse.com`, db/role `xstockstrat` / `xstockstrat_staging`; mirror DO's PgBouncer split
  with `sslmode=require`; OTel off; homelab-edge gets the staging `tag:ci` grant, a configurable gate wait timeout,
  and runbook updates.
- Added without asking (flag for review): `HOMELAB_DEPLOY_ENABLED` repository-variable gate on both caller jobs, so
  pushes do not go red before the VMs and secrets exist.

## Session 2026-10-24T01:00Z — sdd-review product-spec

- Round 1: FAIL (criterion 9: unchecked rollback/schema question) + warnings. Overlap: `084-droplet-compose-deploy`
  (spec-ready) claimed the same `deploy-dev.yml` path; rebase-only overlaps on portfolio/marketdata `main.go`
  (215, 255, 264) and `docs/patterns/ci-overview.md` (084, 248, 250, 252).
- Operator decisions: rollback restores images not schema → accepted, migrations must be backward-compatible;
  084 → demoted/canceled as superseded by 279 (084's feature.md/status.md/context.md updated).
- Fixes: AC-5 Then made observable; AC-16..AC-20 added (production names, health only after init, production
  reviewers, manual run, ephemeral tag:ci join); AC-6/AC-7 widened to all three Go services; AC-21 split out of AC-7.
- Round 2: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings carried to design: homelab Postgres/PgBouncer connection budget unstated (F-06 context); the code predates
  the review (C-11 ordering, recorded in the sdd-story session above).

## Session 2026-10-25T00:00Z — sdd-design quick (in progress)

- Phase 0 Recon: wrote recon.md (6 read-only digests). Defects found in the WIP: D1 `TRADING_MODE` absent from the
  homelab compose (trading broker default `trading.go:2597`, marketdata Alpaca `main.go:107` would run paper in
  production); D2 ui binds to Docker's `HOSTNAME` (proved: next@15.5.27 `dist/build/utils.js:1316`
  `const hostname = process.env.HOSTNAME || '0.0.0.0'`), so `nc -z localhost 3000` never passes.
- Phase 1 round 1: proposer endorsed the WIP + 5 changes; adversary NEEDS WORK, no Floor breach. New defect D3:
  a rollback after a release that applied a migration re-runs the previous migrator, and golang-migrate v4.17.1
  `readUp` → `versionExists(from)` fails when the DB version is newer than the image's files (verified in source),
  so the old stack never starts.
- Verified by the orchestrator: compose `getDependencyCondition` (one-shot counts toward `--wait`) exists from
  v2.17.0 through v5.5.1.
- Operator decisions (2026-10-25):
  - D3 → `scripts/db-migrate.sh` tolerates a DB version newer than its files (not dirty): log and skip that service.
  - Homelab production = **live**, alongside DO prod live; runbook warns never to register one live broker account
    on both stacks (double execution, reconciliation halts).
  - App VMs run the same Docker pins as the edge (engine 29.8.2, compose 5.5.1); runbook records compose ≥ v2.17.0.
- Gate after round 1: operator chose **run another round**.
- Round 2 proposer (2026-10-25): D3 as a pure, offline-testable `scripts/migration-ahead-check.sh <dir> <version>`
  (exit 0 = DB ahead → skip service; digits-only version > highest local `.up.sql`; dirty untouched), called in
  `db-migrate.sh` after the dirty `esac`; real-DB proof added to `scripts/migration-rerun.sh`; CI filter/test wiring.
  D1 `appenv`/`mode` from `case "$TARGET_ENV"`, written after APP_ENV, asserted by a silent `jq -e` over every
  service + ui HOSTNAME. New scenarios proposed: AC-22..AC-26. Two live stacks: runbook only.
  Orchestrator-verified: golang-migrate `Migrate.Version()` reads only the DB driver (`migrate.go:385-396`).
- Round 2 adversary: NEEDS WORK, no Floor breach. (1) dirty-AND-ahead (a migration that failed part-way leaves
  N+1 dirty) → the old release's `migration-dirty-guard.sh` computes its contract floor from its own files only, so a
  new contract file at N+1 is invisible → `force 0` + full replay, the exact path `@AC-18 @feature-225` forbids;
  without a contract file the non-idempotent replay most likely fails. (2) `scripts/Dockerfile.migrate` is also DO's
  PRE_DEPLOY migrator (`.do/app.yaml:669`, `.do/app.dev.yaml:671`), so D3 changes DO behaviour — unlisted surface.
  (3) `jq` `all()` is vacuously true on an empty set — assert the 12 services explicitly. (4) `trading.broker.paper`
  config overrides `TRADING_MODE` (`trading.go:2595-2597`) — the guard proves the env default only. (5) AC-22/23/26
  have no PR-time test; AC-24 gate part is live-run evidence. (6) write APPENV/MODE once to `$GITHUB_ENV`.
- Operator decisions after round 2 (2026-10-25):
  - Dirty-and-ahead → **refuse, fail closed** before `force 0` (explicit sign-off to change the dirty branch, C-11/P-03).
  - Ahead-tolerance applies **everywhere incl. DO** PRE_DEPLOY migrators (listed as an affected surface).
  - **Add a PR-time CI render test** (fixture .env + shared `deploy/homelab/render-assert.jq`).
- Gate after round 2: operator chose **run another round** (round 3 of max 5).
- Round 3 proposer: release .env build moves into `scripts/homelab-release-env.sh` (single mapping; CI tests the
  real artifact); `render-assert.jq` asserts 13 services + 12 named app services + ui HOSTNAME; ahead-check exit
  codes 0 proceed / 10 clean-ahead skip / 4 dirty-ahead refuse / 1 usage, called BEFORE the dirty case so any
  checker crash fails closed; real-DB pass 4 in `migration-rerun.sh`; new `homelab-render` CI job + `homelab` paths
  filter; scenarios AC-22..AC-28.
- Round 3 adversary: NEEDS WORK, no Floor breach; all implementation-level: invalid `test -x a -x b`; octal trap on
  `008`/`009` (strip zeros, `[ -gt ]`); checker must reuse the guard's dirty regex and fail closed (exit 2) on an
  unparsable dirty string, else `force 0` reopens; render test must unset TRADING_MODE/APPLICATION_ENV (shell env
  overrides --env-file); gitleaks-safe dummies (allowlisted `00112233…eeff`); FR-4/FR-6 + DO migrator surface to be
  amended in the spec; keep an early target guard in the workflow; `trap` CA-key cleanup, jq `2>/dev/null` +
  `pipefail`; portable python base64; pass 4 `|| rc=$?` and assert rc 4; runbook rollback outcome marked unverified;
  pin `ubuntu-24.04`. Orchestrator synthesis: accept all; keep the separate checker (guard contract untouched).
- Operator decisions after round 3 (2026-10-25): **pipeline owns APPLICATION_ENV and TRADING_MODE** (removed from
  the operator-held APP_ENV contract; runbook §4.1 updated accordingly). Gate: **run another round** (round 4 of 5).
- Round 4 proposer: line-level design (checker script, `db-migrate.sh` insertion with `|| ahead=$?` → `return 0` /
  `exit 1`, `homelab-release-env.sh` with `mktemp`+`trap` and APP_ENV key stripping, project-then-assert
  `render-assert.jq` emitting labels only, `env -i` isolation, pass 4 on marketdata 008/009, AC-22..AC-30) and four
  more WIP defects: G1 no `defaults.run.shell: bash` (no pipefail); G2 re-run attempts reuse the release name
  (rollback to itself); G3 D1/D2 not yet in compose; G4 homelab-edge runbook still lists APPLICATION_ENV in APP_ENV
  and lacks the live-account warning.
- Round 4 adversary: NEEDS WORK, no Floor breach, "fold in and approve": AC-29 jq `//` swallows the error (assert
  non-`[]` + no probe value); key-strip regex must end `[=:]` (compose-go accepts `KEY: value`) + runbook: APP_ENV is
  single-line `KEY=value`; pass 4 computes marketdata's top version instead of hard-coding 009; call the checker via
  `bash` (no exec-bit blast radius on DO), image check `test -f`; zero `.up.sql` files + numeric version → exit 2;
  release name stays `${GITHUB_SHA::12}-$((RUN_ID*100+ATTEMPT))` with `ATTEMPT<100` check, manual `image_tag`
  validated `^[0-9a-f]{7,40}$` before the tailnet; `: "${EXPIRES:?}"` in this repo's workflow. Orchestrator: accept all.
- Gate after round 4: operator chose **run round 5 (final)**.
- Round 5 (final) proposer: consolidated executable design (A1–A11, ci.yml, spec amendments, AC-22..AC-31, homelab-edge
  edits, ordered red-before-green steps, non-Docker evidence plan). New defect H1: a compose dotenv *parse* error quotes
  the rest of the .env (incl. runtime-minted mTLS keys, unmasked) into the job log → shared
  `scripts/homelab-render-check.sh` filters stderr to `required variable … is missing a value` lines (+ test case 8).
  H2 malformed `TS_AUTHKEY_EXPIRES` validated. Owner calls, not applied: H1b same filter in the homelab-edge gate
  (`app-deploy.sh:42`); H3 restrict the `production` environment's deployment branches to `main`.
- Round 5 adversary: **READY**, no Floor breach, no blocking defect, no @AC regression. Fold-ins: (1) A4 verifies the
  MTLS_CA key matches its certificate before minting (gen-dev-certs.sh has no -e and hides openssl errors, so a
  mismatch could yield 0-byte leaves and a "successful" build); (2) H1 wording: an unexpected-character error quotes the
  offending line, an unterminated quote quotes the rest of the file — add an unclosed-quote case; (3) optional
  "APP_ENV line N" hint (digits only); (4) migration-rerun.sh header/OK line + `rm -rf "$old"`; (5) spell out the
  A11 `env -i` helper; (6) keep migration-ahead-check.test.sh in the step's Files. Accepted risks: H1b (gate stderr),
  H3 (production deployment branches), DO blast radius (guarded by the image-contents step), compose-go dotenv
  behaviour proven only by step-3 red/green, AC-24 live rollback.
- Final gate (2026-10-27): operator asked to **pull the latest homelab-edge and run another round to fix any gap**,
  and to apply owner items **H1b** (filter the gate's `compose config` stderr) and **H3** (production deployment
  branches = `main`, documented) against latest homelab-edge. The skill caps the debate at 5 rounds, so this runs as a
  delta recon against latest homelab-edge + one targeted adversarial review of the delta, then returns to the gate.
- **Operator override (2026-10-27): the 5-round debate cap is lifted** for this feature; round 6 runs as a full proposer/adversary round against latest homelab-edge (sign-off recorded here, P-04).
- Round 6 proposer (2026-10-27, against homelab-edge 488d0c4): **E1 supersedes the 2026-10-24 names** — DB_NAME
  `xstockstrat-<env>`, DB_USER `xstockstrat_<env>` mapped and asserted separately; DB_PASSWORD from homelab-edge SOPS
  `db_role_xstockstrat_<env>_password` (runbook); render check guards the 8-direct-connection budget; verify-full →
  follow-up feature. **R6-1 (verified by orchestrator):** homelab-edge Gatus probes `http://<vm>:3000/api/health`
  (`gatus-config.yaml.j2:77,95`) but xstockstrat-ui has no root `/api/health` (only segment routes); the middleware
  matcher already exempts it (`middleware.ts:22`, `middleware.test.ts:60`) → add `src/app/api/health/route.ts` + test.
  R6-2 runbook ordering (VM on tailnet before db-host run); R6-3 container DNS probe in runbook. H1b gate filter +
  fake-docker test; H3 documented. Line-number hint: recommend NO. New scenarios AC-32..AC-38.
- Round 6 adversary: **READY provided B1 is folded in**; no Floor breach, no @AC regression. **B1 (verified by
  orchestrator):** feature 271 (`implementation-ready`) deletes the `api/health|health` matcher alternatives
  (`271/implementation-spec.md:47,520`) and its exact `PUBLIC_HEALTH_PATHS` lists only the 8 segment paths, so the new
  root `/api/health` would 307 to `/auth/login` and Gatus (follows redirects) would show a false green → behavioural
  middleware test for `/api/health`, a merge-order row 279↔271 (`'/api/health'` joins `PUBLIC_HEALTH_PATHS`), a note in
  271's context.md. Fold-ins: O1 runbook DB probe uses public `postgres:16-alpine` `psql … -c 'select 1'` with
  `-e PGPASSWORD` (pg_isready does not check pg_hba; migrator image is private); O2 path-side swap mutation; O3 `(add // 99)`
  + comment says 8 is a floor; O4 runbook §6 row for the gate's exit 2; O5 dispatch description "production: main only"
  + note that `image_tag` is reviewer-gated, not branch-gated.
- Gate after round 6 (2026-10-27): operator chose **run round 7** — "Follow 271 for UI, but what about agent?" —
  and **approved writing a merge-order row + a note in 271's context.md** (271's spec text untouched).
  Orchestrator reading: the UI health exemption must follow 271's exact-path `PUBLIC_HEALTH_PATHS` mechanism (not
  the regex alternative 271 deletes); round 7 must also settle the agent's Gatus probe and health contract.
- Round 7 proposer: **UI option (b)** — xstockstrat adds no UI route; homelab-edge Gatus probes `/trader/api/health`
  (in 271's exact `PUBLIC_HEALTH_PATHS`, `@AC-3`) with `[BODY].status == ok`, so a followed login redirect is red, never
  falsely green, until 271 deploys; round-6 D6 withdrawn. **Agent:** metadata liveness is enough (per-call channels;
  backend health already gated); Gatus pins `[BODY].resource` to the env's `$APP_URL/agent`; compose healthcheck stays
  TCP. N1 homelab-edge `gatus-config-test.py` pins the old URLs; N2 staging `APP_URL` documented nowhere (owner to
  confirm `https://xstockstrat-staging-ui.ts.natanddavehouse.com:8443`). Merge-order row + 271 note text drafted.
- Orchestrator-verified in Gatus v5.37.0 source (homelab-edge pin): redirects are followed by default
  (`client/config.go:35,56`, `IgnoreRedirect: false`); an unresolvable `[BODY]` placeholder (non-JSON body) becomes
  `"<element> (INVALID)"` (`config/endpoint/condition.go:181-186`) and fails an `==` comparison — so the pre-271
  login-redirect is red, never a false green.
- Round 7 adversary: **READY with fold-ins**, no Floor breach, no @AC regression. Fold-ins: merge-order as a prose
  note (a table row blocks 279's own integration PR / halts sdd-batch-execute); "@AC-3 pins the path, `status:'ok'` body
  only by 271's e2e" (accepted risk); alert cost is one standing alert per probe (default-alert failure-threshold 3, no
  repeat) — do not suppress (decisions.md:79-80); optional `client.ignore-redirect: true` on the UI probes
  (key verified in v5.37.0 `client/config.go:57`) with the tailnet resolver restated; E-G1..E-G6 get an execute step
  (red E-G2, green E-G1, verify gatus-config-test.py); E-G5 says AGENT_PUBLIC_URL is derived, do not set; §6 rows fit
  Failure|Effect|Handling; design.md records rejected alternatives (root route, /auth/login probe, jq APP_URL check).
- **Gate after round 7 (2026-10-27): operator APPROVED the design.** Staging `APP_URL` confirmed:
  `https://xstockstrat-staging-ui.ts.natanddavehouse.com:8443`. Merge-order 279↔271 recorded as a **prose note**
  (non-blocking). Gatus UI probes: **add `ignore-redirect: true`** (body condition kept) and **keep alerting**.

## Session 2026-10-27 — sdd-design (completion)

- Phase 0 Recon: recon.md (services: trading, portfolio, marketdata + 9 deployed unchanged; reuse: gen-dev-certs.sh,
  migration-dirty-guard.sh idiom, homelab-edge app-deploy template) + Addendum 2026-10-27 against homelab-edge 488d0c4.
- Phase 1 Grilling: 7 rounds (quick; cap lifted by operator). Chosen: digest-pinned homelab compose + reusable
  workflow with pipeline-owned env, Go grpc.health.v1 self-probe, migrator ahead/dirty-ahead check (DO too), shared
  render check, Gatus following 271. Rejected: see design.md.
- Constitution rules touched: C-01, C-08, C-10, C-11, C-14, C-15, C-16, C-18, P-03, F-01, F-06, F-07. Floor breaches: none.
- Ledger: insights.md "2026-10-27 — homelab-compose-deploy — design". merge-order.md prose note + 271 context note written.
- Status: spec-ready → design-approved.

## Session 2026-10-27 — implementation (design-approved → code-completed)

- Implemented straight from design.md's line-level steps; **no implementation-spec.md was written** (the header link
  above is dangling on purpose). Commits e733297 (migrator ahead/dirty-ahead), f42ae86 (release env, render check, jq
  oracle, compose fixes), 89d96d3 (workflow + CI `homelab-render` job + docs).
- homelab-edge companion (branch `ccr-9bdbcd90-kgj5ev`, 9305497): gate refuses an unrenderable release printing only
  missing-variable names (H1b), Gatus UI probes `/trader/api/health` + `ignore-redirect` + body check, agent probes pin
  `[BODY].resource`, verify.yml asserts `/trader/api/health` is 404 publicly, runbook §4.1/§6, home-side, decisions.
- Verified offline: homelab-render.test.sh, migration-ahead-check.test.sh, Go mtls Probe tests (3 services),
  shellcheck, actionlint; homelab-edge app-deploy-test.sh 19/19, gatus-config-test.py OK, yamllint. **Not verified:** a
  real deploy to either VM, a real rollback against an ahead schema, and the DB probe — these need the VMs and secrets.
- UI probes stay red with 307 until feature 271 deploys (merge-order prose note).
- Teardown: context-forge plugin unavailable in this session; manual reconciliation of every touched context doc
  (context-constitution PLAT-N2 anchors, ci-overview, database, docker-build, inter-service-mtls) against the code — no drift found.

## Session 2026-10-27 — sdd-spec (retroactive)

- Generated implementation-spec.md with 16 steps, all `done`, citing the shipped code and commits. **Status kept at
  `code-completed`** rather than set to `implementation-ready`: the code already shipped, and resetting would tell
  `/sdd-execute` to redo it (spec Deviation Log D-1). The header's Implementation Spec link is no longer dangling.
- All 40 `@AC-*` scenarios mapped to a step (`## Scenario Coverage`). Live-only: AC-11/18/19/20 run behaviour, AC-34,
  AC-38, AC-40, AC-24's gate rollback (D-3).
- Key codebase findings:
  - Only `xstockstrat-config` names `db-migrator` (`deploy/homelab/compose.yml:53-55`); every other service waits on
    it transitively through `service_healthy`. Neither `render-assert.jq` nor `homelab-render.test.sh` asserts that
    chain, so dropping a `depends_on` would pass CI (D-2, open thread). Spec Step 8 adds a jq check, verified true on
    the current file and false with config's `depends_on` removed.
  - No `actionlint` job in `ci.yml`; workflow scenarios rest on grep assertions (Step 13) and the first live run.
  - Re-ran offline: migration-ahead-check.test.sh, Go `TestProbe*` (3 services), homelab-render.test.sh (compose
    v5.6.1, no daemon), homelab-edge app-deploy-test.sh + gatus-config-test.py — all pass. Not run: policy-test.sh
    (no headscale), CI migration-rerun (Postgres), golangci-lint/coverage.
- Reviewers snapshot finalized in feature.md (adds DBA for the migrator change).
- Open thread: add a `depends-migrator` label to `render-assert.jq` (+ a mutation case) — owner's call; not done here.

## Session 2026-10-27 — sdd-review impl-spec (advisory)

- Result: 0 failures, 16 warnings across 11 steps (advisory — did not block). Spec↔code drift: none (~60 citations spot-checked). Floor: none.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 8: AC-5 (every service waits on db-migrator) not CI-enforced; add a `depends-migrator` oracle label + mutation case (C-15, D-2) — [x] resolved (D-4, AC-43)
  - Step 1: coverage ≥40% not asserted explicitly (B2) — [ ] unaddressed
  - Step 10: `homelab-mtls-env.py` has no ruff gate in the step (B2) — [x] ruff clean (D-4)
  - Steps 7, 12/13, 16: test step after service step (P-06; retroactive spec) — [ ] unaddressed
  - Step 9: docker-compose.yml / .do/app*.yaml not in Files (justified: unchanged by design) — [ ] unaddressed
  - Step 12: actionlint not a CI job — [ ] unaddressed
  - Step 14: 8 files; split CI wiring from docs — [ ] unaddressed
  - Step 15: Files omits homelab-edge `policy/policy.hujson` — [ ] unaddressed
  - Step 16: `tag:ci → tag:db:22` grant needs Security reviewer confirmation — [ ] unaddressed
  - Live-only AC-11/18/19/20/34/38/40 unproven until first deploy (D-3) — [ ] unaddressed
- Overlap findings (WARN, no FAIL): ci.yml (278, 266, 251, 250, 248 — different jobs); ci-overview.md (250, 252, 248);
  database.md (266); inter-service-mtls.md (242); context-constitution.md (242, 244, 264); marketdata `cmd/server/main.go`
  (255 implementation-ready, 215 in-progress) — highest risk, no merge-order row written (WARN per overlap rules).

## Session 2026-10-27 — code review (backwards) + fixes

- `/code-review high` on homelab-edge #39 (8 findings) then xstockstrat #1327 (10 findings).
- Operator decisions: split the homelab switch per environment; a manual old-tag run checks out the image's commit;
  pin the DB probe to a postgres 18 digest; do the DRY/migrator-build cleanups in this PR.
- Fixed (impl-spec D-4): see D-4. homelab-edge 78d4d82: octal wait bypass, render guard on rollback, refused releases
  pruned, single tailnet anchor with ignore-redirect, probe image pinned (18.6-alpine digest is the 2026-10-26 rebuild;
  Hub lists no older digest — recorded in docs/versions.md), tailnet-devices.md grant list.
- Declined, with reason: UI probes red until 271 (operator: keep alerting); dirty-ahead refusal blocks auto-rollback
  (operator: refuse, fail closed).
- impl-spec review items now resolved: Step 8 AC-5 chain [x] (depends-migrator, AC-43); Step 10 ruff [x] (ruff check/format clean).
- **Not verified live:** the switches, the commit checkout and the production guard run only in Actions.
