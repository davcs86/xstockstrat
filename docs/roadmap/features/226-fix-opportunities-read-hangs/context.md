# Context Log: fix-opportunities-read-hangs

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-14 (/sdd-triage)

- Bug recorded as `docs/reports/2026-10-14-opportunities-read-hangs-defect.md` (Issues disabled), found while
  attempting feature 215 Step 26's staging measurement.
- Severity: SEV-2 (dev observed). Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..4 regression scenarios), context.md.
- Affected services: xstockstrat-agent, xstockstrat-analysis, xstockstrat-marketdata.
- Root cause hypothesis: no deadline at any hop and marketdata discards its errors (confirmed in code). The stalling
  dependency is unconfirmed: either the saturated shared DB (load 7–9 on 1 vCPU) or marketdata/Alpaca.
- Operator decision (2026-10-14): fix = deadlines + degrade-to-unenriched + log dropped errors + bounded pool acquires
  ("option 3"). DB resize and the OTel export failure are out of scope.
- **Production exposure:** `main` carries the same code (2026-10-14 promotion), and production shares the same
  saturated cluster. Not observed in production, so not escalated to Track A; noted for the operator.
- Recommended design depth: full → `/sdd-design fix-opportunities-read-hangs` (rationale: 3 affected services).
- Development branch: feature/fix-opportunities-read-hangs.
