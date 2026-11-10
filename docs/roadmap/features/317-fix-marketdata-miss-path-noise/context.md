# Context Log: fix-marketdata-miss-path-noise

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md (SEV-3, confidence low)
  - docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md (SEV-3, confidence low)
- Cluster rationale: both are repeated WARN noise in marketdata's `GetBars`/ingest paths (and portfolio's matching
  cancel sites) left over by features 290/282, fixed with the same log-once / don't-log-on-cancel pattern.
- Severity: SEV-3 (highest of cluster)
- Routed to SDD path (Track C). Both reports asked for a Loki re-check after 290 / 282 land; both are now launched —
  the re-check is Open Question 1.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): xstockstrat-marketdata, xstockstrat-portfolio
- Root cause hypothesis: per-item failures logged without consulting ctx; no negative cache on the GetBars miss path.
  Warm-poller site now logs at Debug (marketdata_service.go:1239,1263) — may already be resolved.
- Recommended design depth: full → `/sdd-design fix-marketdata-miss-path-noise` (rationale: 2 affected services escalate per rubric; low
  confidence / unverified flood per site)
- Development branch: feature/fix-marketdata-miss-path-noise
