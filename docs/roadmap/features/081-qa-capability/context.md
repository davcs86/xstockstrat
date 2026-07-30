# Context: qa-capability

**Feature**: `docs/roadmap/features/081-qa-capability/feature.md`
**Product Spec**: `docs/roadmap/features/081-qa-capability/product-spec.md`
**Implementation Spec**: _not generated — implemented directly as 3 atomic commits per the approved
plan; see § pipeline deviation below. Do not run `/sdd-spec` for this feature._

---

## Decisions

- **Split on write authority (P-01).** A read-only `qa-tester` subagent advises; a write-capable
  `sdd-qa` skill executes. This keeps the seven-agent fleet's invariant intact — no agent has
  Write/Edit/Bash — so no Constitution amendment is needed for authority. User-selected over a
  write-capable agent class.
- **The interlock, not the prose, enforces P-01.** `sdd-qa`'s boot finds any feature at
  `in-progress`, reads its current step's `**Files**`, and refuses to write inside it. Without that,
  `sdd-qa` is a second write-orchestrator that can race `/sdd-execute` undetectably (**F-08**,
  **F-10**). `allowed-tools` carries the same weight: no git-write verb, no `gh pr`, no `gh issue`.
- **Whole-monorepo scope**, not frontend-only. Backend services carry the financial-integrity risk
  and have no test-authoring help today.
- ~~**Defects file as GitHub issues**, then hand to `/sdd-triage <n>`. Chosen over a `docs/reports/`
  file because issues are enabled (`has_issues: true`).~~ **REVERSED at /sdd-design** — Issues are
  **disabled** (`POST /issues` → `410`); `has_issues: true` was metadata, not behavior. Defects now
  go to `docs/reports/<date>-<slug>-defect.md` + `/sdd-triage --from-report <path>`.
- **The writer skill is named `sdd-qa`**, in the SDD family — only `sdd-execute` and `sdd-qa` may
  write. The `qa-tester` subagent stays strictly read-only.
- **C-13 is appended; C-12 narrows to a pointer.** In-place amendment would falsify launched 069's
  recorded "C-12 does not apply — backend, not `xstockstrat-ui`".
- **Write boundary is a file-pattern allowlist**, not a directory denylist — Go tests live in
  `internal/`/`cmd/`, Node tests in `src/__tests__/`.
- **`flake` edits no config**; it passes `--retries=0 --max-failures=0 --reporter=json` per run.
- **`/test-data` is absorbed, not kept alongside.** Its three sub-commands become `sdd-qa`
  sub-commands and the directory is deleted.
- **C-13 binds every language but materializes lazily**, and **names a canonical home per language**.
  Naming the home is what makes it enforceable — a language-agnostic rule that points nowhere gives
  `/sdd-review` nothing to grep. **Zero fixture directories are created by this feature.**
- **`sdd-qa` keeps a slash entry point.** Dropping it would remove the only way to run a C-13 audit
  on demand.
- **`sdd-qa gaps` sources thresholds from `.github/workflows/ci.yml`**, the authority — not
  `docs/patterns/ci-overview.md`, which has already drifted.
- **`qa-tester` never emits a coverage percentage.** With `tools: Glob, Grep, Read` it cannot run a
  coverage tool, so any number would be fabricated (**F-04**). It reports a test-file inventory and
  labels proxy rows as proxies.
- **Flake detection is in scope; flake tracking is not.** Historical trends need cross-run
  persistence, which does not exist in this repo.
- **C-11 honored rather than argued.** Zero of 79 prior features registered a `.claude/` change, so
  precedent said skip. Ran the pipeline anyway because this amends the Constitution.

## Open Threads

- [x] ~~Decide whether hardening `check-context-map.sh` belongs here~~ — **resolved**: yes, and it
      lands in **commit 1, before `qa-tester.md`**, so the agent's `reference/` pointers are validated
      from the moment they exist. Verified safe: all 7 existing agents' `docs/`/`.claude/` references
      already resolve.
- [x] ~~Confirm no gate repeats the 079 mistake~~ — **resolved**: two gates, both on symbols that
      cease to exist (dead path + dead invocation form). The path gate alone left 9 live pointers.
- [x] ~~C-13's enforceability depends on all four sites landing together~~ — **resolved in commit 2**:
      `constitution.md`, `step-constraints.md`, `discovery-checklist.md`, and `repo-conventions.md`
      all carry C-13, each with a per-language verification grep.
- [x] ~~Merge-order: land #810 first~~ — **resolved**: #810 merged (`36d605d`); branch rebased, two
      anticipated conflicts resolved (kept the delete; spliced the `sdd-triage` description).
- [~] **The boot interlock (FR-9) is the load-bearing safety mechanism.** Its *pattern* is verified —
      matches a real `feature.md` flipped to `in-progress`, ignores `design-approved`, and `**Files**:`
      confirmed as the real spec header. But it has never actually **refused a write**, because no
      feature was `in-progress` during testing. First real use is the true test.
- [ ] `sdd-qa flake` end-to-end and the 12-service `gaps` sweep were never executed — flake needs a
      built Next.js app plus browsers, the sweep is 12 agent spawns. Marked unchecked in PR #811.
- [ ] `docs/patterns/ci-overview.md:18` is stale (`node-test` ×4; `ci.yml:541-553` runs 5).
      `sdd-qa gaps` sources from `ci.yml` to avoid the drift, but the doc stays wrong. Follow-up.
- [ ] `/sdd-triage` T-2's substring severity match stays fragile for the *issue* path if Issues are
      re-enabled. The `--from-report` path avoids it by controlling the format. Not hardened here.
- [ ] `.github/ISSUE_TEMPLATE/bug-report.yml`'s stale service list (three dead UI entries, no
      `xstockstrat-agent`) was **not** fixed — it became dead config once Issues were confirmed
      disabled, so it dropped out of scope. Still a trap if Issues are ever re-enabled.

## Files Modified

**Created** — `.claude/agents/qa-tester.md`; `.claude/skills/sdd-qa/SKILL.md` + its 7 `reference/`
files; `docs/roadmap/features/081-qa-capability/{feature,product-spec,recon,design,context}.md`.

**Deleted** — `.claude/skills/test-data/` (absorbed into `sdd-qa`).

**Modified** — `docs/sdd/constitution.md` (C-13 appended, C-12 narrowed);
`scripts/check-context-map.sh` (`SRCS` now scans `.claude/agents`); `.claude/context-map.yaml` and
`docs/patterns/context-engineering.md` (both registries, plus 3 backfilled agents);
`.claude/skills/sdd-triage/SKILL.md` (`--from-report`, hardened T-2/T-3);
`.claude/skills/sdd-execute/reference/{tdd-gate,repo-conventions}.md`;
`.claude/skills/sdd-spec/reference/{step-constraints,discovery-checklist}.md`;
`docs/patterns/test-data-inventory.md`; `CLAUDE.md`, `docs/CLAUDE.md`, `docs/patterns/CLAUDE.md`;
`services/xstockstrat-ui/e2e/fixtures/{INVENTORY.md,index.ts}` (two comment lines only — no runtime
code, and no `playwright.config.ts` edit, since `flake` passes CLI flags instead).

---

## Session 2026-07-29 — sdd-story

- Created `feature.md` (status: `draft`), `product-spec.md`, `context.md` from the user story.

### Feature numbering — collision avoided

First allocation computed `080` from the local working tree and was **wrong**. `origin/main-dev`
stops at `079`, but `080-fix-backfill-timeframe-enum` is live on two unmerged branches
(`claude/backlog-080-backfill-timeframe-enum`, `claude/triage-fix-080-8k1q4h`). The correct
`max(NNN)+1` scans **all remote branches**, not the checkout:

```bash
{ for b in $(git ls-remote --heads origin | sed 's|.*refs/heads/||'); do
    git ls-tree --name-only "origin/$b" docs/roadmap/features/ 2>/dev/null | sed 's|.*/||'
  done; ls -1 docs/roadmap/features/; } \
  | grep -E '^[0-9]{3}-' | sed -E 's/^([0-9]{3}).*/\1/' | sort -u | tail -1
```

Directory renamed `080-qa-capability` → `081-qa-capability` before any further work. Flagged by the
user, not by the tooling — the numbering step in `/sdd-story` only scans the local tree, which is
the latent bug that produced the historical `020`/`052` duplicates.

### Ledger reads that changed the plan

- **`fails.md` 2026-07-29 (079 — assumption)**: removal-feature gates written as substring greps
  fail on *correct* output, three separate times on that feature, because prose documenting a
  removal must keep naming the removed thing. The draft plan's acceptance gate ("grep `/test-data`,
  expect zero hits") was exactly this mistake — `reference/fixtures.md` will legitimately say
  "absorbed from the retired `/test-data` skill." Rewritten as AC-4: gate on the dead **path**
  (`.claude/skills/test-data`), the absent directory, and the absent map entry — symbols with no
  legitimate survivor.
- **`fails.md` 2026-07-29 (074 — assumption)**: `xstockstrat-config` printed "7 tests, 7 pass, 0
  skipped" while executing zero assertions, because a `try/catch` around its imports swallowed three
  real blockers. Feeds `reference/test-design.md`'s silent-skip rule and constrains `/qa flake` — a
  vacuously-passing suite looks perfectly stable, so flake output must report assertion counts.

Both traps are recorded in `product-spec.md` § Open Questions so `/sdd-design` and `/sdd-review`
address them rather than rediscovering them.

---

## Session 2026-07-29 — sdd-design (quick, 1 round)

Wrote `recon.md` and `design.md`. Status `draft` → `design-approved`. The mandated adversarial round
returned **BLOCKED**, and resolving it changed the feature materially.

### Floor breach — F-04, resolved by re-scoping

The original FR-5 was built on `gh issue create`. **GitHub Issues are disabled on this repo**:
`POST /issues` → `410 Issues has been disabled`, recorded in `067/context.md:20`,
`074/feature.md:7`, `075`–`078`, and `docs/CLAUDE.md:15`. Six features had already adapted.

The error was mine and it was a P-03 silent assumption: I read `has_issues: true` from the GitHub API
and reported Issues as enabled, which is what the user's routing decision was based on. Repo metadata
was an *inference*; the 410 is a *measurement*. Same shape as `fails.md` 2026-07-27 (072) — "a
demonstration is not a producer contract." The first `recon.md` draft compounded it by checking only
`command -v gh` and framing the gap as sandbox tooling.

Resolved, not waived: `sdd-qa defect` writes `docs/reports/<date>-<slug>-defect.md` and
`/sdd-triage` gains `--from-report <path>`. F-11 therefore does not block.

### Two further defects caught before any code shipped

- **Every defect would have routed to Track A hotfix.** `bug-report.yml:53` labels a checkbox group
  `SEV-1 safety check`; GitHub renders group labels into the body; `/sdd-triage` T-2 tests
  `Contains "SEV-1"` first. A SEV-3 UI nit would have branched from `main` and PR'd to `main` — and
  the original AC-7 ("T-2's grep matches") would have **passed while being wrong**. The
  `--from-report` format emits exactly one `SEV-N` token.
- **The write boundary forbade the core job.** "Never edit `src/`, `app/`, `internal/`" blocks
  test-writing for 8 of 12 services. Replaced with a file-pattern allowlist.

### Other changes from the round

- 5 commits → **3 atomic commits**. The old order deleted `.claude/skills/test-data/` at commit 4
  while `CLAUDE.md:465` and `context-map.yaml:63` still pointed at it → validator exit 1 → red CI.
- `sdd-design` Phase 0 coverage read **extends `codebase-discovery`'s brief** rather than spawning a
  second agent per service (`recon-checklist.md:8` already says reuse the recipe).
- `flake` uses CLI flags instead of editing `playwright.config.ts` — which removes the only
  `services/xstockstrat-ui/**` edit, and with it the service-owner approval gate and the
  `frontend-e2e` × 2-shard CI run. `--retries=0` turns out to be *required* anyway: the configured
  `retries: 1` is exactly what hides flakes.
- `qa-tester` **must never emit a coverage percentage** — with `tools: Glob, Grep, Read` it cannot
  run a coverage tool, so any number would be fabricated (**F-04**).
- Registration goes in **both** registries; `context-map.yaml` and `context-engineering.md` are
  already drifted (missing `design-proposer`/`design-adversary` and `dry-reviewer` respectively).

### Files rewritten this session

`product-spec.md` (FR-5/FR-6 rewritten, 13 acceptance criteria, revision note), `recon.md` (defect
-intake section corrected, registry drift and ordering constraint added), `feature.md` (status,
reviewer table — the service-owner gate disappeared), `design.md` (new). The five `reference/`
files written earlier moved `.claude/skills/qa/` → `.claude/skills/sdd-qa/`.

---

## Session 2026-07-29 — rebase onto main-dev (post-#810)

PR #810 merged (`36d605d`), plus a promotion to `main` (#812). Rebased `feature/qa-capability` onto
`main-dev` — the merge-order dependency recorded above, arriving as predicted.

Simulated first with `git merge-tree --write-tree` before touching the worktree: two conflicts, both
anticipated, no third surprise.

- **`.claude/skills/test-data/SKILL.md`** — modify/delete. Kept the delete. #810 improved the
  description of the skill this feature retires; `sdd-qa`'s description supersedes it.
- **`.claude/skills/sdd-triage/SKILL.md`** — content conflict on the description line. **Spliced
  rather than picked**: both sides were wanted. #810 widened the trigger surface; this branch added
  the `--from-report` entry and the disabled-Issues fact. Kept this branch's `argument-hint`, since
  #810's still read `<issue-number> [backmerge]` and no longer described the arguments.

### Defect corrected during the resolution

#810's description said `classifies severity (SEV-1…SEV-4)`. **SEV-4 does not exist** —
`.github/ISSUE_TEMPLATE/bug-report.yml` defines SEV-1/2/3 and T-2 maps 1/2/3 only. `grep -rn "SEV-4"`
outside `docs/roadmap/features/` returned nothing but that description line itself. The error was
introduced during the skill-description audit and shipped in #810; since the rebase forced a rewrite
of that exact line, correcting it cost nothing. Now `SEV-1…SEV-3`.

### Verification re-run (a rebase rewrites every SHA — prior evidence does not carry over)

- `check-context-map.sh` → `OK` at all five rebased commits, not just the tip.
- Both removal gates on the post-rebase tree: dead path 0, dead invocation 0, dir + map entry absent.
- **Strict YAML now 21/21** across every `SKILL.md` and `.claude/agents/*.md`. It was 12/21 before —
  #810's colon-space fixes are in the base now, so that pre-existing failure is resolved.
- `grep -c SEV-4` on `sdd-triage/SKILL.md` → 0.
- Session-start hook lists `/sdd-qa` and `/sdd-triage` with the `--from-report` hint; no `/test-data`.
- `markdownlint-cli2` clean across 23 `CLAUDE.md` files.

---

## Session 2026-07-29 — lifecycle correction + pipeline deviation record

Status `design-approved` → `code-completed`. The prior value understated reality: the feature was
fully built, verified, and pushed, but `/sdd-status` reported it as awaiting a spec and `/promote`
(which collects features at `code-completed` for the CHANGELOG) would have omitted it from the next
release notes.

### Pipeline deviation — `/sdd-spec` and `/sdd-execute` were bypassed

**What was skipped.** No `implementation-spec.md` was generated and `/sdd-execute` never ran. The
user-approved plan specified implementation as three atomic commits directly.

**Why it is recorded rather than silent** (**P-03**): the two skills provide real guarantees, and
skipping them means saying what replaced each.

| Guarantee `/sdd-execute` provides | What stood in for it here |
|---|---|
| Per-step discovery before writes | `/sdd-design` Phase 0 recon, written to `recon.md` with `path:line` evidence |
| Phase-2 user confirmation per step | One up-front plan approval covering all three commits |
| Per-step verification command | `scripts/check-context-map.sh` run at **every commit**, not just the tip; both removal gates run against the post-change tree |
| Red-before-green TDD gate (**P-06**) | N/A — this feature ships no executable logic. It is `.claude/` tooling, `docs/` governance, and two comment lines. The gate's own applicability rule skips `docs`-category work. |
| Step-level acceptance | The 13 acceptance criteria in `product-spec.md`, each verified by execution and recorded in the PR |

**What this deviation cost.** The artifact trail has no numbered-step record, so a future reader
cannot diff intended steps against delivered ones. The commit series and this log are the substitute.
**C-11 was still honored** — its minimum is `/sdd-story` → `/sdd-design quick` → the ledger touch,
and `/sdd-spec`/`/sdd-execute` are not part of that minimum.

### C-11 ledger obligation — closed this session

C-11 requires the design-phase ledger touch to *write* when a trap surfaced, not only read. The read
happened and changed the plan materially (079 rewrote the removal gate; 074 supplied the silent-skip
rule), but nothing had been written back. Two entries added to `docs/roadmap/ledger/fails.md`:
the metadata-vs-measurement capability assumption, and `/sdd-story`'s local-tree-only feature
numbering. Both were previously recorded only here, where the next feature would not see them.

No `insights.md` entry: the patterns this feature leaned on are already in `fails.md` from 079 and
074. It reused them rather than discovering them, and re-recording would dilute the ledger.
