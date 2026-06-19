---
name: sdd-story
description: Phase 1 of SDD — generate a product spec from a user story. Usage: /sdd-story <feature-slug> [story text]. Creates docs/roadmap/features/NNN-<slug>/feature.md and product-spec.md. Reads docs/runbooks/feature-workflow.md to populate governance fields.
argument-hint: <feature-slug> [story text]
allowed-tools: Read Write Bash(ls *) Bash(mkdir *) Bash(find *) Bash(printf *)
effort: medium
---

You are creating the initial SDD artifacts for a new feature in the xstockstrat platform.

## Arguments

- `$ARGUMENTS[0]` — feature slug (kebab-case, e.g. `polygon-data-source`). Required.
- `$ARGUMENTS[1..]` — inline story text (optional). If absent, ask the user.

## Steps

### 1. Validate arguments

If `$ARGUMENTS[0]` is empty, stop and ask: "Please provide a feature slug (kebab-case, e.g. `add-rsi-alert`)."

### 2. Check for existing feature

Run:
```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
```
- If a directory is found: ask the user "A feature already exists for this slug (`<found-dir>`). Overwrite or abort?"
  - On `abort`: stop immediately — do not read any further files or proceed to subsequent steps.
  - On `overwrite`: continue.
- If absent: proceed.

### 3. Compute NNN and create directory

The next number is **`max(existing NNN) + 1`** — never a count, never a gap-fill. A count-based
scheme silently collides when a gap exists (two features land on the same number) and is the exact bug
that produced the historical `020`/`052` duplicates. Derive it from the highest existing prefix, then
**abort if the computed directory already exists** so two racing `/sdd-story` runs can't collide:

```bash
MAX_NNN=$(find docs/roadmap/features -maxdepth 1 -type d -name '[0-9][0-9][0-9]-*' \
  | sed -E 's#.*/([0-9]{3})-.*#\1#' | sort -n | tail -1)
NEXT_NNN=$(printf "%03d" $(( 10#${MAX_NNN:-0} + 1 )))
FEATURE_DIRNAME="${NEXT_NNN}-$ARGUMENTS[0]"
if [ -d "docs/roadmap/features/${FEATURE_DIRNAME}" ] || \
   find docs/roadmap/features -maxdepth 1 -type d -name "${NEXT_NNN}-*" | grep -q .; then
  echo "ERROR: ${NEXT_NNN} already taken (race?). Re-run to recompute max+1." >&2
  exit 1
fi
mkdir -p docs/roadmap/features/${FEATURE_DIRNAME}
```

Use `${FEATURE_DIRNAME}` (e.g. `003-polygon-data-source`) as the directory name for all subsequent file paths.

### 4. Get story text

If `$ARGUMENTS[1..]` is provided, use it as the story.
Otherwise, ask the user: "Please describe the feature — what it should do, who uses it, and the acceptance criteria."

### 5. Read governance runbook

Read `docs/runbooks/feature-workflow.md` to extract:
- Branch model (`feature/<slug>` branching from `main-dev`)
- Approval gate requirements (non-breaking proto, breaking proto, schema migration)
- Deployment stages (main-dev → dev, main → prod)

### 5.5. Read reviewer registry

Read `docs/runbooks/reviewer-registry.md`.

Based on the services named in the story and the change types present (proto / migration /
config / new service), identify which reviewer roles apply using the
**Step Category → Reviewer Roles** matrix. Also look up the **Review Focus** for each
affected service from the **Service Owners** table. Store these for use in Step 6.

### 6. Write feature.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/feature.md` using this exact template:

```markdown
# Feature: <slug>

**Lifecycle Status**: `draft`
**Development Branch**: `feature/<slug>`
**Created**: <ISO date>
**Last Updated**: <ISO date>

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| <ISO date> | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

<1–2 sentence description derived from the user story>

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| <role inferred from story + registry> | <focus phrase from registry> |

## Next Action

`/sdd-review <slug> product-spec` — AI review of product spec before running /sdd-spec
```

### 7. Write product-spec.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/product-spec.md` using this exact template:

```markdown
# Product Spec: <slug>

**Created**: <ISO date>

---

## Problem Statement

<1–3 sentences: what problem does this solve, for whom>

## User Story

As a <persona>, I want <capability>, so that <outcome>.

## Functional Requirements

FR-1. ...
FR-2. ...

## Out of Scope

- <explicit exclusions>

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-<name>` — <why>

## Proto Contract Changes

- [ ] No proto changes required
- OR: list new RPCs / messages / field additions

## Config Key Changes

- [ ] No new config keys
- OR: list keys in `<service>.<category>.<key>` format

## Database Changes

- [ ] No schema changes
- OR: describe new tables / columns / migrations

## Feature Workflow Notes

Branch to create: `feature/<slug>` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

1. ...
2. ...

## Open Questions

- [ ] <question>
```

### 8. Write context.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/context.md`:

```markdown
# Context: <slug>

**Feature**: `docs/roadmap/features/<NNN-slug>/feature.md`
**Product Spec**: `docs/roadmap/features/<NNN-slug>/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/<NNN-slug>/implementation-spec.md`

---

## Session <ISO timestamp> — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
```

### 9. Report to user

Print:
```
Feature created at docs/roadmap/features/<NNN-slug>/
Status: draft

Files written:
  feature.md          — lifecycle tracker
  product-spec.md     — requirements (review and edit before next step)
  context.md          — session log

Next: review product-spec.md, then run /sdd-review <slug> product-spec
```
