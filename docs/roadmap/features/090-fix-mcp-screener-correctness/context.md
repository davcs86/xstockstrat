# Context Log: fix-mcp-screener-correctness

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-02 (/sdd-triage --from-report)

- Routed from the MCP-alignment triage report: docs/reports/2026-08-01-mcp-tools-alignment-triage.md
- Findings bundled into this feature: F-4
- Severity: SEV-3 (max across bundled findings)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, context.md
- Affected services: xstockstrat-agent, xstockstrat-analysis
- Root cause(s) from the report: RC-1, RC-4
- Recommended design depth: full → `/sdd-design fix-mcp-screener-correctness` (rationale: ≥2 services (agent projection + analysis screener))
- Development branch: feature/fix-mcp-screener-correctness
- Bundling rationale: the report's cross-finding notes tie these findings to one surface/root
  cause, so they land as one feature (one PR-able change) rather than artificially-split dirs.
  The full per-finding fix plan (verified 2026-08-02, one read-only investigator per finding)
  lives in the source report; consult it during /sdd-design and /sdd-spec.

---

## Session 2026-08-02 — sdd-design
- Recon + adversary grill. Fixes folded: (a) min_conviction filters on scoring.buy_threshold(mc) (FR-4 parity — r.score is a normalized relative conviction, not absolute); (b) unknown-metric union check kept, residual documented (open metric absent universe-wide also raises); (e) agent gap-projection test rewrite named; (f) _build_component inherits ValueError-on-unknown-kind. (c)/(d) verified sound.
- Chosen: shared _build_component; screen_symbols maps component + projects {symbol,timeframe,bars_have,bars_need}; screener gaps-before-truncation, buy_threshold(min_conviction) floor, unknown-metric ValueError; servicer ValueError→INVALID_ARGUMENT; same-PR docs.
- Constitution: C-08/P-06, C-10; no proto/migration/config. Floor breaches: none.
- Status: → design-approved. (Part of 086-094 cohort — merge-order note already present.)

---

## Session 2026-08-02 — sdd-execute (implementation)
- agent `app/client.py`: extracted module-level `_build_component(c)` (shared by manage_strategy
  + screen_symbols); screen_symbols now maps `component=_build_component(c["component"])` for
  technical criteria and projects coverage_gaps as `{symbol, timeframe (common_pb2.Timeframe.Name),
  bars_have, bars_need}` with int64 bars as JSON strings. manage_strategy refactored to reuse the
  helper (removed its inline component loop).
- analysis `app/services/screener.py` `screen()`: coverage_gaps computed from the FULL sorted list
  BEFORE min_conviction + rank_limit truncation (AC-4); min_conviction honored as a hard floor via
  `scoring.buy_threshold(mc)` (AC-2, FR-4 parity); new `_validate_fundamental_metrics` raises
  ValueError on an unknown fundamental metric_name when fundamentals are available.
- analysis `app/handlers/servicer.py` `ScreenSymbols`: added `except ValueError` →
  `context.abort(INVALID_ARGUMENT, str(e))`.
- Tests (RED-first): test_screener.py +3 (min_conviction floor, gaps-survive-truncation,
  unknown-metric ValueError); test_analysis_servicer.py +1 (unknown-metric → INVALID_ARGUMENT);
  test_client.py rewritten coverage_gaps assertion for the new projection + a technical-component
  mapping assertion.
- Docs (C-10 same-PR): tools.py screen_symbols docstring, docs/runbooks/mcp-tools.md screen_symbols
  section + errors table. strat-lab plugin does not describe screen_symbols → no skill change.
- Verified: analysis 384 passed (coverage 82.8%), agent 138 passed (coverage 68.7%), ruff clean.
- No proto/migration/config change. Status: → code-completed.
