# Feature Development Workflow

## Overview

This runbook defines the canonical lifecycle for developing, testing, integrating, and
deploying new features across the xstockstrat platform.

**Key invariants enforced at the infrastructure level:**

| Environment | Branch  | Trading mode | Alpaca endpoint              |
|-------------|---------|--------------|------------------------------|
| Local (docker-compose) | any | paper | paper-api.alpaca.markets |
| Dev (DigitalOcean)     | `main-dev` | **paper** | paper-api.alpaca.markets |
| Production (DigitalOcean) | `main`  | **live**  | api.alpaca.markets       |

`TRADING_MODE`, `ALPACA_PAPER`, and `ALPACA_BASE_URL` are set at the app-spec level
(`.do/app.dev.yaml` / `.do/app.yaml`) and cannot be overridden by config service values.
Dev servers will never execute live trades. Production servers will never paper trade.

---

## Branch Model

```
main          ← production deployments (live trading)
  └─ main-dev ← dev deployments (paper trading); base for all feature work
       └─ feature/<short-description>   ← individual feature branches
```

Rules:
- **Always branch from `main-dev`**, never from `main`.
- **Never push directly to `main-dev` or `main`** — all changes go through PRs.
  Direct pushes are blocked by branch protection (see Setup below).
- `main` only accepts PRs from `main-dev` (convention; enforced by the required review gate).
- Hotfixes that cannot wait for the `main-dev` → `main` cycle: branch from `main`,
  fix, PR to `main` with explicit lead approval, then immediately back-merge into `main-dev`.

### One-time setup (run once after repo creation)

```bash
./scripts/setup-branch-protection.sh
```

This configures the following rules on both `main-dev` and `main` via `gh api`:

| Rule | Value |
|---|---|
| Required status check | `CI / Proto lint and breaking check` |
| Require branch up-to-date before merge | yes (strict) |
| Required PR reviews | 1 approving review |
| Dismiss stale reviews on new commits | yes |
| Block direct pushes | yes |

The `CI / Proto lint and breaking check` check is produced by `.github/workflows/ci.yml`
(workflow name `CI`, job name `Proto lint and breaking check`). **PRs cannot be merged
until this check passes** — `buf lint` and `buf breaking` failures block the merge button.

---

## Step-by-step Lifecycle

### 1. Start a feature

```bash
git checkout main-dev
git pull origin main-dev
git checkout -b feature/<short-description>
```

For proto contract changes, review `x-approval-flow.md` before starting — breaking
changes require sign-off before the first commit.

### 2. Develop locally

Start the full stack:

```bash
docker compose up
```

All services run with `TRADING_MODE=paper` and `ALPACA_PAPER=true` (hardcoded in
`docker-compose.yml`). The config UI is available at `http://localhost:3002`.

If your change involves `.proto` files:

```bash
cd packages/proto
buf lint
buf breaking --against '.git#branch=main'
buf generate
```

Run this before committing. The pre-commit hooks in `.pre-commit-config.yaml` enforce
`buf lint` and `buf breaking` automatically on every commit.

### 3. Open a PR to `main-dev`

Push your branch and open a PR targeting `main-dev`:

```bash
git push -u origin feature/<short-description>
# then open PR via GitHub UI or: gh pr create --base main-dev
```

The **CI workflow** (`.github/workflows/ci.yml`) runs automatically. Its
`CI / Proto lint and breaking check` status check is **required** — GitHub blocks
the merge button until it passes:
- `buf lint packages/proto/`
- `buf breaking packages/proto/ --against '.git#branch=origin/main'`

Required for merge:
- `CI / Proto lint and breaking check` green (enforced by branch protection)
- At least 1 service owner approval (2 for breaking proto changes — see `x-approval-flow.md`)

### 4. Merge to `main-dev` → deploys to dev (paper trading)

On merge, the **Deploy dev** workflow (`.github/workflows/deploy-dev.yml`) fires:

```
push to main-dev
  → doctl apps update $DO_DEV_APP_ID --spec .do/app.dev.yaml
    → DigitalOcean redeploys all affected services
      TRADING_MODE=paper, ALPACA_PAPER=true, ALPACA_BASE_URL=https://paper-api.alpaca.markets
```

Verify the deployment:
- Check DigitalOcean App Platform dashboard for deploy status.
- Smoke-test on the dev endpoints (ports 80XX for gRPC/Connect-RPC, 300X for UIs).
- Monitor paper trades through xstockstrat-trader UI at the dev app URL.
- Review ledger events and config state via the dev config-ui.

Config changes needed for the feature (new keys, updated defaults):
follow `x-config-rollout.md` against the dev config service.

### 5. Open a PR from `main-dev` to `main`

After validating the feature on dev:

```bash
gh pr create --base main --head main-dev --title "<feature summary>"
```

Required for merge:
- `CI / Proto lint and breaking check` green (enforced by branch protection)
- At least 1 reviewer approval (enforced by branch protection)
- Confirmation that the feature has been validated on dev (paper trading) environment
- For config key additions: key registered and documented per `x-config-rollout.md`
- For proto changes: migration note in `x-config-rollout.md` if needed

### 6. Merge to `main` → deploys to production (live trading)

On merge, the **Deploy prod** workflow (`.github/workflows/deploy-prod.yml`) fires:

```
push to main
  → doctl apps update $DO_PROD_APP_ID --spec .do/app.yaml
    → DigitalOcean redeploys all affected services
      TRADING_MODE=live, ALPACA_PAPER=false, ALPACA_BASE_URL=https://api.alpaca.markets
```

Monitor after deploy:
- Watch ledger events for `order.created`, `order.filled`, and error events.
- Check xstockstrat-notify for any alert spikes.
- Set `platform.maintenance_mode=true` via config-ui to halt all trading if something
  goes wrong (takes effect within one WatchConfig stream cycle, no restart needed).

---

## Hotfix Procedure

For urgent production fixes that cannot go through the standard `main-dev` → `main` cycle:

```bash
git checkout main
git pull origin main
git checkout -b hotfix/<short-description>

# fix, commit, push
git push -u origin hotfix/<short-description>
gh pr create --base main --head hotfix/<short-description> --title "Hotfix: <description>"
```

Requires explicit approval from the platform lead. After merging to `main`:

```bash
# Back-merge into main-dev immediately to avoid divergence
git checkout main-dev
git pull origin main-dev
git merge main
git push origin main-dev
```

---

## Config Changes During a Feature

New config keys introduced by a feature must be:
1. Named following `<service-short-name>.<category>.<key>` convention
2. Documented in the service's `CLAUDE.md` under "Config Keys" with type and default
3. Rolled out to dev config service before testing on dev
4. Rolled out to prod config service as part of the production deploy step

Follow `x-config-rollout.md` for the full rollout and rollback procedure.

---

## Proto Contract Changes

All `.proto` changes must:
1. Be made in `packages/proto/` in this spine repo
2. Pass `buf lint` and `buf breaking --against '.git#branch=main'`
3. Follow the approval matrix in `x-approval-flow.md`
4. Regenerate stubs via `./scripts/buf-gen.sh` with generated output committed to
   `packages/proto/gen/`

Breaking changes additionally require:
- Deprecation comment in `.proto` for one release cycle
- Migration note in `x-config-rollout.md`

---

## Environment Variable Reference

| Variable | Dev value | Prod value | Set in |
|---|---|---|---|
| `TRADING_MODE` | `paper` | `live` | app spec (all services) |
| `ALPACA_PAPER` | `true` | `false` | app spec (trading, marketdata, ingest) |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` | `https://api.alpaca.markets` | app spec (trading, marketdata, ingest) |
| `GO_ENV` / `PYTHON_ENV` / `NODE_ENV` | `development` | _(implicit production)_ | app spec (per language) |
