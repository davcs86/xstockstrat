# Feature: fix-fmp-config-boot-only

**Type**: bug
**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/fix-fmp-config-boot-only`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat` (`POST /issues` → `410
Issues has been disabled`); bug captured directly via `/sdd-triage` (Track C, adapted — same
precedent as features 067/074)
**Severity**: SEV-2
**Created**: 2026-07-30
**Last Updated**: 2026-07-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-30 | `bug-reported` → `draft` | /sdd-triage | Product spec captured directly from live-staging observation + code recon (no GitHub issue — Issues disabled). |
| 2026-07-30 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS — 1 warning: clarified "xstockstrat-staging" = main-dev/dev DO app, no separate staging tier; fixed in product-spec.md). Overlap scan: clean. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fmp-config-boot-only`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Step Category | Reviewer Roles |
|---|---|
| `service` — xstockstrat-marketdata | Service owner — FMP client wiring, config watcher usage, no look-ahead/hot-path regression |
| `service` — xstockstrat-analysis | Service owner (awareness) — screener silently degrades to neutral on any RPC failure from marketdata; confirm this stays intentional (graceful degrade) vs. becoming a surfaced coverage gap |

## Summary

`xstockstrat-marketdata` builds its FMP fundamentals client **once at process boot**, reading
`marketdata.fmp.enabled` off a one-shot config fetch rather than the live `WatchConfig` stream every
other config-driven behavior on the platform uses. Flipping the flag live via `set_config` (feature
073) has no effect until the service is restarted/redeployed — contradicting the platform's own
documented convention ("No service restarts are required for config changes",
`docs/runbooks/config-rollout.md`). Discovered while enabling the fundamentals pipeline in staging:
flags were flipped live, a real `FMP_API_KEY` secret was already present, yet `screen_symbols`'
`SCREEN_KIND_FUNDAMENTAL` criteria stayed flat/neutral because the already-running process's FMP
client was still `nil`.

## Next Action

`/sdd-design fix-fmp-config-boot-only quick` — generate recon + run the design debate (SEV-2, single
primary service, root cause fully confirmed via recon this session, no proto/migration/config-key
change needed — below the "full" threshold, above "skip").
