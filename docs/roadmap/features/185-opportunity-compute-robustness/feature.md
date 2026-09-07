# Feature: opportunity-compute-robustness

**Development Branch**: `feature/opportunity-compute-robustness`
**Created**: 2026-09-07
**Last Updated**: 2026-09-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-07 | `idea` → `draft` | /sdd-story | Product spec generated (opportunities-queue audit follow-up) |
| 2026-09-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory; FR-4 cold-read demoted to design option to clear C-15/criterion-8 blocker; C-14 agent + C-16 turned into design Open Questions) |
| 2026-09-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. FR-4 re-committed by operator; FR-5 surgical read-time recovery (reusable, +readiness-cache subset heal) + FR-6 agent surface added; FR-3 reuses materializer sem (no new key) |
| 2026-09-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |
| 2026-09-07 | `implementation-ready` → `in-progress` | /sdd-execute | Execution started (sequential) |
| 2026-09-07 | `in-progress` → `code-completed` | /sdd-execute | All 15 steps landed RED-green across proto/analysis/agent/ui/docs. analysis suite 730 passed 84%; agent 392 passed 81%; UI e2e 439 passed. C-16 scenarios promoted to per-service suites. Teardown: context-forge plugin unavailable → manual reconciliation performed (see PR body). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules (C-16), risks
- [Design](design.md) — debated & approved architecture, rejected alternatives, open risks, Constitution rules touched
- [Implementation Spec](implementation-spec.md) — 15 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Apply the feature-181/176 correctness philosophy to the opportunities compute: give it a
**data-unavailable sentinel** (so a bars-fetch failure surfaces as a terminal "unavailable" state, not
a misleading `0/0` quiet row), and a **dedicated background bars-fetch semaphore** separate from the
interactive read path (the feature-176/180 priority-inversion guard the materializer already has).

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md, deduplicated across
all step `**Reviewers**` values. Stable unless /sdd-spec re-runs.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, additive/non-breaking, `buf lint`/`buf breaking` pass (Steps 1–2) |
| xstockstrat-analysis owner | Opportunity compute semantics, sentinel representation, semaphore/priority-inversion isolation, cold-read + poll-discipline, surgical partial-replace (no resurrection), paging determinism, signal-axis honesty (P-03), readiness-cache success-only, no look-ahead bias |
| xstockstrat-agent owner | MCP tool contract stability (return shape), descriptor-parity (no silent field drift), `docs/runbooks/mcp-tools.md` parity, no secret values in output |
| xstockstrat-ui owner | Analytics display accuracy, C-17 primitives + design-role tokens, accessible name for the new state cue, e2e fixture inventory (C-12) |

## Next Action

Merge the integration PR into `main-dev` (check `docs/roadmap/features/merge-order.md`), then
`/sdd-archiver` at launch.
