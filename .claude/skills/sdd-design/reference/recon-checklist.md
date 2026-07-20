# sdd-design — Phase 0 recon checklist

Load this at the start of **Phase 0**. Recon owns discovery for the design phase; `/sdd-spec` later
*consumes* the `recon.md` you write here instead of re-discovering from scratch.

## How to run it

1. **Reuse the existing discovery recipe — do not reinvent it.** The per-service survey is exactly
   `.claude/skills/sdd-spec/reference/discovery-checklist.md` (base survey, trading-domain survey,
   proto search). For every service in the product spec's **Affected Services**, spawn a
   **`codebase-discovery`** subagent (one per service, in parallel via Task) and hand it that
   checklist, tailored with this feature's specific symbols / config keys / env vars / ports.
2. **Collect the digests.** Each subagent returns `path:line` evidence + a `## Not found` section.
   Keep the `## Not found` items — they become explicit risks/unknowns in `recon.md`, never guesses
   (Constitution **F-04**, **P-03**).
3. **Fold in the Ledger.** Cross-reference the relevant `docs/roadmap/ledger/insights.md` entries
   (reusable patterns) and `fails.md` entries (known traps) for these services.
4. **Synthesize into `recon.md`** using `templates/recon.md`.

## What recon.md must capture (maps to the template sections)

- **Objective** — 2–3 sentences distilled from `product-spec.md`.
- **Codebase Map** — affected services → their key files, entry points, handlers, last migration
  number, config-read patterns (all `path:line` from the digests).
- **Patterns to REUSE** — the anti-duplication core. For each thing the feature needs, name the
  existing pattern/helper/type to reuse and its `path:line`. Cross-reference `dry-reviewer`-style
  thinking: prefer an existing canonical home over a new one.
- **Dependencies** — proto/RPC touchpoints (+ existing field numbers), migration chain position,
  config keys, inter-service edges, new env vars (and whether they're absent from
  `docker-compose.yml` / `.do/app.dev.yaml` / `.do/app.yaml`).
- **Risks / Not-found** — everything the digests reported under `## Not found`, plus design unknowns
  and any `fails.md` traps that apply.
- **Recommended Scope** — advisory step boundaries the grilling and `/sdd-spec` can start from.

Keep `recon.md` tight and evidence-cited. It is a dossier, not a copy of the source.
