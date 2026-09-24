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
| 2026-09-19 | `design-approved` (unchanged) | /sdd-review | Re-ran product-spec review (operator request). Overlap CLEAN. Criteria FAIL (spec framed removal, contradicting the approved omission design; @AC-1/@AC-4 asserted rejected behavior; no @FR-N). **Reconciled:** rewrote product-spec to the omission approach, added FR-1..FR-6, annotated @AC-1/@AC-4 out-of-scope + added @AC-5..@AC-9 with @FR tags. Ready for /sdd-spec. |
| 2026-09-19 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps, all `blocked` on the FR-3 consumer-confirmation gate (Step 1). Encodes the response-edge omissions as gated steps per design.md: marketdata Bar.timeframe @ scanBars/stream (Steps 2-3), ingest BackfillJob.timeframe @ job_row_to_proto (Steps 4-5), KEEP guard for Watchlist.symbols (Step 6), proto-integrity/enum-retention/request-only no-op verification (Step 7). Zero-ship if the gate never clears (accepted park-equivalent). All @AC-2/3/5/6/7/8/9 covered; @AC-1/@AC-4 out-of-scope by design. |

---

## Artifacts

- [Product Spec](product-spec.md) — the removal program, its constraints, and the governance gates
- [Recon](recon.md) — grounded reader audit (verified-dead vs live) + proto/buf/BSR governance facts
- [Design](design.md) — the chosen response-edge-omission approach, per-field verdicts, rejected alternatives, gated steps
- [Acceptance Scenarios](acceptance.feature) — old-client safety + reserved-numbering guards
- [Implementation Spec](implementation-spec.md) — 7 gated steps (blocked on the FR-3 consumer-confirmation gate)
- [Context Log](context.md) — why this is a program, not a today-fix

---

## Reviewers

Snapshot written by `/sdd-spec` from `docs/runbooks/reviewer-registry.md` (distinct across all steps).
Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus |
|---|---|
| Proto Reviewer | Deprecation-window closure + BSR publication readiness; no field/enum removal, no `reserved`, `buf breaking` clean |
| Platform Lead | External/BSR-consumer risk sign-off on the FR-3 gate |
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB partitioning, Alpaca feed idempotency (Bar.timeframe edges) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion (BackfillJob.timeframe edge) |
| `xstockstrat-portfolio` owner | Position snapshot consistency (Watchlist.symbols KEEP guard) |

---

## Summary

`grep -rn 'deprecated = true' packages/proto/*/v1/*.proto` returns **33** fields across 8 of the 11
protos. The design debate rejected in-place *removal* (it violates the proto module's **PROTO-2**
deprecate-don't-delete/no-`reserved` invariant, has no documented procedure, and the module is
BSR-published with external consumers) in favour of **response-edge omission**: keep every
`[deprecated = true]` field in the `.proto` and stop *populating* the genuinely-dead ones in responses
(the feature-194 read-edge pattern). Only ~12 of 33 are even dead; most are live or wire-load-bearing
(e.g. `portfolio.proto:235 symbols`, `live_loop.py:525`), and the omittable set is the two `Bar.timeframe`
response edges + `BackfillJob.timeframe`, all gated on external-consumer confirmation.

## Why nothing ships in this session

No `.proto` change → **no** breaking-change / 2-owner-+-platform-lead approval (that gate applied only
to the rejected removal approach). Instead every omission is blocked on the **FR-3 per-field
consumer-confirmation gate** (design.md / implementation-spec.md Step 1): the module is BSR-published
and external consumers cannot be enumerated, so proving no external/named-in-repo consumer still reads
the deprecated timeframe string is a prerequisite a harness session cannot satisfy. If the gate never
clears the shipped outcome is zero code change — park-equivalent, accepted in `design.md` Open Risks
(PROTO-2 already prevents number reuse).

## Next Action

`/sdd-review proto-deprecated-field-removal-program impl-spec` — validate the implementation spec, then
`/sdd-execute proto-deprecated-field-removal-program`. **Note:** all 7 steps are `blocked` on Step 1
(the FR-3 consumer-confirmation gate), which cannot clear inside a harness session — external BSR
consumers cannot be enumerated. `/sdd-execute` will hold at Step 1 until every named consumer is
grep-confirmed reading `timeframe_enum`, the BSR deprecation window is formally closed, and sign-off is
recorded in `context.md`. If the gate never clears, the shipped outcome is zero code change
(park-equivalent, accepted in `design.md` Open Risks).
