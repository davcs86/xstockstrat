# Feature: token-utilization-optimization

**Lifecycle Status**: `draft`
**Development Branch**: `feature/token-utilization-optimization`
**Created**: 2026-06-05
**Last Updated**: 2026-06-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-05 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec token-utilization-optimization`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Reorganizes the `docs/roadmap/features/` directory into three subdirectories (`active/`, `launched/`, `demoted/`) so SDD skills and `/sdd-status` only glob the active queue by default, keeping per-session token cost proportional to the in-flight backlog rather than total historical backlog. Adds a `STATUS.md` cache file to eliminate full re-scans on quick-overview calls.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service tooling correctness; SDD skill glob patterns; workflow consistency after directory restructure |

## Next Action

`/sdd-review token-utilization-optimization product-spec` — AI review of product spec before running /sdd-spec
