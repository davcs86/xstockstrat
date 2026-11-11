# Context: homelab-otel-host-provider

**Feature**: `docs/roadmap/features/332-homelab-otel-host-provider/feature.md`
**Product Spec**: `docs/roadmap/features/332-homelab-otel-host-provider/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/332-homelab-otel-host-provider/implementation-spec.md`

---

## Session 2026-11-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 332 reserved on origin via `scripts/sdd-allocate-feature-number.sh`.
- Operator decisions (Q&A before story): (1) Grafana Cloud free tier acceptable now, self-hosted migration is future work; (2) attribute name is `host_provider`; (3) reuse the DO OTLP endpoint/credential mechanism where possible; (4) Grafana Cloud usage is not a constraint, DO will be cut over to homelab.
- Pre-story recon: `deploy/homelab/compose.yml:7` hardcodes `OTEL_ENABLED: "false"`; Grafana `deployment_environment` has only `staging`; `host_name` values are k8s pod names; resource attributes are on `target_info`, not on metric series.
- Branch note: harness branch is `ccr-6307b904-swdg1c`; the `feature/homelab-otel-host-provider` name in feature.md is the SDD convention, the PR still targets `main-dev`.

## Session 2026-11-11 — rename

- Operator renamed the resource attribute `host_provider` -> `host.provider` (OTel dotted form, matching `deployment.environment`). Prometheus/Loki label form is `host_provider` (dots -> underscores). Env var stays `HOST_PROVIDER`; slug/directory unchanged.
- Flag for review: `host.*` is an OTel semantic-convention namespace; `host.provider` is not a defined semconv attribute (the standard one is `cloud.provider`), so a future semconv addition could collide. Recorded, operator decision stands.

## Session 2026-11-11 — product-spec fixes after review FAIL

- First `/sdd-review product-spec` returned FAIL: criterion 9 (7 unchecked Open Questions) and trading-domain C-1 (no per-target `HOST_PROVIDER`/`OTEL_ENABLED` values). No Floor breach; overlap scan clean (WARN-level shared files only: 307 `deploy-homelab.yml`, 329 telemetry resource builders, 331 `.do/app*.yaml`, 297 dashboards).
- Operator decisions: unset or unrecognised `HOST_PROVIDER` resolves to `unknown`; DO dev and DO prod set `digitalocean` explicitly; fixes approved.
- Spec changes: FR-1 binds only the deploy interface (mechanism left to design); FR-2 value set gains `unknown`; FR-6 excludes `db-migrator` and names the `render-assert.jq:22,39` inversion; new FR-8 plus a per-target table (local compose `${OTEL_ENABLED:-false}`, DO dev `"true"`, DO prod `"false"`, homelab pipeline-owned `"true"`). Open Questions checked off as resolved or deferred with an owner.
- Finding recorded: DO production (`.do/app.yaml:33`) has `OTEL_ENABLED "false"`, so only DO dev exports to Grafana Cloud today. Enabling prod telemetry is out of scope.
- Acceptance: AC-3/AC-4 pinned to `unknown`; AC-6 uses the `us-central-0` example and excludes `db-migrator`; AC-7 asserts the `otel:xstockstrat-ui` label; AC-10/AC-11 made concrete and tagged `@smoke`; added AC-13 (exact lowercase match), AC-14 (wrong provider fails the render check), AC-15 (per-target values, FR-8).

## Session 2026-11-11 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: ccr-6307b904-swdg1c@b6c71c0 ≡ origin/ccr-6307b904-swdg1c.
- Warnings: (1) homelab-production OTLP header/instance not yet confirmed — operator, before /sdd-spec; AC-8 assumes the production SOPS file holds it. (2) Deferred Open Questions 1, 3, 4 name a design phase as owner; pin a role at design. (3) AC-6 gateway region `us-central-0` is illustrative, unverified against the real stack. (4) AC-10/AC-11 are `@smoke` checks needing live Grafana; design says where they run and the pass condition. (5) Overlap sequencing below.
- Overlap findings (no FAIL-level; no merge-order row written): 307 `ui-env-themed-bundles` (code-completed, unmerged) edits `deploy-homelab.yml` and pins step order via `sops-secrets.test.sh` — rebase after 307; 329 `fix-telemetry-startup-log` edits startup-log lines in the same telemetry files (disjoint lines) — coordinate; 331 `fix-agent-mcp-transport-fallthrough` edits `.do/app*.yaml` agent health_check — rebase; 297 `grafana-dashboards-ci-deploy` owns `packages/otel/dashboards/**` — only if design adds a `host.provider` selector.
- Recommended design depth: full (12 affected services; warning-level overlaps).

## Session 2026-11-11 — acceptance change after spec-ready

- Operator: live smoke checks are not feasible without multiple PRs (they need DO and homelab both deployed with the change, i.e. post-merge). Resolves review warning (4) (AC-10/AC-11 `@smoke` placement).
- AC-10/AC-11 rewritten (IDs kept) as deterministic repo tests that parse the PromQL/LogQL blocks documented in `docs/patterns/observability.md` and assert the `host_provider="homelab"` matcher. AC-12 now also requires a documented manual post-deploy check with a concrete expected result. FR-5/FR-7 updated to match. Live verification is an operator step, not an acceptance gate. Status stays `spec-ready`: no FR was added, removed or changed in behavior, only how FR-5 is verified.

## Session 2026-11-11 — warnings addressed, spec re-reviewed

- Warning "homelab-production OTLP header": recon found `common.OTEL_EXPORTER_OTLP_ENDPOINT/_HEADERS` in BOTH `secrets/staging.enc.yaml` and `secrets/production.enc.yaml`, but `scripts/sops_secrets.py:32-33` scopes them to `(DO,)` (runbook line 9: "OTEL: DO only"), so `resolve --target homelab` did not emit them. The earlier FR-4/AC-8 premise ("existing SOPS path") was false. FR-4 now extends the target to homelab; homelab adds the `Authorization=` prefix once (DO does it at `do-render-app-spec.py:104-107`); a missing key fails the compose render via the `${VAR:?}` idiom because the keys stay `required=False` for DO. Still open for the operator: confirm homelab production should write to the destination in `production.enc.yaml` (values are encrypted, so same-stack vs separate-stack is not visible in the repo).
- Warning "deferred owners": pinned to Platform Lead (injection mechanism, queryability). Credential delivery question closed by the recon above.
- Warning "AC-6 region": the example now uses a fake `https://otlp.example.test/otlp` fixture value.
- AC-8 and AC-9 rewritten to match reality; AC-16 (missing key fails render) and AC-17 (DO resolution unchanged) added. AC-10/AC-11 were already made deterministic.
- Review hygiene: an Edit in this session briefly deleted two Open Questions bullets (malformed parameter); caught by a grep and restored with the recon-based text before commit.

## Session 2026-11-11 — sdd-review product-spec (re-run, operator request)

- Result: PASS WITH WARNINGS, no blockers. Status stays `spec-ready`. Tree: ccr-6307b904-swdg1c@e4b866d ≡ origin/ccr-6307b904-swdg1c.
- Verified by the reviewer: FR-4 citations; the carry chain `cmd_resolve` -> `APP_ENV` -> `homelab-release-env.sh` `owned` filter -> compose `--env-file` works once HOMELAB is added to the two KEYS rows; per-target table matches the tree.
- Warnings addressed in the spec: AC-16 expected text now matches `homelab-render-check.sh:15-17` ("required variable OTEL_EXPORTER_OTLP_HEADERS is missing a value"); FR-4 names the new `LEGACY_OTEL_EXPORTER_OTLP_*` lines in `deploy-homelab.yml` (needed by `sops-secrets.test.sh:1067` `check_legacy … homelab`) and the moving test pins (`COMMON_RE` :747, `check_legacy` :1067; the :155-159/:522/:579 pins are DO-side and unaffected); FR-3 states `homelab-release-env.sh` owns `OTEL_ENABLED` and `HOST_PROVIDER` and FR-4 that it rewrites the header line to add the prefix; AC-5 names the notify service; the AC-10/AC-11 parser choice is recorded as a design decision.
- Overlap (no FAIL-level): new WARN on `scripts/sops-secrets.test.sh` shared with 307 (pins around `resolve`); 307/329/331/297 sequencing as before. The scan recommended a blocking `merge-order.md` row (332 after 307); NOT written, awaiting operator confirmation.
- Open for the operator: (1) confirm homelab production should write to the destination in `production.enc.yaml`; (2) merge-order row for 307.

## Session 2026-11-11 — operator answers after re-review

- OQ1 (operator): staging and production share one Grafana Cloud instance. Per-environment endpoints question RESOLVED; nothing is outstanding before `/sdd-spec`. Consequence recorded: `deployment.environment` and `host.provider` are independent axes on one stack, so AC-10/AC-11/AC-12 now require the documented queries to filter on both.
- OQ2 (operator): agreed to the merge-order entry. Added to `docs/roadmap/features/merge-order.md`: a table row `homelab-otel-host-provider` (332) after `ui-env-themed-bundles` (307), qualified "merge order only; 307 need not be `launched`" (the 304/305 precedent), plus a prose note for the non-blocking overlap with 329 and 331. Note for the record: the file's coverage note says textual overlap is normally NOT listed (the 300↔304 overlap is a prose note); the row was written as approved because the `deploy-homelab.yml` step order and `sops-secrets.test.sh` pins are a coupling, and can be downgraded to prose if the gate proves too strict.

## Session 2026-11-11 — sdd-design (Phase 0 recon, Phase 1 round 1)

- Phase 0 Recon: wrote recon.md (12 runtimes + homelab/SOPS pipeline + DO/local specs + OTel packages/docs + business rules; 7 discovery digests, all stamped `ccr-6307b904-swdg1c@3fdf7ba`). Live Grafana checks corrected the spec's Queryability premise: `deployment_environment` IS a series label (Grafana default promotion), `host.provider` would not be; Go/Node series carry no `instance`.
- Phase 1 round 1: design-proposer → design-adversary (verdict NEEDS WORK, 2 blocking, 0 Floor). Register on disk: debate.md (D-1..D-8, R-1..R-6, O-1..O-13).
- **Operator sign-offs at the round-1 gate (2026-11-11), recorded per C-16/P-04:**
  - C-16 CHANGE of `@AC-13 @FR-9 @feature-279` "OTel is off on the homelab" (`platform.feature` ≈1146-1150): homelab `OTEL_ENABLED` becomes "true" for the 12 runtimes; "no otel-collector service" stays. Signed off.
  - AC-9 rewording (Authorization= prefix applied in `sops_secrets.py resolve --target homelab`, shared helper also used by `do-render-app-spec.py`) and AC-10/AC-11 as structural guard checks. Accepted.
  - Steer: "Homelab staging must be staging environment, not development." Homelab staging `APPLICATION_ENV` becomes `staging`, which changes the `development` half of `@AC-22 @FR-6 @feature-279` ("the same build for staging renders \"development\"", `platform.feature:1196`). Recorded as the user's explicit sign-off for that CHANGE; TRADING_MODE stays `paper`. Knock-on verification is objection O-13 (round 2).
  - Decisions: both homelab targets export, alert/dashboard scoping is a named follow-up feature (D-8); deterministic `<provider>-<service>` instance id for Go/Node/UI (D-7).
- Correction recorded: earlier statements that homelab staging and DO dev "both report staging" were an unverified premise; the pipeline renders `development`. The operator's D-6 steer makes the original statement true going forward.
- Open Threads: O-4 (rollback text + manual old-tag test), O-12 (homelab egress to the Grafana OTLP gateway is an operator precondition), O-13 (D-6 knock-on).

## Session 2026-11-11 — sdd-design (Phase 1 round 2 and gate)

- Round 2: design-proposer then design-adversary (NEEDS WORK: 1 blocking, 11 non-blocking, 0 Floor, 0 register violations). All adopted into the register: D-9 (the `target_info` join's right-hand side is wrapped in `group by (job, instance, host_provider)`, because every Node/UI restart adds a `target_info` row under the unchanged deterministic `instance`; verified live: 7 distinct `(process_pid, host_name)` rows per Node job in 6h), D-10 (test and acceptance hygiene), D-11 (stale `application_env` comments at `trading.proto:295` and `config.go:31` become a findings entry, no proto edit), D-12 (design.md must record the DO rolling-deploy overlap, the shared staging token, the 3-stack budget, the paging semantics and the egress precondition), R-7.
- Round-2 gate (operator): O-20 settled as D-13 (`OTEL_ENABLED: "true"` and `HOST_PROVIDER: homelab` are fixed compose literals; no owned-regex entries or release-env writes for them). The operator asked for another round (round 3), so approval was not taken.
- Round 3 proposer (consolidation) found G-1..G-4, now O-25..O-28 and petition P-1 in `debate.md`. G-2 (O-26) needs the operator's C-16 sign-off for the `@AC-9 @FR-3 @feature-302` Given; P-1 needs the operator's reopen decision on one clause of D-10.
- Open Threads: O-25/P-1 (pending operator), O-26 (pending operator sign-off).

## Session 2026-11-11 — sdd-design (Phase 1 round 3)

- Round 3 (consolidation): design-proposer (found G-1..G-4 -> O-25..O-28, P-1) then design-adversary (NEEDS WORK: 1 blocking, 9 non-blocking, 0 Floor, 0 register violations; filed REOPEN O-6 as P-2; conditional P-3 on D-9). Register now D-1..D-17, R-1..R-7, O-1..O-39, P-1..P-3.
- Adopted without reopen: D-14 (PromQL left selector carries `deployment_environment`; aggregation wraps the whole join), D-15 (AC-12 queries `target_info` directly), D-16 (guard zero-block case; S8 guard + doc blocks land together; TSV row claim corrected), D-17 (test and doc corrections incl. the runbook precondition that both `common.OTEL_*` keys must be non-empty in both SOPS files).
- Awaiting the operator: P-1 (reopen D-10 case-3 clause), P-2 (reopen the `OTEL_RESOURCE_ATTRIBUTES` owned entry), P-3 (reopen D-9: join on `deployment_environment` too), and the C-16 sign-off O-26 (`@AC-9 @FR-3 @feature-302` Given).

## Session 2026-11-11 — sdd-design (round-3 gate)

- **C-16 sign-off (operator, 2026-11-11):** CHANGE of `@AC-9 @FR-3 @feature-302` (`platform.feature:1525-1530`). The Given is reworded so the shared resolver output includes the two OTLP lines; OTEL_EXPORTER_OTLP_ENDPOINT/HEADERS stay required `${VAR:?}`, so a SOPS file lacking them now fails every homelab render at the named variable (fails closed, before anything ships). Signed off. Together with the round-1 sign-offs, all three C-16 CHANGEs in this design are now on record: `@AC-13 @FR-9 @feature-279`, the `development` half of `@AC-22 @FR-6 @feature-279`, and `@AC-9 @FR-3 @feature-302`.
- **Reopens (operator, 2026-11-11):** P-1 (D-10 case-3 `evil` clause), P-2 (the `OTEL_RESOURCE_ATTRIBUTES` owned entry of D-5/O-6), P-3 (D-9/D-14 join keys). Round 4 runs as an amendment round; the operator chose no resolution for P-2, so the proposer weighs keep-as-waived / replace with a render-assert check / drop under C-18 and the ledger rule.
- Open Threads: O-25 and O-39 resolve in round 4.

## Session 2026-11-11 — sdd-design (Phase 1 round 4, amendment round)

- Round 4: proposer applied the three operator-reopened clauses; adversary verdict SOUND (0 blocking, 9 non-blocking, 0 Floor, 0 register violations). All 9 adopted: D-18 (P-1: case 3 feeds `OTEL_ENABLED=false` and `HOST_PROVIDER=digitalocean`, a precondition grep for each; AC-20 drops the vacuous 'no evil' clause), D-19 (P-2: the `OTEL_RESOURCE_ATTRIBUTES` owned entry is dropped; O-6 waived as an Open Risk pending the operator's acknowledgement; constraint text corrected to 'several runtimes merge it'), D-20 (P-3: final PromQL joins on `(job, instance, deployment_environment)`; AC-10/AC-11 wording; guard allows exactly one tagged block per language; AC-12 adds the 'run the documented query, expect at least one series' check), D-21 (design-approval writes for FR-3 and the acceptance edits).
- Register now D-1..D-21, R-1..R-7, O-1..O-48, P-1..P-3; every objection closed except O-6 (waiver awaiting operator acknowledgement).
- Open Risks carried to design.md: DO rolling-deploy overlap; shared staging OTLP token; ~3,600-series budget and Python restart churn; paging semantics (follow-up `otel-env-provider-scoped-alerts`); homelab egress precondition; the O-6 waiver; Part 4 not scanning `deploy/homelab/compose.yml`; one-time relabel of DO dev Go/Node/UI series; mask ordering (O-27); `host.*` semconv namespace collision; `${VAR:?}` makes missing OTLP keys fail every homelab render (signed off).

## Session 2026-11-11 — sdd-design (approval)

- Round-4 gate (operator): chose "Approve design" and, for the O-6 waiver, "Add the cheap CI grep now" (not the recommended waiver). Recorded as D-22: Part 4 of `scripts/check-otel-produced-signals.sh` flags `OTEL_RESOURCE_ATTRIBUTES` in `.do/*`, `docker-compose.yml` and `deploy/homelab/compose.yml` (`AC-22 P4-resattr`, new `@AC-22`), and its sampler/gRPC-exclusion check now covers the homelab compose (new `@AC-23`). O-6 closed; no waiver.
- Phase 0 Recon: wrote recon.md (12 runtimes + homelab/SOPS pipeline + DO/local specs + OTel packages/docs; key reuse patterns: the single resource builder per runtime, the `owned`/`${VAR:?}`/`render-assert.jq` pipeline idioms, `expr_tokens`/`check_expr` for the query guard).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: hand-read `HOST_PROVIDER` with an inline normaliser in each of the 12 resource builders, deterministic `service.instance.id=<provider>-<service>` for Go/Node/UI, homelab staging `APPLICATION_ENV=staging`, OTLP keys through SOPS with one shared prefix helper, compose literals for `OTEL_ENABLED`/`HOST_PROVIDER`, `target_info` join on `(job, instance, deployment_environment)` documented and guarded. Rejected: Grafana-side promotion as sole mechanism, per-datapoint attribute, shell `sed` on the credential line, promtool, `OTEL_RESOURCE_ATTRIBUTES`, `service.namespace`, `instance=~` filter without a join.
- Constitution rules touched: C-01, C-05, C-08, C-11, C-13, C-14, C-15, C-16, C-18, P-01..P-06, F-01, F-04, F-06, F-07. Floor breaches: none in any round.
- C-16 sign-offs on record (all in this file): `@AC-13 @FR-9 @feature-279` (round 1), `@AC-22 @FR-6 @feature-279` development half (round 1 steer), `@AC-9 @FR-3 @feature-302` Given (round 3).
- Spec files updated to match the approved design (D-21): `product-spec.md` (problem statement, FR-1/3/4/5/6/7, FR-8 row, Out of Scope, Affected Services, Open Questions) and `acceptance.feature` (AC-1..AC-23; new AC-18..AC-23, rewritten AC-6..AC-12 and AC-14..AC-16 per D-14..D-20).
- Status: spec-ready → design-approved.
- Open Threads (target step): egress precondition + token sharing + series budget + paging semantics (S9 docs); AC-21 Python instance-id source (S2 RED first); semconv constant names for Go/Node (S1/S3 wire tests); named follow-up feature `otel-env-provider-scoped-alerts` (create via /sdd-story after /sdd-spec).

## Session 2026-11-11 — SOPS bootstrap question

- Operator asked whether the SOPS bootstrap workflow is the fix for a homelab render failing on missing OTLP keys. Answer recorded: no. `resolve()` falls back per key from SOPS to `LEGACY_<NAME>` (`sops_secrets.py:163-182`); after S5 `deploy-homelab.yml` passes `DEV_`/`PROD_OTEL_EXPORTER_OTLP_*` as `LEGACY_OTEL_*`. Operator confirmed those repo secrets exist, so the fallback covers it. Forced bootstrap re-seeds all of `common` and `digitalocean` from the legacy secrets (overwrite risk) and homelab-only keys are never seeded; the narrow fix is `sops set` for the two keys. Open check: neither repo secret is blank or a placeholder (values not visible from here).
- Operator assumption (2026-11-11): environment parity for the OTLP credentials — `PROD_OTEL_EXPORTER_OTLP_*` is assumed to hold the same valid values as `DEV_` (one shared Grafana instance). Staging is evidenced by the working DO dev export; production is assumed. Failure mode if wrong: the first homelab production deploy fails at `homelab-render-check.sh` naming the variable, before Tailscale or any ship step. Closes the "neither secret is blank" check.

## Session 2026-11-11 — sdd-spec

- Generated implementation-spec.md with 17 steps. Status → implementation-ready. Tree: ccr-6307b904-swdg1c@2b72dd4 ≡ origin/ccr-6307b904-swdg1c (TARGET = harness branch; `feature/homelab-otel-host-provider` does not exist on origin; main-dev is an ancestor). No code drift since recon's tree 3fdf7ba (`git diff --stat 3fdf7ba HEAD` touches only feature docs and the ledger), so recon's Codebase Map was reused and spot-re-verified.
- Step shape: Go/Python/Node/UI service+test pairs (1–8); SOPS path (9) + case 19 (10); homelab render (11) `Lands with` its fixtures (12); DO specs (13) + render case 9 (14); guard Part 4/6 + TSV row + observability.md + CI filter (15) + guard RED cases (16); remaining docs (17).
- Key codebase findings:
  - `scripts/sops-secrets.test.sh` cases 14–18 already exist (feature 302), so design S5's "new case 17" is numbered **19** in the spec.
  - 307 (`ui-env-themed-bundles`) is already on main-dev (`67b857a`, PR #1507), so the merge-order row is satisfied; all workflow/test anchors are post-307.
  - The `.github/workflows/ci.yml:155-161` `otel-signals` path filter lists neither `docker-compose.yml` nor `deploy/homelab/compose.yml`, so a compose-only PR would skip the AC-22/AC-23 scan. Step 15 adds both. This is a spec-time addition **not in design.md**; flagged for impl-spec review.
  - Node AC-4 (ledger `aws`) and AC-13 (config `Homelab`) need a non-`homelab` env while the in-process export test runs `homelab` (AC-1/AC-19). The spec gives `runChild` an optional `extraEnv` in those two files and filters child requests by resource `process.pid`.
  - `docs/patterns/observability.md` has no fenced block today; the guard's zero-block RED cases (D-16) are therefore real.
  - Product-spec Out of Scope excludes `packages/otel/dashboards/**`, while design S9 names the dashboards README. Step 17 edits the README text only (no dashboard JSON) and flags the interpretation for impl-spec review.
- Open Threads: create `otel-env-provider-scoped-alerts` via `/sdd-story` before `/sdd-execute`; AC-21's Python instance-id source is confirmed by Step 4's RED run (escalate, never drop, if absent); semconv constant names (`semconv.ServiceInstanceID`, `SEMRESATTRS_SERVICE_INSTANCE_ID`) are confirmed by Steps 2/6 builds.

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 1

- Result: 0 failures, 9 warnings (advisory; no Floor risk). Tree: ccr-6307b904-swdg1c@6801c3e ≡ origin/ccr-6307b904-swdg1c.
- Unresolved ✗ / ⚠ carried into execution — all addressed in `implementation-spec.md` before iteration 2:
  - W1 Steps 2/4/6/8/10/12/14/16: explicit RED procedure (P-06, C-08) — [x] addressed (Step Dependencies "RED procedure")
  - W2 Steps 1/3/5/7: deployment-files note (B2/B2b) — [x] addressed
  - W3 Step 2: `GOWORK=off` inside the `go list` substitution — [x] addressed
  - W4 Step 17: vacuous proto check replaced; `check-context-map.sh` added — [x] addressed
  - W5 Steps 10/14: anchors corrected to `:388`/`:711`, semantic placement — [x] addressed
  - W6 Step 6: SERVING proxy named in the AC-4/AC-13/AC-5 test names; AC-5 keeps the `getLogger('notify')` transport assertion — [x] addressed
  - W7 Steps 7/8: no-Playwright note (B3 frontend) — [x] addressed
  - W8 Step 4: AC-21 PRESERVE assertion exempt from RED — [x] addressed
  - W9 Step 15: RED cases held by Step 16; existing harness cases must stay green — [x] addressed
- Spec-flagged deviations: all five accepted; recorded under Deviation Log § Spec-time notes.
- Overlap findings: WARN only (329 telemetry modules; 297 dashboards README, produced-signals.tsv; 297/298/324 ci.yml; 324 ruff gate). No new merge-order row; prose note extended in `merge-order.md` for 297/298/324.

## Session 2026-11-11 — sdd-review impl-spec (advisory), iteration 2

- Result: 0 failures, 0 warnings (2 notes), no Floor risk. Tree: ccr-6307b904-swdg1c@cefab12 ≡ origin/ccr-6307b904-swdg1c. All nine iteration-1 fixes re-verified correct and complete; no new defect.
- Notes, no change: (1) Steps 1/3/5/7 route deployment files via Steps 11/13 (accepted trade-off, W2). (2) Step 17's proto check is not vacuous: F-05 runs a step's verification before its commit, so `git diff --name-only` sees the step's uncommitted changes.
- Overlap (WARN only, no FAIL): `merge-order.md` prose corrected and completed — 329 anchors tightened and `services/xstockstrat-ui/CLAUDE.md` added; the 331 note corrected (331 scopes the `.do` `health_check` out, product-spec `:54,:69`); 297's `docs/setup/grafana-cloud.md` and 318's `ci.yml` scope added; the 332-after-307 row marked Resolved (307 on `main-dev` at `67b857a`, verified with `git merge-base --is-ancestor`).
- Unresolved ✗ / ⚠ carried into execution: none.
- Overlap confirmation pass (tree @3e50e88): no FAIL; three wording/record items fixed in `merge-order.md` — the UI `CLAUDE.md` sentence now says 329 edits `:302` and 332 edits `:323-324` (disjoint); 318 marked scope-level; 307's `ci.yml`/`ci-overview.md` overlaps noted as already absorbed (307 on `main-dev` at `67b857a`, the spec is post-307). No new collision, no merge-order row needed.

## Session 2026-11-11 — sdd-execute (sequential)

- Mode entry confirmed by operator: `sequential`, no checkpoint pauses, commits go straight to `feature/homelab-otel-host-provider` (no per-step branches). Re-spec: none needed (no code change since the spec, branch at `9400dcb` = main-dev + 332 docs).
- Tooling: go1.27.0, golangci-lint 2.14.0, Python 3.13 + uv + ruff, Node 24.22.3 + pnpm 9.15.9, docker/compose, sops 3.13.3, age 1.3.2, yq v4.47.2 (mikefarah, unpinned like CI), jq, shellcheck 0.9.0, shfmt 3.8.0. Node 24 is at `/usr/local/bin/node`; this host has `/opt/node22/bin` earlier on PATH, so Node commands run with `PATH=/usr/local/bin:$PATH` (host-only, no repo effect).
- Steps 1–2 (Go, trading/portfolio/marketdata) — done.
  - RED (Step 2 tests, pre-Step-1 `otel.go`): `TestNewResourceOmitsTradingMode` `host.provider = "", want "unknown"|"homelab"|"digitalocean"` (6 rows); `TestExportedSignalsCarryHostProvider` traces/metrics/logs `host.provider = ""`, `service.instance.id = "", want "homelab-trading"`; `TestExportedSpanCarriesDigitalOcean` `want "digitalocean-trading"`. exit=1 in all three services, no compile error.
  - GREEN: the three tests pass in all three services; `go test ./...` totals 82.3% / 81.8% / 83.2%; golangci-lint `0 issues`; `git diff --exit-code go.mod go.sum` clean.
  - `semconv.ServiceInstanceID` exists in `semconv/v1.25.0` (`go doc`), so no string-literal fallback was needed.
  - Lint fix during GREEN: `attribute.Value.Emit` is deprecated (SA1019), so the table uses `Value.String()`.
- Steps 3–4 (Python, indicators/ingest/analysis/agent) — done.
  - RED (Step 4 tests, pre-Step-3 `telemetry.py`): `KeyError: 'host.provider'` in the wire test, the unit table and ingest `test_unset_host_provider_exports_unknown`. Failures: indicators 7, ingest 8, analysis 7, agent 7; exit=1 in each, no import/syntax error.
  - AC-21 (PRESERVE, D-17): confirmed before Step 3. With SDK 1.45.1, `Resource.create` adds a UUID `service.instance.id` in all four services, so no escalation was needed.
  - GREEN: the `test_telemetry.py` suites pass (25/26/28/17). Full coverage is indicators 86.90% (≥50) and ingest/analysis/agent 85.21/91.47/87.94% (≥40). `ruff check` and `ruff format --check` are clean, and `uv.lock` is unchanged.
  - C-13 verdict: the new literals are inline with one consumer each; no `conftest.py` change (the grep finds no `conftest` import).
- Steps 5–6 (Node, config/identity/ledger/notify) — done.
  - RED (Step 6 tests, pre-Step-5 `telemetry.ts`): `tsc` compiled; failures were `AssertionError` on `host.provider` / `service.instance.id` in the span, metrics and logs export tests, in the unit table (`HOST_PROVIDER=undefined`), and in the ledger AC-4 / config AC-13 child tests (`/v1/traces host.provider: ` empty, so the pid filter isolated the child's resources). exit=1 in all four.
  - GREEN: `node --test` passes everywhere: config 347/347, identity 155/155, ledger 160/160, notify 148/148. c8 line coverage is 92.05 / 84.52 / 85.42 / 85.35% (≥40). `pnpm run lint` has 0 errors (only pre-existing `no-explicit-any` warnings) and `tsc` builds.
  - `SEMRESATTRS_SERVICE_INSTANCE_ID` is exported by the pinned semconv (`SemanticResourceAttributes.d.ts:491`), so no literal fallback was needed.
  - Prettier: the touched files were prettier-clean before the edits, so `prettier --write` on those three files per service reformatted only the new lines. CI does not run `format:check`; this keeps the files clean.
  - The notify AC-5 test passes before and after Step 5, as a PRESERVE assertion should: `HOST_PROVIDER` cannot turn telemetry on.
  - C-13: the `resourceAttrs` helper and the literals stay inline, one consumer per file, with no new fixture home. Identity's existing `./fixtures/otlpReceiver` import is unchanged.
- Steps 7–8 (UI) — done.
  - RED (Step 8 testkit, pre-Step-7 `telemetry.ts`): 6 failed / 529 passed. The span, metrics and serverLog tests failed under both header forms with `expected undefined to be 'homelab'`.
  - GREEN: vitest 76 files / 535 tests pass (both the `src/instrumentation` subset and the full suite), `pnpm run lint` is clean, and prettier is clean on both touched files.
  - C-12 verdict: one-off env literals only, so no `e2e/fixtures/` import. The `firstResourceAttrs` helper is local to the testkit, its single consumer.
  - No Playwright run: the change is server-side telemetry only (B3).
