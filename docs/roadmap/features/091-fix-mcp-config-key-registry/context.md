# Context Log: fix-mcp-config-key-registry

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-8
- Severity: SEV-3 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-config, xstockstrat-agent
- Root cause(s) from the report: RC-3
- Recommended design depth: full → `/sdd-design fix-mcp-config-key-registry` (rationale: DB migration (key registry) + ≥2 services)
- Development branch: feature/fix-mcp-config-key-registry
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-config, xstockstrat-agent). Confirmed RC-3
  (config_values = registry+value store); last migration 009→next 010; setConfig blind upsert; audit
  trigger BEFORE UPDATE only (new-key INSERT unaudited); proto SetConfigRequest max field 7; config
  tests run against compiled dist/ (074 zero-assertion trap fixed).
- Phase 1 Grilling: 2 rounds (full). R1 proposer offered a `config.config_registry` table; adversary
  out-argued it (dead is_secret/metadata columns → drift/leak; audit trigger targeted the wrong row).
  R2 adopted single-table (Alt A); R2 adversary caught two real defects and both are folded in.
- Chosen approach: single-table. Migration 010 = dedicated `AFTER INSERT` audit trigger
  (`config_value_audit_insert` + `audit_config_insert()`), leaving BEFORE UPDATE untouched — avoids
  the `BEFORE INSERT OR UPDATE` double-fire under `ON CONFLICT DO UPDATE`. setConfig existence gate is
  **mode-EXACT** (matches the ON CONFLICT target; mode-broadening manufactures a nondeterministic
  read-shadow). Additive proto `SetConfigRequest.create_key = 8`, forwarded by agent client (+ descriptor-
  parity test). Reads unchanged; AC-4 secret refusal untouched.
- Rejected: registry table; nullable value_data; widened single trigger; mode-broadening gate; agent
  client-side existence refusal.
- **Design-gate resolution (AC-3 reinterpretation)** — proceeded without a live user gate under the
  session's standing "continue" directive. AC-3's "registered but unset as a distinct persisted state"
  is NOT met and is reinterpreted as "registered ≙ has a value row + audit-on-insert." Justification
  (adversary R1 §4): that state is invisible to every reader (ListKeys/GetConfig read value rows;
  defaults are call-site, not DB default_value), so it buys nothing operationally; a second table to
  represent it was rejected. Audit half of AC-3 is fully met. Revisit only if a future feature needs a
  value-less registered key (→ nullable value_data). If the user wants the literal persisted state,
  reopen here.
- Constitution rules touched: F-01, F-06, F-07/F-04, C-09, C-08/P-06, C-01, C-10, C-11/P-03. Floor
  breaches: none (010 is a new file; no new pool; nothing hardcoded).
- Status: draft → design-approved.

### Open Threads
- AC-3 unset-half reinterpretation — resolved as "registered ≙ has a value row"; target: /sdd-spec
  product-spec AC-3 note. Reopen if the literal persisted state is required.
- Governance narrowing (config-ui can no longer typo-mint keys) — verify-only; target: spec verify step.
- 074 compiled-JS zero-assertion trap — every config test step must prove a red in dist/.
