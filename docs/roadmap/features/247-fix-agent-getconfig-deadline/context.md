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

## Session 2026-10-20 — sdd-review product-spec (re-run)

- Re-review result: PASS WITH WARNINGS (8 warnings, 3 notes). Status stays `spec-ready` (2a69273a set it).
  feature.md has a `re-review` row, not a second `draft → spec-ready` row.
- The verdict's line refs come from the pre-2a69273a draft (no FR-N, `@AC-n @regression` at
  acceptance.feature:7/12/20/26, stall prose at :4, tools.py `:2360`/`:2390-2393`), not the current files.
  Each warning checked against the current tree:
  - crit 2/8, FR traceability: already resolved (FR-1..FR-3 at product-spec.md:28-40, `@FR-*` tags).
  - AC-2 tool API: already resolved (`source_slug "acme-site"`, `config_json.url`, acceptance.feature:12-21).
    A spy on `egress.build_pinned_client` proves the default limits as a supporting unit check, not a Then.
  - AC-3/AC-4 concreteness: already resolved (acceptance.feature:23-38; 201 + `client_id` + `redirect_uris`).
  - Shared precondition: already resolved as a per-scenario Given. A `Background:` was rejected because
    AC-5 needs a healthy config service.
  - Non-regression scenario: already resolved (`@AC-5 @FR-3`, acceptance.feature:40-44). Open for design:
    freeze D (acceptance.feature:4) together with the AC-1..AC-4 bounds.
  - C-14 consumer surface: already resolved (`extract_email_content` `urls` path, product-spec.md:19, :61).
  - crit 1, persona: resolved this session. "Who is hit" added to the Problem Statement (MCP client /
    Claude.ai remote connector, DCR client).
  - C-01 evidence drift: the spec anchors match this branch. Verified tools.py:77, :543, :627, :1551-1554,
    :2367, :2397-2400; client.py:1751-1758; oauth_server.py:84, :104; main.py:227. main-dev @ 53e27630
    shifts tools.py lines ≥2100 by +4 (73893ec1, #1269, `record_order` UUID nonce), so `_POLICY_READ_TIMEOUT_S`
    is :2371 and the `_fetch_url` reads are :2401-2404 there. /sdd-spec re-derives anchors on its base.
- Notes (3):
  - F-07/C-05: compliant. design.md must record the fixed-constant rationale and must not mint a new
    `agent.*` key. Design must also reconcile the comment "Fixed bound on the undeadlined GetConfig policy
    read" (tools.py:2365) and decide the 227 `wait_for` (tools.py:1550-1556). C-18 applies to the
    optional-`timeout`-parameter fork.
  - Criteria 3-7 and 9 PASS; 10 is N/A. Callers verified: `_agent_policy` tools.py:2374, `ingest_signal`
    :627, DCR oauth_server.py:84 and :104. `AioRpcError` is re-raised at client.py:1755-1758.
  - Trading-domain checks C-1..C-5 skipped (non-trading).
- Overlap findings (feature-overlap, WARN, file-level only). Regions are disjoint, so a rebase is enough:
  - client.py `get_config_value` :1751-1754 also collides with:
    - 240-offline-account-full-pnl (code-completed): Step 24 `confirm_offline_order` :2245-2271.
    - 215-block-fundamentals-strategy-on-etf (in-progress): `run_backtest` :561, `_opportunity_to_dict`
      :782-804.
  - tools.py :627, :1552-1553, :2367, :2397-2400 also collide with:
    - 240: `manage_offline_account` :2035.
    - 241-fix-config-audit-author-spoof (draft): `set_config` :1642-1694.
    - 215: docstrings :735, :760-763 (`list_opportunities` left unextended).
  - No config-key, proto or migration collision, so no merge-order.md entry is needed.
- Operator decisions:
  OPERATOR DECISIONS (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Full design depth (operator overrode the triage 'quick' recommendation).
- Next: `/sdd-design fix-agent-getconfig-deadline` (full).

## Session 2026-10-20 — sdd-design

- Phase 0 Recon: wrote recon.md.
  - Services: xstockstrat-agent only (config is the stalled dependency and is unchanged).
  - Key reuse patterns:
    - the `list_opportunities` `timeout=` stub-kwarg shape (`client.py:853`, `:872`);
    - the call-time constant shape of `_POLICY_READ_TIMEOUT_S` (`tools.py:2365-2367`).
- Phase 1 Grilling: 2 rounds (full). The r2 adversary returned SOUND. Auto-approved under the operator standing authorization (rounds >= 2, 0 Floor breaches, 0 blocking objections, 0 CHANGEs).
- Chosen approach:
  - Add the `_CONFIG_READ_TIMEOUT_S = 3.0` constant in client.py, read at call time.
  - Pass `timeout=` on `GetConfig` in `get_config_value` (`client.py:1751-1754`).
  - Bind `as e` and log `e.code().name` in the existing `except` (`:1755-1758`). Re-raise kept.
  - Callers are unchanged.
  - The 227 `wait_for` is kept, and its comment at `tools.py:2365-2366` is rewritten.
  - The false comment at `oauth_server.py:102` is corrected (comment only).
  - A threaded `hung_config_server` is added in `tests/conftest.py`.
- Rejected:
  - per-call-site deadlines;
  - D as a config key (circular, F-07);
  - a per-call `timeout` kwarg (C-18);
  - `asyncio.wait_for` inside the helper (breaks the `AioRpcError` contract);
  - removing the 227 `wait_for` (C-16 CHANGE, uncovered);
  - `gather` or a snapshot read in this feature (deferred);
  - deadlining `get_config` too (excluded);
  - fail-closed DCR (contradicts FR-2/AC-4).
- Decisions:
  - D = 3.0 s is fixed, not a config key.
  - Serial reads use option (a): `_fetch_url` = 4×D, DCR = 2×D.
  - Three follow-ups are to be materialized as `docs/reports/` defect reports plus `.status` sidecars (C-14): `agent-config-snapshot-read`, `agent-dcr-fail-closed`, `agent-rpc-deadlines`.
  - The harness is sync threaded rather than `grpc.aio`, because the `TestClient` portal loop needs it.
  - AC-1 runs at the production D.
- Constitution rules touched: C-01, C-10, C-11, C-13, C-14, C-15, C-16, C-18, F-07, P-02, P-06, How-to-Act #3/#5, PLAT-N1. Floor breaches: none.
- Business rules: PRESERVE `@AC-2 @feature-227`, `@AC-8 @feature-207`, `@AC-5 @feature-210` (plus recon.md:101-106). EXTEND with new `@AC-1..5 @feature-247`. No CHANGE.
- Open Threads (from design.md Open Risks):
  - `extract_email_content` stays over the MCP 60 s limit during a stall for N >= 5 URLs (N×4×D). Target: the docs step; materialize the `agent-config-snapshot-read` report.
  - SECURITY POSTURE CHANGE: DCR fails open on a config stall of D or more (`registration_enabled=false` and the allowlist are bypassed; identity enforces only https). Target: the service step (`oauth_server.py:102` comment) and the docs step (`agent-dcr-fail-closed` report).
  - D = 3.0 s is unsized; there is no healthy `GetConfig` p99. Target: the docs/smoke step; status-code log plus a dev latency capture before promotion.
  - `client.get_config` and `register_oauth_client` are still undeadlined. Target: the docs step (`agent-rpc-deadlines` report).
  - The RPC deadline and the 227 `wait_for` race at 3.0 s. Target: the test step; no test pins which timer fires first.
  - Harness leak or vacuous-pass risk. Target: the harness step: `is_active()` loop, `max_workers=8`, lock-guarded `entered`, `stop(0).wait()`.
  - Timing-bound flake on CI at D = 0.3 s; AC-1 adds about 3 s. Target: the test step.
  - Anchor drift: `register` is at `oauth_server.py:72`; main-dev `tools.py` is +4 from about L2100. Target: `/sdd-spec` re-derives on its base.
- Status: spec-ready → design-approved.

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status: design-approved → implementation-ready.
- Steps:
  1. test: `hung_config_server` + `HANG_GUARD_S` in `tests/conftest.py`; AC-1/AC-5 + P-06 pins + DEADLINE_EXCEEDED log test in `tests/test_client.py`.
  2. test: AC-2, AC-3, `extract_email_content(urls=)` in `tests/test_tools.py`; AC-4 in `tests/test_oauth.py`.
  3. service: `_CONFIG_READ_TIMEOUT_S`, the `timeout=` kwarg, `except … as e` / `e.code().name` in `app/client.py`; comment rewrites `tools.py:2365-2366`, `oauth_server.py:102`.
  4. docs: agent CLAUDE.md `:193-194`/`:205`, agent context-constitution `:40`, agent findings `:28`, root findings `:33`.
  5. docs: three follow-up reports + `.status` (`open`) + agent findings index rows; teardown audit.
  6. docs: dev `GetConfig` latency baseline from OTel client spans before the integration PR.
- Coverage: AC-1, AC-5 → Step 1; AC-2, AC-3, AC-4 → Step 2. Each design §5 test mandate is mapped to a step in the spec's mandate table (ledger `fails.md:2810-2812`).
- Key codebase findings (branch @ 0da14ffc):
  - `client.py:1751-1754` is the only change site. `CONFIG_ENDPOINT` is `:23` (endpoint block `:20-28`). The only existing `timeout=` is `list_opportunities` `:853`, `:872`.
  - The `conftest.py` autouse `set_env` patches only the env var `CONFIG_ENDPOINT`, never `client.CONFIG_ENDPOINT` (`:60`), so the harness patches the attribute itself.
  - Before Step 3, `client._CONFIG_READ_TIMEOUT_S` is absent. The tool/endpoint tests therefore use `monkeypatch.setattr(..., raising=False)`, so RED fails on the missing deadline and not on `AttributeError`.
  - `TestClient` is sync and cannot take an `asyncio.wait_for` guard. AC-4 runs in a worker thread with `fut.result(timeout=HANG_GUARD_S)` and `shutdown(wait=False)`. A `with ThreadPoolExecutor` exit would join the hung worker before teardown.
  - Anchor corrections vs recon/design: `register` is at `oauth_server.py:72`; `extract_website_content` at `tools.py:549`; email `_get_source`/credentials raise at `:528`/`:530-531`; agent findings index rows at `:65-69`.
- Decisions:
  - Comment edits fold into the service Step 3, so every code-bearing step pairs with Steps 1-2 (C-08).
  - The root findings `:64` index row stays until the report resolves at launch (rule at `:59-60`).
  - `docs/runbooks/mcp-tools.md` is checked and unchanged (`:209`, `:1697`; the tool contracts do not change).
  - AC-5 is a FR-3 characterization: red N/A, recorded via the tdd-gate escape.
  - `tests/test_list_opportunities_deadline.py` is not edited (keeps its private `_HANG_GUARD_S`).
  - The follow-up report filenames carry the execution date (`YYYY-MM-DD`), and each report carries the single severity token `SEV-2`.
- Next: `/sdd-review fix-agent-getconfig-deadline impl-spec`.

## Session 2026-10-21 — sdd-review impl-spec (advisory)

- Result: criteria FAIL (1 failure, 7 warnings), Floor breaches none; overlap WARN (8 file-level, disjoint regions). Advisory, did not block. Status stays `implementation-ready`.
- Deviation from `.claude/skills/sdd-review/SKILL.md` § MODE B B3 ("do not modify implementation-spec.md"): the workflow step for this run told me to fix the findings in the spec. The changes are evidence and instruction corrections only. Step count, step order and lifecycle are unchanged.
- Addressed in implementation-spec.md (each claim re-verified on the branch @ 1d43a224):
  - [x] C-08: Step 1 and Step 2 **Verification** blocks now run `uv run --no-sync pytest --cov=app --cov-fail-under=40`. This is the agent CI gate (`.github/workflows/ci.yml:358-360`).
  - [x] C-01 anchors:
    - client.py endpoint block `:21-29`, `CONFIG_ENDPOINT` `:24`, insert after `:29`;
    - `_setup_gen_path()` call `conftest.py:48`, `set_env` `:51-52`;
    - mocked-stub patches `test_client.py:821-823`.
  - [x] Verification blocks: every `cd` now runs in a `( … )` subshell, so root-relative greps still resolve (Steps 1-3).
  - [x] Step 1 fixture instructions:
    - `import grpc`, `from app import client` and the `gen.config.v1` import go inside the fixture body (`conftest.py:3-8` has neither; the gen path resolves only after `:48`);
    - usage unified to `handle = hung_config_server(...)`;
    - Evidence now cites `client.log` (`client.py:19`) and `add_ConfigServiceServicer_to_server` (`config_pb2_grpc.py:119`).
  - [x] Step 2:
    - adds the `asyncio`, `time` and `from app import tools` imports, plus `HANG_GUARD_S` on `test_tools.py:18`;
    - Evidence cites the patch targets `test_tools.py:99` and `:378-379`.
  - [x] Step 5:
    - filenames pinned to `2026-10-21`; a later execution date goes in the Deviation Log (F-08);
    - the 7-file advisory is stated;
    - teardown drift fixes outside **Files** must be added to the Deviation Log first;
    - the new index rows go under a new `## Filed as defect reports (2026-10-21)` section, not the `(2026-10-19)` heading (agent findings `:58`).
  - [x] Step 6:
    - the conflicting "requires Step 3 merged" dependency is removed; Step 6 now runs before Step 3 is committed;
    - a missing Grafana trace access routes to "Not measured" + P-03 escalation;
    - the entry must record the query text, UTC window, count, p50, p99 and max, and Verification greps for them.
  - [x] Step 4: Evidence records why `_CONFIG_READ_TIMEOUT_S` goes in the `CLAUDE.md:205` row and not a new row. The `:195-205` table lists config keys, and the constant is not one. This is a design.md §6 wording deviation with the same intent.
- Still open, carried into execution:
  - [ ] Step 6 ordering: the step stays numbered 6, but it must run before Step 3 is committed. `/sdd-execute next|sequential` picks steps by number, so the operator must run Step 6 out of order (or accept the Step 3-landed fallback).
  - [ ] Step 6 Verification is still a grep of `context.md`. It proves the entry exists and has its fields; it cannot prove the query ran. The operator confirms at the checkpoint.
  - [ ] Step 6 needs Grafana Cloud trace access the executor may not have. The fallback is "Not measured" + escalation (P-03).
  - [ ] C-18/DRY: `conftest.HANG_GUARD_S = 10` duplicates `tests/test_list_opportunities_deadline.py:17` `_HANG_GUARD_S`, and the two 3.0 s constants stay separate. design.md accepts both (How-to-Act #3, Rejected Alternatives). The jscpd pre-commit hook may still flag them, which is an operator call at Step 1.
  - [ ] Overlap WARN (file-level, disjoint regions). Whichever merges second rebases and re-runs `tests/test_client.py` + `tests/test_tools.py`:
    - `app/client.py` with 240 (Step 24, `:2245-2271`), 215 and 241 (predictive);
    - `app/tools.py` with 240, 241, 249 and 215;
    - `services/xstockstrat-agent/CLAUDE.md` with 240 (`:83`, `:86-87`).

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Mode entry: `/sdd-execute fix-agent-getconfig-deadline sequential`, run by `/sdd-batch-execute` in an isolated worktree.
  The up-front plan was confirmed by the operator's standing authorization (operator chat 2026-10-28,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276"). Answers recorded:
  - checkpoints are unattended, with mode `report`;
  - C-16 promotion is auto-confirmed unless it changes an existing `@AC` rule;
  - merge-train is authorized; 255 and 275 are deferred;
  - operator-only DB/prod steps: open the PR and hold the merge.
- Branch setup (§5.3): `git merge -X ours origin/main-dev` into the detached checkout (merge 1f08ebf8, pushed).
- Status: `implementation-ready` → `in-progress`.
- Re-spec (commit 189edd1c, "respec(fix-agent-getconfig-deadline): align steps 1,2,3,4,5,6 with current codebase"):
  every Files path exists and every cited symbol resolves. `_CONFIG_READ_TIMEOUT_S` and `hung_config_server`
  are still absent. Only line anchors drifted after the main-dev merge:
  - `app/client.py` +1: `get_config_value` `:1730`, `GetConfig(` `:1752`, `except` `:1756`, warning `:1758`,
    `get_config` `:2035-2047`, `register_oauth_client` `:1356`, `list_opportunities` `timeout` `:854`/`:873`.
  - `tests/test_client.py` +12: `TestGetConfigValueClient` `:815`, stub patches `:833-835`, asserts `:856-861`,
    transport-error model `:878`.
  - `app/tools.py` +13: comment `:2378-2379`, `_POLICY_READ_TIMEOUT_S` `:2380`, `_agent_policy` `:2383`,
    `_fetch_url` `:2399`, four reads `:2410-2413`, `build_pinned_client` `:2421`; `ingest_signal` read `:627-637`;
    227 `wait_for` about `:1560-1563`.
  - `identityServiceImpl.ts` https-only check `:385-388`; root findings latent row `:34`, Resolved `:51`,
    Filed rule `:61`, index `:65`; `mcp-tools.md` threshold row `:1698`; CI coverage gate is now the
    `pytest with coverage` step (`ci.yml` about `:406-411`, agent matrix `:368-369`).
  - The Step Dependencies "Anchor base" note (@ 0da14ffc) is outside the re-spec scope; the step bodies now
    carry the 2026-10-28 anchors.
- Step 6 expectation: the Grafana_Cloud MCP server failed to connect in this session (HTTP 424), so the
  spec's own fallback applies. Record "Not measured" with that reason and escalate (P-03) to the operator
  before Step 3 is committed.

### Step 1 — test: hung_config_server harness + client-level RED tests (2026-10-28)

- Files: `services/xstockstrat-agent/tests/conftest.py` (`HANG_GUARD_S = 10`, fixture `hung_config_server`:
  sync `grpc.server(ThreadPoolExecutor(max_workers=8))`, lock-guarded `entered`, `is_active()` hang loop,
  `stop(0).wait()` teardown, patches `client.CONFIG_ENDPOINT` + `client.mtls.secure_channel`);
  `services/xstockstrat-agent/tests/test_client.py` (AC-1, AC-5, three P-06 tests in `TestGetConfigValueClient`).
- TDD red (pre-Step-3 tree), each for the specified reason:
  - AC-1 red: `TimeoutError` from the `HANG_GUARD_S` guard (no deadline on `GetConfig`).
  - `test_getconfig_carries_default_deadline` red: `assert 'timeout' in {'metadata': []}`.
  - `test_deadline_constant_is_read_at_call_time` red: `KeyError: 'timeout'`.
  - `test_deadline_exceeded_is_surfaced_and_logged_by_code` red: `'DEADLINE_EXCEEDED' in caplog.text` failed
    (log is `GetConfig failed for agent.k` with no code).
  - AC-5: red N/A — FR-3 characterization (passes pre-fix, non-regression guard).
- Green is Step 3's run. A temporary, reverted probe of the Step 3 change gave 5/5 passed, so the harness is sound.
- Verification: ruff check + format clean; full suite 4 failed (the RED four) / 518 passed, coverage 81.23% (≥40);
  harness greps and `from tests.conftest import HANG_GUARD_S` present.
- Still open: Step 6 (dev `GetConfig` latency baseline) must run before Step 3 is committed; Grafana_Cloud MCP is
  unavailable in this session, so the spec fallback ("Not measured" + P-03 escalation) applies.

### Step 2 — test: tool and endpoint stalled-config RED tests (2026-10-28)

- Files: `services/xstockstrat-agent/tests/test_tools.py` (imports `asyncio`, `time`, `tools`, `HANG_GUARD_S`;
  `test_ac2_extract_website_content_proceeds_on_stalled_config` with the `egress.build_pinned_client` spy and the
  `_agent_policy` recorder, `test_extract_email_content_urls_proceeds_on_stalled_config`,
  `test_ac3_ingest_signal_alerts_at_default_threshold_on_stalled_config`);
  `services/xstockstrat-agent/tests/test_oauth.py` (`test_ac4_register_does_not_hang_on_stalled_config`, worker-thread
  guard with `executor.shutdown(wait=False)`). All set D = 0.3 via `monkeypatch.setattr(..., raising=False)`.
- TDD red (pre-Step-3 tree):
  - AC-2 red: `TimeoutError` from the `HANG_GUARD_S` guard (the first policy read never returns).
  - `extract_email_content` urls red: `TimeoutError` from the `HANG_GUARD_S` guard.
  - AC-3 red: `TimeoutError` from the `HANG_GUARD_S` guard (the threshold read never returns).
  - AC-4 red: `concurrent.futures.TimeoutError` from `result(timeout=HANG_GUARD_S)`.
- Green is Step 3's run. A temporary, reverted probe of the Step 3 change gave 4/4 passed in 4.5 s.
- Verification: ruff check + format clean; full suite 8 failed (Step 1 + Step 2 RED tests) / 518 passed,
  coverage 81.47% (>= 40); `from tests.conftest import`, `hung_config_server` and `raising=False` greps present.
- In RED only, AC-4's orphaned worker logs `DCR failed: mtls …` after teardown (Deviation Log); harmless.
- Still open: Step 6 (dev `GetConfig` latency baseline) must run before Step 3 is committed.
