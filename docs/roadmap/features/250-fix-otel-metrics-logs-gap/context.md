# Context Log: fix-otel-metrics-logs-gap

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md` (Issues
  disabled). Source: `docs/context-constitution-findings.md` § Documentation that lies row 2;
  `packages/otel/docs/context-constitution-findings.md` § Open questions; `packages/otel/docs/context-constitution.md` OTEL-2.
- Severity: SEV-2. Impact type: silent-telemetry-loss. Environment: dev (main-dev) @ 1302e6d. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services (from report): all 12 runtimes; packages/otel.
- Root cause hypothesis: feature 226 settled traces-only; alerts/dashboards/setup docs predate it and were never
  reconciled.
- Confirmation evidence (report, confidence high): repo-wide `rg` for meter/logger providers and metric exporters
  under `services/` → no matches; UI `src/telemetry.ts:31-32` passes empty `metricReaders`/`logRecordProcessors`;
  `alert-rules.yaml:44-45`, `:88` query `rpc_server_duration_milliseconds_*`; Grafana query for that metric → no series.
  Triage grep: 10 dashboard references to the same series across `packages/otel/dashboards/*.json`.
- **Prior decision to honour:** feature 226 (`docs/roadmap/features/226-fix-otel-trace-export/`, launched) recorded
  Operator Decision 3 — "Scope: traces only — metrics/logs pipelines are out of scope (new capability →
  `/sdd-story`)" (`product-spec.md:64`); its design kept the empty UI arrays deliberately so sdk-node 0.218 does not
  auto-start env-default metrics/logs pipelines (`design.md:22`) and kept the collector `:4317` receiver for the
  metrics/logs pipelines + telemetrygen (`design.md:24`, `:38`).
- **Two possible fixes (operator fork, decide at design):**
  - (a) Narrow the alert rules, dashboards and docs to traces (or document a Grafana-side span-metrics path that
    produces the RPC series from traces). Consistent with 226's decision; a bug fix — stays in this Track C feature.
  - (b) Add OTLP metric (RPC server histogram) and log export to the runtimes. New capability across 12 runtimes;
    reverses 226 Operator Decision 3 and needs `/sdd-story` per C-11 (operator sign-off recorded in a feature's
    `context.md`). If chosen, this feature should close as superseded by that story or narrow to the docs interim.
- acceptance.feature is written neutral between (a) and (b): the invariant is "no alert or dashboard depends on a
  series that nothing produces" plus docs-match-reality.
- Recommended design depth: full → `/sdd-design fix-otel-metrics-logs-gap` (rationale: SEV-2; affected services ≥ 2
  (12 runtimes + packages/otel); the (a)/(b) fork is a scope decision touching a prior operator decision).
- Development branch: feature/fix-otel-metrics-logs-gap
