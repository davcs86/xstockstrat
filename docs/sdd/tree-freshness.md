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
- `OTHER_BRANCH` — what to do when HEAD is not on `TARGET`: `stop` (default) or `defer`
  (`/sdd-execute` only — its BRANCH SYNC checks out and pulls `TARGET` before any step).

## Procedure

```bash
git fetch origin <TARGET>
git rev-parse --abbrev-ref HEAD                       # "HEAD" = detached
git rev-parse HEAD origin/<TARGET>
git rev-list --left-right --count HEAD...origin/<TARGET>   # "<ahead> <behind>"
git status --porcelain --untracked-files=no           # tracked changes only
```

| State | Action |
|---|---|
| `fetch` fails | **Stop** — the tree cannot be verified. Continue only on an explicit user `yes`, and record `Tree: UNVERIFIED (fetch failed)` wherever the stamp would go. |
| HEAD sha == `origin/<TARGET>` sha (any branch, attached or detached) | Pass. |
| On `TARGET`, behind > 0, ahead = 0, no tracked changes | `git pull --ff-only origin <TARGET>`, re-run `rev-parse`, pass. |
| On `TARGET`, behind > 0, ahead = 0, tracked changes | **Stop** — report the delta; ask the user to commit or stash. Never stash for them. |
| On `TARGET`, ahead > 0, behind = 0 | Pass; the stamp carries `+<N> unpushed`. |
| On `TARGET`, ahead > 0 **and** behind > 0 | **Stop** — diverged. Never merge, rebase, or reset here. |
| Not on `TARGET` (or detached at a different sha) | `stop`: print `git checkout <TARGET>` and wait. `defer`: pass and stamp `deferred to BRANCH SYNC`. |

Dirty tracked files block only the fast-forward — an already-current tree passes regardless.

## Stamp

On pass, build `Tree: <branch>@<sha7> ≡ origin/<TARGET>` (append `+<N> unpushed` when ahead). Then:

1. Print it in the skill's boot announcement.
2. Put it verbatim in **every** `codebase-discovery` / `scenario-recon` prompt. Each echoes it as a
   `Checkout:` line; a digest whose `Checkout:` is missing, `UNSTAMPED`, or different from the stamp was
   not produced against the verified tree — discard it and re-spawn.
3. `/sdd-design` records it in `recon.md` → `**Tree**`.
