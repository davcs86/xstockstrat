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

## Session 2026-07-31 — sdd-review product-spec

- Criteria pass (`spec-reviewer`): **PASS WITH WARNINGS**. No Floor (`F-*`) breach, no blocker.
  Two findings were factual errors in the spec and were corrected in this session:
  - FR-1/Affected Services/AC-1 claimed **13** application services; root `CLAUDE.md` § Service
    Registry, `docker-compose.yml`, and `.do/app.dev.yaml` all list **12**. Fixed throughout
    `product-spec.md`.
  - FR-5 named the secret env var `ALPACA_SECRET`; the actual key in `.do/app.dev.yaml:129-132`
    is `ALPACA_API_SECRET`. Fixed.
  - Also added a one-line provider-agnostic clarification to FR-5 (C-2 trading-domain check):
    the secrets-provisioning mechanism change affects only how broker credentials reach the
    runtime, not order-execution/broker-integration logic, and isn't Alpaca-specific.
  - Remaining warnings left as-is (correctly scoped `/sdd-design` deferrals, not spec defects):
    AC-2's downtime threshold is intentionally unquantified pending design; the 5 Open Questions
    items are legitimate design-phase decisions; FR-8's doc-update list may be incomplete
    (`docs/patterns/observability.md` flagged as a possible missed surface) — carried forward as
    an explicit item for `/sdd-design` to close, not assumed resolved by this spec.
- Overlap pass (`feature-overlap`): **CLEAN**. No FAIL-level collision (config key / proto field /
  migration number) with any in-flight feature. `docker-compose.yml` and `.do/app.dev.yaml` touches
  from features 033 (observability) and 076 (FMP secret env) are already merged to trunk — 083
  builds on top of them, not racing them. One design tension flagged for `/sdd-design` (not a
  merge-order collision): feature 033 wires per-service OTel env vars into `.do/app.dev.yaml`,
  which 083 retires as the dev deploy target — dev-side OTel env provisioning needs to move to the
  droplet's `docker-compose.yml`/secrets mechanism.
- Outcome: **PASS**. Status: `draft` → `spec-ready`.
- Next step: `/sdd-design droplet-compose-deploy` (full mode).
