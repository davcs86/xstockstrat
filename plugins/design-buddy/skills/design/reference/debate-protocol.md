# design-buddy — Phase 1 debate protocol

Load this at the start of **Phase 1**. The debate is a bounded adversarial pressure-test of ONE
design, recording the rejected alternatives so the decision is auditable. You (the skill) are the
synthesizer and the only writer (**DF-3**); you mediate every exchange so the subagents never see
each other's raw output (**DF-4**).

## Inputs you hold

- The recon dossier (grounded facts, host hard rules) — written in Phase 0.
- The change description — the requirement.
- `reference/principles.md` — the DF-*/DN-* rules the adversary cites by ID.
- `<artifactsDir>/ledger.md` entries relevant to the affected areas, if a ledger exists.

## Round bounds by depth

| Depth | Mandated rounds before Approve unlocks | Hard cap | Round 1 |
|---|---|---|---|
| `quick` | 1 | 3 | single proposer |
| `full` | 2 | 5 | single proposer |
| `deep` | 2 (counting the panel as round 1) | 6 total | proposer **panel** — load `reference/panel-protocol.md` now |

The depths differ only in the mandated count and round 1's shape. Everything else — the
proposer→adversary pass, synthesis, the floor check — is identical, so `quick` keeps the single
adversarial review that makes this a gate rather than a rubber stamp (**DF-5** holds at every
depth). The user may always opt into *more* rounds, never fewer than the mandate.

## The loop — for each round R

1. **Proposer.** Spawn a **`proposer`** subagent (`design-buddy:proposer`; bare name as
   fallback). Give it: the recon dossier, the change description, the principles, and — for
   R ≥ 2 — *your synthesized state from the prior round* (current best approach + the open
   objections you want addressed). **Never** hand it the adversary's raw output (**DF-4**). It
   returns ONE concrete approach with `path:line`-cited evidence and an explicit assumptions list.

2. **Adversary.** Spawn an **`adversary`** subagent (`design-buddy:adversary`). Give it: the
   recon dossier, the proposer's approach (verbatim), the principles, the recon's **Host
   Conventions & Hard Rules** section, and relevant ledger entries. It attacks the approach and
   cites every `DF-*`/`DN-*` breached by ID — and every host hard rule breached by verbatim quote
   + `path:line` (**DF-6**). It also names the trade-offs of the alternatives it would prefer.

3. **Synthesize (you).** Reconcile proposal + objections into:
   - **Current best approach** — what survives.
   - **Open objections** — unresolved points to carry into the next round.
   - **Floor status** — any unresolved `DF-*` breach or host hard-rule violation.

4. **Gate (you, via `AskUserQuestion` — DN-3).** Present a tight synthesis (current approach, the
   strongest surviving objection, floor status) and offer:
   - **Approve design** — selectable only when `R ≥ mandated` for the depth AND there is **no
     unresolved floor breach**. Exit the loop.
   - **Run another round** — feed your synthesis into round R+1.
   - **Inject a constraint / steer** — record the user's note, then run round R+1 with it.

   Below the mandated count, do not offer Approve — at least one more round is mandatory. At the
   hard cap, present the state and ask the user to approve as-is, accept a documented open risk,
   or stop — do not loop past the cap.

## Termination

- **Approved** → write the design doc (`templates/design.md`) and return to the SKILL's
  COMPLETION step. Record any user-waived `DN-*` objections in its Waivers section (**DN-3**).
- **Floor breach unresolved (DF-5)** → you cannot offer approval. Either the user steers the
  design to resolve it (another round) or the phase stops with the breach stated plainly in your
  final summary. "Proceed anyway" never bypasses a floor item, at any depth.
- **User stops** → summarize the in-flight state (current approach, open objections) so it can be
  pasted into a future run, and stop. Write no design doc.

## What lands in the design doc

- **Chosen Approach** — each claim cited to the recon dossier `path:line` (**DN-1**).
- **Rejected Alternatives** — one line each, pulled from the adversary's trade-off analysis (and,
  in deep mode, the losing panel proposals). This is the durable value of the debate.
- **Open Risks** — anything accepted-but-unresolved, each with where it must be addressed.
- **Principles & Host Rules Touched** — the DF-*/DN-* IDs and quoted host rules the approach
  interacts with, and how each is honored.
- **Waivers** — any DN-* objections the user explicitly waived, with rationale.
- **Depth / Rounds / termination** — in the header.
