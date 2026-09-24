# BRANCH SYNC

Run before Phase 1 of every step.

Variables:
- `<dev-branch>` = `**Development Branch**` value from `feature.md` (integration branch, e.g. `feature/<slug>`)
- `<step-branch>` = `feature-steps/<slug>-step-<N>` for the current step N (**default modes only**)
- `<base-branch>` = the branch the new step branch is created from. In the **default modes**
  (`next` / number / `all`) this is `<dev-branch>`.

> **Sequential mode does not use step branches.** It runs steps 1–5 of this procedure **once per
> feature** (branch setup + `main-dev` merge) and **skips step 6** — every step commits directly on
> `<dev-branch>` with no per-step PR (see `reference/sequential-mode.md` §5.5). The rest of this file
> applies to the default per-step modes.

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
   (In sequential mode this `main-dev` merge is the re-spec gate's job, done once per feature in §5.3;
   sequential mode stops here — it does not run step 6.)
6. **(Default modes only — sequential mode skips this step.)** Create the step sub-branch from
   `<base-branch>` (`<dev-branch>`):
   ```bash
   git checkout <base-branch>
   git pull origin <base-branch>   # no-op for a fresh <dev-branch>
   git checkout -b feature-steps/<slug>-step-<N>
   ```
7. Report to user:
   ```
   Branch sync complete.
   Integration branch: <dev-branch> (up to date with origin/main-dev)
   Base branch:        <base-branch>
   Working branch:     feature-steps/<slug>-step-<N>
   ```
