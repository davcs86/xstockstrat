# design-buddy — deep-mode panel protocol

Load this only when depth is **`deep`**. The panel replaces round 1 of the debate: instead of one
proposer, several argue the same problem from deliberately different angles, so a rearchitecture
or migration is not shaped by a single first instinct. Rounds 2+ revert to the standard loop in
`reference/debate-protocol.md`.

## Round 1 — the panel

1. **Pick 2–3 angles** that genuinely pull in different directions for *this* change. The three
   canonical angles:
   - **minimal-delta** — the smallest change that satisfies the requirement; maximum reuse.
   - **target-state** — the clean end architecture first; the migration path is derived from it.
   - **operational-safety** — rollout, reversibility, and coexistence of old and new first.
   Use all three for a large migration; drop one only when it is plainly inapplicable (say why in
   your synthesis). You may substitute a change-specific angle (e.g. *performance-first*) when it
   is clearly more probing than a canonical one.

2. **Spawn the panelists in parallel** — one **`proposer`** subagent per angle
   (`design-buddy:proposer`), each given: the recon dossier, the change description, the
   principles, and its **assigned angle**. Panelists never see each other (**DF-4**). Each
   returns ONE cited approach from its angle.

3. **Judge and synthesize (you — no separate judge agent).** Compare the proposals on: floor/host-
   rule compliance, evidence quality (DN-1), reuse (DN-2), how well each handles the others' core
   concern, and fit to the requirement. Produce ONE candidate approach — a winner, or a hybrid
   that grafts a losing proposal's best element onto the winner (say which element and why).
   The losing proposals become pre-seeded **Rejected Alternatives**, each with the trade-off that
   sank it.

4. **Adversary pass.** Hand the synthesized candidate to the **`adversary`** exactly as in the
   standard loop (it also receives your one-line rationale for rejecting each losing angle, so it
   can challenge the judging itself).

5. **Synthesis + gate** as in the standard loop. The panel plus this adversary pass counts as
   round 1; the mandate of 2 means at least one more standard round always follows before Approve
   unlocks.

## Budget notes

The panel triples round 1's proposer cost — that is the point of deep mode; do not silently trim
to one panelist. If the user wants a cheaper run, they steer at the gate or restart at `full`
depth. The hard cap (6 rounds total, counting the panel) still applies.
