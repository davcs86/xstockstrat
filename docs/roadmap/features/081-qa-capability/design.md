# Design: qa-capability

**Created**: 2026-07-29
**Mode**: `quick` — 1 mandated round
**Rounds**: 1
**Termination**: adversary returned **BLOCKED**; the Floor breach was resolved by re-scoping, then
the design was approved by the user.

---

## Chosen Approach

**A read-only `qa-tester` subagent advises; a write-capable `sdd-qa` skill executes.** This is the
existing `/sdd-execute` + `codebase-discovery` shape (`context-engineering.md:19-35`), so **P-01**
holds without amendment: exactly one actor writes, and the agent only locates and assesses.

Five decisions define the shape:

1. **`sdd-qa defect` writes `docs/reports/<ISO-date>-<slug>-defect.md`; `/sdd-triage` gains
   `--from-report <path>`.** GitHub Issues are disabled (`recon.md` § Defect intake), so
   `gh issue create` is not an option. This matches what six features already do by hand and closes
   `/sdd-triage`'s entry gate for issue-less defects.
2. **Append C-13; narrow C-12 to a pointer.** C-13 is the language-agnostic test-data rule and
   **names a canonical fixture home per language**; C-12 becomes "the `xstockstrat-ui` instance of
   C-13."
3. **The write boundary is a file-pattern allowlist**, not a directory denylist.
4. **`sdd-qa flake` passes CLI flags; no config file is edited.**
   `--retries=0 --max-failures=0 --reporter=json` per invocation.
5. **The `sdd-design` coverage read extends `codebase-discovery`'s brief** via
   `discovery-checklist.md` rather than spawning a second agent per service.

## Floor breach — raised and resolved

**F-04** (never depend on something discovery cannot find). The original FR-5 was built on
`gh issue create`. Evidence that it cannot work: `067/context.md:20` and `074/feature.md:7` record
`POST /issues` → `410 Issues has been disabled`; `075`–`078` repeat it; `docs/CLAUDE.md:15` documents
`docs/reports/` as the standing workaround. The first recon draft had looked only at
`command -v gh` and framed this as a sandbox tooling gap — a **P-03** silent-assumption failure.

**Resolution**: decision 1 above re-scopes to the path that works today. The breach is cleared, not
waived. `F-11` therefore does not block.

## Rejected Alternatives

| Alternative | Why it lost |
|---|---|
| `gh issue create` + a documented fallback | The primary path is permanently dead on this repo; the feature would ship a sub-command that can never do its stated job. |
| Re-enable Issues, keep the original design | Possible, but `bug-report.yml:53`'s `SEV-1 safety check` label still forces T-2 to classify every defect Track A, so the parser needs hardening regardless. Defers a fix behind a repo-settings change. |
| Amend C-12 in place | Silently falsifies launched feature 069's `implementation-spec.md:304` ("C-12 does not apply — backend, not `xstockstrat-ui`") and `072/design.md:259`. The constitution has no amendment log, so an ID would stop meaning one thing. |
| Amend C-12 in place **+ add an `## Amendments` log** | Workable, but readers of 069 must know to consult the log. C-13 keeps the invariant without new machinery. |
| Drop the C-12 widening entirely | Removes the enforceability problem, but leaves backend test data ungoverned — the thing the whole-monorepo scope exists to fix. |
| Ship `sdd-qa` read-only in v1 | Cleanest against P-01/F-08/F-10, but loses the "writes the test for you" ergonomics, which is a real part of the value. Superseded by the boot interlock (FR-9), which makes the constraint falsifiable. |
| Spawn `qa-tester` in `sdd-design` Phase 0 | Doubles the agent count of every future design run forever and adds a P-02 surface, for a marginally better prompt. `recon-checklist.md:8` explicitly says reuse the discovery recipe. |
| Add a `json` reporter to `playwright.config.ts` | `:110` is a ternary whose local branch is a bare string, so both branches need patching; the json reporter writes to stdout unless `PLAYWRIGHT_JSON_OUTPUT_NAME` is set; and a config edit cannot force `--retries=0` per invocation, which FR-4 requires. CLI flags do all three for free and remove the only `services/**` edit. |
| 5 commits with deletion at #4 | `CLAUDE.md:465` and `context-map.yaml:63` still point at the skill at that commit → validator exits 1 → `context-map` CI job red. Three atomic commits are green by construction. |

## Open Risks

Mirrored into `context.md` § Open Threads.

- **The boot interlock (FR-9) is the load-bearing safety mechanism** and has no test until AC-11 is
  executed. Until then, "never bypass the TDD gate" is prose.
- **C-13's enforceability depends on the four duplicated sites landing together.** `step-constraints.md:30`'s
  Verification column is a literal TypeScript grep; if it is not given per-language equivalents, C-13
  binds Go and Python while `/sdd-review` has nothing to check.
- **`docs/patterns/ci-overview.md` has already drifted** (`:18` says `node-test` ×4; `ci.yml:541-553`
  runs 5). `sdd-qa gaps` sources from `ci.yml` to avoid inheriting the drift, but the doc itself stays
  wrong — out of scope here, worth a follow-up.
- **`/sdd-triage` T-2's substring matching stays fragile** for the issue path if Issues are ever
  re-enabled. The `--from-report` path avoids it by controlling the format; the issue path is not
  hardened by this feature.

## Constitution Rules Touched

| ID | How it is honored |
|---|---|
| **P-01** | `qa-tester` has `tools: Glob, Grep, Read` only; `sdd-qa` is the sole writer. |
| **P-02** | `qa-tester` never receives another agent's output; the skill mediates. |
| **P-03** | The `gh`-availability assumption that produced the F-04 breach is recorded here rather than papered over. |
| **P-04** | `sdd-qa defect` and every write confirm before acting. |
| **P-06 / C-08** | The `tdd-gate.md` hook is scoped to the one hole `tdd-gate.md:12-13` already names — a `service` step mislabelled `TDD: N/A` — and an agent-supplied assertion is recorded as a deviation, not silently absorbed. |
| **C-10** | `qa-tester` is registered in **both** registries (`context-map.yaml` and `context-engineering.md`), with the three pre-existing gaps backfilled. |
| **C-12 / C-13** | C-13 appended with per-language homes; C-12 narrowed to a pointer; all four enforcement sites updated together. |
| **F-02 / F-03** | `sdd-qa`'s `allowed-tools` contains no git-write verb and no `gh pr` — mechanical, not prose. |
| **F-04** | The `gh issue create` dependency is removed rather than assumed. |
| **F-08 / F-10** | The boot interlock refuses writes inside a live step's `**Files**`. |
| **F-11** | The Floor breach was resolved by re-scoping before approval, never waived. |
