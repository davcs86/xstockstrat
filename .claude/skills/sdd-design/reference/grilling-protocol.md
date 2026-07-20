# sdd-design — Phase 1 grilling protocol

Load this at the start of **Phase 1**. The grilling is a bounded adversarial debate that pressure-
tests ONE design before it's committed, and records the rejected alternatives so the decision is
auditable. You (the skill) are the synthesizer and the only writer (Constitution **P-01**); you
mediate every exchange so the two subagents never see each other's raw output (**P-02**).

## Inputs you hold

- `recon.md` (written in Phase 0) — the grounded facts.
- `product-spec.md` — the requirements.
- `docs/sdd/constitution.md` — the rules the adversary cites by ID.
- relevant `docs/roadmap/ledger/fails.md` entries — known traps.

## The loop (full: minimum 2 rounds; quick: 1 mandated round; hard cap 5)

The orchestrator passes a **mode**: `full` (default) or `quick`. The two differ only in how many rounds
are *mandated* before the approval gate unlocks — `quick` mandates one, `full` mandates two. Everything
else (the proposer→adversary pass, synthesis, the Floor check) is identical, so `quick` keeps the single
adversarial review that makes this a gate rather than a rubber stamp; it does not weaken **F-11**.

For each round `R`:

1. **Proposer.** Spawn a **`design-proposer`** subagent. Give it: `recon.md`, `product-spec.md`, and
   — for R≥2 — *your synthesized state from the prior round* (the current best approach + the open
   objections you want addressed). **Never** hand it the adversary's raw output. It returns ONE
   concrete approach with `path:line`-cited evidence and an explicit assumptions list.

2. **Adversary.** Spawn a **`design-adversary`** subagent. Give it: `recon.md`, the proposer's
   approach (verbatim), the Constitution, and the relevant `fails.md` entries. It attacks the
   approach — architectural flaws, security/data gaps, simpler alternatives, and **every `C-*`/`P-*`/
   `F-*` the approach would violate, cited by ID**. It also names the trade-offs of the alternatives
   it would reject.

3. **Synthesize (you).** Reconcile proposal + objections into:
   - **Current best approach** (what survives).
   - **Open objections** (unresolved points to carry into the next round, if any).
   - **Floor status** — list any `F-*` the adversary flagged as unresolved.

4. **Gate (you, via `AskUserQuestion` — Constitution P-04).** Present a tight synthesis (current
   approach, the strongest surviving objection, Floor status) and offer:
   - **Approve design** — selectable once `R ≥ mandated` (full: `R ≥ 2`; quick: `R ≥ 1`) and there is
     **no unresolved Floor breach**. Exit the loop.
   - **Run another round** — feed your synthesis into round `R+1`.
   - **Inject a constraint / steer** — record the user's note, then run round `R+1` with it.

   If `R` is below the mode's mandated count (full mode, `R == 1`), do not offer "Approve" yet — at
   least one more round is mandatory. In **quick** mode the mandated count is met at `R == 1`, so
   *Approve* is offered after the first round (a Floor breach still blocks it, and *Run another round*
   is still available to upgrade into a fuller debate).
   If `R == 5` and still not approved, present the state and ask the user to either approve as-is,
   accept a documented open risk, or stop the design phase (do not loop past 5).

## Termination

- **Approved** → write `design.md` (`templates/design.md`) and return to the SKILL's COMPLETION step.
- **Floor breach unresolved (F-11)** → you cannot offer approval. Either the user steers the design
  to resolve it (another round) or the phase stops with the breach recorded in `context.md`. "Proceed
  anyway" never bypasses a Floor item.
- **User stops** → record the in-flight state in `context.md` (Open Threads) and stop without flipping
  lifecycle.

## What lands in design.md

- **Chosen Approach** — the decided design, each claim cited to `recon.md` `path:line`.
- **Rejected Alternatives** — one line each: the option and why it lost (pull these from the
  adversary's trade-off analysis — this is the durable value of the debate).
- **Open Risks** — anything accepted-but-unresolved; mirror each into `context.md` `## Open Threads`
  with a target step.
- **Constitution Rules Touched** — the `C-*`/`P-*`/`F-*` IDs the approach interacts with and how each
  is honored.
- **Rounds** — N, and the termination reason.
