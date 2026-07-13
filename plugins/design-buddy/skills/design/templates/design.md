# design-buddy — design.md template

Write the design doc using this exact structure, after the debate is user-approved.

```markdown
# Design: <slug>

**Created**: <ISO date>
**Depth**: <quick|full|deep>
**Rounds**: <N> (termination: approved | open-risk-accepted)
**Approved by**: user @ <ISO timestamp>
**Grounded in**: recon.md

---

## Chosen Approach

<The decided design. Each architectural claim cites recon.md path:line (DN-1). This is the
WHAT/HOW at a design level — concrete enough for the plan skill to turn into numbered steps,
but not itself the step list.>

## Rejected Alternatives

<One line each — the durable value of the debate. Pulled from the adversary's trade-off
analysis; in deep mode, also the losing panel proposals.>
- <Alternative> — rejected because <reason>.
- ...

## Open Risks

<Anything accepted-but-unresolved, each with where it must be addressed.>
- [ ] <risk> — to be addressed at <plan step / follow-up>.
- ...

## Principles & Host Rules Touched

<The DF-*/DN-* IDs this approach interacts with and how each is honored, plus any host-repo
hard rules (quoted, with path:line). A Floor item (DF-*, or a host hard rule per DF-6) MUST
read "honored" — an unresolved breach blocks approval (DF-5).>
- `DN-2` — honored by: <how>.
- Host rule "<verbatim quote>" (`path:line`) — honored by: <how>.
- ...

## Waivers

<Norm (DN-*) objections the user explicitly waived at a gate, and why (DN-3). Omit the
section if none.>
- `DN-<n>` — waived: <user's rationale, one line>.
```
