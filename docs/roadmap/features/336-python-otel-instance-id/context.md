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
