# Feature: metrics-host-provider-label

**Development Branch**: `feature/metrics-host-provider-label`
**Created**: 2026-11-12
**Last Updated**: 2026-11-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-12 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec metrics-host-provider-label`_
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

`/sdd-review metrics-host-provider-label product-spec` — AI review of product spec before running /sdd-design
