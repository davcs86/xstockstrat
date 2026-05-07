---
name: sdd-triage
description: Triage a bug report and route it to the correct fix track. Usage: /sdd-triage <issue-number> [backmerge]. Reads the GitHub issue, classifies severity, and routes to Track A (hotfix), Track B (config-only), or Track C (SDD path). Sub-command 'backmerge' completes the post-hotfix back-merge into main-dev.
argument-hint: <issue-number> [backmerge]
allowed-tools: Read Write Edit Bash(gh *) Bash(git *) Bash(mkdir *) Bash(find *) Bash(grep *) Bash(date *)
effort: medium
---

You are triaging a bug report for the xstockstrat platform. Read the GitHub issue, classify
severity, and route to the correct fix track. See `docs/runbooks/bug-triage.md` for full
process documentation.

## Arguments

- `$ARGUMENTS[0]` — GitHub issue number. Required.
- `$ARGUMENTS[1]` — Sub-command. If `backmerge`, run the post-hotfix back-merge procedure
  instead of the triage flow. Optional.

---

## Sub-command: backmerge

If `$ARGUMENTS[1]` is `backmerge`:

The hotfix has merged to `main`. Complete the back-merge into `main-dev`.

Derive the slug: ask the user "Which hotfix slug should I back-merge? (e.g. `fix-123-wrong-pnl`)"

### BM-1. Fetch and back-merge
```bash
git fetch origin main main-dev
git checkout main-dev
git pull origin main-dev
git merge origin/main --no-edit
git push origin main-dev
```

If the merge fails with conflicts:
- Print each conflicting file.
- Ask the user to resolve conflicts manually, then re-run this command.
- Stop — do not continue until conflicts are resolved.

Record the back-merge commit SHA:
```bash
git rev-parse HEAD
```

### BM-2. Update hotfix-log.md

Read `docs/runbooks/hotfix-log.md`. Find the entry for `hotfix/<slug>` (match by the `## <timestamp> — hotfix/<slug>` heading). Update its `**Status**` line from `in-progress` to `deployed` and add `**Back-merge commit**: <SHA>`.

Write the file back.

### BM-3. Close GitHub issue

```bash
gh issue close $ARGUMENTS[0] --comment "Hotfix merged and back-merged into main-dev (commit: <SHA>). Fix: hotfix/<slug> PR merged to main. Trading resumed."
```

### BM-4. Announce

Print:
```
Back-merge complete.
  main-dev now contains: hotfix/<slug>
  Back-merge SHA: <SHA>
  hotfix-log.md: Status updated to deployed
  GitHub issue #<number>: closed
```

Stop here — do not continue to the triage flow.

---

## Triage flow (default)

### T-1. Read the GitHub issue

```bash
gh issue view $ARGUMENTS[0] --json title,body,labels,url
```

If the issue is not found: stop — "Issue #$ARGUMENTS[0] not found. Check the issue number."

Extract:
- `title` — will be used to generate the slug
- `body` — contains severity, impact type, environment, config-only flag, affected services,
  description, reproduction steps, root cause hypothesis
- `url`

Generate the bug slug: `fix-<issue-number>-<first-3-words-of-title-kebab-cased>`.
Example: issue 42, title "Wrong P&L in portfolio" → `fix-42-wrong-pnl-portfolio`.
Strip non-alphanumeric characters from the title words.

### T-2. Classify severity

Read the issue body and extract the **Severity** field. Map as follows:
- Contains "SEV-1" → SEV-1
- Contains "SEV-2" → SEV-2
- Contains "SEV-3" → SEV-3
- Not found → ask the user: "Could not detect severity in the issue body. Enter SEV-1, SEV-2,
  or SEV-3:"

### T-3. Classify config-only

Check whether the issue body contains a checked "Config-only fix possible?" checkbox
(`[x]` before the config-only option text). Also check whether the **Impact type** field
contains `config-propagation`.

If config-only is indicated: route to Track B (config-only fix).
Otherwise: proceed to T-4.

### T-4. Route by severity and environment

- SEV-1 → **Track A (Hotfix)**
- SEV-2, environment is `production (main)` → **Track A (Hotfix)**
- SEV-2, environment is `dev` or `local` → **Track C (SDD path)**
- SEV-3 → **Track C (SDD path)**

Announce the routing decision:
```
Issue #<number>: <title>
Severity: <SEV-N>
Track: <A — Hotfix | B — Config-only | C — SDD path>
Slug: <slug>
```

Then proceed to the appropriate track below.

---

## Track A — Hotfix

### A-1. Maintenance mode reminder (SEV-1 only)

If severity is SEV-1, print immediately:
```
⚠ SEV-1 detected. If live trading is at risk, set maintenance mode NOW before continuing:
  Config key: platform.maintenance_mode = true
  Via config-ui: http://localhost:3002
  This halts all trading via WatchConfig with no service restart.
```

Ask: "Has maintenance mode been applied (or confirmed not needed)? (yes / skip)"
Wait for response before continuing.

### A-2. Create hotfix branch

```bash
git fetch origin main
git checkout main
git pull origin main
git checkout -b hotfix/<slug>
```

Print: "Branch `hotfix/<slug>` created from `main`."

### A-3. Append to hotfix-log.md

Read `docs/runbooks/hotfix-log.md`. Prepend a new entry immediately after the
`<!-- New entries are prepended below this line -->` comment:

```markdown
## <ISO-8601 timestamp> — hotfix/<slug>

- **GitHub issue**: <url>
- **Severity**: <SEV-N>
- **Affected service(s)**: <extracted from issue body>
- **Root cause**: <extracted from issue root cause hypothesis, or "under investigation">
- **Fix summary**: _pending_
- **PR**: _pending_
- **Platform-lead approver**: _pending_
- **Back-merge commit**: _pending_
- **Maintenance mode applied**: <yes | no>
- **Status**: in-progress
```

Write the file back.

### A-4. Print next steps

```
Hotfix setup complete.
  Branch: hotfix/<slug>
  hotfix-log.md: entry added (Status: in-progress)

Next steps:
  1. Write the fix on branch hotfix/<slug>
  2. Commit your changes
  3. Push: git push -u origin hotfix/<slug>
  4. Open a PR using the hotfix template:
       gh pr create --base main --head hotfix/<slug> \
         --title "Hotfix: <title>" \
         --template .github/PULL_REQUEST_TEMPLATE/hotfix.md
  5. Get platform-lead approval and merge
  6. After merge, run: /sdd-triage <issue-number> backmerge
```

Stop — do not continue.

---

## Track B — Config-Only Fix

### B-1. Identify config key

Read the issue body for any mentioned config keys (pattern: `<service>.<category>.<key>`).
If none found, ask: "Which config key needs to be changed? (format: service.category.key)"

### B-2. Print the fix command

Read `docs/runbooks/config-rollout.md` to confirm the SetConfig procedure.

Print:
```
Config-only fix identified.
  Key: <config-key>
  Current value (from issue): <value if mentioned, otherwise "unknown">
  Recommended action: update via config-ui at http://localhost:3002
    or use the SetConfig RPC directly.

See docs/runbooks/config-rollout.md for the full rollout and rollback procedure.
```

### B-3. Ask for confirmation

Ask: "Has the config change been applied and verified? (yes / no)"

If yes: proceed to B-4.
If no: print "Apply the config change, verify propagation in service logs, then confirm."
  Stop — do not continue.

### B-4. Close the GitHub issue

```bash
gh issue close $ARGUMENTS[0] \
  --comment "Resolved via config-only fix. Changed \`<config-key>\` to correct value. No code deploy needed — WatchConfig propagated the change to all services."
```

Print:
```
Config-only fix complete.
  GitHub issue #<number>: closed
  No branch, no PR, no CI run.
```

Stop — do not continue.

---

## Track C — SDD Path

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

### C-3. Write feature.md

Write `docs/roadmap/features/${FEATURE_DIRNAME}/feature.md`:

```markdown
# Feature: <slug>

**Type**: bug
**Lifecycle Status**: `draft`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

<1–2 sentence description derived from issue title and description>

## Next Action

`/sdd-spec <slug>` — generate implementation spec from the product spec
```

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

- [ ] Observed behavior no longer occurs in reproduction steps
- [ ] Existing tests pass
- [ ] Affected service(s) smoke-tested on dev environment

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
```

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
- Created: feature.md, product-spec.md, context.md
- Affected services (from issue): <list>
- Root cause hypothesis: <from issue or "under investigation">
- Development branch: feature/<slug>
```

### C-6. Print next steps

```
SDD path setup complete.
  Feature directory: docs/roadmap/features/<NNN-slug>/
  feature.md: Type=bug, Status=draft
  GitHub issue: <url>

Next steps:
  1. /sdd-spec <slug>  — investigate root cause, generate numbered fix steps
  2. /sdd-execute <slug> next  — execute steps one at a time
  3. Final PR: feature/<slug> → main-dev
  4. Fix rides next /promote cycle to production
  5. After launched: close GitHub issue #<number>

/sdd-status <slug> to check progress at any time.
```
