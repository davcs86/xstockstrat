# Context: grafana-dashboards-ci-deploy

**Feature**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/implementation-spec.md`

---

## Session 2026-11-05 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from a request to distil PR 653 and compare it with the current code.
- Number `297` reserved with `scripts/sdd-allocate-feature-number.sh` (cursor was at 296). The `/sdd-story` skill text still says local `max+1`; `docs/runbooks/feature-workflow.md` § Feature Numbering (reserved, fail-closed) governs. Skill text is stale — candidate doc fix, not changed here.
- Source: PR 653 `claude/grafana-mcp-availability-tyzn1w` @ `b2ec808`, base `main`, open, `mergeable_state: dirty`, 9 files +346/−2. Read via the GitHub MCP file patches; the head branch itself was not checked out.
- Compared against `main-dev` @ `b371a3e` after `git pull`: none of the PR's files exist there. `packages/otel/dashboards/` now has 5 dashboards (PR assumed the 033 set) and `service-health.json` declares `DS_TEMPO` (6 refs) which the PR's script does not substitute.
- Verified by reading: dashboards' `__inputs`, `uid`s and `${DS_*}` counts; guard `scripts/check-otel-produced-signals.sh` scope (reads `dashboards/*.json`, doc Part 3); checkout pin convention (`actions/checkout@3d3c42e5…  # v7.0.1`); SOPS model (feature 286, launched 2026-11-04); `.mcp.json` now has 7 DigitalOcean http servers.
- NOT verified (flagged in Open Questions): real Grafana Cloud `/api/datasources` composition (G2/Q5), whether an unresolved `${DS_TEMPO}` renders (G1), whether dev and prod share one stack (Q1), whether the Editor-role token can create folders in the target org.
- Decisions deferred to the operator: Q1, Q2, Q3 (blocking); Q4–Q8 (non-blocking).
- Not committed or pushed: artifacts are in the working tree on branch `feature/grafana-dashboards-ci-deploy`.

## Session 2026-11-05 — live-stack verification (read-only, Grafana Cloud connector)

Read-only calls through the claude.ai Grafana Cloud connector (not the PR's docker server): `user_info`, `list_datasources`, `search_dashboards`, `list_prometheus_label_values`.

- **Stack**: one org, `Main Org.` (id 1), identity role Admin, stack slug `davcs86`. `xstockstrat` telemetry is live there: `service_name` on `grafanacloud-prom` (7d) = agent, analysis, config, identity, indicators, ingest, ledger, marketdata, notify, portfolio, trading, ui, plus a stray long-name `xstockstrat-ui` (OTEL-1 keys on short names; not diagnosed here).
- **Environments** on `rpc_server_duration_milliseconds_count` (7d): `development`, `staging`. No `production` series in 7d. So this stack is shared by local-dev and staging; whether production uses another stack or is silent is unknown (Q1).
- **Datasources (13)**: prometheus `grafanacloud-prom` (id 8, **only isDefault=true**) and `grafanacloud-usage` (id 11); loki `grafanacloud-alert-state-history` (id 1), `grafanacloud-logs` (id 7), `grafanacloud-usage-insights` (id 12); tempo `grafanacloud-traces` (id 10, not default). Loki and Tempo have **no default**.
- **Dashboards**: only `xstk-service-health` exists (tagged `xstockstrat`; title search for `xstockstrat` finds the same one). The other four (`xstk-service-detail`, `xstk-signal-pipeline`, `xstk-infrastructure`, `xstk-trading-service`) are not deployed. Its folder was not returned, so whether it sits in `xstockstrat` or General is unverified.
- **Not verified**: the raw `/api/datasources` order the PR script would see (the connector's list is ordered as above, with alert-state-history first among loki); a service account token's ability to create the folder.
