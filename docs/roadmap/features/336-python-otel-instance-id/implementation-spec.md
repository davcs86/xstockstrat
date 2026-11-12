# Implementation Spec: python-otel-instance-id

**Status**: `pending`
**Created**: 2026-11-12
**Feature**: `docs/roadmap/features/336-python-otel-instance-id/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/python-otel-instance-id`
**Tree**: `ccr-63b017b0-2g0zy5@5283446 ≡ origin/ccr-63b017b0-2g0zy5` (contains `origin/main-dev@cee3bae`; the feature branch does not exist on `origin` yet, so the feature files live on this branch, as recorded in `context.md` for `/sdd-review`)

---

## Execution Summary

Five atomic units, each a `**Lands with**` pair. U1-U4 (Steps 1-8) add one `"service.instance.id": f"{provider}-{service_name}"` key inside each Python service's `_build_resource()` (analysis, ingest, indicators, agent), test-first: the paired `tests/test_telemetry.py` step is RED by design, so a service step and its test step commit as one unit (design D-11, Constitution C-08/P-06). U5 (Steps 9-10) edits `docs/patterns/observability.md` and `services/xstockstrat-agent/CLAUDE.md` and adds two protective strings to the doc-contract test in `scripts/tests/test_check_otel_produced_signals.py`. Order: analysis first, because its RED/GREEN run is the first to learn whether an explicit key in `Resource.create` beats the SDK default; if a unit's unit-test goes GREEN but its wire test still shows a UUID, `/sdd-execute` halts and returns to design (D-6) before U2-U4. U5 is last so the doc describes shipped behavior. The `docs/sdd/business-rules/platform.feature` promotion (D-8, D-18, D-19, D-20) happens at integration, never in a step (F-08).

**Consumer surface (C-14):** None — internal/platform-only (product-spec `## Consumer Surface(s)`). This is a decision, not an omission: no UI segment and no agent MCP tool change. The id is a telemetry resource attribute read by operators in Grafana and by `scripts/check-otel-produced-signals.py`.

**Deploy-file audit:** no new env var and no new port. `HOST_PROVIDER` and `SERVICE_NAME` are existing startup env vars (`recon.md` Dependencies), so `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml` and `deploy/homelab/compose.yml` are intentionally unchanged. The id is never set through `OTEL_RESOURCE_ATTRIBUTES` (D-3, 332 `@AC-22`).

**Symbols, not line numbers (D-16):** line numbers below were confirmed on the tree above, but the `_build_resource` edit adds 3 lines and features 329 (analysis, indicators `app/telemetry.py`) and 334 (ingest `app/telemetry.py`) touch the same files. Locate edit sites by symbol.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` (4 services, homelab, three signals) | Step 2 (analysis), Step 4 (ingest), Step 6 (indicators), Step 8 (agent) wire tests |
| `@AC-2` (DigitalOcean) | Step 2 (analysis wire test stacked on `host_provider` `homelab`/`digitalocean`) |
| `@AC-3`, `@AC-9` (unset / unrecognised provider) | Step 4 (ingest `test_unrecognised_host_provider_exports_unknown_prefix` over None/"aws"/"Homelab"); the "reaches SERVING" clause rests on 332 `@AC-3/@AC-4/@AC-13` non-blocking-init coverage (D-10) |
| `@AC-4` (identical across two starts) | Step 6 (`test_instance_id_identical_across_two_process_starts`) |
| `@AC-5` (telemetry suites pass with `HOST_PROVIDER=homelab`) | Steps 2, 4, 6, 8 — the second verification run sets `HOST_PROVIDER=homelab` (D-13) |
| `@AC-13` (no `startswith("homelab-")` assertion remains) | Steps 2, 4, 6, 8 (per-file `grep -F`); repo-wide re-check in Step 10 |
| `@AC-6`, `@AC-10`, `@AC-14`, `@AC-15`, `@AC-16` (doc wording) | Step 9 — named `grep` verifications (design `C-15` line: "a test step or a named verification") |
| `@AC-11`, `@AC-17` (doc count and selector) | Step 9 (text) and Step 10 (the two strings in `test_the_host_provider_contract_stays_documented`, D-22) |
| `@AC-12` (produced-signals guard still passes) | Step 10; Step 9 also runs the guard script |
| `@AC-7`, `@AC-8`, `@AC-18` (`@manual`) | **Not automated** (product spec: `/sdd-spec` must not automate them). Step 9 writes the documented post-deploy check they execute; the operator runs them on homelab staging after deploy and records the result in `context.md` at integration |

## Step Dependencies

- Steps 1 and 2 land together (U1): Step 2's tests assert a key Step 1 adds, so Step 2 cannot pass its own `**Verification**` without Step 1; commit as one unit (`step-constraints.md` §C, D-11).
- Steps 3 and 4 land together (U2); Steps 5 and 6 land together (U3); Steps 7 and 8 land together (U4); same reason.
- Steps 9 and 10 land together (U5): Step 10's added doc-contract strings are RED until Step 9 writes them into `observability.md`.
- Step 3 requires Step 1 only in the sense of the stop condition: execute U1 first; if U1's wire test is GREEN only in the unit test but still shows a UUID (the SDK default wins), halt and return to `/sdd-design` before U2-U4 (D-6). U1-U4 are otherwise independent and may be reordered once U1 is green.
- Step 9 follows Steps 1-8 so the doc states shipped behavior. If feature 333 (`otel-env-provider-scoped-alerts`, `spec-ready`) merges to `main-dev` first, rebase Step 9 onto it; otherwise 333 rebases onto this feature. Re-run `python3 scripts/check-otel-produced-signals.py` after any rebase (D-15).
- Non-blocking overlaps: feature 329 (`spec-ready`, `app/telemetry.py` in analysis and indicators, startup-log region) and 334 (`code-completed`, `services/xstockstrat-ingest/app/telemetry.py`, `Loop` enum region) edit regions that do not overlap `_build_resource`; re-anchor by symbol if either lands first.
- Out of the step list (F-08): `docs/sdd/business-rules/platform.feature` (`@AC-21` and `@AC-12` CHANGE, `@AC-19` EXTEND, Constitution C-16) is edited only at integration promotion.
- Verification environment (D-17): each unit tries `uv sync --frozen --extra dev` locally. The sandbox has no OpenTelemetry SDK installed (`python3 -c "import opentelemetry.sdk.resources"` fails), so if `uv`/PyPI is unreachable the CI `python-test` matrix is the gate, and the RED text is recorded from a RED-only run, never predicted.

---

### Step 1 — service: analysis exports `service.instance.id` (U1)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "def _host_provider\|def _build_resource\|Resource.create\|resource = _build_resource" services/xstockstrat-analysis/app/telemetry.py` → `_host_provider` `:25`, `_build_resource` `:31`, `Resource.create` `:36`, `resource = _build_resource()` `:190`.
- Existing pattern (`:25-28`): `_host_provider()` returns `p if p in ("digitalocean", "homelab") else "unknown"` from `os.getenv("HOST_PROVIDER", "")`.
- Existing pattern (`:36-43`): `Resource.create({"service.name": os.getenv("SERVICE_NAME", "analysis"), "deployment.environment": os.getenv("APPLICATION_ENV", "development"), "platform": "xstockstrat", "host.provider": _host_provider()})`.
- `init_telemetry` builds the Resource once and passes the same object to `TracerProvider(resource=resource)` `:196`, `MeterProvider(resource=resource, …)` `:201-204`, `LoggerProvider(resource=resource)` `:207`, so one edit covers traces, metrics and logs.
- Shipped contract to mirror: `services/xstockstrat-ui/src/telemetry.ts:57`, `services/xstockstrat-notify/src/telemetry.ts:44` (`f"{provider}-{serviceName}"`).
- `init_telemetry`'s own `svc_name = os.getenv("SERVICE_NAME", "analysis")` at `:188` (log line only) is left untouched (D-2).
- **Not found:** the pinned `opentelemetry-sdk` 1.45.1 source (not installed on this host), so whether an explicit key wins over the SDK default is unverified here; Step 2's RED/GREEN run is the proof (D-6).

**Lands with**: `Step 2`

**TDD**: `red-green required`. RED is Step 2's tests failing before this step.

**Covers**: —

**Instructions**:
1. In `_build_resource()`, after the deferred `from opentelemetry.sdk.resources import Resource`, add two locals above `return Resource.create(`: `service_name = os.getenv("SERVICE_NAME", "analysis")` and `provider = _host_provider()`.
2. Feed the dict from them: `"service.name": service_name`, `"host.provider": provider`, and append `"service.instance.id": f"{provider}-{service_name}"` as the last key. Key order of the other three attributes is unchanged.
3. Add no comment, no helper, no import and no `OTEL_RESOURCE_ATTRIBUTES` handling (D-1, D-3, R-1, R-2). The unset/unrecognised path needs no branch: `_host_provider()` already returns `unknown`, so the id is `unknown-analysis` (332 `@AC-3/@AC-4/@AC-13` preserved). Leave the docstring and `init_telemetry` untouched.

**Verification**: the union with Step 2 (run from the repo root).
```bash
cd services/xstockstrat-analysis \
  && ruff check . && ruff format --check .
```
then the Step 2 commands.

---

### Step 2 — test: analysis wire and unit assertions for the new id (U1)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "def test_build_resource_omits_trading_mode\|def test_init_exports_metrics_and_logs_with_resource\|startswith\|SDK instance id" services/xstockstrat-analysis/tests/test_telemetry.py` → unit test `:20` (parametrize `:10-19`, two params `host_provider`/`want`), wire test `:173` (stacked `@pytest.mark.parametrize("headers", HEADER_FORMS)` `:172`), stale comment `:175`, assertions `:215-218`.
- Existing pattern: the wire test sets `monkeypatch.setenv("HOST_PROVIDER", "homelab")`, runs `init_telemetry()` against `_start_body_receiver()`, decodes metrics/logs/traces bodies, and loops the three `resource` messages asserting `platform`, `service.name`, `deployment.environment`, no `trading_mode`, `host.provider == "homelab"`; the last four lines (`metrics_resource = …`, `metrics_res = …`, `assert metrics_res.get("service.instance.id")`, `assert not metrics_res["service.instance.id"].startswith("homelab-")`) are the superseded 332 `@AC-21` rule.
- `tests/conftest.py:506` `otel_reset`; helpers `_start_body_receiver`, `_enable`, `_flush_all` are module-local (`:114`, `:133`, `:139`).
- C-13 verdict: the expected ids (`homelab-analysis`, `digitalocean-analysis`) are per-scenario expected values with the parameter as source, not shared domain fixtures (D-14); no `conftest.py` constant is added.

**Lands with**: `Step 1`

**TDD**: `red-green required`. Run the telemetry tests before Step 1 and record the observed failures in `context.md`. Expected: the unit test fails on `attrs["service.instance.id"]` — record whether it is a `KeyError` (the SDK adds the UUID downstream of `Resource.create`) or a value mismatch (the SDK already adds it inside `Resource.create`'s output); this answers where the UUID comes from (D-6). The wire test fails on the exact-id assertion. Never record a predicted failure (D-17).

**Covers**: `AC-1, AC-2, AC-5, AC-13`

**Instructions**:
1. Unit test `test_build_resource_omits_trading_mode` (`:10-34`): widen the parametrize to `("host_provider", "want", "service_name")` with ids `unset`, `aws`, `Homelab`, `homelab`, `digitalocean-default-name`. The first four set `SERVICE_NAME` to `"analysis"`; the last is `("digitalocean", "digitalocean", None)` and does `monkeypatch.delenv("SERVICE_NAME", raising=False)`, so the default-name path is exercised. Add `assert attrs["service.instance.id"] == f"{want}-{attrs['service.name']}"`. Keep the existing `trading_mode`/`service.name`/`deployment.environment`/`platform`/`host.provider` assertions.
2. Wire test `test_init_exports_metrics_and_logs_with_resource`: add `@pytest.mark.parametrize("host_provider", ["homelab", "digitalocean"])` under the existing `headers` parametrize and add `host_provider` to the signature. Replace `monkeypatch.setenv("HOST_PROVIDER", "homelab")` with `monkeypatch.setenv("HOST_PROVIDER", host_provider)` and add `monkeypatch.setenv("SERVICE_NAME", "analysis")`. In the three-resource loop change `assert res["host.provider"] == "homelab"` to compare against `host_provider` (a literal `"homelab"` would fail the `digitalocean` case) and add `assert res["service.instance.id"] == f"{host_provider}-analysis"`. This asserts the id on all three decoded signals (D-9, D-16c).
3. Delete the four-line `metrics_resource`/`metrics_res`/`get`/`not startswith` block (`:215-218`).
4. Replace the two-line comment at `:174-175` with two lines of at most 100 characters (ruff E501, `line-length = 100`, D-12): `# AC-19 (extends 226 AC-1) + AC-10 row; 332 AC-1 (Python row) + 336 AC-1:` and `# host.provider and the provider-prefixed id on every signal.`

**Verification**: the union with Step 1, run from the repo root. Telemetry tests twice (AC-5's evidence is the `HOST_PROVIDER=homelab` run), the coverage floor, lint, and the AC-13 grep.
```bash
cd services/xstockstrat-analysis \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && HOST_PROVIDER=homelab uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q \
  && ruff check . && ruff format --check . \
  && ! grep -nF 'not metrics_res["service.instance.id"].startswith("homelab-")' tests/test_telemetry.py \
  && ! grep -n "SDK instance id kept" tests/test_telemetry.py
```
The full-suite coverage run needs PostgreSQL binaries for the analysis `real_pg` tests (`.github/workflows/ci.yml` installs them); if they are absent locally, the CI `python-test` matrix is the coverage gate (D-17). C-13: no `conftest` import added (`grep -n "conftest" tests/test_telemetry.py` shows none).

---

### Step 3 — service: ingest exports `service.instance.id` (U2)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via: `grep -n "def _host_provider\|def _build_resource\|Resource.create\|resource = _build_resource" services/xstockstrat-ingest/app/telemetry.py` → `_host_provider` `:25`, `_build_resource` `:31`, `Resource.create` `:36`, `resource = _build_resource()` `:187`; providers at `:193`, `:198-201`, `:204`.
- Existing pattern (`:36-43`): identical dict shape to analysis with `os.getenv("SERVICE_NAME", "ingest")` at `:38`; log-line re-read `svc_name = os.getenv("SERVICE_NAME", "ingest")` at `:185` is left untouched.
- Feature 334 region (`Loop` enum, `LOOP_TICK_OK`) at `:333-341` is disjoint from `_build_resource`.

**Lands with**: `Step 4`

**TDD**: `red-green required`. RED is Step 4's tests failing before this step.

**Covers**: —

**Instructions**: Identical edit to Step 1 in `services/xstockstrat-ingest/app/telemetry.py`'s `_build_resource()`: hoist `service_name = os.getenv("SERVICE_NAME", "ingest")` and `provider = _host_provider()` above `return Resource.create(`, feed `service.name` and `host.provider` from them, append `"service.instance.id": f"{provider}-{service_name}"` as the last key. No comment, helper or import.

**Verification**: the union with Step 4.
```bash
cd services/xstockstrat-ingest \
  && ruff check . && ruff format --check .
```
then the Step 4 commands.

---

### Step 4 — test: ingest wire, unit and unrecognised-provider assertions (U2)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|startswith\|SDK instance id" services/xstockstrat-ingest/tests/test_telemetry.py` → unit test `:20` (parametrize `:10-19`), wire test `:173`, stale comment `:175`, assertions `:215-218`, `test_unset_host_provider_exports_unknown` `:221-242`.
- Existing pattern (`:221-242`): `monkeypatch.delenv("HOST_PROVIDER", raising=False)`, `_start_body_receiver()`, `_enable`, `init_telemetry()`, one counter add, `_flush_all()`, decode `/otlp/v1/metrics`, assert `res["host.provider"] == "unknown"`. Only ingest has an end-to-end unset-provider test today; the other three services get the unset case through the unit test's `unset` id (D-16a).
- `tests/conftest.py:102` `otel_reset`. C-13 verdict: `unknown-ingest` and `homelab-ingest` are per-scenario expected values (D-14); no `conftest.py` constant.

**Lands with**: `Step 3`

**TDD**: `red-green required`. Run before Step 3, record the observed failure text and the unit-RED mode (`KeyError` vs mismatch) in `context.md` (D-6, D-17).

**Covers**: `AC-1, AC-3, AC-5, AC-9, AC-13`. The "reaches SERVING" clause of AC-3/AC-9 is covered by the 332 `@AC-3/@AC-4/@AC-13` non-blocking-init coverage; the test does not boot a gRPC server (D-10).

**Instructions**:
1. Unit test `test_build_resource_omits_trading_mode` and wire test `test_init_exports_metrics_and_logs_with_resource`: apply Step 2's items 1, 3 and 4 with `"ingest"` in place of `"analysis"` (unit parametrize ids and the `service_name` parameter; delete `:215-218`; replace the `:174-175` comment). In the wire test add `monkeypatch.setenv("SERVICE_NAME", "ingest")` and, in the three-resource loop, `assert res["service.instance.id"] == "homelab-ingest"`. Do not add the `digitalocean` stacking here (that is analysis-only, AC-2).
2. Rename `test_unset_host_provider_exports_unknown` to `test_unrecognised_host_provider_exports_unknown_prefix` and add `@pytest.mark.parametrize("host_provider", [None, "aws", "Homelab"], ids=["unset", "aws", "Homelab"])` plus the `host_provider` argument. Body: `delenv` when `None`, else `setenv("HOST_PROVIDER", host_provider)`; add `monkeypatch.setenv("SERVICE_NAME", "ingest")`; keep the existing `res["host.provider"] == "unknown"` assertion (AC-9) and add `assert res["service.instance.id"] == "unknown-ingest"` (AC-3). Update the comment to cite `Feature 332 AC-3 + 336 AC-3/AC-9`, at most 2 lines.

**Verification**: the union with Step 3.
```bash
cd services/xstockstrat-ingest \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && HOST_PROVIDER=homelab uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q \
  && ruff check . && ruff format --check . \
  && ! grep -nF 'not metrics_res["service.instance.id"].startswith("homelab-")' tests/test_telemetry.py \
  && ! grep -n "SDK instance id kept\|def test_unset_host_provider_exports_unknown" tests/test_telemetry.py
```
The `HOST_PROVIDER=homelab` run covers the `aws`/`Homelab`/`unset` cases because each sets or deletes the variable itself. C-13: no `conftest` import added.

---

### Step 5 — service: indicators exports `service.instance.id` (U3)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `grep -n "def _host_provider\|def _build_resource\|Resource.create\|resource = _build_resource" services/xstockstrat-indicators/app/telemetry.py` → `_host_provider` `:24`, `_build_resource` `:30`, `Resource.create` `:35`, `resource = _build_resource()` `:186`; providers at `:192`, `:198`, `:203`.
- Existing pattern (`:35-42`): same dict shape with `os.getenv("SERVICE_NAME", "indicators")` at `:37`; log-line re-read at `:184` left untouched. Feature 329 startup-log region (`:207-218`) is disjoint.
- Sandbox children never register an exporter: `services/xstockstrat-indicators/app/services/sandbox.py:722` `subprocess.Popen([sys.executable, "-"], …, env=_sandbox_env())`, and `_sandbox_env()` (`:161-177`) returns only `PYTHONPATH`, `PYTHONDONTWRITEBYTECODE`, `HOME`, `TMPDIR` and a thread limit, stripping `OTEL_*`, `HOST_PROVIDER` and `SERVICE_NAME`; the child imports no `app.telemetry`. The fixed id therefore cannot collide inside one service.

**Lands with**: `Step 6`

**TDD**: `red-green required`. RED is Step 6's tests failing before this step.

**Covers**: —

**Instructions**: Identical edit to Step 1 in `services/xstockstrat-indicators/app/telemetry.py`'s `_build_resource()`, with `os.getenv("SERVICE_NAME", "indicators")`.

**Verification**: the union with Step 6.
```bash
cd services/xstockstrat-indicators \
  && ruff check . && ruff format --check .
```
then the Step 6 commands.

---

### Step 6 — test: indicators wire, unit and two-process-start assertions (U3)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|^CHILD\|startswith\|SDK instance id" services/xstockstrat-indicators/tests/test_telemetry.py` → unit test `:20` (parametrize `:10-19`), wire test `:173`, stale comment `:175`, assertions `:215-218`, module `CHILD` script `:329-350`, `test_sigterm_flushes_metrics_and_logs_at_normal_exit` `:352`.
- Existing pattern (`:352-384`): builds `env = {**os.environ, "OTEL_ENABLED": "true", "OTEL_EXPORTER_OTLP_ENDPOINT": …, "OTEL_EXPORTER_OTLP_HEADERS": HEADER_FORMS[0], "OTEL_METRIC_EXPORT_INTERVAL": "600000", "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1", "PYTHONPATH": str(SERVICE_DIR)}`, runs `subprocess.Popen([sys.executable, "-c", CHILD], cwd=SERVICE_DIR, env=env, stdout=PIPE, stderr=DEVNULL, text=True)`, waits for `ready`, asserts no `/v1/metrics` yet, sends `SIGTERM`, `proc.wait(timeout=30) == 0`, tears the receiver down, then asserts `/otlp/v1/metrics` and `/otlp/v1/logs` were seen. The module imports `json`, `os`, `signal`, `subprocess`, `sys` (`:97-104`).
- `tests/conftest.py:196` `otel_reset`. C-13 verdict: `homelab-indicators` appears in the wire test and the two-start test of one file as per-scenario expected values (D-14); no `conftest.py` constant.

**Lands with**: `Step 5`

**TDD**: `red-green required`. Run before Step 5, record observed failures and the unit-RED mode in `context.md` (D-6, D-17).

**Covers**: `AC-1, AC-4, AC-5, AC-13`

**Instructions**:
1. Unit test and wire test: apply Step 4 item 1 with `"indicators"` and `homelab-indicators` (parametrize widening, delete `:215-218`, replace the `:174-175` comment, set `SERVICE_NAME`, add the exact-id assertion in the three-resource loop).
2. Move the body of `test_sigterm_flushes_metrics_and_logs_at_normal_exit` into a module helper `_run_child_to_sigterm(**extra_env)` that merges `extra_env` into `env` after the existing keys, performs the identical subprocess lifecycle (including the pre-SIGTERM "no `/v1/metrics` yet" assertion, `wait(timeout=30)`, and the `NO_PROXY`/`no_proxy` `127.0.0.1` entries, D-5), and returns the `seen` list. `test_sigterm_flushes_metrics_and_logs_at_normal_exit` becomes a call to `_run_child_to_sigterm()` followed by the two existing path assertions.
3. Add `test_instance_id_identical_across_two_process_starts()`: loop twice, `seen = _run_child_to_sigterm(HOST_PROVIDER="homelab", SERVICE_NAME="indicators")`, take the body of the `/otlp/v1/metrics` entry, decode with `metrics_service_pb2.ExportMetricsServiceRequest().ParseFromString(...)`, read `service.instance.id` from `resource_metrics[0].resource.attributes`, and assert both runs equal `homelab-indicators` (AC-4). Cost: two interpreter starts, bounded by `wait(timeout=30)`.

**Verification**: the union with Step 5.
```bash
cd services/xstockstrat-indicators \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && HOST_PROVIDER=homelab uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=50 -q \
  && ruff check . && ruff format --check . \
  && ! grep -nF 'not metrics_res["service.instance.id"].startswith("homelab-")' tests/test_telemetry.py \
  && ! grep -n "SDK instance id kept" tests/test_telemetry.py
```
The coverage floor is 50 for indicators. The full run needs `libseccomp2` for the sandbox tests (CI installs it); if it is absent locally, the CI `python-test` matrix is the coverage gate (D-17). C-13: no `conftest` import added.

---

### Step 7 — service: agent exports `service.instance.id` (U4)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth statelessness (`instance_count > 1` must stay safe)

**Codebase Evidence**:
- Confirmed via: `grep -n "def _host_provider\|def _build_resource\|Resource.create\|resource = _build_resource" services/xstockstrat-agent/app/telemetry.py` → `_host_provider` `:17`, `_build_resource` `:23`, `Resource.create` `:28`, `resource = _build_resource()` `:64`; providers at `:66`, `:70-75`, `:77`.
- Existing pattern (`:28-35`): same dict shape with `os.getenv("SERVICE_NAME", "agent")` at `:30`; log-line re-read at `:62` left untouched.
- Process model: `services/xstockstrat-agent/supervisord.conf` runs one `[program:app-main]` (`python -m app.main`), pinned by `tests/test_supervisord_conf.py`; `app/main.py:270-278` `uvicorn.Config(…)` sets no `workers`. `instance_count: 1` in `.do/app.yaml:343` and `.do/app.dev.yaml:345`.
- This step changes no MCP tool, so no `docs/runbooks/mcp-tools.md` or tool-count surface needs to move.

**Lands with**: `Step 8`

**TDD**: `red-green required`. RED is Step 8's tests failing before this step.

**Covers**: —

**Instructions**: Identical edit to Step 1 in `services/xstockstrat-agent/app/telemetry.py`'s `_build_resource()`, with `os.getenv("SERVICE_NAME", "agent")`.

**Verification**: the union with Step 8.
```bash
cd services/xstockstrat-agent \
  && ruff check . && ruff format --check .
```
then the Step 8 commands.

---

### Step 8 — test: agent wire and unit assertions for the new id (U4)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth statelessness (`instance_count > 1` must stay safe)

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|startswith\|SDK instance id\|SERVICE_NAME" services/xstockstrat-agent/tests/test_telemetry.py` → unit test `:20` (parametrize `:10-19`), wire test `:160` (stacked `headers` parametrize `:159`), stale comment `:161-162`, assertions `:202-205`, `test_agent_resource_and_warn_log_correlated_to_span` `:328` (already sets `SERVICE_NAME=agent` and `APPLICATION_ENV=staging` at `:337-338`).
- Existing pattern: the agent wire test (`:160-205`) has the same decode-and-loop shape as the other three services but does not yet set `SERVICE_NAME`.
- `tests/conftest.py:301` `otel_reset`. C-13 verdict: per-scenario expected values, inline (D-14).

**Lands with**: `Step 7`

**TDD**: `red-green required`. Run before Step 7, record observed failures and the unit-RED mode in `context.md` (D-6, D-17).

**Covers**: `AC-1, AC-5, AC-13`

**Instructions**: Apply Step 4 item 1 with `"agent"` and `homelab-agent`: widen the unit parametrize, add `monkeypatch.setenv("SERVICE_NAME", "agent")` to the wire test (it has none today), add the exact-id assertion in the three-resource loop, delete the four-line block (`:202-205`), and replace the two-line comment at `:161-162` with the two lines from Step 2 item 4 (D-12). Leave `test_agent_resource_and_warn_log_correlated_to_span` as is.

**Verification**: the union with Step 7.
```bash
cd services/xstockstrat-agent \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && HOST_PROVIDER=homelab uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q \
  && ruff check . && ruff format --check . \
  && ! grep -nF 'not metrics_res["service.instance.id"].startswith("homelab-")' tests/test_telemetry.py \
  && ! grep -n "SDK instance id kept" tests/test_telemetry.py
```
C-13: no `conftest` import added.

---

### Step 9 — docs: observability contract and agent replica caveat (U5)

**Status**: `pending`
**Service**: `docs/patterns/` and `xstockstrat-agent` (docs only)
**Files**:
- `docs/patterns/observability.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence** (all confirmed on the tree above; locate by text, line numbers drift):
- `docs/patterns/observability.md:60` resource-attribute paragraph contains "Go, Node and UI set `service.instance.id` to `<host.provider>-<service.name>`; Python keeps its SDK-generated id."
- `:67-70` "What Grafana promotes" bullet says "On logs, `deployment_environment` and `host_provider` are structured metadata, so they are pipeline filters, not stream selectors." — pre-existing drift (D-21): 332 `recon.md:56` records the Loki stream labels as `deployment_environment`, `service_instance_id`, `service_name`, with `host_provider` structured metadata.
- `:78-95` the two `otel-guard:host-provider` fenced blocks (PromQL `:78-88`, LogQL `:90-92`) must stay byte-identical.
- `:97-107` "Post-deploy check (manual)": count bullet `:99-100` (`count(group by (job) (target_info{deployment_environment="staging", host_provider="homelab"}))` returns "at least 11 jobs on an idle stack and 12 after one UI login"), `:102` "`instance` is `homelab-<job>` for the 8 Go/Node/UI jobs."
- `:109-119` "Open risks": rolling-deploy bullet `:111-112`, series-budget bullet `:114-115` ending "plus Python restart churn (its instance id changes per process).", relabel-once bullet `:116-117` ("relabels the DO dev Go/Node/UI series once; the old instance-less series go stale").
- Guard scan limits for prose outside the fences (`scripts/check-otel-produced-signals.py` `scan_doc`, `:320-352`): only `xstk-…` asset names, `*.json|*.yaml` file names and "<n> dashboards / alert rules" count claims are checked there, so the new text must contain none of those. `check_query_blocks` (`:369-391`) reads only the two fenced blocks.
- `services/xstockstrat-agent/CLAUDE.md:185` "… `MCP_AGENT_SECRET`) — so `instance_count > 1` is safe. The MCP endpoint requires an" and `:186` "**`aud`-bound JWT** (…". (O-3, D-7)

**Lands with**: `Step 10`

**TDD**: `N/A (docs)`. The doc edits are verified by Step 10's red→green and the named greps below.

**Covers**: `AC-6, AC-10, AC-11, AC-14, AC-15, AC-16, AC-17` by the named verifications below. `@AC-7`, `@AC-8` and `@AC-18` are `@manual`: this step writes the documented check they execute; they are run by the operator after deploy and are not automated.

**Instructions**: all new text is prose or bullets outside every `otel-guard` fence.
1. Resource-attribute paragraph (`:60`): replace "Go, Node and UI set `service.instance.id` to `<host.provider>-<service.name>`; Python keeps its SDK-generated id." with a sentence that says Go, Node, UI and Python all set `service.instance.id` to `<host.provider>-<service.name>` in code (keep the exact phrase "Go, Node, UI and Python"), noting the id relies on one replica per service per stack. Leave the rest of the paragraph, including "Do not set `OTEL_RESOURCE_ATTRIBUTES`", unchanged.
2. "What Grafana promotes" bullet (`:67-70`, D-21): reword the logs sentence so `deployment_environment` and `service_instance_id` are Loki stream labels and `host_provider` is structured metadata, hence a pipeline filter (`| host_provider="homelab"`), not a stream selector. The fenced LogQL block and the documented `| host_provider="homelab"` filter stay unchanged.
3. Log-filter guidance: after the "For DO dev, use `host_provider="digitalocean"`…" paragraph (`:94-95`) add a short note documenting `{service_instance_id=~"homelab-.+"}` (exact string) as selecting all 12 homelab services because the instance id is `<host.provider>-<service.name>` for every runtime. Say to add `deployment_environment="staging"` (or `"production"`) because homelab staging and production share the `homelab-` prefix, and that `| host_provider="homelab"` remains the documented log filter.
4. Post-deploy check (`:97-107`): keep the existing `host_provider="homelab"` count bullet unchanged. Add a bullet with the exact expression `count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"}))` stating the same thresholds (at least 11 jobs on an idle stack and 12 after one UI login). Change `:102` to say `instance` is `homelab-<job>` for all 12 jobs.
5. Open risks (`:109-119`): (a) rolling-deploy bullet — state that all 12 services including Python now push identical `(job, instance, deployment_environment)` series during overlap, and that replicas of one service would share one `service.instance.id` (D-7, O-2); keep "Homelab `compose up` stops before it starts." (b) series-budget bullet — delete "plus Python restart churn (its instance id changes per process)" and keep the rest of the sentence; (c) relabel-once bullet — name the Python series alongside Go, Node and UI: the first deploy with a fixed instance id relabels each runtime's series once (Go, Node and UI on DO dev, whose old instance-less series go stale; Python on DO dev and homelab, whose old per-process UUID series go stale).
6. `services/xstockstrat-agent/CLAUDE.md:185-186` (D-7, D-20): add one clause that `instance_count > 1` is safe for OAuth but replicas would share one telemetry `service.instance.id` (pointing at `docs/patterns/observability.md`). Reflow only these two lines so the diff stays one hunk; keep the surrounding paragraph and the `oauth.md` pointer as is.

**Verification**: run from the repo root.
```bash
grep -n "Go, Node, UI and Python" docs/patterns/observability.md                                  # AC-6
! grep -n "Python keeps its SDK-generated id" docs/patterns/observability.md                      # AC-14
! grep -n "Python restart churn" docs/patterns/observability.md                                   # AC-10
grep -n "relabel" docs/patterns/observability.md | grep -n "Python"                               # AC-15 (relabel-once line names Python)
grep -nF 'homelab-<job>` for all 12 jobs' docs/patterns/observability.md                          # AC-16
grep -nF 'instance=~"homelab-.+"' docs/patterns/observability.md                                  # AC-11 (count bullet)
grep -n "at least 11 jobs" docs/patterns/observability.md                                         # AC-11 thresholds (two bullets)
grep -nF '{service_instance_id=~"homelab-.+"}' docs/patterns/observability.md                     # AC-17
! git diff -U0 docs/patterns/observability.md | grep -E '^[-+].*(rpc_server_duration_milliseconds_count|group by \(job, instance|\{service_name="analysis"\} \|)'   # guard blocks untouched
test "$(git diff -U0 services/xstockstrat-agent/CLAUDE.md | grep -c '^@@')" -eq 1                  # one surgical hunk
python3 scripts/check-otel-produced-signals.py                                                    # exit 0, no output (AC-12)
```

---

### Step 10 — test: protect the new doc contract in the guard suite (U5)

**Status**: `pending`
**Service**: `scripts/` (platform guard tests; no service owner in the registry)
**Files**:
- `scripts/tests/test_check_otel_produced_signals.py` — modify

**Reviewers**: none (platform scripts; the reviewer registry has no owner for `scripts/`)

**Codebase Evidence**:
- Confirmed via: `grep -n "def test_the_host_provider_contract_stays_documented" -A16 scripts/tests/test_check_otel_produced_signals.py` → the test at `:419-433` reads `(tree / OBS).read_text()` (`OBS = "docs/patterns/observability.md"` at `:336`, `tree` fixture `:74` copies the real repo tree) and asserts each string of a tuple is `in doc`: `"host.provider"`, `"digitalocean"`, `"homelab"`, `"unknown"`, `"<host.provider>-<service.name>"`, ``"Do not set `OTEL_RESOURCE_ATTRIBUTES`"``, the `host_provider="homelab"` count expression, `"egress"`, `"at least 11 jobs"`, `"12 after one UI login"`.
- The guard script's logic (`scripts/check-otel-produced-signals.py`) is not touched (product-spec Out of Scope); its CI job runs `python3 scripts/check-otel-produced-signals.py` and then `uv run --extra dev --frozen pytest tests/test_check_otel_produced_signals.py` from `scripts/` (`.github/workflows/ci.yml` job `otel-signals`), and `scripts-python` runs ruff and pytest in `scripts/`.
- C-13 verdict: single-consumer inline strings in a script test; no fixture home.

**Lands with**: `Step 9`

**TDD**: `red-green required`. Run the test before Step 9: the two new strings are absent from the unmodified doc, so it fails with an `assert … in doc` on `instance=~"homelab-.+"`. Step 9 turns it green. Record the observed text in `context.md`.

**Covers**: `AC-11, AC-12, AC-17`

**Instructions**: In the tuple inside `test_the_host_provider_contract_stays_documented`, append two strings after the existing `host_provider="homelab"` count entry: `'count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"}))'` and `'{service_instance_id=~"homelab-.+"}'` (D-22). Change nothing else in the file.

**Verification**: the union with Step 9, run from the repo root.
```bash
cd scripts \
  && uv run --extra dev --frozen pytest tests/test_check_otel_produced_signals.py -q \
  && ruff check . && ruff format --check . \
  && cd .. \
  && python3 scripts/check-otel-produced-signals.py \
  && ! grep -rnF 'not metrics_res["service.instance.id"].startswith("homelab-")' \
       services/xstockstrat-analysis/tests/test_telemetry.py \
       services/xstockstrat-ingest/tests/test_telemetry.py \
       services/xstockstrat-indicators/tests/test_telemetry.py \
       services/xstockstrat-agent/tests/test_telemetry.py
```
The last command is the repo-wide AC-13 re-check; the guard script and its pytest must both exit 0 with no failed check (AC-12). Scripts coverage: `scripts/` has no coverage threshold.

---

## Deviation Log

### Deviation 1 — development branch (all steps)
- **Spec said**: `**Feature Branch**: feature/python-otel-instance-id` (steps commit to that branch).
- **Actual**: commits land on `ccr-63b017b0-2g0zy5`, the session's assigned branch, which already holds the feature files and PR #1527.
- **Reason**: `feature/python-otel-instance-id` does not exist on `origin`, and this session may push only to `ccr-63b017b0-2g0zy5`.
- **Disposition**: operator-approved at the sequential up-front confirmation (context.md, 2026-11-12). No code impact.
