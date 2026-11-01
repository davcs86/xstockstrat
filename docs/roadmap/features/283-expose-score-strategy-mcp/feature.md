# Feature: expose-score-strategy-mcp

**Development Branch**: `feature/expose-score-strategy-mcp`
**Created**: 2026-11-01
**Last Updated**: 2026-11-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-01 | `idea` → `draft` | /sdd-story | Product spec generated (gap from 215 Step 26 (e)) |
| 2026-11-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; first pass FAILED on open questions, resolved by operator) |
| 2026-11-01 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full; hard cap) and approved with documented open risks; recon.md + design.md written |
| 2026-11-01 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |
| 2026-11-01 | `implementation-ready` (re-spec) | /sdd-execute | Steps 1-10 re-verified after merging `origin/main-dev` (already up to date); line anchors re-pointed in Steps 3/5/7/8/9, no blocking mismatch |
| 2026-11-01 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (sdd-batch-execute); operator's up-front confirmation recorded in context.md |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, user-approved architecture
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The `ScoreStrategy` RPC (manual headline-grade refresh) and its provenance fields (`evidence_symbols`, `evidence_days`, `provisional`) have no MCP tool, so an agent or operator cannot trigger or verify a grade recompute. Feature 215 Step 26 (e) was blocked on exactly this.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |

## Next Action

`/sdd-execute expose-score-strategy-mcp sequential` — Step 5 (agent tool + client unit tests and tool-deadline guards for `score`, RED); Step 4 server-half gate GREEN 2026-11-01
