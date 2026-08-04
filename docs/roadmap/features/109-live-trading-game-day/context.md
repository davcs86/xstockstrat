# Context: live-trading-game-day

**Feature**: `docs/roadmap/features/109-live-trading-game-day/feature.md`
**Product Spec**: `docs/roadmap/features/109-live-trading-game-day/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/109-live-trading-game-day/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P2 item 12 ("emergency operations runbook and game day").
- Hard-depends on 103 (broker-failure-simulator) for fault injection, and is most useful once
  100/102/030 exist (there is little to halt/reconcile/protect during a rehearsal otherwise). Correctly
  last in the source review's suggested execution order ("Complete operational workflow").

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- Its fault-injection dependency (103) is demoted, and a **quarterly, scheduled** game day assumes an
  on-call rotation / multiple operators — this repo has a single maintainer (confirmed via `git log`
  author list: one human author plus dependabot/CI bots, no `CODEOWNERS`). A recurring ceremony sized
  for a team doesn't fit.
- Demoted to `demoted/canceled` as a formal SDD feature. The genuinely valuable, cheap core — written
  runbooks for the listed failure scenarios, walked through manually before any live-capital increase
  — doesn't need a feature number; it can be added directly to `docs/runbooks/` once 100/030 land,
  sized as a one-person checklist rather than a scheduled program.
