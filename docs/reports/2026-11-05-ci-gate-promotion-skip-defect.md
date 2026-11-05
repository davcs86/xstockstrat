# Defect: CI Gate passes on main-dev to main promotion PRs without running CI

**Recorded**: 2026-11-05
**Severity**: SEV-2
**Impact type**: ci-gate-false-pass
**Environment**: production (main)
**Affected service(s)**: ci-workflow (.github/workflows/ci.yml)
**Config-only fix possible**: no

## Observed

PR #1448 (main-dev to main) merged with `CI Gate` green 3 seconds after it started. Every other job in the
PR run (41993370058) was skipped. The `main-dev` push CI for the head SHA a248b51 (run 41993362332's
sibling, CI #5071) was still queued when the PR merged, and CI #5066, #5067, #5068 and #5069 on `main-dev`
were queued or in progress. The code reached `main` with no completed CI.

## Expected

`CI Gate` on a promotion PR is green only if the CI jobs actually ran and passed for the head SHA.

## Reproduction

1. Open a `main-dev` to `main` PR while the `main-dev` push CI for the head SHA is queued or running.
2. Observe `CI Gate` succeed in seconds with all upstream jobs skipped.
3. The required check on `main` (ruleset "Prod", context `CI Gate`) is satisfied and the PR can merge.

## Evidence

`.github/workflows/ci.yml:18-21`
> github.head_ref != 'main-dev'

`.github/workflows/ci.yml:1079-1088`
> ci-gate fails only on 'failure' or 'cancelled'; skipped passes

Introduced by 3571982 (#1439), whose premise "the push run already covered it" is unenforced.

## Root cause hypothesis

The `changes` job guard (#1439) skips every downstream job on promotion PRs and the gate treats skipped as pass.

## Confidence

high
