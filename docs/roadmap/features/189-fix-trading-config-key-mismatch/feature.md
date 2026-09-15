# Feature: fix-trading-config-key-mismatch

**Type**: bug
**Development Branch**: `claude/halted-account-94ldka` (harness-assigned; PR targets `main-dev`)
**Defect Report**: `docs/reports/2026-09-15-trading-config-namespace-key-mismatch-defect.md` (GitHub Issues disabled — report is the audit trail)
**Severity**: SEV-1
**Created**: 2026-09-15
**Last Updated**: 2026-09-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (from-report path; Issues disabled) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-trading-config-key-mismatch`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The trading service never resolves live config: it subscribes only to the `trading` namespace and
reads full-dotted getter strings against a snapshot keyed by the raw (namespace-relative) `key`
column, so `platform.trading_state` always falls to the fail-closed `HALTED` default and every
exposure-increasing order is rejected. Same latent pattern in portfolio/marketdata.

## Next Action

`/sdd-design fix-trading-config-key-mismatch` — recommended design depth: **full** (≥2 affected
services + a likely seed-key migration; safety-critical contract). See context.md.
