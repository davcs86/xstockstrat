# Context Log: fix-migration-tooling-safety

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md (SEV-2)
  - docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md (SEV-3)
- Cluster rationale: both are golang-migrate version-tracking hazards in the shared migrator tooling
  (`scripts/db-migrate.sh` + CI) where a persistent DB's stored version diverges from what a fresh DB proves.
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): platform tooling; migration dirs of indicators, ingest, identity, config,
  portfolio, analysis (and all `services/*/migrations` for ordering)
- Root cause hypothesis: `force 0` recovery assumes idempotent up-files (partially guarded by feature 225's contract
  floor); forward-only migrator + pre-reserved numbers + no CI ordering gate.
- Recommended design depth: full → `/sdd-design fix-migration-tooling-safety` (rationale: SEV-2, migration-tooling / schema-adjacent, spans
  every service's migration dir)
- Development branch: feature/fix-migration-tooling-safety
