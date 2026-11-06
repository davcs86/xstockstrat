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
