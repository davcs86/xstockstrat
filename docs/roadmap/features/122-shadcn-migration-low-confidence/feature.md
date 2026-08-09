# Feature: shadcn-migration-low-confidence

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/shadcn-migration-low-confidence`
**Created**: 2026-08-08
**Last Updated**: 2026-08-09

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings fixed in place) |
| 2026-08-08 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved **provisionally** (no `AskUserQuestion`/`Task` tool available this session — see design.md's Open Risks); recon.md + design.md written |
| 2026-08-08 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |
| 2026-08-08 | `implementation-ready` (spec revised, no lifecycle change) | session (post-design.md Round 3) | implementation-spec.md's FR-2/FR-3/FR-4 steps rewritten to match design.md's Round 3 user-directed override (migrate all three call sites onto `ui/field.tsx`, not `ui/form.tsx`) — step count 3 → 8; design.md/recon.md unchanged (already final). **P-04 note**: this `implementation-ready` status now rests on a live-gated design for FR-2/FR-3/FR-4 (Round 3) — the row above (`design-approved → implementation-ready`) was stamped while that design was still provisional; Round 3 retroactively firms up the basis for these steps. FR-1's decline call remains a self-run Round 1/2 synthesis, never live-gated. |
| 2026-08-09 | `implementation-ready` (design + specs amended, no lifecycle change) | session (design.md Round 4 override) | **FR-1's decline is overturned.** The user was asked directly and directed migrating both `OrderForm.tsx`/`EditOrderDialog.tsx` call sites onto `Alert`, once sibling `120-shadcn-migration-high-confidence` ships `ui/alert.tsx` (`ui/alert.tsx` does not exist on `main-dev` yet — `120` is `implementation-ready`, not `code-completed`/`launched`). `design.md` gained a `## Round 4 — user-directed override` section and updated Chosen Approach/Rejected Alternatives/Open Risks/Constitution sections; `product-spec.md`'s FR-1 text was corrected to state the migrate decision and the `120` dependency; `implementation-spec.md`'s header/Execution Summary/Step Dependencies/Step 1/Step 8 were updated to document the tranche split (FR-1 deliberately unspecced pending `120`, mirroring sibling `121`'s own Tranche-2 pattern for its FR-4–FR-9) — **step count stays 8, no new code steps added**, since FR-1's concrete steps cannot be written yet (Constitution F-04). **P-04 note**: FR-1 now has a live user gate (Round 4) — the last of this feature's four FRs to get one (FR-2/FR-3/FR-4 got theirs in Round 3). Recommended (not written this session, per task constraint): a `120` ↔ `122` blocking-dependency row in `docs/roadmap/features/merge-order.md`, alongside the existing `120` ↔ `121` row. |
| 2026-08-09 | `implementation-ready` → `in-progress` | /sdd-execute sequential | User directed re-specing and executing FR-1 in this same pass (mirroring sibling `121`'s Tranche 2 pattern) — this feature's branch is stacked on `121`'s (itself stacked on `120`'s), and `ui/alert.tsx` is confirmed present. Added `implementation-spec.md` Steps 9-12 (FR-1 migration + e2e regression + build-only note + whole-feature gate), step count 8 → 12; `product-spec.md`'s FR-1/Affected Services/Open Questions updated to record "unblocked." `design.md` unchanged (§ Round 4 already recorded the migrate decision). Execution begins against all 12 steps. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (chosen approach, rejected alternatives, open risks)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Evaluate the 4 low-confidence occurrences the shadcn/ui gap audit found — two one-line inline
success/error messages loosely shaped like `Alert`, and two manually-wired forms loosely shaped like
shadcn's `Form` (react-hook-form + zod) recipe — and migrate only where doing so doesn't add
disproportionate weight (new dependencies, more code) for what each call site actually needs.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-execute shadcn-migration-low-confidence` for Steps 1–12 (FR-1/FR-2/FR-3/FR-4, all specced —
FR-1 unblocked 2026-08-09, see Status History).
