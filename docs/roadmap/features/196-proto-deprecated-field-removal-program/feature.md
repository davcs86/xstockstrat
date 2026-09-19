# Feature: proto-deprecated-field-removal-program

**Type**: tech-debt (breaking-change program — governance-gated; NOT a bug fix)
**Development Branch**: _unassigned_ (design-only draft; when implemented, `feature/<slug>` per SDD)
**Defect Report**: `docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md` (Defect 2)
**Severity**: SEV-3 (planned tech-debt; no runtime misbehavior)
**Created**: 2026-09-19
**Last Updated**: 2026-09-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-19 | `draft` | triage (from-report, /sdd-story routing) | Routed here from today's RPC-contract-hygiene report (Defect 2). Explicitly NOT implemented in the today's-triage bug PR: this is a governance-gated breaking-change program (2 owners + platform lead per proto change), needs a per-field reader audit, `reserved` numbering, and a data audit for the enum-value cohort. Left at `draft` for the SDD pipeline (`/sdd-design` → `/sdd-spec` → `/sdd-execute`) to pick up under proper approvals. |

---

## Artifacts

- [Product Spec](product-spec.md) — the removal program, its constraints, and the governance gates
- [Acceptance Scenarios](acceptance.feature) — old-client safety + reserved-numbering guards
- [Context Log](context.md) — why this is a program, not a today-fix

---

## Summary

`grep -rn 'deprecated = true' packages/proto/*/v1/*.proto` returns **33** fields across 8 of the 11
protos. Removing them is a breaking-change program, not a cleanup PR: `buf breaking` rejects each by
design; removed field numbers and enum values must be `reserved`; the enum-value cohort
(`TIMEFRAME_*`, `ENVIRONMENT_DEV`, `VALUE_TYPE_FLOAT_MAP`) has stored numeric values needing a data
audit; and at least one "candidate" (`portfolio.proto:235 repeated string symbols`) is **NOT dead** —
it has a live reader (`live_loop.py:493` legacy-row fallback) and staging returns it populated.

## Why not fixed in the today's-triage PR

Requires **2 owners + platform lead** approval per breaking proto change
(`docs/runbooks/approval-flow.md` / `proto-versioning.md`), a per-field reader verification (the
report's list is a *candidate* list, not verified-dead), and an enum data audit — none of which a
harness bug-fix session can satisfy. The report author themselves flagged it as belonging in
`/sdd-story`. Filed here as a scoped, approval-bearing program.

## Next Action

`/sdd-design proto-deprecated-field-removal-program` — grill the sequencing (safest cohort first: the
12 already-ignored `user_id` body fields; enum-value cohort likely stays deprecated indefinitely),
confirm BSR/external-consumer exposure, then `/sdd-spec`.
