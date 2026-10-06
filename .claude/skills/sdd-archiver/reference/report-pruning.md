# sdd-archiver — pruning resolved defect reports

Loaded when a run has prunable defect reports (Phase 1 `PRUNABLE-REPORT` rows). A defect report is a
`docs/reports/*.md` with a `.status` sidecar (format: `.claude/skills/sdd-qa/reference/defect-filing.md`
§ The status sidecar). Audits, bake-offs and catalogs have no sidecar and are never touched.

## R-1. Prunable test

A report is prunable when its sidecar says:
- `resolved` or `wont-fix`; **or**
- `triaged` with `ref: feature:<NNN-slug>` and that feature's `status.md` (from `origin/main-dev`)
  is `launched`.

A `feature:` ref at `rolled-back` / `demoted/canceled` means the fix did **not** ship: leave the
report, and list it in the PR body as an open thread ("fix feature `<NNN-slug>` is `<status>`;
report still unresolved"). `open` and other `triaged` reports are never prunable.

## R-2. Synthesize lessons (read-only, delegated)

Dedup pre-scan — fixed-string, both the report basename and (when the ref is a feature) the
feature's two number-bearing forms (SKILL.md Phase 3):

```bash
grep -Fn -e "$REPORT_BASENAME" [-e "$NNN-slug" -e "$slug ($num)"] \
  docs/roadmap/ledger/insights.md docs/roadmap/ledger/fails.md
```

Spawn `feature-synthesizer` in **report-synthesize** mode, passing the report path, its sidecar
`ref:`, the dedup lines, and — for a `feature:` ref — that feature's `context.md` path, so a lesson
the feature archive already carries is tagged `[DUP]` rather than written twice. Most reports yield
**no** candidate: a root cause the fix commit or the feature already records is recoverable and is
excluded. Only the generalizable mistake (the class of bug, the missed signal, why tests didn't
catch it) earns a `fails.md` / `insights.md` entry.

## R-3. Verify (blocks deletion)

Spawn `feature-synthesizer` in **verify** mode with the digest and the report as the file about to
be deleted. Same rule as Phase 3.5: no deletion until `complete` with an empty `MISSED`.

## R-4. Consent

Covered by the Phase-4 gate: list each prunable report with its sidecar status/ref and its `[NEW]`
candidate count. A report-only run (`reports` mode) issues one batch gate: "Prune all <K> reports" /
"Review one-by-one" / "Cancel".

## R-5. Write + prune

1. **Ledger.** Append each `[NEW]` candidate (`reference/write-formats.md` § 1), with the report
   basename (no `.md`) in the `<feature-slug>` position — or the feature's slug when the ref is a
   feature, so dedup against that feature's archive keeps working.
2. **Repoint inbound references.** `grep -rlF "$REPORT_BASENAME" docs .claude services` (excluding
   the report and its sidecar). In each hit, rewrite a Markdown link to the report as plain text
   followed by ` (pruned <TODAY>; `git show <pre-archive-SHA>:docs/reports/<file>`)`; append the same
   suffix to a plain-text path mention. Never rewrite a ledger entry (append-only) — a ledger line
   citing the report stays as-is; the `git show` pointer is recoverable from this commit's message.
3. **Prune.** `git rm docs/reports/<basename>.md docs/reports/<basename>.status` — nothing else.
4. **Stage** the ledger files and the repointed files only.

Commit (one per run): `docs(archive): prune <k> resolved defect report(s) — lessons to Ledger`,
with each pruned path and the pre-archive SHA in the body. The PR body lists, per report: status,
ref, ledger entries written (or "none worth saving"), and inbound references repointed.
