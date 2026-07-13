# design-buddy review — plan review criteria

These are the criteria a `reviewer` subagent applies to a design-buddy plan. The agent reads
this file, the plan, and the design inputs (design doc + recon dossier when they exist),
verifies code-checkable claims against the actual repository, and returns a structured verdict.

**Severity mapping.** A finding tied to a Floor rule (`DF-*`, or a host hard rule per `DF-6`) is
a `BLOCKER` by definition — the review cannot pass over it, and BLOCKERs cannot be waived
(**DN-6**). Everything else defaults to `WARNING` unless purely informational (`NOTE`).

## A. Per-step quality

Apply to each numbered step:

| Criterion | Fails when | Severity |
|---|---|---|
| Evidence populated | `**Evidence**` is empty, says "TBD", or contains only placeholder text | BLOCKER (`DF-1`) |
| Evidence is real | A cited path/symbol/line does not resolve when checked against the repo | BLOCKER (`DF-1`) |
| Files are exact | Any `**Files**` entry contains a wildcard, "somewhere in", or names a directory rather than a file (a create-new file path is fine) | BLOCKER (`DF-1`) |
| Instructions reference confirmed symbols | A symbol in `**Instructions**` is neither confirmed in `**Evidence**` nor marked "**Not found** — created from scratch" | BLOCKER (`DF-1`) |
| Verification is executable or observable | `**Verification**` is empty, or is vague prose ("verify it works") with neither a runnable command nor an exact observable outcome | WARNING |
| Verification uses the repo's own commands | A verification/test command names a tool, script, or threshold with no `path:line` citation showing the repo declares it | BLOCKER (`DF-1`) |
| Test field present | A code-bearing step has no `**Test**` entry and no `N/A (<reason>)` | WARNING |
| Test asserts new behavior | The paired test described would pass against the pre-implementation tree (a tautology) | WARNING |
| Schema/migration rollback | A step adds to a schema/migration chain that has rollback counterparts (down files) in the repo, but lists none | WARNING |
| Contract identifiers stated | A step changes a public contract (API route, message schema, exported surface) without stating the identifiers that must not be reused or broken | WARNING |
| Symmetry | A step implements one variant of an enumerated set found in the repo (one of several providers, states, platforms, order/kind values) without stating coverage of the others or explicitly scoping them out | WARNING |
| Step size | `**Files**` lists more than ~5 files — consider splitting | NOTE |

## B. Design fidelity (when a design doc exists)

| Criterion | Fails when | Severity |
|---|---|---|
| Chosen Approach honored | A step implements something the design doc decided differently, without a surfaced conflict | BLOCKER (contradicts the approved design — `DF-2`) |
| Rejected Alternatives stay rejected | A step reintroduces an alternative the design doc rejected | BLOCKER (`DF-2`) |
| Open Risks covered | A design `## Open Risks` checkbox has no covering step and no `## Step Dependencies` note | WARNING |
| Reuse targets used | A step re-creates something the recon's **Patterns to REUSE** names as an existing pattern | WARNING (`DN-2`) |

When no design doc exists (plan produced from scratch), skip section B and add a `NOTE` that
fidelity checks could not run.

## C. Host-repo rules

| Criterion | Fails when | Severity |
|---|---|---|
| Hard rules honored | Any step instructs a violation of a hard rule quoted in the recon's **Host Conventions & Hard Rules** (or found directly in the repo's convention files) — cite the rule verbatim + `path:line` | BLOCKER (`DF-6`) |
| Conventions followed | A step ignores a non-absolute convention (naming, layout, lint) the repo documents | WARNING |

## D. Plan structure and ordering

| Criterion | Fails when | Severity |
|---|---|---|
| Dependencies before dependents | A step depends on another step's output (schema, contract, helper) that appears later with no `## Step Dependencies` entry | BLOCKER |
| Dependencies declared | `## Step Dependencies` says "none" but steps clearly have ordering constraints | WARNING |
| Tree stays consistent | Executing the steps in order would leave the tree broken between steps (consumer lands before its contract) | WARNING |
| Header complete | The plan header lacks `**Status**`, `**Test harness**`, `**Total Steps**`, or `**Review**` | WARNING |

## Verdict shape the agent returns

A per-step ✓/⚠/✗ table plus a summary, per the `reviewer` agent's output format. Every BLOCKER
must name the rule it ties to (`DF-*` ID or a quoted host rule) — a BLOCKER with no floor tie is
a mis-classified WARNING.
