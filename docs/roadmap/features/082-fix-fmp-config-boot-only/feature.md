# Feature: fix-fmp-config-boot-only

**Type**: bug
**Lifecycle Status**: `implementation-ready`
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
| 2026-07-30 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written. Always-construct-at-boot + extracted testable function, composed test proof (canary + passthrough + live-toggle test), both doc surfaces corrected. |
| 2026-07-30 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier (xstockstrat-marketdata)
- [Design](design.md) — debated, approved architecture (2 rounds, quick)
- [Implementation Spec](implementation-spec.md) — 4 steps: main.go extraction + service.go comment,
  paired test proof (canary + live-toggle), doc corrections (CLAUDE.md + context-constitution.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Canonical snapshot from `implementation-spec.md`'s steps (per `docs/runbooks/reviewer-registry.md`
§ Step Category → Reviewer Roles; stable unless `/sdd-spec` re-runs):

| Step Category | Reviewer Roles |
|---|---|
| `service` (Steps 1) — xstockstrat-marketdata | Service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency; this fix specifically: FMP client wiring, config watcher usage, no look-ahead/hot-path regression |
| `test` (Step 2) — xstockstrat-marketdata | Service owner — same focus as Step 1 (tests Step 1's change) |
| `docs` (Step 3) | None |

**Awareness note (not a step reviewer, kept from the design phase):** `xstockstrat-analysis`'s
screener silently degrades to a neutral score on any RPC failure from marketdata (`screener.py:132-149`)
— out of scope for this fix (see `product-spec.md` § Out of Scope), but the analysis service owner
should confirm this graceful-degrade behavior stays intentional rather than becoming a silent
coverage gap.

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

`/sdd-review fix-fmp-config-boot-only impl-spec` — validate implementation spec, then
`/sdd-execute fix-fmp-config-boot-only`
