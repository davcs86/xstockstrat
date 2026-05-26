# Implementation Spec: ci-docker-registry-deploy

**Status**: `pending`
**Created**: 2026-05-26
**Feature**: `docs/roadmap/features/038-ci-docker-registry-deploy/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/ci-docker-registry-deploy`

---

## Execution Summary

The migration has four logical phases executed in order. First, the CI `docker-build` job matrix is added to `.github/workflows/ci.yml` — this is the core deliverable that builds and pushes images. Second, the reusable deploy workflow and the two deploy callers are updated so that on push to `main-dev` or `main` the deploy substitutes the commit SHA into the image tag before calling `doctl apps update`. Third, both DO App Platform spec files (`app.dev.yaml`, `app.yaml`) are migrated from `dockerfile_path` to `image:` references for all 14 services (plus `xstockstrat-agent`, which is present in the app specs but absent from the product spec's 14-service list — see Step Dependencies note). Finally, `docker-compose.yml` is updated to add an `image:` field alongside each service's existing `build:` block, enabling `docker compose pull` as a local dev shortcut.

No service application code, proto contracts, database migrations, or config keys change in this feature.

## Step Dependencies

- Step 2 (deploy workflow update) requires Step 1 (CI build job): the deploy workflow substitutes the SHA into the app spec's `image.tag` field — that field must exist in the app specs before the deploy workflow sends them to DO. However, for the initial merge, Step 1 and Step 2 can land together since the first CI push after merge will be the one that creates images; the app spec migration (Step 3) and docker-compose update (Step 4) are independent.
- Step 3 (app spec migration) must land before Step 2 takes effect in production: if the app specs still use `dockerfile_path`, DO will ignore the SHA tag injected by the deploy workflow. Steps 1+2+3 must all merge in the same PR or sequential PRs before a deploy is triggered.
- Step 4 (docker-compose image fields) is independent of all other steps — it only affects local dev workflows and can land in the same PR.
- Step 5 (docs update) can land in the same PR as Steps 1–4.

**Key ambiguity note**: The product spec's Affected Services list has 14 services (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, config, trader, insights, config-ui, nginx). `xstockstrat-agent` is not on this list but has a `dockerfile_path` entry in both app specs (`.do/app.dev.yaml` L210, `.do/app.yaml` L210). Steps 1 and 3 should include `xstockstrat-agent` in the CI matrix and app spec migration respectively — omitting it would leave a `dockerfile_path` entry that blocks DO from using the pre-built images consistently. The implementation spec includes `xstockstrat-agent` as a 15th service in both steps.

---

### Step 1 — service: Add docker-build job to CI workflow

**Status**: `pending`
**Service**: `.github/workflows/ci.yml`
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead — cross-service CI/CD architecture, port assignments, inter-service consistency; this change restructures the entire build pipeline for all 14 services

**Codebase Evidence**:
- Confirmed via: `grep -n "jobs:" .github/workflows/ci.yml` → L10 — the `jobs:` block begins at L10
- Confirmed via: `grep -n "dockerfile-lint:" .github/workflows/ci.yml` → L504 — `dockerfile-lint` job exists and uses `hadolint/hadolint-action@v3.1.0`
- Confirmed via: `grep -n "contains(fromJson(needs.changes.outputs.matched)" .github/workflows/ci.yml` → pattern used by every existing job's `if:` guard (e.g. L83 `proto-lint`, L175 `go-lint`, L264 `python-lint`) — matches the `changes` job output
- Confirmed via: `grep -n "actions/checkout@v6" .github/workflows/ci.yml` → L88, L124, etc. — checkout action version used throughout
- Confirmed via: `grep -n "digitalocean/action-doctl" .github/workflows/ci.yml` → **not found** — first use of `digitalocean/action-doctl` will be in this step
- Confirmed via: `grep -n "secrets\." .github/workflows/deploy.yml` → L28 `DIGITALOCEAN_ACCESS_TOKEN` — this secret is already present in the repo for the deploy workflow; the docker-build job will reuse it
- Confirmed via: `grep -n "go-version" .github/workflows/ci.yml` → L131 `go-version: "1.25"` — Go version pin used in existing jobs
- Confirmed via: `grep -n "python-version" .github/workflows/ci.yml` → L144 `python-version: "3.12"` — Python version pin
- Confirmed via: `grep -n "node-version" .github/workflows/ci.yml` → L155 `node-version: "22"` — Node version pin
- Confirmed via: `grep -n "strategy:" .github/workflows/ci.yml` → L181 — matrix strategy pattern used in `go-lint`
- Confirmed via: `grep -n "fail-fast: false" .github/workflows/ci.yml` → L182 — all matrix jobs use `fail-fast: false`
- Confirmed via: `grep -n "dockerfiles:" .github/workflows/ci.yml` → L63 — the `changes` job already has a `dockerfiles` filter that matches `**/Dockerfile*`
- Confirmed: `grep -n "dockerfile_path" .do/app.dev.yaml | grep -v "Dockerfile.migrate"` → 15 service `dockerfile_path` entries (14 product-spec services + `xstockstrat-agent`)

**Instructions**:

1. Add a new `docker-build` job to `.github/workflows/ci.yml`, immediately after the `dockerfile-lint` job (L519 is the end of `dockerfile-lint`).

2. The job runs unconditionally on every push and pull_request (all 15 services, always — FR-1 defers path-filtered builds). No `if:` guard. The job depends on `changes` only for ordering, not for filtering its output:

   ```yaml
   docker-build:
     name: Docker build and push (${{ matrix.service }})
     needs: changes
     runs-on: ubuntu-latest
     strategy:
       fail-fast: false
       matrix:
         include:
           - service: xstockstrat-trading
             dockerfile: services/xstockstrat-trading/Dockerfile
           - service: xstockstrat-portfolio
             dockerfile: services/xstockstrat-portfolio/Dockerfile
           - service: xstockstrat-marketdata
             dockerfile: services/xstockstrat-marketdata/Dockerfile
           - service: xstockstrat-indicators
             dockerfile: services/xstockstrat-indicators/Dockerfile
           - service: xstockstrat-ingest
             dockerfile: services/xstockstrat-ingest/Dockerfile
           - service: xstockstrat-analysis
             dockerfile: services/xstockstrat-analysis/Dockerfile
           - service: xstockstrat-agent
             dockerfile: services/xstockstrat-agent/Dockerfile
           - service: xstockstrat-ledger
             dockerfile: services/xstockstrat-ledger/Dockerfile
           - service: xstockstrat-identity
             dockerfile: services/xstockstrat-identity/Dockerfile
           - service: xstockstrat-notify
             dockerfile: services/xstockstrat-notify/Dockerfile
           - service: xstockstrat-config
             dockerfile: services/xstockstrat-config/Dockerfile
           - service: xstockstrat-nginx
             dockerfile: services/xstockstrat-nginx/Dockerfile
           - service: xstockstrat-trader
             dockerfile: services/xstockstrat-trader/Dockerfile
           - service: xstockstrat-insights
             dockerfile: services/xstockstrat-insights/Dockerfile
           - service: xstockstrat-config-ui
             dockerfile: services/xstockstrat-config-ui/Dockerfile
     steps:
       - uses: actions/checkout@v6

       - name: Set up Docker Buildx
         uses: docker/setup-buildx-action@v3

       - name: Install doctl
         uses: digitalocean/action-doctl@v2
         with:
           token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}

       - name: Log in to DOCR
         run: doctl registry login --expiry-seconds 600

       - name: Determine push flag and tags
         id: tags
         run: |
           SHA="${{ github.sha }}"
           SHORT_SHA="${SHA:0:7}"
           REGISTRY="registry.digitalocean.com"
           REGISTRY_SLUG="${{ secrets.DO_REGISTRY_NAME }}"
           REPO="${REGISTRY}/${REGISTRY_SLUG}/${{ matrix.service }}"
           if [ "${{ github.event_name }}" = "push" ] && [ "${{ github.ref }}" = "refs/heads/main-dev" ]; then
             echo "push=true" >> "$GITHUB_OUTPUT"
             echo "tags=${REPO}:${SHORT_SHA},${REPO}:latest-dev" >> "$GITHUB_OUTPUT"
           elif [ "${{ github.event_name }}" = "push" ] && [ "${{ github.ref }}" = "refs/heads/main" ]; then
             echo "push=true" >> "$GITHUB_OUTPUT"
             echo "tags=${REPO}:${SHORT_SHA},${REPO}:latest" >> "$GITHUB_OUTPUT"
           else
             echo "push=false" >> "$GITHUB_OUTPUT"
             echo "tags=${REPO}:pr-build" >> "$GITHUB_OUTPUT"
           fi

       - name: Build (and push if on main-dev or main)
         uses: docker/build-push-action@v6
         with:
           context: .
           file: ${{ matrix.dockerfile }}
           push: ${{ steps.tags.outputs.push }}
           tags: ${{ steps.tags.outputs.tags }}
           cache-from: type=gha,scope=${{ matrix.service }}
           cache-to: type=gha,mode=max,scope=${{ matrix.service }}
           platforms: linux/amd64
   ```

3. The job requires a new GitHub Actions secret: `DO_REGISTRY_NAME` — the slug of the DOCR registry (e.g. `xstockstrat`). This secret is separate from `DIGITALOCEAN_ACCESS_TOKEN` (which already exists). Document in Step 5 (docs update) that this secret must be added.

4. The `doctl registry login` step uses the already-present `DIGITALOCEAN_ACCESS_TOKEN` secret (confirmed present at `.github/workflows/deploy.yml` L28) — no new secret for auth.

5. The SHA tag uses the first 7 characters of `github.sha` (short SHA) — matches industry convention and DO App Platform's image tag field length constraints. The deploy workflow in Step 2 must use the same 7-character truncation.

**Verification**:
- On a PR: `docker-build` job runs but does NOT push (push=false). The job must pass for the PR to merge.
- On push to `main-dev`: all 15 service images are pushed with `<short-sha>` and `latest-dev` tags.
- On push to `main`: all 15 service images are pushed with `<short-sha>` and `latest` tags.
- Verification command after workflow runs: `doctl registry repository list-tags registry.digitalocean.com/<DO_REGISTRY_NAME>/xstockstrat-trading` — confirm `<short-sha>` and `latest-dev` tags appear.

---

### Step 2 — service: Update deploy workflows to inject SHA image tags

**Status**: `pending`
**Service**: `.github/workflows/deploy.yml`, `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`
**Files**:
- `.github/workflows/deploy.yml` — modify
- `.github/workflows/deploy-dev.yml` — modify (pass SHA and registry name)
- `.github/workflows/deploy-prod.yml` — modify (pass SHA and registry name)

**Reviewers**: Platform Lead — cross-service CI/CD architecture, port assignments, inter-service consistency; this change restructures the entire build pipeline for all 14 services

**Codebase Evidence**:
- Confirmed via: Read `.github/workflows/deploy.yml` L30–L34:
  ```yaml
  - name: Substitute GitHub org in app spec
    run: sed "s|YOUR_GITHUB_ORG|${{ github.repository_owner }}|g" ${{ inputs.app_spec }} > /tmp/app_spec_substituted.yaml
  - name: Deploy to DigitalOcean App Platform
    run: doctl apps update ${{ secrets.DO_APP_ID }} --spec /tmp/app_spec_substituted.yaml
  ```
  The deploy workflow already substitutes `YOUR_GITHUB_ORG` via `sed`. The SHA and registry name substitution must be added in the same step or a subsequent step using the same `/tmp/app_spec_substituted.yaml` file.
- Confirmed via: `grep -n "workflow_call:" .github/workflows/deploy.yml` → L3 — the workflow is a `workflow_call` reusable workflow with an `inputs` block at L5 and `secrets` block at L9
- Confirmed via: `grep -n "inputs:" .github/workflows/deploy.yml` → L5 — current single input is `app_spec`
- Confirmed via: Read `.github/workflows/deploy-dev.yml` L25–L34 — callers pass `app_spec` + three secrets; `DIGITALOCEAN_ACCESS_TOKEN` is passed through
- Confirmed via: `grep -n "github.sha\|github.ref" .github/workflows/deploy-dev.yml` → **not found** — SHA is not currently passed or used; callers must expose it as a new input

**Instructions**:

1. In `.github/workflows/deploy.yml`, add two new `inputs` to the `workflow_call` block:
   - `image_tag` — type: string, required: true — the short SHA (e.g. `abc1234`) to pin into the app spec
   - `registry_name` — type: string, required: true — the DOCR registry slug (e.g. `xstockstrat`)

2. In `.github/workflows/deploy.yml`, extend the "Substitute GitHub org in app spec" step to also substitute `YOUR_IMAGE_TAG` and `YOUR_REGISTRY_NAME` placeholders (which will be added to the app specs in Step 3):

   ```yaml
   - name: Substitute app spec placeholders
     run: |
       sed \
         -e "s|YOUR_GITHUB_ORG|${{ github.repository_owner }}|g" \
         -e "s|YOUR_IMAGE_TAG|${{ inputs.image_tag }}|g" \
         -e "s|YOUR_REGISTRY_NAME|${{ inputs.registry_name }}|g" \
         ${{ inputs.app_spec }} > /tmp/app_spec_substituted.yaml
   ```

3. In `.github/workflows/deploy-dev.yml`, pass the new inputs when calling the reusable workflow:

   ```yaml
   with:
     app_spec: .do/app.dev.yaml
     image_tag: ${{ github.sha && github.sha[:7] }}
     registry_name: ${{ secrets.DO_REGISTRY_NAME }}
   ```

   Because `github.sha[:7]` slice syntax is not supported in GitHub Actions `with:` expressions, use a preceding step to set an output:

   ```yaml
   jobs:
     prepare:
       runs-on: ubuntu-latest
       outputs:
         short_sha: ${{ steps.sha.outputs.short_sha }}
       steps:
         - id: sha
           run: echo "short_sha=${GITHUB_SHA:0:7}" >> "$GITHUB_OUTPUT"
     buf-push-dev:
       # unchanged
     deploy:
       needs: [prepare]
       name: Deploy to dev
       uses: ./.github/workflows/deploy.yml
       secrets:
         DIGITALOCEAN_ACCESS_TOKEN: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
         DO_APP_ID: ${{ secrets.DO_DEV_APP_ID }}
         DO_PROJECT_ID: ${{ secrets.DO_DEV_PROJECT_ID }}
       with:
         app_spec: .do/app.dev.yaml
         image_tag: ${{ needs.prepare.outputs.short_sha }}
         registry_name: ${{ secrets.DO_REGISTRY_NAME }}
   ```

   Note: `secrets.DO_REGISTRY_NAME` cannot be passed as a `with:` input because GitHub Actions does not allow secrets in `with:`. Pass it as a secret through the `secrets:` block — and add `DO_REGISTRY_NAME` as a new `secrets:` input in `deploy.yml`'s `workflow_call` block, replacing the `inputs.registry_name` approach:

   **Revised approach**: Add `DO_REGISTRY_NAME` as a new secret in the `workflow_call` `secrets:` block of `deploy.yml` (alongside `DIGITALOCEAN_ACCESS_TOKEN`, `DO_APP_ID`, `DO_PROJECT_ID`). Reference it as `${{ secrets.DO_REGISTRY_NAME }}` in the substitution step. Both `deploy-dev.yml` and `deploy-prod.yml` pass it through the `secrets:` block.

4. In `.github/workflows/deploy-prod.yml`, make the equivalent changes (use `prepare` job for short SHA, pass `DO_REGISTRY_NAME` as a secret through the `secrets:` block).

5. `DO_REGISTRY_NAME` must be added as a GitHub Actions repository secret (value: the DOCR registry slug — documented in Step 5).

**Verification**:
- After merging: push to `main-dev` triggers the deploy workflow. In the DO App Platform console, the `xstockstrat-staging` app's service components should show `image.tag: <short-sha>` (7 chars) in their configuration.
- Bash check: `grep "YOUR_IMAGE_TAG\|YOUR_REGISTRY_NAME" /tmp/app_spec_substituted.yaml` → should return no matches after substitution runs.

---

### Step 3 — service: Migrate app specs from dockerfile_path to image references

**Status**: `pending`
**Service**: `.do/app.dev.yaml`, `.do/app.yaml`
**Files**:
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: Platform Lead — cross-service CI/CD architecture, port assignments, inter-service consistency; this change restructures the entire build pipeline for all 14 services

**Codebase Evidence**:
- Confirmed via: `grep -n "dockerfile_path" .do/app.dev.yaml | grep -v "Dockerfile.migrate"` → 15 entries (L31, L61, L87, L121, L144, L177, L210, L240, L264, L293, L320, L345, L364, L392, L424) — these are the 15 service `dockerfile_path` entries to replace (14 from product spec + agent)
- Confirmed via: `grep -n "dockerfile_path.*Dockerfile.migrate" .do/app.dev.yaml` → L452 — the `db-migrator` job uses `dockerfile_path: scripts/Dockerfile.migrate` — this entry is **excluded** from migration per FR-8
- Confirmed via: `grep -n "github:" .do/app.dev.yaml` → L27, L57, L82, L116, L139, L172, L205, L235, L259, L288, L315, L340, L359, L387, L419 — each service has a `github:` block (repo + branch) alongside `dockerfile_path:`. When migrating to `image:`, the `github:` block is removed (it is only needed for Dockerfile builds; image-based deploys point to the registry directly).
- Confirmed format for DO App Platform DOCR image reference (from DO documentation pattern):
  ```yaml
  image:
    registry_type: DOCR
    registry: YOUR_REGISTRY_NAME
    repository: xstockstrat-<service>
    tag: YOUR_IMAGE_TAG
  ```
- Confirmed via: Read `.do/app.dev.yaml` L26–L35 (xstockstrat-trading entry) — the full `github:` + `dockerfile_path` block to replace:
  ```yaml
  github:
    repo: YOUR_GITHUB_ORG/xstockstrat-orchestration
    branch: main-dev
    deploy_on_push: false
  dockerfile_path: services/xstockstrat-trading/Dockerfile
  ```
- Confirmed: `db-migrator` job (L446–L458 in app.dev.yaml) retains `dockerfile_path: scripts/Dockerfile.migrate` — no change

**Instructions**:

For each of the 15 service entries in both `.do/app.dev.yaml` and `.do/app.yaml`, replace the `github:` block + `dockerfile_path:` line with an `image:` block:

Replace this pattern (example for `xstockstrat-trading`):
```yaml
    github:
      repo: YOUR_GITHUB_ORG/xstockstrat-orchestration
      branch: main-dev
      deploy_on_push: false
    dockerfile_path: services/xstockstrat-trading/Dockerfile
```

With:
```yaml
    image:
      registry_type: DOCR
      registry: YOUR_REGISTRY_NAME
      repository: xstockstrat-trading
      tag: YOUR_IMAGE_TAG
```

Apply this substitution for all 15 services in **both** app spec files. The `repository` field is the service name without the `registry.digitalocean.com/<slug>/` prefix.

Services and their image repository names (confirmed from `dockerfile_path` entries):
- `xstockstrat-trading` → `repository: xstockstrat-trading`
- `xstockstrat-portfolio` → `repository: xstockstrat-portfolio`
- `xstockstrat-marketdata` → `repository: xstockstrat-marketdata`
- `xstockstrat-indicators` → `repository: xstockstrat-indicators`
- `xstockstrat-ingest` → `repository: xstockstrat-ingest`
- `xstockstrat-analysis` → `repository: xstockstrat-analysis`
- `xstockstrat-agent` → `repository: xstockstrat-agent`
- `xstockstrat-ledger` → `repository: xstockstrat-ledger`
- `xstockstrat-identity` → `repository: xstockstrat-identity`
- `xstockstrat-notify` → `repository: xstockstrat-notify`
- `xstockstrat-config` → `repository: xstockstrat-config`
- `xstockstrat-nginx` → `repository: xstockstrat-nginx`
- `xstockstrat-trader` → `repository: xstockstrat-trader`
- `xstockstrat-insights` → `repository: xstockstrat-insights`
- `xstockstrat-config-ui` → `repository: xstockstrat-config-ui`

The `db-migrator` job at `.do/app.dev.yaml` L446 and `.do/app.yaml` L446 **keeps** its existing `github:` + `dockerfile_path: scripts/Dockerfile.migrate` entries unchanged (FR-8).

The `YOUR_REGISTRY_NAME` and `YOUR_IMAGE_TAG` placeholders are literal strings — they are substituted at deploy time by the updated `deploy.yml` workflow (Step 2). These placeholders must match exactly what Step 2 substitutes.

**Verification**:
```bash
# Confirm all 15 service dockerfile_path entries are gone (only db-migrator remains)
grep -n "dockerfile_path:" .do/app.dev.yaml .do/app.yaml
# Expected: only the db-migrator line remains in each file

# Confirm all 15 service github: blocks are removed
grep -n "github:" .do/app.dev.yaml .do/app.yaml
# Expected: only the db-migrator github: block remains in each file

# Confirm 15 image: blocks present in each file
grep -n "registry_type: DOCR" .do/app.dev.yaml .do/app.yaml
# Expected: 15 matches in each file

# Confirm placeholders are in place
grep -n "YOUR_REGISTRY_NAME\|YOUR_IMAGE_TAG" .do/app.dev.yaml .do/app.yaml
# Expected: 30 matches each (15 per file × 2 fields)
```

---

### Step 4 — service: Add image field to docker-compose.yml service entries

**Status**: `pending`
**Service**: `docker-compose.yml`
**Files**:
- `docker-compose.yml` — modify
- `.env.example` — modify (add DO_REGISTRY_NAME)

**Reviewers**: Platform Lead — cross-service CI/CD architecture, port assignments, inter-service consistency; this change restructures the entire build pipeline for all 14 services

**Codebase Evidence**:
- Confirmed via: `grep -n "build:" docker-compose.yml` → L82 (db-migrator), L100 (xstockstrat-config), L123 (xstockstrat-ledger), L149 (xstockstrat-identity), L179 (xstockstrat-notify), L209 (xstockstrat-marketdata), L243 (xstockstrat-indicators), L267 (xstockstrat-ingest), L295 (xstockstrat-analysis), L330 (xstockstrat-portfolio), L361 (xstockstrat-trading), L397 (xstockstrat-trader), L425 (xstockstrat-insights), L453 (xstockstrat-config-ui), L485 (nginx), L510 (xstockstrat-agent) — 16 total `build:` entries (14 app services + nginx + agent + db-migrator)
- Confirmed via: Read docker-compose.yml L98–L119 (xstockstrat-config entry):
  ```yaml
  xstockstrat-config:
    <<: *svc
    build:
      context: .
      dockerfile: services/xstockstrat-config/Dockerfile
    container_name: xstockstrat-config
  ```
  The `build:` block is the pattern to keep. An `image:` field is added alongside it.
- Confirmed via: `grep -n "image:" docker-compose.yml` → L46 (`otel/opentelemetry-collector-contrib:0.103.0`) and L62 (`timescale/timescaledb:latest-pg16`) — these infrastructure services already use `image:` only; the pattern of pairing `build:` + `image:` is not yet used.
- Confirmed: `grep -n "^  nginx:" docker-compose.yml` → L483 — the nginx service in docker-compose uses the key `nginx` (not `xstockstrat-nginx`). The DOCR image repo name must be `xstockstrat-nginx` to match the CI matrix in Step 1.
- Confirmed: `grep -n "^  db-migrator:" docker-compose.yml` → L81 — the db-migrator service uses a build-only pattern and does not need an `image:` field added (it is not built or pushed to DOCR).

**Instructions**:

For each application service (all services with a `build:` block except `db-migrator`), add an `image:` field immediately after the `build:` block. The image tag uses `latest-dev` for all services (the local dev convention — `docker compose pull` fetches the latest CI-built dev image).

Example transformation for `xstockstrat-config` (L98–L105):
```yaml
  xstockstrat-config:
    <<: *svc
    build:
      context: .
      dockerfile: services/xstockstrat-config/Dockerfile
    image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-config:latest-dev
    container_name: xstockstrat-config
```

The `DO_REGISTRY_NAME` variable (with a fallback default of `xstockstrat`) can be set in `.env` by developers who have a different registry slug. For most users the default will be sufficient. The `.env.example` file should be updated to add:
```
DO_REGISTRY_NAME=xstockstrat
```

Apply the `image:` field to these 15 services (in docker-compose order):
1. `xstockstrat-config` (L100): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-config:latest-dev`
2. `xstockstrat-ledger` (L123): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-ledger:latest-dev`
3. `xstockstrat-identity` (L149): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-identity:latest-dev`
4. `xstockstrat-notify` (L179): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-notify:latest-dev`
5. `xstockstrat-marketdata` (L209): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-marketdata:latest-dev`
6. `xstockstrat-indicators` (L243): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-indicators:latest-dev`
7. `xstockstrat-ingest` (L267): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-ingest:latest-dev`
8. `xstockstrat-analysis` (L295): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-analysis:latest-dev`
9. `xstockstrat-portfolio` (L330): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-portfolio:latest-dev`
10. `xstockstrat-trading` (L361): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-trading:latest-dev`
11. `xstockstrat-trader` (L397): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-trader:latest-dev`
12. `xstockstrat-insights` (L425): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-insights:latest-dev`
13. `xstockstrat-config-ui` (L453): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-config-ui:latest-dev`
14. `nginx` (L485): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-nginx:latest-dev` (note: CI matrix uses `xstockstrat-nginx`; the compose service key is `nginx` but the image repository name matches the CI service name)
15. `xstockstrat-agent` (L510): `image: registry.digitalocean.com/${DO_REGISTRY_NAME:-xstockstrat}/xstockstrat-agent:latest-dev`

Do NOT add `image:` to `db-migrator` (L82) — it is not pushed to DOCR.

**Verification**:
```bash
# Confirm 15 services have both build: and image: (non-migrator services)
grep -c "image: registry.digitalocean.com" docker-compose.yml
# Expected: 15

# Confirm db-migrator still has no image: line
grep -A5 "db-migrator:" docker-compose.yml | grep "image:"
# Expected: no match

# Confirm local build still works without registry credentials:
docker compose build --no-cache xstockstrat-config
# Expected: builds from Dockerfile, tags result as registry.digitalocean.com/<slug>/xstockstrat-config:latest-dev

# Confirm pull works with registry credentials:
docker compose pull xstockstrat-config
# Expected: pulls CI-built image from DOCR
```

---

### Step 5 — docs: Update DigitalOcean setup guide for registry and new secrets

**Status**: `pending`
**Service**: `docs/setup/digitalocean.md`
**Files**:
- `docs/setup/digitalocean.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: Read `docs/setup/digitalocean.md` L349–L360 (Step 9 — Configure GitHub Actions Secrets):
  ```markdown
  | Secret Name | Value | Used by |
  |---|---|---|
  | `DIGITALOCEAN_ACCESS_TOKEN` | ... | deploy-dev, deploy-prod |
  | `DO_DEV_APP_ID` | ... | deploy-dev |
  | `DO_PROD_APP_ID` | ... | deploy-prod |
  | `DO_DEV_PROJECT_ID` | ... | deploy-dev |
  | `DO_PROD_PROJECT_ID` | ... | deploy-prod |
  | `BUF_TOKEN` | ... | deploy-dev, deploy-prod |
  ```
  This table is the canonical location for documenting GitHub Actions secrets.
- Confirmed via: Read `docs/setup/digitalocean.md` L193–L204 (Step 5 — Create the Dev App) — the first place DOCR/registry is mentioned must be added before Step 5 (the app specs now reference DOCR images)

**Instructions**:

1. Add a new **Step 4.5 — Create a DOCR Container Registry** section between Steps 4 and 5 in `docs/setup/digitalocean.md`. This step covers:
   - Creating a DOCR registry via the DO console or `doctl`: `doctl registry create xstockstrat --region nyc1 --subscription-tier basic`
   - Note that the registry slug (e.g. `xstockstrat`) becomes the value of `DO_REGISTRY_NAME` in GitHub Secrets
   - Note that DO App Platform pulls from DOCR with zero additional credential configuration (native DO auth)

2. Update the GitHub Actions Secrets table in Step 9 to add two new secrets:
   ```markdown
   | `DO_REGISTRY_NAME` | The DOCR registry slug (e.g. `xstockstrat`) | docker-build (CI), deploy-dev, deploy-prod |
   ```

3. Update Step 5 and Step 6 (Create the Dev App / Prod App) to note that `doctl apps create` no longer triggers a Dockerfile build — DO pulls the pre-built image from DOCR. First deploy still requires that CI has already pushed images (i.e., the CI `docker-build` job has run on `main-dev` at least once). Add: "Ensure CI has pushed at least one image to DOCR before running `doctl apps create`. Push to `main-dev` first, wait for the `docker-build` CI job to complete, then create the app."

4. Update the Troubleshooting section to add:
   - "**Deploy fails with 'image not found'**: The `docker-build` CI job has not yet pushed images for this commit SHA. Push to `main-dev`/`main` and wait for the CI `docker-build` job to complete before retrying the deploy."
   - "**`docker compose pull` fails with 'unauthorized'**: Run `doctl registry login` to authenticate the local Docker daemon with DOCR."

**Verification**:
- Read the updated `docs/setup/digitalocean.md` and verify all four changes are present: new Step 4.5, updated secrets table, updated Step 5/6 note, updated troubleshooting entries.
- No bash command needed — this is a documentation-only change.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
