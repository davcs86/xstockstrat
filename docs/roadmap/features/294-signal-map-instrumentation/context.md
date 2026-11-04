# Context: signal-map-instrumentation

**Feature**: `docs/roadmap/features/294-signal-map-instrumentation/feature.md`
**Product Spec**: `docs/roadmap/features/294-signal-map-instrumentation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/294-signal-map-instrumentation/implementation-spec.md`

---

## Session 2026-11-04 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number `294` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh` (cursor ref `sdd/feature-cursor`).
- Source of truth for evidence: `docs/repo-surveyor/signal-map-findings.md` (PR #1427, commit `da6ca69`). Line numbers in it are as of that commit; the implementation spec must re-ground them.
- **Operator decisions (2026-11-04)**, taken via an up-front question gate before this story: scope = everything, SEV-2 first; signals only (no behavior change); instrument only (no alerts, dashboards or registry rows); delivery = `/sdd-execute sequential`, one integration PR. The operator also stated that these are not bugs and must be worked as a single effort, so this feature is on the SDD path and not on `docs/runbooks/bug-triage.md`.
- Ledger read (`fails.md`): `033-phase7-observability` and `143-daily-bars-only` entries recorded as Known traps in the product spec.

## Deferred behavior follow-ups (for debt-radar / later features)

The "signals only" decision splits these findings; only the signal half is in this feature. Each needs its own feature or triage item:

| Report ID | Behavior half deferred |
|---|---|
| S-01 | `flattenAndHalt` halts and pages when `GetPosition` returns an error (distinct from legitimately flat `Qty == 0`) |
| S-02 | `maybeSubmitBracket` raises `emitBracketFailureAlert` when the bracket lookup fails |
| S-03 | `syncAccountPositions` counts a failed ledger emit as not-synced, so the stall watchdog fires |
| S-08 | per-cycle timeout and `GetBars` deadline in the live loop; remove the dead "previous cycle still running" branch |
| S-09 | return 503 instead of 401 when the agent's own mTLS or runtime fault breaks identity validation |
| S-13 | emit `backfill.failed` when `registry.Get` fails, and survive caller cancellation for the terminal event |
| S-14 | fundsignal run ends `partial` when emits fail; mark the run row `failed` on a mid-run exception |
| S-15 | refresh `last_seen_at` on a healthy empty poll; treat "N>0 items, 0 valid" as a source error |
| S-16 | `_resume_job` marks the job `FAILED` and alerts; route bare tasks through `supervision.spawn` |
| S-22 | 503 (not `200 {entries: []}`) when `DATABASE_URL` is unset |
| S-25 | sleep on a clean `WatchConfig` stream end |
| S-26 | add a deadline to the identity audit `AppendEvent` |
| N-02 | exponential backoff on the fixed 2 s retry loops |
| N-04 | skip systemic escalation when the state is already `REDUCE_ONLY` / `HALTED` |

## Open items carried into /sdd-review and /sdd-design

- See product-spec `## Open Questions` 1–6. Question 6 (feature branch name versus the harness branch `ccr-b4aace27-zvuaby`, with PR #1427 open) must be settled before `/sdd-execute`.
