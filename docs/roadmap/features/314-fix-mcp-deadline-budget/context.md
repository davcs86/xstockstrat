# Context Log: fix-mcp-deadline-budget

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md (SEV-2)
  - docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md (SEV-2)
  - docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md (SEV-3)
- Cluster rationale: all three are unenforced end-to-end deadline budgets fixed in the same SetConfig bounds
  registry and agent call budgets (PLAT-13).
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md
- Affected services (from reports): xstockstrat-agent, xstockstrat-config, xstockstrat-portfolio,
  xstockstrat-marketdata, xstockstrat-analysis
- Root cause hypothesis: per-hop/per-key budgets with no whole-call bound and no cross-key validation. R7 residual
  (sandbox timeout vs ExecuteFormula deadline) appears reshaped since the report (`client.py:1121`
  `formula_deadline_s`, `configServiceImpl.ts:176` bound) — re-verify in recon.
- Recommended design depth: full → `/sdd-design fix-mcp-deadline-budget` (rationale: SEV-2, ≥2 affected services,
  config-bound changes)
- Development branch: feature/fix-mcp-deadline-budget
