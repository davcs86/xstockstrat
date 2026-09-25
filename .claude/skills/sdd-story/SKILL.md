---
name: sdd-story
description: Phase 1 of SDD — turn a user story into a feature's first artifacts. Usage — /sdd-story <feature-slug> [story text]. Allocates the next NNN, creates the feature directory with feature.md, product-spec.md, acceptance.feature (Gherkin @AC-* scenarios), and context.md, and fills governance fields (reviewers, proto/config/DB gates, known traps) from docs/runbooks/feature-workflow.md, docs/runbooks/reviewer-registry.md, and the ledger. Use this at the very start of ANY new capability — a new UI page or route, endpoint, RPC, service behavior, agent tool, or config surface — including when the request arrives as a bare "implement X, commit and push", as a GitHub issue, or as a session instruction, because the root CLAUDE.md makes this the mandatory entry point before any code is written. Also triggers on "new feature", "I want it to…", "add support for…", "can we make it also…", "write a spec for…". Confirmed bug fixes go to sdd-triage instead.
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

### 5.6. Read the Ledger (avoid known traps)

Read `docs/roadmap/ledger/fails.md` (and skim `insights.md`). Surface any entry whose category or
service overlaps this story — a recurring mistake to design out, or a pattern to lean on. If a
relevant `fails.md` entry exists, note it in the product spec's `## Open Questions` (or a one-line
"Known trap" callout) so the design phase and review address it. This is the front-of-pipeline read
side of the cross-feature memory (Constitution **P-05**); the binding rules it may cite live in
`docs/sdd/constitution.md`.

### 6. Write status.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/status.md` — a single line, plain string, nothing
else:

```
draft
```

This is the canonical current lifecycle status (see `docs/roadmap/features/CLAUDE.md` §
Bulk Status Reads). `feature.md` never repeats it.

### 7. Write feature.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/feature.md` using this exact template:

```markdown
# Feature: <slug>

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
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
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

### 8. Write product-spec.md

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

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.
A backend-only change that never reaches a UI segment or an Agent tool leaves the capability
**unusable** — name the surface here so it is scoped now, not discovered stale after the backing
service already shipped. Check every box that applies and say what changes there:

- [ ] **UI** — `xstockstrat-ui` segment(s): `/trader` | `/insights` | `/config-ui` (name each; e.g. new page/route, new field, new control) — reachable per **C-10** (registered in `PLATFORM_SUBNAV`)
- [ ] **Agent** — `xstockstrat-agent` MCP tool(s): `<tool name(s)>` (new tool, new arg, or changed response mapping)
- [ ] **None** — internal/platform-only, no end-user surface. State why the capability needs no consumer-facing change (e.g. "consumed only by another backend service over gRPC").

If a surface is real but deliberately deferred, it must point at a **named follow-up feature**
(record the sign-off in `context.md`), never a vague "later" — that is the only C-14 override.

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

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] <question>
```

**Do not** write a numbered acceptance-criteria list here — the behavior lives in
`acceptance.feature` (Step 8.5) so it can be traced to tests (**C-15**) and later promoted into the
durable business-rule suites (**C-16**). Keep the `FR-N` Functional Requirements; they are what the
scenarios cover.

**Filling `## Consumer Surface(s)` (C-14):** infer the surface from the story, not from the
backend. Ask "once this ships, where does a *user* see or invoke it?" If the story implies a UI
view or an agent action, name that segment/tool — do not leave every box unchecked and do not
default to "None" just because the story is phrased in backend terms. If it is genuinely unclear
which surface, raise it in `## Open Questions` (behavior #1 — surface the fork, never guess).

### 8.5. Write acceptance.feature (Constitution C-15)

Write `docs/roadmap/features/${FEATURE_DIRNAME}/acceptance.feature` — the feature's acceptance
scenarios in Gherkin, one `Scenario:` per behavior derived from the `FR-N` requirements and the user
story. This replaces the old numbered acceptance-criteria list and is the single source of acceptance
truth.

```gherkin
Feature: <slug>
  As a <persona>, I want <capability>, so that <outcome>.

  @AC-1 @FR-1
  Scenario: <concrete behavior, named as an outcome>
    Given <concrete precondition with real example values>
    When <the action under test>
    Then <observable outcome — a returned value, persisted row, rendered element, or emitted event>

  @AC-2 @FR-2
  Scenario: <the next behavior / an edge case or failure mode>
    Given ...
    When ...
    Then ...
```

Authoring rules (the slop guard — enforced by `/sdd-review`):

- Every `Scenario:` has a stable `@AC-<n>` tag **and** at least one `@FR-<n>` tag; every `FR-N` in
  `product-spec.md` is covered by ≥1 scenario.
- **Concrete example values only** — `252 days`, `"insufficient history"`, never "a valid input" or
  "an appropriate error." An untestable `When`/`Then` is a review blocker.
- `Then` clauses are **observable outcomes**, never implementation steps.
- `@AC-*` IDs are **append-only** for this feature — never renumber them; `/sdd-spec` test steps and
  `/sdd-execute` RED assertions cite them.

If the story is a **bug fix** routed here in error, stop and use `/sdd-triage` instead (bug fixes get
a regression scenario via that skill).

### 9. Write context.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/context.md`:

```markdown
# Context: <slug>

**Feature**: `docs/roadmap/features/<NNN-slug>/feature.md`
**Product Spec**: `docs/roadmap/features/<NNN-slug>/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/<NNN-slug>/implementation-spec.md`

---

## Session <ISO timestamp> — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
```

### 10. Report to user

Print:
```
Feature created at docs/roadmap/features/<NNN-slug>/
Status: draft

Files written:
  feature.md          — lifecycle tracker
  product-spec.md     — requirements (review and edit before next step)
  acceptance.feature  — Gherkin @AC-* scenarios (single source of acceptance truth)
  context.md          — session log

Consumer surface(s) (C-14): <echo the boxes you checked — e.g. "UI /insights + Agent run_backtest", or "None (internal)">

Next: review product-spec.md, then run /sdd-review <slug> product-spec
```

Echoing the consumer surface here is deliberate: it is the field most often left stale, so the
operator sees it before the spec advances.
