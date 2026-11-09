# Feature: fix-sandbox-memory-cap

**Type**: bug
**Development Branch**: `feature/fix-sandbox-memory-cap`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-15
**Last Updated**: 2026-11-09

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md` |
| 2026-11-09 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) after one fix round (FR-2 pinned, AC-2 observable, AC-3 added) |
| 2026-11-09 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full; escalated from quick at the post-recon gate) and approved; recon.md + design.md written; product-spec FR-1..FR-3 and acceptance AC-1..AC-14 reconciled in the same session |
| 2026-11-09 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 11 steps (2 open spec questions G-1, G-2 for impl-spec review) |
| 2026-11-09 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started; Step 1 done |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (5 rounds)
- [Implementation Spec](implementation-spec.md) — 11 numbered steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Role | Scope |
|---|---|
| Service owner `xstockstrat-indicators` | Formula sandboxing, no side-effects from formula execution, timeout enforcement (steps 1-10) |
| none | Step 11 (docs) |

---

## Summary

On the DigitalOcean runtime, the indicators formula sandbox's memory cap (`RLIMIT_DATA` = baseline + headroom) is not
enforced. A 400 MiB formula succeeded on staging under a 128 MiB headroom, but it fails correctly on a native kernel.
Formulas can therefore exhaust the indicators container's memory.

Approved fix (design.md): a parent-side memory watchdog in `execute_formula` (50 ms tick, child-reported arming
handoff, VmData and resident-memory rules over the process group, evidence-based `-9` attribution), a startup probe
with two gauges, and an explicit 2 GiB homelab container limit. No proto, DB or config-key change.

## Next Action

`/sdd-review fix-sandbox-memory-cap impl-spec` — validate the implementation spec and resolve G-1 (child-side `Rss*` tolerance) and G-2 (post-reap sweep), then `/sdd-execute fix-sandbox-memory-cap`
