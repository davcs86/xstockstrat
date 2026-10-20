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

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- Warnings (spec-reviewer, 6), resolved in-place this session:
  - C-15 crit 2/8: no FR-N, no `@FR` tags. Added FR-1 (default deadline), FR-2 (caller fallbacks) and FR-3
    (success path unchanged) to product-spec.md. Tagged AC-1..AC-4 and appended `@AC-5 @FR-3` (healthy
    config read unchanged), so every FR has a scenario.
  - C-15 AC-2 tool contract: `extract_website_content` takes only `source_slug`, reads the URL from
    `config_json.url` and raises on `has_credentials=true` (`tools.py:549-577`). AC-2 rewritten around a
    registered source `acme-site`; it asserts `{raw_text}`.
  - C-15 AC-2 internal-state Thens: the policy-value assertion is now a Gherkin comment (supporting unit
    check). The Then is the consumer-observable return-within-bound.
  - C-15 AC-4 indirect Then: now HTTP 201 + `client_id` + `redirect_uris` (`oauth_server.py:141-143`),
    with `Given identity RegisterOAuthClient succeeds`. AC-3 now has healthy ingest/notify Givens and
    concrete `acme-signals`/`NVDA`/`buy` values, which keep the watchlist path (`tools.py:658+`) out.
  - Gherkin form: the stall precondition moved from the Feature description into a `Given` on AC-1..AC-4.
    Per-scenario rather than `Background`, because AC-5 needs a healthy config service.
  - C-14/C-10 crit 11: Consumer Surface now names `extract_email_content` (`urls` path, `tools.py:543`).
    DCR route corrected to `/oauth/register` (`main.py:227`).
- Notes (4):
  - C-01: product-spec.md re-anchored. `_POLICY_READ_TIMEOUT_S` is `tools.py:2367`; the `_fetch_url` reads
    are `:2397-2400`; `_agent_policy` is `tools.py:2370-2383` (the triage entry above cites `:2363-2370`,
    now stale). The propagating `except AioRpcError` is `client.py:1755-1758`.
  - F-07: a fixed-constant deadline is justified (config cannot bound its own read; precedent
    `_POLICY_READ_TIMEOUT_S`). design.md must record this, and the agent CLAUDE.md must document the new
    constant next to `_POLICY_READ_TIMEOUT_S`.
  - C-16: durable rule `services/xstockstrat-agent/acceptance/fix-opportunities-read-hangs.feature`
    `@AC-2 @feature-227` (fail before the MCP client's 60 s). Either D ≤ 3.0 s or the 227 `wait_for`
    (`tools.py:1551-1554`) stays. Recorded as a constraint in FR-1.
  - C-10 vs C-18: `client.get_config` (`client.py:2034-2046`, backs the `get_config` tool) is also
    undeadlined but is excluded by Out of Scope. Design must confirm that exclusion explicitly.
- Overlap findings (feature-overlap, WARN, file-level only; no key, proto or migration collision):
  - `app/tools.py` is shared with 241-fix-config-audit-author-spoof (`set_config`/`manage_signal_source`)
    and, conditionally, with 249-fix-ibkr-request-signing (`manage_account`). The functions are disjoint;
    whichever merges second rebases and re-runs agent pytest (`tests/test_tools.py`, `tests/test_client.py`).
  - `app/client.py` may also be shared with 241 (`client.set_config` author param, trunk `client.py:2100`,
    `:2142`). That is disjoint from `get_config_value` (`client.py:1729-1763`).
  - 240 is already on trunk (it shifted the tools.py anchors by +7). 215's agent edits are on trunk, with no
    live collision. 250 is telemetry-only. 243/244 overlap by theme only. 018 is demoted. No merge-order.md
    entry required.
- Operator decisions:
  OPERATOR DECISIONS (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Full design depth (operator overrode the triage 'quick' recommendation).
- Next: `/sdd-design fix-agent-getconfig-deadline` (full).
