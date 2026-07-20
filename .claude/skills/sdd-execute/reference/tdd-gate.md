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
   it asserts the *new* behavior — not a tautology.
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
   - the step's **`context.md`** entry (one line: "red: <assert> failed → green: passed").
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
