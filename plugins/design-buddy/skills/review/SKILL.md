---
name: review
description: Review gate for a design-buddy implementation plan — stricter than advisory. Usage: /design-buddy:review <plan.md path | change slug>. A read-only reviewer subagent checks every step against the review criteria (evidence resolves, design fidelity, host hard rules, ordering); the verdict is recorded in the plan header. Any BLOCKER (floor-tied finding) fails the review and blocks execution readiness — BLOCKERs cannot be waived; warnings are addressed or explicitly waived at a gate. Run after /design-buddy:plan, before executing the plan.
argument-hint: <plan.md path | change slug>
allowed-tools: Read Write Edit AskUserQuestion Task Bash(ls *) Bash(find *) Bash(grep *) Bash(cat *)
---

You run the **review gate** of the design-buddy pair: after `/design-buddy:plan`, before anyone
executes the plan. Unlike an advisory review, the verdict is **recorded in the plan** and gates
it (**DN-6**): a plan with unresolved BLOCKER findings is `failed` and must not be executed;
BLOCKERs cannot be waived.

**Authority (DF-3).** You own every write and every user gate. The `reviewer` subagent is
advisory only — it assesses; you decide, edit, and record.

**Progressive disclosure.** Load each `reference/` file only at the step that needs it:
- `reference/principles.md` — at step 1.
- `reference/config-protocol.md` — only if the config file is missing (step 1).
- `reference/review-criteria.md` — at step 3 (hand it to the reviewer; you need only its
  severity mapping).

## Steps

### 1. Boot

Read `.claude/design-buddy.json` (absent → read `reference/config-protocol.md` and run its
first-run interview). Read `reference/principles.md`. Scratch mode: accept a pasted plan; the
reviewed plan (with its verdict header) is re-emitted inline instead of written.

### 2. Locate the inputs

Resolve the argument: an explicit plan path, or a slug → glob `<artifactsDir>/*-<slug>/plan.md`.
Not found → stop: "No plan found for `<arg>`. Run `/design-buddy:plan` first." Alongside the
plan, read the sibling `design.md` and `recon.md` when they exist — the reviewer needs them for
design-fidelity and host-rule checks. If the plan header's `**Status**` shows execution has
begun (any step not `pending`), warn: review is meant to run pre-execution; on user
confirmation, review anyway but make no plan edits beyond the header and `## Review Log`
(**DN-5**).

### 3. Run the reviewer

Spawn one **`reviewer`** subagent (`design-buddy:reviewer`; bare name as fallback) with: the
plan, `reference/review-criteria.md`, the design doc + recon dossier (when present), and the
principles. It returns a structured verdict: `PASS` / `PASS WITH WARNINGS` / `FAIL`, findings
keyed to criteria, blockers and warnings listed separately. Spot-check before acting: a
`BLOCKER` must be floor-tied (`DF-*` or a quoted host hard rule); demote any that isn't to
`WARNING` and say so.

### 4. Gate

- **FAIL (any blocker).** Present the blockers and offer via `AskUserQuestion`:
  - **Fix the plan now** — amend the failing steps yourself (zero-assumption rule still applies:
    re-verify or re-discover evidence for anything you rewrite), record each amendment in
    `## Review Log`, then re-run step 3. Cap: 2 fix-and-re-review cycles per invocation; if
    blockers remain after that, record `failed` and stop.
  - **I'll fix it manually** — record `failed` and stop; re-run this skill after fixing.
  There is **no waive option for blockers** (**DN-6**).
- **PASS WITH WARNINGS.** Present each warning and ask: **address now** (amend + log, re-run
  step 3 once) or **waive** (record the waiver + rationale in `## Review Log` — **DN-3**).
- **PASS.** Proceed to step 5.

### 5. Record the verdict

Edit the plan (scratch mode: re-emit inline):
- Header: set `**Review**: passed | passed-with-warnings | failed @ <ISO date>`.
- Append a `## Review Log` section (create if absent): date, verdict, blockers found/fixed,
  warnings addressed/waived (with rationale), and any step amendments made in step 4.

### 6. Report

```
Review verdict for <slug>: <verdict>.
Blockers: <n found, n fixed | none>. Warnings: <n addressed, n waived | none>.
<verdict = failed: "Do not execute this plan. Fix the blockers listed in ## Review Log and re-run /design-buddy:review.">
<verdict = passed*: "The plan is ready to execute step-by-step (statuses flip; bodies stay immutable — DN-5).">
```

## HARD CONSTRAINTS — never violate

- **BLOCKERs cannot be waived (DN-6).** No gate option ever approves past one.
- **A BLOCKER must be floor-tied.** `DF-*` or a quoted host hard rule — otherwise demote it.
- **Every plan edit is logged** in `## Review Log`; after execution has begun, edit nothing but
  the header and the log (**DN-5**).
- **You are the only writer (DF-3).** The reviewer never edits the plan.
- **Bounded loop.** At most 2 fix-and-re-review cycles per invocation.
