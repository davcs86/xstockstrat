# Context Log: fix-deploy-wait-loop

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via `--from-report`: `docs/reports/2026-11-04-deploy-wait-loop-superseded-defect.md` (Issues disabled)
- Severity: SEV-3; env dev; not config-only → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected: `.github/workflows/deploy.yml`, `deploy-dev.yml`, `deploy-prod.yml`
- Root cause: confirmed from job 126410876732 log — phase literal is `SUPERSEDED` (not guessed); no concurrency group
- Recommended design depth: skip → `/sdd-spec fix-deploy-wait-loop` (rationale: SEV-3, CI-only, no proto/migration/config, root cause known)
- Development branch: feature/fix-deploy-wait-loop
- Findings carried to spec: `deploy.yml` is called by both dev and prod, so a job-level `concurrency` on its `deploy` job keyed on `inputs.environment` covers both (group `deploy-staging` / `deploy-production`; `deploy-homelab.yml:54` uses `deploy-homelab-<env>`, `prod-up/down` use `prod-lifecycle` — no collision). GitHub keeps one pending run per group and cancels older pending ones (cancelled, not failed).
- Open decision for spec: SUPERSEDED as success-with-warning vs distinct failure. Leaning success+`::warning::` (our commit is carried by the newer deployment; concurrency removes the CI-internal source).
- `scripts/sops-secrets.test.sh` `group_deploy` pins `.jobs.deploy.environment`, `.needs`, `resolve-app-id`; it does not pin `concurrency`, so adding it should not trip the static checks — verify by running it. `actionlint` is not installed in this sandbox.
- Local checkout of main-dev was behind origin (lacked feature 286); fast-forwarded before reading `deploy.yml`.
