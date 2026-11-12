# Context: metrics-host-provider-label

**Feature**: `docs/roadmap/features/337-metrics-host-provider-label/feature.md`
**Product Spec**: `docs/roadmap/features/337-metrics-host-provider-label/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/337-metrics-host-provider-label/implementation-spec.md`

---

## Session 2026-11-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 337 reserved on origin via `scripts/sdd-allocate-feature-number.py`. Branch `feature/metrics-host-provider-label` from `origin/main-dev` (cee3bae).
- Operator constraints (pre-decided): no `service.namespace` or standard-attribute reuse; logs filter unchanged; metrics-only; alerts/dashboards out of scope; must not depend on or touch feature 336 (PR #1527).
- Prior art: feature 332 `debate.md` locked R-1 (Grafana-side promotion as sole mechanism: "unversioned stack setting, untestable from the repo") and R-2 (per-datapoint attribute via views: "touches every instrument in 12 runtimes; Go views can only drop attributes and `serverMetricViews` must stay unchanged (`@AC-56 @feature-294`)"). This feature reopens both at the operator's request; design must address those reasons, not ignore them.
- C-16: AC-10/AC-11 of 332 in `docs/sdd/business-rules/platform.feature` document the join; expected EXTEND (simple form added), recon to classify.

## Session 2026-11-12 — sdd-review product-spec

- Round 1: FAIL — FR-4 had no covering `@AC-*` (C-15); five Open Questions unchecked. Fixed: added `@AC-12 @FR-4`; AC-2 expanded to all 12 runtimes; AC-6 pinned to 3600 (`observability.md:114`); FR-7 now states that `check-otel-produced-signals.py` Part 6 (`:368-384`, exactly one promql block; `:502-505` target_info matchers) changes; open questions checked off as deferred to /sdd-design; ledger traps moved to a constraints note.
- Round 2: PASS WITH WARNINGS, no blockers; stale "All five" count fixed. Product spec approved. Status: draft → spec-ready. Tree: feature/metrics-host-provider-label@ca75255 ≡ origin.
- Overlap (WARN only, no FAIL): `observability.md` §"Separating DO and homelab" and `check-otel-produced-signals.py` shared with 333 (`otel-env-provider-scoped-alerts`) and 297; `produced-signals.tsv` append-at-end shared with 297; per-runtime telemetry modules shared with 329 and 332 (only if option B); 336 has no directory on disk (unverifiable, spec forbids depending on it); `platform.feature` `@AC-10`/`@AC-11` are reused across many features, target the `@feature-332` pair (`:2325`, `:2331`). No merge-order row written (non-blocking textual overlap; precedent `merge-order.md:367-376`); awaiting operator confirmation.
- Recommended design depth: **full** per `docs/sdd/design-depth-rubric.md` (12 services, overlap findings). Operator instruction was `quick`; running `quick` and surfacing the divergence.
- Live check (Grafana MCP, 2026-11-12): label names on `rpc_server_duration_milliseconds_count` = `deployment_environment, instance, job, rpc_grpc_status_code, rpc_method, rpc_service, rpc_system, service_instance_id, service_name` — no `host_provider`. Grafana docs for option A: self-service "experimental, contact Grafana Labs Support"; changes apply to newly ingested data only.

## Session 2026-11-12 — sdd-design (Phase 0 recon)

- Wrote recon.md (stamp feature/metrics-host-provider-label@eb69da3). Discovery ran per runtime group; pinned SDK sources read directly (Go sdk/metric 1.45.0, sdk-metrics 1.25.1 and 2.7.1, sdk-node 0.52.1 and 0.218.0, Python sdk 1.45.1). Option A doc read; live Grafana label set and `group_left` over an already-present label verified.
- Key recon facts: View cannot add attributes in Go, Node leaves or Python (filter-only); UI sdk-metrics 2.x can via `attributesProcessors`; the supported seam in Go/Node/Python is an exporter wrapper; no shared telemetry package in any language; option A has no repo-side mechanism and an unverified free-tier path.
- Post-recon escalation (quick mode): signals fire (12 services, overlap, potential C-16 CHANGE of `@AC-41`/`@AC-36`/`@AC-51 @feature-294`). Operator answer at the P-04 gate: **Upgrade to full** (min 2 rounds, cap 5). Never downgrade.

## Session 2026-11-12 — sdd-design (Phase 1 round 1 gate)

- Round 1: design-proposer (option B, per-runtime exporter wrapper) then design-adversary (NEEDS WORK, 0 Floor, 16 objections, 15 adopted into D-4..D-11). Register on disk: debate.md.
- **Operator sign-off (C-16 CHANGE), round-1 gate 2026-11-12:** amend `@AC-41 @FR-15 @feature-294` (`platform.feature:1346`), `@AC-36 @FR-11 @feature-294` (`services/xstockstrat-ui/acceptance/signal-map-instrumentation.feature:29`) and `@AC-51 @FR-5 @feature-294` (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature:36`) by appending "apart from the platform-wide `host.provider` export label (feature 337), added after aggregation". Instrument-level key sets and allowlist tests unchanged. The edits to those suites happen at launch via the C-16 promotion, not before.
- Operator chose to run round 2 (full mode requires ≥2 rounds).
- Spec rewordings required by the design (applied at design approval, IDs kept): @AC-2, @AC-3, @AC-6, @AC-1, @AC-9; FR-1 drops `rpc_client_*`; new scenarios for per-export fail-open, same-key overwrite, delta-temporality forwarding.
- Open Threads: O-13 (jscpd ignore entries only where enforcement exists, or record the YAGNI trade-off).

## Session 2026-11-12 — sdd-design (Phase 1 round 2 gate)

- Round 2: design-proposer (consolidation) then design-adversary (NEEDS WORK, 0 Floor, 12 new objections). Adopted into D-12..D-16 (join pre-aggregation `sum without (host_provider)` because the 332 join errors for ~5 min per stack during the rollout; acceptance corrections for @AC-1/@AC-6/@AC-10/@AC-13/@AC-17; Node fail-open seam; README:47 and gate scope; guard row ID `337-AC-9`; per-leaf citations; O-13 closed on the YAGNI trade-off).
- **Operator decisions at the round-2 gate (2026-11-12):** reopen **P-1** (D-11 placement: carry the three signed C-16 CHANGEs as a `# Feature 337 (operator-signed C-16 CHANGE …)` supersede comment above `platform.feature:1341`, ui `signal-map-instrumentation.feature:29`, analysis `…:36`, plus new 337 scenarios, instead of editing promoted text; the CHANGE and its sign-off stand) and **P-2** (D-5/D-8 test scope: run each wrapper behaviour test in every one of the 11 copies). Run round 3.
- Open Threads: O-18/P-1 and O-19/P-2 resolved by round 3; guard `337-AC-9` row naming; AC-6 usage-series query (`grafanacloud_instance_active_series`) must be verified to exist on the stack before it is promised in the spec.
- T0 baseline (Grafana MCP, datasource `grafanacloud-usage`, 2026-11-12): `max_over_time(grafanacloud_instance_active_series[1h])` = 2671, equal to `grafanacloud_instance_active_otlp_series` (2671). Only DO dev exports today. Both series exist on the usage datasource, so the @AC-6 measurement is available.

## Session 2026-11-12 — sdd-design (Phase 1 round 3)

- Round 3 (confirmation of the reopened pieces): proposer deltas, adversary verdict **SOUND, ready to approve** (0 Floor, 10 non-blocking text/plan fixes, 0 petitions). Adopted as D-17..D-20; P-1 and P-2 resolved (O-18, O-19 closed). No open objection remains.
- Corrections to the plan: `/sdd-execute` promotion is an inline operator-confirmed append (`sdd-execute/SKILL.md:187-201`); the scenario-promoter CONFLICT flow belongs to `/promote` and `/sdd-archiver`. Supersede-comment precedent in promoted suites is established (`indicators/acceptance/signal-map-instrumentation.feature:15`, config, agent, marketdata suites).

## Session 2026-11-12 — sdd-design

- Phase 0 Recon: wrote recon.md (12 runtimes in 4 runtime groups plus guards/docs and scenario-recon; key reuse: the 332 normaliser output, existing OTLP wire-test seams, the guard Part 6 structure).
- Phase 1 Grilling: 3 rounds (full; upgraded from quick at the post-recon gate). Chosen approach: option B, a per-runtime metric-exporter wrapper adding datapoint attribute `host.provider` just before the OTLP exporter. Rejected: R-1 `service.namespace`, R-2 `OTEL_RESOURCE_ATTRIBUTES`, R-3 UI-only view, R-4 option A now, R-5 reinterpreting the 294 sentences.
- Constitution rules touched: C-01, C-08, C-10, C-11, C-14, C-15, C-16, C-18, P-06. Floor breaches: none in any round.
- **Operator approvals (2026-11-12):** design approved at the round-3 gate, including step 1 as an operator-run smoke test with the staging OTLP token from their own shell (`@AC-12`); C-16 CHANGE sign-off for `@AC-41`/`@AC-36`/`@AC-51 @feature-294` with placement as read-as comments plus new 337 scenarios (round-1 and round-2 gates).
- Spec rewrites applied at approval: acceptance.feature now `@AC-1..@AC-22` (AC-12 reworded for option B; AC-17/AC-22 smoke gates; AC-18..AC-21 new); product-spec FR-1/3/4/5/6/7/8, Affected Services and Open Questions updated.
- Status: spec-ready → design-approved.

### Open Threads
- [ ] Step 1 smoke test passes on Python protobuf path only; Node JSON path covered by wire tests and post-deploy `@AC-1`/`@AC-10` (target: steps 3 and 7).
- [ ] Homelab staging not exporting yet; `@AC-1`/`@AC-6`/`@AC-10` need it; operator confirmation before main-dev to main promotion (target: step 7).
- [ ] Unread sources: `otlpmetrichttp` v1.45.0 encoder, Python `OTLPMetricExporter`, `attribute.Set` dedup (target: steps 2-5 wire and same-key tests).
- [ ] Guard `337-AC-19` substring weakness accepted (target: step 6).
- [ ] Non-blocking `merge-order.md` note for 333/297/329 overlap awaiting operator confirmation (target: before /sdd-spec).
- [ ] Integration append of `@AC-18..@AC-22`-derived scenarios plus five read-as comments (one above each of platform `@AC-41`, `@AC-10`, `@AC-12`, ui `@AC-36`, analysis `@AC-51`), operator-confirmed (target: Step 13 / final PR).

## Session 2026-11-12 — sdd-spec

- Generated implementation-spec.md with 15 steps. Status → implementation-ready. Tree: feature/metrics-host-provider-label@402da1f ≡ origin/feature/metrics-host-provider-label (origin/main-dev merged; 336 had landed).
- Key codebase findings:
  - `newResource(ctx)` is called only from `otel.go:58` and `otel_test.go:69` in each Go service; hoisting `p := hostProvider()` into `Init` changes its signature, so Step 2 (service) and Step 3 (test) are one atomic unit. The same holds for the Node leaves (tsc compiles `src/__tests__/`), the UI and Python (new tests import the new symbol).
  - Line offsets differ per Node leaf (config vs identity/ledger vs notify); each leaf is cited separately in Step 4. Python `init_telemetry` uses the local name `provider` for the `TracerProvider`, so the stamped value must use another name.
  - Guard `query_blocks` matches the tag line by equality (`check-otel-produced-signals.py:483`), so the new `otel-guard:host-provider-label` tag is invisible to the old guard: docs (Step 10) go before the guard (Steps 11-12) and `test_two_promql_blocks_fail` stays valid unchanged.
  - Go `attribute.NewSet` and `Set.ToSlice` were read from `otel@v1.45.0` (`attribute/set.go:209,165`) via `go mod download`; `otlpmetrichttp` encoder and the Python `OTLPMetricExporter` remain unread (wire tests prove them). The Python SDK is not installed in this sandbox.
- Open points surfaced for the operator:
  - Design text says "four" read-as comments, D-17 names five anchors (platform `@AC-41`, `@AC-10`, `@AC-12`; ui `@AC-36`; analysis `@AC-51`); Step 13 lists five and defers to the operator-confirmed append plan.
  - Step 13 proposes not promoting `@AC-12` (design gate) and `@AC-17`/`@AC-22` (one-off smoke gates); operator may override at the P-04 gate.
  - Steps 14-15 run only after deploy and need homelab staging exporting; non-blocking `merge-order.md` note for 333/297/329 overlap still awaits operator confirmation.

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 1

- Result: 1 failure, 8 warnings, 1 note (advisory); overlap scan: no FAIL-level collision (WARN-level file overlap with 333, 297, 329, 334; 336 has landed). All 22 `@AC-*` covered.
- Findings and resolution (all edited in `implementation-spec.md`, `design.md`, `product-spec.md` in the same session):
  - [x] 1 Steps 11/12 not a `Lands with` pair (C-08/P-06): now `Lands with` each other, RED proven in the working tree first (Step 12 item 5), new line in Step Dependencies.
  - [x] 2 Step 13 promoted unmeasured scenarios (C-16): Step 13 promotes only the code-verified set; `@AC-1/6/7/10/11` are promoted in Step 15 after Step 14 measures them.
  - [x] 3 Step 7 threshold unstated: Verification now states the 40% `src/lib/**` scope and that `src/telemetry.ts` is outside it.
  - [x] 4 Step 12 coverage statement: added (`scripts-python` CI job runs ruff + pytest only, `ci.yml:860`).
  - [x] 5 AC-20 literal: one exact sentence pinned in Step 10 and asserted in Step 12.
  - [x] 6 Citation drift: ledger `runChild` `:220`/`:313`, UI counter test `:128`, agent `metric_reader` `tests/conftest.py:337`, `observability.md:109`, `platform.feature` `@AC-12` `:2338`.
  - [x] 7 design.md counts: note added (15 steps, five comment anchors, final set decided at Step 13).
  - [x] 8 Step 14 had no runnable command: git diff check, guard run and the query procedure added.
  - [x] 9 (note) Steps 2/3/5/9 touch 6-8 files each: accepted, identical copies per runtime with `Lands with` pairing (D-16, C-18).
  - [x] 10 (note) Tree header refreshed to 799aedf; product-spec and design.md now say 336 has landed.
- Overlap findings: textual overlap only, hunk-level unverifiable until 333, 329 and 297 have implementation specs; `merge-order.md` note still awaiting operator confirmation.

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 2

- Round-1 findings 1-10 verified resolved against the tree. Round 2 raised 7 warnings and 2 notes from the Step 15 split; all edited in `implementation-spec.md`:
  - [x] Step 13 stale "reword @AC-1/@AC-6 if Step 14 changed it" sentence deleted (Step 15 item 3 carries the rule).
  - [x] Scenario Coverage table lists Step 15 for `@AC-1/7/10/11`; Execution Summary and Step Dependencies describe Step 15's promotion and its separate docs-only PR; FR coverage line relabelled as AC numbers.
  - [x] Step 15 states the mechanism (operator-confirmed inline append) and that later `/promote` or archiver runs dedup by `@feature-337` + `@AC-n`; Step 13's set is intentionally partial.
  - [x] Step 14 `@AC-11` command runs on the feature branch pre-merge, with a `gh pr diff` post-merge form.
  - [x] Step 15 Verification has the append-only check.
  - [x] Cites: Step 13 pattern `:2337`; Step 15 cost-line cites by text; header Tree refreshed to 2f13839.

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 3

- Round-2 fixes verified resolved (28 of 28 spot-checked cites accurate). Round 3 raised 3 warnings and 3 notes, all edited in `implementation-spec.md`:
  - [x] Step 10 Verification ran the `git diff` check inside `scripts/` (vacuous): the diff now runs first from the repo root and the pytest call is a subshell.
  - [x] Steps 13 and 15 append-only checks diffed the working tree (vacuous after commit): now `git diff -U0 origin/main-dev...HEAD`; Step 13 also counts promoted scenarios (14).
  - [x] Step 2 `go.mod` check used root paths: now `git diff --exit-code -- 'services/*/go.mod' 'services/*/go.sum'`.
  - [x] Steps 8/9 use `uv run --extra dev --frozen ruff|pytest` like CI and the `scripts/` steps.
  - [x] Step 1 evidence cites `observability.md:57` for the `Authorization=Basic%20…` header form.
  - [x] Header Tree stamp annotated: later commits touch only docs under the feature directory.

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 4

- Round-3 fixes verified resolved (about 35 fresh cites accurate). Round 4 raised 8 low-severity warnings, all edited in `implementation-spec.md`:
  - [x] Step 1 evidence: inaccurate grep claim removed; `grafana-cloud.md:177` cited as a direct read.
  - [x] Header Tree stamp names the merge of `origin/main-dev` (`402da1f`, includes 336) and the verified docs-only diff since `2f13839` (`git diff --stat 2f13839..9a8a370`: only `context.md` and `implementation-spec.md`).
  - [x] Steps 2 and 3: the `go.mod`/`go.sum` unchanged check is inside the fenced command block.
  - [x] Steps 13 and 15: append-only and promoted-count checks assert (`! ... | grep -q`, `test ... -eq 14` and `-eq 19`).
  - [x] Step 7: telemetry-only note covers the frontend-E2E rule (existing Playwright suites unaffected).
  - [x] Step 10 evidence ranges: `:103-112` and `:117-`.
  - [x] Step 10 item 1 pins the exact sentence "`host_provider` is a datapoint label on every metric series the workloads export" and Step 12 item 4 asserts that substring.
  - [x] Step 12 Verification runs from the repo root (subshell for `scripts/`).

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 5

- Round-4 edits verified. Round 5 raised 2 warnings and 2 notes, all edited in `implementation-spec.md`:
  - [x] Steps 13/15 count `@feature-337` tag lines only (`grep -cE '^[[:space:]]*@.*@feature-337'`), so read-as comments cannot inflate it; Step 13 item 3 says comments never contain the string; stray `")` removed.
  - [x] Step 12 item 5: the documentation-contract case is a characterization case (red N/A); the mutation cases and second-label-block case are the real REDs.
  - [x] Header Tree stamp is self-verifying (`git diff --stat 2f13839..HEAD -- . ':!docs/roadmap/features/337-metrics-host-provider-label' ':!docs/roadmap/ledger'` prints nothing), so it no longer goes stale with each docs commit.

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 6

- Round-5 edits verified (Tree command correct; excluding the append-only ledger is justified). Round 6 raised 2 warnings, both edited in `implementation-spec.md`:
  - [x] Steps 10, 13, 14, 15: the diff checks used the three-dot form, which sees only committed content, but `/sdd-execute` runs Verification before the commit, so they could pass vacuously. They now diff the working tree against `origin/main-dev` (two-dot, no `HEAD`); Step 13 states why.
  - [x] Step 5 TDD line no longer refers to an undefined "Node B6"; it names the B2 input-unchanged assertion.

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 7

- Round-6 edits verified. Round 7 raised 1 warning and 1 note, edited in `implementation-spec.md`:
  - [x] Steps 10, 13, 14, 15: the two-dot diff against the moving `origin/main-dev` tip would false-fail whenever main-dev advances (another feature's promotion, or 333's alert files). All four checks now diff the working tree against `B=$(git merge-base HEAD origin/main-dev)`; the append-only regex is `^-($|[^-])` so a removed blank line is also caught. Step 13 explains the choice.
  - [x] Step 14 post-merge comment reworded (after merge the diff is vacuous; use the `gh pr diff` form).
- The new commands were executed in the repo: path check prints nothing, append-only check passes on a clean tree and fails on a deleted line and on a removed blank line.

## Session 2026-11-12 — sdd-review impl-spec (advisory), round 8: clean

- Result: 0 failures, 0 warnings. Round 8 verified the round-7 merge-base diff blocks (each defines `B` itself; quoting and regex correct) and an independent pass with about 40 cites, cross-step consistency, C-08/C-15/C-16/P-04/P-06 and F-* found nothing. One cosmetic cite fixed (`packages/otel/dashboards/README.md:46-48`).
- Loop summary: 8 rounds, 1 failure and 36 warnings or notes found and fixed in total (rounds 1-7); none carried unaddressed into execution.
- Unresolved, not addressable by editing the spec: textual overlap with 333, 297, 329 and 334 (`observability.md`, the guard and its test, `produced-signals.tsv`, the telemetry modules); hunk-level overlap is unverifiable until 333, 329 and 297 have implementation specs. The non-blocking `merge-order.md` note awaits operator confirmation. Re-run the Mode B overlap scan once those specs exist.

## Session 2026-11-12 — comment count settled

- **Operator decision (2026-11-12):** the read-as comment count is **five**, one directly above each of the five affected scenarios: platform `@AC-41 @feature-294`, platform `@AC-10 @feature-332`, platform `@AC-12 @feature-332`, ui `@AC-36`, analysis `@AC-51`. The earlier "four" came from one comment covering both 332 scenarios; they are now separate.
- Edited: `implementation-spec.md` Step 13 item 2 (exactly five, first line of each begins `# Feature 337`) and Verification (`test ... -eq 5` count across the three suite files); `design.md` Open Risks and the superseded-counts note; the `context.md` Open Thread above. The Step 13 open question about the comment set is closed; the question about which scenarios are not promoted (`@AC-12`, `@AC-17`, `@AC-22`) remains with the operator.

## Session 2026-11-12 — sdd-execute (Step 1, part a)

**Steps this session**: Step 1 (part a only; status stays `pending`)
- Tooling setup (step 1, Python): uv 0.11.32 ✓ · Python 3.13 ✓ · ruff 0.16.9 ✓ (uv sync) · pytest 9.0.3 ✓ · opentelemetry-sdk + OTLP exporter + asyncpg import ✓. No database, no Docker.
- Phase-2: the operator adjusted Step 1 ("create the script to run in the DO console, similar to other maintenance scripts (for instance in indicators)") and chose "Merge the probe early" for sequencing after seeing the revised plan and the F-03 constraint. Their answer was taken as the approval for the plan; recorded as a Deviation Log entry.
- Done: `services/xstockstrat-indicators/app/maintenance/otlp_label_probe.py` and `tests/test_otlp_label_probe.py` (5 tests).
- TDD (AC-17, AC-22 data shape): red → no-op stub with the exporter seam, `pytest tests/test_otlp_label_probe.py` → 5 failed (nothing exported, exit 0 instead of 1/2, no output; an earlier red caused by a missing seam was discarded as the wrong reason) → green 5 passed.
- Verification: `ruff check`/`format --check` clean; full indicators suite `581 passed`, coverage 87.25% (threshold 50), twice in a row. One earlier full-suite run had `tests/test_sandbox_watchdog.py::test_ac8_fork_bomb_is_not_a_success_the_service_recovers_and_nothing_is_unobservable` fail; it passed alone with and without the new files, in the baseline full run (576) and in the two later full runs, so it is recorded as a one-off flaky timing test, not caused by this change (hand to `/sdd-qa flake` if it recurs).
- Real end-to-end check (not a mock): the module against a local OTLP receiver. 200 → exit 0 with `POST /v1/metrics`, `application/x-protobuf`, the `Authorization` header parsed from the env form with a space, body containing `host.provider` and `smoke337.join`; 401 → exit 1 after a single request; no env → exit 2; `--help` works; the token never appears in output.
- Files modified: `services/xstockstrat-indicators/app/maintenance/otlp_label_probe.py`, `services/xstockstrat-indicators/tests/test_otlp_label_probe.py`, `implementation-spec.md` (Deviation Log only), `context.md`.
- Deviations: Step 1 scope expanded and split into a/b (full detail in the Deviation Log).

### Open Items
- [x] **Step 1 part b (operator):** after PR #1528 is squash-merged into `main-dev` and DO dev has redeployed the indicators component, open the indicators component's console in the DO dev app and run `cd /app && python -m app.maintenance.otlp_label_probe`. Then tell me, and I query Grafana read-only for `@AC-17` and `@AC-22` and record GREEN or RED here. GREEN → restart the feature branch from `main-dev` (the PR was squash-merged) and start Step 2. RED on `@AC-17` → stop and return to `/sdd-design`.
- [ ] Remove or keep `otlp_label_probe.py` after Step 1b: decide then (it is harmless and documents the check; removal would be a later docs/cleanup change).

**Progress**: 0 done / 15 total (Step 1 part a landed, part b pending)
**Stopped at**: Step 1 part b (needs the operator and a deploy)
**Next**: merge #1528, deploy, run the probe, then `/sdd-execute metrics-host-provider-label next`

## Session 2026-11-12 — sdd-execute (Step 1, part b: gate result)

**Steps this session**: Step 1 (part b) — **done, GREEN**
- Probe PR #1529 squash-merged into `main-dev` (`b239115`) after resolving add/add conflicts in this feature's own files (the `main-dev` copies were byte-identical to `e72b2c2`, so the branch side lost nothing); CI green on the merged head. The feature branch was restarted from `main-dev` (`b239115`; the remote head `e72b2c2` held only already-merged history) with a force-with-lease push.
- Run by the operator in the DO dev indicators component console at 2026-11-12T19:41:19Z (`python -m app.maintenance.otlp_label_probe`): `exported ... to otlp-gateway-prod-us-west-0.grafana.net: smoke337.probe x1, smoke337.join x2 as {service.name: smoke-337, deployment.environment: smoke, host.provider: unknown, service.instance.id: smoke-337}`. Header form: the DO container's own `OTEL_EXPORTER_OTLP_HEADERS` (no token handled by the operator, no `%20` form needed).
- Queries run read-only through the Grafana MCP on datasource `grafanacloud-prom` at 19:42:51Z-19:43Z (about 1.5 minutes after the export, inside the 5-minute window):
  - **`@AC-17` GREEN.** `smoke337_probe_total{deployment_environment="smoke"}` returned exactly one series: `host_provider="homelab"`, `instance`/`job`/`service_instance_id`/`service_name` = `smoke-337`, value 1. `list_prometheus_label_names` on that selector: `__name__, deployment_environment, host_provider, instance, job, service_instance_id, service_name` (`host_provider` present, `host.provider` absent, no `exported_host_provider`). The resource carried `host.provider="unknown"` and the datapoint `"homelab"`, and the metric label is `homelab`: the datapoint attribute wins over the resource attribute, which the equal-values probe of the earlier design could not have shown. `target_info{deployment_environment="smoke"}` kept `host_provider="unknown"` (the resource value).
  - **`@AC-22` GREEN.** `sum by (service_name, host_provider) (sum without (host_provider) (last_over_time(smoke337_join_total{deployment_environment="smoke"}[15m])) * on (job, instance, deployment_environment) group_left (host_provider) group by (job, instance, deployment_environment, host_provider) (target_info{deployment_environment="smoke"}))` returned exactly 1 row, `{host_provider="unknown", service_name="smoke-337"}`, value 2 (the join attaches the `target_info` resource value; for real services the resource and datapoint values are equal).
  - **`@AC-22` RED reproduced.** The same query without `sum without (host_provider)` failed with `multiple matches for labels: grouping labels must ensure unique matches`. The two underlying series coexisted as designed: `smoke337_join_total{host_provider="homelab", ...} = 1` and `smoke337_join_total{...} = 1` with no `host_provider`. D-19's conditional ("if the RED does not reproduce, reword the `@AC-22` sentence") does not apply; the sentence stands.
- Gate: GREEN on `@AC-17` and `@AC-22` (`@AC-12` approval recorded in the earlier session entry). Steps 2-9 are unblocked.
- `smoke` is now an extra `deployment_environment` value on the stack and appears in `$environment` dashboard variables until its series go stale (D-13); one stale `smoke-337` series and one `target_info` row remain.
- Status: `implementation-ready` → `in-progress`. Step 1 `done`.
- Files modified: `implementation-spec.md` (Step 1 `**Status**` only), `status.md`, `feature.md`, `context.md`.
- Deviations: none beyond the Step 1 a/b split already in the Deviation Log.

### Open Items
- [ ] Keep or remove `services/xstockstrat-indicators/app/maintenance/otlp_label_probe.py` after the feature lands (harmless, documents the check; removal would be a later cleanup change).

### Session: Steps 2+3 (Go wrapper, sequential mode)
- RED (stub pass-through): `TestHostLabel*` x4 failed with "did not wrap the inner exporter"; wire tests failed on datapoint `host.provider` (`""` vs `homelab`) and, in trading, the `rpc.server.duration` key set (@AC-18).
- GREEN: `hostlabel.go` (stage-then-commit over the 8 data types, `recover` fail-open, `sync.Once` warn) identical in trading/portfolio/marketdata; `go test -race ./internal/telemetry/` and full `go test ./...` pass, `golangci-lint` 0 issues in all three.
- Helper named `collectAttrSlots` (a test file already declares `collect`). Test uses `Value.String()` (`Emit` is deprecated).
- Files modified: per service `internal/telemetry/{hostlabel.go,hostlabel_test.go,otel.go,otel_test.go}`; spec Steps 2-3 `**Status**` only.

### Session: Steps 4+5 (Node leaves, sequential mode)
- RED (pass-through stub): B1 and B2 in every leaf and the extended counter wire test failed on assertions (no label on the wire datapoint; B2 kept `x`).
- GREEN: `withHostProvider` in config/identity/ledger/notify `src/telemetry.ts` (copy-not-mutate, `try/catch` fail-open, per-instance warn-once, `.bind(inner)` selectors omitted when absent); `initTelemetry` builds the resource once and reads `host.provider` from it (D-6). `pnpm run lint` 0 errors, `test:coverage` passes (config 352, identity 159, ledger 166, notify 259 tests).
- Test deviation: the counter wire test waits for a `/v1/metrics` request that contains `t.count` — the first 100 ms interval export is empty.
- Added ledger `@AC-4`/`@AC-14` child-process wire tests and config `@AC-3` test; `telemetry.hostProvider.test.ts` is identical in the four leaves.
- Files modified: four leaves `src/telemetry.ts`, `src/__tests__/telemetry.export.test.ts`, new `telemetry.hostProvider.test.ts`; spec Steps 4-5 `**Status**` only.

### Session: Steps 6+7 (UI, sequential mode)
- RED (pass-through stub): B1, B2 and the new wire test (`metric datapoints carry host.provider…`) failed on assertions in `instrumentation.test.ts`, `instrumentation.encoded-header.test.ts` and `instrumentation.delta.test.ts`.
- GREEN: `withHostProvider` in `xstockstrat-ui/src/telemetry.ts` (sdk-metrics 2.x, same behaviour as the leaves); `initTelemetry` extracts `resource` and reads `host.provider` from it. `tsc`, `lint`, `lint:dup` (rc 0) and `test:coverage` (549 passed, 2 skipped = the delta case under the two non-delta files) pass.
- Deviation (@AC-18): the testkit asserts the exact wire key sets for the REST and Connect `http.server.duration` datapoints (`host.provider` plus the three existing keys) rather than a second `CollectingReader` provider — `bffAllowlist.test.ts` already pins the unlabelled key sets and was not edited.
- `defineExportSuite(headers, { delta })` gained an options bag so `instrumentation.delta.test.ts` can add the `@AC-14` case without a fourth server fixture.
- Files modified: `src/telemetry.ts`, `src/instrumentation.testkit.ts`, new `src/telemetry.hostProvider.test.ts`, `src/instrumentation.delta.test.ts`; spec Steps 6-7 `**Status**` only.

### Session: Steps 8-12 (Python, docs, guard; sequential mode)
- Steps 8+9 RED (pass-through stub): `tests/test_telemetry_host_provider.py` failed on assertions in all four services (B1 warn count 0, B2 kept `x`, label missing), and the extended `test_init_exports_metrics_and_logs_with_resource` failed on the protobuf datapoint (`{}` has no `host.provider`). GREEN: `_with_host_provider` (generic `dataclasses.replace` over the four data types, `_labelled` seam, per-instance warn-once, verbatim `force_flush`/`shutdown`) in analysis/ingest/indicators/agent; ruff clean; analysis full suite 1663 passed at 91.5% coverage.
- @AC-18 wire tests added to agent (`mcp.tool.duration` via `ToolMetricsMiddleware._record`, the seam `test_telemetry_allowlist.py` uses) and analysis (`record_live_loop_cycle_duration`); the in-memory side stays pinned by the unedited `test_live_loop_telemetry.py`.
- Step 10: `observability.md` now leads with the `otel-guard:host-provider-label` block, keeps the join block as fallback with `sum without (host_provider)` on the left operand, and carries the `@AC-20` sentence and open-risk bullet; dashboards README sentence replaced; no dashboard or alert JSON/YAML changed.
- Steps 11+12 RED (tests first, unchanged guard): 6 new cases failed (5 label/join mutations, `test_two_label_blocks_fail`); doc-contract extension passed (characterization). GREEN after the guard change: 82 passed, ruff clean, `check-otel-produced-signals.py` rc 0.
- Files modified: four Python `app/telemetry.py` + `tests/`, `docs/patterns/observability.md`, `packages/otel/dashboards/README.md`, `scripts/check-otel-produced-signals.py`, its test; spec Steps 8-12 `**Status**` only.

### Session: Step 13 (promotion, operator-confirmed)
- Operator confirmed the append plan ("Go for it"): 14 scenarios (`@AC-2`..`@AC-5`, `@AC-8`, `@AC-9`, `@AC-13`..`@AC-16`, `@AC-18`..`@AC-21`) appended to `docs/sdd/business-rules/platform.feature` tagged `@feature-337`; `@AC-12`, `@AC-17`, `@AC-22` not promoted.
- Five `# Feature 337` read-as comments: platform `@AC-41`, `@AC-10`, `@AC-12`; ui `@AC-36`; analysis `@AC-51`. No removed lines against the merge-base; tag-line count 14; comment count 5; guard rc 0.
- Python full suites (all green): analysis 1663 @ 91.5%, ingest 495 @ 86.6%, indicators 590 @ 87.4%, agent 760 @ 88.1%.

**Progress**: 13 done / 15 total
**Stopped at**: Step 13 committed (next: integration PR; Steps 14-15 post-deploy, operator-confirmed)
**Next**: integration PR into main-dev, CI watch
