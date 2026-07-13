# design-buddy plan — step-writing rules

Load this before writing any plan step.

## The zero-assumption rule (DF-1)

Before writing a step instruction, verify you hold evidence (grep, Read, or a discovery digest)
for every reference in it. Vague instructions hide invented references — rewrite them concrete:

- ✗ "add a handler function"
  ✓ "add `handleExport(req, res)` to `src/api/reports.ts` after `handleDownload` at L88,
  matching its signature and error-wrapping pattern"
- ✗ "create a migration"
  ✓ "create `migrations/0042_add_export_jobs.sql` — confirmed the last file in the chain is
  `0041_add_report_tags.sql`"
- ✗ "update the config"
  ✓ "add key `reports.export.enabled` following the existing feature-flag read at
  `src/config/flags.ts:L34`"
- If a file or function is not found: write "**Not found** — created from scratch; no existing
  pattern available in the codebase" in the step's Evidence — never a guessed path.

## Verification commands

Every step carries a `**Verification**` that a future session can run or observe without
interpretation:
- Prefer the repo's own commands, exactly as the Repo Profile cited them (manifest script,
  Makefile target, CI job step) — cite `path:line` for where the command is declared.
- If nothing runnable exists for the step, state the exact observable outcome ("GET /reports/export
  returns 202 with a job id") instead — never "verify it works".

## Test pairing

Use the Repo Profile's **Test & quality harness** finding:

- **Harness detected** → every code-bearing step gets a `**Test**` entry: the test file to create
  or extend (following the pattern found in discovery item h), and the repo's own test command
  as the runnable check. Author the test to fail against the pre-implementation tree and pass
  after — it asserts the new behavior, not a tautology. Never assume a coverage threshold: if CI
  declares one, cite it `path:line` and use it; otherwise omit thresholds entirely.
- **No harness detected** → set the plan header's `**Test harness**` field to "none detected —
  steps carry manual verification", and give each code-bearing step a concrete manual
  `**Verification**`. Do not invent a test framework for the repo.
- Docs-only / config-only / mechanical-rename steps: `**Test**: N/A (<reason>)`.

## Lint / format

If the Repo Profile found a lint or format command, append it to the `**Verification**` of every
step that edits code in its scope. If none was found, do not invent one.

## Step granularity and ordering

- One step = one reviewable unit of change (a commit's worth). Split a step whose Files list
  crosses unrelated areas.
- Order steps so every step leaves the tree consistent (buildable, tests passing) — contracts
  and schemas before their consumers, shared helpers before their callers.
- Declare every ordering constraint in `## Step Dependencies`; a future session may otherwise
  execute steps in any order.
- Steps honor the design doc's Chosen Approach; its Rejected Alternatives are off the table. If
  planning exposes a genuine conflict with the chosen design, stop and surface it to the user
  (**DF-2**) — do not quietly redesign in the plan.
