# BRANCH SYNC

Run before Phase 1 of every step.

Variables:
- `<dev-branch>` = `**Development Branch**` value from `feature.md` (integration branch, e.g. `feature/<slug>`)
- `<step-branch>` = `feature-steps/<slug>-step-<N>` for the current step N
- `<base-branch>` = the branch the new step branch is created from. **Default** (and all non-sequential
  modes): `<base-branch>` = `<dev-branch>`. In **sequential mode** the caller overrides it: the first
  executed step uses `<dev-branch>`; each later step uses the **prior step branch**
  `feature-steps/<slug>-step-<prev>` (stacked PRs — see `docs/patterns/nextjs-frontends.md §8`; GitHub
  auto-retargets a stacked PR to `<dev-branch>` once its base merges).

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
   (In sequential mode this main-dev merge is the re-spec gate's job, done once per feature in §5.3 —
   do **not** re-merge `main-dev` into each stacked step branch, which would pollute the incremental
   diff. Freshness flows through the prior step branch.)
6. Create the step sub-branch from `<base-branch>` (default `<dev-branch>`; the prior step branch in
   sequential mode):
   ```bash
   git checkout <base-branch>
   git pull origin <base-branch>   # no-op for a fresh <dev-branch>; pulls the prior step branch when stacked
   git checkout -b feature-steps/<slug>-step-<N>
   ```
7. Report to user:
   ```
   Branch sync complete.
   Integration branch: <dev-branch> (up to date with origin/main-dev)
   Base branch:        <base-branch>
   Working branch:     feature-steps/<slug>-step-<N>
   ```
