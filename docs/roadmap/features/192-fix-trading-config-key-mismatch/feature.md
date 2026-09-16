# Feature: fix-trading-config-key-mismatch

**Type**: bug
**Development Branch**: `claude/halted-account-94ldka` (harness-assigned; PR targets `main-dev`)
**Defect Report**: `docs/reports/2026-09-15-trading-config-namespace-key-mismatch-defect.md` (GitHub Issues disabled — report is the audit trail)
**Severity**: SEV-1
**Created**: 2026-09-15
**Renumbered**: 2026-09-16 — `189` → `192` to resolve the `189` collision with `screener-preset-criteria` (renumbered the later-created, not-yet-launched member). Slug and branch unchanged.
**Last Updated**: 2026-09-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (from-report path; Issues disabled) |
| 2026-09-15 | `draft` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. Affected services expanded to include xstockstrat-ui (C-14 consumer surface). |
| 2026-09-15 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps. Resolved open risks: daily_loss_limit has no reader (behavior-neutral); DB audit still blocked → forward-only DOWN; page.tsx:120-121 confirmed sole runtime bare-key reader. |
| 2026-09-15 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode started; Step 1 (migration 029) done. |
| 2026-09-15 | `in-progress` → `code-completed` | /sdd-execute | All 8 steps done (sequential). Backend Go+config red→green locally; UI e2e as CI-equivalent (Dockerfile.e2e on PR). |
| 2026-09-16 | `code-completed` (unchanged) | /sdd-archiver | Renumbered dir `189` → `192` to resolve the `189` collision with `screener-preset-criteria` (no override needed — not launched). Updated self-ref path in implementation-spec.md, the `docs/.../189-...` path ref in `services/xstockstrat-trading/CLAUDE.md`, and the `(189)` citation in `docs/roadmap/ledger/fails.md`. Open PR on `claude/halted-account-94ldka` may need a rebase/path touch-up. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier + runtime log evidence + C-16 business rules
- [Design](design.md) — chosen 4-part approach, rejected alternatives, open risks, honored prod-delta ledger
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — 8 numbered steps with grounded codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The trading service never resolves live config: it subscribes only to the `trading` namespace and
reads full-dotted getter strings against a snapshot keyed by the raw (namespace-relative) `key`
column, so `platform.trading_state` always falls to the fail-closed `HALTED` default and every
exposure-increasing order is rejected. Same latent pattern in portfolio/marketdata.

## Reviewers

Canonical snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (stable unless
/sdd-spec re-runs). Deduplicated across all steps.

| Reviewer | Focus |
|---|---|
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` (Step 1) |
| xstockstrat-config owner | Config key naming (`<service>.<category>.<key>`), environment scoping, internal-caller authz correctness, WatchConfig stream stability (Steps 1, 4, 5) |
| xstockstrat-trading owner | Order execution correctness, kill-switch gate integrity, position limit enforcement, config read-path correctness (Steps 2, 3) |
| xstockstrat-ui owner | Trading UI correctness, Connect-RPC call safety, environment scope correctness (Steps 6, 7) |
| _none_ | `docs` step (Step 8) |

## Next Action

`/sdd-review fix-trading-config-key-mismatch impl-spec` — validate the implementation spec, then
`/sdd-execute fix-trading-config-key-mismatch`.
