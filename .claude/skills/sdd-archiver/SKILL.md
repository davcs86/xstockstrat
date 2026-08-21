---
name: sdd-archiver
description: Destructively archive completed SDD features — synthesize the what/why/how that CANNOT be recovered from code or specs, land it where agents actually read it, then prune the verbose artifacts. Usage — /sdd-archiver [<feature-slug> | all]. With no args it reports every terminal-state feature (launched, rolled-back, demoted/canceled) not yet archived and processes the next one; a slug archives one; `all` batches them (cap 10/run). Per feature it delegates read-only synthesis to the feature-synthesizer subagent, runs an adversarial completeness check, then (after a consent gate) distils generalizable lessons into the Ledger (insights.md/fails.md), rewrites context.md down to an `## Archive Synthesis` block, stamps `**Archived**` on feature.md, and DELETES product-spec.md / recon.md / design.md / implementation-spec.md — all through a docs-only PR to main-dev. Use this whenever completed feature artifacts are piling up with little value, when someone wants to clean up / declutter / tidy / garbage-collect / prune / reclaim stale or finished feature directories, after a promotion flips features to launched, to capture decision rationale / rejected alternatives / build scars / gotchas before they are forgotten or pruned, to run a retro / retrospective / post-mortem on a shipped or a rolled-back / demoted / abandoned feature, to distil / harvest / memorialize the lessons learned or institutional knowledge from finished work, to answer "what did we learn from feature X", or to reduce the accumulating pile of old SDD spec files. Never deletes feature.md or status.md, never changes lifecycle status, never rewrites git history.
argument-hint: "[<feature-slug> | all]"
allowed-tools: Read Write Edit Task AskUserQuestion Bash(find *) Bash(grep *) Bash(ls *) Bash(date *) Bash(git fetch *) Bash(git show *) Bash(git ls-remote *) Bash(git status *) Bash(git checkout *) Bash(git branch *) Bash(git rm *) Bash(git add *) Bash(git commit *) Bash(git push *) Bash(gh pr *)
effort: medium
---

You are **destructively archiving completed SDD features**. For each terminal-state feature you
synthesize the reasoning that cannot be recovered from code or other artifacts, land it in memory
agents actually read (per-feature `context.md` + the cross-feature Ledger), then **delete the verbose
spec artifacts**. The synthesis is the load-bearing safety step: everything it fails to capture is
destroyed with the files. Two gates protect the destruction — an adversarial completeness verify pass
and an explicit human consent gate — and every deletion goes through a reviewable docs-only PR and
stays recoverable from git history.

Progressive disclosure: this SKILL.md is the router. Read
`reference/write-formats.md` only at Phase 5 (the exact write/delete blocks) and
`templates/archive-synthesis.md` when rewriting a `context.md`.

## Arguments

- `$ARGUMENTS[0]` — a feature slug, the literal `all`, or absent (report mode).

---

## BOOT SEQUENCE (every session)

- **B0 — Clean-tree + branch guard.** Run `git status --porcelain`; if non-empty, stop —
  "Working tree is dirty. Commit or stash before archiving." If the current branch starts with
  `feature/` or `feature-steps/`, stop — "Run /sdd-archiver from main-dev or a claude/* branch, not
  from a feature branch."
- **B1 — Fetch authoritative state.** `git fetch origin --quiet`.
- **B2 — Stamp today.** `TODAY=$(date -u +%Y-%m-%d)`.

---

## PHASE 1 — ENUMERATE & DETECT

Enumerate feature dirs and read each feature's authoritative `status.md` + `feature.md` from
`origin/main-dev`; select terminal-state features that lack an `**Archived**:` marker. Status
comes from `status.md` (a one-line fetch, cheaper than parsing it out of `feature.md`) — see
`docs/roadmap/features/CLAUDE.md` § Bulk Status Reads, Case 2 (this loop needs `origin/main-dev`
as the authoritative source per feature, not a local-tree scan, so it stays a per-feature `git
show` loop, but each iteration now fetches a tiny file instead of the full `feature.md`):

```bash
for d in $(find docs/roadmap/features -maxdepth 1 -mindepth 1 -type d | sort); do
  slug=$(basename "$d" | sed 's/^[0-9][0-9][0-9]-//')
  status=$(git show origin/main-dev:"$d/status.md" 2>/dev/null || cat "$d/status.md")
  fm=$(git show origin/main-dev:"$d/feature.md" 2>/dev/null || cat "$d/feature.md")
  archived=$(printf '%s\n' "$fm" | grep -m1 '\*\*Archived\*\*:')
  case "$status" in
    launched|rolled-back|demoted/canceled)
      [ -z "$archived" ] && echo "UNARCHIVED  $status  $slug  $d" ;;
  esac
done
```

Single-slug resolve: `find docs/roadmap/features -maxdepth 1 -mindepth 1 -type d -name "*-$ARGUMENTS[0]"`.

For each feature you will actually process, **detect non-standard artifacts** — anything in the dir
that is not one of the eight known SDD files — and carry them into the Phase 4b extras gate:

```bash
ls -A "$FEATURE_DIR" | grep -vxF -e feature.md -e status.md -e product-spec.md -e acceptance.feature \
  -e recon.md -e design.md -e implementation-spec.md -e context.md
```

**`/sdd-sync` resurrection guard.** For each candidate, check whether its feature branch still exists:
`git ls-remote --heads origin feature/<slug>`. If it does, warn — "feature/<slug> still on origin; a
later /sdd-sync 3-way merge could resurrect the pruned specs. Run /sdd-sync branch cleanup (Step 10)
first, or proceed knowing the branch still holds the originals." Prefer features whose branch is
already gone; record the warning as an Open Thread rather than proceeding silently.

---

## PHASE 2 — SELECT (mode routing)

- **No args (report mode):** print the `UNARCHIVED` table (status, slug, dir), then process the
  **first** one. If the list is empty: "No unarchived terminal-state features. Nothing to archive."
- **`<slug>`:** process only that feature. Stop if it is not terminal ("`<slug>` is `<status>`, not a
  terminal state — nothing to archive") or already carries `**Archived**:` ("`<slug>` is already
  archived (`<date>`).").
- **`all`:** process the whole `UNARCHIVED` list, **capped at N=10 this run**. If more remain, say so
  and offer to re-run.

---

## PHASE 3 — SYNTHESIZE (read-only, delegated)

Per selected feature, pre-scan the Ledger for dedup with a **literal fixed-string** grep on the full
`NNN-slug` directory name. Never use a dash-bracketed pattern (`grep "— slug —"`) — the em-dash
byte-mismatches and silently returns empty even when entries exist:

```bash
grep -Fn "$(basename "$FEATURE_DIR")" docs/roadmap/ledger/insights.md docs/roadmap/ledger/fails.md
```

Sanity-check the hit count before trusting an empty result. Then spawn the **`feature-synthesizer`**
subagent via `Task` in **synthesize mode**, passing: `FEATURE_DIR`, `slug`, terminal `status`, the
artifact paths present, the dedup lines above, and the allowlist of files that will be deleted
(`product-spec.md`, `recon.md`, `design.md`, `implementation-spec.md`). Instruct it to read the whole
`context.md`, **especially the execute-phase and post-launch `## Session` blocks** — that is where
the irreplaceable scars and shipped-vs-design divergences live, none of which reached the Ledger.

Hold only the returned digest — never the raw artifacts (Constitution P-01).

---

## PHASE 3.5 — VERIFY COMPLETENESS (the critical safeguard, before any deletion)

Spawn `feature-synthesizer` a **second** time in **verify mode**, passing the synthesis digest and
the four files about to be deleted. It returns a `## Completeness verdict` + `## MISSED` list. If
`MISSED` is non-empty, fold each item into the synthesis and re-verify. **Deletion is blocked until
verify returns `complete` with an empty `MISSED`.** This adversarial pass is the whole safety model —
a false "complete" causes permanent data loss, so never skip it and never proceed on `incomplete`.

---

## PHASE 4 — CONSENT GATE (after synthesis + verify, before any write/delete)

`AskUserQuestion`, spelling out exactly what will be deleted and the safety net:

```
question: "Archive & prune <slug> (<status>)? Verified synthesis ready: <n> insight(s), <m> fail(s).
           This DELETES product-spec.md[, recon.md][, design.md], implementation-spec.md and rewrites
           context.md down to the synthesis, via a docs-only PR to main-dev (recoverable from git history)."
header:   "Archive <slug>"
options:
  - "Archive + prune (full)"
  - "Synthesize only, keep artifacts (no deletion)"
  - "Skip this feature"
```

For `all` mode, issue one up-front batch gate summarizing every feature + its deletion counts:
"Archive + prune all <K>" / "Review one-by-one" / "Cancel".

---

## PHASE 4b — EXTRAS GATE (only if Phase 1 found non-standard artifacts)

The archiver must **not** decide the fate of anything outside the six known SDD files. For each extra
(`design-handoff/`, stray assets), a **separate** `AskUserQuestion`:

```
question: "Feature <slug> has a non-standard artifact `<name>` (<size>, not one of the six SDD specs).
           What should archiving do with it?"
header:   "Extra: <name>"
options:
  - "Keep in place (Recommended)"          # external/visual input can't be reconstructed from the synthesis
  - "Relocate to a feature-assets area"
  - "Delete it"
```

Only a **`Delete it`** answer authorizes a `git rm` of that path (the deletion allowlist otherwise
forbids it). **`Relocate`** is recorded as an Open Thread / PR note — the move itself is a human
follow-up unless a target is given. Record each human choice for the rewritten `context.md`.

---

## PHASE 4c — PROMOTE ACCEPTANCE SCENARIOS (C-16 backfill, read-only planning)

`acceptance.feature` is retained, but its `@AC-*` scenarios must be **promoted** into the durable
business-rule suites at launch (**C-16**) — and a feature implemented outside the standard
`/sdd-execute` loop (or launched before this step existed) may never have been promoted, leaving the
per-service suites empty and the guarantees invisible to future recon. The archiver is a curation
point for those suites, so before pruning it ensures the feature's scenarios are present.

Spawn the **`scenario-promoter`** subagent via `Task` (read-only), passing: `slug`, source feature
number `NNN`, the path to `acceptance.feature`, the **affected services** (from `feature.md`'s
Reviewers table), and the existing suite paths to dedup against
(`services/xstockstrat-<svc>/acceptance/*.feature` per affected service +
`docs/sdd/business-rules/platform.feature`). It returns a **promotion plan**: per-`@AC-*` verdict
(`NEW`/`DUP`/`OVERLAP`/`CONFLICT`), the target suite for each, and ready-to-write scenario blocks with
`@feature-<NNN>` provenance tags. Hold the plan; the writes happen in Phase 5.

- If every scenario is `DUP` (already promoted), there is nothing to write — note "scenarios already
  promoted" and continue.
- A `CONFLICT` (a launched feature contradicting a standing promoted rule) is surfaced to the user as
  an Open Thread / PR note, never silently written over — do not resolve it in the archiver.
- `acceptance.feature` may be pruned **only** once its scenarios are confirmed present in the suites
  (it is not on the deletion allowlist anyway — this is the confirmation, not a licence to delete).

---

## PHASE 5 — WRITE + PRUNE (orchestrator is the single writer)

Read `reference/write-formats.md` for the exact blocks. On a `claude/archive-<slug>` branch (or
`claude/archive-batch-<TODAY>` for `all`), created from `main-dev`:

1. **Ledger.** Append each `[NEW]` candidate to `docs/roadmap/ledger/insights.md` / `fails.md`
   (append-only, newest at bottom, one lesson per entry, `path:line`-cited). Skip every `[DUP:...]`.
2. **context.md.** Read it first (C-02), then **rewrite** it to the archived form (header +
   `## Archive Synthesis` block) using `templates/archive-synthesis.md`.
3. **feature.md.** Add `**Archived**: <TODAY>` to the header and append one `## Status History`
   row. **Never touch `status.md`** — an archived `launched` feature's `status.md` still reads
   `launched`; `**Archived**` is orthogonal to lifecycle status.
4. **Promote scenarios (from the Phase-4c plan).** Append each `NEW` scenario block verbatim to its
   target suite, creating a `services/xstockstrat-<svc>/acceptance/` dir + file header when the plan
   says `CREATE`. Skip `DUP`/`OVERLAP`/`CONFLICT`. Never rewrite or delete an existing promoted
   scenario. Nothing to do if the plan was all-`DUP`.
5. **Prune.** `git rm` the allowlist files present (`product-spec.md`, `recon.md`, `design.md`,
   `implementation-spec.md`) **plus** any extra the human chose `Delete it` for at Phase 4b — and
   nothing else. Extras marked keep/relocate stay in place.
6. **Stage nothing else.** `git add` only the ledger files, `context.md`, `feature.md`, and any
   promoted suite files (`services/*/acceptance/*.feature`, `docs/sdd/business-rules/platform.feature`)
   — the `git rm` already stages the deletions. F-08 staging scope.

Commit: `docs(archive): archive <slug> — synthesis to context.md + Ledger, promote scenarios, prune specs`.

---

## PHASE 6 — PR & REPORT

Push (`git push -u origin <branch>`, retrying on network error) and open a docs-only PR targeting
`main-dev`:

```bash
gh pr create --base main-dev --head <branch> --title "docs(archive): archive <slug(s)>" --body "<body>"
```

PR body, per feature: ledger entries written (insights/fails), dups skipped, files deleted, extras
disposition, and any runtime-invariant discoveries routed to `/context-constitution`. State that the
pruned artifacts remain recoverable via `git show <pre-archive-SHA>:<path>`. Then run the
`/context-scrubber scan` teardown (root CLAUDE.md) scoped to any doc that referenced the pruned specs;
if the context-forge plugin is unavailable, note that in the PR body rather than skipping silently.

---

## HARD CONSTRAINTS — never violate

- **Single writer.** The orchestrator performs every write, delete, and gate; `feature-synthesizer`
  is read-only/advisory and returns condensed digests only — **P-01**.
- **No write or delete before verify-clean AND the Phase-4 consent gate** — **F-10** / **P-04**.
- **The verify gate is the whole safety model.** Never delete an artifact until Phase 3.5 returns
  `complete` with an empty `MISSED`; never proceed on `incomplete`.
- **Synthesize only irrecoverable reasoning.** Never write into memory anything grep-able from code,
  product-spec, implementation-spec, design, proto, or migrations. The rubric is the point of the skill.
- **Deletion is a fixed allowlist** — `product-spec.md`, `recon.md`, `design.md`,
  `implementation-spec.md`. Never `git rm` any other file or subdir on the archiver's own judgment.
- **`acceptance.feature` is deliberately NOT on the deletion allowlist (Constitution C-16).** Its
  `@AC-*` scenarios are promoted into the durable per-service suites at launch; the per-feature copy
  is retained as the provenance record. **Phase 4c** ensures that promotion happened (via the
  read-only `scenario-promoter` subagent) and Phase 5 writes any missing scenarios — closing the gap
  for a feature that launched outside the standard `/sdd-execute` loop. The archiver's business-rule
  role is otherwise **curation of the per-service suites** (`services/xstockstrat-<svc>/acceptance/*.feature`,
  `docs/sdd/business-rules/platform.feature`) — collapse near-duplicate scenarios, retire a scenario a
  rollback invalidated — never deleting business rules or rewriting an existing promoted scenario.
  (Pruning a per-feature `acceptance.feature` is allowed only once its scenarios are confirmed present
  in the suites — which Phase 4c does.)
- **Any non-standard artifact requires the human's decision at the Phase-4b extras gate** before it
  is kept, relocated, or deleted. Only an explicit `Delete it` authorizes removing it.
- **Dedup grep is literal fixed-string** on the full `NNN-slug` (`grep -Fn`), never a dash-bracketed
  pattern.
- **Ledger is append-only**, one lesson per entry, `path:line`-cited; append `[NEW]` only; never
  rewrite, reorder, or dedup-by-deletion existing entries — `docs/roadmap/ledger/CLAUDE.md`.
- **Never write `docs/context-constitution.md` or `-findings.md`.** Runtime invariants are emitted as
  recommendations to `/context-constitution` only.
- **Never delete `feature.md` or `status.md`; never change lifecycle status (never write
  `status.md`).** `**Archived**` is orthogonal — an archived `launched` feature stays `launched`.
- **Never rewrite git history or force-push.** Pruned artifacts must stay recoverable via `git show`.
- **Idempotent.** Skip any feature already carrying `**Archived**:`; never double-append to the Ledger.
- **Docs-only, through a PR to `main-dev` from a `claude/*` branch.** Never push to `main-dev` /
  `main` directly — **F-02** / **F-08**.
- **Never invent evidence** (**C-01** / **F-04**); surface gaps rather than guess (**P-03**).
