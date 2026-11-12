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
- [ ] Integration append of `@AC-18..@AC-22`-derived scenarios plus four read-as comments, operator-confirmed (target: step 7 / final PR).

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
