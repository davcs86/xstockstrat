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
  a live reader (`live_loop.py:493`) and staging returns it populated — proof that per-field reader
  audits are mandatory.
- The enum-value cohort has stored numeric values → needs a data audit before anything is touched.

Count re-verified against `main-dev`: `grep -rn 'deprecated = true' packages/proto/*/v1/*.proto` → 33.

**Next:** `/sdd-design` to grill sequencing (safest cohort = the 12 already-ignored `user_id` body
fields), confirm BSR/external-consumer exposure, then `/sdd-spec`. No code was written for this
feature in the today's-triage session.
