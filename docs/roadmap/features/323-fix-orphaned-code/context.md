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
