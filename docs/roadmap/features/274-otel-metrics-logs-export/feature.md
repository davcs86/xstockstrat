# Feature: otel-metrics-logs-export

**Development Branch**: `feature/otel-metrics-logs-export`
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `idea` → `draft` | /sdd-story | Product spec generated. NNN 274 is operator-specified, not max+1 (254); see `context.md` |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings open; 1 FAIL + 9 warnings across two passes fixed) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |
| 2026-10-30 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 59 steps (PR-A 1-47, G1 gate 48, PR-B 49-59) |
| 2026-10-31 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1-2 done (sequential, session branch `ccr-4f43fb65-lagupv`) |
| 2026-10-31 | `in-progress` → `code-completed` | /sdd-execute | All 59 steps done: PR-A #1379 and follow-ups #1380/#1382 merged, G1 dev proof recorded, PR-B (steps 49-59) open; prod stays OTEL_ENABLED="false" |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier + pinned-SDK probe
- [Design](design.md) — approved architecture (P-0 → PR-A → G1 → PR-B), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 59 numbered steps: PR-A runtime export → G1 dev gate → PR-B assets/guard/docs
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Every xstockstrat runtime exports OTel metrics (including a gRPC server-duration histogram) and logs over
OTLP/HTTP next to its existing traces. The Grafana alerts and dashboards that feature 250 narrows to traces can
then be restored against series that are actually produced.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service telemetry contract (resource attrs, exporters, gating) across 12 runtimes; produced-signal guard and `packages/otel` assets |
| Service owner (`xstockstrat-trading`) | Order execution correctness, fill detection; no hot-path latency regression |
| Service owner (`xstockstrat-portfolio`) | P&L calculation accuracy, concurrent write safety; no hot-path latency regression |
| Service owner (`xstockstrat-marketdata`) | OHLCV ingestion integrity, feed idempotency; stream shutdown stability |
| Service owner (`xstockstrat-indicators`) | Formula sandboxing; `indicators.sandbox.timeout_ms` unaffected |
| Service owner (`xstockstrat-ingest`) | Signal normalization, idempotent ingestion; no bearer/secret plaintext in logs |
| Service owner (`xstockstrat-analysis`) | Backtest reproducibility, scoring determinism; heartbeat log line |
| Service owner (`xstockstrat-agent`) | MCP tool contract stability; no secret values in tool-output logs; stateless OAuth unaffected |
| Service owner (`xstockstrat-ledger`) | Append-only invariant, event ordering |
| Service owner (`xstockstrat-identity`) | No plaintext credentials or PII in logs (seed-admin log change) |
| Service owner (`xstockstrat-notify`) | Stream delivery guarantees, backpressure handling |
| Service owner (`xstockstrat-config`) | Secret redaction on the OTLP log edge; WatchConfig stream stability |
| Service owner (`xstockstrat-ui`) | Connect-RPC call safety; no secret values logged; BFF recorder wrapping |

## Scenario Promotion

All 22 `@AC-*` scenarios were promoted (C-16) at integration on 2026-10-31: 13 into per-service suites (`services/xstockstrat-{trading,analysis,ledger,config,portfolio,marketdata,identity,indicators,agent,ui}/acceptance/otel-metrics-logs-export.feature`) and 9 into `docs/sdd/business-rules/platform.feature`, each tagged `@feature-274`. 250 `@AC-3` is superseded by 274 `@AC-9` (operator-signed CHANGE); a comment block in `platform.feature` records it.

## Next Action

Merge PR-B, then the operator decides the production flip (`OTEL_ENABLED` in `.do/app.yaml`) using the G1 cost figures (Loki bytes/day is still unmeasured); `/promote` flips the feature to `launched` and promotes the `@AC-*` scenarios (C-16).
