# Context Log: proto-deprecated-field-removal-program

## 2026-09-19 — routed from today's triage (NOT implemented)

Defect 2 of `docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md` (the 33
`[deprecated = true]` proto fields) was **explicitly kept out** of the today's-triage bug PR and
routed here as a `draft` SDD story, with operator sign-off on scope.

**Why it is a program, not a today-fix:**
- Every removal trips `buf breaking` by design and needs the v-migration workflow.
- Approval is **2 owners + platform lead** per breaking proto change — a harness bug-fix session
  cannot supply the human approvers.
- The report's inventory is a *candidate* list, not verified-dead: `portfolio.proto:235 symbols` has
  a live reader (`live_loop.py:525`) and staging returns it populated — proof that per-field reader
  audits are mandatory.
- The enum-value cohort has stored numeric values → needs a data audit before anything is touched.

Count re-verified against `main-dev`: `grep -rn 'deprecated = true' packages/proto/*/v1/*.proto` → 33.

**Next:** `/sdd-design` to grill sequencing (safest cohort = the 12 already-ignored `user_id` body
fields), confirm BSR/external-consumer exposure, then `/sdd-spec`. No code was written for this
feature in the today's-triage session.

## Session 2026-09-19 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Verdict: **PASS WITH WARNINGS** (no blockers, no Floor breach).
- Criteria pass (spec-reviewer): inventory count (33) and constraints code-verified; warnings were formal-section gaps + 2 grounded citation errors.
- Fixes applied before advancing:
  - `live_loop.py:493` → `:525` (reader line shifted by feature 193's R2 edit; verified `_drain_watchlist` `wl.symbols` fallback) — product-spec.md, feature.md, context.md.
  - approval citation `docs/runbooks/approval-flow.md` (order approval) → root CLAUDE.md § Approval Flow + `docs/runbooks/proto-versioning.md` — product-spec.md, feature.md.
  - Added `## Consumer Surface(s)` (None — internal/platform-only, C-14), `## Out of Scope`, `## Open Questions` (BSR/external-consumer exposure) to product-spec.md.
  - Added `@AC-4` (enum-value reservation) to acceptance.feature — closes the constraint-2 enum-reservation coverage gap.
- Deferred to /sdd-design (per reviewer): no numbered `## Functional Requirements` / `@FR-N` tags (program has no FR-N; the numbered Hard constraints serve the role) — expand at design/spec.
- Overlap findings: NO FAIL-level collision. Only a rebase-only textual overlap with feature 032 (walk-forward-backtesting) on `analysis.proto` — region-disjoint (032 adds a new `RunSegmentedBacktest` message; 196 removes `ListStrategiesRequest.user_id`), different message, no field-number clash. Both `draft`. Re-run overlap at /sdd-spec (Mode B); no merge-order row required now.
