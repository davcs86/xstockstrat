# Feature: screener-preset-criteria

**Development Branch**: `feature/screener-preset-criteria`
**Created**: 2026-09-12
**Last Updated**: 2026-09-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-12 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written |
| 2026-09-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase discovery for design phase
- [Design](design.md) — debated, user-approved architecture
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a preset selector to the Screener page that lets the trader load a predefined multi-criterion configuration with one click instead of manually composing each row. Ships with a "Fundamentals Signal" preset that mirrors the platform's built-in fundamentals scoring bands (`_BUILTIN_BANDS` + EPS).

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md — the distinct
`**Reviewers**` values across all implementation-spec steps. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` Service Owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no direct DB access (except audit log) |

## Next Action

`/sdd-review screener-preset-criteria impl-spec` — validate implementation spec, then `/sdd-execute screener-preset-criteria`
