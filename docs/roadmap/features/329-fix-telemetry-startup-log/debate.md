# Debate Register: fix-telemetry-startup-log

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 6 | 7 | 0 | 1 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 5 | 3 | 1 | 0 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Fix the startup-log endpoint at the read site in all 9 telemetry inits. The fallback is the literal `SDK default`; exporters stay argument-less and env-only; no shared helper. | services/xstockstrat-ui/src/telemetry.ts:36; services/xstockstrat-analysis/app/telemetry.py:180; insights.md:4389; fails.md:3568-3571 | settled |
| D-2 | 1 | Node sites use `process.env.OTEL_EXPORTER_OTLP_ENDPOINT // 'SDK default'`. Python sites use `os.getenv(...)` with `is None` ⇒ 'SDK default', and an empty string is logged as the explicit "". | Adversary r1 objection (P-03/C-11): Python exporter environ.get falls back only when the key is absent; no venv in the repo to probe; fails.md:3561 | settled |
| D-3 | 1 | Node leaf AC-1 (config, identity, ledger, notify) runs in a child process with the endpoint unset, reusing the existing spawn-with-env harness. It asserts stdout contains `→ SDK default` and not `undefined`. | identity telemetry.export.test.ts:20,34,182; config telemetry.export.test.ts:43,65-82,259 | settled |
| D-4 | 1 | The UI AC-2 assertion checks the full `[otel] tracing enabled → <set URL>` suffix inside defineExportSuite. | services/xstockstrat-ui/src/instrumentation.testkit.ts:65,87; C-15 | settled |
| D-5 | 1 | Only the base OTEL_EXPORTER_OTLP_ENDPOINT is honoured in the log. The per-signal blind spot is documented in UI CLAUDE.md:302 and recorded as an Open Risk in context.md. | Adversary grep: zero setters of OTEL_EXPORTER_OTLP_(TRACES/METRICS/LOGS)_ENDPOINT; docker-compose.yml:62,133; .do/app*.yaml:34 | settled |
| D-6 | 1 | The raw endpoint value is logged with no userinfo strip. The UI CLAUDE.md docs line adds: credentials go in OTEL_EXPORTER_OTLP_HEADERS, never in the endpoint URL. | services/xstockstrat-analysis/app/telemetry.py:206-214; config @AC-7 | settled |
| D-7 | 2 | D-2's Node operator is logical OR (two pipes): `process.env.OTEL_EXPORTER_OTLP_ENDPOINT \|\| 'SDK default'`. The register row's `//` is the pipes mangled by markdown escaping. | PRIOR STATE approach text; proposer r2 Assumptions; adversary r2 register-hygiene objection | settled |
| D-8 | 2 | Each Node leaf's runChild gains an optional env-override parameter, merged after the defaults, in which `undefined` deletes the key. The AC-1 child uses it to remove OTEL_EXPORTER_OTLP_ENDPOINT from both the hard-coded value and the inherited process.env. | services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts:176-182; config :248-259; ledger :204-215; notify :206-217 | settled |
| D-9 | 2 | The AC-1 unset-endpoint child only calls initTelemetry(), resolves on the `[otel] tracing enabled` stdout line and exits without flushing. The UI vitest AC-1 file self-installs a console.info recorder and calls sdk.shutdown() or stubs the exporters. | identity telemetry.export.test.ts:184,193-196,208; services/xstockstrat-ui/src/telemetry.ts:63,66; fails.md:2853-2856 | settled |
| D-10 | 2 | A Node test case with OTEL_EXPORTER_OTLP_ENDPOINT="" asserts `→ SDK default`, pinning `\|\|`. The Node/Python empty-string divergence is recorded as an Open Risk in context.md. | Adversary r2 C-15 objection; proposer r2 strongest risk | settled |
| D-11 | 2 | O-1 is accepted as an Open Risk in context.md with no code change: a whitespace-only Node endpoint is logged raw. | fails.md:3568-3571; docker-compose.yml:62,133; .do/app.yaml:34; no node_modules present to check against | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Python `or "SDK default"` fallback | It mislabels an empty-string endpoint as SDK default if the exporter uses environ.get's absent-only fallback, and this is unverifiable in the repo. | locked |
| R-2 | 1 | Node leaf AC-1 in the in-process export suite via logged(warnSpy) | warnSpy watches console.warn, not console.info, and the endpoint is already set in-process before initTelemetry. | locked |
| R-3 | 1 | Log the resolved URL (localhost:4318 / base+/v1/traces) | It is an SDK claim that is unproven at the pinned versions. | locked |
| R-4 | 1 | Read the endpoint back from the constructed exporter's private fields | Private SDK fields break on version bumps. It is kept only as the escalation path for per-signal vars. | locked |
| R-5 | 1 | Resolve TRACES_ENDPOINT // ENDPOINT // 'SDK default' | It mixes a verbatim per-signal URL with a base URL in one log value. | locked |
| R-6 | 1 | Shared cross-service endpoint helper | Speculative abstraction for a one-token per-service change (C-18, insights.md:4389). | locked |
| R-7 | 1 | Strip userinfo from the logged endpoint | Speculative mechanism with no new exposure; the docs convention covers @AC-7. | locked |
| R-8 | 2 | Node `?.trim() \|\| 'SDK default'` | It stacks a second SDK claim (that whitespace means unset) which cannot be verified here, and no deploy surface sets such a value. | locked |
| R-9 | 2 | A dedicated minimal spawn per leaf for the AC-1 unset case | It duplicates spawn plumbing across 4 leaves (C-18). Extending runChild with an env-override parameter is smaller. | locked |
| R-10 | 2 | Reusing runChild unchanged, or only dropping its hard-coded endpoint, for the unset case | The hard-coded value and the process.env spread make the unset case unreachable or host-dependent, so the RED test would be vacuous. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Node `//` logs a whitespace-only endpoint raw, while the SDK may trim it to unset. Accept it as an Open Risk or justify it. | no | closed @ round 2 (Accepted as a recorded Open Risk in context.md. No `.trim()` is added because it would be an unverifiable SDK claim, no deploy surface sets a blank or whitespace value, and the output never renders `undefined`. Both sides agree.) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
