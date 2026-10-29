# Implementation Spec: fix-agent-getconfig-deadline

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/247-fix-agent-getconfig-deadline/feature.md`
**Total Steps**: 6
**Feature Branch**: `feature/fix-agent-getconfig-deadline`

---

## Execution Summary

Follows design.md § Chosen Approach and its build order. Steps 1-2 land the `hung_config_server`
harness and every RED test first. Step 3 is the only behaviour change: one constant, one `timeout=`
kwarg, the status-code log, and two comment corrections. Steps 4-5 reconcile docs, materialize the
three follow-up defect reports and run the teardown audit. Step 6 captures the dev `GetConfig` latency
baseline; it has no code dependency and runs before Step 3 is committed (design.md §4(e)).

Single service (`xstockstrat-agent`). There is no proto, migration, config key, env var or port.
recon.md:115-123 confirms this, and `grep -n "_CONFIG_READ_TIMEOUT_S\|hung_config_server" -r
services/xstockstrat-agent` returns no hits, so both symbols are new.

**Consumer surfaces (C-14).** Step 3 changes `services/xstockstrat-agent/app/client.py`. That one change
reaches every surface the product spec names, so no tool definition changes, and tool names,
parameters and return shapes stay the same:
- `extract_website_content`
- `extract_email_content` (the `urls` path)
- `ingest_signal`
- `/oauth/register`
- `list_opportunities`, which is already bounded

Steps 1-2 test each surface.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` get_config_value bounded by its default deadline | Step 1 |
| `@AC-2` extract_website_content proceeds with default fetch policy | Step 2 |
| `@AC-3` ingest_signal alerts against the default threshold | Step 2 |
| `@AC-4` OAuth DCR does not hang | Step 2 |
| `@AC-5` healthy config read unchanged under the deadline | Step 1 |

### Design mandate → step (ledger `fails.md:2810-2812`: every design test mandate maps to a step)

| design.md mandate | Step |
|---|---|
| §5(a) threaded harness: `max_workers=8`, `is_active()` loop, lock-guarded `entered`, `stop(0).wait()`, recorded divergence | 1 |
| §5(a) exact `entered` counts AC-1=1, AC-2=4, AC-3=1, AC-4=2 | 1, 2 |
| §5(b) AC-1 at production D = 3.0 s within D + 0.5 s, `_HANG_GUARD_S = 10` outer guard | 1 |
| §5(b) AC-5 delayed 0.5 s answer returns `"0.8"` | 1 |
| §5(b) P-06 pins: `kwargs["timeout"] == client._CONFIG_READ_TIMEOUT_S` and `== 3.0` | 1 |
| §5(b) `DEADLINE_EXCEEDED` propagation and a warning naming the code, with no value | 1 |
| §5(c) AC-2 at D = 0.3 s, 4×D + 1 s, and a spy on `egress.build_pinned_client` | 2 |
| §5(c) AC-3 D + 1 s, exactly one `"signal"` alert at the default 0.6 | 2 |
| §5(c) AC-4 `TestClient(build_http_app())`, 201 within 2×D + 1 s | 2 |
| §5(c) [r2] stalled-config `extract_email_content(urls=[one URL])`: `entered == 4`, 4×D + 1 s | 2 |
| §5(c) no test asserts which 3 s timer fires first in `list_opportunities` | 1, 2 (prohibition) |
| §1 constant, `timeout=`, `except … as e` and `e.code().name` log; no helper kwarg; `get_config` untouched | 3 |
| §3 rewrite of the `tools.py:2365-2366` comment; the 227 `wait_for` kept | 3 |
| §4(b) correct the `oauth_server.py:102` comment | 3 |
| §6 docs touchpoints | 4 |
| §4(a)(b)(c) three materialized follow-up reports + `.status`; teardown | 5 |
| §4(e) dev `GetConfig` latency capture before promotion | 6 |

## Step Dependencies

- Steps 1 and 2 [test] cover Step 3 [service] (C-08). They are authored first, per design.md § Build
  order, and their RED runs are captured against the pre-Step-3 tree (P-06). Step 3's GREEN run
  re-executes them.
- Step 2 requires Step 1, because it consumes the `hung_config_server` fixture and `HANG_GUARD_S` from
  `tests/conftest.py`.
- Step 4 requires Step 3, because the docs describe the shipped constant and log line.
- Step 5 requires Step 4. The teardown audit runs last, over every context file touched in Steps 3-5.
- Step 6 has no code dependency: it measures the current dev deployment, where the latency baseline is
  independent of the fix. Run it before Step 3 is committed, so a p99 that rules out D = 3.0 s surfaces
  before Steps 1-3 pin `== 3.0`; it must complete before the integration PR at the latest. The post-merge
  dev smoke of the fix goes in the integration PR's test plan (product-spec Acceptance Criteria).
- Deferred surfaces and paths (C-14, never "later"): each points at a report that Step 5 materializes.
  - `extract_email_content` N >= 5 residual → `agent-config-snapshot-read`.
  - DCR fail-open → `agent-dcr-fail-closed`.
  - `client.get_config` and `register_oauth_client` → feature `273-fix-agent-client-deadlines` (report
    `docs/reports/2026-10-21-agent-client-deadlines-defect.md`, triaged); the planned `agent-rpc-deadlines` report was
    dropped as a duplicate (operator decision 2026-10-29, Deviation Log).
- C-16 promotion of `@AC-1..5` into `services/xstockstrat-agent/acceptance/` happens in the
  `/sdd-execute` integration PR, not as a step here.
- Overlap (recon.md:154-158) is file-level only, in disjoint regions:
  - `app/tools.py`: 241, 240, 215, 249.
  - `app/client.py`: 241, 240, 215.

  Whichever merges second rebases and re-runs `tests/test_client.py` and `tests/test_tools.py`.
- Anchor base: every line number below was re-derived on `origin/feature/fix-agent-getconfig-deadline`
  @ 0da14ffc. On main-dev, `tools.py` is +4 from about L2100 (recon.md:151-153). An executor on a
  rebased tree re-greps the quoted text, not the line number.

---

### Step 1 — test: hung_config_server harness + client-level RED tests (AC-1, AC-5, P-06 pins)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/conftest.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape)

**Codebase Evidence**:
- C-13 home: `tests/conftest.py`. `_setup_gen_path()` runs at module import (`:48`), so the `gen.config.v1`
  imports inside a fixture body resolve (re-verified 2026-10-28 after the main-dev merge). Its top-level imports are only `pathlib`, `sys`, `types`,
  `SimpleNamespace` and `pytest` (`:3-8`); there is no `grpc` or `app` import. The autouse `set_env` (`:51-52`) sets only the env var
  `CONFIG_ENDPOINT=config-test:50060` (`:60`) and never patches `client.CONFIG_ENDPOINT`. The harness
  therefore must `monkeypatch.setattr(client, "CONFIG_ENDPOINT", …)` itself.
- The redirect pattern to mirror is in `tests/test_list_opportunities_deadline.py`:
  - `:48-51`: `monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", f"127.0.0.1:{port}")` and
    `monkeypatch.setattr(client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep))`.
  - `:17`: `_HANG_GUARD_S = 10`.
  - `:57-61`: the `time.monotonic()` elapsed bound.
- The servicer base is `ConfigService.GetConfig(GetConfigRequest) returns (ConfigSnapshot)`
  (`packages/proto/config/v1/config.proto:23`, package `xstockstrat.config.v1` `:3`). `ConfigValue.float_val`
  is `:64`. Import: `from gen.config.v1 import config_pb2, config_pb2_grpc` (`tests/test_client.py:828`; the `config_pb2`-only import is at `:820`).
  The registrar is `config_pb2_grpc.add_ConfigServiceServicer_to_server(servicer, server)` (codegen of
  `config.proto:23`, `packages/proto/gen/python/config/v1/config_pb2_grpc.py:119`).
- Logger: `client.log = logging.getLogger(__name__)` (`app/client.py:19`), so `client.log.name == "app.client"`.
- Target helper: `get_config_value` (`app/client.py:1730`). The stub call at `:1752-1755` passes no
  `timeout=`. `except grpc.aio.AioRpcError:` (`:1756`) → `log.warning("get_config_value: GetConfig failed for %s.%s", namespace, key)`
  (`:1758`) → `raise` (`:1756-1759`).
- `TestGetConfigValueClient` (`tests/test_client.py:815`):
  - it uses `_channel_cm()` (`:70`), `patch("app.client.mtls")` and `patch.object(config_pb2_grpc, "ConfigServiceStub", …)` (`:833-835`);
  - it asserts `GetConfig.call_args.args[0]` and `.kwargs["metadata"]` (`:856-861`);
  - the `UNAVAILABLE` propagation model is `test_transport_error_is_surfaced_not_swallowed` (`:878-893`).
- `tests/test_client.py:1-7` imports only `AsyncMock, MagicMock, patch`, `pytest` and `client`. The step adds `asyncio`, `time` and `grpc`.
- C-13 verdict: the harness has three consumers (Steps 1-2: `test_client.py`, `test_tools.py`,
  `test_oauth.py`), so it centralizes in `conftest.py`. `HANG_GUARD_S` joins it for the same three
  consumers. `tests/test_list_opportunities_deadline.py:17` keeps its private `_HANG_GUARD_S`, which is
  not migrated (How-to-Act #3; design.md §5(a)). The `ConfigSnapshot` and `ConfigValue` literals in the
  new tests are scenario one-offs, so they stay inline.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-5`

**Instructions**:
1. In `tests/conftest.py`, add the top-level imports `import threading` and
   `from concurrent.futures import ThreadPoolExecutor`, and add a module constant `HANG_GUARD_S = 10`.
   `import grpc`, `from app import client` and `from gen.config.v1 import config_pb2, config_pb2_grpc` go
   inside the fixture body (the `gen` import only resolves after `_setup_gen_path()` at `:48`). Its one-line comment: outer bound so a missing deadline
   fails instead of hanging.
2. In `tests/conftest.py`, add the fixture `hung_config_server(monkeypatch)`. Its value is a
   `start(*, answer_after_s: float | None = None, values: dict | None = None)` callable, and `start` returns a
   handle exposing `port` and an `entered` property. Tests call it as `handle = hung_config_server(...)`.
   - **Server.** `grpc.server(ThreadPoolExecutor(max_workers=8))` with `add_ConfigServiceServicer_to_server`,
     bound by `add_insecure_port("127.0.0.1:0")`, then `start()`. It is sync and threaded, not `grpc.aio`.
     The divergence from `test_list_opportunities_deadline.py:26-40` goes in the fixture docstring:
     `TestClient`'s portal loop cannot serve a pytest-loop-bound aio server.
   - **`GetConfig` handler.** It increments `entered` under a `threading.Lock`.
     - When `answer_after_s is None` (the hang mode), it loops `while context.is_active() and not stop.is_set(): stop.wait(0.05)`,
       then returns an empty `config_pb2.ConfigSnapshot()`.
     - Otherwise it calls `stop.wait(answer_after_s)` and returns
       `config_pb2.ConfigSnapshot(namespace=request.namespace, version="1", values=values or {})`.
     - `stop` is a `threading.Event`.
   - **Redirect.** `start` applies the two `monkeypatch.setattr` calls copied from
     `test_list_opportunities_deadline.py:48-51`, pointing at `CONFIG_ENDPOINT` = `f"127.0.0.1:{port}"`.
   - **Teardown** (fixture finalizer): `stop.set()`, then `server.stop(0).wait()`.
3. In `tests/test_client.py`, add the imports `asyncio`, `time` and `grpc`, plus
   `from tests.conftest import HANG_GUARD_S`. Then add the two scenario tests below. Each wraps its await in
   `asyncio.wait_for(…, HANG_GUARD_S)`. AC-1 runs at the production D, with no monkeypatch of the constant
   (design.md §5(b)).
   - `test_ac1_stalled_config_read_raises_deadline_exceeded_within_bound(hung_config_server)` covers `@AC-1`.
     - Call `handle = hung_config_server()`, then call `client.get_config_value("signal.alert_threshold", namespace="agent", environment="staging")`.
     - Assert it raises `grpc.aio.AioRpcError` with `.code() == grpc.StatusCode.DEADLINE_EXCEEDED`.
     - Assert that `time.monotonic()` elapsed is `< 3.0 + 0.5`, a literal from acceptance.feature:4.
     - Assert `handle.entered == 1`.
   - `test_ac5_healthy_slow_config_read_is_unchanged(hung_config_server)` covers `@AC-5`.
     - Call `handle = hung_config_server(answer_after_s=0.5, values={"signal.alert_threshold": config_pb2.ConfigValue(float_val=0.8)})`.
     - Assert the call returns `"0.8"` and that `handle.entered == 1`.
4. In `TestGetConfigValueClient`, add the following P-06 wiring proofs and the error-log test. All of them
   use the existing mocked-stub shape (`:828-835`).
   - `test_getconfig_carries_default_deadline`: assert `"timeout" in mock_stub.GetConfig.call_args.kwargs`,
     then `== client._CONFIG_READ_TIMEOUT_S`, then `client._CONFIG_READ_TIMEOUT_S == 3.0`. The existing
     `args[0]` and `kwargs["metadata"]` assertions stay untouched.
   - `test_deadline_constant_is_read_at_call_time(monkeypatch)`:
     `monkeypatch.setattr(client, "_CONFIG_READ_TIMEOUT_S", 0.3, raising=False)`, then assert
     `call_args.kwargs["timeout"] == 0.3`. This proves the value is not bound as a default argument (recon.md:58-61).
   - `test_deadline_exceeded_is_surfaced_and_logged_by_code(caplog)`.
     - Build `err = grpc.aio.AioRpcError(grpc.StatusCode.DEADLINE_EXCEEDED, None, None, details="detail-sentinel-247")`.
       This follows the `:878-893` model.
     - Under `caplog.at_level("WARNING", logger=client.log.name)`, assert `pytest.raises(grpc.aio.AioRpcError)`.
     - Assert that `"DEADLINE_EXCEEDED"` and `"agent.k"` are in `caplog.text`.
     - Assert that `"detail-sentinel-247"` is not in `caplog.text`. Only `e.code().name` is logged; no error
       detail or value is logged (FR-6).
5. Do not add any assertion on which 3 s timer fires first in `list_opportunities` (design.md Open Risks).
   Do not edit `tests/test_list_opportunities_deadline.py`.
6. RED capture (pre-Step-3 tree):
   - AC-1 fails on `TimeoutError` from the `HANG_GUARD_S` guard.
   - `test_getconfig_carries_default_deadline` fails on `"timeout" in kwargs`.
   - The call-time test fails on `KeyError: 'timeout'`.
   - The log test fails on `"DEADLINE_EXCEEDED" in caplog.text`.
   - AC-5 passes pre-fix. It is a FR-3 non-regression guard; record it as "red N/A — FR-3 characterization"
     (tdd-gate escape).

**Verification**:
```bash
(cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_client.py -k "ac1 or ac5 or deadline" -v)
(cd services/xstockstrat-agent && uv run --no-sync pytest --cov=app --cov-fail-under=40)   # C-08: agent CI gate (.github/workflows/ci.yml 'pytest with coverage' step ~:406-411; agent matrix threshold 40 at :368-369)
(cd services/xstockstrat-agent && ruff check . && ruff format --check .)
grep -n "def hung_config_server\|HANG_GUARD_S\|max_workers=8\|is_active()\|threading.Lock\|stop(0).wait()" services/xstockstrat-agent/tests/conftest.py
grep -n "from tests.conftest import" services/xstockstrat-agent/tests/test_client.py   # C-13: harness imported, not copied
```
Pre-Step-3, the four non-AC-5 tests FAIL (RED), so the full-suite coverage run is also red. Post-Step-3,
all of them PASS and coverage is at least 40%.

---

### Step 2 — test: tool and endpoint stalled-config RED tests (AC-2, AC-3, AC-4, extract_email_content)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_oauth.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape); OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- `tests/test_tools.py` helpers:
  - `_make_server()` (`:21`) and `_tool_fn(server, name)` (`:27`).
  - `_SOURCES` (`:65`): `s1` is `has_credentials: False`.
  - `_website_source(slug, url, *, has_credentials=False)` (`:2002`).
- respx happy-path model `test_extract_website_content_fetches_url` (`:244-256`):
  `respx.mock(base_url="https://example.com")` + `site_mock.get("/")`.
- Ingest models: `test_ingest_signal_auto_alert_above_threshold` (`:370-394`) and
  `test_ingest_signal_survives_threshold_read_failure` (`:444-466`).
- `_fetch_url` (`app/tools.py:2399`):
  - four serial `_agent_policy` reads at `:2410-2413`, with defaults 5 / 5_000_000 / 10.0 / 30.0;
  - `egress.build_pinned_client(connect_timeout=…, read_timeout=…)` at `:2421-2423`.
  - `egress` is imported as a module (`app/tools.py:74`), so `monkeypatch.setattr(tools.egress, "build_pinned_client", spy)` intercepts it.
  - The signature is `build_pinned_client(*, connect_timeout, read_timeout)` (`app/egress.py:144`).
- `_agent_policy` is looked up at call time from module globals (`app/tools.py:2383`; called at `:2410-2413`).
- `extract_email_content(source_slug, attachments_b64=None, urls=None)` (`app/tools.py:508-512`):
  `_get_source` (`:528`), the `has_credentials` raise (`:530-531`), then `for url in urls: await _fetch_url(url, password=None)` (`:541-544`).
- `extract_website_content` (`app/tools.py:549`) calls `_fetch_url` at `:577`.
- The `ingest_signal` post-commit read is at `:627-637`. The alert emit `category="signal"` is at `:648`.
- DCR (`app/oauth_server.py`):
  - `register` (`:72`);
  - the reads at `:84` (caught `:87`) and `:104` (caught `:107`);
  - `client.register_oauth_client` at `:136`, returning 201 at `:141-143`.
- DCR test model: `test_register_survives_config_read_failure` (`tests/test_oauth.py:172-190`), using
  `_app()` → `build_http_app()` (`:16-19`).
- `tests/test_oauth.py:8-13` imports `AsyncMock, patch`, `pytest`, `TestClient` and `client`.
- `tests/test_tools.py:3-18` imports no `asyncio`, `time` or `app.tools` module (only
  `from app.tools import _EXTRACTOR_TOOL_MAP, register_tools`, `:17`); `:18` is
  `from tests.conftest import ADMIN, _ctx`.
- Patch targets, as the existing tests use them: `patch.object(client, "list_signal_sources", …)`
  (`tests/test_tools.py:99`), `patch.object(client, "ingest_signal", …)` and
  `patch.object(client, "emit_alert", …)` (`:378-379`).
- RED-without-hang: `client._CONFIG_READ_TIMEOUT_S` does not exist before Step 3. Therefore
  `monkeypatch.setattr(..., raising=False)` is mandatory, otherwise the RED run errors on `AttributeError`
  instead of the missing deadline.
- `TestClient` is synchronous, so an `asyncio.wait_for` guard cannot bound it. That is why the AC-4 test
  uses the worker-thread guard below.
- C-13 verdict:
  - The `hung_config_server` fixture and `HANG_GUARD_S` are imported from `conftest.py` (Step 1).
  - `_website_source`, `_SOURCES` and `_ctx`/`ADMIN` are reused.
  - The new literals (`"acme-site"`, `"acme-signals"`, `oauthc_247`, `https://client.example/cb`) each
    have one consumer and stay inline.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-4`

**Instructions**:
1. Use these common settings in every test:
   - start with `handle = hung_config_server()` (hang mode);
   - set `monkeypatch.setattr(client, "_CONFIG_READ_TIMEOUT_S", 0.3, raising=False)`, so D = 0.3;
   - measure elapsed with `time.monotonic()`;
   - assert no `list_opportunities` timer ordering.
2. Add these tests to `tests/test_tools.py`, plus the imports `asyncio`, `time` and `from app import tools`,
   and extend `:18` to `from tests.conftest import ADMIN, HANG_GUARD_S, _ctx`. Each test awaits through
   `asyncio.wait_for(…, HANG_GUARD_S)`. "Patch" below means `patch.object(client, …)` as in the Evidence.
   - `test_ac2_extract_website_content_proceeds_on_stalled_config` covers `@AC-2`.
     - Patch `client.list_signal_sources` → `_website_source("acme-site", "https://example.com/")`.
     - In `respx.mock(base_url="https://example.com")`, `get("/")` returns 200 with a roughly 1 KB HTML body
       that contains `"NVDA"`.
     - Spy on `tools.egress.build_pinned_client`: a wrapper that records its kwargs, then delegates to the original.
     - Wrap `tools._agent_policy` with a recorder that awaits the original and stores `(key, result)`.
     - Assert:
       - `"NVDA" in result["raw_text"]`;
       - elapsed `< 4 * 0.3 + 1.0`;
       - `handle.entered == 4`;
       - the spy saw exactly `[{"connect_timeout": 10.0, "read_timeout": 30.0}]`;
       - the recorder map equals `{"extract.max_redirects": 5, "extract.max_bytes": 5_000_000, "extract.connect_timeout_seconds": 10.0, "extract.read_timeout_seconds": 30.0}`.
       This is the supporting unit check in the acceptance.feature:20-21 comment.
   - `test_extract_email_content_urls_proceeds_on_stalled_config` covers the C-10 second `_fetch_url`
     caller (design.md §5(c) [r2]).
     - Patch `client.list_signal_sources` → `_SOURCES`, use the same respx mock, and call
       `extract_email_content(source_slug="s1", urls=["https://example.com/"])`.
     - Assert `"NVDA" in result["raw_text"]`, elapsed `< 4 * 0.3 + 1.0` and `handle.entered == 4`.
   - `test_ac3_ingest_signal_alerts_at_default_threshold_on_stalled_config` covers `@AC-3`.
     - Patch `client.ingest_signal` with an `AsyncMock` whose `side_effect` records
       `t_ingest = time.monotonic()` and returns `{"signal_id": 7, "deduplicated": False}`.
     - Patch `client.emit_alert` with an `AsyncMock(return_value={"alert_id": "a1"})`.
     - Call `ingest_signal(ctx=_ctx(ADMIN), source="acme-signals", symbol="NVDA", direction="buy", valid_from="2026-10-20T00:00:00Z", conviction=0.9)`.
     - Assert:
       - the result `== {"signal_id": 7, "deduplicated": False}`;
       - `time.monotonic() - t_ingest < 0.3 + 1.0`;
       - `mock_alert.assert_called_once()`;
       - `mock_alert.await_args.kwargs["category"] == "signal"`;
       - `handle.entered == 1`.
3. Add this test to `tests/test_oauth.py`, plus the imports `time`, `concurrent.futures` and
   `from tests.conftest import HANG_GUARD_S`.
   - `test_ac4_register_does_not_hang_on_stalled_config` covers `@AC-4`.
     - Patch `client.register_oauth_client` → `AsyncMock(return_value={"client_id": "oauthc_247", "redirect_uris": ["https://client.example/cb"]})`.
     - Run `with TestClient(_app()) as tc: return tc.post("/oauth/register", json={"redirect_uris": ["https://client.example/cb"]})`
       inside a worker of a `concurrent.futures.ThreadPoolExecutor(max_workers=1)`.
     - Take `r = fut.result(timeout=HANG_GUARD_S)`.
     - In `finally`, call `executor.shutdown(wait=False)`. Never use `with ThreadPoolExecutor`: its exit
       joins the hung worker before the fixture teardown can stop the server.
     - Assert:
       - elapsed `< 2 * 0.3 + 1.0`;
       - `r.status_code == 201`;
       - `r.json()["client_id"] == "oauthc_247"`;
       - `r.json()["redirect_uris"] == ["https://client.example/cb"]`;
       - `handle.entered == 2`.
4. RED capture (pre-Step-3 tree):
   - The AC-2, email and AC-3 tests fail on `TimeoutError` from the `HANG_GUARD_S` guard.
   - AC-4 fails on `concurrent.futures.TimeoutError`. The fixture teardown (`server.stop(0)`) then cancels
     the stuck RPC, so the worker exits through the existing `except Exception`.

**Verification**:
```bash
(cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tools.py tests/test_oauth.py -k "stalled_config" -v)
(cd services/xstockstrat-agent && uv run --no-sync pytest --cov=app --cov-fail-under=40)   # C-08: agent CI gate (.github/workflows/ci.yml 'pytest with coverage' step ~:406-411; agent matrix threshold 40 at :368-369)
(cd services/xstockstrat-agent && ruff check . && ruff format --check .)
grep -n "from tests.conftest import\|hung_config_server\|raising=False" services/xstockstrat-agent/tests/test_tools.py services/xstockstrat-agent/tests/test_oauth.py
```
All four tests FAIL before Step 3 (RED) and PASS after it; post-Step-3 coverage is at least 40%.

---

### Step 3 — service: default GetConfig deadline in get_config_value + comment corrections

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify (comment only)
- `services/xstockstrat-agent/app/oauth_server.py` — modify (comment only)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape); OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- Module endpoint block `app/client.py:21-29`, with `CONFIG_ENDPOINT` at `:24` and `MARKETDATA_ENDPOINT` at `:29`. `log` is at `:19`.
- `get_config_value` (`app/client.py:1730-1764`):
  - the stub call `snapshot = await stub.GetConfig(config_pb2.GetConfigRequest(namespace=namespace, environment=env, user_id=user_id), metadata=_metadata(),)` is at `:1752-1755`;
  - `except grpc.aio.AioRpcError:` / `log.warning("get_config_value: GetConfig failed for %s.%s", namespace, key)` / `raise` is at `:1756-1759`;
  - `mtls.secure_channel(CONFIG_ENDPOINT, "xstockstrat-config")` is at `:1750`.
- Kwarg shape to reuse: `list_opportunities(..., timeout: float | None = None)` → `timeout=timeout` on the stub (`app/client.py:854`, `:873`). It is the only `timeout=` in client.py.
- Constant shape to reuse: `_POLICY_READ_TIMEOUT_S = 3.0` with its call-time comment (`app/tools.py:2378-2380`).
- Callers left unchanged, each with an existing `except Exception`:
  - `_agent_policy`: `app/tools.py:2383-2397` (its `except Exception` fallback);
  - `ingest_signal`: `:627-637`;
  - DCR: `app/oauth_server.py:84` / `:87`, `:104` / `:107`.
- Excluded paths: `client.get_config` (`app/client.py:2035-2047`) and `register_oauth_client` (`:1356`). They are left undeadlined (design.md §4(c)).
- The comment at `app/tools.py:2378-2379` reads "Fixed bound on the undeadlined GetConfig policy read; looked up at call time (never bound as a default argument) so tests can monkeypatch it." It is false after this step.
- The comment at `app/oauth_server.py:102` reads "identity enforces the same allowlist / https rule server-side; this is the pre-check." It is false today: identity enforces only `https://` (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:385-388`, design.md §4(b)).
- Header propagation (step-constraints §B): no new outbound call. The existing `GetConfig` call keeps `metadata=_metadata()` and `mtls.secure_channel`, which preserves `@AC-5 @feature-210` (`docs/sdd/business-rules/platform.feature:238`).

**TDD**: `red-green required` (GREEN for Steps 1-2; the two comment edits carry no behaviour)

**Covers**: —

**Instructions**:
1. In `app/client.py`, insert the following directly after the endpoint block (after `:29`, `MARKETDATA_ENDPOINT`):
   ```python
   # Fixed, not a config key: a config read cannot bound itself. Read at call time so tests can
   # monkeypatch it.
   _CONFIG_READ_TIMEOUT_S = 3.0
   ```
2. In `get_config_value`, add `timeout=_CONFIG_READ_TIMEOUT_S,` after `metadata=_metadata(),` in the
   `stub.GetConfig(...)` call (`:1752-1755`).
   - Read the constant in the body. Never bind it as a parameter default.
   - Do not add a `timeout` parameter to the helper (C-18).
   - Do not touch `get_config` (`:2035-2047`).
3. Change `except grpc.aio.AioRpcError:` (`:1756`) to `except grpc.aio.AioRpcError as e:`, and change the
   warning to `log.warning("get_config_value: GetConfig %s for %s.%s", e.code().name, namespace, key)`.
   - Keep the existing comment line and the `raise`.
   - Log no details, value or `str(e)` (FR-6).
   - Do not import `tools._grpc_error_message`, which would be an import cycle (design.md §1).
4. In `app/tools.py`, replace the two-line comment at `:2378-2379` with:
   ```python
   # Outer bound keeping list_opportunities inside the MCP client's 60 s budget; looked up at call
   # time so tests can monkeypatch it.
   ```
   - Leave `_POLICY_READ_TIMEOUT_S = 3.0` (`:2380`) and the 227 `wait_for` (about `:1560-1563`) unchanged.
   - Do not alias the two constants.
5. In `app/oauth_server.py`, replace the comment at `:102` with
   `# Pre-check only: identity enforces https:// alone, not this allowlist.`
   - This is a comment-only change (justified How-to-Act #3 exception, design.md §4(b)).
   - Make no other edit in this file, since `@AC-9 @feature-147` txn signing is untouched.

**Verification**:
```bash
(cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_client.py tests/test_tools.py tests/test_oauth.py tests/test_list_opportunities_deadline.py -v)
(cd services/xstockstrat-agent && uv run --no-sync pytest --cov=app --cov-fail-under=40)
(cd services/xstockstrat-agent && ruff check . && ruff format --check .)
grep -n "_CONFIG_READ_TIMEOUT_S" services/xstockstrat-agent/app/client.py      # exactly 2 hits: definition + GetConfig kwarg
grep -n "_CONFIG_READ_TIMEOUT_S" services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/app/oauth_server.py   # 0 hits (not a caller literal, @AC-8 @feature-207)
sed -n '/async def get_config_value/,/return str/p' services/xstockstrat-agent/app/client.py | grep -n "secure_channel\|metadata=_metadata()\|timeout=_CONFIG_READ_TIMEOUT_S\|e.code().name"   # all four present (@AC-5 @feature-210 kept)
git diff --stat -- services/xstockstrat-agent/app/tools.py services/xstockstrat-agent/app/oauth_server.py   # comment lines only
```
Steps 1-2 are GREEN, the 227 suite still passes, and coverage is at least 40%.

---

### Step 4 — docs: agent CLAUDE.md, context-constitution and findings reconciliation

**Status**: `done`
**Service**: `docs` (`services/xstockstrat-agent/` docs + root findings)
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify
- `docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-agent/CLAUDE.md` (re-verified 2026-10-28):
  - `:191-194` (heading `:191`, namespace sentence `:193-194`) "## Config Keys Consumed — Namespace: `agent`, resolved via `client.get_config_value()` …";
  - `:205` is the `agent.opportunities.read_timeout_seconds` row, which says "The policy read itself is capped by the fixed invariant `_POLICY_READ_TIMEOUT_S` = 3s (not a config key)".
  - The `:196-205` table (header `:196`) is `| Key | Type | Default | Description |` of config keys. design.md §6 asks
    for a `_CONFIG_READ_TIMEOUT_S` "row next to `_POLICY_READ_TIMEOUT_S`"; a table row would present a
    non-key as a key, so the constant is placed in the `:205` row (where `_POLICY_READ_TIMEOUT_S` lives)
    plus one sentence under the section heading. Same intent, recorded as a design.md §6 wording deviation.
- `services/xstockstrat-agent/docs/context-constitution.md:40`: "`list_opportunities` gRPC deadline + the fixed policy-read cap | … `app/tools.py#_POLICY_READ_TIMEOUT_S (~L2360)`".
- `services/xstockstrat-agent/docs/context-constitution-findings.md`:
  - the § Latent bugs table header is at `:22`;
  - `:28` is the open row "`_fetch_url` makes four sequential `_agent_policy` config reads … with no deadline … Action: move the cap inside `_agent_policy`";
  - the § Resolved bullet list is at `:52-55`.
- `docs/context-constitution-findings.md`:
  - `:34` is the latent-bug row "**Agent `get_config_value` has no gRPC deadline** …" (its `~L1729`/`~L1751` hints are now `:1730`/`:1752`; cite symbols when it moves to § Resolved);
  - the § Resolved heading is at `:51` (table about `:53-55`);
  - the § Filed-as-defect-reports section is at `:58`, its rule "A row stays here until its report is resolved." at `:61`, with index row `:65`.
- Defect report sidecar `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.status` reads
  `triaged` / `ref: feature:247-fix-agent-getconfig-deadline`. It resolves at launch, per
  `.claude/skills/sdd-qa/reference/defect-filing.md` § The status sidecar.
- `docs/runbooks/mcp-tools.md:209` (ingest_signal) and `:1698` (`agent.signal.alert_threshold` row) describe
  the threshold and its default only. Tool contracts are unchanged, so no edit is needed. Record this as
  "checked, unchanged" (registry: mcp-tools.md parity).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Make these edits to `services/xstockstrat-agent/CLAUDE.md`.
   - Add one sentence after the `:193-194` namespace sentence: every `get_config_value` read carries the
     fixed gRPC deadline `_CONFIG_READ_TIMEOUT_S` = 3.0 s (`app/client.py`). It is not a config key,
     because a config read cannot bound itself. On expiry the read raises `DEADLINE_EXCEEDED`, and each
     caller falls back to its documented default.
   - In the `:205` row, change "The policy read itself is capped by the fixed invariant
     `_POLICY_READ_TIMEOUT_S` = 3s" so that it says the read carries the client deadline
     `_CONFIG_READ_TIMEOUT_S` and stays wrapped in the outer `_POLICY_READ_TIMEOUT_S` = 3s bound. Both are
     fixed invariants and neither is a config key. Leave the rest of the row verbatim.
2. Make these edits to `services/xstockstrat-agent/docs/context-constitution.md:40`.
   - Re-point the evidence to `app/client.py#_CONFIG_READ_TIMEOUT_S` plus `app/tools.py#_POLICY_READ_TIMEOUT_S`.
   - Drop the stale `~L2360` hint. After the 2026-10-28 main-dev merge the line is `:2380`, so cite the symbol, not the line.
3. Make these edits to `services/xstockstrat-agent/docs/context-constitution-findings.md`.
   - Remove the `:28` row from § Latent bugs.
   - Add a § Resolved bullet: "**RESOLVED (feature 247) — `_fetch_url` / `get_config_value` config reads
     had no deadline.**" It names the fix: the `_CONFIG_READ_TIMEOUT_S` deadline in `get_config_value`,
     with the callers unchanged.
   - Add a second § Resolved bullet, as found-and-fixed: the `app/oauth_server.py:102` comment wrongly
     claimed that identity enforces the redirect allowlist. Identity enforces only `https://`
     (`identityServiceImpl.ts:385-388`), and the comment was corrected in feature 247.
4. Make these edits to `docs/context-constitution-findings.md`.
   - Move the `:34` row out of § Latent bugs into the § Resolved table (`:53-55` format:
     Finding | Resolved | How confirmed). Use Resolved = feature 247 and How confirmed =
     `client.py#_CONFIG_READ_TIMEOUT_S` plus `tests/test_client.py` `test_ac1_*`.
   - Keep the `:65` index row. The section's own rule (`:61`) keeps a row until its report is resolved,
     and that happens at launch.
5. Make no edit to `docs/runbooks/mcp-tools.md` (see Evidence).

**Verification**:
```bash
grep -n "_CONFIG_READ_TIMEOUT_S" services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/docs/context-constitution.md services/xstockstrat-agent/docs/context-constitution-findings.md docs/context-constitution-findings.md
grep -n "move the cap inside" services/xstockstrat-agent/docs/context-constitution-findings.md   # 0 hits
grep -n "has no gRPC deadline" docs/context-constitution-findings.md   # only in § Resolved (line > 51)
grep -n "~L2360" services/xstockstrat-agent/docs/context-constitution.md   # 0 hits
```

---

### Step 5 — docs: materialize three follow-up defect reports + teardown audit

**Status**: `done`
**Service**: `docs` (`docs/reports/`)
**Files**:
- `docs/reports/2026-10-21-agent-config-snapshot-read-defect.md` — create
- `docs/reports/2026-10-21-agent-config-snapshot-read-defect.status` — create
- `docs/reports/2026-10-21-agent-dcr-fail-closed-defect.md` — create
- `docs/reports/2026-10-21-agent-dcr-fail-closed-defect.status` — create
- `docs/reports/2026-10-21-agent-rpc-deadlines-defect.md` — create
- `docs/reports/2026-10-21-agent-rpc-deadlines-defect.status` — create
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify (index rows)

The date is pinned to the spec date. If the step executes on a later date, use that date for all six
filenames and `**Recorded**`, and record the actual filenames in the Deviation Log before staging (F-08).
Seven files exceeds the 5-file advisory; they are three report/sidecar pairs plus one index edit.

**Reviewers**: none

**Codebase Evidence**:
- Format: `.claude/skills/sdd-qa/reference/defect-filing.md`.
  - It requires the template headings `# Defect:`, `**Recorded**`, `**Severity**`, `**Impact type**`,
    `**Environment**`, `**Affected service(s)**`, `**Config-only fix possible**`, then `## Observed`,
    `## Expected`, `## Reproduction`, `## Evidence`, `## Root cause hypothesis` and `## Confidence`.
  - Exactly one `SEV-N` token may appear per document.
  - The sidecar line 1 is `open`, with no `ref:` line.
- Precedent: `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md` (the parent report).
- No existing report covers these follow-ups. `grep -rln "register_oauth_client\|get_config(" docs/reports/*.md`
  finds no hits, and `ls docs/reports | grep -i "snapshot\|dcr\|fail-closed"` shows nothing related.
- Agent findings index: § "Filed as defect reports (2026-10-19)" at `services/xstockstrat-agent/docs/context-constitution-findings.md:58`, with index rows at `:65-69`. The heading carries its filing date, so rows filed on another date need their own dated section.
- Report evidence anchors (this branch):
  - `app/tools.py:541-544` (email per-URL `_fetch_url`) and `:2410-2413` (four serial reads);
  - `packages/proto/config/v1/config.proto:49` (`ConfigSnapshot`, the whole namespace);
  - `app/oauth_server.py:87-89`, `:107-110`;
  - `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:385-388`;
  - `app/client.py:2035-2047` (`get_config`), `:1356` (`register_oauth_client`).
- Teardown: the root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` scoped
  to the files touched. If the plugin is unavailable, a manual reconciliation must be recorded in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Write each report with the template.
   - Every report has `**Severity**: SEV-2`, the only severity token in the file, matching this feature.
   - Every report has `**Affected service(s)**: xstockstrat-agent`, `**Config-only fix possible**: no`,
     and a `**Source**` line citing feature 247 `design.md` § Open Risks.
   - Every report gets a sidecar containing `open`.
2. The three reports:
   - **`agent-config-snapshot-read`**. Observed: `extract_email_content` costs N×4×D (12 s per URL) during a
     config stall, so it stays over the MCP client's 60 s limit at N >= 5. Expected: one `GetConfig`
     snapshot per tool call. Evidence: `tools.py:541-544`, `:2410-2413` and `config.proto:49`. Note that
     `asyncio.gather` is rejected (insights.md:2240-2244).
   - **`agent-dcr-fail-closed`**. Label it SECURITY POSTURE.
     - Observed: on a config stall of D or more, `/oauth/register` registers anyway. It bypasses
       `registration_enabled=false` and the allowlist (`oauth_server.py:87-89`, `:107-110`), and identity
       checks only `https://` (`identityServiceImpl.ts:385-388`).
     - Expected: a decision on fail-closed (503) DCR.
     - Write "FR-2 / AC-4 of feature 247 sanctioned fail-open".
   - **`agent-rpc-deadlines`**.
     - Observed: `client.get_config` (`client.py:2035-2047`, the `get_config` tool) and
       `register_oauth_client` (`:1356`) pass no `timeout=`, so they hang on a config or identity stall.
     - Expected: a deadline per caller shape. Cite ledger `fails.md:2936-2951`: enumerate the callers and
       make the change opt-in when their shapes differ.
3. Add a new section `## Filed as defect reports (2026-10-21)` directly after the `:58` section (same
   date as the filenames), with one intro line naming feature 247 `design.md` § Open Risks as the source
   and the three reports in the `:63-69` `| Report | Title |` table format. Do not append them under the
   `(2026-10-19)` heading.
4. Run the teardown: `/context-forge:context-constitution refresh`, scoped to every context file touched in
   Steps 3-5, and fix the grounded drift it reports. If the plugin is unavailable, re-read each touched file
   against the code instead. Record both facts ("plugin unavailable" and the per-file reconciliation) in the
   PR body and `context.md`. A bare note does not pass (root `CLAUDE.md` § Teardown).
   - Any drift fix in a file not listed in **Files** (Steps 3-5) is added to the Deviation Log with its path
     before it is staged (F-08).

**Verification**:
```bash
for f in docs/reports/2026-10-29-agent-config-snapshot-read-defect.md docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md; do
  echo "$f: $(grep -oE 'SEV-[123]' "$f" | sort -u | tr '\n' ' ')"; grep -c '^\*\*Severity\*\*:' "$f"; head -1 "${f%.md}.status"
done   # each: exactly "SEV-2", count 1, sidecar "open"
grep -n "agent-config-snapshot-read\|agent-dcr-fail-closed" services/xstockstrat-agent/docs/context-constitution-findings.md   # 2 index rows
grep -n "^## Filed as defect reports" services/xstockstrat-agent/docs/context-constitution-findings.md   # (2026-10-19) and (2026-10-29)
grep -n "feature 247" docs/reports/2026-10-21-agent-client-deadlines-defect.md   # cross-reference line present
ls docs/reports | grep -c "agent-rpc-deadlines"   # 0 (dropped as a duplicate)
```

---

### Step 6 — docs: dev GetConfig latency baseline (D sizing), before Step 3 is committed

**Status**: `done`
**Service**: `docs` (feature `context.md`; measurement on the dev deployment)
**Files**:
- `docs/roadmap/features/247-fix-agent-getconfig-deadline/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The agent's OTel gRPC client instrumentation is `GrpcAioInstrumentorClient().instrument()` in
  `init_telemetry` (`services/xstockstrat-agent/app/telemetry.py:31`, `:39`, `:53`). Its client spans cover
  `/xstockstrat.config.v1.ConfigService/GetConfig` (`packages/proto/config/v1/config.proto:3`, `:23`).
- Agent channels are ephemeral per call (`mtls.secure_channel` inside `get_config_value`, `app/client.py:1750`).
  The span therefore covers DNS, TCP, the mTLS handshake and the RPC, which is what D must cover
  (design.md §4(e)).
- Not found: a healthy `GetConfig` latency or p99 baseline anywhere in the repo (recon.md:137, :162).

**TDD**: `N/A (measurement, no code)`

**Covers**: —

**Instructions**:
1. On the current dev deployment, query the agent's client spans for
   `/xstockstrat.config.v1.ConfigService/GetConfig` over at least 24 h, in Grafana Cloud traces
   (`docs/setup/grafana-cloud.md`). Record the count, p50, p99 and max.
   - The baseline is independent of the fix, so the step runs before Step 3 is committed (Step Dependencies).
   - If dev OTel is off, no spans exist, or the executor has no Grafana Cloud trace access, record
     "Not measured" and the reason, then escalate (P-03) to the operator, who may run the query.
     Do not guess.
   - Known at re-spec (2026-10-28): the Grafana_Cloud MCP server failed to connect in the executing
     session (HTTP 424), so this fallback is expected to apply: record "Not measured" with that reason and
     escalate (P-03) to the operator before Step 3 is committed.
2. Append a `context.md` session entry headed `GetConfig latency baseline` with the query text, the time
   window (UTC start/end), the span count, p50, p99, max and the margin against D = 3.0 s, so the
   measurement is reproducible from the entry alone.
   - If p99 is not comfortably below D (operator judgment), stop and escalate before Step 3 is committed
     (or, if Step 3 has already landed, before the integration PR).
     Changing D is a design change.
3. Add to the integration PR's test plan: a post-merge dev smoke of `ingest_signal` and
   `extract_website_content` with config healthy (product-spec Acceptance Criteria), and a check that no
   `get_config_value: GetConfig DEADLINE_EXCEEDED` warnings appear in the agent logs.

**Verification**:
```bash
grep -n "GetConfig latency baseline" docs/roadmap/features/247-fix-agent-getconfig-deadline/context.md   # entry exists
grep -nE "window.*UTC|count|p50|p99|max|Not measured" docs/roadmap/features/247-fix-agent-getconfig-deadline/context.md   # query window + all four figures, or "Not measured" + escalation
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **Step 1 (2026-10-28)** — the three P-06 wiring tests share one in-class helper,
  `TestGetConfigValueClient._mocked_get_config_call()`, which builds the existing mocked-stub shape
  (`_channel_cm()` + `patch("app.client.mtls")` + `patch.object(config_pb2_grpc, "ConfigServiceStub", …)`)
  once, instead of repeating it in each test. Same assertions as the spec; DRY only. **Disposition**: accepted (no scope change).
- **Step 1 (2026-10-28)** — committed with its four non-AC-5 tests RED by design (spec Step 1 Verification:
  "Pre-Step-3, the four non-AC-5 tests FAIL"); the full-suite run is 4 failed / 518 passed, coverage 81.23%.
  The harness was proven GREEN-capable by a temporary, reverted, uncommitted probe of the Step 3 change
  (5/5 passed). **Disposition**: expected per spec; Step 3 GREEN re-runs these tests.
- **Step 2 (2026-10-28)** — committed with its four stalled-config tests RED by design (spec Step 2 Verification:
  "All four tests FAIL before Step 3"); the full-suite run is 8 failed (Step 1's four + Step 2's four) / 518 passed,
  coverage 81.47%. A temporary, reverted, uncommitted probe of the Step 3 change gave 4/4 passed.
  **Disposition**: expected per spec; Step 3 GREEN re-runs these tests.
- **Step 2 (2026-10-28)** — RED-only side effect of AC-4: after the guard fires, the hung `TestClient` worker
  outlives the test and, once the fixture stops the server, reaches the real `register_oauth_client`, logging
  `DCR failed: mtls: … must all be set` (no test fails from it). It disappears once Step 3 bounds the reads.
  **Disposition**: accepted (RED-phase only; no scope change).
- **Step 3 (2026-10-28)** — committed before Step 6 (dev `GetConfig` latency baseline). The spec prefers Step 6 first
  but allows it to complete "before the integration PR at the latest" (Step Dependencies; Step 6 Instruction 2's
  "if Step 3 has already landed" branch). Grafana_Cloud MCP is still unreachable (HTTP 424), so Step 6 cannot be
  measured in this session either way. If the operator's p99 rules out D = 3.0 s, the constant and the `== 3.0`
  pins change together before the integration PR. **Disposition**: open — P-03 escalation carried to Step 6 / checkpoint.
- **Step 4 (2026-10-28)** — design.md §6 asked for a `_CONFIG_READ_TIMEOUT_S` "row next to `_POLICY_READ_TIMEOUT_S`" in the
  agent `CLAUDE.md`; the `## Config Keys Consumed` table lists config keys only, so (as the spec's Step 4 Evidence prescribes)
  the constant is named in one sentence under the section heading plus the `agent.opportunities.read_timeout_seconds` row.
  The `oauth_server.py` resolved bullet cites the identity check by symbol/message (`identityServiceImpl.ts#redirect_uris must
  use https`) instead of `:385-388`, per the findings docs' cite-symbols convention. `docs/runbooks/mcp-tools.md` checked,
  unchanged (`:209`, `:1698` describe the threshold and default only). **Disposition**: accepted (same intent, no scope change).
- **Step 5 (2026-10-29)** — operator decision (Option A, binding) on the Step 5 blocker: the planned
  `agent-rpc-deadlines` report duplicates the existing `docs/reports/2026-10-21-agent-client-deadlines-defect.md`
  (sidecar `triaged` / `ref: feature:273-fix-agent-client-deadlines`), which already covers every agent → backend RPC
  other than `get_config_value`, including `client.get_config` (`:2043`) and identity calls. So:
  - the `agent-rpc-deadlines` report and its `.status` are **not** created (the step's **Evidence** claim "No existing
    report covers these follow-ups" was stale for this one);
  - only two reports are created, dated with the execution date per the step's own rule: actual filenames
    `docs/reports/2026-10-29-agent-config-snapshot-read-defect.md` / `.status` and
    `docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md` / `.status`; the agent findings index section is
    `## Filed as defect reports (2026-10-29)` with 2 rows;
  - out-of-**Files** edit (F-08): `docs/reports/2026-10-21-agent-client-deadlines-defect.md` gains one cross-reference
    line naming `register_oauth_client` and feature 247's exclusion;
  - Step 5 **Verification** is changed to check 2 reports (operator-authorized exception to step-body immutability),
    and the deferred-slug mapping (Step Dependencies above, `design.md`, `context.md`) now points at feature 273.
  **Disposition**: accepted by operator (Option A).
- **Step 6 (2026-10-29)** — Step 6 deferred to operator — integration PR merge held until the operator restores agent
  trace export on dev and records the baseline. Grafana Cloud traces were reachable this session (datasource
  `grafanacloud-traces`), but there is nothing to measure: over 2026-10-28T00:00Z–2026-10-29T00:00Z,
  `{ } | count_over_time() by (resource.service.name, resource.deployment.environment)` lists ten dev services and
  no `agent`; `{ name =~ ".*GetConfig.*" } | count_over_time()` returns no series; and
  `{ resource.service.name =~ ".*agent.*" }` over 2026-10-28T02:00Z–2026-10-29T02:00Z returns 0 traces.
  `.do/app.dev.yaml:32-36` still holds the placeholder `YOUR_DEV_OTEL_EXPORTER_OTLP_ENDPOINT`/`_HEADERS` values.
  The operator must do three things:
  1. Confirm `xstockstrat-agent` is running on dev with `OTEL_ENABLED=true` and a real OTLP endpoint and headers.
  2. Run `{ resource.service.name = "agent" && name = "/xstockstrat.config.v1.ConfigService/GetConfig" } | quantile_over_time(span:duration, .5, .99)`
     plus `count_over_time()` and `max_over_time(span:duration)` over a window of at least 24 h. Tempo caps a
     metrics query at 25 h, so a longer window is split into ≤ 25 h queries.
  3. Record count, p50, p99, max and the margin against D = 3.0 s in `context.md` under `GetConfig latency baseline`.
  If p99 is not comfortably below 3.0 s, `_CONFIG_READ_TIMEOUT_S` and its `== 3.0` pins change before the
  integration PR (design change). Step **Status** stays `pending`. **Disposition**: resolved 2026-10-29 — see next entry.
- **Step 6 (2026-10-29, resolved)** — the operator ran the baseline query once the dev agent began exporting
  traces (first agent spans 2026-10-29T02:15Z; the earlier windows ended before that, so the "Not measured" entry
  was correct when written). Over 2026-10-28T01:45Z–2026-10-29T02:43Z (the 25 h Tempo cap): count 27, p50 24 ms,
  p99 ≤ 134 ms (Tempo power-of-two bucket bound), max 83.4 ms, all `rpc.grpc.status_code = 0`. p99 is far below
  D = 3.0 s, so `_CONFIG_READ_TIMEOUT_S` and its `== 3.0` pins stand. Figures in context.md
  `GetConfig latency baseline (measured)`. Step **Status** → `done`. **Disposition**: accepted (operator-recorded).
