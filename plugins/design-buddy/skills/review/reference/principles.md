# design-buddy — principles

The portable governance seed. The orchestrating skill enforces these; the adversary agent cites
them by ID. They exist so every objection and every gate decision can point at a precise rule
instead of re-deriving it.

Two tiers, two strengths:

## Floor rules (`DF-*`) — blocking, never bypassed

A violation of a Floor rule blocks design approval and plan completion. "Proceed anyway" never
clears a Floor item — the user may steer the work to *resolve* it, or stop.

- **DF-1 — Never invent.** Every file path, symbol, function, type, config key, or line number
  cited in an artifact must come from a search hit actually seen (Grep/Glob/Read or a subagent
  digest). Anything not found stays under an explicit `## Not found` heading — it is a recorded
  unknown, never a guess.
- **DF-2 — No silent deviation.** Ambiguity, a missing prerequisite, or a conflict between inputs
  is surfaced to the user at a gate — never resolved by silent assumption.
- **DF-3 — Single orchestrator.** The skill session owns every file write and every user gate.
  Subagents are advisory only: they locate, propose, and object; they never write or decide.
- **DF-4 — Mediated debate.** Debate participants (proposer, adversary, panelists) never see each
  other's raw output. The orchestrator synthesizes each round and passes only that synthesis.
- **DF-5 — Floor blocks approval at every depth.** An unresolved `DF-*` breach — at quick, full,
  or deep depth — removes the Approve option from the gate until resolved.
- **DF-6 — Host hard rules are floor-equivalent.** A rule the host repository itself states as
  absolute ("never …", "always …", "must not …" in its CLAUDE.md, CONTRIBUTING, or docs) is
  treated exactly like a `DF-*` rule. Cite it by verbatim quote + `path:line` — never invent an
  ID for it.

## Norms (`DN-*`) — must be addressed or explicitly waived at a gate

An objection grounded in a Norm must be answered (design change, recorded trade-off) or waived by
the user at a gate. A waiver is recorded in the artifact, never implied.

- **DN-1 — Evidence-cited claims.** Every load-bearing design claim cites `path:line` evidence
  from the recon dossier or the codebase.
- **DN-2 — Reuse over rebuild.** Prefer an existing pattern, helper, or type over a new one. A
  proposal that re-creates something the recon found is a weak proposal.
- **DN-3 — Gates are recorded.** Every user decision at a gate (approve, waive, steer, accepted
  open risk) is recorded in the artifact it affects.
- **DN-4 — Depth scales with the change.** Debate depth follows blast radius, reversibility, and
  novelty — a schema migration is not debated like a typo fix.
- **DN-5 — Plan steps are immutable during execution.** Once a plan is being executed, step bodies
  are never rewritten; only each step's `**Status**` changes, and divergence is recorded in the
  plan's `## Deviation Log`. (Amendments made by a pre-execution review are allowed and are
  recorded in the plan's `## Review Log`.)
- **DN-6 — Plans are reviewed before execution.** The review verdict is recorded in the plan
  header. A plan whose review found unresolved BLOCKER findings (floor-tied defects — invented
  references, host hard-rule violations, contradiction of the approved design) is `failed` and
  must not be executed until fixed and re-reviewed; BLOCKERs cannot be waived. Warnings must be
  addressed or explicitly waived at a gate.
