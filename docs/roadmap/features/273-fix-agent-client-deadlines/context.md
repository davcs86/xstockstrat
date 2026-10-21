# Context Log: fix-agent-client-deadlines

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-agent-client-deadlines-defect.md` (Issues disabled), sidecar
  `triaged` / `ref: feature:273-fix-agent-client-deadlines`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), finding D-16
  ("partly covered" in the scan by `2026-10-19-agent-get-config-value-no-deadline-defect`).
- Severity: SEV-2. Impact type: unbounded-rpc-hang. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-agent.
- Root cause hypothesis: per-call channel boilerplate with no shared call helper, so a default deadline had nowhere
  to live; deadlines were added only at call sites with a reported hang.
- D-16 reproduces on a053b0e. Counts unchanged vs the scan: 69 `secure_channel(` sites, 71 unary `stub.X(` calls,
  the only `timeout=` at `client.py:872` (`ListOpportunities`). No streaming calls in `client.py`. Channel factory
  `mtls.py:37-43` sets no deadline/keepalive.
- **Scope split with feature 247 (`247-fix-agent-getconfig-deadline`, implementation-ready):** 247 adds
  `_CONFIG_READ_TIMEOUT_S = 3.0` and `timeout=` to `get_config_value`'s `GetConfig` only (`client.py:1751`; its own
  Out of Scope says "Deadlines on other agent → backend RPCs"). This feature covers **every other** RPC, including
  the second `GetConfig` in `get_config` (`client.py:2043`). Reuse 247's constant style; do not alias or re-edit
  247's site. Sequence after 247 (both edit `client.py`).
- **Other overlaps:** features 240, 241, 245, 249 (all implementation-ready) also edit `services/xstockstrat-agent/app/client.py`
  / `tools.py` — expect textual conflicts; a sweeping "add timeout= to every call" diff should rebase last.
  `2026-10-19-agent-tools-missing-grpc-error-mapping-defect` (tools error mapping) affects how `DEADLINE_EXCEEDED`
  is surfaced — check its status at design. Open `2026-10-19-cross-hop-deadline-bounds-unenforced-defect` (PLAT-13)
  is the same nesting concern on the backend side.
- Design forks to settle: a shared call helper / channel option vs per-site `timeout=`; default value and the
  long-running budgets (`RunBacktest`, `TriggerBackfill`, `RunFundamentalsScan`, `ScreenSymbols`) relative to the
  MCP request timeout and `agent.opportunities.read_timeout_seconds` (PLAT-13); constants vs `agent.*` config keys;
  whether channel caching (D-16's other half) is in or out.
- Recommended design depth: quick → `/sdd-design fix-agent-client-deadlines quick` (rationale: SEV-2, single
  service, no proto/migration; a config-key choice is possible, which is itself a quick trigger). Escalate to full if
  design adopts cached channels or new config keys.
- Development branch: feature/fix-agent-client-deadlines

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-16 excluding the get_config_value call covered by 247-fix-agent-getconfig-deadline.
- Warnings (7):
  1. FR-3 coverage weak (C-15): AC-3/AC-6 each stall one call; `run_backtest` makes a single backend call
     (`tools.py:783`, `client.py:634`). **Resolved:** added @AC-8 (`ingest_signal` with IngestSignal and EmitAlert
     both stalled, a sequential chain).
  2. FR-3 feasibility unproven for multi-call tools (`instantiate_template`, `manage_watchlist` read-modify-write,
     config tools, `ingest_signal`). **Resolved in spec:** FR-3 now requires design to enumerate every tool with more
     than one sequential backend call and show its worst-case sum. `trigger_backfill` / `run_fundamentals_scan` are
     single-call (`tools.py:1387`, `:1416`), so 45 s fits.
  3. AC-4 compound plus wall-clock flakiness. **Resolved:** split into @AC-4 (slow success) and @AC-9 (never
     responds); the feature header now states the bounds are asserted with an injected/fake clock or a measured
     tolerance, not raw sleeps.
  4. AC-5 samples 9 of ~71 sites. **Resolved:** added @AC-10, a static (AST) check that every unary stub call in
     `client.py` passes `timeout=`; FR-1 cites it.
  5. FR-4 wording never asserted. **Resolved:** @AC-1 now asserts the "did not respond within" wording.
  6. Cross-feature 247 report reconciliation (247 `implementation-spec.md:82, :502-503` still plans
     `docs/reports/2026-10-21-agent-rpc-deadlines-defect.md`). **Open:** reconcile at 247 execute (not editable here).
  7. No explicit persona. **Resolved:** Problem Statement names the MCP client user / operator.
- Overlap findings (WARN only; no shared config key, proto field or migration):
  - 247-fix-agent-getconfig-deadline: same file `app/client.py` (247 edits `get_config_value` `:1751-1758`, adds
    `_CONFIG_READ_TIMEOUT_S`), `tests/conftest.py`, `tests/test_client.py`, comment-only `tools.py:2365-2366`.
    247 merges first; 273 rebases and does not re-edit 247's site.
  - 215-block-fundamentals-strategy-on-etf (in-progress): `client.py` / `tools.py` around `run_backtest`
    (tool summary/docstring region expected); verify at 215 execute.
  - 241-fix-config-audit-author-spoof (implementation-ready): `tools.py` / `client.py` (config-write path likely);
    verify at spec.
  - 249-fix-ibkr-request-signing (implementation-ready): `tools.py` broker-account tools; textual rebase only.
  - 244 references `tools.py:715`, `:1642-1662` as reference only; 251, 274, 084, 242-253 low risk.
  - Merge-order: no row exists. Recommended SOFT row (WARN, Resolved=No) for the router:
    `fix-agent-client-deadlines` (273) after `fix-agent-getconfig-deadline` (247), same-file overlap; also
    consider 215/241 rows at the impl-spec step. Not written by this step.
- Next: `/sdd-design fix-agent-client-deadlines` (quick).
