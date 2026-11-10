# Context Log: fix-telemetry-startup-log

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-telemetry-startup-log-raw-endpoint-defect.md — Telemetry startup log prints the raw OTLP endpoint env var (SEV-3)
- Cluster rationale: single-report feature — one stale log pattern repeated across the Node and Python telemetry modules.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-2), context.md; stamped the report sidecar `triaged`
- Affected services (from report): config, identity, ledger, notify, ui, analysis, indicators, ingest, agent
- Root cause hypothesis: log line kept the pre-226 `endpoint` variable after the exporter stopped taking it
- Recommended design depth: full → `/sdd-design fix-telemetry-startup-log` (rationale: SEV-3 and mechanical, but 9 affected services — rubric escalate signal ≥2 services)
- Development branch: feature/fix-telemetry-startup-log
