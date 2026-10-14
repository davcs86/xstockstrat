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

## Session 2026-10-14 (/sdd-design — round-cap override)

- Rounds 1–5 ran in full mode. Round 5 returned APPROVE WITH FIXES and the fixes were applied (ef54e88a, de432f0d).
- **Operator override (2026-10-14):** at the round-5 approval gate, the operator chose "Do another round, override cap".
  That is explicit sign-off to exceed the 5-round full-mode cap, recorded here per the Commandment override rule.
  Round 6 is a whole-document adversarial re-review of the post-fix design.md.

### Operator decisions recorded during the design debate (2026-10-14)

- **D1** (round-1 gate): one request-scoped DB budget, with `pool.acquire(timeout=remaining)`, a short read transaction carrying `SET LOCAL statement_timeout = <remaining ms>`, and a bounded `pool.release`. Only transient DB errors become UNAVAILABLE; the type and message are always logged.
- **D2** (round-1 gate): **seeding waiver.** The new keys are unseeded, which consciously deviates from feature 184's `analysis.opportunity.*` seeding convention.
- **D3** (round-1 gate): the AC-4 proof runs against a real local Postgres binary, test-scoped, with no long-running container.
- **D4** (round-2 gate): 57P01/57P02/57P03 are transient (UNAVAILABLE).
- **Round 6 (operator cap override):** APPROVE WITH FIXES, with no Floor breach and no C-16 regression. All 12 text fixes were applied:
  - AC-2 reachability (the test uses an insecure in-process channel and asserts the handler was entered);
  - red-step hang guards;
  - AC-1/AC-4 Gherkin wording aligned to the design;
  - the D1–D4 record;
  - the worst case is now B+3.05+E;
  - G4/G7/G10 test placement.
- **Design approved (2026-10-14):** the operator approved the round-6 design, and the status moved draft → design-approved. Open risks accepted as documented in design.md § Open Risks:
  - a PgBouncer BEGIN/COMMIT stall is bounded only by the B+2 backstop, at the cost of a reconnect.
  Next: `/sdd-spec`.
