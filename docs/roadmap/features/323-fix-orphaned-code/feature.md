# Feature: fix-orphaned-code

**Type**: bug
**Development Branch**: `feature/fix-orphaned-code`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-orphaned-code-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, open risks, rules touched
- [Implementation Spec](implementation-spec.md) — 10 numbered steps with codebase evidence (re-spec 2026-11-26: former Step 9 split by consumer surface)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Ten orphaned modules, scripts, dependencies and code paths across nine services have no runtime caller;
one (portfolio `r.pool` stragglers) nil-panics under pgxmock and blocks unit testing.

## Reviewers

_Snapshot finalized by /sdd-spec on 2026-11-20 from the per-step **Reviewers**; step numbers refreshed at the 2026-11-26 re-spec. Re-run /sdd-spec if the registry changes._

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety (steps 1-2) |
| Service owner `xstockstrat-config` | Config key naming, environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability (steps 3, 4, 7) |
| Service owner `xstockstrat-ledger` | Append-only invariant, event ordering (steps 4, 7) |
| Service owner `xstockstrat-identity` | JWT expiry and rotation, API key scoping, secret store integration (steps 4, 7; `package.json` only) |
| Service owner `xstockstrat-notify` | Stream delivery guarantees, backpressure handling, alert deduplication (steps 4, 7) |
| Service owner `xstockstrat-marketdata` | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency (steps 5, 7) |
| Service owner `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion, newsletter source schema stability (steps 6, 7) |
| Service owner `xstockstrat-agent` | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity (steps 8, 9) |
| Service owner `xstockstrat-ui` | Trading UI correctness, analytics display accuracy (step 10) |

No Proto Reviewer or DBA applies: the feature has no proto and no migration step.

## Next Action

`/sdd-review fix-orphaned-code impl-spec` — validate implementation spec, then `/sdd-execute fix-orphaned-code`
