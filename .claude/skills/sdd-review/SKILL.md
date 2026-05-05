---
name: sdd-review
description: AI review gate for SDD product specs and implementation specs. Usage: /sdd-review <feature-slug> [product-spec|impl-spec]. product-spec gates draft→spec-ready. impl-spec is advisory (no lifecycle change).
argument-hint: <feature-slug> [product-spec|impl-spec]
allowed-tools: Read Write Edit Bash(find *) Bash(grep *) Bash(git fetch *) Bash(git show *) Bash(git ls-remote *)
effort: medium
---

You are reviewing SDD artifacts for the xstockstrat platform. You apply structured
criteria and detect conflicts between active features. You never write to shared files
without explicit user confirmation.

## Arguments

- `$ARGUMENTS[0]` — feature slug. Required.
- `$ARGUMENTS[1]` — mode: `product-spec` or `impl-spec`. Required.

---

## BOOT

1. Validate arguments. If slug is empty: "Please provide a feature slug."
   If mode is absent or not one of `product-spec` / `impl-spec`:
   "Please specify mode: `product-spec` or `impl-spec`."

2. Resolve artifact paths:
   - `FEATURE_MD` = `docs/roadmap/features/$ARGUMENTS[0]/feature.md`
   - `PRODUCT_SPEC` = `docs/roadmap/features/$ARGUMENTS[0]/product-spec.md`
   - `IMPL_SPEC` = `docs/roadmap/features/$ARGUMENTS[0]/implementation-spec.md`
   - `CONTEXT_MD` = `docs/roadmap/features/$ARGUMENTS[0]/context.md`

3. Read `FEATURE_MD`. If absent: stop — "No feature found for this slug. Run /sdd-story first."

---

## MODE A — `product-spec`

Gates the `draft` → `spec-ready` lifecycle transition.

### A1. Guard: already reviewed

If `**Lifecycle Status**` in `feature.md` is `spec-ready` or any later status:
> "Product spec is already approved (status: `<status>`). Re-run review anyway? (yes / no)"

Only continue if the user confirms `yes`.

### A2. Read inputs

- Read `PRODUCT_SPEC`. If absent: stop — "No product-spec.md found. Run /sdd-story $ARGUMENTS[0] first."
- Read `docs/runbooks/reviewer-registry.md`.
- Read `## Reviewers` section from `FEATURE_MD` (may be absent if /sdd-story predates this change).

### A3. Apply review criteria

For each criterion below, assign: ✓ PASS / ⚠ WARN / ✗ FAIL.
WARN is advisory. FAIL blocks lifecycle advancement.

| # | Criterion | FAIL condition |
|---|---|---|
| 1 | **Problem Statement** | Vague, no persona named, or generic ("improve performance") |
| 2 | **Functional Requirements** | Not numbered, or any requirement is non-testable / ambiguous |
| 3 | **Out of Scope** | Section missing or has no explicit exclusion |
| 4 | **Affected Services** | Any service name does not exactly match the CLAUDE.md Service Registry |
| 5 | **Proto changes** | Proto changes listed but approval gate (additive vs. breaking) not flagged |
| 6 | **Config keys** | Any config key listed that does not follow `<service>.<category>.<key>` format |
| 7 | **DB changes** | Schema changes described but migration strategy (NNN naming, up+down, run order) not stated |
| 8 | **Acceptance Criteria** | Missing or not verifiable (no observable outcome stated) |
| 9 | **Open Questions** | Any `- [ ]` items remain unchecked and unresolved |

WARN (advisory, does not block):
- `## Out of Scope` has items but they seem insufficiently explicit
- Acceptance criteria exist but are qualitative rather than quantitative

### A4. Parallel feature overlap check

Discover all other currently active features:

```bash
find docs/roadmap/features -mindepth 2 -name "feature.md" | sort
```

For each `feature.md` found (excluding the current slug):
- Read it and check `**Lifecycle Status**`.
- If status is `spec-ready`, `implementation-ready`, `in-progress`, or `code-completed`:
  this is an active concurrent feature.
  - Read its `product-spec.md`.
  - Compare with the current spec's **Affected Services**, **Proto Contract Changes**,
    **Config Key Changes**, and **Database Changes** sections.

Apply this overlap table:

| Overlap type | Severity | Message |
|---|---|---|
| Same service in **Affected Services** | ⚠ WARN | "Feature `<other>` also modifies `<service>`. Coordinate merge order." |
| Same proto file named | ⚠ WARN | "Feature `<other>` also changes `<proto file>`. Risk of field number or message name conflict." |
| Same database table named | ⚠ WARN | "Feature `<other>` also touches table `<table>`. Risk of migration number collision." |
| Identical config key name | ✗ FAIL | "Feature `<other>` defines config key `<key>`. Duplicate keys cause runtime conflicts." |

**On any FAIL-level overlap:** propose a `merge-order.md` entry:
> "Conflict with `<other-slug>` detected. Propose adding a blocking dependency to
> `docs/roadmap/features/merge-order.md`. The blocked feature should be the one that
> will merge second. Add this entry? (yes / no)"

If user confirms `yes`: edit `docs/roadmap/features/merge-order.md`, add a row to the
Blocking Dependencies table:
```
| `<blocked-slug>` | `<other-slug>` | <reason> | No |
```
If user says `no`: note the conflict in the review output but do not write.

### A5. Output

Print a structured findings table:

```
/sdd-review product-spec: <slug>
══════════════════════════════════════════════════════

Spec Criteria:
  ✓ Problem Statement — specific, persona named
  ✓ Functional Requirements — 3 numbered, testable requirements
  ⚠ Out of Scope — items present but could be more explicit
  ✗ Config keys — key `trading.orders.retries` missing service-category-key format
  ...

Overlap Check (active concurrent features: <list or "none">):
  ⚠ Feature `add-polygon-source` also modifies `xstockstrat-marketdata`
  ...

Result: FAIL (1 spec failure, 0 overlap failures)
Fix the items marked ✗, then re-run: /sdd-review <slug> product-spec
```

Or on full pass:

```
Result: PASS (2 warnings — advisory only)
Advancing status: draft → spec-ready
```

### A6. Outcome

**PASS** (no ✗ failures in criteria or overlap):
1. Edit `feature.md`:
   - Change `**Lifecycle Status**: \`draft\`` to `**Lifecycle Status**: \`spec-ready\``
   - Append to Status History table:
     `| <ISO date> | \`draft\` → \`spec-ready\` | /sdd-review | Product spec approved (N warnings) |`
   - Update `## Next Action`:
     `` `/sdd-spec <slug>` — generate implementation spec from the approved product spec ``
2. Append to `context.md`:
   ```markdown
   ## Session <ISO timestamp> — sdd-review product-spec

   - Product spec approved. Status: draft → spec-ready.
   - Warnings: <list or "none">
   - Overlap findings: <list or "none">
   ```
3. Print: `Product spec approved. Status: spec-ready. Next: /sdd-spec <slug>`

**FAIL** (any ✗):
- Do NOT modify `feature.md` or `context.md`.
- Print all failing criteria with specific fix instructions.
- Print: `Product spec review failed. Fix the items above, then re-run /sdd-review <slug> product-spec`

---

## MODE B — `impl-spec`

Advisory pre-flight check before `/sdd-execute`. Does **not** change lifecycle state.

### B1. Read inputs

- Read `IMPL_SPEC`. If absent: stop — "No implementation-spec.md found. Run /sdd-spec $ARGUMENTS[0] first."
- Read `docs/runbooks/reviewer-registry.md`.
- Read `## Reviewers` section from `FEATURE_MD`.

### B2. Per-step quality check

For each numbered step in `implementation-spec.md`, apply:

| Criterion | FAIL condition |
|---|---|
| `**Codebase Evidence**` populated | Field is empty, says "TBD", or contains only placeholder text |
| `**Files**` has exact paths | Any path contains a wildcard, "somewhere in", or is a directory rather than a file |
| `**Instructions**` reference real symbols | Any symbol in Instructions is not confirmed in Codebase Evidence |
| `**Verification**` is runnable | Field is empty or describes a manual check with no bash command |
| Migration steps: NNN naming | Migration file name does not match `NNN_description.up.sql` pattern |
| Migration steps: down file | `.down.sql` counterpart not listed in `**Files**` |
| Proto steps: buf commands | `buf lint` and `buf breaking` not included in `**Verification**` |
| Proto steps: field numbers stated | Field numbers not specified for new fields |

WARN (advisory):
- `**Instructions**` are verbose but complete
- Step touches many files (>5) — consider splitting

### B3. Step ordering validation

- Flag FAIL if any `service` step has a dependency on a `migration` step that appears later in the spec.
- Flag FAIL if any `service` step has a dependency on a `proto-gen` step that appears later.
- Flag WARN if `## Step Dependencies` section is empty but steps clearly have ordering constraints.

### B4. Parallel feature overlap check (impl-spec level)

Discover features in `implementation-ready` or `in-progress` status (same bash command as A4).
For each, read its `implementation-spec.md`. Compare step-by-step:

| Overlap type | Severity | Message |
|---|---|---|
| Same file path in another feature's pending or in-progress `**Files**` | ⚠ WARN | "Feature `<other>` Step N also writes `<file>`. Merge conflict risk." |
| Same migrations dir + same NNN prefix | ✗ FAIL | "Feature `<other>` Step N creates the same migration number in `services/<svc>/migrations/`. Rename one before executing." |
| Same proto field number on the same message | ✗ FAIL | "Feature `<other>` Step N assigns field `<N>` on `<message>`. Field number collision." |
| Same config key name added | ✗ FAIL | "Feature `<other>` Step N adds config key `<key>`. Runtime conflict." |

On any FAIL-level overlap: propose adding a `merge-order.md` row (same confirmation flow as A4).

### B5. Output

Print a per-step findings table. No lifecycle change regardless of result.

```
/sdd-review impl-spec: <slug>
══════════════════════════════════════════════════════

Step 1 [proto: Add BrokerAccount message]
  ✓ Codebase Evidence populated
  ✓ Files exact paths
  ✗ Proto steps: field numbers not stated for new fields

Step 2 [migration: Add broker_accounts table]
  ✓ NNN naming correct
  ✓ down.sql listed
  ...

Overlap Check:
  ✗ Feature `add-account-base-schema` Step 2 creates migration 003 in
    services/xstockstrat-trading/migrations/ — same number as this spec Step 2.

Summary: 2 failures, 1 warning.
Strongly recommend resolving ✗ items before running /sdd-execute.
Proceed anyway? (your call — this check is advisory)
```

All findings are advisory. The user decides whether to run `/sdd-execute` regardless.
Do not modify `feature.md`, `context.md`, or `implementation-spec.md`.
