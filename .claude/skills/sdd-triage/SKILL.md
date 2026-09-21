---
name: sdd-triage
description: Triage a bug report and route it to the correct fix track. Usage — /sdd-triage <issue-number | --from-report <path>> [backmerge]. Reads a GitHub issue, or a defect report under docs/reports/ written by /sdd-qa — Issues are disabled on this repo, so --from-report is the live path for anything newly found. Classifies severity (SEV-1…SEV-3) and whether the fix is config-only, then routes to Track A (hotfix branch off main), Track B (a config-key change through the config service), or Track C (the SDD path, creating the feature directory with a bug Type); the `backmerge` sub-command completes the post-hotfix merge into main-dev, updates hotfix-log.md, and closes the issue. Use this whenever the user reports a bug or regression, points at an issue number or a defect report, says production or dev is broken or misbehaving, asks how urgent something is or whether it needs a hotfix, or asks to back-merge a hotfix. Bug fixes enter the workflow here, not through sdd-story.
argument-hint: <issue-number | --from-report <path>> [backmerge]
allowed-tools: Read Write Edit Bash(gh *) Bash(git *) Bash(mkdir *) Bash(find *) Bash(grep *) Bash(date *)
effort: medium
---

You are triaging a bug report for the xstockstrat platform. Read the GitHub issue, classify
severity, and route to the correct fix track. See `docs/runbooks/bug-triage.md` for full
process documentation.

**Progressive disclosure**: this file is the always-loaded core — arg parsing, the `backmerge`
dispatch, and the T-1→T-4 read/classify/route decision every triage needs. The per-track execution
bodies live in `reference/` files that load **only** once the route is chosen — do not read them up
front:
- `reference/backmerge.md` — read **only** when `$ARGUMENTS[1] == backmerge`.
- `reference/track-a-hotfix.md` — read when the triage flow routes to **Track A**.
- `reference/track-b-config.md` — read when the triage flow routes to **Track B**.
- `reference/track-c-sdd.md` — read when the triage flow routes to **Track C**.

## Arguments

- `$ARGUMENTS[0]` — either a GitHub issue number, or `--from-report <path>` pointing at a defect
  file under `docs/reports/` (written by `/sdd-qa defect`). Required. **Issues are disabled on this
  repo**, so `--from-report` is the live path for anything newly discovered; the issue-number form
  remains for the historical case.
- `$ARGUMENTS[1]` — Sub-command. If `backmerge`, run the post-hotfix back-merge procedure
  instead of the triage flow. Optional.

---

## Sub-command: backmerge

If `$ARGUMENTS[1]` is `backmerge`: read **`reference/backmerge.md`** and follow it end to end. Do
**not** run the triage flow below.

---

## Triage flow (default)

### T-1. Read the defect source

Two entry points. Everything from T-2 onward is identical.

**T-1a — `--from-report <path>` (the path that works today).** GitHub Issues are **disabled** on
this repo (`POST /issues` → `410 Issues has been disabled`), so a newly-discovered defect has no
issue number. `/sdd-qa defect` records it as a file instead:

```bash
cat <path>          # e.g. docs/reports/<date>-<slug>-defect.md
```

If the file does not exist: stop — "Report not found at `<path>`."

Extract the same fields the issue body would have carried — they are the report's `**Severity**`,
`**Impact type**`, `**Environment**`, `**Affected service(s)**`, `**Config-only fix possible**`
headers plus its `## Observed` / `## Expected` / `## Reproduction` sections
(format: `.claude/skills/sdd-qa/reference/defect-filing.md`).

Slug: `fix-<first-3-words-of-title-kebab-cased>`, with **no** issue number — matching the adaptation
features 067 and 074–078 already used. There is no issue to close, so skip the Track A/B close steps
and note the report path in `feature.md` where the issue URL would go.

**T-1b — `<issue-number>` (only when Issues are enabled).**

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

> **Parser caution for T-1b.** `.github/ISSUE_TEMPLATE/bug-report.yml` labels a checkbox group
> `SEV-1 safety check`, and GitHub renders group labels into the issue body — so a template-filed
> issue contains the literal `SEV-1` whatever its real severity, and T-2 below (which tests `SEV-1`
> first) will misclassify it. Read the **Severity** field specifically rather than trusting the
> first substring hit. Reports from T-1a are safe: that format carries exactly one `SEV-N` token.

### T-2. Classify severity

**Read the Severity field, not the whole body.** A bare substring scan is wrong: a
template-filed issue contains the literal `SEV-1` in its `SEV-1 safety check` group label whatever
its real severity, so scanning the body classifies every issue SEV-1 → Track A → a hotfix branched
from `main`.

Scope the read to the field:

```bash
# from-report: exactly one SEV-N token exists, on the Severity line
grep -m1 -oE 'SEV-[123]' <(grep -m1 '^\*\*Severity\*\*:' <path>)
# issue: take the line(s) under the "### Severity" heading only
gh issue view <n> --json body -q .body | awk '/^### Severity/{f=1;next} /^### /{f=0} f' | grep -m1 -oE 'SEV-[123]'
```

Map the extracted token to SEV-1 / SEV-2 / SEV-3. If the field is absent or yields no token, ask the
user: "Could not detect severity. Enter SEV-1, SEV-2, or SEV-3:" — never fall back to scanning the
whole body.

Sanity check for a report: `grep -c -oE 'SEV-[123]' <path>` should be `1`. More than one means the
report violates its own format (`.claude/skills/sdd-qa/reference/defect-filing.md`) — stop and fix
the report rather than guessing.

### T-3. Classify config-only

For a **report**: read the `**Config-only fix possible**: yes|no` field, and check whether
`**Impact type**` is `config-propagation`.

For an **issue**: check whether the body contains a checked "Config-only fix possible?" checkbox
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

### Execute the routed track

Read the reference file for the track chosen in T-3/T-4 and follow it end to end; do **not** read the
other track files:

- **Track A (Hotfix)** → `reference/track-a-hotfix.md`
- **Track B (Config-Only)** → `reference/track-b-config.md`
- **Track C (SDD Path)** → `reference/track-c-sdd.md`
