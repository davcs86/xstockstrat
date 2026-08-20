# sdd-design — design.md template

Write `$FEATURE_DIR/design.md` using this exact structure, after the debate is user-approved.

```markdown
# Design: <slug>

**Created**: <ISO date>
**Rounds**: <N> (<quick|full>; termination: approved | open-risk-accepted)
**Approved by**: user @ <ISO timestamp>
**Grounded in**: recon.md

---

## Chosen Approach

<The decided design. Each architectural claim cites recon.md path:line. This is the WHAT/HOW-AT-A-
DESIGN-LEVEL that /sdd-spec turns into numbered steps — it must be concrete enough to plan against,
but it is not itself the step list. State how the change reaches its **consumer surface(s)** (the
UI segment or Agent tool named in the product spec, C-14) — not just the backing service — or that
it is internal-only.>

## Rejected Alternatives

<One line each — the durable value of the debate. Pulled from the adversary's trade-off analysis.>
- <Alternative> — rejected because <reason>.
- ...

## Open Risks

<Anything accepted-but-unresolved. Mirror each into context.md ## Open Threads with a target step.>
- [ ] <risk> — to be addressed at <step/PR>.
- ...

## Constitution Rules Touched

<The C-*/P-*/F-* IDs this approach interacts with, and how each is honored. A Floor (F-*) item must
read "honored" — an unresolved Floor breach blocks approval (F-11).>
- `C-08` — honored by: <how>.
- `F-01` — honored by: <how>.
- ...

## Business Rules Touched (C-16)

<Existing `@AC-*` guarantees (from recon's Existing Business Rules) this approach affects. Empty if
the feature is net-new behavior only. A CHANGE line must reference the user sign-off in context.md.>
- PRESERVE `@AC-<n>` "<title>" (`services/xstockstrat-<svc>/acceptance/<file>.feature`) — not regressed by: <how>.
- EXTEND `@AC-<n>` "<title>" — new case added: <what>.
- CHANGE `@AC-<n>` "<title>" — altered guarantee; signed off by user @ <ISO> (context.md).
- ...
```
