# Feature: fix-agent-trading-mode-otel-attr

**Type**: bug
**Development Branch**: `feature/fix-agent-trading-mode-otel-attr`
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 1) — GitHub Issues disabled on this repo
**Severity**: SEV-3
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from comment-audit report item 1 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-agent-trading-mode-otel-attr`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`xstockstrat-agent`'s OTel init reads `TRADING_MODE` into a `trading_mode` resource attribute
(`app/telemetry.py:33,39`). Feature 147 retired `trading_mode` as a config/scope axis (scope is now
derived from `APPLICATION_ENV`), so the attribute name is at best inconsistent with the post-147
model. `TRADING_MODE` is still a live routing env var elsewhere, so the fix is a decision — drop the
attribute or rename it to `deployment.environment` parity — not a mechanical correction.

## Next Action

`/sdd-design fix-agent-trading-mode-otel-attr quick` — recommended design depth (quick); see context.md
