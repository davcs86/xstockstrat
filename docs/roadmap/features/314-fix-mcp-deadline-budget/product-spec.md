# Product Spec: fix-mcp-deadline-budget

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md, docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md, docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### Agent `extract_*` tools have no MCP-level cap on HTTP egress (SEV-2)

- **Observed:** `extract_email_content` / `extract_website_content` bound each URL fetch only by
  `agent.extract.connect_timeout_seconds` (10 s) and `agent.extract.read_timeout_seconds` (30 s);
  `extract_email_content` fetches serially, so >2 slow URLs run past the MCP client's 60 s timeout. Residual (feature
  273 R7): `indicators.sandbox.timeout_ms` can be set so a long `test_formula` dry run ends in the agent's client
  deadline instead of the sandbox's own timeout.
- **Expected:** the tool call returns within the MCP budget (whole-call deadline or URL-count / total-time cap),
  returning texts gathered so far plus a clear error for the rest; the sandbox timeout has a SetConfig ceiling
  below the agent's `ExecuteFormula` deadline.
- Report: [docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md](../../../reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md)

### Agent `list_opportunities` worst case (68 s) exceeds the MCP client's 60 s timeout (SEV-2)

- **Observed:** `ValidateToken` auth (10 s) + `opportunities.read_timeout_seconds` policy read (3 s) + analysis
  `ListOpportunities` deadline (SetConfig ceiling 55 s) = 68 s > 60 s; the MCP client gives up before the tool's
  "upstream did not respond" message.
- **Expected:** auth + policy read + `ListOpportunities` deadline < 60 s (report suggests a ceiling of 45 → 58 s),
  with the floor kept above analysis's own worst case.
- Report: [docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md](../../../reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md)

### Cross-hop read deadline ordering is not enforced by config bounds (SEV-3)

- **Observed:** `SCALAR_BOUNDS_REGISTRY` bounds each key independently: `portfolio.marketdata.quote_timeout_ms`
  `[500,8000]` overlaps `marketdata.quotes.batch_timeout_ms` `[500,5000]`; `analysis.opportunity.live_enrich_timeout_ms`
  min 500 is below `marketdata.price.batch_timeout_ms` max 2500. Two valid writes invert the ordering, silently
  yielding unpriced positions / unenriched opportunities.
- **Expected:** `SetConfig` rejects writes that break the documented cross-key ordering, or the bounds are made
  non-overlapping.
- Report: [docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md](../../../reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md)

## Reproduction Steps

1. Extract: serve three URLs that trickle bytes just inside the 30 s read timeout; call
   `extract_email_content(source_slug=<source without credentials>, urls=[the three URLs])` over MCP → client times
   out at 60 s.
2. Opportunities: `set_config agent opportunities.read_timeout_seconds 55` (accepted); stall analysis
   `ListOpportunities` and slow identity `ValidateToken` to ~10 s; call `list_opportunities` → client times out at 60 s.
3. Cross-hop: `SetConfig portfolio.marketdata.quote_timeout_ms = 1000` and `marketdata.quotes.batch_timeout_ms =
   5000` (both accepted); request positions with cold quotes → positions come back without live prices.

## Root Cause Hypothesis

Each budget is sized per hop or per key; nothing bounds the whole agent tool call, and cross-key invariants live
only in comments. Current sites (spot-checked on main-dev 0fecb24d):

- `services/xstockstrat-agent/app/tools.py:609` (serial `for url in urls`), `:2699` (per-request read timeout only).
- `services/xstockstrat-agent/app/tools.py:1760` (`opportunities.read_timeout_seconds` policy read);
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts:150` (`agent.opportunities.read_timeout_seconds`
  `[30,55]`).
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts:144,149,153,155` (the four cross-hop keys, per-key bounds).
- R7 residual moved since the report: `ExecuteFormula` now uses `formula_deadline_s()`
  (`services/xstockstrat-agent/app/client.py:1121`, sandbox timeout + startup grace + margin, capped at 45 s) and
  `indicators.sandbox.timeout_ms` now has a bound `[100,33000]` (`configServiceImpl.ts:176`). Recon must re-verify
  whether the residual still reproduces.

## Affected Services

- xstockstrat-agent (extract tools, `list_opportunities`)
- xstockstrat-config (`SCALAR_BOUNDS_REGISTRY` / SetConfig validation)
- xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-analysis (callers/callees whose deadlines the cross-hop
  bounds govern)

## Fix Scope

- Proto changes anticipated: **no** — all three reports fix config bounds/validation and agent-side budgets.
- DB migrations anticipated: **no** — bounds live in code (`SCALAR_BOUNDS_REGISTRY`); a migration only if a seeded
  value falls outside a tightened bound.
- Config key changes anticipated: **yes** — SetConfig ceilings change (`agent.opportunities.read_timeout_seconds`,
  cross-hop keys, possibly `indicators.sandbox.timeout_ms`); a whole-call extract budget key may be added.

## Open Questions

1. Cross-hop enforcement shape: cross-key validation in `SetConfig` vs. non-overlapping per-key bounds (the report
   offers both).
2. Extract budget shape: whole-call deadline vs. URL-count cap vs. total-time cap, and whether it is a new config key.
3. New `agent.opportunities.read_timeout_seconds` ceiling (report suggests 45) and confirmation the floor (30) still
   clears analysis's own worst case.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- The per-URL config-stall cost of extract policy reads (separate, pruned report
  `2026-10-29-agent-config-snapshot-read-defect.md`).
- Refactoring unrelated to the bug; performance improvements unrelated to the fix.
