# sdd-execute — TDD gate (red-before-green)

Load this in **Phase 3** when the current step is **code-bearing**. It enforces Constitution
**P-06** (red-before-green) and **C-08** (test pairing): a code-bearing step must prove a failing
test before implementation and a passing test after.

## Which steps are code-bearing

Apply the gate when the step's category is `service` or `test`. **Skip** it (record `TDD: N/A`) for
non-code-bearing categories — `docs`, `config`, `proto`, `proto-gen`, and `migration`-only steps —
since they introduce no executable logic to test. The step's `**TDD**` line (set by `/sdd-spec`)
declares which case applies; honor it, and if a `service` step is mislabeled `N/A`, treat it as
code-bearing anyway.

## The protocol

A `service` step and its paired `test` step (Constitution **C-08**) form one red-green cycle. Run it
in this order, regardless of which step number you are technically executing:

1. **Write/confirm the failing test first.** Author (or confirm already-authored) the paired test so
   it asserts the *new* behavior — not a tautology. The behavior it asserts is the `@AC-*` scenario
   named in the step's `**Covers**` line (Constitution **C-15**); the test realizes that scenario's
   `Given/When/Then`. If a code-bearing step has a `**Covers**` scenario, the RED assertion is that
   scenario's `Then` failing today.

   **If the step is a `service` step mislabeled `TDD: N/A`** — the one hole named above, where no
   paired test and no RED assertion were specced — spawn the **`qa-tester`** subagent (read-only,
   advisory — **P-01**) with the step's `**Instructions**`, `**Files**`, `**Codebase Evidence**`, and
   the service's language. Use its `## Test plan` to pick the file and the RED assertion; **you**
   remain the writer. Record the agent-supplied assertion as a deviation
   (`reference/deviation-handling.md`) — a step that specced no test is a spec defect, and papering
   over it silently would hide that (**P-03**). Do **not** spawn it for a correctly-specced step:
   the step's own test and `**Verification**` already dictate the cycle, and a Task round-trip in
   the tightest loop of every code-bearing step is pure cost.
2. **Run it — capture RED.** Execute the test against the pre-implementation tree. It **must fail**,
   and fail for the right reason (the behavior is missing, not a typo/import error). Capture the exact
   failing output. If it passes here, the test does not actually cover the new behavior — fix the test
   before writing any implementation.
3. **Implement minimally.** Apply only the confirmed Phase-2 change to make the test pass — no extra
   scope (HARD CONSTRAINTS still apply).
4. **Run it — capture GREEN.** Re-run the same test; it **must pass**. Capture the passing output
   (including the coverage line where the threshold applies).
5. **Record red→green.** Put both captures in:
   - the **PR body** (a short "TDD: red → green" block with the two command outputs), and
   - the step's **`context.md`** entry (one line, naming the scenario: "AC-2 red: <assert> failed →
     green: passed").
   Do **not** record TDD evidence by editing the step body in `implementation-spec.md` — those fields
   are immutable (**F-09**). Evidence lives in the PR body and `context.md` only.

## Interaction with the existing flow

- This gate runs **inside** Phase 3, after Phase-2 confirmation and before you mark the step `done`.
  The step's existing `**Verification**` command is usually the green run (step 4) — reuse it; you do
  not invent a second command.
- If the test cannot be made to fail first because the behavior already exists (e.g. the step is a
  refactor with no behavior change), note "red N/A — no behavior change; characterization test added"
  in the PR body and `context.md`, and still capture the green run. This is the one allowed escape and
  must be stated explicitly — never skip the gate silently (**P-03**).
- A genuine inability to satisfy red→green within the step's scope is a deviation: follow
  `reference/deviation-handling.md` (and log a `fails.md` ledger entry if it reveals a recurring trap).
- **When `qa-tester` was consulted**, its plan advises — it never expands the step. The confirmed
  Phase-2 change and the step's `**Files**` list still bound what you stage (**F-08**).
- **Its `## Defects found` section is out of scope for this step.** A pre-existing defect it surfaces
  does not get fixed here. Note it in `context.md` and hand it to `/sdd-qa defect` once the step
  lands; a recurring one is a `fails.md` candidate.
- **A green suite is not automatically coverage.** A suite that exits 0 while executing zero
  assertions proves nothing — see `docs/roadmap/ledger/fails.md` (2026-07-29, feature 074), where a
  `try { await import(…) } catch {}` guard printed "7 tests, 7 pass" while hiding three real
  blockers. Before accepting a green, confirm the cases actually executed.
