# Feature: fix-deploy-wait-loop

**Type**: bug
**Development Branch**: `feature/fix-deploy-wait-loop`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (`--from-report`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-deploy-wait-loop`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The "Wait for deployment" step in `deploy.yml` times out (red run) when a newer push supersedes its DO
deployment, because `SUPERSEDED` is not a terminal phase in the loop and no concurrency group serialises
deploys to one app.

## Next Action

`/sdd-spec fix-deploy-wait-loop` — recommended design depth: skip (SEV-3, CI workflows only, no proto/migration/config, root cause confirmed from job log); see context.md
