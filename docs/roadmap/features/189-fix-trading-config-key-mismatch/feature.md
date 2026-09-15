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
| 2026-09-15 | `draft` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. Affected services expanded to include xstockstrat-ui (C-14 consumer surface). |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier + runtime log evidence + C-16 business rules
- [Design](design.md) — chosen 4-part approach, rejected alternatives, open risks, honored prod-delta ledger
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

`/sdd-spec fix-trading-config-key-mismatch` — generate the numbered implementation spec from the
approved design (resolves the DB-audit-dependent open risks: DOWN reversibility, daily_loss_limit
reader, full bare-key reader re-audit).
