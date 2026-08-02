# Context Log: fix-mcp-signal-source-verbs

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-6
- Severity: SEV-2 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-ingest, xstockstrat-agent
- Root cause(s) from the report: RC-2, RC-6
- Recommended design depth: full → `/sdd-design fix-mcp-signal-source-verbs` (rationale: possible proto update_mask field + ≥2 services)
- Development branch: feature/fix-mcp-signal-source-verbs
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design

- Phase 0 Recon: recon.md written (ingest servicer/repo/proto, agent client/tool, analysis producer).
- Phase 1 Grilling: 2 rounds (full). R1 closed: credentials_ref virtual mask path; active/slug column-authoritative; merged-row credential check; C-04 enum (not waiver); slug validation dropped (scope-creep); analysis producer a real step. R2 found a C-10 gap: the config-ui sources page is a maskless update caller that NULLs credentials_ref on a display-name edit (the exact bug on the human surface).
- **Scope decision (user's 086 precedent — "fix every caller, don't defer"): pulled xstockstrat-ui config-ui sources page into scope.** handleSave derives an update_mask (preserves an omitted secret); the live-toggle moves to the new reactivate verb; paired e2e. AC-53/AC-55 now hold on every caller. Recorded here as the scope expansion beyond product-spec Affected Services.
- Chosen: AIP-161 verb split + SignalSourceOperation enum + update_mask; credentials_ref virtual mask path; strict register (ALREADY_EXISTS) / NOT_FOUND update / reactivate / deactivate; merged-row credential check closing the mediated_authenticated_website gap; descriptor-parity test; same-PR docs (mcp-tools.md + docstring; not in strat-lab).
- Constitution: C-04 (new enum), C-08/P-06 (paired tests incl. UI e2e), C-09 (additive proto), C-10 (parity + all callers fixed), F-01/F-06/F-07 (none). Floor breaches: none.
- Status: → design-approved.
