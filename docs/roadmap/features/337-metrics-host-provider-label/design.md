# Design: metrics-host-provider-label

**Created**: 2026-11-12
**Rounds**: 3 (full, upgraded from quick at the post-recon gate; termination: approved)
**Approved by**: user @ 2026-11-12
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

**Option B: a metric-exporter wrapper in each of the 12 runtimes** adds datapoint attribute `host.provider` (Mimir turns the dots into the label `host_provider`) to every datapoint, after aggregation and immediately before the OTLP exporter (D-4). No View, no record-time attribute, no `serverMetricViews` change, no new env var or config key, no `OTEL_RESOURCE_ATTRIBUTES`. Because it sits after aggregation, in-memory readers never see the label, so the per-instrument allowlist tests of feature 294 keep guarding instrument label sets unedited (D-8, `recon.md` Tests section).

Why a wrapper: in Go (`sdk/metric` v1.45.0), the Node leaves (`sdk-metrics` 1.25.1) and Python (`opentelemetry-sdk` 1.45.1) a View can only filter attributes and the Go `Reader` is sealed; the exported-exporter interface is the one supported seam (`recon.md` Mechanism matrix: `instrument.go:131-158`, `reader.go:44-96`, `exporter.go:19-77`; `View.d.ts:32`, `index.d.ts:19`; `view.py:96-109`). The UI could use a 2.x attributes processor, but one mechanism across the runtimes wins (R-3).

**Per-runtime shape** (provider read once from the same source as the resource, D-6; guarded per export, D-5):
- **Go x3** (`internal/telemetry/hostlabel.go`, ~55 lines): `hostLabelExporter` embeds `sdkmetric.Exporter` so `Temporality`, `Aggregation`, `ForceFlush` and `Shutdown` are forwarded; `Export` stages new attribute sets through an index-based walk over the 8 data types (Gauge, Sum, Histogram, ExponentialHistogram x int64/float64), commits them in a second loop, and recovers from a panic by exporting the untouched batch with one warning. Existing `host.provider` keys are removed before the new one is appended. `Init` hoists `p := hostProvider()` and passes it to `newResource` and to the wrapper at `NewPeriodicReader(...)` (`otel.go:72`). In-place assignment is safe because every aggregator reassigns the datapoints on each collect (`internal/aggregate/sum.go:114,250,291`, `histogram.go:205,386`, `lastvalue.go:124`) and the `Export` contract allows reuse (`exporter.go:47-49`).
- **Node leaves x4 and UI** (`withHostProvider` in `src/telemetry.ts`, ~30 lines): returns a new `PushMetricExporter`; `export` builds a copy (never mutates, because datapoint attributes can be the aggregation key, `HashMap.js:36-37`) inside try/catch; `selectAggregationTemporality` and `selectAggregation` are bound to the inner exporter (the reader binds them at construction, `PeriodicExportingMetricReader.js:32-33`); `forceFlush` and `shutdown` delegate. The resource is built once and passed to `NodeSDK`, and the wrapper reads `host.provider` from it (D-6). UI is its own step (two SDK majors, 0.52/1.25 vs 0.218/2.7).
- **Python x4** (`_with_host_provider` in `app/telemetry.py`, ~35 lines): a `MetricExporter` subclass defined inside the factory (deferred-import precedent `_make_rpc_duration_processor`), copying `_preferred_temporality`/`_preferred_aggregation` from the inner exporter via `getattr` (`export/__init__.py:93-99,434-435`), `export(self, metrics_data, *args, **kwargs)` rebuilding the frozen dataclasses with `dataclasses.replace` inside try/except, `force_flush` and `shutdown` forwarding `*args/**kwargs` verbatim (the reader calls `shutdown(timeout=...)`, `:541`).
- Every wrapper is built only after the existing `OTEL_ENABLED` early return, so disabled telemetry installs nothing.

**Queries and docs.** `docs/patterns/observability.md` gains a guarded `otel-guard:host-provider-label` block (`rate(rpc_server_duration_milliseconds_count{deployment_environment="staging", host_provider="homelab", <stream exclusion>}[5m])`, no join) as the preferred form. The 332 join stays as the fallback with its left operand wrapped in `sum without (host_provider)` (D-12): during the first ~5 minutes after each stack's first labelled deploy, old unlabelled and new labelled series share the same `instance`, `group_left` would otherwise produce duplicate result label sets and the query would error. `scripts/check-otel-produced-signals.py` Part 6 checks each tag exactly once with its own required matchers (the label block must carry `deployment_environment="staging"`, `host_provider="homelab"` and the stream exclusion and no `target_info`); a `337-AC-19 P6` row pins the pre-aggregation (D-19); rows are named with the feature because 332 already owns `@AC-9`.

**Consumer surface (C-14).** None: operator PromQL in Grafana Cloud. `packages/otel/dashboards/*.json` and `alerts/*.yaml` are untouched; `dashboards/README.md:47` (prose that says the label is only on `target_info`) is rewritten (D-15).

**Steps (7, RED first, D-9, D-18, D-20).** (1) Gating smoke test run by the operator from their own shell with the staging OTLP token (`@AC-17`, `@AC-22`): one datapoint attribute becomes the `host_provider` label, and the pre-aggregated join returns one row where the plain join errors; GREEN gates the feature. (2) Go x3. (3) Node leaves x4. (4) UI. (5) Python x4. (6) Docs, guard and its tests. (7) Post-deploy checks (`@AC-1`, `@AC-6`, `@AC-7`, `@AC-10` live incl. a range over the rollout, cost-line follow-up), then the integration append of the new 337 scenarios and read-as comments. Each runtime step adds a wire test (decode the real OTLP body, datapoint value equals the exported resource value) and a per-copy unit test file with a fake inner exporter (3 Go + 4 Node + 1 UI + 4 Python, ~1,240 lines, table-driven). RED is captured with a pass-through stub or the new datapoint assertion in the existing wire test; contract-forwarding tests are marked "red N/A, characterization".

## Rejected Alternatives

- `R-1` `service.namespace` or any repurposed standard attribute — operator decision; changes `job`; also rejected in 332 `R-6`.
- `R-2` `OTEL_RESOURCE_ATTRIBUTES` as the carrier — the deploy-spec guard rejects it (`@AC-22 @feature-332`); precedence is unverified per SDK.
- `R-3` UI-only wildcard view with `attributesProcessors` — two mechanisms in one runtime family for no gain; it would also enter `bffAllowlist.test.ts:98-102`.
- `R-4` Option A (Grafana-side `MimirOTLPConfiguration` promotion) as the adopted mechanism — not appliable or testable from the repo, gated on Grafana Labs Support, free-tier access unverified, affects new data only. Kept as a documented later simplification (delete the wrappers in the same change; never run both).
- `R-5` Keeping the three `@feature-294` sentences as PRESERVE by reinterpretation — the Grafana-observable label set changes; C-16 forbids a silent reinterpretation.
- Also considered and not adopted: a shared wrapper module per language (needs a Dockerfile COPY and lockfile changes in 12 services, D-16); promtool or a Python PromQL evaluator in CI (a toolchain pin to prove one fixed expression; the Mimir engine proves it once in step 1, CI pins the text, D-19).

## Open Risks

- [ ] Step 1 may pass on the Python protobuf path while the Node leaves send OTLP/JSON and behave differently, or Grafana later promotes `host.provider` and the label collides — caught by the post-deploy `@AC-1`/`@AC-10` checks on homelab staging before promotion.
- [ ] Homelab staging is not exporting yet (`context.md` baseline), so `@AC-1`, `@AC-6`, `@AC-10` can only pass after it is; step 7 needs operator confirmation before the main-dev to main promotion (fails.md:640-643).
- [ ] The OTLP encoders (`otlpmetrichttp` v1.45.0, Python `OTLPMetricExporter`) and `attribute.Set` dedup were not read from source; wire tests plus the explicit same-key filter are the proof.
- [ ] The `337-AC-19` guard row accepts the substring anywhere in the join block (weak but pinned by the Mimir proof).
- [ ] 12 duplicated wrapper copies (YAGNI trade-off, report-only jscpd outside the UI, `.husky/pre-commit:13,18`; no `.jscpd.json` change).
- [ ] Textual overlap with 333 (`otel-env-provider-scoped-alerts`), 297 and 329 on `observability.md`, the guard, `produced-signals.tsv` and the telemetry modules; 336 has no directory on disk and is not depended on. A non-blocking `merge-order.md` note awaits operator confirmation.
- [ ] Integration hand-off: `/sdd-execute` shows the append plan (new scenarios plus four read-as comments, citing the context.md sign-off) for operator confirmation; the comments in the ui, analysis and platform suites are hand edits, as the indicators suite already did (`signal-map-instrumentation.feature:15`).

## Constitution Rules Touched

- `C-01` — honored by: every cited path/line comes from recon digests or direct reads of the pinned SDK sources.
- `C-08`, `P-06` — honored by: a paired test per runtime step, RED captured by a pass-through stub or the new wire assertion.
- `C-10` — honored by: all 12 runtimes covered, each with its own unit test (P-2), plus the doc/guard/README surfaces.
- `C-11` — honored by: story, design and ledger touch before any code.
- `C-14` — honored by: consumer surface named as None (operator PromQL).
- `C-15` — honored by: 22 `@AC-*` scenarios, every FR covered (FR-1: 1,2,3,13,15,17,18; FR-2: 2,4; FR-3: 5; FR-4: 12; FR-5: 6; FR-6: 7,8,13,14,16,18,21; FR-7: 9,10,19,20,22; FR-8: 11).
- `C-16` — honored by: see below; `C-18` — honored by: the least mechanism (one wrapper per runtime, no shared module, no new tooling).
- `F-01..F-11` — honored; no Floor breach was raised in any of three rounds.

## Business Rules Touched (C-16)

- CHANGE `@AC-41 @FR-15 @feature-294` (`docs/sdd/business-rules/platform.feature:1341`), `@AC-36 @FR-11 @feature-294` (`services/xstockstrat-ui/acceptance/signal-map-instrumentation.feature:29`), `@AC-51 @FR-5 @feature-294` (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature:36`) — the exported datapoint additionally carries `host.provider`; signed off by user @ 2026-11-12 (`context.md` round-1 gate, placement per D-17: read-as comments plus new scenario `@AC-18`, no text edit).
- EXTEND `@AC-10 @FR-5 @feature-332` (`platform.feature:2325`) and `@AC-12 @FR-7 @feature-332` (`:2337`) — second guarded block, pre-aggregated join, label query preferred (`@AC-9`, `@AC-19`, `@AC-20`).
- PRESERVE `@AC-11 @feature-332`, `@AC-1..5,13,19,21,22,23 @feature-332`, `@AC-56`, `@AC-42`, `@AC-43 @feature-294`, the `@feature-274`, `@feature-250` and `@feature-171` regression scenarios — not regressed because the wrapper leaves instruments, views, resource attributes, transport and startup behavior untouched and is inert when `OTEL_ENABLED=false`.
