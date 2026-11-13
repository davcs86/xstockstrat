# Design: python-otel-instance-id

**Created**: 2026-11-12
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-12T10:18:57Z
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

The four Python services (analysis, ingest, indicators, agent) export `service.instance.id = <host.provider>-<service.name>` (for example `homelab-analysis`) on the single OTel Resource that already feeds their tracer, meter and logger providers, as Go, Node and UI do. The change is internal/platform-only (no UI segment or agent tool is touched); its consumers are operators reading Grafana and `scripts/check-otel-produced-signals.py`.

**Service edit (D-1, D-2, D-16).** In each service's `_build_resource()` (`services/xstockstrat-analysis/app/telemetry.py:31-43`, ingest `:31-43`, indicators `:30-42`, agent `:23-35`), hoist `service_name = os.getenv("SERVICE_NAME", "<svc>")` and `provider = _host_provider()` above `return Resource.create(...)`, feed `service.name` and `host.provider` from them, and append `"service.instance.id": f"{provider}-{service_name}"` as the last dict key. `init_telemetry` already builds the Resource once and hands the same object to all three providers (analysis `:190,196,201-204,207`; ingest `:187,193,198-201,204`; indicators `:186,192,198,203`; agent `:64,66,70-75,77`), so one edit covers traces, metrics and logs. No shared helper or package: each service is its own uv project and `_host_provider` is already copied per service (`recon.md` Patterns to REUSE; the id mirrors `services/xstockstrat-ui/src/telemetry.ts:57` and `services/xstockstrat-notify/src/telemetry.ts:44`). The unset/unrecognised provider path needs no new branch: `_host_provider()` returns `unknown`, so the id is `unknown-<service>` (332 `@AC-3/@AC-4/@AC-13` preserved). The id is set in code only, never through `OTEL_RESOURCE_ATTRIBUTES` (D-3, 332 `@AC-22`). `init_telemetry`'s separate `SERVICE_NAME` read for its log line is left untouched.

**Tests, test-first (D-4, D-5, D-6, D-9, D-10, D-12, D-13, D-16, D-17).** Each service's `tests/test_telemetry.py` changes before the code:
- Unit `test_build_resource_omits_trading_mode` widens its parametrize with a `service_name` parameter and ids (`unset`, `aws`, `Homelab`, `homelab`, `digitalocean-default-name`, the last with `SERVICE_NAME` unset) and asserts `attrs["service.instance.id"] == f"{want}-{attrs['service.name']}"`.
- The wire test sets `SERVICE_NAME` and asserts the exact id on all three decoded signals, deletes the old `not startswith("homelab-")` pair and its stale comment (two lines of at most 100 characters replace it).
- Analysis stacks `parametrize("host_provider", ["homelab", "digitalocean"])` on its wire test; the provider assertion must compare against the parameter (a hazard if left as the literal `"homelab"`).
- Ingest's unset test is renamed `test_unrecognised_host_provider_exports_unknown_prefix` and parametrized over None, "aws", "Homelab".
- Indicators moves the SIGTERM test body into `_run_child_to_sigterm(**extra_env)` and adds `test_instance_id_identical_across_two_process_starts` (`services/xstockstrat-indicators/tests/test_telemetry.py:329-384`), decoding the `/otlp/v1/metrics` body twice.
- Verification per unit runs the telemetry tests twice, plain and with `HOST_PROVIDER=homelab` (AC-5's evidence), plus the service's coverage floor (Python 40, indicators 50) and `ruff check` / `ruff format --check`. RED is recorded from an observed failure, never predicted; the unit RED's failure mode (KeyError vs mismatch) is written to `context.md`, which answers where the SDK id comes from. If the unit goes GREEN but the wire test still shows a UUID, execution halts and returns to design.

**Atomic units (D-11, D-16, D-22).** U1 analysis, U2 ingest, U3 indicators, U4 agent (each `app/telemetry.py` + `tests/test_telemetry.py`, a `**Lands with**` pair per C-08/P-06); U5 docs: `docs/patterns/observability.md`, `services/xstockstrat-agent/CLAUDE.md`, `scripts/tests/test_check_otel_produced_signals.py`. `platform.feature` is edited only at integration promotion, never in a step.

**Docs (D-7, D-15, D-20, D-21, D-22).** `observability.md`: the resource-attribute paragraph states Go, Node, UI and Python all set the id; the post-deploy list keeps its `host_provider` count and gains the `instance=~"homelab-.+"` count with the same thresholds (at least 11 jobs idle, 12 after one UI login) and says `instance` is `homelab-<job>` for all 12 jobs; a short note documents `{service_instance_id=~"homelab-.+"}` for all 12 services (`| host_provider="homelab"` stays the documented log filter); the Open-risks items name Python in the rolling-deploy collision and relabel-once bullets and drop "Python restart churn"; lines 69-70 are corrected so `deployment_environment` and `service_instance_id` are Loki stream labels and `host_provider` is structured metadata. All new text is prose or bullets outside every `otel-guard` fence, so both guard blocks stay byte-identical. Two strings (the `instance=~"homelab-.+"` count and the selector) are added to `test_the_host_provider_contract_stays_documented`. `services/xstockstrat-agent/CLAUDE.md:185-186` gains the clause that `instance_count > 1` is safe for OAuth but replicas would share one `service.instance.id` (reflowed surgically).

**Rollout (D-11).** No flag. The first deploy relabels the Python series once on each exporting stack (old per-process UUID series go stale); after it, restart churn stops. `packages/otel/` keys on `service_name`, never `instance` (adversary-verified), so no dashboard or alert pins a Python instance value. The change relies on the single-replica assumption that Go, Node and UI already carry (agent `instance_count: 1` in `.do/app.yaml:343` and `.do/app.dev.yaml:345`).

**Operator constraints applied (not register items):** no `service.namespace` or other repurposed attribute; no per-instance suffix (trace/span ids are request-scoped, the suffix was marginal while each service runs one replica); `| host_provider="homelab"` stays the documented log filter; no Grafana-side index-label setting.

## Rejected Alternatives

- `R-1` A shared Python helper or package that builds the id — rejected because a new package plus four Dockerfile/lockfile changes and a new coupling seam for one f-string fails C-18 YAGNI; `_host_provider` is already duplicated per service and Go/Node/UI inline the id.
- `R-2` Setting the id via `OTEL_RESOURCE_ATTRIBUTES` in compose and app specs — rejected because it breaches 332 `@AC-22` and the CI guard (`scripts/check-otel-produced-signals.py:45`) and SDK precedence is unverified.
- `R-3` An extra test proving the code-set id beats `OTEL_RESOURCE_ATTRIBUTES` — rejected because CI already rejects that env var in deploy specs (C-18 YAGNI).

## Open Risks

- [ ] **SDK precedence unverified:** the pinned `opentelemetry-sdk` 1.45.1 source is not installed on this host, so whether an explicit `service.instance.id` in `Resource.create` wins over the SDK default is proven only by the RED/GREEN wire test — addressed at each of U1-U4 (stop condition returns to design).
- [ ] **One-time series relabel on first deploy:** the Python series on DO dev and homelab change from SDK UUID to `<provider>-<service>`; old series go stale — documented in U5 (observability.md Open risks).
- [ ] **DO rolling-deploy overlap:** two Python processes briefly push identical `(job, instance, deployment_environment)` series, as 332 accepted for Go/Node/UI — named in U5's rolling-deploy bullet.
- [ ] **Replica scaling:** if the agent's `instance_count` is raised above 1, replicas share one id and collide in telemetry — documented in U5 (agent CLAUDE.md clause and observability.md).
- [ ] **Empty `SERVICE_NAME` edge:** D-2's invariant (id equals the exported `service.name`) holds for any non-empty `SERVICE_NAME`; an empty one yields `homelab-` while the SDK may export `unknown_service`. Every deploy surface sets a non-empty literal; accepted, no guard, no test (D-15).
- [ ] **Local compose yields `unknown-<service>`:** `docker-compose.yml` sets no `HOST_PROVIDER` (332 `@AC-15`); accepted.
- [ ] **File overlaps with features 329, 333, 334:** `app/telemetry.py` in analysis/indicators (329), `ingest/app/telemetry.py` (334), `docs/patterns/observability.md` (333). The +3 lines in `_build_resource` shift later lines but do not overlap those regions; `/sdd-spec` cites symbols, not absolute lines; U5 rebases onto 333 if it merges first (otherwise 333 rebases onto this feature) and the guard is re-run after any rebase — addressed at U5.
- [ ] **Verification environment:** `pytest` is not installed in this sandbox; `/sdd-execute` tries `uv sync --extra dev` per service and otherwise uses CI's `python-test` matrix, recording observed RED text — addressed at each unit.
- [ ] **Two-process indicators test cost:** two interpreter starts (a few seconds, bounded by `wait(timeout=30)`); `NO_PROXY=127.0.0.1` must be kept in the helper — addressed at U3.
- [ ] **Per-scenario expected ids are not C-13 fixtures:** the literals `homelab-<svc>` and `unknown-ingest` in tests stay inline; `/sdd-spec` must not add a conftest constant for them (D-14).
- [ ] **Promotion hygiene at integration:** promote only the scenarios D-18 allows, read `acceptance.feature` from `origin/feature/<slug>` (`fails.md:3235`), check AC-3/AC-9 against 332's unknown-provider scenarios first — addressed at integration promotion.

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every claim above cites a `recon.md` `path:line`; the unverified SDK precedence is recorded as a risk, not asserted.
- `C-08` / `P-06` — honored by: each service step pairs with a test step as a `**Lands with**` unit whose test is RED first.
- `C-10` — honored by: the id contract is updated in every instance it is stated (four Python builders, the observability doc, the agent CLAUDE.md claim, the guarded doc test).
- `C-11` — honored by: story, review and a full design debate ran before any code (this design).
- `C-13` — honored by: expected ids are per-scenario values and stay inline (D-14); no speculative fixture home.
- `C-15` — honored by: every acceptance scenario is covered by a test step or a named verification; AC-5 evidence is the `HOST_PROVIDER=homelab` run (D-13).
- `C-16` — honored by: see Business Rules Touched; the CHANGEs carry the operator's sign-off.
- `C-18` — honored by: the least mechanism (one key per service, no helper, no flag, no extra tests); the accepted duplication and the empty-name edge are recorded trade-offs.
- `P-01` / `P-02` / `P-04` / `P-05` — honored by: the orchestrator wrote every artifact; proposer and adversary were mediated; the gate was recorded; decisions were written as they happened.
- `F-01`..`F-03` — not engaged (no migration, push or PR target change). `F-08` — honored by: each unit's file list is closed (U1-U4 two files each; U5 three files); `platform.feature` sits outside every step. `F-11` — no Floor breach was raised in any round.

## Business Rules Touched (C-16)

- CHANGE `@AC-21 @FR-1 @feature-332` "Python services keep an SDK-generated instance id" (`docs/sdd/business-rules/platform.feature` ~L2373-2377) — retitled "A Python service's instance id is identical across process starts" with a new Given, When and Then (word for word 336 `@AC-4`), annotated `# Changed by @feature-336`; signed off by user @ 2026-11-12 (round-1 gate, `context.md`).
- CHANGE `@AC-12 @FR-7 @feature-332` "Documentation states the attribute contract" (~L2337-2341) — only "Go, Node and UI set service.instance.id" becomes "Go, Node, UI and Python set service.instance.id"; every other clause is kept; signed off by user @ 2026-11-12 (round-1 gate, `context.md`).
- EXTEND `@AC-19 @FR-1 @feature-332` "The series discriminator is deterministic per provider and service" (~L2355-2365) — new Examples rows analysis/`homelab-analysis`, ingest/`homelab-ingest`, indicators/`homelab-indicators`, agent/`homelab-agent`, under `# Extended by @feature-336`.
- PRESERVE `@AC-1`, `@AC-3`, `@AC-4`, `@AC-13`, `@AC-5`, `@AC-10`, `@AC-11`, `@AC-22`, `@AC-6`, `@AC-7`, `@AC-14`, `@AC-20`, `@AC-15` `@feature-332`; `@AC-10`, `@AC-2`, `@AC-19`, `@AC-9` `@regression @feature-274`; `@AC-1`, `@AC-2` `@regression @feature-171`; `@AC-42 @feature-294`; `@AC-13 @feature-279` (`docs/sdd/business-rules/platform.feature`) — not regressed by: only the `instance` / `service_instance_id` values change; `host.provider`, `service.name`, `deployment.environment`, `platform`, metric names, exporter wiring, the `otel-guard` blocks, the no-`trading_mode` rule and the non-blocking, inert-when-disabled init are untouched.
- Not promoted as separate durable rules (D-18): 336 `@AC-1`, `@AC-4`, `@AC-6`, `@AC-5`, `@AC-10`, `@AC-12`, `@AC-13`, `@AC-14`; the rest go to `scenario-promoter`.
