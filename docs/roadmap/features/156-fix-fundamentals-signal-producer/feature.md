# Feature: fix-fundamentals-signal-producer

**Type**: bug
**Development Branch**: `feature/fix-fundamentals-signal-producer`
**Defect Report**: `docs/reports/2026-08-25-fundsignal-first-cycle-resets-on-redeploy-defect.md` (GitHub Issues disabled on this repo — report filed via `/sdd-qa defect`)
**Severity**: SEV-2
**Created**: 2026-08-25
**Last Updated**: 2026-08-25
**Committed to main**: c5a4eb3859ac271ceaa1946a4cb6a9835762a789
**Launched date**: 2026-08-26
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-25 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-08-25-fundsignal-first-cycle-resets-on-redeploy-defect.md` |
| 2026-08-25 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick + operator-steered expansion) and approved; recon.md + design.md written. Scope expanded beyond bug fix: durable schedule migration 019, jitter + retry config keys, MCP + config-ui manual trigger |
| 2026-08-25 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-08-25 | `implementation-ready` | /sdd-execute | Renumbered 155 → 156 (NNN collision with `155-watchlist-opportunity-signal-cues`, merged to main-dev); merged main-dev into branch |
| 2026-08-25 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (migration 019_fundsignal_schedule) done |
| 2026-08-25 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done (analysis scheduler + 2 config keys + migration 019 + agent MCP tool + config-ui trigger); e2e deferred to CI (D-2) |

| 2026-08-26 | `code-completed` → `launched` | CI workflow | Promoted via PR #1019; committed c5a4eb3859ac271ceaa1946a4cb6a9835762a789 |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(1); scenarios already promoted (all DUP); pruned 4 specs |
---

## Reviewers

| Role | Applies to steps | Focus |
|---|---|---|
| DBA | 1 | Migration NNN numbering (no gaps), up+down pair present, index correctness |
| `xstockstrat-analysis` owner | 1–4 | Scheduler crash-safety (advance after completion), no look-ahead/determinism, config key naming (`<service>.<category>.<key>`), no new pool (F-06) |
| `xstockstrat-agent` owner | 5–6 | MCP tool contract (name/params/return shape), admin `x-access-scope` forwarded only by management tools, tool-count parity across inventory surfaces |
| `xstockstrat-ui` owner | 8–9 | Config mutation safety, Connect-RPC call safety, admin-gate correctness, no secret values rendered |
| (none — docs) | 7 | — |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and (operator-expanded) fix scope
- [Acceptance Scenarios](acceptance.feature) — `@AC-1..9` scenarios (C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals signal producer schedules its cycles with an in-process `asyncio.sleep` placed
*before* the first run and keeps no persisted schedule, so every redeploy (CI/CD fires on every
`main-dev` push) restarts a fresh full-interval sleep and the first cycle can be deferred
indefinitely — the producer effectively never emits. Fix the boot timing so the first cycle fires
promptly and survives restarts.

## Next Action

`/sdd-review fix-fundamentals-signal-producer impl-spec` — validate implementation spec, then `/sdd-execute fix-fundamentals-signal-producer`
