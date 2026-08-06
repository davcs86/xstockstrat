# Context: qa-capability  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as pure AI-tooling/governance — a read-only `qa-tester` subagent (advisory) paired
with a write-capable `sdd-qa` skill, absorbing `/test-data`, appending Constitution C-13, and
replacing the originally-planned `gh issue create` defect path with a `docs/reports/` +
`/sdd-triage --from-report` path. Zero `services/**` behavior changed beyond two comment lines.

**Why (irrecoverable rationale)**: three testing-lifecycle gaps had no owner (test design/authoring,
cross-service coverage aggregation, flake detection). Whole-monorepo scope was chosen, not
frontend-only, because backend services carry the financial-integrity risk and had no
test-authoring help today. C-11 (the mandatory SDD entry-point gate) was honored rather than argued
around: zero of 79 prior features had registered a `.claude/`-only change, so precedent said the
gate could be skipped — the pipeline was run anyway specifically because this feature amends the
Constitution itself.

**Rejected alternatives**:
- `gh issue create` — the primary path is permanently dead (`POST /issues` → `410`).
- Re-enable GitHub Issues — `bug-report.yml`'s `SEV-1 safety check` checkbox-group label forces
  every rendered issue to contain the literal string "SEV-1", misrouting all severities to Track A
  regardless.
- Amend C-12 in place (vs. append C-13 + narrow C-12) — a bare in-place amendment would silently
  falsify launched feature 069's recorded "C-12 does not apply" and 072's design decision, since the
  Constitution has no amendment log.
- Amend C-12 in place plus add a `## Amendments` log — a more refined variant, separately rejected:
  workable, but readers of 069 must know to consult the log; C-13 keeps the invariant without new
  machinery.
- Drop the C-12 widening entirely — removes the enforceability problem but leaves backend test data
  ungoverned.
- Ship `sdd-qa` read-only in v1 — the cleanest option against P-01/F-08/F-10, rejected because it
  loses the "writes the test for you" ergonomics that are a real part of the value; superseded by
  the boot interlock (FR-9), which is what makes the write-capability constraint falsifiable rather
  than just asserted.
- A single write-capable `qa-tester` agent (one agent doing both design/advisory AND writing),
  instead of the subagent+skill split — rejected specifically because it would have required a
  Constitution amendment to the seven-agent-fleet's read-only invariant ("no agent has
  Write/Edit/Bash"); the subagent+skill split preserves P-01 with no amendment needed at all.
- A directory denylist for the write boundary ("never edit `src/`, `app/`, `internal/`") — blocks
  test-authoring for 8 of 12 services, since Go tests live in `internal/`/`cmd/` and Node tests in
  `src/__tests__/`. Replaced with a file-pattern allowlist.
- Spawn `qa-tester` as a second agent in `sdd-design` Phase 0 coverage read — doubles agent count on
  every future design run forever for marginal prompt gain; extended `codebase-discovery`'s existing
  brief instead.
- Add a `json` reporter to `playwright.config.ts` for flake detection — the config's reporter field
  is a ternary needing both branches patched, the json reporter needs an extra env var, and a config
  edit can't force per-invocation `--retries=0`. CLI flags solved all three and removed the only
  `services/**` edit.

**Scars & gotchas**:
- The feature-number allocator (`/sdd-story` Step 3) scans only the local working tree; it collided
  `080` with an unmerged branch (`080-fix-backfill-timeframe-enum` live on two `claude/*` branches).
  Caught by the user, not tooling — a repeat of historical `020`/`052` duplicates (already recorded
  in `docs/roadmap/ledger/fails.md`, 2026-07-29 — 081-qa-capability — assumption).
- The GitHub-metadata-vs-measured-behavior assumption (`has_issues: true` vs `410`) is recorded in
  `docs/roadmap/ledger/fails.md` 2026-07-29 — its Evidence line has been amended (2026-08-06, as
  part of this archival) to inline the resolution, since it previously pointed only at this
  feature's now-deleted `design.md`.
- A rebase-forced rewrite of a spliced description line incidentally caught a pre-existing defect
  from PR #810: its "classifies severity (SEV-1…SEV-4)" claim was wrong — `bug-report.yml` and
  `sdd-triage` only define/map SEV-1/2/3. Fixed opportunistically because the line had to be
  rewritten anyway — a one-off correction, not a recurring pattern.
- `check-context-map.sh` and both removal gates had to be re-run at **every rebased commit**, not
  just the tip, because a rebase rewrites every SHA and prior verification evidence does not carry
  over.

**Permanent deviations**: none technical — the Floor-breach resolution (`docs/reports/` +
`--from-report`) is exactly what shipped. The one real deviation is **process**, not technical
design: `/sdd-spec` and `/sdd-execute` were bypassed entirely — implementation ran as 3 atomic
commits directly from the approved plan, with no `implementation-spec.md` ever generated.
Substitutions: `/sdd-design` Phase 0 recon stood in for per-step discovery; one up-front plan
approval stood in for per-step confirmation; `check-context-map.sh` run at every commit (not just
the tip) stood in for per-step verification; the TDD red-before-green gate was ruled N/A because the
feature ships no executable logic (pure `.claude/`/`docs/` tooling). C-11's minimum
(`/sdd-story` → `/sdd-design quick` → ledger touch) was still honored since `/sdd-spec`/`/sdd-execute`
are not part of that minimum.

**Cross-feature signal**: The metadata-vs-measured-behavior assumption is the **third recorded
recurrence** of the same failure family (2026-07-27 / 072 serializer contract; 2026-07-29 / 074 a
suite that never executed; 2026-07-29 / 081 this feature) — already flagged in `fails.md` as a
strong candidate for promotion to a binding Constitution `P-*` rule rather than a fourth ledger
entry.

**Deferred follow-ons**:
- `sdd-qa flake` end-to-end and the 12-service `sdd-qa gaps` sweep were never executed (flake needs
  a built Next.js app + browsers; the sweep is 12 agent spawns) — marked unchecked in PR #811. First
  real exercise is still pending.
- Flake **tracking** (as opposed to detection) was explicitly deferred too — no cross-run
  persistence exists in this repo to build historical-trend tracking on.
- `docs/patterns/ci-overview.md:18` is stale (`node-test` ×4; `ci.yml` runs 5); `sdd-qa gaps` sources
  from `ci.yml` directly to avoid inheriting the drift, but the doc itself was never fixed.
- `/sdd-triage`'s substring severity match (`Contains "SEV-1"` tested first) stays fragile for the
  **issue** path (not the new `--from-report` path) if GitHub Issues are ever re-enabled — not
  hardened by this feature.
- `.github/ISSUE_TEMPLATE/bug-report.yml`'s stale `affected_services` list (three dead
  pre-consolidation UI entries, missing `xstockstrat-agent`) was left unfixed — dead config while
  Issues are disabled, but a trap if they're ever re-enabled.
- The boot interlock (FR-9) — the load-bearing mechanism separating advisory `qa-tester` from
  write-capable `sdd-qa` — was pattern-verified but **never exercised against a real in-progress
  feature** at ship time (no feature was `in-progress` during testing). First real use is the true
  test of whether it actually refuses a write.

**Ledger entries written**: insights.md (3), fails.md (0 new — 1 existing entry amended: see Scars).
**Runtime-invariant recommendations (→ /context-constitution)**: none — the one candidate (the
`.claude/agents/*.md` validator gap in `check-context-map.sh`) was found and fixed in this feature's
own commit 1, so it's not an open invariant; it's already enforced by shipped code.
**Pruned artifacts**: product-spec.md, recon.md, design.md — last present at
`fe278020abe1e4b0c128a7a2207fd46596d8a9e8`.
