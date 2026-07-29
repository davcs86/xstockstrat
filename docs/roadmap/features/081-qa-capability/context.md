# Context: qa-capability

**Feature**: `docs/roadmap/features/081-qa-capability/feature.md`
**Product Spec**: `docs/roadmap/features/081-qa-capability/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/081-qa-capability/implementation-spec.md`

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
- [ ] **The boot interlock (FR-9) is the load-bearing safety mechanism and is untested until AC-11
      runs.** Until then "never bypass the TDD gate" is prose. Target: verification step.
- [ ] **C-13's enforceability depends on all four duplicated sites landing together** —
      `step-constraints.md:30`'s Verification column is a literal TypeScript grep and needs
      per-language equivalents, or C-13 binds Go/Python while `/sdd-review` has nothing to check.
      Target: commit 2.
- [ ] `docs/patterns/ci-overview.md:18` is stale (`node-test` ×4; `ci.yml:541-553` runs 5).
      `sdd-qa gaps` sources from `ci.yml` to avoid the drift, but the doc stays wrong. Follow-up.
- [ ] `/sdd-triage` T-2's substring severity match stays fragile for the *issue* path if Issues are
      re-enabled. The `--from-report` path avoids it. Not hardened by this feature.
- [ ] Merge-order: PR #810 edits `test-data/SKILL.md`, which this feature deletes. Land #810 first,
      then rebase. **Not** recorded in `merge-order.md` — that table tracks hard constraints keyed by
      feature slug, and #810 is a `claude/*` branch with a trivially-resolved delete/modify conflict.

## Files Modified

_(none yet — artifacts only)_

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
