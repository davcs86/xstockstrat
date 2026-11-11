# sdd-design — Phase 1 grilling protocol

Load this at the start of **Phase 1**. The grilling is a bounded adversarial debate that pressure-
tests ONE design before it's committed, and records the rejected alternatives so the decision is
auditable. You (the skill) are the synthesizer and the only writer (Constitution **P-01**); you
mediate every exchange so the two subagents never see each other's raw output (**P-02**).

## Inputs you hold

- `recon.md` (written in Phase 0) — the grounded facts, **including `## Existing Business Rules`**
  (the `@AC-*` guarantees of the affected services + `platform.feature`, surfaced by the
  `scenario-recon` subagent in Phase 0 and classified PRESERVE / EXTEND / CHANGE). This section is the
  design-adversary's C-16 regression guard for every round below.
- `product-spec.md` — the requirements.
- `acceptance.feature` — this feature's own `@AC-*` scenarios.
- `docs/sdd/constitution.md` — the rules the adversary cites by ID.
- relevant `docs/roadmap/ledger/fails.md` entries — known traps.
- `debate.md` (`templates/debate.md`) — the **debate register**: settled decisions (`D-n`), locked
  rejected alternatives (`R-n`), objections (`O-n`) and reopen petitions (`P-n`). If it already
  exists (a re-run or an earlier stopped session), it is never reset: its entries bind this run, and
  new rounds append after the existing ones.

## Register guardrails (anti-circularity) — apply every round

The debate's state lives in `debate.md` on disk, not in your window or a scratchpad. Long sessions
and compaction drop rejections silently; these rules are what stops a later round re-proposing them.

1. **Build from disk.** Re-read `debate.md` immediately before spawning each proposer and adversary,
   and pass it verbatim as the binding register. Never reconstruct prior rounds from memory.
2. **Locked by default.** A `locked` `R-n` and a `closed`/`waived` `O-n` are off the table, and a
   `settled` `D-n` stands. A subagent that wants one back must file a **`REOPEN <ID>` petition**
   citing *new* evidence: a `path:line`, constraint or user steer that is **not** already on record
   in the register. Restating the idea, or re-arguing with evidence already cited, is not new.
3. **Vet every petition (you).** Log each one as a `P-n` row. Evidence already on record → verdict
   `dropped`, strip the petition from the synthesis. Genuinely new → `pending user`; only the user can
   reopen, at the gate. You never reopen on your own judgment.
4. **Register-diff check (before you persist the synthesis).** Compare the new synthesis against the
   register. A settled `D-n` contradicted, a locked `R-n` reintroduced (under any name), or a closed
   `O-n` re-raised **without** a user-approved reopen is synthesis drift: fix the synthesis to honor
   the register — never record it as a new decision. The current best approach names the `D-n` IDs
   it rests on.
5. **Record the delta.** Append the round's new `D-n`/`R-n`/`O-n`/`P-n` rows, flip closed objections'
   `Status`, and add the `## Rounds` row with its counts. Write `debate.md` **before** the gate.
6. **No-progress detector.** A round has **progress** when it settled a decision, closed an objection,
   rejected an alternative, or produced a `pending user` petition. A round (R ≥ 2) with none of these
   — including one whose only new objections were re-raises — is **no-progress**: record `no` in its
   `Progress` cell and flag it at the gate (step 4 below).

## The loop (full: minimum 2 rounds; quick: 1 mandated round; hard cap 5)

The orchestrator passes a **mode**: `full` (default) or `quick`. The two differ only in how many rounds
are *mandated* before the approval gate unlocks — `quick` mandates one, `full` mandates two. Everything
else (the proposer→adversary pass, synthesis, the Floor check) is identical, so `quick` keeps the single
adversarial review that makes this a gate rather than a rubber stamp; it does not weaken **F-11**.

For each round `R`:

1. **Proposer.** Spawn a **`design-proposer`** subagent. Give it: `recon.md`, `product-spec.md`,
   `debate.md` as re-read from disk (when it exists), and — for R≥2 — *your synthesized state from
   the prior round* (the current best approach + the open `O-n` you want addressed). **Never** hand it
   the adversary's raw output. It returns ONE concrete approach with `path:line`-cited evidence, an
   explicit assumptions list, and any `REOPEN` petitions.

2. **Adversary.** Spawn a **`design-adversary`** subagent. Give it: `recon.md` (with its
   **Existing Business Rules**), the proposer's approach (verbatim), `debate.md` as re-read from disk,
   the Constitution, and the relevant `fails.md` entries. It flags any un-petitioned breach of the
   register as a **register violation**, may re-raise a closed `O-n` only via a `REOPEN` petition,
   and attacks the approach — architectural flaws, security/data gaps,
   simpler alternatives, **design-quality weaknesses (C-18: SOLID/DRY/YAGNI, weighed as a staff
   engineer would — never dogma)**, and **every `C-*`/`P-*`/`F-*` the approach would violate, cited by ID**. It
   also names the trade-offs of the alternatives it would reject. **Business-rule regression check
   (C-16):** any way the approach would break an existing `@AC-*` guarantee from recon's Existing
   Business Rules is a regression objection, cited by the `@AC-*` ID — treated as seriously as a
   Constitution breach.

3. **Synthesize (you).** Reconcile proposal + objections into the items below, then run the register
   guardrails 3–6 (vet petitions, register-diff check, write the delta to `debate.md`):
   - **Current best approach** (what survives, naming the `D-n` it rests on).
   - **Open objections** (the `O-n` still `open` to carry into the next round, if any).
   - **Floor status** — list any `F-*` the adversary flagged as unresolved.
   - **Business-rule impact** — which existing `@AC-*` guarantees the approach preserves, extends, or
     changes. A **change** to an existing rule needs explicit user sign-off at the gate (record it in
     `context.md`); an unintended **break** is a regression to resolve before approval (C-16).

4. **Gate (you, via `AskUserQuestion` — Constitution P-04).** Present a tight synthesis (current
   approach, the strongest surviving objection, Floor status) and offer:
   - **Approve design** — selectable once `R ≥ mandated` (full: `R ≥ 2`; quick: `R ≥ 1`) and there is
     **no unresolved Floor breach**. Exit the loop.
   - **Run another round** — feed your synthesis into round `R+1`.
   - **Inject a constraint / steer** — record the user's note, then run round `R+1` with it.
   - **Reopen `<ID>`** — one option per `pending user` petition, showing the new evidence. On yes, flip
     the target's `Status` to `reopened @ round R` and the petition to `user reopened`, record it in
     `context.md`, then run round `R+1`; on no, mark the petition `user declined` (the target stays
     locked).

   **No-progress at the gate.** When round `R` is no-progress, say so in the synthesis, never mark
   *Run another round* as recommended, and point the user at *Approve* (if selectable), accepting the
   open `O-n` as documented risks, a steer, or stopping. After **two consecutive** no-progress rounds,
   *Run another round* is not offered at all — only a steer or reopen can start round `R+1`.

   If `R` is below the mode's mandated count (full mode, `R == 1`), do not offer "Approve" yet — at
   least one more round is mandatory. In **quick** mode the mandated count is met at `R == 1`, so
   *Approve* is offered after the first round (a Floor breach still blocks it, and *Run another round*
   is still available to upgrade into a fuller debate).
   If `R == 5` and still not approved, present the state and ask the user to either approve as-is,
   accept a documented open risk, or stop the design phase (do not loop past 5).

## Termination

- **Approved** → set `debate.md` **State** to `approved`, write `design.md` (`templates/design.md`)
  and return to the SKILL's COMPLETION step.
- **Floor breach unresolved (F-11)** → you cannot offer approval. Either the user steers the design
  to resolve it (another round) or the phase stops with the breach recorded in `context.md`. "Proceed
  anyway" never bypasses a Floor item.
- **User stops** → set `debate.md` **State** to `stopped`, record the in-flight state in `context.md`
  (Open Threads, pointing at the open `O-n`) and stop without flipping lifecycle.

## What lands in design.md

- **Chosen Approach** — the decided design, each claim cited to `recon.md` `path:line`.
- **Rejected Alternatives** — one line per `locked` `R-n` in `debate.md`, keeping its ID: the option
  and why it lost. Source them from the register, not from the last round — an earlier rejection
  missing here is the drift this protocol exists to stop.
- **Open Risks** — anything accepted-but-unresolved; mirror each into `context.md` `## Open Threads`
  with a target step.
- **Constitution Rules Touched** — the `C-*`/`P-*`/`F-*` IDs the approach interacts with and how each
  is honored.
- **Business Rules Touched (C-16)** — existing `@AC-*` guarantees the approach **preserves / extends /
  changes** (a change carries its sign-off reference). Empty if the feature introduces net-new
  behavior only.
- **Rounds** — N, and the termination reason.
