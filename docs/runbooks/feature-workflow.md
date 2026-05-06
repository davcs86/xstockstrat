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
       └─ feature/<slug>           ← integration branch (PR target for step PRs)
            ├─ feature/<slug>/step-1   ← per-step sub-branch (sdd-execute)
            ├─ feature/<slug>/step-2
            └─ feature/<slug>/step-N
```

Rules:
- **Always branch from `main-dev`**, never from `main`.
- **Never push directly to `main-dev` or `main`** — all changes go through PRs.
  Direct pushes are blocked by branch protection (see Setup below).
- `main` only accepts PRs from `main-dev` (convention; enforced by the required review gate).
- Hotfixes that cannot wait for the `main-dev` → `main` cycle: branch from `main`,
  fix, PR to `main` with explicit lead approval, then immediately back-merge into `main-dev`.

### Per-step PR workflow (sdd-execute)

When using `/sdd-execute`, each implementation step runs on its own sub-branch and produces a PR targeting the feature integration branch — not `main-dev` directly.

```
feature/<slug>/step-N  →  PR →  feature/<slug>  →  final PR →  main-dev
```

**Flow per step:**
1. `sdd-execute` syncs `feature/<slug>` with `origin/main-dev` (feature branch wins on conflict).
2. Creates `feature/<slug>/step-N`, executes the step, runs verification.
3. On verification pass: commits, pushes, opens PR `feature/<slug>/step-N → feature/<slug>`, prints URL, stops.
4. Merge the PR, then run `/sdd-execute <slug> next` for the next step.

**Final integration:** after all steps are merged into `feature/<slug>`, open the normal PR from `feature/<slug>` to `main-dev` per step 3b below.

Step PRs never target `main-dev` or `main` directly — only the feature integration branch.

**Keeping main-dev spec files current:** Run `/sdd-sync [slug]` at any time to open a docs-only PR that copies the latest `feature.md`, `product-spec.md`, `implementation-spec.md`, and `context.md` from the feature branch into `main-dev`. This is optional but useful for visibility — it lets IDEs and GitHub browsing reflect current SDD progress without waiting for the final integration PR.

---

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

For proto contract changes, review `docs/runbooks/approval-flow.md` before starting — breaking
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
buf breaking --against '.git#branch=main-dev'
buf generate
```

Run this before committing. The pre-commit hooks in `.pre-commit-config.yaml` enforce
`buf lint` and `buf breaking` automatically on every commit.

### 3a. Per-step PRs → feature integration branch (sdd-execute)

When developing via `/sdd-execute`, step PRs are created automatically targeting `feature/<slug>`.
See the **Per-step PR workflow** subsection above. No manual action needed — `sdd-execute` handles
branch creation, commits, and `gh pr create`.

After merging each step PR, run `/sdd-execute <slug> next` to continue.

### 3b. Final integration PR → `main-dev`

After all steps are merged into `feature/<slug>` and the feature is `code-completed`, open the integration PR:

```bash
git push -u origin feature/<slug>
gh pr create --base main-dev --head feature/<slug>
```

The **CI workflow** (`.github/workflows/ci.yml`) runs automatically. Its
`CI / Proto lint and breaking check` status check is **required** — GitHub blocks
the merge button until it passes:
- `buf lint packages/proto/`
- `buf breaking packages/proto/ --against '.git#branch=origin/main'`

Required for merge:
- `CI / Proto lint and breaking check` green (enforced by branch protection)
- At least 1 service owner approval (2 for breaking proto changes — see `docs/runbooks/approval-flow.md`)

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
follow `docs/runbooks/config-rollout.md` against the dev config service.

### 5. Open a PR from `main-dev` to `main`

After validating the feature on dev:

```bash
gh pr create --base main --head main-dev --title "<feature summary>"
```

Required for merge:
- `CI / Proto lint and breaking check` green (enforced by branch protection)
- At least 1 reviewer approval (enforced by branch protection)
- Confirmation that the feature has been validated on dev (paper trading) environment
- For config key additions: key registered and documented per `docs/runbooks/config-rollout.md`
- For proto changes: migration note in `docs/runbooks/config-rollout.md` if needed

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

Follow `docs/runbooks/config-rollout.md` for the full rollout and rollback procedure.

---

## Database Schema Changes

When a feature requires a new table, column, index, or any other schema change:

1. **Create the migration files** in the relevant service's `migrations/` directory:
   ```
   services/<service>/migrations/NNN_description.up.sql
   services/<service>/migrations/NNN_description.down.sql
   ```
   NNN continues from the last number in that directory (e.g., if `002_` exists, use `003_`).
   The `.down.sql` file should contain the rollback SQL, or a stub comment if rollback is not supported.

2. **Test locally:**
   ```bash
   ./scripts/db-migrate.sh          # apply all pending migrations
   ./scripts/db-migrate.sh version  # verify version advanced in the right service schema
   ```

3. **On DigitalOcean**, migrations run automatically — the `db-migrator` PRE_DEPLOY job
   in `.do/app.dev.yaml` / `.do/app.yaml` runs `db-migrate.sh` before any service restarts
   on every deploy. No manual step needed.

4. **Migration tracking**: golang-migrate records applied versions in `<schema>.schema_migrations`.
   Re-running `db-migrate.sh` is safe — already-applied migrations are skipped.

> **Do not modify existing `.up.sql` files after they have been merged to `main-dev`.** Instead,
> add a new numbered migration. Editing an applied migration breaks the version hash and will
> cause `migrate` to report a dirty state on all deployed databases.

---

## Proto Contract Changes

All `.proto` changes must:
1. Be made in `packages/proto/` in this spine repo
2. Pass `buf lint` and `buf breaking --against '.git#branch=main-dev'`
3. Follow the approval matrix in `docs/runbooks/approval-flow.md`
4. Regenerate stubs via `./scripts/buf-gen.sh` with generated output committed to
   `packages/proto/gen/`

Breaking changes additionally require:
- Deprecation comment in `.proto` for one release cycle
- Migration note in `docs/runbooks/config-rollout.md`

---

## Environment Variable Reference

| Variable | Dev value | Prod value | Set in |
|---|---|---|---|
| `TRADING_MODE` | `paper` | `live` | app spec (all services) |
| `ALPACA_PAPER` | `true` | `false` | app spec (trading, marketdata, ingest) |
| `ALPACA_BASE_URL` | `https://paper-api.alpaca.markets` | `https://api.alpaca.markets` | app spec (trading, marketdata, ingest) |
| `GO_ENV` / `PYTHON_ENV` / `NODE_ENV` | `development` | _(implicit production)_ | app spec (per language) |
