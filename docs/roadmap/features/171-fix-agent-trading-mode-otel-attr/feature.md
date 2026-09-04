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
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings, re-review); overlap CLEAN; blockers C-14/C-15 fixed |
| 2026-09-04 | `spec-ready` → `design-approved` | /sdd-design | Re-scoped agent-only → fleet-wide (user); 3 rounds; approved (test all 12 modules, no C-08 waiver); recon.md + design.md written |
| 2026-09-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps (language-grouped; per-module tests, no C-08 waiver) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — grounded codebase facts (fleet-wide finding)
- [Design](design.md) — debated, approved architecture (3 rounds; fleet-wide)
- [Implementation Spec](implementation-spec.md) — 8 numbered steps, evidence-cited
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`xstockstrat-agent`'s OTel init reads `TRADING_MODE` into a `trading_mode` resource attribute
(`app/telemetry.py:33,39`). Feature 147 retired `trading_mode` as a config/scope axis (scope is now
derived from `APPLICATION_ENV`), so the attribute name is at best inconsistent with the post-147
model. `TRADING_MODE` is still a live routing env var elsewhere, so the fix is a decision — drop the
attribute or rename it to `deployment.environment` parity — not a mechanical correction.

## Next Action

`/sdd-review fix-agent-trading-mode-otel-attr impl-spec` — validate the implementation spec, then `/sdd-execute fix-agent-trading-mode-otel-attr`

---

## Reviewers

Canonical snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` time (stable unless `/sdd-spec` re-runs).

| Role | Focus |
|---|---|
| Service owner (`xstockstrat-trading`) | Order execution correctness / paper-only dev invariant |
| Service owner (`xstockstrat-portfolio`) | P&L / position-snapshot consistency |
| Service owner (`xstockstrat-marketdata`) | OHLCV ingestion integrity |
| Service owner (`xstockstrat-agent`) | MCP tool contract stability / OAuth edge |
| Service owner (`xstockstrat-ingest`) | Signal normalization / idempotent ingestion |
| Service owner (`xstockstrat-indicators`) | Formula sandboxing |
| Service owner (`xstockstrat-analysis`) | Backtest reproducibility |
| Service owner (`xstockstrat-ledger`) | Append-only invariant / stream safety |
| Service owner (`xstockstrat-identity`) | JWT / secret store integration |
| Service owner (`xstockstrat-config`) | Config key naming / WatchConfig stability |
| Service owner (`xstockstrat-notify`) | Stream delivery guarantees |
| Service owner (`xstockstrat-ui`) | Connect-RPC call safety / no secret values rendered |
| Platform Lead | Cross-service architecture (fleet-wide telemetry convention) |
