# Product Spec: fix-app-specs-omit

**Type**: bug
**GitHub Issue**: none. Report: `docs/reports/2026-11-04-app-specs-omit-db-vpc-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04

---

## Problem Statement

Observed: `prod-up.yml` run 41783551259 created `xstockstrat-production`, but the first deployment
ended in `ERROR`. The PRE_DEPLOY job `db-migrator` timed out connecting to cluster `xstockstrat` on
`:25060`.

Two things were missing from the new app:
- It was not attached to the cluster's VPC (`private_network_uuid`). Neither `.do/app.yaml` nor
  `.do/app.dev.yaml` has a `vpc:` block.
- It was not on the cluster's trusted-sources list. That list holds only the staging app and one droplet.

`deploy.yml` updates staging with a spec that has no `vpc:`. DO documents that removing `vpc` from a spec
disconnects the app, so every staging update risks detaching it.

Expected:
- An app created by `prod-up` is VPC-attached and is a trusted source.
- `prod-down` removes the trusted-source rule it added.
- A staging update never detaches staging.

## Reproduction Steps

1. Run "Prod — bring up" (`prod-up.yml`) while production is torn down.
2. Watch `db-migrator` time out (`Operation timed out`). The deployment phase becomes `ERROR`.

## Root Cause Hypothesis

The operator confirmed the cause: the app specs have no VPC attachment. A trusted-source gap is a
co-cause. `doctl apps create` does not auto-add trusted sources the way the console does.

## Operator Decisions (2026-11-04)

1. **VPC ID source**: the deploy workflows look it up with doctl at render time, from the cluster named
   in the spec. SOPS is the fallback only if doctl cannot provide it.
2. **Connection host**: keep the public host. No `DATABASE_URL` changes.
3. **Trusted sources**: `prod-up` appends `app:<new id>` after create, and `prod-down` removes it.

## Affected Services

Deploy pipeline only: `.do/app.yaml`, `.do/app.dev.yaml`, `scripts/do-render-app-spec.py`,
`.github/workflows/{deploy,prod-up,prod-down}.yml`, and the docs and skill that describe them. No
service runtime code is affected.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature`. Each regression scenario must fail on the buggy behavior and pass after the
fix (Constitution **C-15**). Also: `scripts/sops-secrets.test.sh` passes and CI is green. The operator
does the live verification: run `prod-up`, confirm `db-migrator` connects, then run `prod-down`.

## Out of Scope

- Switching `DATABASE_URL`s to the private hostname
- Disabling or reworking cluster trusted sources beyond the prod app rule
- Running `prod-up` or any production deploy from the agent
