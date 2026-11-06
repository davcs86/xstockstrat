# Context: batch-execute-token-reduction

**Feature**: `docs/roadmap/features/301-batch-execute-token-reduction/feature.md`
**Product Spec**: `docs/roadmap/features/301-batch-execute-token-reduction/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/301-batch-execute-token-reduction/implementation-spec.md`

---

## Decisions

- **Prior design input.** A design-buddy `full` debate ran before this story, on 2026-11-06 in the originating session: 12 rounds, with the 5-round cap waived by the operator for convergence. It produced the approved design that FR-1..FR-9 encode. `/sdd-design` should treat it as the starting proposal, not re-derive it.
- **Operator gate decisions from that debate** (binding unless the operator changes them):
  - **D1.** Past relaunches were fresh runs with new args, not `resumeFromRunId`. Setup re-ran because runs died, crashed or hit the 5h usage limit.
  - **D2.** The upfront validate result travels in the approval payload (`halted.record` → `approvals.upfront.record`). Nothing is written to the repo before the §5.4 confirm. This was chosen over a context.md write-gate because the F-10 reading of `sequential-mode.md:188-190` is ambiguous.
  - **D3.** context.md is always read in full (C-02). Size is handled by an approvable `distill` gate that points to `/sdd-distill`.
  - **D4.** An explicit `{gate:'resume'}` replaces any setup-done cache. A stale `resume` after a real checkpoint halt is an accepted risk.
  - **D5.** Verification stays at today's baseline: the agent judges as SKILL.md PHASE 3. Only the output volume is reduced (fence run verbatim in `( … ) > log`). A deterministic runner was rejected after rounds 2–11 kept finding false-PASS holes.
  - **D6.** Both new agents stay on `opus`. A tier change is not an input-token lever, and these stages gate irreversible writes (`docs/patterns/context-engineering.md:51`).
- **Rejected alternatives** (from the debate):
  - a step card restating the skill (DRY drift);
  - a deterministic Codebase-Evidence checker (evidence is prose, `.claude/skills/sdd-spec/reference/spec-template.md:43-45`);
  - a persistent worktree;
  - sonnet tiering;
  - a setup-done cache;
  - a context.md write-gate;
  - a header-only context.md read;
  - global `pipefail`, a pipe-position MASKED classifier, per-command markers and redirects;
  - tooling setup once per feature;
  - replacing discover.

## Open Threads

- [ ] Decide the `/sdd-design` mode: `quick`, seeded with the prior design (recommended), or a full re-debate. Target: `/sdd-design`.
- [ ] Calibrate `CONTEXT_MAX` and prove agentType + worktree composition. Target: FR-9 spike (PR-0) step.
- [ ] Follow-ups out of scope, to file after launch:
  - `-X ours` at `sdd-batch-execute.js:163` → resolver;
  - define "session" in `tooling-setup.md`;
  - scoped integration-pr type;
  - a `/sdd-spec` unguarded-pipe rule;
  - the existing `:178` respec commit that bundles feature.md + context.md.

## Files Modified

- `docs/roadmap/features/301-batch-execute-token-reduction/{status.md,feature.md,product-spec.md,acceptance.feature,context.md}` (created)

---

## Session 2026-11-06T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 301 reserved via `scripts/sdd-allocate-feature-number.sh` (`sdd/feature-cursor`).
- Consumer surface (C-14): **None**. Internal SDD tooling, used by the operator through the `/sdd-batch-execute` saved workflow.
- Ledger traps surfaced in product-spec Open Questions:
  - `fails.md:3086-3097` (-X ours)
  - `fails.md:3250-3252`, `:3381-3383`, `:3451-3453` (stale digests/prompts)
  - `fails.md:3361-3363` (inert husky)

## Session 2026-11-06T00:30:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: feature/batch-execute-token-reduction@29cf6b4.
- Review loops:
  - Loop 1 — FAIL (criterion 9: unchecked Open Questions) + W1–W6.
  - Loop 2 — PASS WITH WARNINGS (6 minor scenario gaps).
  - Loop 3 — PASS, 0 warnings.
- Fixes, all landed as separate per-file commits:
  - Open Questions split into Known Traps / Accepted Risks.
  - 40-hex literals.
  - `@prompt-contract` / `@manual-spike` tags.
  - AC-18..AC-23 appended (IDs append-only).
  - Unified setupDone fence wording; named the `Stops at` column.
- Warnings: none.
- Overlap findings: none. Low-risk shared dir only: 295 edits `.claude/skills/sdd-execute/reference/repo-conventions.md`, not SKILL.md.
- Recommended design depth: quick (no runtime service, no proto, no migration, no overlap; prior design-buddy debate approved).

## Session 2026-11-06T01:30:00Z — sdd-design (in progress)

- Phase 0 recon written (`recon.md`, commit ca20083).
- Round 1: floor CLEAR. 7 MAJOR and 12 MINOR objections; all adopted for round 2.
- Operator gate decisions at round 1 (P-04):
  - **D7.** Resolver exit 2 during setup → `git merge --abort`, no commits, `completed:false`, unresolvable list surfaced (merge-train parity, `merge-train.js:108-110`).
  - **D8.** `/sdd-distill` + `context-distiller` must carry every fenced `sdd-batch-*` block verbatim. This expands scope beyond product-spec FR-8's file list; to be folded in at the end of the design.
  - **D9.** After setup makes a `respec(` commit, end the run with a `resume` halt so the next relaunch re-parses the branch tip (`fails.md:3250-3252,3449-3453`).
- Round 2: floor CLEAR. 6 of 7 round-1 majors closed. New majors N1–N5 (checker lacks ToolSearch; hook liveness; false discover stamp; wrong contextBytes path; keep-verbatim granularity) plus minors N6–N14.
- Operator gate decisions at round 2 (P-04):
  - **D10.** Inert pre-commit hook (`.husky/_` missing / `core.hooksPath` unset — true in this container): setup runs `pnpm install` once in the main worktree, which triggers husky via `package.json` `prepare`, then re-checks. If the hook is still inert, it becomes a tooling blocker. This touches the shared `.git/config` `core.hooksPath`; accepted by the operator.
  - **D11.** AC-19 is kept as is: `SKILL.md:301`'s "Report the exact output" is replaced for all modes, interactive `/sdd-execute` included.
- Round 3: floor CLEAR. N1, N3, N4 and N5 closed; D10 mechanics verified (husky ^9.1.7 `prepare` sets the shared `core.hooksPath=.husky/_`).
- New majors M1–M3:
  - M1 — symlinks show as untracked, because dir-only gitignore patterns don't match symlinks. Verified empirically; `info/exclude` fixes it. This is pre-existing: writerRules item 2 already symlinks `node_modules`.
  - M2 — the install lock can leak on a Bash timeout.
  - M3 — hook output bloats every commit.
- Operator gate decisions at round 3 (P-04):
  - **D12.** Sign-off on the design-phase spec delta: FR-1..FR-9 rewording; AC-2 and AC-17 amended; AC-21 inverted (distill halt → blocked "unreadable"); AC-24..AC-34 added. Record a Spec Changes table in design.md, then re-run `/sdd-review product-spec` before `/sdd-spec`.
  - **D13 (refines D10).** If the hook is inert:
    - if `$M/node_modules/.bin/husky` exists, run `(cd $M && pnpm exec husky)`;
    - run `pnpm install --frozen-lockfile` only when `$M/node_modules` is missing.
- Round 4: floor CLEAR. M1–M3 closed; D13 compliant. 5 new majors:
  - template-literal `${HUSKY-}` parse break;
  - round-3 clauses dropped in the merge (non-hex gate, AC-17 vs AC-34 ToolSearch, AC-21);
  - preflight `hookLive` and the writer's HOOK_CHECK diverge (resume blocker loop);
  - AC-25/AC-41 stale or vacuous, Spec Changes table rows missing;
  - integration-pr reports done with no commit.
  - Plus 7 minors (m1–m7).
- Operator gate decisions at round 4 (P-04):
  - **D14.** Run round 5 (the cap). The proposer emits one fully merged final design (round 3 + round 4 + round-4 fixes), not a delta.
  - **D15 (fixes MAJOR-3).** One shared HOOK_CHECK constant. Preflight `hookLive` runs it against the main checkout, and each clause names its own failure. The step blocker's text depends on the failing clause. D10 scope is unchanged: only setup and hook-setup write `core.hooksPath`. Rejected: writer self-repair (it widens D10).
