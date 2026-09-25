# sdd-execute — DEVIATION HANDLING

Load this when actual implementation differs from what the spec said, or when Phase 2/Phase 3
surfaces an in-scope-unresolvable gap.

When actual implementation differs from what the spec said, append to the `## Deviation Log`
section of implementation-spec.md:

```markdown
### Deviation: Step N — <title>
**Spec said**: <exact quote from spec Instructions>
**Actual**: <what was done instead>
**Reason**: <why the deviation was necessary>
```

Also record under `Deviations:` in the context.md step entry.

This mirrors the `docs/roadmap/phase*-deviations.md` pattern used throughout this project.

## No vague deferrals — always resolve with the user

**Never write "deferred" without a specific target step or explicit user decision.**

If, during Phase 2 or Phase 3, you identify a gap that cannot be addressed within the current step's
scope (e.g. a param the route doesn't handle, a missing field in a proto, a side-effect from an
earlier step's scope limit), you must explicitly surface it and ask the user before proceeding:

```
Gap found: <one-sentence description of the issue>.
Options:
  A) Fix it now — expand scope of this step to include <specific change>.
  B) Accept as known limitation — <explain why it's safe/harmless>.
  C) Track as follow-up — I'll note it in context.md for the next relevant step.

Which do you prefer? (A / B / C)
```

**STOP HERE. Wait for the user's explicit reply (A / B / C) before taking any action.**

- Do NOT auto-select an option based on your own judgment — not even Option B ("accepted limitation").
  The user must choose.
- If the session is compacted or resumed before a reply arrives, re-surface the same gap question at
  the top of the next response and wait again.

- **Option A**: add the fix to the Phase 2 plan and re-present the plan for confirmation before writing.
- **Option B**: record it in the Deviation Log with `**Disposition**: accepted limitation` and a clear
  rationale. Only apply after the user explicitly selects B.
- **Option C**: record it in context.md under a `## Open Items` section with a description and the
  earliest step where it could be addressed; do NOT write "deferred" in the PR body or deviation log
  without this entry.

Do not proceed with a vague "deferred" note unless you have a specific step number or explicit user
sign-off.

**Sequential-mode override:** present this same A/B/C gap choice via the `AskUserQuestion` tool (not
free text), with **Option A ("fix now — expand this step's scope") as the recommended first option**.
This is the only place sequential mode pauses for the human (a "blocker", `reference/sequential-mode.md`
§5.7). After the answer, resume the loop and record the decision in context.md (+ Deviation Log if
applicable).
