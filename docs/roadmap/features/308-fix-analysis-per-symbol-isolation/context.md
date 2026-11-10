# Context Log: fix-analysis-per-symbol-isolation

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md` — one candidate's non-RpcError aborts the whole per-user opportunities compute (SEV-2)
  - `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md` — EvaluateReadiness fails entirely when one symbol's readiness compute raises (SEV-2)
  - `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` — a genuine indicators outage loses whole readiness batches and heal rows (SEV-3)
- Cluster rationale: all three are the same isolation-scope defect (per-symbol work inside a fan-out whose only handler is outside the per-symbol unit) in one service, the sibling of feature 245's screener fix.
- Severity: SEV-2 (highest of the cluster)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-analysis
- Root cause hypothesis: isolation scope; feature 185 deliberately lets FormulaExecutionError propagate (servicer.py:5829) — contract decision is Open Question 1
- Recommended design depth: quick → `/sdd-design fix-analysis-per-symbol-isolation quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-analysis-per-symbol-isolation

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); OQ1 contract reversal baked into AC-1; AC-3 spans kick/materializer/heal paths; fetch_failed race (OQ3) has no scenario
- Overlap findings: WARN: xstockstrat-analysis shared with 309, 313, 327, 323, 329
- Recommended design depth: full (analysis servicer overlaps 309/313/327; OQ1 reverses feature-185 abort contract)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)
