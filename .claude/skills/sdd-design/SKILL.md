---
name: sdd-design
description: Phase 1.75 of SDD — ground a debated design before implementation planning. Usage: /sdd-design <feature-slug>. Phase 0 (Recon) produces a saved recon.md dossier; Phase 1 (Grilling) runs a bounded proposer-vs-adversary design debate and writes design.md. Advances spec-ready → design-approved. Reads the Constitution and the Ledger; sdd-spec then consumes recon.md + design.md.
argument-hint: <feature-slug>
allowed-tools: Read Write Edit AskUserQuestion Task Bash(ls *) Bash(find *) Bash(grep *) Bash(git fetch *) Bash(git show *) Bash(git ls-remote *)
effort: high
---

You run the **design phase** of SDD: between an approved product spec and the implementation spec.
It produces two durable artifacts — `recon.md` (a grounded codebase dossier) and `design.md` (a
debated, user-approved architecture) — so that `/sdd-spec` plans against real facts and a decided
approach instead of improvising both.

**Authority (Constitution P-01).** You are the single orchestrator. You own every write, every user
gate, and the lifecycle flip. The subagents you spawn are advisory only — they locate and argue;
they never write. **You** mediate every exchange between them (P-02): the proposer and the adversary
never see each other's raw output, only the state you pass them.

**Progressive disclosure.** This file is the always-loaded router. Two `reference/` files load only
when their phase activates — do not read them up front:
- `reference/recon-checklist.md` — read at the start of **Phase 0**.
- `reference/grilling-protocol.md` — read at the start of **Phase 1**.

## Arguments

- `$ARGUMENTS[0]` — feature slug (required).

---

## BOOT SEQUENCE — run every session, before any phase

**Step B0.** Resolve the feature directory:
```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
```
No directory → stop: "No feature directory found for slug `$ARGUMENTS[0]`. Run /sdd-story first."
Capture as `FEATURE_DIR`.

**Step B1.** Read `$FEATURE_DIR/product-spec.md`. If absent → stop: "No product spec found. Run
/sdd-story $ARGUMENTS[0] first."

**Step B2.** Read `$FEATURE_DIR/feature.md` and check `**Lifecycle Status**`:
- `spec-ready` → OK, proceed.
- `draft` → warn: "Product spec has not been AI-reviewed. Run `/sdd-review $ARGUMENTS[0]
  product-spec` first. Proceed anyway? (yes / no)" — continue only on `yes`.
- `design-approved` or later → warn: "Design already approved (status: `<status>`). Re-run the
  design phase anyway? (yes / no)" — continue only on `yes`.
- `launched` / `rolled-back` / `demoted/canceled` → warn and confirm before proceeding.

**Step B3.** Read the governing context (keep it lean — these are short):
- `docs/sdd/constitution.md` — the binding rules. The adversary will cite these by ID; you enforce
  the Floor (a Floor breach blocks the design — **F-11**).
- `docs/roadmap/ledger/fails.md` and `docs/roadmap/ledger/insights.md` — past mistakes to avoid and
  patterns to reuse. Carry the entries relevant to this feature's services into both phases.
- `$FEATURE_DIR/context.md` — prior session decisions (Constitution **C-02**). Read before writing.

**Step B4.** Announce context:
```
Designing: <slug> (lifecycle: <status>)
Affected services (from product-spec): <list>
Relevant ledger entries: <count fails / insights, or "none">
Starting Phase 0 — Recon.
```

---

## PHASE 0 — RECON (read-only discovery → recon.md)

Read **`reference/recon-checklist.md`** and follow it. In short:

1. For every service in the product spec's **Affected Services**, spawn a **`codebase-discovery`**
   subagent (one per service, in parallel via Task), handing it the checklist tailored to this
   feature's symbols, config keys, env vars, and ports. Each returns a `path:line` digest (+ a
   `## Not found` section). You never invent — an unfound thing stays in `## Not found` (**F-04**,
   **P-03**).
2. Synthesize the digests + the relevant ledger entries into `$FEATURE_DIR/recon.md` using
   `templates/recon.md`. The **Patterns to REUSE** section is the anti-duplication core — list real,
   existing patterns the implementation should reuse rather than re-create.
3. Present a 4–6 line recon summary to the user and continue to Phase 1 (no separate gate here — the
   gate is at the end of the debate).

**Write `recon.md` now** (this is the first write; it is allowed — the lifecycle flip happens only
after Phase 1 approval).

---

## PHASE 1 — GRILLING (bounded design debate → design.md)

Read **`reference/grilling-protocol.md`** and run the loop. In short:

- **Round (≥2, hard cap 5):**
  1. Spawn a **`design-proposer`** subagent with `recon.md` + `product-spec.md` + your synthesized
     state from the prior round (never the adversary's raw output). It returns ONE concrete approach
     with cited evidence and explicit assumptions.
  2. Spawn a **`design-adversary`** subagent with `recon.md` + the proposer's approach + the
     Constitution + relevant `fails.md`. It attacks the approach and cites any `C-*`/`P-*`/`F-*` it
     would violate, plus rejected-alternative trade-offs. (Proposer and adversary run sequentially,
     mediated by you — P-02.)
  3. **You synthesize**: reconcile the proposal and the objections into a current best approach +
     open objections + any Floor breach.
  4. **Gate (P-04):** present the synthesis to the user via `AskUserQuestion`:
     - *Approve this design* — exit the loop, write `design.md`.
     - *Run another round* — feed your synthesis into the next round.
     - *Inject a constraint / steer* — incorporate the user's note, then run another round.
- **Floor stop (F-11):** if the adversary flags an unresolved Floor (`F-*`) violation, you cannot
  approve — surface it and either steer the design to resolve it or stop. "Proceed anyway" never
  bypasses a Floor item.
- On approval, write `$FEATURE_DIR/design.md` using `templates/design.md`: Chosen Approach (cited to
  `recon.md`), Rejected Alternatives (+why), Open Risks (carry these into `context.md` Open Threads),
  and Constitution Rules Touched (IDs + how honored).

---

## COMPLETION — advance spec-ready → design-approved

After `design.md` is written and user-approved:

1. Edit `$FEATURE_DIR/feature.md`:
   - Set `**Lifecycle Status**: \`spec-ready\`` → `**Lifecycle Status**: \`design-approved\``.
   - Append a Status History row:
     `| <ISO date> | \`spec-ready\` → \`design-approved\` | /sdd-design | Design debated (N rounds) and approved; recon.md + design.md written |`
   - Update `## Next Action` to: `` `/sdd-spec <slug>` — generate implementation spec from the approved design ``.
   - Update the Artifacts list to link `recon.md` and `design.md`.
   (If status was already `design-approved` or later via the B2 re-run path, append an
   `(unchanged)` history row instead of changing the status value.)
2. Append to `$FEATURE_DIR/context.md` (Constitution **P-05** — write as it happens):
   ```markdown
   ## Session <ISO timestamp> — sdd-design

   - Phase 0 Recon: wrote recon.md (services: <list>; key reuse patterns: <1-2>).
   - Phase 1 Grilling: <N> rounds. Chosen approach: <1 line>. Rejected: <1 line>.
   - Constitution rules touched: <IDs>. Floor breaches: <none | resolved how>.
   - Status: spec-ready → design-approved.
   ```
   If the feature uses the structured-header `context.md` schema, also fold the chosen approach into
   `## Decisions` and each open risk into `## Open Threads` (with a target step).
3. If the debate surfaced a reusable pattern or a recurring trap that future features should know
   about, append a one-line entry to `docs/roadmap/ledger/insights.md` or `fails.md` (their schema).
4. Print:
   ```
   Design approved for <slug>. Status: design-approved.
   Artifacts: recon.md, design.md
   Next: /sdd-spec <slug>
   ```

---

## HARD CONSTRAINTS — never violate

- **You are the only writer (P-01).** Subagents never write, commit, or flip lifecycle state.
- **Mediate every subagent exchange (P-02).** Proposer and adversary never see each other's raw
  output — only the state you synthesize and pass.
- **Never invent (F-04, P-03).** Anything discovery didn't find stays in `## Not found`; ambiguity
  is surfaced to the user, never guessed.
- **Never write `feature.md` lifecycle before the debate is user-approved.** `recon.md` and
  `design.md` are written during the phases; the status flip happens only at COMPLETION.
- **A Floor (`F-*`) breach blocks approval (F-11).** No "proceed anyway" past a Floor item.
- **Minimum 2 debate rounds; hard cap 5.** Do not approve on a single round; do not loop past 5.
- **Read `context.md` + the Constitution + the Ledger at boot (C-02).** Never skip the boot reads.
