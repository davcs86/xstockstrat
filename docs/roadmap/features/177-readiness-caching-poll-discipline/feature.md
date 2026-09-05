# Feature: readiness-caching-poll-discipline

**Development Branch**: `feature/readiness-caching-poll-discipline`
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `idea` → `draft` | /sdd-story | Product spec generated from performance audit Track B |
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (advisory warnings + DB up/down note addressed); overlap CLEAN |
| 2026-09-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, extended); round-4 adversary SOUND; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, Patterns to REUSE, Existing Business Rules
- [Design](design.md) — chosen approach, rejected alternatives, open risks, Constitution rules
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec readiness-caching-poll-discipline`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Eliminate redundant recompute on the decide-surface read paths: cache/materialize Watchlist
readiness the way Opportunities already is, stop the every-15s recompute for empty-universe users,
make warm-poll live enrichment conditional, and give the readiness client a `staleTime` so switching
panes doesn't re-trigger a full fan-out.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, no stale data shown as fresh |

## Next Action

`/sdd-spec readiness-caching-poll-discipline` — generate the implementation spec from the approved design
