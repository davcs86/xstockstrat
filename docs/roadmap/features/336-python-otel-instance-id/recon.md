# Recon: python-otel-instance-id

**Created**: 2026-11-12
**From**: product-spec.md
**Tree**: ccr-63b017b0-2g0zy5@d95f8a1 ≡ origin/ccr-63b017b0-2g0zy5
**Affected services**: xstockstrat-analysis, xstockstrat-ingest, xstockstrat-indicators, xstockstrat-agent

---

## Objective

Make the four Python services export `service.instance.id = <host.provider>-<service.name>` (for example `homelab-analysis`) on the single OTel Resource that feeds their tracer, meter and logger providers, as Go, Node and UI already do. This supersedes feature 332 decision D-7 and scenario `@AC-21` for Python, and lets the documented `{service_instance_id=~"homelab-.+"}` selector and post-deploy check cover all 12 services.

## Codebase Map

All four services share one shape: a private `_host_provider()`, a private `_build_resource()` returning `Resource.create({...})` with four keys, and one `init_telemetry()` that builds the Resource once and hands the same object to all three providers. Nothing under any of the four sets `service.instance.id`, `OTEL_RESOURCE_ATTRIBUTES` or `OTEL_SERVICE_NAME`.

- **`xstockstrat-analysis`** (Python)
  - Entry point: `services/xstockstrat-analysis/app/main.py:41` (`init_telemetry()` first call in `serve()`); `Dockerfile:20-21` `ENTRYPOINT /docker-entrypoint.sh`, `CMD python -m app.main`
  - Resource builder: `app/telemetry.py:31-43` (`_build_resource`; `Resource.create` at `:36`); `_host_provider` `:25-28`
  - `init_telemetry` `:164-224`: `resource = _build_resource()` at `:190`; `TracerProvider(resource=resource)` `:196`, `MeterProvider(resource=resource, …)` `:201-204`, `LoggerProvider(resource=resource)` `:207`
  - Other: `svc_name = os.getenv("SERVICE_NAME", "analysis")` re-read at `:188`, used only in the log line `:221`
  - Tests: `tests/test_telemetry.py:10-34` `test_build_resource_omits_trading_mode` (no instance-id assertion); `:172-218` `test_init_exports_metrics_and_logs_with_resource`, assertions `:217-218`, stale comment `:175`; `tests/conftest.py:506` `otel_reset`
  - Last migration: not applicable
- **`xstockstrat-ingest`** (Python)
  - Entry point: `app/main.py:44`; `Dockerfile:20-21`
  - Resource builder: `app/telemetry.py:31-43` (`Resource.create` `:36`); `_host_provider` `:25-28`; caller `:187`
  - Feature 334 region (`Loop` enum, `LOOP_TICK_OK`): `:333-341`, well clear of the builder
  - Tests: `tests/test_telemetry.py:10-34`, `:172-218` (assertions `:217-218`, comment `:175`), `:221-242` `test_unset_host_provider_exports_unknown`; `tests/conftest.py:102` `otel_reset`
- **`xstockstrat-indicators`** (Python)
  - Entry point: `app/main.py:44`; `Dockerfile:30-31`
  - Resource builder: `app/telemetry.py:30-42` (`Resource.create` `:35`); `_host_provider` `:24-27`; caller `:186`
  - Feature 329 startup-log region: `:207-218` (after the resource build at `:186-205`)
  - Sandbox: `app/services/sandbox.py:722` `subprocess.Popen([sys.executable, "-"], …, env=_sandbox_env())`; `_sandbox_env()` `:161-177` returns only `PYTHONPATH`, `PYTHONDONTWRITEBYTECODE`, `HOME`, `TMPDIR`, thread limit — strips `OTEL_*`, `HOST_PROVIDER`, `SERVICE_NAME`; the child imports no `app.telemetry`
  - Tests: `tests/test_telemetry.py:10-34`, `:173-218` (assertions `:217-218`, comment `:175`); `tests/conftest.py:196` `otel_reset`; no end-to-end unset-`HOST_PROVIDER` test
- **`xstockstrat-agent`** (Python MCP server)
  - Entry point: `app/main.py:281-285` (`main()` → `init_telemetry()`); `Dockerfile:21-22` `CMD supervisord -c /app/supervisord.conf`; `supervisord.conf:5-6` one program `[program:app-main]` → `python -m app.main` (`autorestart=true`); `app/main.py:270-278` `uvicorn.Config(…)` with no `workers`
  - Resource builder: `app/telemetry.py:23-35` (`Resource.create` `:28`); `_host_provider` `:17-20`; caller `:64`; `init_telemetry` `:38-92`
  - Tests: `tests/test_telemetry.py:20-34`, `:160-205` (assertions `:204-205`, comment `:162`), `:328-368` (sets `SERVICE_NAME=agent`, `APPLICATION_ENV=staging`); `tests/conftest.py:301` `otel_reset`; `tests/test_supervisord_conf.py` pins the one-program config
  - `instance_count: 1` in `.do/app.yaml:343` and `.do/app.dev.yaml:345`; stateless OAuth edge makes `instance_count > 1` safe (agent `CLAUDE.md`)

Process model (verified, all four): one Python process, one `init_telemetry()` call, no workers, forks or multiprocessing in `app/`. Analysis has a `ThreadPoolExecutor` (`app/services/compute_pool.py:17-18`), not processes.

## Patterns to REUSE

- Provider-prefixed id → reuse the already-shipped contract `f"{provider}-{serviceName}"`: UI `services/xstockstrat-ui/src/telemetry.ts:57`; Node `services/xstockstrat-notify/src/telemetry.ts:44` (same in identity `:43`, ledger `:43`, config `:42`); Go tests assert it (`services/xstockstrat-trading/internal/telemetry/otel_test.go:326,348`; marketdata, portfolio same).
- Provider normalisation → reuse each service's existing `_host_provider()` (exact lowercase `digitalocean`/`homelab`, else `unknown`); the id must use its normalised value (332 `@AC-3`/`@AC-4`/`@AC-13`).
- Service name → reuse the `os.getenv("SERVICE_NAME", "<svc>")` default already in `_build_resource` (`analysis :38`, `ingest :38`, `indicators :37`, `agent :30`); the id must use the exported `service.name`, so a single local value feeds both keys.
- Test capture → reuse the existing OTLP-HTTP body receiver and decode path in each `tests/test_telemetry.py` (`_start_body_receiver`, `_enable`, `_flush_all`, `otel_reset` in `tests/conftest.py`) and flip the existing assertion; for the unset-provider case reuse ingest's `test_unset_host_provider_exports_unknown` (`services/xstockstrat-ingest/tests/test_telemetry.py:221-242`) as the template for the other three (C-13: second consumer of the literal forces it into `tests/conftest.py`).
- Doc guard → `scripts/check-otel-produced-signals.py` (CI job "OTel produced-signal guard") and `scripts/tests/test_check_otel_produced_signals.py`; the `otel-guard:host-provider` PromQL and LogQL blocks in `docs/patterns/observability.md` must stay guard-valid.
- No shared Python helper exists across the four services (separate `uv` projects); `_host_provider` is already duplicated per service by design, so the id lines are four small parallel edits, not new duplication (C-18 trade-off to record in design.md).

## Existing Business Rules (preserve / extend)

Folded from the `scenario-recon` digest (`docs/sdd/business-rules/platform.feature`; the four services' own suites hold no instance-id or `host.provider` rules).

- **CHANGE** `@AC-21 @FR-1 @feature-332` "Python services keep an SDK-generated instance id" (`docs/sdd/business-rules/platform.feature` ~L2373) — its `Then` (non-empty and does not start with "homelab-") is reversed by this feature. Requires explicit sign-off in `context.md` (recorded: see Risks) and in-place annotation at promotion, per the `# Changed by @feature-<NNN>` convention used by 279 `@AC-13` / 332 header (~L2237-2240); the superseded scenario is annotated and its `Then` replaced, not deleted.
- **EXTEND** `@AC-19 @FR-1 @feature-332` "The series discriminator is deterministic per provider and service" (~L2355) — add Examples rows analysis/`homelab-analysis`, ingest/`homelab-ingest`, indicators/`homelab-indicators`, agent/`homelab-agent` alongside trading, ledger, ui.
- **EXTEND** `@AC-12 @FR-7 @feature-332` "Documentation states the attribute contract" (~L2337) — the sentence "Go, Node and UI set service.instance.id …" must also cover Python; if read literally as an exact runtime list it is a CHANGE under the same sign-off. Every other clause of that scenario stays.
- **PRESERVE** `@AC-1 @FR-1 @feature-332` (host.provider on all three signals, 12 runtimes) — host.provider, service.name, deployment.environment and platform stay on every signal.
- **PRESERVE** `@AC-3`, `@AC-4`, `@AC-13` `@FR-2 @feature-332` (unset / unrecognised / "Homelab" → `unknown`, still SERVING) and `@AC-5 @FR-2 @feature-332` (disabled starts cleanly) — the id uses the normalised provider and derivation must never raise; inert when `OTEL_ENABLED=false`.
- **PRESERVE** `@AC-10 @FR-5`, `@AC-11 @FR-5` `@feature-332` (`otel-guard:host-provider` PromQL/LogQL blocks) — the doc edit keeps both blocks guard-valid; the PromQL joins on `(job, instance, deployment_environment)` and both sides carry the same new id.
- **PRESERVE** `@AC-22 @FR-1 @feature-332` — the id is set in code, never via `OTEL_RESOURCE_ATTRIBUTES` in any deploy spec.
- **PRESERVE** `@AC-6`, `@AC-7`, `@AC-14`, `@AC-20` and `@AC-15 @FR-8` `@feature-332` — no compose or env change; local `docker-compose.yml` sets no `HOST_PROVIDER`.
- **PRESERVE** `@AC-10 @FR-1`, `@AC-2 @FR-2`, `@AC-19 @FR-1`, `@AC-9 @FR-7` `@regression @feature-274` and `@AC-1 @FR-1`, `@AC-2 @FR-3` `@regression @feature-171`, `@AC-42 @FR-15 @feature-294`, `@AC-13 @FR-9 @feature-279` — resource attributes, metric series names and the `service_name` label, exporter wiring, the three-signal doc list, no `trading_mode`, non-blocking init and no collector are untouched; only the `instance` / `service_instance_id` values change.
- no existing acceptance suite for `xstockstrat-ingest` touching OTel (its `acceptance/` dir has no instance-id or resource rule).

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none. `HOST_PROVIDER` and `SERVICE_NAME` are existing startup env vars, not `WatchConfig` keys.
- Inter-service edges: none
- New env vars / ports: none. Env wiring already present: `HOST_PROVIDER=digitalocean` app-wide in `.do/app.yaml:34-35` and `.do/app.dev.yaml:34-35`; `HOST_PROVIDER: homelab` in `deploy/homelab/compose.yml:8` (`x-common-env`); `SERVICE_NAME` per service (`docker-compose.yml` analysis `:394`, ingest `:353`, indicators `:315`, agent `:568`; `.do/app*.yaml` analysis `:333`, ingest `:279`, indicators `:225`; `deploy/homelab/compose.yml` analysis `:255`, ingest `:201`, indicators `:180`, agent `:317`).
- Pinned OTel: `opentelemetry-sdk` and `-api` 1.45.1 in all four `uv.lock` files (floors `>=1.25.0` in `pyproject.toml`); no manifest change needed.

## Risks / Not-found

- **Not found — SDK source:** no `opentelemetry/sdk/resources/__init__.py` exists on this host, so the source of today's SDK-generated `service.instance.id` and whether an explicit key passed to `Resource.create` wins over it are unverified. Every existing test asserts a non-empty id exists, which proves the SDK supplies one, not its precedence. The RED/GREEN wire test is the verification (Ledger `fails.md`, feature 274 rule: read or test the pinned library's actual path before claiming behavior).
- **Not found:** `HOST_PROVIDER` in local `docker-compose.yml` (intentional, 332 `@AC-15`); an unset provider yields `unknown-<service>` locally. `.do/app.dev.yaml` agent `SERVICE_NAME` not read in full (prod spec `.do/app.yaml:377-378` is `agent`).
- **Not found:** an indicators/analysis/agent end-to-end test for unset `HOST_PROVIDER` (only ingest has one, `:221`); AC-3/AC-9 need one per remaining service, or a parametrised variant of the shared pattern.
- **Test surface:** exactly the assertion pairs `analysis/ingest/indicators :217-218` and `agent :204-205` contradict the feature and must flip to the exact id (`homelab-<service>`); the stale "SDK instance id kept" comments (`:175`, agent `:162`) go with them. They cover the metrics resource only; the new assertions should cover traces, metrics and logs (spec AC-1). No other test references `_build_resource` beyond `tests/test_telemetry.py:27,29` in each service.
- **Series identity ripple:** Python `instance` and `service_instance_id` change from an SDK UUID to `<provider>-<service>`; old UUID series go stale once on the first deploy. `packages/otel/alerts` and `dashboards` key on `service_name`, but were not read exhaustively for `instance` pins (platform.feature `@AC-14`/`@AC-17` of 274 and 294 `@AC-43` target `service_name`/`rpc_*`, per `scenario-recon`; unverified).
- **Collision caveat:** a fixed id relies on one replica per service per stack (332 D-7; `observability.md:111`). Agent `instance_count: 1` today in both DO specs; if raised, replicas would share one id (design caveat, not a current break). Indicators sandbox children are env-stripped and import no OTel, so they cannot register a second exporter.
- **File overlaps (non-blocking, from `/sdd-review`):** `app/telemetry.py` analysis/indicators vs feature 329 (startup-log region `indicators :207-218`, disjoint from the builder); `ingest/app/telemetry.py` vs feature 334 (`Loop` enum `:333-341`, disjoint); `docs/patterns/observability.md` vs feature 333 (same doc; rebase the doc edit). The builder edits and 329/334 edits do not overlap line ranges today.
- **Ledger traps applied:** `fails.md` feature 274 (design wrapping an SDK must read the pinned library's real resolution path and add a test that fails on the naive assumption) and the 332-era unverified Python id source; do not repeat — ground FR-1 on a wire-level test per service.
- **Duplicate env read:** `init_telemetry` re-reads `SERVICE_NAME` for its log line (`analysis :188`, `ingest :185`, `indicators :184`, `agent :62`); not required by this feature (touch only what the task requires).

## Recommended Scope

Advisory step boundaries for the grilling and `/sdd-spec` (one service step + paired test step per C-08 where the repo's pairing allows; the two are one atomic unit if they cannot pass verification apart):

1. `xstockstrat-analysis`: add the id in `_build_resource`; flip `tests/test_telemetry.py:217-218`, extend the capture to traces and logs, add the unset-provider case (reuse ingest's `:221-242` shape).
2. `xstockstrat-ingest`: same edit; flip `:217-218`; its unset-provider test already exists.
3. `xstockstrat-indicators`: same edit and tests (add unset-provider case).
4. `xstockstrat-agent`: same edit; flip `:204-205`; add unset-provider case.
5. Docs: `docs/patterns/observability.md` (resource-attribute paragraph, post-deploy `instance` bullet and added count, "Open risks" series-budget and relabel-once items, selector note); keep the guard blocks valid; run `scripts/check-otel-produced-signals.py` and its pytest.
6. Business rules: annotate 332 `@AC-21` in place and extend `@AC-19`, `@AC-12` in `docs/sdd/business-rules/platform.feature` at launch/integration promotion (C-16), not as a service step.

Open design question for the grilling: whether the id lines live in each `_build_resource` as parallel edits (recommended by the reuse analysis) or in a shared helper (no shared Python package exists today).
