# xstockstrat Grafana Alert Rules

File-based Grafana **unified alerting** provisioning for Phase 7
(feature `033-phase7-observability`, FR-4).

| File | Contents |
|---|---|
| `alert-rules.yaml` | Three alert rules in the `xstockstrat` folder |
| `mute-timings.yaml` | `outside-us-market-hours` mute timing used by the no-scoring alert |

## Rules (FR-4)

| UID | Title | Condition | For | Severity |
|---|---|---|---|---|
| `xstk-error-rate-high` | Service error rate > 1% | non-OK gRPC calls / total > 1% per `service_name` | 5m | critical |
| `xstk-p99-latency-high` | Service P99 latency > 2s | `histogram_quantile(0.99, …) > 2000 ms` per `service_name` | 3m | warning |
| `xstk-analysis-no-scoring` | Analysis produced no scoring events for 30m | zero `ScoreStrategy`/`RunBacktest` log events in 30m | 0m | critical |

## Substitutions before provisioning

`alert-rules.yaml` references datasource UIDs by placeholder — replace them before applying:

| Placeholder | Replace with |
|---|---|
| `${DS_PROMETHEUS_UID}` | UID of your Grafana Cloud Prometheus/Mimir datasource |
| `${DS_LOKI_UID}` | UID of your Grafana Cloud Loki datasource |

Find a UID at **Grafana → Connections → Data sources → <name>** (it appears in the page URL).
The `__expr__` datasource UID is Grafana's built-in expression engine — leave it as-is.

## Applying

**File-based provisioning (self-hosted Grafana / Grafana Agent):** place both files under the
provisioning `alerting/` path and restart, or call the provisioning reload endpoint.

**Grafana Cloud:** Alerting → Alert rules → **New → Import**, paste the rule, and select the
datasources. Create the `outside-us-market-hours` mute timing under Alerting → Notification
policies → Mute timings (mirror `mute-timings.yaml`).

## Market-hours gating

`xstk-analysis-no-scoring` carries the label `mute_outside_market_hours: "true"`. Attach the
`outside-us-market-hours` mute timing to the notification policy that matches that label so the
alert only pages during the regular US session (09:30–16:00 America/New_York, Mon–Fri). The
rule itself still evaluates 24/7 (visible on dashboards); only **notifications** are muted
off-hours.

## Notification routing

Routing (contact points + notification policies) is intentionally **not** pinned in these files
so each environment routes to its own target. For V1, route to email or to Slack via feature
`020-notify-external-fanout`. Wire a Grafana contact point of type *webhook* at the notify
service, or use Grafana's native email/Slack contact points.
