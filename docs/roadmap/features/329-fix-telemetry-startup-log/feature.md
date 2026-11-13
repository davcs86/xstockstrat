# Feature: fix-telemetry-startup-log

**Type**: bug
**Development Branch**: `feature/fix-telemetry-startup-log`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 19 steps (9 test→service units + 1 docs step) |
| 2026-11-13 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); merged `main-dev@d5de836b`, re-specced Step 19 (UI CLAUDE.md anchor `:325` → `:217`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 19 steps: 9 per-service test→service units (`**Lands with**`) + 1 docs step
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec (2026-11-13). Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| Service owner `xstockstrat-config` | Config key naming, environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability | 1, 2 |
| Service owner `xstockstrat-identity` | JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config) | 3, 4 |
| Service owner `xstockstrat-ledger` | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 5, 6 |
| Service owner `xstockstrat-notify` | Stream delivery guarantees, backpressure handling, alert deduplication | 7, 8 |
| Service owner `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) | 9, 10 |
| Service owner `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 11, 12 |
| Service owner `xstockstrat-indicators` | Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution | 13, 14 |
| Service owner `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | 15, 16 |
| Service owner `xstockstrat-agent` | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output | 17, 18 |

Step 19 (docs): none.

---

## Summary

The Node and Python telemetry startup log prints the raw `OTEL_EXPORTER_OTLP_ENDPOINT` env var (`→ undefined` / `endpoint: None` when unset) while the SDK actually exports to its default; the UI env docs also omit that the var is required when `OTEL_ENABLED=true`.

## Next Action

`/sdd-review fix-telemetry-startup-log impl-spec` — validate implementation spec, then `/sdd-execute fix-telemetry-startup-log` (its BRANCH SYNC must merge `origin/main-dev` first: the spec cites `main-dev@52f6d5a6` lines)
