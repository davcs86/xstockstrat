# Feature: fix-blend-queue-fundamentals-universe

**Type**: bug
**Development Branch**: `claude/todays-bug-triage-ubv9ag` (harness-assigned; PR targets `main-dev`)
**Defect Report**: `docs/reports/2026-09-18-opportunity-queue-ignores-fundamentals-universe-defect.md` (GitHub Issues disabled — report is the audit trail)
**Severity**: SEV-3
**Created**: 2026-09-19
**Last Updated**: 2026-09-19
**Committed to main**: dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3
**Launched date**: 2026-09-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-19 | `bug-reported` → `draft` | triage (manual, from-report) | One of three defects reported today; routed to Track C (SEV-3, code change, dev/shipped). |
| 2026-09-19 | `draft` → `code-completed` | bug-fix session | Approach A (hoist) chosen with operator sign-off; implemented, tested (5 tests), lint clean. Shipped in the consolidated today's-triage PR (single branch, no per-step PRs — task git model). |

| 2026-09-24 | `code-completed` → `launched` | CI workflow | Promoted via PR #1169; committed dd622bdc2e5b922df8dcabc6f7475b8b395a8ed3 |
---

## Artifacts

- [Product Spec](product-spec.md) — points at the defect report (the detailed root-cause analysis)
- [Acceptance Scenarios](acceptance.feature) — the queue-surface regression scenario the report flagged as the missing C-15 coverage
- [Context Log](context.md) — decisions, the Approach-A choice, and the surfaced doc/code discrepancy

---

## Summary

Feature 168's fundamentals-universe restriction lived in exactly one place —
`live_loop._run_cycle`'s inline blend branch. The opportunity queue (`_compute_opportunities`) and
the boot entry-backfill both call the shared `resolve_universe` with **no** blend branch, so the
blend strategy (`fundamentals_macd_blend`) was attributed on the Decide surface to symbols outside
the fundamentals universe (Form-4/8-K/PR signals, held positions, watchlist), and `signal_eligible:
true` handed the queue the platform-wide cross-user signal pool — precisely inverted from the
feature's "and nowhere else" intent. The live evaluation loop itself was already correct, so nothing
mis-fired automatically.

## Fix (Approach A — hoist)

Threaded `blend_id` + `fundamentals_universe` through `resolve_universe` so all three callers inherit
the restriction from one seam; extracted the fundamentals-universe resolver
(`resolve_fundamentals_universe`) to a shared module-level function so the loop, the queue, and the
entry-backfill resolve the identical set. `signal_eligible` is now inert for the blend on every
caller by construction. The live loop's behavior is preserved byte-for-byte.

## Next Action

Ships in the consolidated today's-triage PR to `main-dev`. Promote via the next `/promote` cycle.
