# Context Log: fix-mcp-formula-lifecycle

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-2, F-3, F-10 (get_formula/list_formulas)
- Severity: SEV-2 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-indicators, xstockstrat-agent
- Root cause(s) from the report: RC-1, RC-2, RC-6
- Recommended design depth: full → `/sdd-design fix-mcp-formula-lifecycle` (rationale: proto change (UpdateFormulaRequest update_mask) + ≥2 services)
- Development branch: feature/fix-mcp-formula-lifecycle
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.
