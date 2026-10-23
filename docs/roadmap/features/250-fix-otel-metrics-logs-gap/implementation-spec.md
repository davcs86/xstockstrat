# Implementation Spec: fix-otel-metrics-logs-gap

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/250-fix-otel-metrics-logs-gap/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/fix-otel-metrics-logs-gap`

---

## Execution Summary

The fix narrows to traces, as design.md § Chosen Approach requires. No runtime, proto, migration, config-key
or collector-pipeline change (recon.md:86-90). The order follows design.md §8:

1. **Prerequisite P-1 is retired** (P-0 amendment, 2026-10-23). The follow-up is feature
   `274-otel-metrics-logs-export` (already on main-dev, `design-approved`), not a `trace-derived-alerting` story.
   Step 1 is a verification-only marker: it confirms that dir is on the 250 branch. No step PR targets main-dev
   (F-03, `docs/sdd/constitution.md:79`).
2. Steps 2-8 edit the Grafana assets, the docs and the constitution/findings files. They are `config`/`docs`
   steps, so TDD is N/A. Each one self-checks with the guard's own token regexes (grep), so the guard step does
   not hit residual drift late.
3. Step 9 runs the root `CLAUDE.md` Teardown.
4. Steps 10-11 are the red-before-green pair: the `.test.sh` with verbatim pre-fix fixtures, then the guard
   script. Step 12 wires the dedicated `otel-signals` CI job last. CI runs on every PR, step PRs included
   (`.github/workflows/ci.yml:3-4`), so a job wired earlier would fail every step PR until Step 8 lands.

**Pre-fix reference commit**: `06faaeb5` (`origin/feature/fix-otel-metrics-logs-gap` head at spec time; its
`packages/otel/` and FR-4 docs are the pre-fix tree). Step 10 extracts the verbatim fixtures with
`git show 06faaeb5:<path>` **once, at authoring time**, and commits them under `scripts/testdata/`. The
`.test.sh` and the guard never call `git` at runtime: feature PRs are squash-merged into main-dev (root
`CLAUDE.md` § Merge Strategy), so `06faaeb5` is unreachable there after merge.

**Consumer surface (C-14)**: None, internal/platform-only (product-spec.md § Consumer Surface(s);
recon.md:64). No UI segment or Agent tool step is needed. This is a recorded decision, not an omission.

**Case rule for the guard (spec-time refinement, design is silent)**:
- The word tokens (`loki|mimir|prometheus|promql|logql|all three signal`) and the generic tokens match
  case-insensitively.
- `DS_LOKI|DS_PROMETHEUS|rpc_server_duration|service_name[[:space:]]*=` and `P99` match case-sensitively.
- Reason: a case-insensitive `service_name=` would flag the env-var line `SERVICE_NAME=<service>`
  (`docs/setup/grafana-cloud.md:116`), which is a correct doc line. Step 10 adds a green case for it.

### Scenario Coverage (C-15)

| Scenario | Test step (`**Covers**`) | Steps that realize it |
|---|---|---|
| `@AC-1` alert rules query only produced series | 10, 11 | 2 |
| `@AC-2` dashboard queries target only produced series | 10, 11 | 4 |
| `@AC-3` observability docs list only exported signals | 10, 11 | 3, 5, 6, 7, 8 (and Step 1 for the cited follow-up) |

Business rules (C-16):
- `@AC-3 @feature-171` (`docs/sdd/business-rules/platform.feature:144-149`) is preserved by Step 5 and asserted by
  Step 10.
- The `@feature-226` rules are preserved because Steps 2-8 touch no runtime and no collector pipeline.
- At integration, `/sdd-execute` promotes `@AC-1..3 @feature-250` into `docs/sdd/business-rules/platform.feature`.
  `.feature` files stay outside the guard glob (design.md §4).

## Prerequisite (outside `/sdd-execute`)

### P-1 — Retired (P-0 amendment, 2026-10-23)

The `trace-derived-alerting` `/sdd-story` is not created. Feature 274 (`otel-metrics-logs-export`, operator
decision recorded in its `context.md` R1 gate) restores the removed alerts and dashboards by exporting metrics
and logs, so every follow-up citation in this spec points at
`docs/roadmap/features/274-otel-metrics-logs-export/`. 274's own story text carries the removed rule UIDs, the
`RunBacktest`/`ScoreStrategy` client-invoked caveat (`analysis.proto:13-14`) and the guard-relaxation note
(274 FR-3, FR-6).

## Step Dependencies

- Step 1 gates Steps 3, 6 and 8, which cite the follow-up dir (274), and Step 10, which asserts the dir exists
  on the branch. No operator prerequisite remains (P-1 retired).
- Step 3 requires Step 2: the README describes the new `alert-rules.yaml` and the deleted `mute-timings.yaml`.
- Step 5 requires Step 4: the README describes the outcome of the dashboard gate. On the fallback, the
  fence also lists `service-health.json`.
- Step 6 requires Steps 2 and 4: grafana-cloud.md Steps 6 and 7 mirror the asset outcome.
- Step 8 requires Steps 2 and 4: OTEL-1 is re-grounded on panel (c), or retired on the dashboard fallback.
- Step 9 requires Steps 2-8: Teardown audits every context file they touched.
- Step 10 [test] covers Step 11 [service] (C-08). Step 10 runs before Step 11 to capture RED.
- Step 11 requires Steps 1-9: its GREEN includes the guard exiting 0 on the real tree.
- Step 12 requires Step 11: the CI job runs the guard and the `.test.sh`.
- The rebase-only overlap with 084-droplet-compose-deploy on `docs/patterns/observability.md` is resolved at
  integration (recon.md:111).
- Trunk-launched 226-fix-otel-trace-export last edited the collector header block, `observability.md`,
  `grafana-cloud.md`, `packages/otel/CLAUDE.md:4`, the otel constitution and root findings `:17` (226
  `context.md:150`; collector header comment, 226 `implementation-spec.md:570`). Steps 5-8 re-edit that wording on top of it; BRANCH SYNC's main-dev merge keeps line cites
  current. Step 5 keeps the attribute bullet 226 preserved (226 `design.md:76`).
- Deferred capability: there is no paging for error rate, latency or analysis scoring until
  feature 274 restores them. That is acceptable only because 274 is reserved and cited (C-14 /
  design.md Open Risks).

---

### Step 1 — docs: Verify the 274 follow-up dir is on the 250 branch (marker)

**Status**: `pending`
**Service**: `docs/roadmap/features/` (read-only check on `feature/fix-otel-metrics-logs-gap`)
**Files**:
- None. Verification only.

**Reviewers**: none

**Codebase Evidence**:
- The follow-up is feature `274-otel-metrics-logs-export`, already on main-dev (P-1 retired by the P-0
  amendment). No step of this spec opens a main-dev PR (F-03, `docs/sdd/constitution.md:79`;
  `.claude/skills/sdd-execute/SKILL.md:470`).
- BRANCH SYNC merges `origin/main-dev` into the dev branch before each step (default modes) or once per feature
  (sequential): `.claude/skills/sdd-execute/templates/branch-sync.md:35`, so the dir is on the 250 branch with no
  step commit.

**TDD**: N/A (docs, verification-only marker)

**Covers**: —

**Instructions**:
1. If the Verification's commands print nothing, BRANCH SYNC has not brought the dir onto the 250 branch. Re-run
   BRANCH SYNC. Do not create the dir on the 250 branch.
2. Steps 3, 6 and 8 cite `docs/roadmap/features/274-otel-metrics-logs-export/` verbatim.

**Verification**:
```bash
git fetch origin
git ls-tree -d --name-only origin/main-dev docs/roadmap/features/ | grep -E '/274-otel-metrics-logs-export$'   # → one dir
test -f docs/roadmap/features/274-otel-metrics-logs-export/status.md && echo ok   # → ok (on the 250 branch, after BRANCH SYNC)
```

---

### Step 2 — config: Replace every alert rule with `deleteRules`/`deleteMuteTimes`; delete `mute-timings.yaml`

**Status**: `pending`
**Service**: `packages/otel` (alerts)
**Files**:
- `packages/otel/alerts/alert-rules.yaml` — modify (full rewrite)
- `packages/otel/alerts/mute-timings.yaml` — delete

**Reviewers**: Platform Lead — cross-service architecture, service registry consistency (observability contract;
`packages/otel` has no registry service owner)

**Codebase Evidence**:
- All three rules query unproduced series:
  - `alert-rules.yaml:44-45` and `:88` use `rpc_server_duration_milliseconds_*`;
  - `:129` and `:134` use `${DS_LOKI_UID}` / `{service_name="analysis"}` (recon.md:17-19).
- The header comment `:1-15` names `${DS_PROMETHEUS_UID}` and `${DS_LOKI_UID}` (`:8-9`). It must go, because
  those are Part 1 tokens.
- The rule UIDs are at `:26`, `:71` and `:116`. The top-level keys are `apiVersion: 1` at `:17` and `groups:` at
  `:19`.
- `mute-timings.yaml:3-5` names `xstk-analysis-no-scoring` as its only consumer, and `:18` is
  `name: outside-us-market-hours`. With that rule gone, the file is orphaned (recon.md:21, recon.md:61; C-10).
- The key names were verified at spec time with Context7 (`/websites/grafana_grafana`, Grafana "file
  provisioning" docs):

  ```yaml
  deleteRules:
    - orgId: 1
      uid: my_id_1
  ```

  ```yaml
  deleteMuteTimes:
    - orgId: 1
      name: mti_1
  ```

  Both are top-level keys next to `apiVersion: 1`.
- No other repo consumer exists outside docs. A grep for `mute-timings|alert-rules\.yaml|xstk-` over the repo,
  excluding `docs/roadmap/` and `docs/reports/`, hits only:
  - `packages/otel/alerts/README.md`;
  - `packages/otel/dashboards/README.md`;
  - `packages/otel/docs/context-constitution*.md`;
  - `docs/context-constitution-findings.md`;
  - `docs/setup/grafana-cloud.md`.

  Steps 3, 5, 6 and 8 handle them.

**TDD**: N/A (config: provisioning YAML, no executable logic. The AC-1 red/green proof lives in Steps 10-11.)

**Covers**: —

**Instructions**:
1. Rewrite `packages/otel/alerts/alert-rules.yaml` so it contains, in order:
   - A comment of 2 lines at most, with no Part 1 token, for example: `# No rule may target a metric or log
     datasource until a produced path is recorded.` / `# Follow-up: feature 274 (see README.md).`
   - `apiVersion: 1`.
   - `deleteRules:` with one `- orgId: 1` / `uid: <uid>` item each for `xstk-error-rate-high`,
     `xstk-p99-latency-high` and `xstk-analysis-no-scoring`.
   - `deleteMuteTimes:` with `- orgId: 1` / `name: outside-us-market-hours`.
   - No `groups:` key.
2. `git rm packages/otel/alerts/mute-timings.yaml`.
3. Optional live check, when Docker is available: provision both shapes into a throwaway
   `grafana/grafana` container (`/etc/grafana/provisioning/alerting/`):
   - first the pre-fix file from `git show 06faaeb5:packages/otel/alerts/alert-rules.yaml`, with the
     `${DS_*_UID}` placeholders replaced by dummy UIDs;
   - then the new file, after a restart.

   Confirm `GET /api/v1/provisioning/alert-rules` drops the three UIDs.

   **Fallback**: if Grafana rejects `deleteRules` or `deleteMuteTimes`, replace the body with
   `apiVersion: 1` / `groups: []` (design.md §1) and record a Deviation Log entry.

   If Docker is unavailable, record in `context.md` that the Context7 evidence above is the substitute and is
   "not a live-boot proof" (fails.md:682-684).

**Verification**:
```bash
test ! -e packages/otel/alerts/mute-timings.yaml
grep -n -E '^(apiVersion|deleteRules|deleteMuteTimes|groups):' packages/otel/alerts/alert-rules.yaml   # apiVersion + deleteRules + deleteMuteTimes; no groups (or groups: [] on fallback)
grep -c -E '^[[:space:]]+uid: xstk-(error-rate-high|p99-latency-high|analysis-no-scoring)$' packages/otel/alerts/alert-rules.yaml   # → 3
! grep -n -i -E 'prometheus|mimir|loki|promql|logql' packages/otel/alerts/alert-rules.yaml
! grep -n -E 'rpc_server_duration|service_name[[:space:]]*=' packages/otel/alerts/alert-rules.yaml
uv run --no-project --with pyyaml python3 -I -c "import yaml;d=yaml.safe_load(open('packages/otel/alerts/alert-rules.yaml'));assert d['apiVersion']==1 and 'groups' not in d or d['groups']==[]"
```

---

### Step 3 — docs: Rewrite `packages/otel/alerts/README.md` (no rules provisioned; fenced removals; follow-up cite)

**Status**: `pending`
**Service**: `packages/otel` (docs)
**Files**:
- `packages/otel/alerts/README.md` — modify (full rewrite)

**Reviewers**: none

**Codebase Evidence**:
- Every section of the current README is stale:
  - `:8` "Three alert rules" (P3-count);
  - `:9` `mute-timings.yaml`;
  - the rules table `:13-17`;
  - the placeholders `:23-26` (`${DS_PROMETHEUS_UID}` / `${DS_LOKI_UID}`, Part 2 SPECIFIC);
  - `:36-38` and the market-hours section `:40-46`, which name `outside-us-market-hours` and `mute-timings.yaml`.
- The notification-routing paragraph `:48-53` holds no stale claim and is kept.
- The fence grammar is in design.md §4 (Fence).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Keep the title `# xstockstrat Grafana Alert Rules` and the provenance line `:3-4`.
2. State that `alert-rules.yaml` provisions no rules and only deletes earlier ones. The reason: runtimes export
   traces only (feature 226 Operator Decision 3) and no produced series backs a rule (feature 250). Put the
   sanctioned literal on its own line, exactly: `Metrics and logs are not exported (feature 226).`
3. Add a manual-cleanup section. File-based provisioning applies `deleteRules`/`deleteMuteTimes`. Grafana
   Cloud users delete the listed items by hand under Alerting → Alert rules and Alerting → Notification
   policies → Mute timings. List them only inside the fence, one per line, exactly:

   ```
   <!-- otel-guard:removed-assets -->
   - `xstk-error-rate-high` — alert rule
   - `xstk-p99-latency-high` — alert rule
   - `xstk-analysis-no-scoring` — alert rule
   - `outside-us-market-hours` — mute timing
   - `mute-timings.yaml` — file
   <!-- /otel-guard:removed-assets -->
   ```

4. Cite the follow-up by path: `docs/roadmap/features/274-otel-metrics-logs-export/` (Step 1 confirms the dir). It restores
   error-rate, latency and analysis-scoring detection.
5. Keep `## Notification routing` (`:48-53`) unchanged.
6. Wording rule (design.md §3): never state a removed count in prose. Never name an xstk UID, the mute timing
   or a deleted file outside the fence.

**Verification**:
```bash
f=packages/otel/alerts/README.md
! grep -n -i -E 'loki|mimir|prometheus|promql|logql|all three signal' "$f"
! grep -n -E 'DS_LOKI|DS_PROMETHEUS|rpc_server_duration|service_name[[:space:]]*=|P99' "$f"
! grep -n -i -E '(one|two|three|four|five|six|[0-9]+)[[:space:]]+(V1[[:space:]]+)?(dashboards?|alert rules?)' "$f"
grep -c -F 'Metrics and logs are not exported (feature 226).' "$f"   # → 1
grep -n -E 'docs/roadmap/features/274-otel-metrics-logs-export/' "$f"
awk '/<!-- otel-guard:removed-assets -->/{i=1;next}/<!-- \/otel-guard:removed-assets -->/{i=0;next}!i' "$f" | grep -n -E 'xstk-|outside-us-market-hours|mute-timings\.yaml' && exit 1 || true
```

---

### Step 4 — config: Rewrite `service-health.json` as Tempo-only; delete the other three dashboards

**Status**: `pending`
**Service**: `packages/otel` (dashboards)
**Files**:
- `packages/otel/dashboards/service-health.json` — modify (full rewrite, keep `"uid": "xstk-service-health"`)
- `packages/otel/dashboards/signal-pipeline-throughput.json` — delete
- `packages/otel/dashboards/infrastructure.json` — delete
- `packages/otel/dashboards/trading-service.json` — delete

**Reviewers**: Platform Lead — cross-service architecture, service registry consistency (observability contract)

**Codebase Evidence**:
- `service-health.json` today:
  - `__inputs` `DS_PROMETHEUS` (`:4`) and `DS_LOKI` (`:12`);
  - datasource template vars `:28-41`;
  - the `$service` variable `:43-51`, whose query `:47` is
    `label_values(rpc_server_duration_milliseconds_count, service_name)`;
  - `"uid": "xstk-service-health"` at `:58`;
  - PromQL panels `:69`, `:96`, `:122` and a LogQL panel `:136` (recon.md:26).
- The other three files have no trace query to keep (recon.md:27-29). Each one's top-level uid is at `:47`.
- No Tempo/TraceQL query exists anywhere in `packages/otel/` (recon.md:98). The TraceQL syntax follows Grafana's
  Tempo docs (Context7 `/websites/grafana_grafana`), for example `{ resource.service.name = "$service" && status
  = error }` and `{ ... && duration > 2s }`.
- The exact panel `targets` JSON keys for a Tempo TraceQL table (`queryType`, `query`, `limit`) are **Not found**
  in the repo. They are proven only at the dev-import gate below.
- Server-streaming RPCs, which panel (b) excludes:
  - `marketdata.proto:14,17` `StreamBars`/`StreamQuotes`;
  - `ledger.proto:16,21` `StreamEvents`/`ExportEvents`;
  - `notify.proto:18` `StreamAlerts`;
  - `config.proto:20` `WatchConfig`;
  - `portfolio.proto:17` `StreamPortfolioUpdates`;
  - `trading.proto:15` `StreamOrderUpdates`.

  `(Watch|Stream|Export)[A-Za-z]*` matches all of them and no unary RPC.
- `analysis.proto:13-14` defines `RunBacktest` and `ScoreStrategy` (unary, client-invoked).
- `OTEL_ENABLED` is `"true"` in `.do/app.dev.yaml:31` and `"false"` in `.do/app.yaml:31` (recon.md:37), so only
  the dev stack (or local) can prove the import.

**TDD**: N/A (config: dashboard JSON, no executable logic. The AC-2 red/green proof lives in Steps 10-11.)

**Covers**: —

**Instructions**:
1. `git rm` `signal-pipeline-throughput.json`, `infrastructure.json` and `trading-service.json`.
2. Rewrite `service-health.json`:
   - `__inputs`: exactly one entry `{ "name": "DS_TEMPO", "label": "Tempo", "type": "datasource",
     "pluginId": "tempo", "pluginName": "Tempo" }`.
   - `templating.list`: exactly one datasource var `{ "name": "DS_TEMPO", "type": "datasource", "query":
     "tempo" }`. No `$service` variable.
   - Keep `"uid": "xstk-service-health"`, `"title": "xstockstrat — Service Health"` and `schemaVersion: 39`.
   - Use tags `["xstockstrat", "service-health", "tempo"]`.
   - Three `table` panels, each with `"datasource": { "type": "tempo", "uid": "${DS_TEMPO}" }` and one TraceQL
     target:
     - (a) title "Server error spans": `{ kind = server && status = error }`;
     - (b) title "slow server spans (>2s)", never "P99": `{ kind = server && duration > 2s && name !~
       ".*/(Watch|Stream|Export)[A-Za-z]*" }`;
     - (c) title "analysis scoring RPC activity": `{ resource.service.name = "analysis" && kind = server &&
       name =~ ".*/(RunBacktest|ScoreStrategy)" }`. Its description says it is not a stall signal, because
       both RPCs are client-invoked.
   - No string in the file may match Part 1:
     `prometheus|mimir|loki|promql|logql` (case-insensitive) or `rpc_server_duration|service_name[[:space:]]*=`.
3. **Dev-import gate.** Import the JSON into the `OTEL_ENABLED=true` dev Grafana stack (Dashboards → Import,
   bind DS_TEMPO). It passes when:
   - it imports without error;
   - each panel runs its query without a parse error;
   - panel (a) or (b) returns rows over a 24h window, or panel (c) returns rows after one `run_backtest` in dev.

   Record the outcome, with the span names seen, in `context.md`.
   - If the dev stack is unreachable from the execute environment: block the step and ask the operator to run
     the gate (P-03). Never assume a pass, and never take the fallback silently.
   - **Fallback**, if the gate fails: `git rm packages/otel/dashboards/service-health.json` as well. Record a
     Deviation Log entry. Steps 5, 6 and 8 then take their fallback branches.

**Verification**:
```bash
ls packages/otel/dashboards/   # README.md + service-health.json (fallback: README.md only)
f=packages/otel/dashboards/service-health.json
[ ! -e "$f" ] || {
  python3 -I -m json.tool "$f" >/dev/null &&
  ! grep -n -i -E 'prometheus|mimir|loki|promql|logql' "$f" &&
  ! grep -n -E 'rpc_server_duration|service_name[[:space:]]*=|P99' "$f" &&
  grep -c '"uid": "xstk-service-health"' "$f" &&
  grep -c '"type": "tempo"' "$f"
}
```
Plus the dev-import gate outcome recorded in `context.md`.

---

### Step 5 — docs: Rewrite `packages/otel/dashboards/README.md` to the Tempo dashboard (keep the attribute bullet)

**Status**: `pending`
**Service**: `packages/otel` (docs)
**Files**:
- `packages/otel/dashboards/README.md` — modify (full rewrite)

**Reviewers**: none

**Codebase Evidence**:
- Stale claims in the current README:
  - `:4-5` "V1 **metrics + logs** dashboards; … Tempo … out of scope";
  - the table `:7-12`, which lists four files and UIDs;
  - the datasource inputs `:16-26` (Prometheus/Loki, `${DS_PROMETHEUS}` / `${DS_LOKI}`);
  - the metric assumptions `:30-39` (`rpc_server_duration_milliseconds`);
  - the log-derived panels `:43-49`;
  - "the four dashboards" at `:54` (P3-count).
- The attribute bullet `:40-42` lists `service.name`, `deployment.environment` and `platform=xstockstrat`. It is
  guarded by `@AC-3 @feature-171` (`docs/sdd/business-rules/platform.feature:144-149`), so it must keep all three
  and must not list `trading_mode`.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Describe the single Tempo-backed `service-health.json` (uid `xstk-service-health`):
   - its three TraceQL panels, from Step 4;
   - import with one Tempo datasource input `DS_TEMPO`;
   - the sanctioned literal on its own line: `Metrics and logs are not exported (feature 226).`
2. Keep the attribute bullet, reworded to Tempo resource-attribute wording: "`service.name`,
   `deployment.environment`, `platform=xstockstrat` are attached by every service's telemetry module and are
   queryable in TraceQL as `resource.service.name`, `resource.deployment.environment`, `resource.platform`".
   No `trading_mode`, and no "`service_name` label" phrasing.
3. Fence the deleted dashboards for manual deletion in Grafana Cloud:

   ```
   <!-- otel-guard:removed-assets -->
   - `xstk-signal-pipeline` — dashboard
   - `xstk-infrastructure` — dashboard
   - `xstk-trading-service` — dashboard
   - `signal-pipeline-throughput.json` — file
   - `infrastructure.json` — file
   - `trading-service.json` — file
   <!-- /otel-guard:removed-assets -->
   ```

   **Fallback branch** (Step 4 took the fallback): there is no dashboard to describe. Also fence
   `xstk-service-health` — dashboard and `service-health.json` — file. The attribute bullet stays, framed as
   the attribute set for ad-hoc Tempo Explore queries.
4. Keep the `## Relationship to docs/setup/grafana-cloud.md` section, without any count.
5. Apply the wording rule (design.md §3).

**Verification**:
```bash
f=packages/otel/dashboards/README.md
! grep -n -i -E 'loki|mimir|prometheus|promql|logql|all three signal|metrics.{0,12}logs|logs.{0,12}metrics|log error|error logs' "$f" | grep -v -F 'Metrics and logs are not exported (feature 226).'
! grep -n -E 'DS_LOKI|DS_PROMETHEUS|rpc_server_duration|service_name|P99|trading_mode' "$f"
! grep -n -i -E '(one|two|three|four|five|six|[0-9]+)[[:space:]]+(V1[[:space:]]+)?(dashboards?|alert rules?)' "$f"
grep -c -E 'service\.name' "$f" && grep -c 'deployment.environment' "$f" && grep -c 'platform' "$f"
```

---

### Step 6 — docs: Correct `docs/setup/grafana-cloud.md` (traces only; fenced cleanup; follow-up cite)

**Status**: `pending`
**Service**: `docs/setup/`
**Files**:
- `docs/setup/grafana-cloud.md` — modify

**Reviewers**: none

**Codebase Evidence** (line-by-line, grep-confirmed 2026-10-21):
- `:3` "emits traces, metrics, and logs via OTLP".
- `:5` "The four V1 dashboards and the alert rules" (P3-count).
- `:21-24` the signal-types list (`**Metrics**` `:23`, `**Logs**` `:24`).
- `:108` "**Batches** spans/metrics/logs".
- Step 5 `:179-208`:
  - Tempo check `:183-189`, which is kept as the template (recon.md:60);
  - Loki check `:191-199`;
  - Prometheus/Mimir check `:201-208`.
- Step 6 `:212-246`:
  - `:214` "The four V1 dashboards";
  - table `:218-223`, with `P99` at `:220` and "error logs" at `:222-223`;
  - import datasources `:225-231`, with `${DS_PROMETHEUS}` / `${DS_LOKI}` at `:230`;
  - `:233-234` "V1 ships **metrics + logs** dashboards";
  - ad-hoc Loki query `:236-241`;
  - TraceQL example `:243-246` (`{ name = "PlaceOrder" }`).
- Step 7 `:250-268`:
  - table `:256-259`, naming the xstk UIDs and `mute-timings.yaml`;
  - Apply `:261-265`, with `${DS_PROMETHEUS_UID}` / `${DS_LOKI_UID}` and `outside-us-market-hours`;
  - routing `:267-268`, which is kept.
- Step 8 `:274` "querying by `service.name` or `service_name` in Grafana".
- Troubleshooting `:313-319` "Traces not correlating with logs" (Loki derived fields).
- `:116` `SERVICE_NAME=<service>` stays: it is an env var, and the case-sensitive rule keeps it green.
- The span name for `PlaceOrder` is `<package>.TradingService/PlaceOrder`
  (`packages/proto/trading/v1/trading.proto:3`, `:11`), so the TraceQL example becomes
  `{ name =~ ".*/PlaceOrder" }` (design.md §3).
- Correct, keep: `:183-189`, the OTLP/HTTP paragraph `:173`, and `:323`.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. `:3`: every deployable workload exports **traces** via OTLP/HTTP when `OTEL_ENABLED=true`. Put the sanctioned
   literal on its own line, exactly: `Metrics and logs are not exported (feature 226).` Scope by `OTEL_ENABLED`,
   never by environment name (design.md §3; fails.md:1562).
2. `:5`: name the checked-in Tempo dashboard and the alert-cleanup file without a count.
   **Fallback branch** (Step 4 deleted `service-health.json`): name only the alert-cleanup file and point to
   Tempo Explore. Do not mention a checked-in dashboard.
3. `:21-24`: keep only the **Traces** bullet.
4. `:108`: "**Batches** telemetry (10s window, …)", with no signal list.
5. Step 5: delete `### Check Logs (Loki)` (`:191-199`) and `### Check Metrics (Prometheus/Mimir)`
   (`:201-208`). Keep `### Check Traces (Tempo)`.
6. Step 6:
   - Rewrite `:214-234` to describe `service-health.json` (Tempo, uid `xstk-service-health`), its import with the
     `DS_TEMPO` input, and the `${DS_TEMPO}` provisioning variable.
   - Drop the "out of scope" Tempo note.
   - Delete the Loki block `:236-241`, and retitle the section "Ad-hoc Tempo queries".
   - Change the TraceQL example to `{ name =~ ".*/PlaceOrder" }`.
   - Fence the deleted dashboards: the same fenced lines as Step 5, uids and files.
   - **Fallback branch**: no dashboard is checked in, so point to Tempo Explore and also fence
     `xstk-service-health` / `service-health.json`.
7. Step 7:
   - State that no alert rules are provisioned, and that `alert-rules.yaml` only deletes the fenced ones.
   - Fence the alert UIDs, `outside-us-market-hours` — mute timing, and `mute-timings.yaml` — file, exactly as
     in Step 3.
   - Delete the DS-UID substitution and mute-timing attach text (`:261-265`).
   - Cite `docs/roadmap/features/274-otel-metrics-logs-export/` as the restoration path.
   - Keep the routing paragraph `:267-268`.
8. Step 8 `:274`: "querying by `resource.service.name` in Tempo".
9. Troubleshooting: delete `### Traces not correlating with logs` (`:313-319`).
10. Apply the wording rule throughout.

**Verification**:
```bash
f=docs/setup/grafana-cloud.md
! grep -n -i -E 'loki|mimir|prometheus|promql|logql|all three signal' "$f"
! grep -n -E 'DS_LOKI|DS_PROMETHEUS|rpc_server_duration|service_name[[:space:]]*=|P99' "$f"
! grep -n -i -E 'metrics.{0,12}logs|logs.{0,12}metrics|(traces|spans)[^.]{0,15}metrics|\*\*(metrics|logs)\*\*|log error|error logs' "$f" | grep -v -F 'Metrics and logs are not exported (feature 226).'
! grep -n -i -E '(one|two|three|four|five|six|[0-9]+)[[:space:]]+(V1[[:space:]]+)?(dashboards?|alert rules?)' "$f"
grep -c -F 'Metrics and logs are not exported (feature 226).' "$f"   # → 1
grep -n -E 'docs/roadmap/features/274-otel-metrics-logs-export/' "$f"
grep -n -F '.*/PlaceOrder' "$f"
```

---

### Step 7 — docs: Correct the remaining FR-4 one-liners (pattern doc, setup index, launch PDF source, otel CLAUDE.md, collector comments, setup-env)

**Status**: `pending`
**Service**: docs + `packages/otel` (comments only) + `scripts/` (one `info` string)
**Files**:
- `docs/patterns/observability.md` — modify (`:3`)
- `docs/setup/CLAUDE.md` — modify (`:10`)
- `docs/launch-pdfs/product-features.md` — modify (`:192`, `:198`)
- `packages/otel/CLAUDE.md` — modify (`:4`)
- `packages/otel/otel-collector-config.yaml` — modify (comments `:9`, `:35`, `:49` only)
- `scripts/setup-env.sh` — modify (`:213` string only)

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/observability.md:3`: "Grafana Cloud (Loki + Mimir + Tempo)". The rest of the file is
  trace-only, per `:9`. Grep for `metric|log|loki|tempo|signal` hits only `:3` and `:9`.
- `docs/setup/CLAUDE.md:10`: "verify traces/metrics/logs arrive, set up dashboards and alert rules".
- `docs/launch-pdfs/product-features.md:192`: "exports OTLP traces, metrics, and logs".
  - The sibling `product-features.pdf` is a rendered copy.
  - No in-repo generator exists: a grep for `launch-pdfs` over `*.sh`/`*.yml`/`*.json` outside `docs/roadmap/`
    finds nothing.
  - The PDF is not regenerated here. Note that in the PR body.
  - `:198` "Configured dashboards: trade flow (order → fill → ledger event), config stream health, indicator
    latency percentiles, alert delivery latency" names dashboards that no checked-in JSON provides after Step 4.
    It is an FR-4 instance (a doc naming dashboards backed by unproduced series) that the guard cannot see, so
    it is fixed here by hand.
  - Out of scope: `:312` describes what feature `033-phase7-observability` delivered at the time. It is a
    historical record, not a claim about the current tree.
- `packages/otel/CLAUDE.md:4`, inside the context-forge constitution-pointer block `:3-5`, names:
  - "the `rpc_server_duration_milliseconds` metric-name contract", which OTEL-2 retires in Step 8;
  - "defects (manual `DS_*_UID` substitution)". That findings row is already retired
    (`packages/otel/docs/context-constitution-findings.md:17`), and no DS substitution remains after Step 2.
- `packages/otel/CLAUDE.md:7-8` "alert rules, mute timings, dashboards" is stale after Step 2. It is a plural
  noun list with no count.
- `packages/otel/otel-collector-config.yaml`, which stays a Part 2 file:
  - `:9` "Exports all three signal types (logs, metrics, traces)";
  - `:35` "Drop spans/metrics/logs when memory exceeds limit";
  - `:49` "handles logs, metrics, and traces in one endpoint".
  - The pipelines `:74-87` are not touched (feature 226 `design.md:24`, `:38`; `@AC-4 @feature-226`).
- `scripts/setup-env.sh:213` reads `info "If you want to enable observability (traces, metrics, logs):"`.
  `docker-compose.yml:50` "fan-out gateway for logs, metrics, traces" stays: the collector really has the
  three pipelines (design.md §3).
- Scope vs product-spec: Fix Scope (`product-spec.md:113-114`) names `:9` as the only collector edit. The `:35`
  and `:49` comments and `scripts/setup-env.sh:213` extend it under FR-4's "any other doc" rule, as design.md
  §3 (`design.md:81`, `:83`) records. All are comment or string edits: still no pipeline, receiver or env
  change. The reconciliation is recorded in `context.md` (sdd-review impl-spec session).
- Out of scope, do not fold in: `otel-collector-config.yaml:13-15` (separate defect, recon.md:110) and
  `observability.md:7` `platform.otel.enabled` (a separate root findings row).

**TDD**: N/A (docs/comments; `setup-env.sh` changes a string literal only)

**Covers**: —

**Instructions**:
1. `observability.md:3`: "**Stack**: OpenTelemetry SDK (per-language) → OTLP/HTTP push (traces) → Grafana Cloud
   Tempo". Add a separate line with the sanctioned literal `Metrics and logs are not exported (feature 226).`
   Rebase-only overlap with 084.
2. `docs/setup/CLAUDE.md:10`: "… verify traces arrive (Tempo), import the Tempo dashboard and clean up retired
   alert rules". Keep the table row shape (markdown-lint job, `ci.yml:691-705`). **Fallback branch** (no
   dashboard): "… verify traces arrive (Tempo), query them in Tempo Explore and clean up retired alert rules".
3. `product-features.md:192`: "OpenTelemetry SDK in every service exports OTLP traces to Grafana Cloud (or any
   OTLP receiver) when `OTEL_ENABLED=true`." Add the sanctioned literal as its own line. Leave `:194`
   ("Distributed traces span all 15 services") alone, since it is outside the FR-4 claim.
   `:198` → "Checked-in dashboard: `service-health.json` (Tempo): server error spans, slow server spans, analysis
   scoring RPC activity." State no count (wording rule). **Fallback branch** (no dashboard): delete `:198`.
4. `packages/otel/CLAUDE.md`:
   - `:4`: keep the pointer markers. The invariants become "alerts/dashboards key on the **short**
     `service.name` (OTEL-1), and the env-only OTLP/HTTP export rule `PLAT-3`". The defects become "collector
     headers comment".
   - `:7-8`: "checked-in Grafana provisioning (a Tempo dashboard and an alert-rule cleanup file)". On the
     dashboard fallback, use "(an alert-rule cleanup file)" instead.
5. Collector comments, comments only:
   - `:9` → `# Exports traces to Grafana Cloud via OTLP; the other pipelines below receive nothing.` on one line,
     then a second line `# Metrics and logs are not exported (feature 226).` Do not write "metrics/logs": it
     matches the generic token `metrics.{0,12}logs`.
   - `:35` → `# Drop telemetry when memory exceeds limit — prevents OOM in dev`.
   - `:49` → `# Grafana Cloud OTLP gateway — one endpoint for every OTLP signal the services send.`
6. `scripts/setup-env.sh:213`: `info "If you want to enable observability (traces):"`.

**Verification**:
```bash
for f in docs/patterns/observability.md docs/setup/CLAUDE.md docs/launch-pdfs/product-features.md packages/otel/CLAUDE.md packages/otel/otel-collector-config.yaml; do
  grep -n -i -E 'loki|mimir|prometheus|promql|logql|all three signal|metrics.{0,12}logs|logs.{0,12}metrics|(traces|spans)[^.]{0,15}metrics|\*\*(metrics|logs)\*\*|log error|error logs' "$f" | grep -v -F 'Metrics and logs are not exported (feature 226).' && echo "HIT $f"
  grep -n -E 'DS_LOKI|DS_PROMETHEUS|rpc_server_duration|service_name[[:space:]]*=|P99' "$f" && echo "HIT $f"
done   # → no HIT lines
git diff -U0 06faaeb5 -- packages/otel/otel-collector-config.yaml | grep -E '^[-+]' | grep -v -E '^(---|\+\+\+) ' | grep -v -E '^[-+][[:space:]]*(#|$)' && echo "NON-COMMENT CHANGE" || true   # → nothing (YAML list items like `- otlp` still count as non-comment)
! grep -n -E 'config stream health|indicator latency percentiles|alert delivery latency' docs/launch-pdfs/product-features.md
grep -n 'observability (traces)' scripts/setup-env.sh
shellcheck scripts/setup-env.sh && shfmt -d -i 2 scripts/setup-env.sh
```

---

### Step 8 — docs: Re-ground OTEL-1, retire OTEL-2, NARROW the findings rows

**Status**: `pending`
**Service**: `packages/otel` (constitution) + root findings
**Files**:
- `packages/otel/docs/context-constitution.md` — modify
- `packages/otel/docs/context-constitution-findings.md` — modify
- `docs/context-constitution-findings.md` — modify (row `:18`)

**Reviewers**: none

**Codebase Evidence**:
- `packages/otel/docs/context-constitution.md`:
  - `:16` OTEL-1 has two pieces of evidence. The first is `alerts/alert-rules.yaml#{service_name="analysis"}
    (~L134)`, which is removed in Step 2 (recon.md:106). It is also a Part 2 SPECIFIC hit
    (`service_name[[:space:]]*=`). The second is `dashboards/README.md#Grafana Cloud promotes (~L42)`, which is
    reworded in Step 5.
  - `:17` OTEL-2 is the `rpc_server_duration_milliseconds` contract.
  - `:29` is a pointer to `alerts/mute-timings.yaml`, deleted in Step 2 (P3-file).
  - `:9` reads "chiefly the alert/dashboard metric contracts".
- `packages/otel/docs/context-constitution-findings.md`:
  - `:13` is the "Latent bug?" open question, with `rpc_server_duration_milliseconds`.
  - `:17` is a Resolved row naming `${DS_PROMETHEUS_UID}`/`${DS_LOKI_UID}` (Part 2 SPECIFIC).
  - `:22-23` is the lifecycle rule: "A row stays here until its report is resolved".
  - `:28` is the table row naming `2026-10-19-otel-metrics-logs-never-exported-defect` ("metrics or logs" is
    a generic hit).
- `docs/context-constitution-findings.md:18` names `rpc_server_duration_milliseconds` and Loki
  `{service_name=…}` (Part 2 SPECIFIC).
- NARROW convention: narrow the row in place and cite the feature; never delete silently (226 `design.md:24`,
  recon.md:62).
- The exemption is keyed on the basename `otel-metrics-logs-never-exported-defect`, which works even after
  `/sdd-archiver` prunes the report (design.md §4 Allowlist).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. OTEL-1 (`:16`):
   - Rule: alert and dashboard queries address a service by its **short** `service.name` (`analysis`), never
     the container name.
   - Why: in TraceQL a container-name filter matches no span.
   - Evidence and example: `dashboards/service-health.json#resource.service.name = "analysis"` (panel (c),
     Step 4).
   - **Fallback branch** (no dashboard): retire OTEL-1, the same way as OTEL-2.
2. OTEL-2 (`:17`): retire it. Replace the row with a one-line retired marker that cites feature 250 and the
   basename `otel-metrics-logs-never-exported-defect`. The marker text must not contain
   `rpc_server_duration`; the guard exemption covers only the findings files.
3. `:29`: repoint to `alerts/README.md`, `dashboards/README.md`. Drop `alerts/mute-timings.yaml`.
4. `:9`: drop "chiefly the alert/dashboard metric contracts", in favor of "the short-`service.name` addressing
   rule".
5. In `packages/otel/docs/context-constitution-findings.md`:
   - NARROW `:13` and `:17` by content: rewrite each so that any remaining Part 2 token sits on a line that
     carries `otel-metrics-logs-never-exported-defect`, with resolution "narrowed to traces by feature 250".
   - Move the `:28` row out of "Filed as defect reports" into `## Resolved`, keeping the basename, per that
     file's `:22-23` rule.
   - Cite `docs/roadmap/features/274-otel-metrics-logs-export/` in the narrowed `:13` text.
6. Root `docs/context-constitution-findings.md:18`: NARROW in place. Mark it **NARROWED (feature 250)**, carry
   the basename `otel-metrics-logs-never-exported-defect`, state "alerts/dashboards narrowed to traces; docs
   corrected", and cite `docs/roadmap/features/274-otel-metrics-logs-export/`. These are the 4 follow-up cites
   design.md §6 requires: alerts/README, grafana-cloud Step 7, and the root and otel findings.
7. Wording rule (design.md §3), in every file this step edits, including the NARROWed findings text: never
   state a removed count in prose, and never name an xstk UID, `outside-us-market-hours` or a deleted file
   (`mute-timings.yaml`, the deleted dashboard JSONs). The guard's P3-name scans all three files, and P3-file
   scans the two under `packages/otel/`.

**Verification**:
```bash
c=packages/otel/docs/context-constitution.md
! grep -n -E 'rpc_server_duration|service_name[[:space:]]*=|DS_LOKI|DS_PROMETHEUS|mute-timings' "$c"
! grep -n -i -E 'loki|mimir|prometheus|promql|logql' "$c"
for f in packages/otel/docs/context-constitution-findings.md docs/context-constitution-findings.md; do
  grep -n -i -E 'loki|mimir|prometheus|promql|logql|rpc_server_duration|service_name[[:space:]]*=|DS_LOKI|DS_PROMETHEUS' "$f" | grep -v 'otel-metrics-logs-never-exported-defect' && echo "UNEXEMPT $f"
  grep -c 'otel-metrics-logs-never-exported-defect' "$f"
done   # → no UNEXEMPT lines; each count ≥ 1
! grep -n -E 'xstk-(error-rate-high|p99-latency-high|analysis-no-scoring|signal-pipeline|infrastructure|trading-service)|outside-us-market-hours|mute-timings\.yaml' "$c" packages/otel/docs/context-constitution-findings.md docs/context-constitution-findings.md   # wording rule
grep -l -E 'docs/roadmap/features/274-otel-metrics-logs-export/' packages/otel/alerts/README.md docs/setup/grafana-cloud.md packages/otel/docs/context-constitution-findings.md docs/context-constitution-findings.md | wc -l   # → 4
```

---

### Step 9 — docs: Teardown, the context-constitution refresh over the touched context files

**Status**: `pending`
**Service**: context files touched in Steps 3-8
**Files**:
- `packages/otel/CLAUDE.md` — modify (only if the refresh reports grounded drift)
- `docs/setup/CLAUDE.md` — modify (same)
- `packages/otel/docs/context-constitution.md` — modify (same)
- `packages/otel/docs/context-constitution-findings.md` — modify (same)
- `docs/context-constitution-findings.md` — modify (same)

**Reviewers**: none

**Codebase Evidence**:
- Root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh`, scoped to what was touched,
  as the last step before pushing. If the plugin is unavailable, a manual re-read and reconciliation is
  recorded in the PR body. A bare note does not pass (fails.md:671-674).
- `.agents/context-forge.json`: `scrubberExtraTargets` is `["README.md", "docs/patterns/ui-ux-governance.md"]`.
  Neither is touched here.
- At spec time, the session's skill list carries `context-forge:context-scrubber` but not
  `context-constitution`, so availability must be checked at execute.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Run `/context-forge:context-constitution refresh`, scoped to `packages/otel` and the root findings, and fix the
   grounded drift it reports.
2. If the plugin is unavailable, re-read every file in **Files** against the post-Step-8 tree:
   `alert-rules.yaml`, `service-health.json`, both READMEs and `grafana-cloud.md`. Reconcile the drift, and
   record in the PR body and `context.md` both "plugin unavailable" and each reconciliation made, or "none
   needed" per file.
3. Re-apply the wording rule and the sanctioned literal to any refresh rewording. The Step 11 guard is the
   final check.
4. If the refresh reports grounded drift in a file outside **Files** (for example root
   `docs/context-constitution.md` or another module's constitution), do not stage it (F-08). Stop and escalate
   it via the `/sdd-execute` gap protocol, and record a Deviation Log entry with the operator's decision.
5. Record in `context.md` a `Teardown` line for each file in **Files**: `<path>: reconciled (<what>)` or
   `<path>: none needed`. Add the refresh's report summary, or the words `plugin unavailable`.

**Verification**:
```bash
c=docs/roadmap/features/250-fix-otel-metrics-logs-gap/context.md
grep -n -E 'Teardown|context-constitution refresh|plugin unavailable' "$c"
for p in packages/otel/CLAUDE.md docs/setup/CLAUDE.md packages/otel/docs/context-constitution.md packages/otel/docs/context-constitution-findings.md docs/context-constitution-findings.md; do
  grep -q -F "$p: " "$c" || echo "NO TEARDOWN LINE $p"
done   # → nothing
markdownlint-cli2 --config .markdownlint.yaml packages/otel/CLAUDE.md docs/setup/CLAUDE.md   # if installed; CI job markdown-lint covers **/CLAUDE.md
```

---

### Step 10 — test: `scripts/check-otel-produced-signals.test.sh` with verbatim pre-fix fixtures (RED)

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/check-otel-produced-signals.test.sh` — create
- `scripts/testdata/otel-produced-signals/alert-rules.prefix.yaml` — create
- `scripts/testdata/otel-produced-signals/service-health.prefix.json` — create
- `scripts/testdata/otel-produced-signals/fr4.prefix.tsv` — create

**Reviewers**: Platform Lead — cross-service architecture (observability contract; CI guard)

**Codebase Evidence**:
- Shape: `scripts/check-migration-contract.test.sh:1-29`:
  - `#!/usr/bin/env bash`, `set -uo pipefail` `:4`;
  - `REPO_ROOT` `:6`, `CHECK=` `:7`;
  - `fail()` `:8-11`, `[ -f "$CHECK" ] || fail` `:13`;
  - `mktemp -d` + `trap 'rm -rf …' EXIT` `:15-16`.
- `scripts/testdata/` does not exist (`ls scripts/testdata` → no such dir). jscpd ignores `**/testdata/**`
  (`.jscpd.json`), and lint-staged formats only `services/xstockstrat-ui/**` (`package.json:17-19`), so the
  fixtures stay verbatim.
- Fixture sources (verbatim pre-fix), extracted once at authoring time and committed:
  `git show 06faaeb5:packages/otel/alerts/alert-rules.yaml` and
  `git show 06faaeb5:packages/otel/dashboards/service-health.json`.
- The `fr4.prefix.tsv` rows are the pre-fix lines cited in Steps 3, 5, 6, 7 and 8 (Codebase Evidence), taken
  from `06faaeb5`, including root `docs/context-constitution-findings.md:18`. design.md §5 sizes them at 14 Part
  2/Part 3 rows + 8 FR-4 signal rows; one row per cite is the floor.
- `fail()` in `check-migration-contract.test.sh:8-11` exits on the first failure. A per-AC RED needs every case
  to run, so this test records failures and exits once at the end.
- The C-16 target is `docs/sdd/business-rules/platform.feature:144-149`.
- C-13: the fixtures have a single consumer, this test, so no inventory entry is needed
  (`docs/patterns/test-data-inventory.md`).
- bash 3.2: no `mapfile`, no `declare -A`, no `${var,,}`. `${arr[@]+"${arr[@]}"}` guards go under `set -u`.

**TDD**: red-green required. RED is captured before Step 11 in two runs:
- (i) guard absent: the test fails at its `CHECK` existence assertion (rc=1). This proves only that the guard is
  missing.
- (ii) per-AC RED: a throwaway stub guard `#!/usr/bin/env bash` / `exit 0` at
  `scripts/check-otel-produced-signals.sh`. It is never staged, and is deleted before the Step 10 commit. Against
  it every green case passes and every red case fails: AC-1 red, AC-2 red, each AC-3 tsv row, the fence, strip,
  count and multi-tag cases.

GREEN comes at Step 11.

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. Write the fixtures from `06faaeb5` as above. `fr4.prefix.tsv` has tab-separated columns:
   `cite-id<TAB>tag<TAB>relpath<TAB>verbatim line`. `tag` is one of `P2-specific`, `P2-generic`, `P3-name`,
   `P3-file` or `P3-count`.
   The test never calls `git`. Every pre-fix text it needs lives in these committed fixtures.
2. Failure handling: `case_fail()` prints `CASE FAIL <case-id>: <reason>` and increments a counter. It does not
   exit. Only the `CHECK` existence check exits at once. At the end the test prints `cases=<run> failed=<n>` and
   exits 1 if `n > 0` or `run = 0`.
3. Test setup: `work=$(mktemp -d)`, then `cp -R` `packages/otel`, `docs/setup`, `docs/patterns`,
   `docs/launch-pdfs`, `.do`, `docs/context-constitution-findings.md` and
   `docs/sdd/business-rules/platform.feature` into `$work`, preserving relpaths. Run
   `bash "$CHECK" "$work" 2>"$work.err"`. Each case resets the copy.
4. Cases. Each case asserts the exit code and greps `$work.err` for the expected
   `AC-n <tag> <relpath>:` prefix:
   - **green**: the fixed tree exits 0. Then check that `SERVICE_NAME=<service>` in
     `docs/setup/grafana-cloud.md` (env-var line, case rule) is not reported.
   - **AC-1 red**: copy `alert-rules.prefix.yaml` over `packages/otel/alerts/alert-rules.yaml`. Expect exit 1 and
     `AC-1 P1 packages/otel/alerts/alert-rules.yaml:`.
   - **AC-2 red**: copy `service-health.prefix.json` into `packages/otel/dashboards/`. Expect exit 1 and
     `AC-2 P1`.
   - **AC-3 per cite**: for each tsv row, append the verbatim line to `relpath` and expect exit 1 with
     `AC-3 <tag> <relpath>:`. A row that does not trip fails the test and prints the `cite-id`.
   - **Root findings `:18` red/green pair**:
     - the pre-fix row, read from its `fr4.prefix.tsv` row (no basename), trips `AC-3 P2-specific`;
     - the real NARROWed row, which carries `otel-metrics-logs-never-exported-defect`, is green.
   - **otel findings by content**: `grep -q otel-metrics-logs-never-exported-defect`. No line-number pin
     (fails.md:1293-1301).
   - **Multi-tag line**: append the pre-fix `docs/setup/grafana-cloud.md:258` row (it carries `P99` and the
     three xstk rule UIDs). Expect both `AC-3 P2-generic` and `AC-3 P3-name` for that one line. Also append
     to the same file one line with an xstk rule UID and `mute-timings.yaml`, and expect both `P3-name` and
     `P3-file`. The
     guard must not stop at the first tag.
   - **Strip case**: an appended recased copy, `metrics and logs are not exported (feature 226).`, trips
     `P2-generic`. The exact literal does not.
   - **Fence cases**:
     - a fenced `` - `xstk-error-rate-high` — alert rule `` passes, and the same line unfenced trips `P3-name`;
     - prose inside a fence trips `P3-fence`;
     - an unclosed fence trips `P3-fence`;
     - a fenced `` - `service-health.json` — file `` trips `P3-fence`, because the file still exists;
     - one fenced line using the ASCII `-` separator passes.
   - **Comment-only existence**: append `# removed xstk-error-rate-high` to `alert-rules.yaml`, plus an
     unfenced doc mention of `xstk-error-rate-high`. It still trips `P3-name`.
   - **Removal prose**: append "Delete the three alert rules below" to `packages/otel/alerts/README.md`. It
     trips `P3-count`.
   - **Fallback tree**: `rm` `dashboards/*.json` (count 0). With `xstk-service-health` fenced in
     `dashboards/README.md`, the tree is green. With the fence lines removed, it trips `P3-name`.
   - **C-16**: `packages/otel/dashboards/README.md` contains `service.name`, `deployment.environment` and
     `platform`, and does not contain `trading_mode`.
   - **Follow-up citation**: extract `docs/roadmap/features/274-otel-metrics-logs-export/` from
     `packages/otel/alerts/README.md`, `docs/setup/grafana-cloud.md` and both findings files. All 4 must be
     present and identical, and `"$REPO_ROOT/<that dir>"` must exist.
   - **Defect report independence**: delete `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`
     from a copy, if it was copied. The tree stays green.
   - **`.feature` exclusion**: `platform.feature` containing "Loki" does not trip.
5. Before Step 11 exists, run both RED runs (TDD above) and capture their output in `context.md` and the PR
   body. Run (ii) must list `CASE FAIL` for each red case, named by AC-1/AC-2/AC-3. Delete the stub before
   staging.

**Verification** (RED now; the same command is Step 11's GREEN):
```bash
bash scripts/check-otel-produced-signals.test.sh; echo "rc=$?"   # RED (i): rc=1, "ASSERT FAIL: scripts/check-otel-produced-signals.sh missing"
printf '#!/usr/bin/env bash\nexit 0\n' >scripts/check-otel-produced-signals.sh
bash scripts/check-otel-produced-signals.test.sh 2>&1 | grep -E 'CASE FAIL|cases='; rm scripts/check-otel-produced-signals.sh   # RED (ii): one CASE FAIL per red case, no green case fails
test ! -e scripts/check-otel-produced-signals.sh   # stub never staged
shellcheck scripts/check-otel-produced-signals.test.sh && shfmt -d -i 2 scripts/check-otel-produced-signals.test.sh
grep -rln 'otel-produced-signals' scripts/*.sh   # C-13: only the test (and, after Step 11, the guard's usage line)
! grep -n -E '(^|[^-[:alnum:]_])git[[:space:]]' scripts/check-otel-produced-signals.test.sh   # no runtime git
```
No coverage threshold applies to bash. The fixture-backed cases are the coverage.

---

### Step 11 — service: `scripts/check-otel-produced-signals.sh [ROOT]`, the produced-set guard (GREEN)

**Status**: `pending`
**Service**: `scripts/`
**Files**:
- `scripts/check-otel-produced-signals.sh` — create

**Reviewers**: Platform Lead — cross-service architecture (observability contract; CI guard)

**Codebase Evidence**:
- No home exists today: recon.md:101 found no script, CI job, promtool, jsonschema or yamllint over the alert and
  dashboard files.
- Portability precedent: `scripts/check-context-map.sh:11` ("macOS bash 3.2 + BSD/GNU compatible (grep -oE
  only…)"), `set -euo pipefail` `:13`, and `REPO_ROOT` resolution `:15-16`.
- Lint gate: `shellcheck scripts/*.sh` and `shfmt -d -i 2 scripts/*.sh` (`.github/workflows/ci.yml:621-626`).
- The spec is design.md §4: Parts 1-3, the fence, the allowlist, and the case rule in § Execution Summary.

**TDD**: red-green required (GREEN for the Step 10 RED)

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. Header: `#!/usr/bin/env bash` and `set -euo pipefail`. `ROOT="${1:-$(repo root)}"`. Use `shopt -s nullglob`
   or `[ -e ]` guards on every glob. bash 3.2 and BSD/GNU only: `grep -E`/`grep -iE`, portable `awk`, no
   `mapfile` or associative arrays.
2. Each hit prints `AC-n <tag> <relpath>:<line>: <text>` to stderr. A line that matches several tags prints one
   hit per tag: every Part and tag is checked on every line, with no early exit. The exit code is 1 when there
   is any hit, and 0 otherwise.
3. **Part 1**: scan `packages/otel/alerts/*.yaml` → `AC-1 P1`, and `packages/otel/dashboards/*.json` →
   `AC-2 P1`. Case-insensitive `prometheus|mimir|loki|promql|logql`, plus case-sensitive
   `rpc_server_duration|service_name[[:space:]]*=`.
4. **Part 2** (implement as specified; scheduled for retirement in feature 274 PR-B, operator C-16 CHANGE
   sign-off in 274 `context.md` R1 gate):
   - SCOPE is `*.md`, `*.yaml` and `*.yml` under `docs/` and `packages/otel/`. It excludes `docs/roadmap/`,
     `docs/reports/`, the Part 1 files and `*.feature`.
   - GEN_SCOPE is the intersection of SCOPE with these files: `docs/setup/grafana-cloud.md`,
     `docs/setup/CLAUDE.md`, `docs/patterns/observability.md`, `docs/launch-pdfs/product-features.md`, and
     everything under `packages/otel/`.
   - SPECIFIC tokens over SCOPE → `AC-3 P2-specific`. Case-insensitive
     `loki|mimir|prometheus|promql|logql|all three signal`, plus case-sensitive
     `DS_LOKI|DS_PROMETHEUS|rpc_server_duration|service_name[[:space:]]*=`.
   - GENERIC tokens over GEN_SCOPE → `AC-3 P2-generic`. Case-insensitive
     `metrics.{0,12}logs|logs.{0,12}metrics|(traces|spans)[^.]{0,15}metrics|\*\*(metrics|logs)\*\*|log error|error logs`,
     plus case-sensitive `P99`.
   - Allowlist:
     - before matching, strip the case-exact sanctioned literal with
       `line=${line//"Metrics and logs are not exported (feature 226)."/}`;
     - exempt whole lines carrying `otel-metrics-logs-never-exported-defect`, only in
       `docs/context-constitution-findings.md` and `packages/otel/docs/context-constitution-findings.md`.
5. **Part 3** (C-10):
   - Existence set, from value lines only:
     - in `alerts/*.yaml`, `^[[:space:]]*- uid:` and `^[[:space:]]*name:` values inside top-level sections whose
       key does not start with `delete`. An awk filter tracks the current top-level key `k` and skips lines while
       `k` is empty;
     - top-level `"uid":` values in `dashboards/*.json`;
     - the `find "$ROOT/packages/otel" -type f` paths.
   - P3-name over SCOPE: every `xstk-[a-z0-9]+(-[a-z0-9]+)*|outside-us-market-hours` token must be in the set.
   - P3-file over GEN_SCOPE: resolve each path-form or bare `*.json`/`*.yaml` token in this order:
     1. strip a leading `packages/otel/`;
     2. try `$ROOT/<tok>`;
     3. try `$ROOT/packages/otel/<tok>`;
     4. bare names go through `find "$ROOT/packages/otel" -name`.
   - P3-count over GEN_SCOPE: case-insensitive
     `(one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+)[[:space:]]+(V1[[:space:]]+)?(dashboards?|alert rules?)`.
     The number must equal the real count: dashboards = the number of `dashboards/*.json`; rules = the number of
     `- uid:` value lines in non-delete sections.
   - **Fence**: lines between `<!-- otel-guard:removed-assets -->` and `<!-- /otel-guard:removed-assets -->`
     are exempt from Part 3 only. Part 2 still scans them.
     - Every non-blank fenced line must match
       ``^- `(xstk-[a-z0-9-]+|outside-us-market-hours|[a-z0-9-]+\.(json|yaml))`( — | - |: )(alert rule|mute timing|dashboard|file)$``.
     - A fenced token must NOT be in the existence set.
     - An unclosed or nested fence is a hit.
     - All fence failures → `AC-3 P3-fence`.
6. No PromQL or LogQL parsing (YAGNI while the produced set is empty; design.md Rejected Alternatives).

**Verification** (GREEN):
```bash
bash scripts/check-otel-produced-signals.sh; echo "rc=$?"          # → rc=0 on the real tree
bash scripts/check-otel-produced-signals.test.sh; echo "rc=$?"     # → rc=0, every case executed (print a case count; confirm it is non-zero — fails.md 2026-07-29/074)
shellcheck scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
shfmt -d -i 2 scripts/check-otel-produced-signals.sh scripts/check-otel-produced-signals.test.sh
bash -n scripts/check-otel-produced-signals.sh   # if /bin/bash 3.2 is available (macOS), also: /bin/bash scripts/check-otel-produced-signals.test.sh
```
No coverage threshold applies to bash. The fixture-backed cases are the coverage.

---

### Step 12 — config: Add the dedicated `otel-signals` CI job and wire it into `ci-gate`

**Status**: `pending`
**Service**: `.github/workflows/`
**Files**:
- `.github/workflows/ci.yml` — modify
- `docs/patterns/ci-overview.md` — modify (one `## CI Jobs` table row)

**Reviewers**: Platform Lead — cross-service architecture (CI gate)

**Codebase Evidence**:
- `.github/workflows/ci.yml`:
  - Filter block `:39-88` (`dorny/paths-filter@v4` `:31`). The `context-map` filter `:81-88` is the shape to
    copy.
  - The `context-map` job `:707-718` is the job shape: `needs: changes`, an `if:` on
    `contains(fromJson(needs.changes.outputs.matched), '<filter>') || … 'ci'`, `actions/checkout@v7`, and one
    `run:`.
  - `ci-gate` needs `:773-788` and the echo list `:792-806`.
  - The shell-lint test step `:628-629` skips docs-only PRs. Do NOT append there (design.md §7).
- No `otel-signals` filter or job exists: `grep -n otel ci.yml` returns nothing.
- `docs/patterns/ci-overview.md:7-20` is the CI job table that root `CLAUDE.md` § CI/CD Overview points to. It
  already omits `shell-lint`, `context-map` and `markdown-lint`; only the new job is added here (Teardown: a doc
  describing changed behaviour).

**TDD**: N/A (config: CI workflow YAML. The scripts it runs are proven in Steps 10-11.)

**Covers**: —

**Instructions**:
1. Add an `otel-signals:` filter under `filters: |` listing `'packages/otel/**'`, `'docs/**'`, `'.do/**'`,
   `'scripts/check-otel-produced-signals*.sh'` and `'scripts/testdata/otel-produced-signals/**'`.
2. Add a job `otel-signals:`:
   - `name: OTel produced-signal guard`;
   - `needs: changes`;
   - `if:` on `'otel-signals'` or `'ci'`;
   - `runs-on: ubuntu-latest`;
   - steps: `actions/checkout@v7` (default shallow fetch; neither script calls `git`, Step 10), then
     `run: bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh`.
3. Add `- otel-signals` to `ci-gate.needs` and an `echo "otel-signals:    ${{ needs.otel-signals.result }}"`
   line to the evaluate step.
4. Append one row to the `docs/patterns/ci-overview.md` `## CI Jobs` table: `` | `otel-signals` |
   `scripts/check-otel-produced-signals.sh` + its `.test.sh`: alert/dashboard queries and observability docs name
   only exported signals | — | ``. Do not backfill the other omitted jobs.

**Verification**:
```bash
uv run --no-project --with pyyaml python3 -I -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));j=d['jobs'];assert 'otel-signals' in j and 'otel-signals' in j['ci-gate']['needs'];assert 'otel-signals:' in j['changes']['steps'][1]['with']['filters']"
grep -n 'needs.otel-signals.result' .github/workflows/ci.yml
grep -n 'check-otel-produced-signals' .github/workflows/ci.yml   # only in the otel-signals job, not in shell-lint :629
grep -n '^| `otel-signals` |' docs/patterns/ci-overview.md
bash scripts/check-otel-produced-signals.sh && bash scripts/check-otel-produced-signals.test.sh   # final verification (design.md §8)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
