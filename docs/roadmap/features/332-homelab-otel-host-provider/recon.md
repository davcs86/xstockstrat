# Recon: homelab-otel-host-provider

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: ccr-6307b904-swdg1c@3fdf7ba ≡ origin/ccr-6307b904-swdg1c
**Affected services**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-agent, xstockstrat-config, xstockstrat-identity, xstockstrat-ledger, xstockstrat-notify, xstockstrat-ui + deploy surface

---

## Objective

Stamp every runtime's trace, metric and log resource with a new `host.provider` attribute (`digitalocean` | `homelab` | `unknown`, from env `HOST_PROVIDER`), and turn on direct OTLP export from the homelab Compose stack to the same Grafana Cloud stack DO uses, with the OTLP endpoint/header delivered through the existing SOPS path. Goal: homelab and DO data separable in queries even when `deployment.environment` collides (both `staging`).

## Codebase Map

Discovery for the three telemetry languages was grouped (identical module per language); Go/Python/Node/UI digests are `path:line`, per-service copies are line-identical unless noted.

- **Go** — trading, portfolio, marketdata (one `internal/telemetry/otel.go` each; no shared Go telemetry module; `go.work` lists only proto + the 3 services)
  - `newResource`: `internal/telemetry/otel.go:124-132` — `resource.New(ctx, resource.WithAttributes(semconv.ServiceName(serviceName()), semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")), attribute.String("platform","xstockstrat")))`; no `WithFromEnv/WithHost/WithProcess`.
  - One `res := newResource(ctx)` (`:58`) feeds trace `:65`, metric `:73`, log `:81` providers; no other resource builder (`logbridge.go:30` takes scope only).
  - `serviceName()` `:115-120`; `APPLICATION_ENV` read raw, no default (`:128`), because telemetry inits before config.
  - OTel pins: `otel`/`sdk`/`sdk/metric` v1.45.0, `sdk/log` v0.21.0 (`go.mod`).
  - Tests: `internal/telemetry/otel_test.go:45` `TestNewResourceOmitsTradingMode` (key presence via `res.Attributes()`); `:205` `TestExportedMetricsCarryResource` (decodes OTLP metrics, asserts values); helpers `startTelemetry:114`, `newOTLPReceiver:78`, `flush:132`; no trace/log resource assertion.
- **Python** — indicators, ingest, analysis, agent (copy-pasted `app/telemetry.py`; no shared package)
  - `_build_resource()`: indicators `:24-35`, ingest `:25-36`, analysis `:25-36`, agent `:17-28` — `Resource.create({"service.name", "deployment.environment" (default "development"), "platform"})`.
  - One resource feeds Tracer/Meter/Logger providers (indicators `:179,185,190,196`; ingest `:180,186,191,197`; analysis `:183,189,194,200`; agent `:57,59,63,70`).
  - `opentelemetry-sdk>=1.25.0`, locked 1.45.1 in every `uv.lock`.
  - Tests: `tests/test_telemetry.py:10-18` `test_build_resource_omits_trading_mode` (monkeypatch env, no fixture); wire test `test_init_exports_metrics_and_logs_with_resource` (`:157-186`; agent `:144-173`); no trace-resource assertion; `otel_reset` fixture in `tests/conftest.py` (indicators `:196`, ingest `:103`, analysis `:506`, agent `:302`).
- **Node** — config, identity, ledger, notify (copy-pasted `src/telemetry.ts`; no shared package)
  - `buildResource()` (config `:29-35`; identity/ledger `:30-36`; notify `:31-37`) — OTel JS 1.x `new Resource({...})`; consumed once by `NodeSDK({resource: buildResource()})` (config `:172`; identity/ledger `:173`; notify `:174`) which owns all three providers.
  - `resourceDetectors: [envDetectorSync, processDetectorSync, hostDetectorSync]` set explicitly (config `:183`) — Node already reads `OTEL_RESOURCE_ATTRIBUTES` and adds `host.*`; SDK ranges `resources ^1.25.0`, `sdk-node ^0.52.0`.
  - Build/test: `"test": "tsc && node --test dist/__tests__/*.test.js"`, tsconfig `module: commonjs`, no `allowImportingTsExtensions` (all four identical) — the strip-types ESM runner is gone (only stale comments remain).
  - Tests: `src/__tests__/telemetry.test.ts:19-27` unit (`buildResource().attributes`); `telemetry.export.test.ts:117-137` e2e asserts metrics resource only (logs read at `:140-156`).
- **UI (Next.js)** — `src/telemetry.ts:44-49` `resourceFromAttributes({ [ATTR_SERVICE_NAME], 'deployment.environment': process.env.APPLICATION_ENV ?? 'development', platform })` into `NodeSDK` (traces `:52`, metrics `:53-58`, logs `:59`); lazy `require()` inside `initTelemetry()` wrapped in try/catch (`:18, 67-69`) so a bad read cannot block boot; `OTEL_ENABLED !== 'true'` early return `:16`.
  - OTel JS 2.x (`@opentelemetry/resources ^2.7.1`, `sdk-node ^0.218.0`). `HOST_PROVIDER` is a plain runtime env read (same as `APPLICATION_ENV` `:47`); no build-time inlining (`next.config.js:12` inlines only `UI_THEME_BACKGROUND_HEX`; Dockerfile bakes only `UI_THEME`).
  - Tests: `src/instrumentation.testkit.ts` (harness; env setup `:58-75`, metrics resource assertion `:112-128`; traces `at('/v1/traces')` `:94-95`; logs decoded `:131-157`), wrapped by `instrumentation.test.ts:4` and `instrumentation.encoded-header.test.ts:4` (one file per variant because OTel globals are process-wide). vitest `include: ['src/**/*.test.ts']`.
- **Homelab / SOPS pipeline**
  - `deploy/homelab/compose.yml:4-8` `x-common-env` (`OTEL_ENABLED: "false"` `:7`); 12 runtime services merge it (config `:47`, ledger `:65`, identity `:84`, notify `:105`, marketdata `:129`, portfolio `:148`, indicators `:170`, ingest `:189`, trading `:212`, analysis `:239`, ui `:267`, agent `:301`); `db-migrator` (`:36-41`) does not. No service sets its own `OTEL_*`. Required-var idiom `${VAR:?VAR is required}` (`:5,6,8,12,15`).
  - `scripts/homelab-release-env.sh`: `owned` regex `:39`; APP_ENV filtered at `:41` (lines are `KEY='value'`); pipeline-owned writes `:43`.
  - `scripts/sops_secrets.py`: KEYS rows `:32-33` (`("common","OTEL_EXPORTER_OTLP_ENDPOINT"|"…_HEADERS", False, (DO,))`); `keys_for :66-82`; `resolve :148-189` (optional absent keys omitted); `mask :103` masks every decrypted SOPS value; `cmd_resolve :212-222` puts non-`HOMELAB_EXPORTS` names in `APP_ENV` via `_quoted :192-199`.
  - `.github/workflows/deploy-homelab.yml`: `P` defined `:62`; Resolve-secrets env `:98-118` (LEGACY lines `:101-117`, last common at `:109`); release-env `:156-159`; render-check `:161-162`.
  - `deploy/homelab/render-assert.jq`: env projection `:22`; `$apps` = services minus `db-migrator` `:25`; `otel:` check `:39` (`!= "false"`).
  - `scripts/homelab-render-check.sh:15-17` keeps only `required variable <VAR> is missing a value` from compose stderr.
  - Tests: `scripts/sops-secrets.test.sh` groups `resolve homelab deploy` (pins: DO-side `:155-159, :522, :579, :669-678`; homelab-moving `:735 expected_legacy`, `:747 COMMON_RE`, `:1067 check_legacy … homelab`; case 8 `:243-265` renders compose from a fixture); `scripts/homelab-render.test.sh` (`:81` asserts `OTEL_ENABLED="false"`, `base_env :39-45` has no OTEL vars).
- **DO + local + packages + docs**
  - `.do/app.yaml:25-40` / `.do/app.dev.yaml:25-40` global `envs:` (`OTEL_ENABLED` `"false"` prod / `"true"` dev at `:32-33`); no component overrides OTEL_ENABLED; literal `value: digitalocean` passes `scripts/do-render-app-spec.py` (`PLACEHOLDER :21`, `LEFTOVER :25`; only `YOUR_*` tokens are rewritten).
  - `docker-compose.yml:18` `OTEL_ENABLED: ${OTEL_ENABLED:-false}`; collector config has no `resource`/`attributes`/`transform` processor and no `resource_to_telemetry_conversion` (forwards resource attributes unchanged).
  - `packages/otel/dashboards/service-detail.json` variables `service :50-64`, `environment :66-83` use `label_values(rpc_server_duration_milliseconds_count, deployment_environment)`; no `target_info` join anywhere; `alerts/alert-rules.yaml:39,86,135` carry `platform: xstockstrat` as an alert label only.
  - `docs/patterns/observability.md`: env table `:50-57`, resource paragraph `:59` ("No `OTEL_RESOURCE_ATTRIBUTES` env var is needed or set"), Loki stream note `:22`; `docs/setup/grafana-cloud.md:28-34, :173`; `docs/runbooks/sops-secrets.md:9` ("OTEL: DO only"); `docs/patterns/ci-overview.md:75-76`; `packages/otel/dashboards/README.md:41-46`; `services/xstockstrat-ui/CLAUDE.md:323` (only service CLAUDE.md listing `OTEL_`).

### Live Grafana Cloud facts (queried 2026-11-11, `grafanacloud-prom` / `grafanacloud-logs`)

- `deployment_environment` **is a label on the metric series** (`count by (deployment_environment) (rpc_server_duration_milliseconds_count)` → `staging`); Grafana Cloud's default OTLP mapping promotes `service.name`→`job`, `service.instance.id`→`instance`, `deployment.environment`→`deployment_environment`. `host.name`, `platform` and the process/SDK attributes are only on `target_info`. **This corrects the product-spec Queryability bullet**, which said resource attributes land on `target_info` only.
- Metric series for **Go and Node** services (`trading`: labels `job, service_name, deployment_environment, rpc_*`) carry **no `instance`**; only the four **Python** services have `instance`/`service_instance_id` (SDK-generated).
- `target_info` has exactly one series per `job` today.
- Loki stream labels are `deployment_environment`, `service_instance_id`, `service_name`; `platform`, `detected_level`, `severity_text` are structured metadata, so `host_provider` would be structured metadata (filterable as `| host_provider="homelab"`).
- **Series-collision risk:** a homelab and a DO process of the same service with the same `deployment.environment` produce identical promoted label sets (`job`, `deployment_environment`, + Python `instance` differs, Go/Node does not). Nothing in the repo today prevents two senders writing the same series. Not exercised today (one DO instance per service, one environment per stack).

## Patterns to REUSE

- Resource attribute stamp → add to the existing single builder per language (`newResource`, `_build_resource`, `buildResource`, UI `resourceFromAttributes`); one resource already feeds all three signals, so one edit per file covers traces, metrics and logs.
- Env read + non-fatal init → reuse the `APPLICATION_ENV` pattern (`otel.go:128`, `telemetry.py` `os.getenv`, `telemetry.ts:47`) and the existing init try/catch (UI `:18, 67-69`); small helper functions in the module style of `metricIntervalOptions`/`logBatchOptions` (UI `telemetry.ts:2,10`) for the normaliser, which makes it unit-testable without touching OTel globals.
- Pipeline-owned values → reuse the `owned` regex + explicit write at `homelab-release-env.sh:39,43` and the `render-assert.jq` `<check>:<service>` label style (`otel:`, `trading-mode:`); add `host-provider:`.
- Required-var failure → reuse `${VAR:?VAR is required}` (`compose.yml:5,6,8,12,15`) and the `homelab-render-check.sh:15-17` filter.
- SOPS delivery → reuse `("common", …, False, (DO, HOMELAB))` row shape (`sops_secrets.py:27-31`); LEGACY form `secrets[format('{0}_…', env.P)]` from `deploy.yml:100-101`.
- `Authorization=` prefix → no reusable function exists; only inline `do-render-app-spec.py:104-107`. DRY candidate: one helper both call, or a documented duplicate in shell.
- Tests → extend `otel_test.go:205`, `test_telemetry.py` wire test, `telemetry.export.test.ts`, `instrumentation.testkit.ts` (add traces/logs resource assertions), `homelab-render.test.sh` case 3/5/7 (`mutate otel:… / host-provider:…`), `sops-secrets.test.sh` `hl_enc`/`cli` helpers. UI needs no fixture (C-12: resource test uses no domain objects).
- Query docs → no PromQL/LogQL parser or promtool in repo or CI; the closest reusable code is the `expr_tokens` identifier extraction in `scripts/check-otel-produced-signals.sh:131-170`.

## Existing Business Rules (preserve / extend)

(Folded from `scenario-recon`; all in `docs/sdd/business-rules/platform.feature` unless noted.)

- **CHANGE** `@AC-13 @FR-9 @feature-279` "OTel is off on the homelab" (≈ lines 1146-1150) — homelab `OTEL_ENABLED` becomes "true" for all 12 runtimes; "no otel-collector service" half stays PRESERVE. Enforced at `render-assert.jq:39`, `compose.yml:7`, `homelab-render.test.sh:81`. **Requires user sign-off recorded in `context.md`**; also update the stale pending copy `docs/roadmap/features/279-homelab-compose-deploy/acceptance.feature:98` and add a "Changed by @feature-332" comment when promoting.
- **EXTEND** `@AC-29 @FR-6 @feature-279` (render check names each broken render) — adds `otel:`/`host-provider:` labels; labels must carry no env value.
- **EXTEND** `@AC-8 @FR-6` and `@AC-22 @FR-6 @feature-279` (APP_ENV cannot override pipeline values) — `OTEL_ENABLED` and `HOST_PROVIDER` become pipeline-owned.
- **EXTEND** `@AC-2 @FR-1 @feature-279` (missing required value fails the render) — a missing OTLP var fails the render (332 AC-16).
- **EXTEND** `@AC-8 @FR-4 @feature-302` (workflow carries exactly the `LEGACY_` lines KEYS requires) — adds `LEGACY_OTEL_EXPORTER_OTLP_ENDPOINT/_HEADERS` to `deploy-homelab.yml`.
- **PRESERVE** `@AC-2 @FR-3 @feature-302` (exact APP_ENV set) — OTLP rows must stay `required=False` so an absent value adds no line; `@AC-9 @FR-3 @feature-302` and `@AC-2 @feature-279` (release .env renders under compose, exit 0) — fixtures must gain placeholder OTLP values (fixture extension, not a rule change); `@AC-13/@AC-14 @FR-7 @feature-302` (precedence, "sops"/"sops (homelab)" labels).
- **PRESERVE** `@AC-28 @feature-279` (no secret on stderr — the OTLP header is a credential), `@AC-1`, `@AC-3`, `@AC-35`, `@AC-36`, `@AC-43 @feature-279` (13 services, ports 3000/9000, existing `render-assert.jq` labels), `@AC-8/@AC-9/@AC-2/@AC-20/@AC-24 @feature-286` (DO resolution unchanged, bootstrap seeds only common/digitalocean), `@AC-1 @feature-287`, `@AC-5 @feature-266` (`.do/app*.yaml` vpc and CA bindings), `@AC-4 @FR-4 @feature-226` (local compose routes to the collector, gains no `HOST_PROVIDER`).
- **EXTEND** `@AC-10 @FR-1 @feature-274`, `@AC-1 @FR-1 @feature-171` and the per-service `otel-metrics-logs-export.feature` resource scenarios (presence-only checks) — `host.provider` added; `trading_mode` must stay absent. `@AC-3 @FR-2 @feature-171` (dashboards README attribute list) EXTEND if that README is touched.
- **PRESERVE** telemetry guards that each edited module must keep: init never blocks startup (`@AC-2 @FR-3 @feature-171`, `@AC-42 @feature-294`, portfolio `@AC-6`), disabled is a no-op (config `@AC-5`), no secret plaintext in exported logs (config `@AC-7`, identity `@AC-13/@AC-20`), flush on shutdown (marketdata `@AC-12/@AC-18`), Go `serverMetricViews` unchanged (`@AC-56 @feature-294`), RPC metric names unchanged (`@AC-2 @FR-2 @feature-274`), observability docs keep the three-signal statement (`@AC-9 @FR-7 @feature-274`), Go health gated on init (`xstockstrat-trading` `@AC-17 @feature-279`).
- Ingest and notify have no OTel-specific suite (`signal-map-instrumentation.feature` only; not read in full, grep found no OTel/homelab hits).

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none (deploy-time env vars; `OTEL_ENABLED` is not a config key, `observability.md:7`).
- Inter-service edges: none.
- New env vars: `HOST_PROVIDER` — absent from `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`, `deploy/homelab/compose.yml` and every Dockerfile (no baking). `OTEL_EXPORTER_OTLP_*` already exist for DO (`.do/app*.yaml:34-39`, placeholders `YOUR_DEV_/YOUR_PROD_` filled from SOPS by `do-render-app-spec.py`; not by `deploy-dev.yml`) and are new for homelab.
- Staging and production share one Grafana Cloud instance (operator, 2026-11-11), so `deployment.environment` and `host.provider` are independent axes on one stack.

## Risks / Not-found

- **R-1 (load-bearing) Series separation is not provided by the resource attribute alone.** `host.provider` stays on `target_info`; metric series separation requires either Grafana-side attribute promotion (stack setting, operator action, mechanism not verified from this repo), or a per-datapoint/instance discriminator in code (`service.instance.id` for Go/Node, which today have none, or a metric view adding a `host_provider` attribute). Without it, homelab and DO same-service series share a label set. **Corrects the spec's Queryability premise.**
- **R-2 Precedence of `OTEL_RESOURCE_ATTRIBUTES` vs explicit attributes is unverified for all three SDKs** (Go module cache, Python venv and Node `node_modules` are absent on this host). Recollection (unverified): Python explicit-wins, Node detector-wins — the env-var route may behave differently per language. Either way, "exact lowercase else `unknown`" needs hand-read logic.
- **R-3 No PromQL/LogQL parser or promtool exists** in repo/CI (`ci.yml` has only `otel-signals`); AC-10/AC-11 as written need a new dependency or a shell check modelled on `check-otel-produced-signals.sh`.
- **R-4 Compose `:?` vs fixtures:** making `OTEL_EXPORTER_OTLP_*` required in homelab compose breaks `homelab-render.test.sh` cases 1–2 and `sops-secrets.test.sh` case 8 unless their fixtures gain placeholder OTLP values; the resolver rows must stay `required=False` (302 `@AC-2/@AC-8/@AC-9`).
- **R-5 Test-pin churn:** adding HOMELAB to the OTEL KEYS rows fails `sops-secrets.test.sh:1067` until `deploy-homelab.yml` carries the two `secrets[format(…)]` LEGACY lines; the workflow must never use `secrets.OTEL_…` (`COMMON_RE :747`).
- **R-6 Header handling:** `OTEL_EXPORTER_OTLP_HEADERS` is a credential; `_quoted` rejects `'`/newline (`Basic <b64>` is safe); the prefix must be added once (idempotent) and never printed. `homelab-release-env.sh` currently drops owned keys from APP_ENV with `grep -Ev` (line-based) — a `sed` rewrite of the quoted header line must preserve the `KEY='value'` quoting.
- **R-7 DO production does not export** (`.do/app.yaml:33` `OTEL_ENABLED "false"`); `HOST_PROVIDER` there is inert until prod telemetry is enabled (out of scope).
- **R-8 Cardinality/free tier:** a second full stack ≈ doubles the ~1,200 dev series (`observability.md` § Cost); operator waived, design records the total.
- **R-9 Overlap sequencing:** 307 (`deploy-homelab.yml`, `sops-secrets.test.sh`), 329 (telemetry modules), 331 (`.do/app*.yaml`), 297 (dashboards) — see `merge-order.md`.
- **Ledger traps carried:** `fails.md` homelab-compose-deploy (pipeline owns and asserts values per service); 171 Node `buildResource` (verify test run AND production `tsc` — Node is now CJS-only, so the strip-types hazard no longer applies, but extensionless imports and a sync exported `buildResource()` still do); phase7 (recon re-read the specs rather than trusting prose — done).
- **Not found:** an existing reusable `Authorization=` prefix function; any existing `HOST_PROVIDER`/`host.provider`/`host_provider` reference in code, specs, compose or CI; a homelab-specific "telemetry off" doc statement beyond `platform.feature:1146-1150` and `compose.yml:7`; any query-example or manual post-deploy-check section in `observability.md` (a new heading is needed); any trace-signal resource assertion in any language's tests.

## Recommended Scope

Advisory step boundaries (input to grilling and `/sdd-spec`):

1. **Per-language resource stamp** (RED test first, then 3 Go / 4 Python / 4 Node / 1 UI edits, each with a unit test for the normaliser and a wire-level assertion on all three signals) — mechanism decided in debate (hand-read `HOST_PROVIDER` vs env detector).
2. **Series-separation mechanism** (R-1) — design decision; may add a data-point/instance discriminator or document the Grafana-side promotion.
3. **SOPS + release pipeline** (`sops_secrets.py` rows, `deploy-homelab.yml` LEGACY lines, `homelab-release-env.sh` ownership + prefix, `compose.yml` anchor, `render-assert.jq`, both test scripts' fixtures and assertions) — lands as one unit because the pins fail apart.
4. **DO specs** (`HOST_PROVIDER=digitalocean` in both `.do/app*.yaml`).
5. **Docs + business-rule promotion** (`observability.md`, `sops-secrets.md`, `ci-overview.md`, `grafana-cloud.md`, dashboards README, UI `CLAUDE.md`, the C-16 CHANGE of `@AC-13 @feature-279`) and the query-example test (AC-10/AC-11) once the parser decision is made.
