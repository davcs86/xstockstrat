# Feature: homelab-otel-host-provider

**Development Branch**: `feature/homelab-otel-host-provider` (this session develops on harness branch `ccr-6307b904-swdg1c`, PR into `main-dev`)
**Created**: 2026-11-11
**Last Updated**: 2026-11-11
**Committed to main**: 325f3bd9a83ada7ed60b1f18c81d848a57af3db9
**Launched date**: 2026-11-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-11 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) after one FAIL round fixed (Open Questions, C-1 per-target values) |
| 2026-11-11 | `spec-ready` (re-review) | /sdd-review | Re-run at operator request: PASS WITH WARNINGS, no blockers; FR-4 premise corrected (OTLP keys were DO-only in `sops_secrets.py`), warnings addressed |
| 2026-11-11 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + debate.md + design.md written; product-spec.md and acceptance.feature updated to match (D-21) |
| 2026-11-11 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps |
| 2026-11-11 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1–2 done (Go resource stamp) |
| 2026-11-11 | `in-progress` → `code-completed` | /sdd-execute | All 17 steps done (sequential); `check-config-wiring.mjs --final` exit 0 |

| 2026-11-11 | `code-completed` → `launched` | CI workflow | Promoted via PR #1512; committed 325f3bd9a83ada7ed60b1f18c81d848a57af3db9 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (incl. live Grafana facts and existing business rules)
- [Debate Register](debate.md) — decisions D-1..D-22, rejected alternatives R-1..R-7, objections, petitions
- [Design](design.md) — approved architecture, rejected alternatives, open risks, rules touched
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Homelab Compose services export OTel traces, metrics and logs to the same Grafana Cloud free-tier stack DO uses, and every signal from every runtime carries a new `host.provider` resource attribute (`digitalocean` | `homelab`), so homelab and DO data can be separated in queries when `deployment.environment` collides.

## Reviewers

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service observability contract across all 12 runtimes; deploy-target parity DO vs homelab (FR-8); pipeline owns and asserts values per service; the deploy-spec guard covers every target |
| Security | New credential wiring (`OTEL_EXPORTER_OTLP_HEADERS` to homelab) follows `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy" and `docs/patterns/config-governance.md` Rule 6; no plaintext in repo or logs; the header is never printed outside `::add-mask::` or projected by the render oracle |
| `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` (Go telemetry) | Telemetry init stays non-fatal; paper-only dev invariant untouched; `serverMetricViews` unchanged |
| `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-agent` (Python telemetry) | Telemetry init stays non-fatal; no behavior change to the formula sandbox or the MCP tool contract |
| `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-ledger`, `xstockstrat-notify` (Node telemetry) | Telemetry init stays non-fatal; `node --test` and the production `tsc` build both pass (ledger fails.md, feature 171); no secret in the exported resource |
| `xstockstrat-ui` | Next.js instrumentation hook still lives in `src/`; no secret values rendered |

## Next Action

Merge the integration PR (`feature/homelab-otel-host-provider` → `main-dev`) once CI passes; then `otel-env-provider-scoped-alerts` (feature 333, C-14 follow-up).
