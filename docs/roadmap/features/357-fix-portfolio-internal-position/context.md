# Context Log: fix-portfolio-internal-position

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md` (no GitHub issue — Issues disabled): portfolio internal position reads stop at the first 500 rows
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-2
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-portfolio
- Root cause hypothesis: The internal readers predate a working cursor (feature 353) and treated one 500-row page as all positions. Repo-level drain vs per-site loop is a design decision; enrichment must stay one batched call per RPC page (`@AC-1 @feature-178`).
- Recommended design depth: quick → `/sdd-design fix-portfolio-internal-position quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-portfolio-internal-position
- Twin: feature 358 `fix-trading-reconcile-reads` (trading `reconcileTick`), split by operator decision 2026-11-17.
- Reuse feature 353's dbtest harness (`seedPosition`, `testPool` exec-mode opts) and cursor codec; ledger insight on same-slot typed binds.
- Must PRESERVE `@AC-1 @feature-178` (`quote-fanout-batching.feature`) and the 353 `@AC-1` pagination guarantee.
