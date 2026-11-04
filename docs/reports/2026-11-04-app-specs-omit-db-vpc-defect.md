# Defect: App specs omit DB VPC attachment and trusted source

**Recorded**: 2026-11-04
**Severity**: SEV-2
**Impact type**: deploy-blocked
**Environment**: production (main)
**Affected service(s)**: deploy pipeline (`.do/app.yaml`, `.do/app.dev.yaml`, `.github/workflows/prod-up.yml`, `.github/workflows/prod-down.yml`, `.github/workflows/deploy.yml`, `scripts/do-render-app-spec.py`)
**Config-only fix possible**: no

## Observed

`prod-up.yml` run 41783551259 (2026-11-04) created `xstockstrat-production`. Its first deployment ended
in `ERROR`, because the PRE_DEPLOY job `db-migrator` could not reach the managed cluster:

```
==> Enabling TimescaleDB extension...
psql: error: connection to server at "xstockstrat-do-user-314468-0.f.db.ondigitalocean.com" (...), port 25060 failed: Operation timed out
ERROR component terminated with non-zero exit code: 2
```

Two things were missing from the new app:

- **VPC attachment.** The cluster `xstockstrat` (nyc1) sits on VPC `private_network_uuid`
  `d7afff57-f807-4893-9fbf-20fff8bb82dd`. Neither app spec has a `vpc:` block, so a newly created app is
  never attached to it.
- **Trusted source.** The cluster's trusted-sources firewall contains only the staging app
  (`app:da863b7b-…`) and one droplet. The DO console adds an app to trusted sources automatically when it
  attaches an existing cluster. `doctl apps create --spec` does not, and a firewall drop also shows up as
  `Operation timed out`.

`prod-up` creates an app with a new ID on every run, so neither gap can be closed by hand once and
left alone.

## Expected

- An app created by `prod-up` is attached to the cluster's VPC and is a trusted source before its
  PRE_DEPLOY migrator connects.
- `prod-down` removes the trusted-source rule it added.
- A staging update (`deploy.yml`: `doctl apps update --spec`) never detaches staging from the VPC. DO
  documents that removing the `vpc` field from a spec disconnects the app.

## Reproduction

1. Run "Prod — bring up" (`prod-up.yml`) while production is torn down.
2. Watch `db-migrator` time out connecting to the cluster on `:25060`. The deployment phase becomes `ERROR`.

## Evidence

`.do/app.yaml#databases` and `.do/app.dev.yaml#databases`: there is a `databases:` binding to cluster
`xstockstrat`, but neither file has a top-level `vpc:` key.

`.github/workflows/prod-up.yml#Create prod app`
> APP_ID=$(doctl apps create --spec "$RUNNER_TEMP/app.yaml" --format ID --no-header)

No step after it adds a trusted source.

`.github/workflows/deploy.yml#Deploy to DigitalOcean App Platform`
> run: doctl apps update "$APP_ID" --spec "$RUNNER_TEMP/app.yaml" --update-sources

The spec passed here has no `vpc:`. If staging was attached by hand, this update can detach it.

## Triage note

T-4 would route this severity in production to Track A. The operator directed Track C (feature branch off
`main-dev`) for three reasons:

- No live service is degraded. Production is torn down by design (`docs/runbooks/infra-cost-reduction.md`).
- The same gap puts staging's `main-dev` deploy path at risk.
- `prod-up` can be dispatched from `main-dev` for verification.
