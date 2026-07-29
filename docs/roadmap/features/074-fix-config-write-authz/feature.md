# Feature: fix-config-write-authz

**Type**: bug
**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/fix-config-write-authz` (this run: implemented on the
harness-designated branch `claude/runs-073-074-sdd-6wtwal` → `main-dev`; see context.md § Deviations)
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat` (`POST /issues` → `410
Issues has been disabled`); bug captured directly via `/sdd-triage` (Track C, adapted — see
context.md § Deviations)
**Severity**: SEV-1
**Created**: 2026-07-28
**Last Updated**: 2026-07-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-28 | `bug-reported` → `draft` | /sdd-triage | Product spec captured directly from code recon (no GitHub issue — Issues disabled). Routed via main-dev per explicit user decision, not the pure Track A hotfix-to-main flow the SEV-1 classification would normally take. |
| 2026-07-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings, 0 blockers). Overlap: file-level collision with 073 FR-7 only — resolved by editing 073's FR-7 to "verify, don't reimplement". |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-config-write-authz`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Step Category | Reviewer Roles |
|---|---|
| `service` — xstockstrat-config | Service owner — config key naming, environment/trading_mode scoping, WatchConfig stream stability, plus the new `SetConfig` authorization check itself |
| `service` — xstockstrat-ui (config-ui BFF) | Service owner — config mutation safety, Connect-RPC call safety, no secret values rendered in UI |
| Security | Required (not advisory) — this is the first authorization check ever added to `SetConfig`; no secrets in config service state, JWT claims minimal, API key scoping correct |

## Summary

`xstockstrat-config`'s `SetConfig` RPC performs no authorization check at all, and
`xstockstrat-ui`'s config-ui BFF calls it with only a session check (no admin-scope check) — both
confirmed present on `origin/main` (production). Any authenticated `/config-ui` user of any role
can currently write arbitrary config, including halting all trading (`platform.maintenance_mode`)
or bypassing the order-approval flow (raising `trading.approval.*` thresholds).

## Next Action

`/sdd-design fix-config-write-authz` — design depth **full** (2 affected services: it crosses the
"affected services ≥ 2" full-design threshold per `docs/runbooks/bug-triage.md` § C-0).
