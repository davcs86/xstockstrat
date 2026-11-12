# Debate Register: python-otel-instance-id

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-12 | /sdd-design | 11 | 3 | 9 | 9 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Four parallel in-place edits, one inside each Python `_build_resource()`; no shared helper or package. The one-line duplication is accepted and recorded, as `_host_provider` is already copied per service. | `services/xstockstrat-analysis/app/telemetry.py:25-43`, `services/xstockstrat-agent/app/telemetry.py:17-35`, `services/xstockstrat-ui/src/telemetry.ts:57` | settled |
| D-2 | 1 | Hoist `SERVICE_NAME` and the normalised `_host_provider()` into locals inside `_build_resource` and feed `service.name`, `host.provider` and `service.instance.id = f"{provider}-{service_name}"` from them, so the id always equals the exported `service.name`. `init_telemetry`'s own `SERVICE_NAME` re-read for its log line is left untouched. | `app/telemetry.py:38` (analysis), `:188` (analysis re-read) | settled |
| D-3 | 1 | The id is set in code only, never through `OTEL_RESOURCE_ATTRIBUTES` in any deploy spec. | `scripts/check-otel-produced-signals.py:45`, 332 `@AC-22` | settled |
| D-4 | 1 | Tests change test-first (RED then GREEN). The unit parametrize asserts `attrs["service.instance.id"] == f"{want}-{attrs['service.name']}"` and runs one case with `SERVICE_NAME` unset so the default path is checked; the exact literal (`homelab-<svc>`) is asserted in the wire tests on all three decoded signals (traces, metrics, logs). The old `not startswith("homelab-")` pairs and their stale "SDK instance id kept" comments are deleted. | `services/xstockstrat-ingest/tests/test_telemetry.py:10-34,175,205-218` (agent `:162,204-205`) | settled |
| D-5 | 1 | AC-4 (identical across two process starts) is tested over the wire: run indicators' existing `CHILD` subprocess pattern twice with `HOST_PROVIDER=homelab`, `SERVICE_NAME=indicators`, decode the `/v1/metrics` body each time, assert both ids are `homelab-indicators`. A `_build_resource`-only subprocess is not sufficient. | `services/xstockstrat-indicators/tests/test_telemetry.py:329,352` | settled |
| D-6 | 1 | Precedence of an explicit id over the SDK default is proven by the RED/GREEN wire test against the pinned SDK (1.45.1). The unit RED's failure mode is recorded in `context.md` (KeyError ⇒ the UUID is added downstream of `Resource.create`; mismatch ⇒ it is already in `Resource.create`'s output), which answers where the UUID comes from. Stop condition for `/sdd-execute`: unit GREEN but wire still a UUID ⇒ halt and return to design. | `fails.md:3044-3047`, `recon.md` Not-found (SDK source) | settled |
| D-7 | 1 | Docs: `docs/patterns/observability.md` edited at the sites recon located by text (resource-attribute paragraph, post-deploy `instance` bullet, added `instance=~"homelab-.+"` count with the same thresholds, Open-risks series-budget and relabel-once items, selector note); the DO rolling-deploy collision risk bullet (`:111`) now names Python; `services/xstockstrat-agent/CLAUDE.md` § OAuth 2.1 edge auth gains one clause that `instance_count > 1` is safe for OAuth but telemetry replicas would share one `service.instance.id`. The new count and selector stay as plain prose or bullets outside any `otel-guard` fence so both guard blocks stay byte-identical. | `docs/patterns/observability.md:60,99-117`, `scripts/check-otel-produced-signals.py:472-483` | settled |
| D-8 | 1 | Business-rule promotion at integration (not a numbered step): extend 332 `@AC-19` with Examples rows for analysis, ingest, indicators, agent; rewrite 332 `@AC-21`'s `Then` to the AC-4 determinism guarantee under a `# Changed by @feature-336` line (keep tags, do not delete); treat 332 `@AC-12` as a CHANGE (reword only "Go, Node and UI set" to "Go, Node, UI and Python set"); do not promote 336 `@AC-1` as a separate rule. | `docs/sdd/business-rules/platform.feature:1146,1165,2337-2377` | settled |
| D-9 | 1 | The analysis `digitalocean` wire case (AC-2) shares one module-local helper with the homelab wire test (or parametrizes it) rather than copying ingest's test shape. | `services/xstockstrat-analysis/tests/test_telemetry.py:172-218` | settled |
| D-10 | 1 | Ingest's unset/unrecognised wire test is parametrized over None, "aws", "Homelab" and renamed to reflect that; the "reaches SERVING" clause of AC-3/AC-9 is covered by a `**Covers**` note resting on 332 `@AC-3/@AC-4/@AC-13` non-blocking-init coverage (no reword of the acceptance scenario). | `services/xstockstrat-ingest/tests/test_telemetry.py:221-242` | settled |
| D-11 | 1 | Step shape for `/sdd-spec`: four service+test pairs (analysis, ingest, indicators, agent), each a `**Lands with**` atomic unit because the test step is RED by design; one docs step (observability.md, agent CLAUDE.md, guard script + pytest); platform.feature promotion at integration. No flag; the first deploy relabels the Python series once. | `docs/sdd/constitution.md` C-08, P-06 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | A shared Python helper or package that builds the id | A new package plus four Dockerfile/lockfile changes and a new coupling seam for one f-string; fails C-18 YAGNI. `_host_provider` is already duplicated by design and Go/Node/UI inline the id. | locked |
| R-2 | 1 | Set the id via `OTEL_RESOURCE_ATTRIBUTES` in compose and app specs | Breaches 332 `@AC-22` and the CI guard (`scripts/check-otel-produced-signals.py:45`); precedence is unverified per SDK. | locked |
| R-3 | 1 | An extra test proving the code-set id beats `OTEL_RESOURCE_ATTRIBUTES` | YAGNI under C-18: CI already rejects that env var in deploy specs. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | AC-4 via `_build_resource` subprocesses never exports, so it cannot fail for the reason AC-4 exists (C-15/C-08) | no | closed @ round 1 (adopted as D-5) |
| O-2 | 1 | "Every restart already creates a new UUID series, nothing new" is wrong for DO rolling-deploy overlap: fixed Python ids now collide during overlap, as 332 accepted for Go/Node/UI (C-18 accuracy) | no | closed @ round 1 (adopted in D-7: name Python in the `:111` risk bullet; design.md records the accepted trade-off) |
| O-3 | 1 | Agent `CLAUDE.md` "instance_count > 1 is safe" becomes false for telemetry; the caveat needs a home (C-10 doc truth) | no | closed @ round 1 (adopted in D-7) |
| O-4 | 1 | Promotion plan writes the same guarantee three times (`@AC-19` row, `@AC-21` Then, 336 `@AC-1`) (C-16/C-18 DRY) | no | closed @ round 1 (adopted as D-8) |
| O-5 | 1 | C-16 sign-off recorded in `context.md` names only `@AC-21` as a CHANGE; D-8 treats `@AC-12` as a CHANGE too | no | closed @ round 1 (user confirmed @AC-21 and @AC-12 as CHANGEs at the round-1 gate; context.md) |
| O-6 | 1 | The analysis DO wire test copies ingest's shape, likely jscpd-flagged (C-18 DRY test code) | no | closed @ round 1 (adopted as D-9) |
| O-7 | 1 | Setting `SERVICE_NAME` in every unit case never checks the default path or the "id equals exported `service.name`" contract | no | closed @ round 1 (adopted in D-4) |
| O-8 | 1 | Ledger 274 rule asks where the UUID comes from; recon left it unrecorded | no | closed @ round 1 (adopted in D-6: record the unit-RED failure mode) |
| O-9 | 1 | Ingest wire test never "reaches SERVING" (AC-3/AC-9 `When`); test name will be misleading (C-15 trace honesty) | no | closed @ round 1 (adopted as D-10) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
