# design-buddy — config protocol

Load this only when `.claude/design-buddy.json` is absent (first run in a repo) or unreadable.

## The config file

`.claude/design-buddy.json` at the host repo root — committable, so a team shares one setting.
Whether to gitignore it is the host repo's call. Schema (version 1):

```json
{
  "version": 1,
  "artifactsDir": "docs/design",
  "ledger": true,
  "created": "<ISO date>"
}
```

- `artifactsDir` — string (repo-relative directory) or `null` for scratch mode.
- `ledger` — boolean; when `true`, an append-only `<artifactsDir>/ledger.md` collects one-line
  lessons across changes. Always `false` when `artifactsDir` is `null`.

## First-run interview

Ask once, via a single `AskUserQuestion` with two questions:

1. **Where should design-buddy store its artifacts (recon/design/plan docs)?**
   - `docs/design/` (recommended) — durable, reviewable design records committed with the code.
   - `.design-buddy/` — keeps records out of docs; add to `.gitignore` if they shouldn't ship.
   - Custom path — the user names a directory.
   - Scratch only — no files; artifacts are emitted inline in chat.
2. **Seed a lessons ledger?** (skip/force "no" when scratch-only)
   - Yes — an append-only `ledger.md` at the artifacts dir records one-line lessons (patterns
     that worked, mistakes to avoid) that future runs read during recon and debate.
   - No.

Then, with the Write tool (never a script):

1. Write `.claude/design-buddy.json` (create `.claude/` if missing).
2. If `ledger: true` and `<artifactsDir>/ledger.md` is absent, seed it:

```markdown
# design-buddy — lessons ledger

Append-only. One entry per lesson, newest at the bottom. Future design-buddy runs read this
during recon and hand relevant entries to the adversary.

Entry schema:

### <ISO date> — <change slug> — <lesson | trap>
- **Lesson**: <one line — what worked, or what went wrong>
- **Evidence**: <path:line, PR, or design doc reference>

<!-- Append entries below. Newest at the bottom. -->
```

Announce the chosen location in one line and continue the boot sequence.

## Scratch mode semantics

`artifactsDir: null` means **no files are written anywhere** — not even temp files. Each artifact
(recon, design, plan) is emitted inline in the conversation as a complete fenced markdown block,
so the user can save it wherever they want. The plan skill accepts a pasted design doc or
same-session context in place of a file. First-run interview labels a real directory as
recommended precisely because scratch mode has no durable memory across sessions.
