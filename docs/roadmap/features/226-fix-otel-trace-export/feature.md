# Feature: fix-otel-trace-export

**Type**: bug
**Development Branch**: `ccr-3c062b89-cl8ixo` (session-pinned branch; operator-approved deviation from `feature/fix-otel-trace-export` — see context.md)
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-14-otel-trace-export-broken-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-14
**Last Updated**: 2026-10-14
**Committed to main**: 65bbc3cbf93a03f5359b60228398a25e6f297f05
**Launched date**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-14 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-14-otel-trace-export-broken-defect.md` |
| 2026-10-14 | `draft` → `design-approved` | /sdd-design | Design debated (3 rounds, quick + 2 operator-requested) and approved; recon.md + design.md written |
| 2026-10-14 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps |
| 2026-10-15 | `implementation-ready` → `in-progress` | /sdd-execute sequential | Step 1 done |
| 2026-10-15 | `in-progress` → `code-completed` | /sdd-execute sequential | All 11 steps done; integration PR #1246 |

| 2026-10-20 | `code-completed` → `launched` | CI workflow | Promoted via PR #1258; committed 65bbc3cbf93a03f5359b60228398a25e6f297f05 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-14).

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-trading owner | Order execution correctness, broker API safety (startup path only) | 2, 3 |
| xstockstrat-portfolio owner | Position snapshot consistency, concurrent write safety (startup path only) | 2, 3 |
| xstockstrat-marketdata owner | OHLCV ingestion integrity, Alpaca feed idempotency (startup path only) | 2, 3 |
| xstockstrat-indicators owner | No side-effects from formula execution, numeric precision (startup path only) | 4, 5 |
| xstockstrat-ingest owner | Idempotent ingestion, signal normalization correctness (startup path only) | 4, 5 |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism (startup path only) | 4, 5 |
| xstockstrat-agent owner | MCP tool contract stability (unchanged), no secret values in tool output | 4, 5 |
| xstockstrat-ledger owner | Append-only invariant, event ordering (startup path only) | 6, 7 |
| xstockstrat-identity owner | Secret store integration — never plaintext secrets; JWT expiry and rotation | 6, 7 |
| xstockstrat-notify owner | Stream delivery guarantees, backpressure handling | 6, 7 |
| xstockstrat-config owner | WatchConfig stream stability, config key naming | 6, 7 |
| xstockstrat-ui owner | No secret values rendered in UI, Connect-RPC call safety | 8, 9 |
| Platform Lead | Port uniqueness, service-registry consistency (local compose) | 10 |

## Summary

No service exports traces to Grafana Cloud: Go/Python/Node exporters use gRPC with explicit endpoint
options against an OTLP/HTTP-only gateway URL, and the UI's instrumentation hook is never registered.

## Next Action

Merge integration PR #1246 (scenarios promoted per C-16), then `/promote`
