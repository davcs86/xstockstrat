# BRANCH SYNC

Run before Phase 1 of every step.

Variables:
- `<dev-branch>` = `**Development Branch**` value from `feature.md` (integration branch, e.g. `feature/<slug>`)
- `<step-branch>` = `feature-steps/<slug>-step-<N>` for the current step N

1. `git fetch origin`
2. Check whether `<dev-branch>` exists on origin:
   ```bash
   git ls-remote --heads origin <dev-branch>
   ```
3. **If the command returns no output** (branch does not exist on origin):
   ```bash
   git checkout main-dev
   git pull origin main-dev
   git checkout -b <dev-branch>
   git push -u origin <dev-branch>
   ```
4. **If the command returns output** (branch exists on origin):
   ```bash
   git checkout <dev-branch>
   git pull origin <dev-branch>
   ```
5. Merge latest `main-dev` into `<dev-branch>` (feature branch changes win on conflict):
   ```bash
   git merge -X ours origin/main-dev
   git push origin <dev-branch>
   ```
6. Create the step sub-branch:
   ```bash
   git checkout -b feature-steps/<slug>-step-<N>
   ```
7. Report to user:
   ```
   Branch sync complete.
   Integration branch: <dev-branch> (up to date with origin/main-dev)
   Working branch:     feature-steps/<slug>-step-<N>
   ```
