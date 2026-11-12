# Feature: python-otel-instance-id

**Development Branch**: `feature/python-otel-instance-id`
**Created**: 2026-11-12
**Last Updated**: 2026-11-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-12 | `draft` | operator | Scope widened to all 12 runtimes; `-<suffix6>` added to the id |
| 2026-11-12 | `draft` | operator | Suffix dropped as marginal; scope reverted to the 4 Python runtimes |
| 2026-11-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 5 review rounds (0 warnings outstanding) |
| 2026-11-12 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-12 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |
| 2026-11-12 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1+2 (U1 analysis) done |
| 2026-11-12 | `in-progress` | /sdd-execute | Step 3+4 (U2 ingest) done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (Existing Business Rules, Patterns to REUSE)
- [Debate Register](debate.md) — settled decisions D-1..D-22, rejected alternatives R-1..R-3, objections O-1..O-19
- [Design](design.md) — debated, user-approved architecture
- [Implementation Spec](implementation-spec.md) — 10 numbered steps in 5 atomic units
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make the four Python runtimes (analysis, ingest, indicators, agent) export `service.instance.id = <host.provider>-<service.name>`, as Go, Node and UI already do. This supersedes feature 332 decision D-7 and its scenario AC-21, so every homelab service is selectable by the same instance-id prefix and Python series stop churning per restart.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Service owner `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| Service owner `xstockstrat-indicators` | Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution |
| Service owner `xstockstrat-agent` | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth statelessness (`instance_count > 1` must stay safe) |

## Next Action

`/sdd-review python-otel-instance-id impl-spec` — validate implementation spec, then `/sdd-execute python-otel-instance-id`
