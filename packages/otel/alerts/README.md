# xstockstrat Grafana Alert Rules

File-based Grafana **unified alerting** provisioning for Phase 7
(feature `033-phase7-observability`, FR-4).

`alert-rules.yaml` provisions no rules; it only deletes earlier ones. Runtimes export traces only
(feature 226 Operator Decision 3), and no produced series backs a rule (feature 250).

Metrics and logs are not exported (feature 226).

Detection of gRPC error rate, latency and analysis scoring stalls returns with
`docs/roadmap/features/274-otel-metrics-logs-export/`. Until it lands, nothing pages for those failures.

## Applying

**File-based provisioning (self-hosted Grafana / Grafana Agent):** place `alert-rules.yaml` under the
provisioning `alerting/` path and restart, or call the provisioning reload endpoint. Grafana applies
`deleteRules` and `deleteMuteTimes` and removes the listed items.

**Grafana Cloud:** the file is not applied automatically. Delete the items below by hand under
Alerting → Alert rules and Alerting → Notification policies → Mute timings.

## Removed assets

<!-- otel-guard:removed-assets -->
- `xstk-error-rate-high` — alert rule
- `xstk-p99-latency-high` — alert rule
- `xstk-analysis-no-scoring` — alert rule
- `outside-us-market-hours` — mute timing
- `mute-timings.yaml` — file
<!-- /otel-guard:removed-assets -->

## Notification routing

Routing (contact points + notification policies) is intentionally **not** pinned in these files
so each environment routes to its own target. For V1, route to email or to Slack via feature
`020-notify-external-fanout`. Wire a Grafana contact point of type *webhook* at the notify
service, or use Grafana's native email/Slack contact points.
