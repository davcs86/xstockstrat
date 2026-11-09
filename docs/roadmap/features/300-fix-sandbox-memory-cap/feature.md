# Feature: fix-sandbox-memory-cap

**Type**: bug
**Development Branch**: `feature/fix-sandbox-memory-cap`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-15
**Last Updated**: 2026-10-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md` |
| 2026-11-09 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) after one fix round (FR-2 pinned, AC-2 observable, AC-3 added) |
| 2026-11-09 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full; escalated from quick at the post-recon gate) and approved; recon.md + design.md written; product-spec FR-1..FR-3 and acceptance AC-1..AC-14 reconciled in the same session |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (5 rounds)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-sandbox-memory-cap`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On the DigitalOcean runtime, the indicators formula sandbox's memory cap (`RLIMIT_DATA` = baseline + headroom) is not
enforced. A 400 MiB formula succeeded on staging under a 128 MiB headroom, but it fails correctly on a native kernel.
Formulas can therefore exhaust the indicators container's memory.

Approved fix (design.md): a parent-side memory watchdog in `execute_formula` (50 ms tick, child-reported arming
handoff, VmData and resident-memory rules over the process group, evidence-based `-9` attribution), a startup probe
with two gauges, and an explicit 2 GiB homelab container limit. No proto, DB or config-key change.

## Next Action

`/sdd-spec fix-sandbox-memory-cap` — generate the implementation spec from the approved design (FR-2 probe first, then the FR-1 watchdog, then the homelab limit, then docs)
