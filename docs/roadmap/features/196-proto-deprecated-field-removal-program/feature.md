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
| 2026-09-19 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS, no blockers/Floor breach). Fixed 2 grounded citations (live_loop.py:493→:525; approval-flow.md→proto-versioning.md + root CLAUDE.md §Approval Flow), added Out of Scope / Consumer Surface / Open Questions sections, added @AC-4 (enum-value reservation). Overlap: rebase-only textual overlap with 032 on analysis.proto (region-disjoint, re-check at /sdd-spec Mode B). |
| 2026-09-19 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. User steered at the R2 gate to **response-edge omission** (keep proto fields, stop populating in responses — feature-194 pattern), sidestepping PROTO-2/buf-breaking/v2/BSR. Per-field: KEEP Watchlist.symbols, EXCLUDE Bar.timeframe@barFromAlpaca (DB-write coupling → store corruption), GATED Bar.timeframe@scanBars/stream + BackfillJob.timeframe (external-consumer confirmation), no-op request-only cohort, enum values out of scope. **Steps GATED** — non-executable this session (external BSR-consumer proof required); no Floor breach. |

---

## Artifacts

- [Product Spec](product-spec.md) — the removal program, its constraints, and the governance gates
- [Recon](recon.md) — grounded reader audit (verified-dead vs live) + proto/buf/BSR governance facts
- [Design](design.md) — the chosen response-edge-omission approach, per-field verdicts, rejected alternatives, gated steps
- [Acceptance Scenarios](acceptance.feature) — old-client safety + reserved-numbering guards
- [Context Log](context.md) — why this is a program, not a today-fix

---

## Summary

`grep -rn 'deprecated = true' packages/proto/*/v1/*.proto` returns **33** fields across 8 of the 11
protos. Removing them is a breaking-change program, not a cleanup PR: `buf breaking` rejects each by
design; removed field numbers and enum values must be `reserved`; the enum-value cohort
(`TIMEFRAME_*`, `ENVIRONMENT_DEV`, `VALUE_TYPE_FLOAT_MAP`) has stored numeric values needing a data
audit; and at least one "candidate" (`portfolio.proto:235 repeated string symbols`) is **NOT dead** —
it has a live reader (`live_loop.py:525` legacy-row fallback) and staging returns it populated.

## Why not fixed in the today's-triage PR

Requires **2 owners + platform lead** approval per breaking proto change
(root `CLAUDE.md` § Approval Flow; `docs/runbooks/proto-versioning.md` — not the order-approval
`docs/runbooks/approval-flow.md`), a per-field reader verification (the
report's list is a *candidate* list, not verified-dead), and an enum data audit — none of which a
harness bug-fix session can satisfy. The report author themselves flagged it as belonging in
`/sdd-story`. Filed here as a scoped, approval-bearing program.

## Next Action

**Design-approved with GATED steps.** `/sdd-spec proto-deprecated-field-removal-program` should encode
the response-edge omissions as **gated** steps (non-executable until the per-field consumer-confirmation
gate in `design.md` clears: every named consumer reads `timeframe_enum` not the string + the BSR
deprecation window is formally closed + sign-off in `context.md`). Until that external gate can be
substantiated, hold at `design-approved` — the safe-to-ship-now scope is empty (see design.md Open
Risks).
