# Context: python-otel-instance-id

**Feature**: `docs/roadmap/features/336-python-otel-instance-id/feature.md`
**Product Spec**: `docs/roadmap/features/336-python-otel-instance-id/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/336-python-otel-instance-id/implementation-spec.md`

---

## Session 2026-11-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 336 reserved on `origin` via `scripts/sdd-allocate-feature-number.py` (cursor `sdd/feature-cursor`).
- Origin of the story: a Grafana investigation found the four homelab Python services exporting UUID instance ids (analysis `7ef0591e-…`, ingest `e08d49a3-…`, indicators `ce83cd93-…`, agent `f1a73349-…`), so `{service_instance_id=~"homelab-.+"}` misses 4 of 12 services. `xstockstrat-ui` was checked and already conforms (`services/xstockstrat-ui/src/telemetry.ts:57`).
- Operator decisions recorded this session: (1) keep `| host_provider="homelab"` as the documented log filter; (2) do NOT use `service.namespace` (rejected here and in feature 332 `R-6`); (3) Grafana Cloud's OTLP index-label setting is unavailable on the current tier, so no `host_provider` label; (4) run the SDD pipeline, no override.
- Supersedes feature 332 decision D-7 (`332-homelab-otel-host-provider/debate.md`) and scenario `@AC-21`. 332 is `launched`, so this is a new follow-up feature; 332's artifacts are not edited.
- Open for recon: single-process-per-service proof (identical-series collision), the real source of Python's `service.instance.id` (332 left it unverified), and any series consumer keyed on a Python `instance` value.

## Session 2026-11-12 — operator revision (before /sdd-review)

- Operator decisions: (1) scope is **all 12 runtimes**, not Python only; (2) id template confirmed as `<host.provider>-<service.name>-<suffix6>`, e.g. `homelab-trading-a1b2c3`; (3) suffix = first 6 hex of the OS hostname when it is exactly 12 or 64 lowercase hex chars (a Docker container id), else 6 random hex per process; (4) read the OS hostname (`os.Hostname()` / `socket.gethostname()` / `os.hostname()`), not the `HOSTNAME` env var, because `deploy/homelab/compose.yml:290` sets the UI's `HOSTNAME` to `0.0.0.0`.
- Rejected: always-`HOSTNAME`-env (breaks UI), unvalidated hostname prefix (junk suffixes), suffix before service (breaks `homelab-<service>-.+` selection).
- Consequence accepted: container recreate starts a new series; a non-hex hostname (probably DO App Platform, unverified) churns on every restart. This reverses 332's "zero restart churn" for Go, Node and UI and supersedes 332's exact-id assertions on those 8 runtimes, not only Python's AC-21.
- Checked: no compose file sets `hostname:`; a shallow grep found no worker/gunicorn config in the four Python services (not proof; recon owns it).
- Slug `python-otel-instance-id` is now narrower than the scope; kept to avoid churning the reserved number and the open PR. Rename is an open question in the product spec.

## Session 2026-11-12 — suffix dropped (before /sdd-review)

- Operator asked whether the suffix has value over trace-id/span-id and said to drop it if marginal. Judged marginal; dropped. Scope reverts to the 4 Python runtimes: the 12-runtime widening existed only to carry the suffix, and Go/Node/UI already export `<host.provider>-<service.name>`.
- Why trace/span ids are not a substitute: they are request/operation-scoped, while `service.instance.id` is a resource attribute fixed per process and shared by all signals; metric series carry no trace or span id, and the collision a suffix guards against is two processes writing one `(job, instance, deployment_environment)` metric series. Logs already carry `trace_id`/`span_id` as structured metadata for log-to-trace joins.
- Why the suffix was marginal: live `target_info` showed exactly one instance per job per provider; 332 D-7 already assumes one replica per service per stack; the only exposure is the brief DO rolling-deploy overlap (`observability.md:111`) that Go/Node/UI already carry (no ingest errors measured). Cost: a 12-runtime change, a new series per container recreate, random-suffix churn on every restart where the hostname is not hex (DO probably, unverified), and superseding 332's exact-id assertions on 8 services.
- Recorded design if replicas are ever added: suffix = first 6 hex of the OS hostname when exactly 12 or 64 lowercase hex (Docker container id), else 6 random hex per process; read the OS hostname via `os.Hostname()` / `socket.gethostname()` / `os.hostname()`, not `HOSTNAME` (compose sets the UI's to `0.0.0.0`, `deploy/homelab/compose.yml:290`). Template `<host.provider>-<service.name>-<suffix6>`. Not in scope here; open a follow-up feature.
- The earlier "Slug no longer matches scope" open question is moot: scope is Python-only again, so the slug fits.

## Session 2026-11-12 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready, after 5 review rounds. Round 1 FAIL (criterion 9: unchecked Open Questions) plus 6 warnings; rounds 2-4 PASS WITH WARNINGS (doc-edit specificity, post-deploy check reconciliation, compound `Then` clauses); round 5 left one stale-prose warning (AC-18 not named as `@manual`), fixed and verified by grep, not by a sixth agent round.
- Warnings: none outstanding.
- Overlap findings (non-blocking, no FAIL-level): `app/telemetry.py` in analysis and indicators vs feature 329 (`spec-ready`); `ingest/app/telemetry.py` vs feature 334 (`code-completed`); `docs/patterns/observability.md` vs feature 333 (`spec-ready`). No merge-order row written (no FAIL-level overlap); re-anchor line references after 329/334 land and rebase the doc edit against 333.
- Recommended design depth: full (rubric `docs/sdd/design-depth-rubric.md`: ≥2 affected services (4) and warning-level overlaps both escalate; `quick` is not eligible).
- Resolved during review: single exporting process per Python service (analysis/ingest/indicators `python -m app.main` + `asyncio.run`; agent supervisord runs one program). Open for recon: where Python's `service.instance.id` comes from (SDK not installed in sandbox), indicators sandbox children not initialising OTel, series consumers on cutover.
- Tree-freshness deviation: the feature branch `feature/python-otel-instance-id` does not exist on origin and the feature files live only on `ccr-63b017b0-2g0zy5`, so the preflight used that branch as TARGET instead of switching to `main-dev`.

## Session 2026-11-12 — sdd-design (Phase 0 recon)

- Phase 0 Recon: wrote recon.md (services: analysis, ingest, indicators, agent; key reuse patterns: the shipped `f"{provider}-{serviceName}"` contract in UI/Node/Go, each service's existing `_host_provider()` + `_build_resource()`, and each `tests/test_telemetry.py` OTLP capture path). Mode: full (rubric: 4 affected services + warning-level overlaps with 329/333/334).
- C-16 CHANGE recorded: platform.feature `@AC-21 @feature-332` ("Python services keep an SDK-generated instance id") is deliberately reversed by this feature, and `@AC-12`/`@AC-19` are extended. Basis for the sign-off so far: the operator directed "fix the Python runtimes" and chose "Run SDD" on the option that named the D-7 / AC-21 reversal. The operator confirms the CHANGE again at the design gate; if they decline, the design phase stops.
- Findings that shape the debate: all four services have an identical single-builder shape; indicators sandbox children are env-stripped and import no OTel; the SDK source is not installed here, so explicit-key precedence over the SDK default is unverified and must be proven by the RED/GREEN wire test.

## Session 2026-11-12 — sdd-design (Phase 1, round 1 gate)

- Round 1 run (proposer + adversary). Floor status: no breach. 9 non-blocking objections raised, all closed (see debate.md); 11 decisions settled, 3 alternatives locked rejected.
- **C-16 sign-off (explicit, at the round-1 gate, via AskUserQuestion):** the operator confirmed that 332 `@AC-21` ("Python services keep an SDK-generated instance id") is deliberately CHANGED and that 332 `@AC-12` ("Documentation states the attribute contract") is also CHANGED (reworded to add Python); 332 `@AC-19` is only EXTENDED with Python rows. Both are annotated in place at integration promotion with a `# Changed by @feature-336` line; 336 `@AC-1` is not promoted as a separate rule.
- Operator chose to run round 2 (full mode mandates at least 2 rounds before approval).
- Obligations carried to /sdd-spec and /sdd-execute: record the unit-RED failure mode (KeyError vs mismatch) in context.md; stop-and-return-to-design if unit is GREEN but the wire still shows a UUID; agent CLAUDE.md clause and observability.md `:111` Python mention go in the docs step's Files.

## Session 2026-11-12 — sdd-design (approved)

- Phase 0 Recon: wrote recon.md (services: analysis, ingest, indicators, agent; key reuse patterns: the shipped `f"{provider}-{serviceName}"` contract in UI/Node/Go and each service's existing `_host_provider()` + `_build_resource()` + OTLP capture tests).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: one `service.instance.id = <provider>-<service>` key added inside each Python `_build_resource()` (no shared helper), test-first with wire assertions on traces/metrics/logs, a docs step, business-rule promotion at integration. Rejected: shared helper/package (R-1), setting the id via `OTEL_RESOURCE_ATTRIBUTES` (R-2), a precedence-vs-env-var test (R-3).
- Constitution rules touched: C-01, C-08, C-10, C-11, C-13, C-15, C-16, C-18, P-01, P-02, P-04, P-05, F-04, F-08. Floor breaches: none in any round.
- C-16: 332 `@AC-21` and `@AC-12` CHANGED, `@AC-19` EXTENDED, signed off by the operator at the round-1 gate (above); D-18 lists the 336 scenarios not promoted as separate durable rules.
- Round-3 gate decisions (operator): fix the pre-existing drift at `docs/patterns/observability.md:69-70` in the docs step (D-21); add the two protective strings to `test_the_host_provider_contract_stays_documented` (D-22); approve the design. These two widen U5 beyond the product spec's FR-4 text (a fourth doc edit site and the guard test file in Files); the product spec is not re-opened, design.md governs `/sdd-spec`.
- Open Threads (target step): SDK precedence unverified → each of U1-U4 RED/GREEN wire test (record observed RED failure mode here); one-time series relabel + rolling-deploy overlap + replica scaling → U5 doc text; 329/333/334 file overlaps → `/sdd-spec` cites symbols, U5 rebases onto 333; verification environment (no pytest in sandbox) → `/sdd-execute` tries `uv sync --extra dev`, else CI.
- Status: spec-ready → design-approved.

## Session 2026-11-12 — sdd-spec

- Generated implementation-spec.md with 10 steps in 5 atomic units (U1 analysis 1-2, U2 ingest 3-4, U3 indicators 5-6, U4 agent 7-8, U5 docs 9-10, each a `**Lands with**` pair). Status → implementation-ready.
- Tree: `ccr-63b017b0-2g0zy5@5283446` (contains `origin/main-dev@cee3bae`); `feature/python-otel-instance-id` is not on origin, so no branch switch (same deviation as the /sdd-review session).
- Key codebase findings (all four Python `_build_resource()` confirmed identical in shape; edit sites cited by symbol, line numbers drift with 329/334):
  - analysis `app/telemetry.py` `_build_resource` :31, indicators :30, ingest :31, agent :23; each `tests/test_telemetry.py` has the same unit test (:20) and wire test (analysis/ingest/indicators :173, agent :160) with the superseded `startswith("homelab-")` pair at :217-218 (agent :204-205).
  - Indicators `CHILD` script and `test_sigterm_flushes_metrics_and_logs_at_normal_exit` are at :329-384 (the design's cited range holds); `_run_child_to_sigterm(**extra_env)` refactor is the basis of the AC-4 two-start test.
  - Guard scan limits for new prose in `observability.md`: only `xstk-*` names, `*.json|*.yaml` file names and "<n> dashboards/alert rules" claims are checked outside the fences (`scripts/check-otel-produced-signals.py` `scan_doc`); the new text avoids all three.
  - `observability.md` has no "Python" mention in the rolling-deploy bullet today; Step 9 adds it (D-7/O-2). 332 recon:56 confirms `service_instance_id` is a Loki stream label (D-21).
  - No pytest/OTel SDK in the sandbox; verification falls back to CI `python-test` per D-17.
- Manual scenarios @AC-7, @AC-8, @AC-18 are listed in the spec's Scenario Coverage as not automated; the operator runs them post-deploy.
- `platform.feature` promotion stays out of the step list (F-08).

## Session 2026-11-12 — sdd-review impl-spec (advisory)

- Result: 0 failures, 4 warnings (advisory — did not block). Steps: 9 ✓, 1 ⚠ (Step 9), 0 ✗. No Floor (F-*) risk; every cited symbol, line number and test name matched the tree at `84a582c`.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 9: AC-15 verification `grep -n "relabel" … | grep -n "Python"` is fragile — the relabel bullet wraps over two lines, so "relabel" and "Python" can land on different lines after the rewrite and the check would fail for the wrong reason (W2). Handle at Step 9 by writing the Python mention on the same line as "relabel", or use a multi-line check; record it in the Deviation Log if the verification command is changed — [x] addressed (see sdd-execute session)
  - Step 9: the `git diff -U0 … | grep -c '^@@'` hunk-count and guard-block `git diff` checks only work against uncommitted changes; run them before the step commit (or diff against `main-dev`) (W4) — [x] addressed (see sdd-execute session)
  - Steps 3/5/7 and 4/6/8: Instructions chain by reference to Steps 1/2 (W3). Apply each service's concrete edit with its own `<svc>` default literal; carry over the analysis-only `digitalocean` wire-test stacking to analysis ONLY, and use each service's own wording in comments — [x] addressed (see sdd-execute session)
  - Steps 2/4/6/8: RED mode assumption (W1, NOTE): if the SDK adds the UUID inside `Resource.create`, the unit test passes only after Step 1; record the OBSERVED RED failure text, never a predicted one (P-06, D-6, D-17) — [x] addressed (see sdd-execute session)
- Overlap findings (WARN-level, rebase-only, no migration/proto/config collision): `app/telemetry.py` in analysis and indicators vs feature 329 (no impl-spec yet); ingest `app/telemetry.py` vs 334 (`code-completed`, disjoint region); `services/xstockstrat-agent/CLAUDE.md` vs 334 (tool-table row at `:65`; Step 9 requires a one-hunk diff); `docs/patterns/observability.md` vs 333 (no impl-spec yet; 333 re-anchors after 336 merges). Recommended, not written: a prose note in `merge-order.md` for 336↔333 and 336↔334; re-scan 329/333 when their impl-specs exist. `merge-order.md:367-377` still lists 332 as in-flight although it is launched (stale prose, out of scope).

## Session 2026-11-12 — sdd-execute (sequential) start

- Operator authorized `/sdd-execute python-otel-instance-id sequential` via the up-front confirmation (AskUserQuestion): **no checkpoints** (no pauses at the 5-step cap or before the integration PR; the accountability report is printed inline after each unit and at the end; pauses only for blockers or the design-halt condition D-6). The same confirmation **pre-approved the C-16 promotion plan** (332 `@AC-21` and `@AC-12` CHANGE, `@AC-19` EXTEND, promote 336 `@AC-2, 3, 7, 8, 9, 11, 15, 16, 17, 18`, not `@AC-1, 4, 5, 6, 10, 12, 13, 14`, after checking `@AC-3/@AC-9` against 332's unknown-provider scenarios).
- Branch deviation (logged): the spec names `feature/python-otel-instance-id`, which does not exist on `origin`; this session may push only to `ccr-63b017b0-2g0zy5`, so `<dev-branch>` = `ccr-63b017b0-2g0zy5`, one commit per unit lands on the already-open PR #1527, and no new branch or per-step PR is created. Re-spec gate: no step evidence mismatch known at `84a582c` (the impl-spec review verified symbols and lines on this tree); each unit re-verifies in Phase 1.
- Tooling probe: `uv` 0.11.32, `ruff` 0.16.9, `pytest` present, PyPI reachable; no PostgreSQL binaries (analysis `real_pg` tests skip locally, CI is the coverage-floor gate); `libseccomp` present; the OpenTelemetry SDK is not installed until `uv sync --frozen --extra dev` runs per service.

### Step 1 — service: analysis exports `service.instance.id` [done] (unit U1 with Step 2)
- Hoisted `service_name` and `provider` locals in `_build_resource()` and appended `"service.instance.id": f"{provider}-{service_name}"`; no other change.
- Files modified: `services/xstockstrat-analysis/app/telemetry.py`
- Deviations: none (branch deviation is logged once, Deviation 1).

### Step 2 — test: analysis wire and unit assertions for the new id [done] (unit U1 with Step 1)
- Unit parametrize widened to `(host_provider, want, service_name)` with ids; wire test stacked over `host_provider` `homelab`/`digitalocean`, sets `SERVICE_NAME`, asserts the exact id on all three signals; superseded `startswith` block and stale comment removed.
- TDD (P-06): **RED observed** before the code change, `uv run --no-sync pytest tests/test_telemetry.py -q` → `9 failed, 21 passed`; unit tests failed with `AssertionError: assert '1f606280-6be...-49940936862d' == 'unknown-analysis'` (value mismatch, **not** a `KeyError`: the SDK's UUID is already inside `Resource.create`'s output); wire tests failed with `assert '345626e4-a2c...' == 'digitalocean-analysis'`. **GREEN** after Step 1: `30 passed` plain, `30 passed` with `HOST_PROVIDER=homelab`; full suite `1653 passed`, coverage `91.47%` (floor 40); `ruff check` and `ruff format --check` clean; AC-13 grep 0 matches; no `conftest` import (C-13).
- D-6 answered from source and confirmed by the wire test (SDK `opentelemetry-sdk` 1.45.1, `.venv/.../sdk/resources/__init__.py`): `Resource.create` merges `ServiceInstanceIdResourceDetector` (random UUID v4, prepended unless `service_instance` is configured) first and the caller's `attributes` last, so an explicit key wins ("Resource.create() ... does preserve user supplied overrides"). Stop condition NOT triggered; U2-U4 proceed.
- New risk recorded (not in design.md): the same docstring says providers re-run process-dependent detectors after an interpreter fork and the fresh UUID overwrites a user-set `service.instance.id`. None of the four services forks its main interpreter (single `python -m app.main`, thread pools, `subprocess.Popen` children exec fresh interpreters), so no effect today; any future `multiprocessing`/`os.fork` of the service process would revert the child's exported id to a UUID.
- Local note: `uv sync` resolved the venv on Python 3.12; CI pins 3.13. Same lockfile; no behavior difference expected.
- Files modified: `services/xstockstrat-analysis/tests/test_telemetry.py`
- Deviations: none.

### Step 3 — service: ingest exports `service.instance.id` [done] (unit U2 with Step 4)
- Same `_build_resource()` edit as Step 1 with the `"ingest"` default; `init_telemetry`'s log-line `SERVICE_NAME` re-read untouched (D-2).
- Files modified: `services/xstockstrat-ingest/app/telemetry.py`
- Deviations: none.

### Step 4 — test: ingest wire, unit and unrecognised-provider assertions [done] (unit U2 with Step 3)
- Unit parametrize widened with ids; wire test sets `SERVICE_NAME=ingest` and asserts `homelab-ingest` on all three signals (no `digitalocean` stacking: analysis-only); `test_unset_host_provider_exports_unknown` renamed `test_unrecognised_host_provider_exports_unknown_prefix` and parametrized over None/"aws"/"Homelab", asserting `host.provider == "unknown"` and `service.instance.id == "unknown-ingest"`; superseded block and stale comment removed.
- TDD (P-06): **RED observed** before the code change → 10 failed (5 unit, 2 wire, 3 unrecognised-provider), every one `AssertionError: assert '042e19e3-295...-7bb0208249f8' == '<provider>-ingest'` (UUID inside `Resource.create`'s output, value mismatch). **GREEN** after Step 3: `28 passed` plain and `28 passed` with `HOST_PROVIDER=homelab`; full suite `486 passed`, coverage `86.38%` (floor 40); ruff check/format clean; AC-13 and stale-name greps 0 matches; no `conftest` import (C-13).
- The "reaches SERVING" clause of AC-3/AC-9 rests on 332 `@AC-3/@AC-4/@AC-13` non-blocking-init coverage, as the step states (D-10).
- Files modified: `services/xstockstrat-ingest/tests/test_telemetry.py`
- Deviations: none.

### Step 5 — service: indicators exports `service.instance.id` [done] (unit U3 with Step 6)
- Same `_build_resource()` edit with the `"indicators"` default; the log-line `SERVICE_NAME` re-read and feature 329's startup-log region untouched.
- Files modified: `services/xstockstrat-indicators/app/telemetry.py`
- Deviations: none.

### Step 6 — test: indicators wire, unit and two-process-start assertions [done] (unit U3 with Step 5)
- Unit parametrize + wire assertions as in Step 4 (`indicators`/`homelab-indicators`); the SIGTERM test body moved into the module helper `_run_child_to_sigterm(**extra_env)` (`extra_env` merged last, `NO_PROXY`/`no_proxy` kept); new `test_instance_id_identical_across_two_process_starts` runs the child twice with `HOST_PROVIDER=homelab`, `SERVICE_NAME=indicators`, decodes `/otlp/v1/metrics` each time and asserts both ids equal `homelab-indicators` (AC-4 over the wire).
- TDD (P-06): **RED observed** before the code change → `8 failed, 18 passed`: 5 unit + 2 wire failures `AssertionError: assert '0b6446dc-a03...-ff966ac1c889' == '<provider>-indicators'`, and the two-start test `assert ['07a99872-55...8612e2a95fdc', ...] == ['homelab-indicators', 'homelab-indicators']` (two different per-process UUIDs, so it fails for the reason AC-4 exists). **GREEN** after Step 5: `26 passed` plain and `26 passed` with `HOST_PROVIDER=homelab`; full suite `576 passed`, coverage `86.90%` (floor 50); ruff check/format clean; AC-13 and stale-comment greps 0 matches; no `conftest` import (C-13).
- Files modified: `services/xstockstrat-indicators/tests/test_telemetry.py`
- Deviations: none.

### Step 7 — service: agent exports `service.instance.id` [done] (unit U4 with Step 8)
- Same `_build_resource()` edit with the `"agent"` default; `init_telemetry`'s log-line `SERVICE_NAME` re-read untouched. `supervisord.conf` still runs the one `app-main` program, `instance_count: 1` in both DO specs.
- Files modified: `services/xstockstrat-agent/app/telemetry.py`
- Deviations: none.

### Step 8 — test: agent wire and unit assertions for the new id [done] (unit U4 with Step 7)
- Unit parametrize widened with ids; the wire test (which set no `SERVICE_NAME` before) now sets `SERVICE_NAME=agent` and asserts `homelab-agent` on all three signals; superseded block and stale comment removed; `test_agent_resource_and_warn_log_correlated_to_span` left as is.
- TDD (P-06): **RED observed** before the code change → `7 failed, 10 passed`, every failure `AssertionError: assert '6c96c99c-1a7...-6e599a8884f0' == '<provider>-agent'` (UUID inside `Resource.create`'s output). **GREEN** after Step 7: `17 passed` plain and `17 passed` with `HOST_PROVIDER=homelab`; full suite `750 passed`, coverage `87.97%` (floor 40); ruff check/format clean; AC-13 and stale-comment greps 0 matches; no `conftest` import (C-13).
- Files modified: `services/xstockstrat-agent/tests/test_telemetry.py`
- Deviations: none.

### Step 9 — docs: observability contract and agent replica caveat [done] (unit U5 with Step 10)
- `docs/patterns/observability.md`: resource-attribute paragraph now says Go, Node, UI and Python all set `service.instance.id` (one replica per service per stack); "What Grafana promotes" bullet corrected (D-21: `deployment_environment` and `service_instance_id` are stream labels, `host_provider` structured metadata); new log-selector paragraph for `{service_instance_id=~"homelab-.+"}`; post-deploy list keeps the `host_provider` count, adds the `instance=~"homelab-.+"` count with the same thresholds and says `instance` is `homelab-<job>` for all 12 jobs; Open risks: rolling-deploy bullet names Python and replica sharing, "Python restart churn" removed, relabel-once bullet names Go/Node/UI and Python on one line. All new text is outside the `otel-guard` fences, which are byte-identical.
- `services/xstockstrat-agent/CLAUDE.md`: one clause that `instance_count > 1` is safe for OAuth while telemetry replicas would share one `service.instance.id` (one hunk).
- Verification (run before commit, per review warning W4): ten named greps all PASS (AC-6, 14, 10, 15, 16, 11, 11, 17, guard blocks untouched, agent CLAUDE.md one hunk); `python3 scripts/check-otel-produced-signals.py` exit 0. TDD: N/A (docs; red→green is Step 10).
- Files modified: `docs/patterns/observability.md`, `services/xstockstrat-agent/CLAUDE.md`
- Deviations: none.

### Step 10 — test: protect the new doc contract in the guard suite [done] (unit U5 with Step 9)
- Appended the `instance=~"homelab-.+"` count expression and `{service_instance_id=~"homelab-.+"}` to `test_the_host_provider_contract_stays_documented`; nothing else in the file changed.
- TDD (P-06): **RED observed** before the doc edits → `1 failed, 75 passed`, `AssertionError: count(group by (job) (target_info{deployment_environment="staging", instance=~"homelab-.+"}))` not in the doc. **GREEN** after Step 9: `76 passed`; `python3 scripts/check-otel-produced-signals.py` exit 0; `ruff check` and `ruff format --check` clean in `scripts/`; repo-wide AC-13 grep 0 matches.
- Files modified: `scripts/tests/test_check_otel_produced_signals.py`
- Deviations: none.

## Session 2026-11-12 — sdd-execute (sequential)
**Steps this session**: 1-10 (units U1-U5)
**Progress**: 10 done / 10 total
**Config-key wiring gate** (`node scripts/check-config-wiring.mjs --final`): exit 0; reported two pre-existing findings in unrelated files (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:marketdata/fundamentals.provider:readers-disagree`, `services/xstockstrat-trading/internal/service/trading.go:platform/trading_state:readers-disagree`); this feature declares no config key.
**Review warnings carried from the impl-spec review**: W2 (Step 9 AC-15 grep) handled by keeping "relabel" and "Python" on one line; W4 (git-diff verifications) run before commit; W3 (chained Instructions) handled by applying each service's own default literal and keeping the `digitalocean` stacking analysis-only; W1 (RED mode) recorded from observed output in every test step. All four now `[x]`.
**Stopped at**: all 10 steps complete; integration promotion (C-16) and PR update follow.

## Session 2026-11-12 — sdd-execute integration (C-16 promotion)
- Promotion into `docs/sdd/business-rules/platform.feature` per the plan approved at the sequential up-front confirmation, with two dispositions recorded: (1) 332 `@AC-12` CHANGE (runtime list now "Go, Node, UI and Python"), 332 `@AC-21` CHANGE (retitled "A Python service's instance id is identical across process starts", body = 336 `@AC-4`), 332 `@AC-19` EXTEND (analysis, ingest, indicators, agent rows), each annotated in place with `# Changed by @feature-336` / `# Extended by @feature-336`; (2) promoted 336 `@AC-2, 3, 11, 15, 16, 17` as `@feature-336` scenarios in a new section.
- Narrowed from the pre-approved plan (scope reduced, nothing added): 336 `@AC-9` skipped as a duplicate of 332 `@AC-4` (unrecognised `HOST_PROVIDER` → `unknown`); 336 `@AC-7`, `@AC-8`, `@AC-18` (all `@manual`, live-stack checks) not promoted, following the feature-301 precedent in this suite ("@manual-spike ... not promoted"). A provenance comment in the new section lists every non-promoted scenario and why.
- Step 2.6 (close resolved defect reports): no `docs/reports/*.md` mentions `service.instance.id`, feature 332 or `host_provider`; nothing to close.
- Manual post-deploy checks still owed by the operator after deploy (not automated, `@manual`): 336 `@AC-7` (instance-prefix count returns 12), `@AC-18` (at least 11 on an idle stack), `@AC-8` (the Loki selector returns all four Python services on homelab).

## Session 2026-11-13 (CI: feature status automation)

- Promotion PR #1525 merged to main
- Feature promoted and committed: 92b4774f816485d54422c3413e033c06f01606dc
- Status updated: `code-completed` → `launched`
- Launched date: 2026-11-13
