# sdd-archiver — write & delete formats

Loaded at Phase 5. These are the exact blocks the orchestrator writes. The Ledger schema is the
canonical one from `docs/roadmap/ledger/CLAUDE.md` — do not vary it.

---

## 1. Ledger entries (append-only, newest at bottom)

Append each `[NEW]` candidate to the end of the matching file. **Skip every `[DUP:...]`.** One lesson
per entry; cite `path:line`. Never rewrite, reorder, or delete existing entries.

**`docs/roadmap/ledger/insights.md`** — categories `reuse | perf | design | ordering`:

```markdown
### <ISO date> — <feature-slug> — <category>
- **Pattern**: <what worked and why it's reusable>
- **Evidence**: <path:line or PR/step ref>
- **Rule it implies**: <one line; propose a Constitution ID if it should become binding>
```

**`docs/roadmap/ledger/fails.md`** — categories `assumption | duplication | migration | config | header | scope-creep`:

```markdown
### <ISO date> — <feature-slug> — <category>
- **Mistake**: <what went wrong and how it recurred>
- **Evidence**: <path:line or PR/step ref>
- **Rule it implies**: <one line; propose a Constitution ID if it should become binding>
```

Use `<feature-slug>` (the part after `NNN-`) to match the ledger's existing convention, and
`$TODAY` for `<ISO date>`.

---

## 2. `context.md` — full rewrite to archived form

Rewrite the file using `templates/archive-synthesis.md`. The header links + the `## Archive Synthesis`
block are all that survive; prior `## Session` logs are removed (recoverable via git history). Fill
every field from the synthesis digest. `**Pruned artifacts**` lists exactly what was `git rm`-ed;
`**Non-standard artifacts**` records the Phase-4b human choice per extra (or is omitted if there were
no extras).

---

## 3. `feature.md` — marker + Status History row (`status.md` UNCHANGED)

Add the header field immediately after the status/tracking block (e.g. after `**Launched date**` /
`**Last Updated**`):

```markdown
**Archived**: <ISO date>
```

Append one row to the `## Status History` table (do **not** touch `status.md`):

```markdown
| <ISO date> | `<terminal-status>` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(<n>)/fails(<m>); pruned <k> specs |
```

`<terminal-status>` is the feature's existing lifecycle status (`launched` / `rolled-back` /
`demoted/canceled`), quoted in backticks — it is recorded, not changed.

**Reconcile the `## Artifacts` section (mandatory — prevents dead links).** Every bullet that
Markdown-links a file this run prunes (`product-spec.md`, `recon.md`, `design.md`,
`implementation-spec.md`) must be rewritten so it no longer links the deleted file. Keep the label,
drop the link, and point at the synthesis:

```markdown
- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
```

Leave the `[Acceptance Scenarios](acceptance.feature)` and `[Context Log](context.md)` bullets as
live links (both files are retained) — and when scenarios were promoted at Phase 4c/5.4, append the
target suite path(s) to the acceptance bullet, e.g.
`; promoted to services/xstockstrat-<svc>/acceptance/<slug>.feature (C-16)`. Do **not** rewrite a
bullet whose target file is *not* being pruned. Omitting this step is what left a dead
`](product-spec.md)` link in 86 already-archived `feature.md` files (swept later by a repo-wide
reconciliation); catch it here so it never regenerates.

---

## 4. Prune (deletions)

```bash
# Allowlist only — of these, delete the ones present:
git rm docs/roadmap/features/<NNN-slug>/product-spec.md \
       docs/roadmap/features/<NNN-slug>/recon.md \
       docs/roadmap/features/<NNN-slug>/design.md \
       docs/roadmap/features/<NNN-slug>/implementation-spec.md
# Plus ONLY the extras the human chose "Delete it" for at Phase 4b, e.g.:
# git rm -r docs/roadmap/features/<NNN-slug>/<extra-the-human-deleted>
```

Never `git rm` `feature.md`, `status.md`, `context.md`, or any extra the human chose to
keep/relocate. If an allowlist file is absent, omit it (do not error).

---

## 5. Stage & commit

```bash
git add docs/roadmap/ledger/insights.md docs/roadmap/ledger/fails.md \
        docs/roadmap/features/<NNN-slug>/context.md \
        docs/roadmap/features/<NNN-slug>/feature.md
# (git rm has already staged the deletions)
git commit -m "docs(archive): archive <slug> — synthesis to context.md + Ledger, prune specs"
```

Stage nothing outside those files + the allowlisted deletions (F-08).
