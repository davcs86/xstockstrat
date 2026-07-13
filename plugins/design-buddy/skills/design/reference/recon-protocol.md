# design-buddy — Phase 0 recon protocol

Load this at the start of **Phase 0**. Recon owns discovery for the design phase; the plan skill
later *consumes* the recon dossier instead of re-discovering from scratch. Recon runs in full at
every depth — `quick` shortens the debate, never the grounding.

## How to run it

1. **Scout the repo (once).** Spawn a **`repo-scout`** subagent (plugin agent — reference it as
   `design-buddy:repo-scout`; fall back to the bare name if the namespaced type isn't found).
   Give it the change description. It returns the Repo Profile digest: languages, layout,
   convention sources, **hard rules quoted verbatim with `path:line`**, and the test/lint/CI
   harness. You know nothing about the host repo except what this digest and the area digests
   report — never assume a stack (**DF-1**).

2. **Derive the affected areas.** From the Repo Profile structure + the change description, list
   the directories/packages the change plausibly touches. Prefer too few over too many — an area
   can be added later if the debate exposes a gap. If the change description names files or
   symbols, grep for them first to anchor the area list in fact.

3. **Discover each area (parallel).** Spawn one **`area-discovery`** subagent per area
   (`design-buddy:area-discovery`), in parallel. Hand each: the area path, the Repo Profile
   excerpt for that area, and a find list tailored to this change — the symbols/keywords from the
   change description, the closest existing analogue to what will be built, config/env touchpoints,
   and the tests covering the area. Each returns a `path:line` digest + a `## Not found` section.
   Keep the `## Not found` items — they become explicit risks in the dossier, never guesses
   (**DF-1**, **DF-2**).

4. **Fold in the ledger.** If `<artifactsDir>/ledger.md` exists, carry the entries relevant to
   these areas into the dossier's Risks section and into the debate (the adversary cites them).

5. **Synthesize the recon dossier** using `templates/recon.md`. The **Patterns to REUSE** section
   is the anti-duplication core (**DN-2**); the **Host Conventions & Hard Rules** section is what
   makes the adversary's floor check repo-aware (**DF-6**).

6. **Re-check depth.** If the digests reveal a materially different blast radius than the boot
   estimate (e.g. "one file" turned out to be a cross-cutting contract), recommend the corrected
   depth and re-confirm with the user. Otherwise proceed silently.

7. Present a 4–6 line recon summary and continue to Phase 1 — no separate gate here; the gate is
   at the end of each debate round.

Write the dossier to `<artifact dir>/recon.md` now (scratch mode: emit it inline as a fenced
markdown block instead). Keep it tight and evidence-cited — a dossier, not a copy of the source.
