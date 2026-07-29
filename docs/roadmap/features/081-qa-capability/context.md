# Context: qa-capability

**Feature**: `docs/roadmap/features/081-qa-capability/feature.md`
**Product Spec**: `docs/roadmap/features/081-qa-capability/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/081-qa-capability/implementation-spec.md`

---

## Decisions

- **Split on write authority (P-01).** A read-only `qa-tester` subagent advises; a write-capable
  `/qa` skill executes. This keeps the seven-agent fleet's invariant intact — no agent has
  Write/Edit/Bash — so no Constitution amendment is needed for authority. User-selected over a
  write-capable agent class.
- **Whole-monorepo scope**, not frontend-only. Backend services carry the financial-integrity risk
  and have no test-authoring help today.
- **Defects file as GitHub issues**, then hand to `/sdd-triage <n>`. Chosen over a `docs/reports/`
  file because issues are enabled (`has_issues: true`) and `/sdd-triage` can only consume an issue.
- **`/test-data` is absorbed, not kept alongside.** Its three sub-commands become `/qa`
  sub-commands and the directory is deleted.
- **C-12 widens to all languages but materializes lazily.** The rule binds any language; the
  structure appears only on the second-consumer trigger. **Zero fixture directories are created by
  this feature.**
- **`/qa` keeps a slash entry point.** Dropping it would remove the only way to run a C-12 audit
  on demand.
- **Flake detection is in scope; flake tracking is not.** Historical trends need cross-run
  persistence, which does not exist in this repo.
- **C-11 honored rather than argued.** Zero of 79 prior features registered a `.claude/` change, so
  precedent said skip. Ran the pipeline anyway because this amends the Constitution.

## Open Threads

- [ ] Decide whether hardening `scripts/check-context-map.sh` to scan `.claude/agents/*.md` belongs
      in this feature or a follow-up — resolve at `/sdd-design`.
- [ ] Confirm at design time that no acceptance gate in this feature repeats the feature-079 removal
      -gate mistake (keying on vocabulary rather than on symbols that cease to exist).
- [ ] Merge-order: PR #810 edits `test-data/SKILL.md`, which this feature deletes. Land #810 first,
      then rebase. Record in `docs/roadmap/features/merge-order.md` before the deletion step.

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
