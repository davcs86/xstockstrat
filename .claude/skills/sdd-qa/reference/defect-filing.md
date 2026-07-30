# sdd-qa reference — recording a defect

## Why not a GitHub issue

GitHub Issues are **disabled** on `davcs86/xstockstrat` — `POST /issues` returns
`410 Issues has been disabled`. This is recorded in
`docs/roadmap/features/067-fix-custom-formula-allnone/context.md:20`,
`074-fix-config-write-authz/feature.md:7`, and features 075–078, and `docs/CLAUDE.md:15` documents
`docs/reports/` as the standing workaround. Six features already capture bugs this way.

Do not "verify" this by reading repo metadata: the GitHub API reports `has_issues: true` while
creation still 410s. The API field is an inference about the tab; the 410 is the measured behavior of
the endpoint. Trust the measurement.

## The output

Write `docs/reports/<ISO-date>-<slug>-defect.md`, where `<slug>` is kebab-case derived from the
title. Then print:

```
Recorded: docs/reports/<file>
Next: /sdd-triage --from-report docs/reports/<file>
```

## The template

`/sdd-triage` parses this by grep, so the section headings are load-bearing.

```markdown
# Defect: <short title>

**Recorded**: <ISO date>
**Severity**: SEV-2
**Impact type**: wrong-positions-displayed
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-portfolio
**Config-only fix possible**: no

## Observed

<what happens>

## Expected

<what should happen>

## Reproduction

1. <step>
2. <step>

## Evidence

`path:line`
> matched line

## Root cause hypothesis

<1–2 lines, or "unknown">

## Confidence

high | low
```

## The one rule that matters

**Exactly one `SEV-N` token may appear in the whole document.**

`/sdd-triage` T-2 (`.claude/skills/sdd-triage/SKILL.md:97-102`) tests in order — `Contains "SEV-1"`
→ SEV-1, then SEV-2, then SEV-3. Any stray `SEV-1` anywhere in the body wins, regardless of the
actual severity.

This is not hypothetical. It is exactly why `.github/ISSUE_TEMPLATE/bug-report.yml` cannot be used as
the format: its `:53` checkbox group is labelled `SEV-1 safety check`, GitHub renders group labels
into the issue body, and so **every** issue filed from that template classifies as SEV-1 → Track A →
branch from `main`, PR to `main`. A SEV-3 UI nit would open a hotfix.

So: never write "SEV-1" in prose, never label a section "SEV-1 safety check", and never list the
severity scale inside the report. One token, in the `**Severity**` field.

Similarly for T-3 (`:106-110`): it looks for a checked `[x]` before config-only text and for
`config-propagation` in the impact field. Use the plain `**Config-only fix possible**: yes|no` field
above rather than a checkbox, and only write `config-propagation` when that is genuinely the impact
type.

## Before writing

Confirm with the user (**P-04**) — show the composed report and ask. And check it is actually a
defect: a *missing capability* is not a bug, and routes to `/sdd-story` instead (**C-11**).

## Verifying the format

Do not assume the parse works — run it:

```bash
grep -oE 'SEV-[123]' docs/reports/<file> | sort -u    # must print exactly one line
grep -n '^\*\*Severity\*\*:' docs/reports/<file>
```

An unexecuted gate is a claim, not a check (`docs/roadmap/ledger/fails.md`, 2026-07-29).
