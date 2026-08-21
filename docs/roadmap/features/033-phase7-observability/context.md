# Context: phase7-observability  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: Scoped as "implement Phase 7 observability", it collapsed on contact with `main-dev` into a verify-and-gap-fill job: feature `015-fix-grafana-otel-variables` had already shipped the OTel collector, per-language stubs, DO/compose env wiring, and the runbook. Net new work was (a) filling the one workload 015 missed — `xstockstrat-agent` telemetry — and (b) delivering the four file-based dashboards (`packages/otel/dashboards/`) + alert rules (`packages/otel/alerts/`) + doc corrections. Nothing green-field was instrumented.

**Why (irrecoverable rationale)**: The 2026-05-30 story was one of a 4-feature batch (033/041/044/045) with open questions deliberately left for the review gate, and its FR-1 assumed the DO app specs wired OTEL only for the collector. Grounding at execute time found a global `envs:` block already covered every component, so most FRs became verify-not-build. The decisive move was checking current `main-dev` before building rather than trusting the spec's world-model.

**Rejected alternatives**:
- Ship the roadmap's FR-3 panel wishlist verbatim (open-position gauge, bracket-order counter, TimescaleDB pool gauge) — lost because no service emits those metrics; panels would render "No data". Approximated from the `rpc_server_duration_milliseconds` gRPC histogram + Loki matches instead.
- Bake "market hours only" into the no-scoring alert rule expression — lost to a notification mute timing so the rule still evaluates 24/7 for dashboards and only paging is suppressed off-hours.
- Implement the roadmap's `platform.otel.*` config-service keys — rejected; OTLP endpoint/creds stay infra env/secrets.

**Scars & gotchas**: The agent is a gRPC *client* (`grpc.aio` dialer), so its telemetry uses `GrpcAioInstrumentorClient`, not the `GrpcAioInstrumentorServer` the other Python services use — copying the server pattern instruments the wrong side. Adding the three OTel deps + `uv lock` pulled the agent's `protobuf` from 7.x *down* to 6.33.x via the OTel proto constraint — it happened to align the agent with the other Python services, but an OTel dep now silently pins protobuf across Python services.

**Permanent deviations**: No `design.md` existed (harness `implement phase 7` session, not a standard /sdd-design→/sdd-spec run). All seven roadmap-vs-shipped divergences are recorded in the surviving `docs/roadmap/phase7-deviations.md`.

**Cross-feature signal**: 015 pre-shipped the OTel substrate but missed the agent; feature 020 (`notify-external-fanout`) is the intended V1 alert-routing target. A "phase" feature layered on prior features' work is where scope silently shrinks.

**Deferred follow-ons**: Tempo distributed-trace dashboards (traces collected, unvisualized); bespoke business metrics (position counts, bracket-order success, TimescaleDB pool gauges); programmatic Terraform/Grafana-API provisioning (files import-ready) — all V2, flagged in dashboard/alert READMEs + phase7-deviations.md § Not done. Operator one-time steps at launch: import dashboards/alerts, set `OTEL_ENABLED=true` + endpoint/headers.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-19 `phase7-observability` entries.

**Runtime-invariant recommendations (→ /context-constitution)**: `<MODULE>-*` (xstockstrat-agent): the agent instruments as a gRPC client (`GrpcAioInstrumentorClient`) while other Python services instrument as servers, and the OTel exporter deps pin `protobuf` to 6.33.x across all Python services — candidate note for `services/xstockstrat-agent/docs/` so a future protobuf bump doesn't silently break the OTel constraint (borderline; both facts are grep-able in `app/telemetry.py`/`uv.lock` and recorded in phase7-deviations.md).

**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 1d97c6c. (`docs/roadmap/phase7-deviations.md` survives and independently holds the deviation set.)
