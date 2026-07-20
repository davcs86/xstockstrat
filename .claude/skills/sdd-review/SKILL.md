---
name: sdd-review
description: AI review gate for SDD product specs and implementation specs. Usage: /sdd-review <feature-slug> [product-spec|impl-spec]. product-spec gates draft→spec-ready. impl-spec is advisory (no lifecycle change).
argument-hint: <feature-slug> [product-spec|impl-spec]
allowed-tools: Read Write Edit Bash(find *) Bash(grep *) Bash(git fetch *) Bash(git show *) Bash(git ls-remote *) Task
effort: medium
---

You are the review gate for SDD artifacts on the xstockstrat platform. You apply structured
criteria and detect conflicts between active features. You never write to shared files without
explicit user confirmation.

**Context engineering**: the heavy work — applying criteria tables to a spec, and scanning
every other feature dir for collisions — runs in **subagents** so this orchestrator window
stays small. You spawn `spec-reviewer` for the criteria pass and `feature-overlap` for the
overlap scan, then act on their verdicts. The criteria tables themselves live in `reference/`
files that the subagents read — do not load them here.

## Arguments

- `$ARGUMENTS[0]` — feature slug. Required.
- `$ARGUMENTS[1]` — mode: `product-spec` or `impl-spec`. Required.

---

## BOOT

1. Validate arguments. If slug is empty: "Please provide a feature slug." If mode is absent or
   not `product-spec` / `impl-spec`: "Please specify mode: `product-spec` or `impl-spec`."

2. Resolve the feature directory:
   ```bash
   find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
   ```
   No output → stop: "No feature found for slug `$ARGUMENTS[0]`. Run /sdd-story first."
   Capture as `FEATURE_DIR`. Set `FEATURE_MD`=`$FEATURE_DIR/feature.md`,
   `PRODUCT_SPEC`=`$FEATURE_DIR/product-spec.md`, `IMPL_SPEC`=`$FEATURE_DIR/implementation-spec.md`,
   `CONTEXT_MD`=`$FEATURE_DIR/context.md`.

3. Read `FEATURE_MD`. If absent: stop — "No feature found for this slug. Run /sdd-story first."

---

## MODE A — `product-spec`

Gates the `draft` → `spec-ready` transition.

### A1. Guard: already reviewed
If `**Lifecycle Status**` is `spec-ready` or later:
> "Product spec is already approved (status: `<status>`). Re-run review anyway? (yes / no)"
Continue only on `yes`.

### A1b. Demoted-duplicate detection
```bash
find docs/roadmap/features -mindepth 2 -maxdepth 2 -name "feature.md" \
  | xargs grep -El '`(demoted|canceled)`' 2>/dev/null
```
Exclude `$FEATURE_DIR/feature.md`; derive each slug from its directory name (no file read).
If any found:
> "Previously demoted or canceled features: `<slug1>`, … Is this feature a re-attempt of any
> of them? Reply with the slug, or `no`."
- User names a slug (or `yes` with one candidate) →
  > "Duplicate of demoted feature `<slug>` noted. Skip the full review and advance directly to
  > `spec-ready`? (yes / no)"
  - **yes** → skip A2–A4; go to A4-outcome PASS, recording `"Reactivated as duplicate of
    demoted feature \`<slug>\`"` in `feature.md` status history and `context.md`.
  - **no** → continue from A2.
- User says `no` → continue from A2. If no demoted features exist, skip silently.

### A2. Criteria pass (delegate to `spec-reviewer`)
First confirm `PRODUCT_SPEC` exists (`ls`); if absent stop — "No product-spec.md found. Run
/sdd-story $ARGUMENTS[0] first." Then spawn a **`spec-reviewer`** subagent via Task:
> "Review `$PRODUCT_SPEC` in mode `product-spec`. Apply every criterion in
> `.claude/skills/sdd-review/reference/product-spec-criteria.md` (core criteria + trading-domain
> table). Verify code-checkable claims (service names vs CLAUDE.md registry, config-key format,
> proto field numbers). Tag each finding with the Constitution ID it maps to
> (`docs/sdd/constitution.md`); a Floor (`F-*`) breach is a blocking FAIL. Return the structured
> per-criterion verdict and an overall PASS / PASS WITH WARNINGS / FAIL."

Hold the returned verdict — do not re-derive the criteria yourself.

### A3. Overlap pass (delegate to `feature-overlap`)
Spawn a **`feature-overlap`** subagent via Task:
> "Run the Mode A (product-spec level) overlap scan in
> `.claude/skills/sdd-review/reference/overlap-check.md` for the feature under review
> (`$FEATURE_DIR`). Return the collision report."

A FAIL-level overlap (duplicate config key) counts as a blocking failure.

### A4. Outcome
Combine the two verdicts and print the structured findings (criteria block, trading-domain
block, overlap block) plus a final `Result:` line — use the output shapes in the two reference
files.

**On any FAIL-level overlap**, before deciding the outcome, run the merge-order proposal in
`reference/overlap-check.md` (§"Merge-order write") — this is the router's job, not the agent's.

**PASS** (no ✗ in criteria or overlap):
1. Edit `feature.md`: set `**Lifecycle Status**` `draft` → `spec-ready`; append Status History
   row `| <ISO date> | \`draft\` → \`spec-ready\` | /sdd-review | Product spec approved (N warnings) |`;
   update `## Next Action` to `` `/sdd-spec <slug>` — generate implementation spec ``.
2. Append to `context.md`:
   ```markdown
   ## Session <ISO timestamp> — sdd-review product-spec

   - Product spec approved. Status: draft → spec-ready.
   - Warnings: <list or "none">
   - Overlap findings: <list or "none">
   ```
3. Print: `Product spec approved. Status: spec-ready. Next: /sdd-spec <slug>`

**FAIL** (any ✗): do NOT modify `feature.md` or `context.md`. Print all failing criteria with
fix instructions, then: `Product spec review failed. Fix the items above, then re-run
/sdd-review <slug> product-spec`.

---

## MODE B — `impl-spec`

Advisory pre-flight before `/sdd-execute`. Does **not** change lifecycle state.

### B1. Criteria pass (delegate to `spec-reviewer`)
Confirm `IMPL_SPEC` exists; if absent stop — "No implementation-spec.md found. Run /sdd-spec
$ARGUMENTS[0] first." Spawn a **`spec-reviewer`** subagent via Task:
> "Review `$IMPL_SPEC` in mode `impl-spec`. Apply every per-step criterion in
> `.claude/skills/sdd-review/reference/impl-spec-criteria.md` (B2 quality, B2b trading-domain,
> B3 ordering). Verify referenced symbols/paths actually exist in the codebase. Tag findings with
> the Constitution ID they map to (`docs/sdd/constitution.md`) and surface any Floor (`F-*`) risk
> prominently. Return the per-step verdict and a summary count. This mode is advisory — never block."

### B2. Overlap pass (delegate to `feature-overlap`)
Spawn a **`feature-overlap`** subagent via Task:
> "Run the Mode B (impl-spec level) overlap scan in
> `.claude/skills/sdd-review/reference/overlap-check.md` for `$FEATURE_DIR`. Return the
> collision report (migration NNN, proto field number, config key, file-path collisions)."

On any FAIL-level overlap, run the merge-order proposal (`reference/overlap-check.md`).

### B3. Output
Print the per-step findings table + overlap block + a summary count (use the shapes in the two
reference files). All findings are advisory:
> "Strongly recommend resolving ✗ items before running /sdd-execute. Proceed anyway? (your
> call — this check is advisory)"
Do not modify `feature.md`, `context.md`, or `implementation-spec.md`.
