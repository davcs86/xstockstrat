# Context Log: fix-replace-tif-before-intent

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-16 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md` (Issues disabled; `--from-report`). Sidecar stamped `triaged` / `ref: feature:349-fix-replace-tif-before-intent`.
- Severity: SEV-3, environment dev, not config-fixable → Track C.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md.
- Affected services: xstockstrat-trading.
- Root cause: confirmed by reading `ReplaceOrder` on `main-dev@f61f76c` (`InsertIntent` ≈ `trading.go:1569`, PENDING mark ≈ 1604, `validateTIF` ≈ 1614). The report's line numbers predate feature 347 and are stale.
- Design depth: the rubric (`docs/sdd/design-depth-rubric.md`) gives `skip` for this bug; the operator chose `quick` in the task handover → `/sdd-design fix-replace-tif-before-intent quick`.
- Operator decisions carried in the task handover (2026-11-16): design `quick`; execute `sequential` (mode entry confirmed); single integration PR `feature/fix-replace-tif-before-intent` → `main-dev`; C-16 promotion approved in advance for durable-guarantee scenarios; do not merge; do not use `ReleasePendingIntent` for this fix (TRADING-8).
- Assumptions made by this session:
  - Slug `fix-replace-tif-before-intent` instead of the literal first-three-title-words form (`fix-replaceorder-validates-timeinforce`); basis: prior bug features use descriptive slugs (328–346).
  - Already-stranded rows in a deployed database are out of scope; basis: the task forbids changes to intent-table semantics and the report asks only for the ordering fix.
- Development branch: feature/fix-replace-tif-before-intent

## Session 2026-11-16 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: `feature/fix-replace-tif-before-intent` == origin, `main-dev@f61f76c` merged.
- A1b: not a re-attempt of any demoted feature (session's own judgement — none of the 22 concerns replace or time-in-force).
- Warnings (all addressed in the spec in this session): no `## Consumer Surface(s)` section (C-14) → added; broker / trading-mode / fill-status scope not stated → `## Scope Notes` added; "no reclaim event" not asserted → added to @AC-1. The rate-limited replace path (FR-2) stays covered by the existing 347 test, not a new scenario.
- Overlap findings: WARN only — same function as 347 (`prevIntent` capture and the `ErrRateLimited` branch in `ReplaceOrder`), already on `main-dev`; keep both intact. No config/proto/migration overlap; no merge-order entry needed.
- Recommended design depth: quick (single service, no proto, no migration, no FAIL/warning-level blocking overlap).
