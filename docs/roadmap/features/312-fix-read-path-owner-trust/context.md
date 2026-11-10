# Context Log: fix-read-path-owner-trust

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md` — trading ListOrders/StreamOrderUpdates trust a body user_id filter where empty = all users (SEV-3)
  - `docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md` — portfolio consumers substitute "default" / "alpaca-default" for missing user/account id (SEV-3)
  - `docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md` — notify ListAlerts trusts the body userId and is unscoped with no identity (SEV-3)
- Cluster rationale: all three violate PLAT-11 the same way — ownership taken from a body field, a null fallback, or a placeholder instead of the trusted x-user-id header — and share one security-posture decision.
- Severity: SEV-3 (all three)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-trading, xstockstrat-portfolio, xstockstrat-notify (consumer surfaces: xstockstrat-ui, xstockstrat-agent)
- Root cause hypothesis: pre-PLAT-11 body filters and test-caller fallbacks left in place; missing empty-caller guard in RegisterBrokerAccount
- Recommended design depth: full → `/sdd-design fix-read-path-owner-trust` (rationale: security/authz posture, ≥3 services, proto documentation change)
- Development branch: feature/fix-read-path-owner-trust

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); AC-3 allows two rejection codes pending OQ2; AC-2 compound; five open questions deferred; first review FAILed crit 5 + trading C-2 (fixed)
- Overlap findings: WARN: trading.proto shared with 322 (different messages); notify ListAlerts coupling with 315
- Recommended design depth: full (proto (additive); 5 services)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)
