# Recon: fix-agent-getconfig-deadline

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-agent (xstockstrat-config is the stalled dependency only; no change)

---

## Objective

`client.get_config_value` sends a one-shot `GetConfig` with no `timeout=`, so a config service that accepts
connections but stalls blocks every caller indefinitely. Callers are `_fetch_url` (extract tools), the
`ingest_signal` post-commit threshold read and OAuth DCR. The fix applies a default gRPC deadline D inside the
helper (FR-1), so each caller takes its existing `except Exception` fallback on expiry (FR-2) while a healthy
read stays unchanged (FR-3). Bug, SEV-2. One service, with no proto, migration or config-key change.

## Codebase Map

- **`xstockstrat-agent`** (Python 3.13, `uv`; pytest `asyncio_mode = "auto"`, `pyproject.toml:32`)
  - Entry point: `main()` at `app/main.py:249`. `build_http_app` (`:90`) calls `register_tools(server)` (`:79`), which is defined at `app/tools.py:363`.
  - Handlers:
    - MCP tools are inside `register_tools` (`app/tools.py:363`).
    - The DCR handler is `register` (`app/oauth_server.py:70`), routed by `Route("/oauth/register", …)` at `app/main.py:227`.
  - Last migration: none. The agent owns no schema and has no `services/xstockstrat-agent/migrations/`.
  - Config-read pattern: `client.get_config_value` (`app/client.py:1729`) issues `stub.GetConfig(GetConfigRequest(namespace, environment, user_id), metadata=_metadata())` at `:1751-1754`, with no `timeout=`. `except grpc.aio.AioRpcError: log.warning(...); raise` is at `:1755-1758`, and the oneof projection is at `:1759-1763`.
  - Other key symbols:
    - `CONFIG_ENDPOINT` is a module global (`app/client.py:24`), so it can be monkeypatched. `ANALYSIS_ENDPOINT` is at `:23`.
    - `_metadata(*extra)` — `app/client.py:59`.
    - `_config_env` — `app/client.py:2021`.
    - `mtls.secure_channel(endpoint, target_service)` → `grpc.aio.secure_channel(..., options=[("grpc.ssl_target_name_override", …)])` — `app/mtls.py:37-43`.
    - `resolve_scope` — `app/scopes.py:21`. The `_resolve_scope` wrapper is at `app/tools.py:1588`.
    - `_agent_policy(key, default, cast)` — `app/tools.py:2370-2383`. The try is at `:2373`, the call at `:2374`, `except Exception:` at `:2375`, the log "agent policy read failed; using safe default" at `:2376`, and `return default` at `:2377`.
    - `_POLICY_READ_TIMEOUT_S = 3.0` — `app/tools.py:2367`. Its comment at `:2365-2366` says "Fixed bound on the undeadlined GetConfig policy read; looked up at call time (never bound as a default argument) so tests can monkeypatch it".
    - `_fetch_url` (`app/tools.py:2386`) makes four serial reads at `:2397-2400`. The defaults are 5, 5_000_000, 10.0 and 30.0.
    - `_fetch_url` callers:
      - `extract_email_content` calls it inside `for url in urls` (`app/tools.py:542-543`), i.e. once per URL.
      - `extract_website_content` calls it at `:577`, after the `_get_source` lookup and the `has_credentials` raise (`:561-569`).
    - `ingest_signal` threshold read: `app/tools.py:625-635`. `env = _resolve_scope("")` is at `:625`, the read at `:627`, `except Exception as e:` at `:633` and `alert_threshold = _ALERT_THRESHOLD_DEFAULT` at `:635`. The read runs before the auto-alert (`:636-657`) and the watchlist auto-add (`:660-668`).
    - `_ALERT_THRESHOLD_DEFAULT = 0.6` — `app/tools.py:77`. `_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"` — `:78`.
    - DCR reads:
      - `oauth.registration_enabled`: the read is at `app/oauth_server.py:84`, caught at `:87`; `reg_enabled = None` at `:89`.
      - `oauth.allowed_redirect_uris`: the read is at `:104`, caught at `:107`; `allowed_raw = None` at `:109`.
      - After both, the `register_oauth_client` call (`:136`) returns 201 at `:141-143`.
    - Feature-227 wrapper: `asyncio.wait_for(_agent_policy("opportunities.read_timeout_seconds", 40.0, float), _POLICY_READ_TIMEOUT_S)` at `app/tools.py:1551-1554`. `except TimeoutError:` logs "agent policy read timed out; using safe default" and sets `timeout_s = 40.0` (`:1555-1557`). The non-finite/≤0 guard is at `:1558-1559`. The deadline reaches `client.list_opportunities(..., timeout=timeout_s)` at `:1561-1563`.
    - `_grpc_error_message(exc, ..., *, deadline_s=None)` — `app/tools.py:223-231`, with a `DEADLINE_EXCEEDED` branch at `:228-231`. No `get_config_value` caller uses it; all of them swallow the error and fall back.
    - Second undeadlined `GetConfig`: `client.get_config` (`app/client.py:2034-2046`, call at `:2043`), which backs the `get_config` tool. It is excluded by product-spec Out of Scope.
    - `register_oauth_client` (`app/client.py:1355-1367`) has no `timeout=` and sits on the AC-4 path. It is out of scope ("Deadlines on other agent → backend RPCs"), and AC-4 mocks it.
    - The proto is `ConfigService.GetConfig` (`packages/proto/config/v1/config.proto:23`). It returns `ConfigSnapshot` (`:49`), the whole namespace map, which is the basis for the single-snapshot fork.

All `get_config_value` call sites in `app/` (grep, 2026-10-20) are `tools.py:627`, `tools.py:2374`,
`oauth_server.py:84` and `oauth_server.py:104`. No other caller exists.

## Patterns to REUSE

- **Per-call gRPC deadline** → reuse the `list_opportunities` shape: a `timeout: float | None = None` kwarg passed
  straight to the stub as `timeout=timeout` (`app/client.py:853`, `:872`). It is the only `timeout=` in
  `client.py`, so no module deadline constant exists to share.
- **Fixed deadline invariant (F-07-exempt, not a config key)** → reuse the shape of `_POLICY_READ_TIMEOUT_S`
  (`app/tools.py:2365-2367`): a module constant read at call time, never bound as a default argument, so tests
  can monkeypatch it (227 `design.md:211`). A `def get_config_value(..., timeout=D_CONST)` default-arg binding
  would freeze the value at import and break that test seam.
- **Error propagation** → keep `except grpc.aio.AioRpcError: … raise` (`app/client.py:1755-1758`). A `DEADLINE_EXCEEDED`
  is an `AioRpcError`, so every caller's existing `except Exception` already catches it with no new handler:
  `tools.py:2375`, `:633` and `oauth_server.py:87`, `:107`.
- **Hung-server RED harness** → mirror `_start_hung_analysis_server` (`tests/test_list_opportunities_deadline.py:26-40`).
  - Server: `grpc.aio.server()`, a servicer whose handler sets `entered` and awaits `asyncio.Event().wait()`, bound to `127.0.0.1:0`.
  - For config, swap in `config_pb2_grpc.ConfigServiceServicer.GetConfig` (`from gen.config.v1 import config_pb2, config_pb2_grpc`, as imported in `tests/test_client.py:816`).
  - Redirect: `monkeypatch.setattr(client, "<X>_ENDPOINT", f"127.0.0.1:{port}")` plus `monkeypatch.setattr(client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep))` (`:48-51`).
  - Hang guard: `_HANG_GUARD_S = 10` (`:17`) as an outer `asyncio.wait_for`. pytest-timeout is not a dev dependency (`pyproject.toml:21`; 227 `design.md:257`).
  - Elapsed bound: `time.monotonic()` (`:58-61`).
- **Captured-kwarg assertion** → `_captured_timeout` (`tests/test_list_opportunities_deadline.py:70-74`) patches the
  client fn with `AsyncMock` and reads `call_args.kwargs["timeout"]`. For the helper itself, extend
  `TestGetConfigValueClient` (`tests/test_client.py:803`):
  - it mocks the stub with `_channel_cm` (`:70`), `patch("app.client.mtls")` and `patch.object(config_pb2_grpc, "ConfigServiceStub", …)`;
  - the existing assertions on `GetConfig.call_args.args[0]` / `.kwargs["metadata"]` (`:844-850`) survive a new `timeout` kwarg;
  - the `UNAVAILABLE` propagation test (`:866`) is the model for a `DEADLINE_EXCEEDED` one.
- **Tool-level tests**:
  - `_make_server` / `_tool_fn` — `tests/test_tools.py:21` / `:27`.
  - `_website_source(slug, url, *, has_credentials=False)` — `:2002`.
  - SSRF seams `_patch_resolver` (`:2015`) and `_patch_inner_connect` (`:2024`).
  - respx public-URL happy path — `test_extract_website_content_fetches_url` (`:244`).
  - Ingest fallback — `test_ingest_signal_survives_threshold_read_failure` (`:444`). Alert above threshold — `:370`.
- **DCR tests** → `TestClient(build_http_app())` (`tests/test_oauth.py:17-19`), with identity mocked at
  `client.register_oauth_client` (`:182`). Model: `test_register_survives_config_read_failure` (`:172`).
- **Fixtures (C-13 home `tests/conftest.py`)**:
  - `ADMIN` (`:12`), `_ctx` (`:17`) and `credentialed_source` (`:77`).
  - Autouse `set_env` (`:51-52`) sets `CONFIG_ENDPOINT=config-test:50060` (`:60`) and dummy `MTLS_*` (`:64-66`).
  - A hung-config server builder needed by both `test_client.py` and `test_tools.py`/`test_oauth.py` is a second consumer, so it centralizes here (C-13).
- **Deadline-naming tool error** → `_grpc_error_message(..., deadline_s=)` (`app/tools.py:223-231`). Reuse it only
  if design chooses to surface rather than fall back; FR-2 says fall back.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2` "A hung analysis read fails fast at the agent instead of hanging" (`services/xstockstrat-agent/acceptance/fix-opportunities-read-hangs.feature:12-16`, tags `@AC-2 @regression @feature-227`). `list_opportunities` must still return a deadline-naming error before the MCP client's 60 s limit.
  - It reads its policy through `get_config_value`, so D and the existing `wait_for` (`app/tools.py:1551-1554`) must together keep that budget.
  - The current worst case is the policy-read bound 3 s plus the analysis deadline ceiling 55 s, i.e. 58 s. The ceiling is the SetConfig bound `[30,55]` at `services/xstockstrat-config/src/grpc/configServiceImpl.ts:133` (`services/xstockstrat-agent/CLAUDE.md:205`).
  - D > 3.0 s with the `wait_for` removed yields D + 55 s. That is a CHANGE needing sign-off, and no operator decision covers it.
- **PRESERVE** `@AC-8` "The egress policy is sourced from config, not hardcoded literals" (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature:59-60`, tags `@AC-8 @FR-5 @feature-207`). A healthy config must still drive the `agent.extract.*` limits.
  - D is not egress policy and must not be placed as a literal in the `_fetch_url` source.
  - A stall falls back to the defaults (5 / 5_000_000 / 10.0 / 30.0), which may be looser than an operator-lowered limit. This extends the existing UNAVAILABLE fallback (`app/tools.py:2375`) to a stall. Verdict defaulted to PRESERVE; design-adversary to confirm it is not a CHANGE.
- **PRESERVE** `@AC-6` "A legitimate public URL is still fetched and extracted" (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature:45-46`, tags `@AC-6 @FR-4 @feature-207`). The public-URL fetch is unchanged when config answers within D (FR-3). The new AC-2 adds the stalled-config case alongside.
- **PRESERVE** `@AC-4` "A portfolio failure never fails the already-committed ingest" (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature:11-12`, tags `@AC-4 @FR-3 @feature-127`). The post-commit tail of `ingest_signal` must never fail the committed ingest. The new threshold-read timeout joins that tail (`app/tools.py:627-635`) and must also not propagate, nor skip the watchlist auto-add (`:660-668`).
- **PRESERVE** `@AC-5` "The tool docstring and mcp-tools.md both document the watchlist side effect" (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature:19-20`, tags `@AC-5 @FR-5 @feature-127`). This applies if the `ingest_signal` docstring or runbook entry is edited for the timeout; the watchlist side-effect text must stay.
- **PRESERVE** `@AC-5` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature:238-239`, tags `@AC-5 @FR-5 @feature-210`). The `GetConfig` call keeps `metadata=_metadata()` and `mtls.secure_channel` when `timeout=` is added (`app/client.py:1749-1754`).
- **PRESERVE** `@AC-1`..`@AC-5`, `@AC-7` "SSRF blocks (metadata, RFC1918/loopback, DNS-rebinding, scheme, redirect, no-leak)" (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature:11-58`, tags `@feature-207`). The fail-closed egress controls stay in force on the fallback-default path; a new catch wraps only the config read, never egress validation.
- **PRESERVE** `@AC-9` "The agent OAuth txn round-trips signed with JWT_SECRET" (`services/xstockstrat-agent/acceptance/config-secrets-and-scoping.feature:14-15`, tags `@AC-9 @FR-7 @feature-147`). The DCR edit in `app/oauth_server.py` shares the file but must not alter txn signing or verification.
- **Not impacted**:
  - The `list_opportunities` projection and paging suites (`@feature-187/185/095/199/200`).
  - `platform.feature` `@AC-8 @feature-147`, `@AC-1/@AC-4 @feature-210` (the channel is untouched) and `@AC-35 @feature-224` (server-side redaction).
- **No durable predecessor** for the fixed behavior. No suite covers the `get_config_value` scope/projection/error guarantees (feature 093), `/oauth/register` DCR, or the `signal.alert_threshold` path. This feature's `@AC-1..5` are promoted at launch (C-16).
- Coverage: 134 scenarios scanned (81 across the 24 agent suites, 53 in `platform.feature`); 8 relevant rule groups; no CHANGE flagged under D ≤ 3.0 s or with the 227 `wait_for` retained.

## Dependencies

- Proto/RPC: `ConfigService.GetConfig` (`packages/proto/config/v1/config.proto:23`, `GetConfigRequest` `:103`, `ConfigSnapshot` `:49`). This is a client-side deadline only, with no `.proto` change.
- Migration: none. The agent owns no schema.
- Config keys: none new. D is a fixed invariant, because a config read cannot bound itself (F-07 rationale, product-spec Fix Scope). Existing keys read through the helper:
  - `agent.extract.{max_redirects,max_bytes,connect_timeout_seconds,read_timeout_seconds}` (`services/xstockstrat-agent/CLAUDE.md:201-204`);
  - `agent.signal.alert_threshold` (`:200`);
  - `agent.oauth.registration_enabled` / `agent.oauth.allowed_redirect_uris` (`:198-199`);
  - `agent.opportunities.read_timeout_seconds` (`:205`).
- Inter-service edges: agent → config (`GetConfig`, gRPC 50060, existing). None new.
- New env vars / ports: none.

## Risks / Not-found

- **D vs the 227 `wait_for`.**
  - Any D < 3.0 s makes `DEADLINE_EXCEEDED` fire first inside `_agent_policy`. `_agent_policy` then returns 40.0 and logs "policy read failed" (`app/tools.py:2376`), not "timed out" (`:1556`).
  - At D = 3.0 s the two timers race, with the same 40.0 outcome either way.
  - Either way the `wait_for` becomes defence-in-depth or redundant. Design decides keep or remove.
  - The `test_list_opportunities_deadline.py` tests monkeypatch `_agent_policy` and `_POLICY_READ_TIMEOUT_S` (`:53-56`, `:78-88`) and pin the "timed out" log text. They bypass `get_config_value`, so they pass for any D but break if the symbol or log line is removed.
- **Stall cost multiplies on serial reads.**
  - `_fetch_url` costs 4 × D (AC-2 bound 4 × D + 1 s + fetch).
  - `extract_email_content` costs N × 4 × D for N URLs (`app/tools.py:542-543`). AC-2 covers only `extract_website_content`.
  - DCR costs 2 × D (AC-4).
  - `GetConfig` already returns the whole `agent` snapshot (`config.proto:49`), so a single snapshot read or a `gather` could cut a call to 1 × D. That is a scope addition; design fork (`context.md:22-28`).
- **Slow-but-healthy config must not be shortened** (`context.md:28`, FR-3). Not found: there is no measured healthy `GetConfig` latency or p99 anywhere in the repo to size D against. AC-5 pins only a 0.5 s healthy answer.
- **Ledger `fails.md:2936-2951`** (240): "before changing a shared RPC's failure or budget behaviour, enumerate every caller's request shape … make the change opt-in when the callers differ."
  - Enumerated: all five reads send the same shape, `GetConfigRequest(namespace="agent", environment=<resolve_scope>, user_id="")` (`tools.py:2374`, `:627-629`; `oauth_server.py:84-86`, `:104-106`), and each falls back on any `Exception`.
  - `client.get_config` (the `get_config` tool, `client.py:2034-2046`) is the one differing caller: operator-supplied namespace and user_id, surfaced error. It is out of scope and stays undeadlined; design must confirm the exclusion explicitly (C-10 vs C-18, `context.md` re-run notes).
- **Ledger `fails.md:2814-2817`** (207 non-enumeration): timeout is a distinct failure class. The `_agent_policy` catch is confined to the config read (`tools.py:2373-2377`), and no new catch may enclose `egress.build_pinned_client` or the redirect loop.
- **Ledger `insights.md:445-458`** (093): keep the helper's typed oneof projection and its non-swallowing `AioRpcError` contract. `None` still means only "key absent".
- **F-07**: D must not become a new `agent.*` key (circular), and must not be a literal at a caller site (`@AC-8 @feature-207`). design.md records the fixed-constant rationale. The agent `CLAUDE.md` documents the new constant next to `_POLICY_READ_TIMEOUT_S` (`context.md`, review notes).
- **Comment drift (How to Act #5)**: `app/tools.py:2365-2366` ("undeadlined GetConfig policy read") becomes false after the fix.
- **Doc drift (root `CLAUDE.md` teardown)**:
  - `services/xstockstrat-agent/CLAUDE.md:205` (policy read "capped by the fixed invariant `_POLICY_READ_TIMEOUT_S` = 3s").
  - `services/xstockstrat-agent/docs/context-constitution-findings.md:28` ("Action: move the cap inside `_agent_policy`").
  - `docs/context-constitution-findings.md:33` (latent-bug row) and `:64` (index).
  - `services/xstockstrat-agent/docs/context-constitution.md:40` (`_POLICY_READ_TIMEOUT_S (~L2360)` pointer).
  - `docs/runbooks/mcp-tools.md:1045-1046` (`list_opportunities` hung-read text, likely unchanged).
- **Anchor drift**:
  - `context.md:19-20` cites `tools.py:2363-2370` / `:625-635`; current anchors are above.
  - main-dev @ 53e27630 shifts `tools.py` ≥ L2100 by +4 (`context.md` re-run), so `/sdd-spec` re-derives anchors on its base.
- **Overlap (file-level, disjoint regions; rebase only)**:
  - `app/tools.py`: 241 (`set_config`), 240 (`manage_offline_account`), 215 (docstrings) and 249 (`manage_account`, conditional).
  - `app/client.py`: 241 (`set_config`), 240 (`confirm_offline_order`) and 215 (`run_backtest`, `_opportunity_to_dict`).
  - No merge-order.md entry.
- **Not found**:
  - No hung `ConfigService` test server exists; only the analysis one in `test_list_opportunities_deadline.py`.
  - No test runs `extract_website_content`, `extract_email_content`, `ingest_signal` or `/oauth/register` against a stalled config service. All current tests mock `get_config_value` (e.g. `tests/test_tools.py:244`, `tests/test_ingest_signal_watchlist.py:44`).
  - No existing deadline constant or config key for config reads, other than `_POLICY_READ_TIMEOUT_S` (`app/tools.py:2367`), which only `:1553` uses.
  - No healthy-latency baseline for `GetConfig`.

## Recommended Scope

Advisory input to the grilling and `/sdd-spec`; not binding.

1. **test (RED)**:
   - Add a hung `ConfigService` builder to `tests/conftest.py`.
   - Add AC-1 (a `get_config_value` raises `DEADLINE_EXCEEDED` within D + 0.5 s) and AC-5 (a healthy 0.5 s answer returns "0.8") against the in-process server. Wrap each in a `_HANG_GUARD_S` outer `wait_for`.
   - Extend `TestGetConfigValueClient` with the `timeout` kwarg and a `DEADLINE_EXCEEDED` propagation test.
2. **service**:
   - Add the D constant (module-level, read at call time) and pass `timeout=` on `GetConfig` at `app/client.py:1751-1754`. Optionally add a `timeout` kwarg per the `list_opportunities` precedent; that is a C-18 YAGNI call for design.
   - Reconcile the `tools.py:2365-2366` comment and decide whether the 227 `wait_for` stays.
3. **test (RED → GREEN), tool level**:
   - AC-2: `extract_website_content` with a stalled config and the respx public URL, plus the default-limits spy on `egress.build_pinned_client`.
   - AC-3: `ingest_signal` alert against the default 0.6.
   - AC-4: `/oauth/register` returns 201 under 2 × D + 1 s.
   - Preserve the 227 tests unchanged.
4. **docs**: the agent `CLAUDE.md` constant row next to `_POLICY_READ_TIMEOUT_S` (`:205`), plus the findings rows (agent `:28`, root `:33`/`:64`) and the context-constitution pointer (`:40`). Then run the context-constitution refresh teardown.
5. **Deferred to design**: whether to collapse `_fetch_url`'s four reads into one snapshot read or a `gather`. If chosen, it is a separate step with its own test, because it changes the AC-2 bound from 4 × D to 1 × D.
