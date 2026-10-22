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
