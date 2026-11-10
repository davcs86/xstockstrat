# Context Log: fix-alert-event-targeting

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md (SEV-2)
  - docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md (SEV-3)
- Cluster rationale: both are per-account risk signals emitted without owner attribution (alert targeting /
  ledger event kind + user), fixed at the alert/event emit sites.
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): xstockstrat-trading, xstockstrat-portfolio
- Root cause hypothesis: owner not resolved at trading emit time; portfolio reuses one drawdown-typed helper for
  both breach kinds (now passes userID to notify, ledger event still unattributed — portfolio_service.go:1320).
- Recommended design depth: full → `/sdd-design fix-alert-event-targeting` (rationale: SEV-2, 2 affected services,
  open audience question)
- Development branch: feature/fix-alert-event-targeting
