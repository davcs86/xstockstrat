# Recon: fix-telemetry-startup-log

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: main-dev@c4fd48b0a ≡ origin/main-dev (detached; no `feature/fix-telemetry-startup-log` branch on origin yet)
**Affected services**: xstockstrat-config, xstockstrat-identity, xstockstrat-ledger, xstockstrat-notify, xstockstrat-ui, xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-agent

---

## Objective

Since feature 226 every Node and Python telemetry module builds its OTLP/HTTP exporters with no
endpoint argument, so the SDK resolves the endpoint from the `OTEL_EXPORTER_OTLP_*` env vars. The
startup log still prints the raw `OTEL_EXPORTER_OTLP_ENDPOINT` value, so it reads `→ undefined` (Node)
or `endpoint=None` (Python) when the var is unset. The fix makes the startup log name the effective
endpoint, or "SDK default", in all nine services, and documents the var as required when
`OTEL_ENABLED=true` in the UI `CLAUDE.md`. SEV-3, logging and docs only.

## Codebase Map

Every site follows one idiom per runtime. The `endpoint` local is read once and is used **only** by
the startup log, and the exporters stay argument-less. All lines were re-grepped at the tree above,
and the product-spec line numbers for the log sites still match.

Node idiom: `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;` …
`console.info(\`[otel] tracing enabled → ${endpoint} (service=${serviceName})\`);`

- **`xstockstrat-ui`** (Next.js)
  - Raw read: `services/xstockstrat-ui/src/telemetry.ts:36`
  - Log: `services/xstockstrat-ui/src/telemetry.ts:64` (after `sdk.start()`, inside the init `try`)
  - Exporter no-url constraint comment: `services/xstockstrat-ui/src/telemetry.ts:50`
  - Docs gap: `services/xstockstrat-ui/CLAUDE.md:302`. It is a bare `OTEL_EXPORTER_OTLP_ENDPOINT` line under `OTEL_ENABLED  # toggle OTel; init errors never block startup` (`:301`).
  - Test harness: vitest (`pnpm run test:unit`, `src/**/*.test.ts`). `src/instrumentation.testkit.ts` (`defineExportSuite`) sets the endpoint at `:65` and asserts the `[otel] tracing enabled` prefix at `:87`. The recursion guard at `:163` asserts that line never reaches `/v1/logs`. There is no `*telemetry*.test.ts`.
- **`xstockstrat-config`** (Node)
  - Raw read `src/telemetry.ts:163`, log `:190`, exporter comment `:174`
  - Tests: `src/__tests__/telemetry.test.ts`, `src/__tests__/telemetry.export.test.ts` (OTLP receiver stub). Runner: `package.json:12` `tsc && node --test dist/__tests__/*.test.js`
- **`xstockstrat-identity`** (Node)
  - Raw read `src/telemetry.ts:164`, log `:191`, exporter comment `:175`
  - Tests: `src/__tests__/telemetry.export.test.ts`, which sets the endpoint and uses a console `warnSpy` with a `logged(...)` helper. Also `telemetryAllowlist.test.ts`. Runner: `package.json:12` (tsc first, then `node --test`)
- **`xstockstrat-ledger`** (Node)
  - Raw read `src/telemetry.ts:164`, log `:191`, exporter comment `:175`
  - Tests: `src/__tests__/telemetry.test.ts`, `src/__tests__/telemetry.export.test.ts`. Runner: `package.json:13`
- **`xstockstrat-notify`** (Node)
  - Raw read `src/telemetry.ts:165`, log `:192`, exporter comment `:176`
  - Tests: `src/__tests__/telemetry.export.test.ts` (sets the env, then a console spy via `logged(warnSpy)`), `telemetryAllowlist.test.ts`. Runner: `package.json:12`

Python idiom: `endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")` …
`log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})`. The
endpoint is a structured `extra` field, so a test must assert `record.endpoint` and not `caplog.text`.

- **`xstockstrat-analysis`** (Python)
  - Raw read `app/telemetry.py:180`, log `:214`, exporter comment `:184`
  - The `LoggingHandler` is attached to the root logger before the log (`app/telemetry.py:206-208`), so this startup record **is exported to `/v1/logs`**
  - Tests: `tests/test_telemetry.py` (receiver plus `monkeypatch.setenv`). Fixture `otel_reset`: `tests/conftest.py:506`
- **`xstockstrat-indicators`** (Python)
  - Raw read `app/telemetry.py:176`, log `:208`, exporter comment `:180`
  - Tests: `tests/test_telemetry.py`. Fixture `otel_reset`: `tests/conftest.py:196`
- **`xstockstrat-ingest`** (Python)
  - Raw read `app/telemetry.py:177`, log `:209`, exporter comment `:181`
  - Tests: `tests/test_telemetry.py`. Fixture `otel_reset`: `tests/conftest.py:103`
- **`xstockstrat-agent`** (Python)
  - Raw read `app/telemetry.py:54`, log `:82`, exporter comment `:58`
  - Tests: `tests/test_telemetry.py`. Fixture `otel_reset`: `tests/conftest.py:302`

Not applicable to every service: entry points, handlers, migrations and the config-read pattern. The
change sits entirely inside each service's own telemetry init function.

## Patterns to REUSE

- **Effective-endpoint value** → keep the existing per-service `endpoint` local and add a fallback at
  the read site: `?? 'SDK default'` (Node) or `or "SDK default"` (Python). If the design names the
  default URL instead, use `http://localhost:4318`. That value comes from the spec and report and is
  not a code hit in the repo (see Risks). There is no shared cross-service telemetry helper. Each
  `telemetry.ts` / `telemetry.py` is a per-service copy by design (`insights.md:4389`, which describes
  a per-service module accessor and no cross-language library). Adding a helper here would be new
  abstraction for a one-token change. Recommendation: per-site edit, checked against the jscpd DRY
  rail (`scripts/check-duplication.sh`, `.jscpd.json`).
- **Exporter construction stays env-only.** Never pass the computed endpoint into an exporter
  (`insights.md:3601-3604`; the comment at every site listed above; `docs/patterns/observability.md:9`).
- **Node regression test (leaves)** → extend `src/__tests__/telemetry.export.test.ts` in identity,
  ledger and notify, and add to config's `telemetry.test.ts` / `telemetry.export.test.ts`. Follow the
  existing console-spy `logged(warnSpy)` pattern and install the spy **before** the first OTel import
  (`insights.md:3606-3609`).
- **UI regression test** → AC-2 (endpoint set) fits the existing `defineExportSuite` harness
  (`instrumentation.testkit.ts:65,87`). AC-1 (unset) needs a **new** test file, because the testkit sets
  `process.env` at module level. Record console output with a self-installed function and never rely
  on `vi.spyOn` history from `beforeAll` (`fails.md:2853-2856`).
- **Python regression test** → add to each `tests/test_telemetry.py`. Use `otel_reset`,
  `monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)`, `setenv("OTEL_ENABLED","true")`,
  and `caplog.at_level(logging.INFO)`, then assert the `"OTel tracing initialised"` record's
  `.endpoint`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2` "The UI registers its instrumentation hook and exports over OTLP/HTTP"
  (`services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`, feature 226). The startup log
  keeps the literal `[otel] tracing enabled` prefix, and only the text after `→` changes.
- **PRESERVE** `@AC-1` "A backend service exports traces over OTLP/HTTP to a path-prefixed gateway URL"
  (`docs/sdd/business-rules/platform.feature`, feature 226). Exporter endpoint resolution is untouched.
- **PRESERVE** `@AC-3` "A failed trace export is visible in service logs" (`docs/sdd/business-rules/platform.feature`, feature 226).
- **PRESERVE** `@AC-4` "Local compose routes every service to the collector's OTLP/HTTP receiver"
  (`docs/sdd/business-rules/platform.feature`, feature 226). The compose value `http://otel-collector:4318`
  (`docker-compose.yml:133`) stays.
- **PRESERVE** `@AC-19` "Metrics and logs honour the path-prefixed gateway and both header forms"
  (`docs/sdd/business-rules/platform.feature`, feature 274).
- **PRESERVE** `@AC-10` / `@AC-11` metric and log export per runtime (`docs/sdd/business-rules/platform.feature`, feature 274). The edited files also own these pipelines.
- **PRESERVE** `@AC-42` "Telemetry is a no-op when disabled and never blocks startup"
  (`docs/sdd/business-rules/platform.feature`, feature 294) and `@AC-2` "Telemetry init remains
  non-blocking…" (`docs/sdd/business-rules/platform.feature`, feature 171). The new log expression must not throw.
- **PRESERVE** `@AC-1` "A telemetry module's built Resource no longer carries the trading_mode attribute" (`docs/sdd/business-rules/platform.feature`, feature 171). The Resource code sits in the same files and stays unchanged.
- **PRESERVE** `@AC-5` "Telemetry disabled installs no metric or log pipeline" and `@AC-7` "Exported log
  records carry no secret plaintext" (`services/xstockstrat-config/acceptance/otel-metrics-logs-export.feature`, feature 274).
  Add no behaviour on the disabled path, and the logged endpoint must not carry credentials.
- **EXTEND** this feature's `@AC-1` / `@AC-2` add the unset and set cases beside feature 226's UI `@AC-2`.
  No CHANGE flags: no existing `@AC` asserts the buggy `undefined`/`None` text, so no C-16 sign-off is needed.
- No existing telemetry acceptance suite for xstockstrat-notify or xstockstrat-ingest. They are governed
  by `platform.feature` only.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none. `OTEL_*` are boot env vars, not `WatchConfig` keys (`docs/patterns/observability.md:7`)
- Inter-service edges: none
- New env vars / ports: none. `OTEL_EXPORTER_OTLP_ENDPOINT` already exists in `docker-compose.yml:62,133`,
  `.do/app.yaml:34` and `.do/app.dev.yaml:34`, and in the env table at `docs/patterns/observability.md:56`.

## Risks / Not-found

- **SDK default not verified at the pinned versions.** `http://localhost:4318` comes from the report
  and spec and is not proved in the repo. Per `fails.md:3568-3571` and `insights.md:3604`, probe it (or
  choose the literal "SDK default", which needs no SDK claim) before the design commits to a URL. AC-1
  accepts either.
- **Per-signal overrides.** The SDKs let `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (and the metrics and logs
  equivalents) take precedence over the base var. A log that names only the base var or the default
  can still mislabel the real target. This is a design fork (C-11): log the base var only, or resolve
  per signal. It is not addressed by the product spec.
- **Egress of the logged endpoint (Python).** The Python startup record is emitted after the OTel
  `LoggingHandler` is attached (`services/xstockstrat-analysis/app/telemetry.py:206-214`, same order
  in the siblings per the digests), so its `endpoint` field is exported to `/v1/logs`. An endpoint URL
  with userinfo would leak a credential (`insights.md:4120-4123`; config `@AC-7`). The current values are
  the collector URL and the Grafana gateway URL, with auth in `OTEL_EXPORTER_OTLP_HEADERS`. The
  design should state whether to log the raw value or strip userinfo. Node's `console.info` line is
  guarded off `/v1/logs` by `instrumentation.testkit.ts:163` in the UI. The leaves have no such test
  (not verified).
- **Two Node test styles.** `fails.md:2237-2240` records that ledger and identity once ran
  `node --experimental-strip-types` (ESM). All four leaves now run tsc-first CJS (`package.json:12/13`).
  Verify the test run **and** the production `tsc` build per leaf anyway.
- **No existing test asserts the startup log text or the unset-endpoint case**, in any of the nine
  services. All the RED tests are new. The UI AC-1 test is a new file, and `src/telemetry.ts` is outside
  the vitest coverage scope (`src/lib/**`). That is fine, because coverage is not the gate here.
- Not checked: other services' `CLAUDE.md` env blocks. Identity, ledger, notify, indicators, ingest and
  agent list no `OTEL_*` at all. Only the UI `CLAUDE.md:302` is in spec scope. `docs/patterns/observability.md`
  is out of scope (keep platform `@AC-9` unaffected).
- Go services: out of scope per product-spec, and not inspected.

## Recommended Scope

Advisory:
1. **Node (5 services)**: fallback at each raw read (ui `:36`, config `:163`, identity/ledger `:164`,
   notify `:165`), plus the AC-1 and AC-2 RED→GREEN tests in each `__tests__` export suite and a new UI
   vitest file for the unset case. The `[otel] tracing enabled` prefix stays.
2. **Python (4 services)**: fallback at each raw read (analysis `:180`, indicators `:176`, ingest
   `:177`, agent `:54`), plus `caplog` tests on `record.endpoint` in each `tests/test_telemetry.py`.
3. **Docs**: annotate `services/xstockstrat-ui/CLAUDE.md:302` "required when `OTEL_ENABLED=true`".

These could land as one PR or as two (by runtime) plus docs. The design should settle the "SDK default"
literal vs URL question and the per-signal and userinfo forks before the spec.
