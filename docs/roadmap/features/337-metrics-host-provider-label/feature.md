# Feature: metrics-host-provider-label

**Development Branch**: `feature/metrics-host-provider-label`
**Created**: 2026-11-12
**Last Updated**: 2026-11-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning fixed, 6 overlap warnings) |
| 2026-11-12 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-12 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — D-1..D-20, R-1..R-5, O-1..O-38
- [Design](design.md) — approved architecture (option B, per-runtime exporter wrapper)
- [Implementation Spec](implementation-spec.md) — 15 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make `host_provider` (`homelab` | `digitalocean` | `unknown`) a first-class label on every OTel metric series, so provider-scoped queries need no `target_info` join. Metrics only; the logs filter and the 332 resource attribute are unchanged.

## Reviewers

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-runtime consistency of one mechanism; series-budget impact; follow-up scoping |
| Service owners: `xstockstrat-trading`, `-portfolio`, `-marketdata` (Go) | Metric views/exporter wiring; `serverMetricViews` allowlist stays intact |
| Service owners: `xstockstrat-indicators`, `-ingest`, `-analysis`, `-agent` (Python) | Pinned-SDK behavior verified from installed source; metric allowlist tests |
| Service owners: `xstockstrat-config`, `-identity`, `-ledger`, `-notify` (Node) | Pinned `sdk-node`/`sdk-metrics` behavior; startup never blocked |
| Service owner: `xstockstrat-ui` | `src/telemetry.ts` and `bffAllowlist.test.ts` label-allowlist parity |

## Next Action

`/sdd-review metrics-host-provider-label impl-spec` — validate implementation spec, then `/sdd-execute metrics-host-provider-label`
