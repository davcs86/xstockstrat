# Context Log: fix-trading-reconcile-reads

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md` (no GitHub issue — Issues disabled): trading reconcile reads only the first 500 platform positions per account
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-2
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-trading (upstream, unchanged: xstockstrat-portfolio `ListPositions`)
- Root cause hypothesis: Reconcile assumed one page per account while the token was unreliable (fixed by feature 353). Fix: drain the cursor, failing closed per `docs/roadmap/ledger/fails.md:3311` (page error → skip the account for the tick), tested against a fake that ignores the token.
- Recommended design depth: quick → `/sdd-design fix-trading-reconcile-reads quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-trading-reconcile-reads
- Twin: feature 357 `fix-portfolio-internal-position` (portfolio internal readers), split by operator decision 2026-11-17.
- A false finding halts the account — the fail-safe direction is skip-the-tick, never a halt on an incomplete read.
