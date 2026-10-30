# Context: smoke-check-runtime

**Feature**: `docs/roadmap/features/280-smoke-check-runtime/feature.md`
**Product Spec**: `docs/roadmap/features/280-smoke-check-runtime/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/280-smoke-check-runtime/implementation-spec.md`

---

## Session 2026-10-30T03:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the approved
  brainstorm design (`docs/superpowers/specs/2026-10-29-staging-smoke-checks-design.md`), the
  verification-needs report and the draft plan (`docs/superpowers/plans/2026-10-29-staging-smoke-checks.md`).
- Operator constraint: stay on `claude/smoke-test-deployment-0f1z5j` (PR #1359 into `main-dev`); no
  `feature/` or `feature-steps/` branches. The SDD branch model is overridden for this feature.
- Settled by the operator before this session: staging-only service with a header-key HTTP API; catalog of
  named checks (no ad-hoc SQL); run-once with tracked failures; results as committed files on
  `smoke-results` written by a PAT on the DO job; homelab + DO dev; no `doctl`; phase 1 read RPCs, phase 2
  scoped writes right after; no system or admin identity.
- Known traps carried from the ledger are listed under Open Questions in the product spec.

## Session 2026-10-30T03:40:00Z — sdd-review product-spec

- First pass FAIL (criterion 9: nine unchecked Open Questions) plus warnings; overlap scan found feature
  264 already holds config migration `034`. Spec and scenarios revised; migrations now take the next two
  free numbers (`035`/`036` at the time of writing); AC-3/5/12/13/14/15/20/23 reworded or split, AC-25..32
  added; SMOKE_ENDPOINT is `host:port`; env labels `homelab-staging`/`do-dev` (config rows stay
  `staging`/`production`).
- Second pass: PASS WITH WARNINGS (0 blockers). Status: draft → spec-ready.
- Warnings carried forward: AC-10/20/27/28 "no gRPC channel was opened" needs a mocked channel-factory
  seam defined at `/sdd-spec`; confirm the single-branch (no step PRs) flow at `/sdd-design`; re-verify
  `035`/`036` at implementation time and on rebase.
- Overlap findings (warn-level, no FAIL): ordering dependency on 264's `034`; file-level overlaps on
  `ci.yml` (251, 266, 278), `.do/app.dev.yaml` (266), `agent/app/tools.py` (215, 249), and proto files
  (215, 242, 249, 256). No merge-order row written (no FAIL-level overlap; `merge-order.md` is shared and
  needs operator confirmation) — proposed row: `smoke-check-runtime (280) | fix-portfolio-snapshot-surface
  (264) | config migration ordering: 280 takes 035/036, after 264's 034 | No`.
- No demoted-feature duplicate (checked 22 demoted/canceled features).
