# Feature: homelab-otel-host-provider

**Development Branch**: `feature/homelab-otel-host-provider` (this session develops on harness branch `ccr-6307b904-swdg1c`, PR into `main-dev`)
**Created**: 2026-11-11
**Last Updated**: 2026-11-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-11 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) after one FAIL round fixed (Open Questions, C-1 per-target values) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec homelab-otel-host-provider`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Homelab Compose services export OTel traces, metrics and logs to the same Grafana Cloud free-tier stack DO uses, and every signal from every runtime carries a new `host.provider` resource attribute (`digitalocean` | `homelab`), so homelab and DO data can be separated in queries when `deployment.environment` collides.

## Reviewers

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service change (all 12 runtimes), deploy-target parity DO vs homelab, port/registry consistency unaffected |
| Security | New credential wiring (`OTEL_EXPORTER_OTLP_HEADERS`) must follow `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy" and `docs/patterns/config-governance.md` Rule 6; no plaintext in repo or logs |
| `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` (Go telemetry) | Telemetry init stays non-fatal; paper-only dev invariant untouched |
| `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent` (Python telemetry) | Telemetry init stays non-fatal; no behavior change to formula sandbox or MCP tool contract |
| `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config` (Node telemetry) | Both Node test runners (strip-types ESM and tsc-first CJS) plus the production `tsc` build verified (ledger fails.md, feature 171) |
| `xstockstrat-ui` | Next.js instrumentation hook still lives in `src/`; no secret values rendered |

## Next Action

`/sdd-design homelab-otel-host-provider` — full design recommended (12 affected services, plus warning-level overlaps with 307 `deploy-homelab.yml`, 329 telemetry resource builders and 331 `.do/app*.yaml`). Operator must settle the homelab-production OTLP header/instance before `/sdd-spec`.
