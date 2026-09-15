---
name: sdd-distill
description: Compact an IN-PROGRESS feature's context.md so its per-session reload cost stops growing, without losing durable reasoning. Usage — /sdd-distill <feature-slug>. Delegates read-only synthesis to the context-distiller subagent, which hoists live state into the structured header and compresses older ## Session blocks into short summaries while the most recent sessions stay verbatim; a verify pass proves nothing irrecoverable is dropped, then a consent gate precedes the single-writer rewrite (git history preserves the original prose). Use this when a long-running feature's context.md has grown large and every session reloads it — a mid-lifecycle counterpart to /sdd-archiver, which only fires at terminal state. Never deletes reasoning, never touches other artifacts, never writes the Ledger.
argument-hint: <feature-slug>
allowed-tools: Read Write Edit Task AskUserQuestion Bash(git *) Bash(find *) Bash(ls *) Bash(grep *) Bash(wc *)
effort: medium
---

You compact one feature's `context.md`. The append-only session log is durable memory (see
`docs/patterns/context-engineering.md` §3), but on a long feature it grows without bound and every
session reloads all of it. This skill shrinks it **non-destructively**: durable state is hoisted into
the header, older sessions are compressed to short summaries, recent sessions stay verbatim, and the
pre-distill prose is preserved in git history by the rewrite commit. This is the mid-lifecycle
counterpart to `/sdd-archiver` (which fires only at terminal state and deletes artifacts) — it is the
**second sanctioned rewriter** of `context.md`, the one exception to the append-only rule for
in-progress features.

## Arguments

- `$ARGUMENTS[0]` — feature slug (required).

---

## BOOT — run before anything

**B0.** Resolve the feature directory:
```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
```
No match → stop: "No feature directory found for slug `$ARGUMENTS[0]`."
Capture it as `$FEATURE_DIR`.

**B1.** Read `$FEATURE_DIR/status.md` (a plain-string lifecycle status).
If it is `launched`, `rolled-back`, or `demoted/canceled` → stop:
"Feature is terminal (`<status>`). Use `/sdd-archiver $ARGUMENTS[0]` — distillation is for in-progress
features only." (Terminal features are archived, not distilled.)

**B2.** Load the authoritative `context.md`. Parse `**Development Branch**` from `$FEATURE_DIR/feature.md`
(fallback `feature/$ARGUMENTS[0]`). Prefer the branch copy, else main-dev, else the working tree:
```bash
git show origin/<dev-branch>:$FEATURE_DIR/context.md 2>/dev/null \
  || git show origin/main-dev:$FEATURE_DIR/context.md 2>/dev/null \
  || cat $FEATURE_DIR/context.md
```
This is the content you will distill and later rewrite.

**B3.** Confirm the working tree is on `<dev-branch>` (or `main-dev`); if on any unrelated branch, stop
and ask the user to check out `<dev-branch>` first — the rewrite commits there so git preserves the
original prose.

---

## THRESHOLD — is distillation worth it?

Count the log:
```bash
wc -l $FEATURE_DIR/context.md
grep -c '^## Session' $FEATURE_DIR/context.md
```
If the file is **< 150 lines** or has **≤ 3 `## Session` entries**, stop:
"context.md is only <N> lines / <S> sessions — not worth distilling yet. Re-run when it has grown."
Distilling a small log churns history for no reload saving.

---

## DELEGATE — plan the rewrite (read-only subagent)

Hand the authoritative `context.md`, `$FEATURE_DIR`, `slug`, `status`, the sibling artifact paths, and
`KEEP_RECENT=2` to a **`context-distiller`** subagent via the Task tool, **mode `distill`**. It returns
a `## Distill Plan` (header to write, sessions to keep verbatim, Superseded-Session summaries, and a
**Loss check**). This keeps the full-log read out of this window — you act on the plan, not the prose.

**Gate on the Loss check.** If the plan's "Irrecoverable reasoning dropped" is not **none**, do not
proceed to a lossy rewrite: either raise `KEEP_RECENT` to keep the affected sessions verbatim and
re-delegate, or stop and report what could not be compressed. Never write a plan that admits loss.

---

## VERIFY — adversarial safety pass (read-only subagent)

Build the proposed rewritten `context.md` from the plan (in memory), then delegate it back to a
**`context-distiller`** subagent, **mode `verify`**, with the original. It returns
`## Distill verdict: safe | unsafe` + a `## LOST` list. Proceed **only** on `safe` with an empty
`## LOST`. On `unsafe`, fold each `LOST` item back in (keep its session verbatim or add it to the
header/summary) and re-verify. This mirrors `/sdd-archiver`'s pre-destruction verify gate.

---

## CONSENT GATE — no rewrite without an explicit yes

Present, via `AskUserQuestion`:
- before/after line count (from the plan), the number of sessions being compressed vs. kept verbatim,
  and a one-line assurance that git history preserves the original.
Options: **Distill (rewrite context.md now)** / **Show the full proposed content first** / **Cancel**.
Only on an explicit *Distill* do you write. `Cancel` → stop, nothing written. This is the P-04 /
single-writer discipline: the subagents only ever proposed; **you** are the sole writer.

---

## WRITE — single-writer rewrite (only after consent)

Rewrite `$FEATURE_DIR/context.md` to exactly:

1. A provenance marker at the top:
   `> Distilled <ISO date> by /sdd-distill. Full pre-distill session prose is in git history (before this commit).`
2. The structured header — `## Decisions`, `## Open Threads`, `## Files Modified` — from the plan
   (verbatim heading spellings per `context-engineering.md` §3).
3. `## Superseded Sessions` — the compressed ≤3-line summaries from the plan, oldest first.
4. The most recent `KEEP_RECENT` `## Session <date>` entries, **verbatim**, plus any the plan marked
   keep-verbatim.
5. A new append-only entry recording this run:
   ```markdown
   ## Session <ISO date> — /sdd-distill
   - Distilled <S_before> sessions → header + Superseded Sessions; kept <KEEP_RECENT> verbatim.
   - context.md <N_before> → <N_after> lines. Original prose preserved in git history.
   ```

Then commit on `<dev-branch>` so the original is recoverable:
```bash
git add $FEATURE_DIR/context.md
git commit -m "docs(<slug>): distill context.md (<N_before> -> <N_after> lines)"
```
Do **not** stage or touch any other file. Print the before/after line counts and the commit SHA.

---

## HARD CONSTRAINTS — never violate

- **Never drop irrecoverable reasoning.** The verify pass must return `safe` with an empty `## LOST`
  before any write. A rationale, rejected alternative, or scar that lives only in prose is either
  hoisted into the header or preserved in a Superseded-Session summary — never deleted.
- **Never rewrite without the consent gate.** The subagents propose; you write, once, on an explicit
  yes.
- **Never touch any file but `$FEATURE_DIR/context.md`.** No other artifact, no `implementation-spec.md`
  status, no `feature.md`, and **never** the Ledger (`insights.md`/`fails.md`) — distillation records
  no cross-feature lesson; that is `/sdd-archiver`'s job at terminal state.
- **Never run on a terminal feature.** Those are archived, not distilled (see BOOT B1).
- **Always commit the rewrite** so git history holds the pre-distill prose — that commit is what makes
  the compression non-destructive.
