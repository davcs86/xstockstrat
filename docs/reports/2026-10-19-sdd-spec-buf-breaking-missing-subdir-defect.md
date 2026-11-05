# Defect: sdd-spec skill prescribes buf breaking without the mandatory subdir qualifier

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: packages/proto tooling; `.claude/skills/sdd-spec`
**Config-only fix possible**: no
**Source**: `docs/context-constitution.md` PLAT-10 ("`.claude/skills/sdd-spec/SKILL.md:83` still shows the bare form … a known doc drift")

## Observed
The `sdd-spec` skill tells implementation-spec authors that every proto step's verification must run
`buf breaking --against ".git#branch=feature/<slug>"`. Without `subdir=packages/proto` buf cannot
resolve `common/v1` imports in the against-snapshot and reports false compile errors instead of a
clean diff (feature 125). Every real invocation (CI, `buf-gen.sh`, promote) carries the qualifier,
so specs generated from the skill embed a verification command that always fails.

## Expected
The skill shows the qualified form, run from `packages/proto`:
`buf breaking --against '<repo-root>/.git#branch=<base>,subdir=packages/proto'`.

## Reproduction
1. Read `.claude/skills/sdd-spec/SKILL.md:83`.
2. Compare with `scripts/buf-gen.sh:41` and `.github/workflows/ci.yml` (`subdir=packages/proto`).
3. Run the skill's bare command from `packages/proto` on any proto branch → spurious import errors.

## Evidence
`.claude/skills/sdd-spec/SKILL.md:83`
> - **Proto verification**: all `proto` steps must include `buf lint && buf breaking --against ".git#branch=feature/<slug>"` in `**Verification**`

## Root cause hypothesis
Feature 125 fixed the CI/script invocations but not the skill template that seeds new specs.

## Confidence
high
