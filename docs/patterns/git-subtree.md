# Git Subtree Workflow

Each `services/<name>/` directory is linked to its own remote GitHub repo via `git subtree`. The monorepo remains the canonical source; service repos are mirrors for independent CI and direct service work.

## Initial Setup (run once)

Requires `gh` CLI installed and authenticated (`gh auth login`):

```bash
./scripts/subtree-setup.sh
```

This creates each service's GitHub repo, splits the `services/<name>/` history, and pushes to `main` on each remote.

## Push changes (monorepo → service repo)

```bash
./scripts/subtree-sync.sh push xstockstrat-config   # single service
./scripts/subtree-sync.sh push all                  # all services
```

## Pull changes (service repo → monorepo)

```bash
./scripts/subtree-sync.sh pull xstockstrat-config   # single service
./scripts/subtree-sync.sh pull all                  # all services
```

## Rules

- **Never edit `services/<name>/` in both the monorepo and the service repo between syncs** without pulling first — this will cause merge conflicts.
- Always run `subtree-sync.sh pull <service>` before starting work if someone else may have pushed directly to a service repo.
- `git subtree pull` uses `--squash` to keep monorepo history clean.
- Service remotes are named after the service (e.g., `xstockstrat-config`). View all with `git remote -v`.
