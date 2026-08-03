# docs/roadmap/ledger/ — SDD Institutional Ledger

Cross-feature memory for the SDD pipeline. Where each feature's `context.md` is the *per-feature*
durable memory, the Ledger is the *cross-feature* one: lessons that should inform every future
feature, not just the one that produced them.

| File | Holds | Read by | Written by |
|---|---|---|---|
| `insights.md` | Patterns that worked (`reuse`/`perf`/`design`/`ordering`) | `/sdd-story`, `/sdd-design`, `/sdd-spec` | `/sdd-execute` at integration; `/sdd-archiver` at archival |
| `fails.md` | Mistakes that recurred (`assumption`/`duplication`/`migration`/`config`/`header`/`scope-creep`) | `/sdd-story`, `/sdd-design`, `/sdd-spec` | `/sdd-execute` at deviation-handling; `/sdd-archiver` at archival |

Both files are **append-only** and share the same entry schema (see each file's header). A recurring
`fails.md` entry is a candidate to promote into a binding rule in `docs/sdd/constitution.md`.

`/sdd-archiver` is the second writer: when a completed (terminal-state) feature is archived, its
irrecoverable cross-feature lessons are distilled here before its verbose spec artifacts are pruned.

See also: `docs/patterns/context-engineering.md` §3 (per-feature `context.md` memory) and the
`dry-reviewer` agent (live duplication detection; the Ledger is its durable counterpart).
