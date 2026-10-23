# Feature: fix-ingest-seeded-config-keys

**Type**: bug
**Development Branch**: `feature/fix-ingest-seeded-config-keys`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-22
**Last Updated**: 2026-10-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-22 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report; Track C |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings) |
| 2026-10-23 | `spec-ready` → `demoted/canceled` | operator (design gate, round 4) | **Demoted by the operator at the round-4 design gate; the defect itself is still open.** The fix grew from 5 ingest seeds to a single 18-key re-key migration across ingest and analysis, and four design rounds kept surfacing new blockers (migration-owned snapshot log, a goto-032 harness pass, widened product spec, a per-row pre-deploy sign-off before the main-dev merge). The operator chose to stop here and instead create a follow-up that enforces, in the execution/validation loop, that every new config key is implemented as planned (feature 278-enforce-config-key-wiring). Recon, four rounds of design state and the amendment list are preserved in context.md; the branch `feature/fix-ingest-seeded-config-keys` keeps the spec history. If the re-key is revived it is re-created under a new NNN, not resurrected. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ingest-seeded-config-keys`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The five `ingest` config keys seeded by config migrations are stored without the `ingest.` prefix, but ingest reads them with it, so the reads miss the snapshot and operators cannot tune MCP polling or backfill chunking.

## Next Action

`/sdd-design fix-ingest-seeded-config-keys` — recommended design depth: full (two services, a config migration or key change, and a platform-wide sweep question); see context.md
