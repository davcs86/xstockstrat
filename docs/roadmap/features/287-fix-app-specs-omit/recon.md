# Recon: fix-app-specs-omit

**Created**: 2026-11-04
**From**: product-spec.md
**Affected services**: none at runtime. Deploy pipeline only: `.do/app*.yaml`, `scripts/do-render-app-spec.py`, `.github/workflows/{deploy,prod-up,prod-down}.yml`, and the docs and skill that describe them.

---

## Objective

The app specs declare cluster `xstockstrat` through `databases:`, but they have no top-level `vpc:`. The cluster's
trusted-sources firewall also never learns the ID of a prod app created by `prod-up`. As a result, the new
production app's PRE_DEPLOY `db-migrator` times out.

The fix makes VPC attachment declarative in both specs and fills the value at render time from a doctl
lookup of the cluster named in the spec (operator decision 1). `prod-up` and `prod-down` manage the app's
trusted-source rule (decision 3). DB hosts stay public (decision 2).

## Codebase Map

- **App specs**
  - `.do/app.yaml:5-6`: `name: xstockstrat-production`, `region: nyc`. There is no `vpc:` key.
  - `.do/app.yaml:687-693`: `databases: - name: xstockstrat … cluster_name: xstockstrat`.
  - `.do/app.dev.yaml:689-695`: the same block for staging. Neither spec has a top-level `vpc:`.
- **Renderer**: `scripts/do-render-app-spec.py`
  - `PLACEHOLDER = YOUR_(?:DEV|PROD)_…` (`:21`).
  - Literal `YOUR_GITHUB_ORG`/`YOUR_IMAGE_TAG` replaced from args (`:81-82`).
  - Leftover-placeholder fail-closed check (`:97-99`).
  - GITHUB_OUTPUT `app_name`, `project_id` (`:106-111`).
- **Workflows**
  - `.github/workflows/deploy.yml`: reusable (`workflow_call`, inputs `environment`/`app_spec`/`image_tag`), called from `deploy-dev.yml:46` (staging) and `deploy-prod.yml:45`. Steps: `resolve-app-id` (`:47-58`), render (`:62-85`), `doctl apps update … --spec` (`:90`).
  - `.github/workflows/prod-up.yml`: check, setup-sops, render (`:47-71`), `doctl apps create` (`:73-79`, output `app_id`), assign, wait, report, then `rm -f` (`if: always()`, `:118-120`).
  - `.github/workflows/prod-down.yml`: no checkout, `digitalocean/action-doctl@v2`, delete-by-name (`:28-38`). It has no static test.
- **Tests**: `scripts/sops-secrets.test.sh`
  - `rnd` (`:425-432`) has a fixed arg list.
  - `render` group (`:493-575`) renders the REAL `.do/*.yaml`.
  - REVMAP (`:441-491`) allows only lines matching `^\s+value: YOUR_(DEV|PROD)_X` to differ, with an equal line count.
  - `:513` asserts no `YOUR_*` remains, and `:518-519` pins the GITHUB_OUTPUT keys to `app_name project_id`.
  - `group_produp` (`:685-705`) pins the `uses:` list exactly (`:692-693`) and pins the joined `always()` runs to the single `rm -f` (`:699`).
  - `group_deploy` (`:619-680`) executes `resolve-app-id`'s `run` against a stub doctl (`:636-663`).
  - CI job `sops-secrets` (`.github/workflows/ci.yml:921-945`) runs ruff on the renderer, then the test.

## Patterns to REUSE

- Firewall list/append/remove → `scripts/db-connect.sh:82-86,95` (`doctl databases firewalls list "$CLUSTER_ID" --format UUID,Type,Value --no-header | awk …`; `firewalls remove "$CLUSTER_ID" --uuid "$uuid"`; `firewalls append "$CLUSTER_ID" --rule "ip_addr:$IP"`).
- Exactly-one-by-name resolution, fail closed with "expected exactly 1 … found N" → `deploy.yml:47-58` (platform @AC-21).
- Literal arg-filled placeholder plus a leftover guard → `do-render-app-spec.py:81-82,97-99` (`YOUR_GITHUB_ORG`/`YOUR_IMAGE_TAG`).
- Stub-doctl execution of an extracted workflow `run` → `sops-secrets.test.sh:636-663`.
- doctl JSON: `doctl databases list -o json` emits godo `Database` including `private_network_uuid` (upstream `doctl/commands/displayers/database.go` `Databases.JSON` → `writeJSON(d.Databases)`; `godo/databases.go` `Database.PrivateNetworkUUID`). jq is preinstalled on ubuntu-latest and is already used in `deploy-homelab.yml:127`.

## Existing Business Rules (preserve / extend)

All are in `docs/sdd/business-rules/platform.feature`.

- **PRESERVE** @feature-286:
  - `@AC-8`: no-SOPS deploy behaves as today.
  - `@AC-9`: SOPS first, per-key fallback, masking.
  - `@AC-10`: fail closed with the active deployment unchanged.
  - `@AC-11`: prod-up renders SOPS secrets.
  - `@AC-17`: target the app resolved by name after a recreate.
  - `@AC-21`: exactly one app by name.
  - `@AC-22`: no env-secret shadowing.
  - `@AC-24`: no `MCP_AGENT_SECRET`.
- **PRESERVE** other features:
  - @feature-147 `@AC-8`: no `MCP_AGENT_SECRET`.
  - @feature-266 `@AC-5`: `DATABASE_CA_CERT` bound on direct DB components in both specs.
  - @feature-210 `@AC-4`: prod mTLS material.
- **EXTEND** @feature-286 `@AC-16`: no placeholder remains in the rendered prod spec. The VPC placeholder joins the rule, covered by this feature's AC-1/AC-2.
- No existing guarantee covers teardown firewall cleanup or VPC membership. This feature's AC-3/AC-4 are new guarantees.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none (no SOPS key, because doctl provides the VPC ID; decision 1)
- Inter-service edges: none
- New env vars / ports: none in the services. New workflow-internal values: the cluster ID and VPC ID, looked up from the DO API.

## Risks / Not-found

- **Firewall race**: `doctl apps create` starts the first deployment immediately. The rule is appended right after, before the PRE_DEPLOY `db-migrator` runs. That job builds from source (`scripts/Dockerfile.migrate`), which takes minutes, so in practice the rule lands first. Even so, nothing guarantees the ordering.
- **Unconfirmed cause**: it is not confirmed whether VPC attachment alone, without the private host, changes the connection path (decision 2 keeps the public host). The trusted-source rule is the part that certainly gates public-host traffic. Both are in scope.
- **Staging's current state**: unknown. `apps-get-info` shows no `vpc` field. After this fix, the first staging deploy attaches it, which triggers a normal redeploy.
- **Stale docs**:
  - `docs/setup/digitalocean.md:476` says the component name is `db`; the spec uses `xstockstrat`.
  - `.claude/skills/digitalocean-setup/SKILL.md:557-567` says doctl cannot attach a DB, which conflicts with the spec-based attach.
- **fails.md 2026-10-07 (inter-service-mtls)**: a `YOUR_*` placeholder added to a spec without editing every render site shipped literal placeholders. The new placeholder must be filled in every workflow that renders a spec (`deploy.yml`, `prod-up.yml`) and must fail closed. Verify by running the renderer, not by grepping.
- **fails.md 2026-08-13 (deploy dispersion)**: grep every render call site. Only `deploy.yml:79` and `prod-up.yml:66` invoke `do-render-app-spec.py`.
- **Not found**:
  - any `vpc`/`private_network_uuid` in specs, workflows or scripts;
  - any workflow use of `doctl databases firewalls`;
  - any static test of `prod-down.yml`;
  - any spec parsing in `scripts/do-setup-check.sh`, which only checks tools, auth and resource presence, so it needs no change.

## Recommended Scope

1. Tests first (red): renderer requires a VPC ID and renders `vpc.id`. Add a lookup-script stub test and static checks for prod-up (append) and prod-down (remove).
2. Specs: add the `vpc: id: <placeholder>` block to both. Renderer: add a required, validated VPC arg.
3. Lookup helper plus the workflow wiring (deploy, prod-up, prod-down).
4. Docs and skill.
