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
