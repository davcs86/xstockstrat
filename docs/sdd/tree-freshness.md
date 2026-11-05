# SDD tree-freshness preflight

Discovery subagents (`codebase-discovery`, `scenario-recon`) and the code-claim checks in
`spec-reviewer` / `feature-overlap` read the **working tree**, and none of them can run git. A stale
checkout silently produces a stale `recon.md` / spec verdict (Constitution **F-04**: evidence must be
real *now*). The invoking skill — the single writer (**P-01**) — therefore verifies the tree **once at
boot**, before it spawns any of them.

Callers: `/sdd-design` (B3.5), `/sdd-spec` (Step 0.5), `/sdd-review` (BOOT 4), `/sdd-execute` (B4).

## Inputs

- `TARGET` — the feature's `**Development Branch**` from `feature.md` (fallback `feature/<slug>`) when
  `git ls-remote --exit-code --heads origin <that>` succeeds; otherwise `main-dev`.
- `OTHER_BRANCH` — what to do when the tree is not yet `TARGET` merged with `origin/main-dev`: `switch`
  (default) or `defer` (`/sdd-execute` only — its BRANCH SYNC owns checkout, pull, the `main-dev` merge
  and the push before any step).

## Procedure

```bash
git fetch origin <TARGET> main-dev
git rev-parse --abbrev-ref HEAD                       # "HEAD" = detached
git rev-parse HEAD origin/<TARGET>
git rev-list --left-right --count HEAD...origin/<TARGET>   # "<ahead> <behind>"
git merge-base --is-ancestor origin/main-dev HEAD     # exit 1 = main-dev not merged (skip when TARGET = main-dev)
git status --porcelain --untracked-files=no           # tracked changes only
```

| State | Action |
|---|---|
| `fetch` fails | **Stop** — the tree cannot be verified. Continue only on an explicit user `yes`, and record `Tree: UNVERIFIED (fetch failed)` wherever the stamp would go. |
| HEAD sha == `origin/<TARGET>` sha, and `origin/main-dev` is an ancestor of HEAD (or `TARGET` = `main-dev`) | Pass. |
| Tracked changes, and any checkout or merge below is needed | **Stop** — report the delta; ask the user to commit or stash. Never stash for them. |
| HEAD holds commits on no branch or remote (`git rev-list -n1 HEAD --not --branches --remotes` prints a sha) | **Stop** — switching would orphan them. |
| Anything else (`switch`) | **Sync** below. |

**Sync** — switch to `TARGET`, then merge, then push:

```bash
git checkout <TARGET>                  # DWIM-creates the local branch from origin/<TARGET> when absent
git merge --no-edit origin/<TARGET>    # ff when only behind; merge commit when diverged; no-op when current
git merge --no-edit origin/main-dev    # skipped when TARGET = main-dev
```

- Plain merges only — never `-X ours`/`-X theirs`, rebase, reset, or force.
- **Conflict** in either merge: record `git diff --name-only --diff-filter=U`, `git merge --abort`,
  return to the starting ref (`git checkout <branch>` or `git checkout --detach <sha>`), report the paths
  and **stop**. Never resolve by hand here; HEAD and the working tree end as they began.
- **Push** `git push origin <TARGET>` (no force) only when a merge commit was created, `TARGET` ≠
  `main-dev`, and the local `TARGET` carried no commits beyond `origin/<TARGET>` before the sync — so
  the push publishes only the merge. Otherwise, or on a push failure, pass with `+<N> unpushed` in the
  stamp (a push failure is warned, not a stop).
- Then re-run `rev-parse` and stamp.

`defer`: Sync is skipped. Only the fast-forward case on `TARGET` (behind > 0, ahead = 0, no tracked
changes → `git pull --ff-only origin <TARGET>`) is applied; every other non-passing state passes stamped
`deferred to BRANCH SYNC`. The `main-dev` merge happens exactly once, in BRANCH SYNC.

Dirty tracked files block only a needed move — an already-current tree passes regardless.

## Stamp

On pass, build `Tree: <branch>@<sha7> ≡ origin/<TARGET>` (append `+<N> unpushed` when ahead, and
` (merged origin/main-dev@<sha7>)` when Sync merged it). Then:

1. Print it in the skill's boot announcement.
2. Put it verbatim in **every** `codebase-discovery` / `scenario-recon` prompt. Each echoes it as a
   `Checkout:` line; a digest whose `Checkout:` is missing, `UNSTAMPED`, or different from the stamp was
   not produced against the verified tree — discard it and re-spawn.
3. `/sdd-design` records it in `recon.md` → `**Tree**`.
