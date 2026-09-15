# sdd-triage — Track C (SDD Path)

Loaded by the router when the triage flow routes to **Track C**. Follow it end to end, then stop.

### C-0. Recommend design depth

A Track C bug is a lightweight feature, so the `/sdd-design` phase (recon + adversarial debate) is
optional — but the recommendation should scale with scope, not be all-or-nothing. Derive a depth from
signals already in hand: severity (T-2) and the **issue body** (its *Affected services* field and any
mention of proto/schema/migration/config — the `## Fix Scope` checkboxes in C-4 start unchecked, so
read the issue text, not those placeholders):

- **full** → `/sdd-design <slug>` — **proto** changes mentioned, OR a **DB migration/schema** change
  mentioned, OR **affected services ≥ 2** (architectural / cross-service fix worth a full debate).
- **quick** → `/sdd-design <slug> quick` — otherwise, when severity is **SEV-2**, OR a **config** change
  is mentioned, OR the **root cause is "under investigation"** / non-trivial. One adversarial round:
  too small to debate, too risky to skip.
- **skip** → straight to `/sdd-spec <slug>` — **SEV-3**, single service, no proto/migration/config, and
  a clear root cause. (`/sdd-spec` notes the absent design and proceeds.)

Store the chosen depth + its command as `<design-rec>` (used in C-3's Next Action and C-6). This is a
**recommendation only** — never auto-invoke `/sdd-design`; the human triggers it (phase-gate, P-04).

### C-1. Check for existing feature directory

Run:
```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-<slug>"
```
If a directory is found: ask the user to confirm overwrite or stop.

### C-2. Compute NNN and create feature directory

```bash
NEXT_NNN=$(printf "%03d" $(( $(find docs/roadmap/features -maxdepth 1 -type d -name '[0-9][0-9][0-9]-*' | wc -l) + 1 )))
FEATURE_DIRNAME="${NEXT_NNN}-<slug>"
mkdir -p docs/roadmap/features/${FEATURE_DIRNAME}
```

Use `${FEATURE_DIRNAME}` (e.g. `003-fix-42-wrong-pnl-portfolio`) for all subsequent file paths.

### C-2.5. Write status.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/status.md` — a single line, plain string, nothing
else:

```
draft
```

This is the canonical current lifecycle status (see `docs/roadmap/features/CLAUDE.md` §
Bulk Status Reads). `feature.md` never repeats it.

### C-3. Write feature.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/feature.md`:

```markdown
# Feature: <slug>

**Type**: bug
**Development Branch**: `feature/<slug>`
**GitHub Issue**: <url>
**Severity**: <SEV-N>
**Created**: <ISO date>
**Last Updated**: <ISO date>

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| <ISO date> | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from GitHub issue #<number> |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

<1–2 sentence description derived from issue title and description>

## Next Action

`<design-rec>` — recommended design depth (skip / quick / full) from triage; see context.md
```

(Render `<design-rec>` as the recommended command: `/sdd-design <slug>` for full, `/sdd-design <slug>
quick` for quick, or `/sdd-spec <slug>` for skip.)

### C-4. Write product-spec.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/product-spec.md` pre-populated from the issue body:

```markdown
# Product Spec: <slug>

**Type**: bug
**GitHub Issue**: <url>
**Severity**: <SEV-N>
**Created**: <ISO date>

---

## Problem Statement

<extracted from issue description — observed behavior vs. expected behavior>

## Reproduction Steps

<extracted from issue reproduction steps>

## Root Cause Hypothesis

<extracted from issue root cause hypothesis, or "Under investigation — see context.md">

## Affected Services

<extracted from issue affected services field>

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
```

### C-4b. Write acceptance.feature (regression scenario — Constitution C-15/C-16)

A bug fix **must** add a regression scenario so the defect can never silently return. Write
`docs/roadmap/features/${FEATURE_DIRNAME}/acceptance.feature`:

```gherkin
Feature: <slug> (bug fix)
  Regression guard for issue #<number>: <title>.

  @AC-1 @regression
  Scenario: <the bug no longer reproduces — named as the correct outcome>
    Given <the reproduction precondition, concrete values from the issue>
    When <the action that triggered the bug>
    Then <the CORRECT observable outcome — what should happen, not the bug>
```

The paired `test` step (`/sdd-spec`) traces to `@AC-1` and is authored to **fail on the current buggy
code** (red) and pass after the fix (green) — this is the red-before-green proof for the bug
(`P-06`). If the root cause is still under investigation, write the scenario from the *expected*
behavior in the issue and refine it once the cause is known.

### C-5. Write context.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/context.md`:

```markdown
# Context Log: <slug>

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session <ISO date> (/sdd-triage)

- Bug reported via GitHub issue #<number>: <title>
- Severity: <SEV-N>
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from issue): <list>
- Root cause hypothesis: <from issue or "under investigation">
- Recommended design depth: <skip | quick | full> → `<design-rec>` (rationale: <severity + scope signal>)
- Development branch: feature/<slug>
```

### C-6. Print next steps

```
SDD path setup complete.
  Feature directory: docs/roadmap/features/<NNN-slug>/
  feature.md: Type=bug, Status=draft
  GitHub issue: <url>

Recommended design depth: <skip | quick | full>

Next steps:
  1. <design-rec>  — recommended design step (see C-0)
       alternatives: /sdd-design <slug> (full) · /sdd-design <slug> quick · /sdd-spec <slug> (skip)
  2. /sdd-spec <slug>  — investigate root cause, generate numbered fix steps (consumes design.md if run)
  3. /sdd-execute <slug> next  — execute steps one at a time
  4. Final PR: feature/<slug> → main-dev
  5. Fix rides next /promote cycle to production
  6. After launched: close GitHub issue #<number>

/sdd-status <slug> to check progress at any time.
```
