# Context Log: fix-orphaned-code

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled): docs/reports/2026-10-19-orphaned-code-defect.md — "Orphaned modules, scripts and dependencies across services"
- Cluster rationale: single report; all ten items are dead-code removals of the same kind.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..2), context.md
- Affected services (from report): config, ledger, notify, marketdata, analysis, ingest, agent, ui, portfolio
- Root cause hypothesis: template copy-paste, unwired features, incomplete refactors; spot-check shows item 5 likely resolved and item 7 changed at 0fecb24d
- Recommended design depth: full → `/sdd-design fix-orphaned-code` (rationale: ≥2 affected services incl. consumer surfaces xstockstrat-ui / xstockstrat-agent; otherwise SEV-3 with clear root cause)
- Development branch: feature/fix-orphaned-code

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); items 5 and 9 have no scenario (5 likely resolved; 9 open); first review had item 7 wrongly marked orphaned (fixed + AC-3)
- Overlap findings: WARN: configWatcher.ts and alpaca/client.go with 322; portfolio_repo.go with 311; ledger/notify package.json with 324
- Recommended design depth: full (9 services incl. ui and agent)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)
