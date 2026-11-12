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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec python-otel-instance-id`_
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

`/sdd-design python-otel-instance-id` — full design recommended (4 affected services; warning-level file overlaps with features 329, 333 and 334)
