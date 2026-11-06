# sdd-execute — ATOMIC UNITS (`**Lands with**`)

Load when the target step carries `**Lands with**`, or when a step's own `**Verification**` cannot pass
because a later step repairs it. A unit is a set of adjacent steps that cannot be green apart (spec
rules: `.claude/skills/sdd-spec/reference/step-constraints.md` §C). F-05 (no commit before verification
passes) is why it exists; it is not an exemption from any rule.

## Planned unit (declared in the spec)

Resolve the unit once, at the STEP SELECTOR: the target step plus every step in its `**Lands with**`
(union of the members' lists; refuse if asymmetric — that is a spec defect, raise a blocker). Then run
the normal phases with the unit as the work item:

- **Phase 1** — discover all members' `**Files**` and `**Codebase Evidence**` together.
- **Phase 2** — one change plan covering every member (default modes: one confirmation; sequential: the
  up-front confirm already covers it).
- **Phase 3** — ONE red→green cycle (`tdd-gate.md`): RED is the members' test step(s) against the
  pre-unit tree, GREEN after all members are applied. Run the **union** of the members'
  `**Verification**` commands, each unchanged. A member with `TDD: N/A` records `N/A`.
- **Commit** — stage the union of the members' `**Files**` plus the usual spec/context files (F-08 is
  satisfied per member), flip **every** member's `**Status**` to `done` in that commit, and title it
  `feat(<slug>): steps 7+8 — <title 7> / <title 8>`. Add one `context.md` entry per member, each naming
  the unit. Default modes: branch `feature-steps/<slug>-step-7-8`, one PR.
- **Sequential** — the unit counts as `len(members)` toward `steps_since_checkpoint` and takes the
  consumer surface of its last member for §5.5b boundaries.

Step bodies stay immutable (F-09): only `**Status**` changes. A planned unit needs no Deviation Log row.

## Unplanned fold (spec missed it)

If Phase 1 or 3 shows the step cannot pass its own `**Verification**` because the fix lives in the
**immediately following** step(s):

1. Do not commit red and do not narrow the Verification. Raise the gap (`deviation-handling.md`) with a
   fold option: **"Fold Step M into this commit"** (adjacent, one surface, unit ≤ 4 — otherwise
   fold is not offered and the usual A/B/C applies). In sequential mode this is the §5.7 blocker, via
   `AskUserQuestion`, with the fold as the recommended option when its conditions hold.
2. On approval, execute as a planned unit above, plus a `## Deviation Log` entry:
   `**Disposition**: folded Step M into Step N — <trigger from step-constraints.md §C>`. Do not edit the
   step bodies.
3. If the cause is a recurring spec gap, add a `fails.md` entry (**P-03**); a one-off stays in the log.

A standing operator authorization (workflow arg `foldPolicy: 'adjacent'` or an operator note recorded in
`context.md`) replaces step 1's question, never the Deviation Log entry.
