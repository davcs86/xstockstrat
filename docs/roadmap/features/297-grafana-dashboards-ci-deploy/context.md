# Context: grafana-dashboards-ci-deploy

**Feature**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/feature.md`
**Product Spec**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/297-grafana-dashboards-ci-deploy/implementation-spec.md`

---

## Session 2026-11-05 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from a request to distil PR 653 and compare it with the current code.
- Number `297` reserved with `scripts/sdd-allocate-feature-number.sh` (cursor was at 296). The `/sdd-story` skill text still says local `max+1`; `docs/runbooks/feature-workflow.md` § Feature Numbering (reserved, fail-closed) governs. Skill text is stale — candidate doc fix, not changed here.
- Source: PR 653 `claude/grafana-mcp-availability-tyzn1w` @ `b2ec808`, base `main`, open, `mergeable_state: dirty`, 9 files +346/−2. Read via the GitHub MCP file patches; the head branch itself was not checked out.
- Compared against `main-dev` @ `b371a3e` after `git pull`: none of the PR's files exist there. `packages/otel/dashboards/` now has 5 dashboards (PR assumed the 033 set) and `service-health.json` declares `DS_TEMPO` (6 refs) which the PR's script does not substitute.
- Verified by reading: dashboards' `__inputs`, `uid`s and `${DS_*}` counts; guard `scripts/check-otel-produced-signals.sh` scope (reads `dashboards/*.json`, doc Part 3); checkout pin convention (`actions/checkout@3d3c42e5…  # v7.0.1`); SOPS model (feature 286, launched 2026-11-04); `.mcp.json` now has 7 DigitalOcean http servers.
- NOT verified (flagged in Open Questions): real Grafana Cloud `/api/datasources` composition (G2/Q5), whether an unresolved `${DS_TEMPO}` renders (G1), whether dev and prod share one stack (Q1), whether the Editor-role token can create folders in the target org.
- Decisions deferred to the operator: Q1, Q2, Q3 (blocking); Q4–Q8 (non-blocking).
- Not committed or pushed: artifacts are in the working tree on branch `feature/grafana-dashboards-ci-deploy`.
