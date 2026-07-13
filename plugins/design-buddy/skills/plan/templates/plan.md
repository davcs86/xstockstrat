# design-buddy — plan.md template

Write the implementation plan using this exact structure. Every reference in every step must be
backed by evidence (**DF-1**); once execution begins, step bodies are immutable (**DN-5**) —
only `**Status**` flips, and divergence lands in `## Deviation Log`.

```markdown
# Implementation Plan: <slug>

**Status**: `pending`
**Created**: <ISO date>
**Design**: <relative link to design.md | "none — planned without a design doc">
**Test harness**: <detected command, cited path:line | "none detected — steps carry manual verification">
**Total Steps**: N
**Review**: `not-reviewed`

---

## Execution Summary

<2–4 sentences explaining the implementation order and why.>

## Step Dependencies

- Step N requires Step M: <reason>
- (list all ordering constraints, or "none — steps are independent")

---

### Step N — <title>

**Status**: `pending`
**Files**:
- `exact/path/to/file` — modify | create | delete

**Evidence**:
- Confirmed via: `grep -n "<symbol>" <path>` → line N
- Existing pattern: `<direct quote of actual code found>`
- (or: **Not found** — created from scratch; no existing pattern in the codebase)

**Instructions**:
<Precise, actionable steps citing the real paths and symbols confirmed above. Concrete enough
that a future session can execute without re-deriving the design.>

**Verification**:
<Exact command to run, or the exact output/behavior to observe.>

**Test**:
<The paired test this step needs — file to create/extend and the repo's own test command
(cited path:line from CI/config), authored to fail before the implementation and pass after.
Or: `N/A (<reason>)` — e.g. docs-only, config-only, or no test harness detected.>

---

(repeat for all steps)

---

## Deviation Log

_Populated during execution. Step bodies above are immutable (DN-5); record any divergence
here with the step number, what changed, and why._
```

Step statuses: `pending` → `in-progress` → `done` | `blocked`. A `blocked` step names what
unblocks it.

The `**Review**` field is owned by `/design-buddy:review` (**DN-6**): it flips `not-reviewed` →
`passed | passed-with-warnings | failed @ <date>`, and that skill appends a `## Review Log`
section recording blockers, waivers, and any pre-execution amendments. A `failed` plan must not
be executed.
