# Context Log: fix-mcp-additive-tools

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-10 (test_formula, cancel_backfill, list_strategies, source-health passthrough, emit_alert context/tags/correlation_id)
- Severity: SEV-2 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-agent
- Root cause(s) from the report: RC-1
- Recommended design depth: quick → `/sdd-design fix-mcp-additive-tools quick` (rationale: agent-only, additive, no proto/migration; single service)
- Development branch: feature/fix-mcp-additive-tools
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design + sdd-execute (agent-only, all 5 steps)

- Quick design (1 round). Adversary caught 4 real issues, all folded in: (1) test_formula MessageToDict crashes on NaN/Inf output (median case for unvalidated source, ledger 2026-07-21) → scrub the output Struct in-place before projection + defensive try/except; (2) `active` opt-out dishonest → surfaced it, parity opt-out shrunk to {extractor_module}; (3) last_seen_at needs HasField or reports epoch → gated; (4) list_strategies casing → preserving_proto_field_name=True (snake_case, matches get_strategy).
- Implementation: extracted `_build_formula_parameter` to module level (DRY, shared by manage_formula + execute_formula); added `execute_formula` (inline, read-only, scrub+wrap), `cancel_backfill` (admin), `_scrub_struct_nonfinite`, `_ts_to_iso`, `_SOURCE_HEALTH_NAME`; extended list_signal_sources projection (active+health+last_seen_at+last_error+signals_fed), emit_alert (context/tags/correlation_id); snake_case list_strategy_definitions. 3 new tools (test_formula/cancel_backfill/list_strategies) + emit_alert params. Catalog 17→20 on this branch (pre-086; +2 from 086 reconciles at merge).
- Tests: 6 client tests incl. NaN-scrub RED; descriptor-parity over list_signal_sources projection; 4 tool tests; catalog 17→20; updated the exact-args emit_alert test. 149 agent tests, ruff clean, 70% cov.
- Docs: mcp-tools.md sections (cancel_backfill/test_formula/list_strategies) + list_signal_sources health fields + emit_alert params; counts 17→20 across mcp-tools.md/CLAUDE.md/tools.py.
- Note: branched from main-dev, so this branch's baseline is the pre-086 client/tools; 086 (PR #843) and 087 both edit the tool catalog + counts, so a small merge reconciliation is expected per merge-order.
- Status: draft → code-completed.

## Session 2026-08-02 (CI: feature status automation)

- Promotion PR #844 merged to main
- Feature promoted and committed: a76237080a282abac145b7f88a6044869132ba5f
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-02
