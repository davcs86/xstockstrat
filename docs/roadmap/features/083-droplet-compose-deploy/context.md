# Context: droplet-compose-deploy

**Feature**: `docs/roadmap/features/083-droplet-compose-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/083-droplet-compose-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/083-droplet-compose-deploy/implementation-spec.md`

---

## Session 2026-07-31 — sdd-story

- Preceded by an ad hoc pros/tradeoffs analysis of DO App Platform vs. a DO Droplet + Docker
  Compose, done in plan mode before this feature was formalized. That analysis (not itself an SDD
  artifact) grounded the following user decisions, carried into this feature's scope:
  - **Database**: keep DO Managed Postgres — do not self-host TimescaleDB on the droplet.
  - **Scope**: dev/staging only for now — production stays on DO App Platform.
  - **Downtime tolerance**: near-zero-downtime deploys must be preserved, which is why the design
    direction (Caddy blue/green, not a bare `docker compose up -d`) was carried into FR-2 rather
    than left as an open question.
- Created feature.md (status: `draft`), product-spec.md, context.md from the user story above.
- Reviewers snapshotted from `docs/runbooks/reviewer-registry.md`: Platform Lead (cross-service
  architecture — closest match for a deployment-topology change) and Security (secrets handling,
  since FR-5 introduces a new droplet-side secrets story with no registry-listed owner service).
- Checked `docs/roadmap/ledger/fails.md` and `insights.md` for a directly relevant known trap —
  none found specifically about CI/CD or deploy-topology changes. Flagged the general C-10
  "shared surface must move together" pattern as the closest applicable lesson in the product
  spec's Open Questions, since this feature touches several documentation surfaces that must all
  update in step.
- Next step: `/sdd-review droplet-compose-deploy product-spec`, then `/sdd-design
  droplet-compose-deploy` (full mode recommended given the cross-cutting infra scope, not `quick`).
