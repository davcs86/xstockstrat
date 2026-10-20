# Context Log: fix-agent-getconfig-deadline

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md`
  (Issues disabled). Source: Latent-bugs row in `docs/context-constitution-findings.md:33` (flagged by feature 227).
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), context.md.
- Affected services: xstockstrat-agent (dependency: xstockstrat-config, unchanged).
- Root cause hypothesis: `GetConfig(` at `client.py:1751-1754` passes no `timeout=`; feature 227 bounded only
  `list_opportunities` via `asyncio.wait_for(…, _POLICY_READ_TIMEOUT_S)`.
- Confirmation evidence: the report's stall reproduction was not re-run at triage. A code read on main-dev @
  37b9a56 confirms the following:
  - no `timeout=` on `GetConfig`;
  - every caller already catches `Exception`, so the fallback paths exist: `_agent_policy`
    (`tools.py:2363-2370`), `ingest_signal` (`:625-635`, default 0.6 at `:77`) and DCR (`oauth_server.py:82-110`).
  So the fix is the deadline alone; each caller's degradation is already defined.
- Design forks for /sdd-design:
  - The deadline value, and whether `client.get_config_value` takes an optional `timeout` parameter.
  - Whether the feature-227 `wait_for` at `tools.py:1550-1556` stays (defence in depth) or is removed.
  - `_fetch_url`'s four serial reads cost up to 4 × D on a stall (AC-2 bound). `GetConfig` already returns the
    whole namespace snapshot, so one snapshot read or a `gather` could cut that to 1 × D. That would be a
    scope addition, so the decision is for design.
  - The deadline must not shorten the success path for a slow-but-healthy config service.
- Recommended design depth: quick → `/sdd-design fix-agent-getconfig-deadline quick` (rationale: SEV-2,
  single service changed, no proto/migration/config key).
- Development branch: feature/fix-agent-getconfig-deadline
