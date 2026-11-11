# sdd-design — debate.md template

Write `$FEATURE_DIR/debate.md` at the end of the **first** round's synthesis, then update it after
**every** round, before the gate. It is the debate's only memory: every proposer/adversary/synthesis
prompt is built from this file as it is on disk, never from the orchestrator's recollection.

**Append-only.** Rows are never deleted or reworded. The only in-place edit is a row's `Status`
cell, and only through the transitions listed under each table. Reversing a settled decision is a
new `D-n` row plus `superseded by D-m` on the old one — and only after a user-approved reopen.
IDs are global across runs and never reused: the next ID is max existing + 1.

```markdown
# Debate Register: <slug>

**State**: in-debate | approved | stopped
**Mode**: <quick|full>
**Rounds run**: <N> (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | <ISO> | /sdd-design | 3 | 1 | 0 | 4 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | <decision> | `path:line` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | <alternative> | <reason; cite `path:line` / rule ID> | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | <objection; rule ID if any> | yes/no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | R-1 | `path:line` / constraint not on record at rejection | pending user |
```
