# Recon: batch-execute-token-reduction

**Created**: 2026-11-06
**From**: product-spec.md
**Tree**: feature/batch-execute-token-reduction@5aac6e6 ≡ origin/feature/batch-execute-token-reduction (origin/main-dev merged)
**Affected services**: none (platform SDD tooling: `.claude/workflows/`, `.claude/agents/`, `.claude/skills/sdd-execute/`, `scripts/workflow-tests/`, `docs/patterns/context-engineering.md` §4, `.claude/context-map.yaml`)

---

## Objective

`/sdd-batch-execute` subagents carry about 100K tokens of fixed context on every turn (the default workflow-subagent type). They also read whole skill files and implementation specs of 100–160 KB. `validate` and `setup` re-run on every fresh relaunch. Across 14 runs this came to about 1.61B input tokens.

This feature cuts that cost in five ways:
- scoped agent types;
- an upfront validate record carried in the approval payload;
- an explicit resume gate;
- a distill gate;
- crash-safe pinned setup, plus scoped step reads and log-based verification output.

No SDD gate is weakened (FR-1..FR-9).

## Codebase Map

- **Workflow** — `.claude/workflows/sdd-batch-execute.js` (JS, 253 lines)
  - Entry: `return await pipeline(A.features, (f) => runFeature(f))` — `:253`. `runFeature` — `:135`.
  - Arg guards `:15-33`. `APPROVALS` `:27`, `STEP_CAP` `:28`, `FOLD` `:29`, `CHECKPOINTS` `:21`.
  - Schemas `:35-103`:
    - `PREFLIGHT` `:47` (required `:62`; `promotionPlan` `:60`).
    - `VALIDATE` `:64` (`mismatches[{n,detail}]`, `tooling_blockers`).
    - `WRITE` `:72` (`commits`, `notes`).
    - `IMPL` `:77` (required `:92`).
    - `PLAN` `:94`, `PR` `:99`.
  - Helpers:
    - `toUnits` `:106-117`; `approvals()` `:119-121`.
    - `writerRules(f,p)` `:123-133`. Items 1–6 are `:125-131`:
      - detached checkout `:125`;
      - `node_modules` symlink for husky `:126`;
      - trailer `:127-128`;
      - push and retry, never force `:129`;
      - one artifact per commit `:130`;
      - return commits `:131`.
      - The HARD CONSTRAINT paraphrase is `:132`.
    - `proceeds` `:138`; `ap` = first `checkpoint:`/`blocker:` approval `:139`.
  - `agent()` calls:

    | Call | Line | agentType | isolation | schema |
    |---|---|---|---|---|
    | preflight | `:141-149` | — | — | PREFLIGHT |
    | validate | `:163` | — | worktree | VALIDATE |
    | setup | `:178` | — | worktree | WRITE |
    | discover | `:196` | `codebase-discovery` | — | none |
    | step | `:197` | — | worktree | IMPL |
    | promotion-plan | `:238` | `scenario-promoter` | — | PLAN |
    | write-plan | `:240` | — | worktree | WRITE |
    | integration-pr | `:245` | — | worktree | PR |

    - preflight uses ToolSearch for the PR lookup (`:147`) and reads the promotionPlan fence (`:148`).
    - validate runs a local `-X ours` merge.
    - No call sets `model:` or `effort:`.
  - Gate:
    - `pending` `:156`; `blockedStep` `:157`; `resuming = !!ap` `:160`. The Gate block is `:161-181`.
    - The upfront halt (`:166-175`) carries `respec`, `tooling_blockers`, `blocked_step`, `plan` and `question`.
    - The setup prompt (`:178`):
      - hand-merges `origin/main-dev`, then runs `ledger-guard --fix`;
      - re-specs with a commit bundling feature.md and context.md;
      - flips status;
      - writes the session header `sdd-execute sequential (sdd-batch-execute)`.
  - Step loop `:183-229`:
    - `adjust` `:188`; blocker `operatorNote` `:190`; `stop here` `:191`.
    - The note is cleared after the first unit (`:198`).
    - The checkpoint fires at `:208`.
  - Land `:231-250`.
- **Workflow tests** — `scripts/workflow-tests/`
  - Harness, `harness.mjs`:
    - replies matched by label prefix `:13`, else `no mock for` `:14`;
    - `calls` records the full `opts` (`:12`);
    - function replies have the signature `(prompt, opts, calls)` (`:16`);
    - script globals are `args, agent, parallel, pipeline, log, phase, budget` (`:24`);
    - returns `{result, error, calls}` (`:27`).
  - Tests, `sdd-batch-execute.test.mjs` (top-level assert blocks 0–9, `:24-85`):
    - Block 1 (`:32-36`): 0 setup/step calls before upfront.
    - Block 2 (`:38-47`) asserts:
      - commits `['c-setup','c-step','c-step']` (`:42`);
      - writer-rule strings in `setup|step|write-plan|integration-pr` prompts (`:43-46`).
    - Block 3: 0 `validate:` calls on checkpoint resume (`:52`).
    - Block 7: the blocker note (`:69-74`).
    - Fixtures: `pre()` defaults `:11`, `replies()` keys `:13-22`.
- **Skill** — `.claude/skills/sdd-execute/`
  - SKILL.md headings:
    - `## PER-STEP EXECUTION` `:233`
    - `### PHASE 1` `:235`
    - `### PHASE 2` `:264`
    - `### PHASE 3: Execution` `:291`
    - `### STEP COMMIT + PR` `:336`
    - `## DEVIATION HANDLING` `:404`
    - `## CONTEXT.MD — Per-step entry format` `:421`
    - `## SESSION-END SUMMARY` `:437`
    - `## HARD CONSTRAINTS` `:476`
    - `## REPO CONVENTIONS` `:519`
  - PHASE 3 step 3 (`:301`): "Run the step's `**Verification**` command. Report the exact output."
  - The config-key wiring gate is `:310-323`, inside PHASE 3.
  - `reference/sequential-mode.md`:
    - §5.1b `:24`; §5.3 `:47`; §5.4 `:66`.
    - §5.4b "once per feature" `:75`.
    - §5.5 `:81`.
    - Carve-outs `:186-203`; the Phase-2 carve-out is `:188-191`.
    - Verification fallbacks `:207`.
  - `reference/tdd-gate.md`:
    - RED "fail for the right reason" `:35-38`;
    - GREEN coverage line `:41-42`;
    - red-N/A escape `:55-58`;
    - zero-assertions warning `:66-69`.
  - `reference/tooling-setup.md`: "once per session" at `:1,3`; sections §1–§5 at `:15,21,39,46,54`.
- **Agents** — `.claude/agents/` (12 files)
  - Frontmatter keys are `name, description, tools, model` only.
  - Every agent is `Glob, Grep, Read`, except `service-briefing` (`Read, Glob`). None has Bash, Edit, Write or `mcp__`.
  - Models: opus (adversary, proposer, synthesizer, distiller), sonnet (6), haiku (2).
- **Registry**
  - `.claude/context-map.yaml`:
    - agents header `:15` reads "isolated read-only windows"; 8 of 12 agents are listed (`:17-48`);
    - workflows `:50-64`; sdd-batch-execute `:56-59` (`tests:` `:59`);
    - sdd-execute skill `:80-90`. It omits `tooling-setup.md` and `atomic-units.md`.
  - `scripts/check-context-map.sh`:
    - checks map paths with `.md|ya?ml|sh|m?js` extensions (`:29`), so `.js` workflow paths are not checked;
    - checks `.md` refs in CLAUDE.md, SKILL.md, reference and agent files (`:34-46`);
    - does not require every agent to be listed.
- **Contract docs** — `docs/patterns/context-engineering.md`
  - §1:
    - read-only-by-default rule `:35-38`;
    - agent body = rules + method + explicit output format `:40-43`;
    - pin the model tier, never `inherit` `:45-47`;
    - tier table `:49-53` (opus `:51`: "a verdict that gates an irreversible write").
  - §4 `:153`:
    - workflows table header `| Workflow | Runs | Stops at |` `:167`;
    - `/sdd-batch-execute` row `:170`, Stops at "the up-front confirm · every smart checkpoint (default) · every blocker · merge-order · the promotion confirm".
  - Contract `:173`:
    - `prFooter`/`modeEntryConfirmed` `:177-179`;
    - approvals/relaunch `:180-186`, with the fenced state blocks `sdd-batch-design-state` / `sdd-batch-promotion-plan` at `:185-186`.
  - Preflight guards `:208-211`.
  - Operational notes:
    - push per artifact `:213-216`;
    - detached HEAD `:216-217`;
    - worktree cleanup `:217-218`;
    - `resumeFromRunId` + unchanged args `:218-220`;
    - read-only agents read the main checkout `:220-221`.
  - Tests paragraph `:223-226` ("Change a gate rule → change its test first.").
- **Helpers**
  - `scripts/merge-train-resolve.mjs`:
    - usage `:4` ("run after `git merge --no-commit`; prints JSON");
    - exports `:16,26,69,86,97`;
    - allowlist `classify` `:16-23`: ledger union, base first; hotfix-log; own `NNN-<slug>/` = ours; other feature dirs and `docs/reports/*.status` = theirs; else unresolvable;
    - exit codes `:145-148` (0 ok / 2 unresolvable / 64 usage; an uncaught throw exits 1);
    - stages nothing on exit 2 (`:133`) and never commits;
    - JSON output `{resolved[{path,rule}], unresolvable[{path,reason}]}` (`:147`);
    - subsequence guard `:85-91,113-118`;
    - prunes base-deleted paths `:121-132`.
  - `scripts/ledger-guard.py`:
    - usage `:4`; `--own-slug` is required (`:49`);
    - `--fix` needs merge-base(base, HEAD) == base (`:55-58`) and exits 2 otherwise;
    - reads committed trees through `git show` (`:24-28,61`);
    - `--fix` writes to the working tree and does not stage (`:87`);
    - exits 0 clean or repaired, 1 damage, 2 precondition failed.
  - `.husky/pre-commit`:
    - `pnpm exec lint-staged || exit 1` (`:6`);
    - UI lint and duplication check block only for `services/xstockstrat-ui/` (`:10-14`);
    - report-only duplication check elsewhere (`:18`);
    - depends on `pnpm` and installed deps.
  - `.gitignore:80-81` ignores `.claude/worktrees/`.
  - CI:
    - `context-map` paths filter `ci.yml:106-115` covers `.claude/**`, `scripts/workflow-tests/**`, `scripts/merge-train-resolve.mjs` and `docs/**`, but not `ledger-guard.py`;
    - job `:863-877` runs `check-context-map.sh` (`:874`) and `node --test scripts/workflow-tests/*.test.mjs` (`:877`).
- **Other workflows**
  - `sdd-batch.js` uses `agentType` on 8 calls (`:183,184,212,213,233,235,289,290`) and `isolation:'worktree'` on separate write calls (`:189,216,251,264,276,292`). No single call combines the two.
  - `merge-train.js` uses `effort:'low'` (`:123,160,183,193`).

## Patterns to REUSE

- Persist workflow state in a context.md fence, read by preflight:
  - reuse `sdd-batch-promotion-plan`: written `:240`, read `:148`, schema `:60`, consumed `:237`;
  - this becomes the `sdd-batch-setup` marker.
- Carry state across relaunches through approvals: reuse `approvals()` / `proceeds()` (`:119-121,138`), which already pass the operator's object verbatim. This becomes `approvals.upfront.record`.
- Scoped read-only stage agent: reuse the `agentType` + `schema` composition (`sdd-batch.js:183-184`, `sdd-batch-execute.js:196,238`).
- Agent definition shape: reuse the frontmatter in `.claude/agents/codebase-discovery.md:1-6` and the body format at `context-engineering.md:40-43`.
- Conflict allowlist during setup: reuse `scripts/merge-train-resolve.mjs` (`:4,16-23`) instead of hand rules at `:178`.
- Ledger repair after the merge: reuse `scripts/ledger-guard.py --fix` (`:55-58,87`).
- Gate tests:
  - reuse the label-prefix mock harness (`harness.mjs:12-16`) and the opts recording for `agentType` asserts;
  - extend `pre()` / `replies()` (`sdd-batch-execute.test.mjs:11-22`).
- Context compaction for large files: reuse `/sdd-distill` (`context-engineering.md` §3, `:129-140` per the spec), never truncation.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4 @FR-2 @feature-278` "An execute step that seeds a key is not marked done while its key has a finding" (`docs/sdd/business-rules/platform.feature`).
  - The config-key wiring gate (`SKILL.md:310-323`, inside `### PHASE 3`) must stay in the step agent's scoped reads.
  - FR-7's log-tail reading must not hide its output, because the gate is a separate command from the Verification fence.
- **PRESERVE** `@AC-5 @FR-2 @feature-278` "A step that touches no config key is not blocked by unrelated findings" (`docs/sdd/business-rules/platform.feature`). Nothing here may turn an unrelated wiring finding into a block.
- **PRESERVE** `@AC-10 @FR-2 @feature-278` "A migration that inserts a config row triggers the check" (`docs/sdd/business-rules/platform.feature`). The migration-insert trigger lives in the `SKILL.md:310` text that FR-6 keeps; the `:301` edit must not touch it.
- No existing acceptance suite covers `/sdd-batch-execute`, `/merge-train`, the SDD ledger, `context.md`, feature numbering, `ledger-guard.py`, `merge-train-resolve.mjs` or the workflow harness. No service suite applies (no affected services).
- No CHANGE flagged, so no C-16 sign-off is needed.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none (`CONTEXT_MAX` is a workflow constant)
- Inter-service edges: none
- New env vars / ports: none
- Workflow args contract (`context-engineering.md:173-193`) gains:
  - an optional `record` on the `upfront` approval;
  - new approvable gates `resume` and `distill`.
- The PREFLIGHT schema gains `mainDevSha`, `devSha`, `specHash`, `contextBytes` and `workflowSetup`.
- SETUP = WRITE + `tooling_blockers`, `stale`, `completed`.

## Risks / Not-found

- **Not found:** any `agent()` call combining `agentType` with `isolation:'worktree'`, and any agent with Bash/Edit/Write/`mcp__` in `tools:`. Both are runtime unknowns, to be resolved by the FR-9 spike before PR-1.
- **Not found:** any `model:` on a workflow `agent()` call. Tiers live only in agent frontmatter.
- **Not found:** any test asserting `validate:` count > 0, `setup:` count > 0, or `agentType` / `isolation` on calls. New gate tests must be written first (`context-engineering.md:226`).
- `check-context-map.sh` does not validate `.js` workflow paths (`:29`) and does not require agents to be listed.
  - Registering the two new agents is a convention, not a check.
  - The `:15` header "isolated read-only windows" becomes inaccurate once a writer agent is listed.
- `merge-train-resolve.mjs` exits 1 on an uncaught throw, with no handler. Setup must treat any non-zero exit other than 2 as "no commits".
- `ledger-guard --fix` reads the committed tree and writes unstaged. It must therefore run after the merge commit, and its repair must be `git add`ed and `--amend`ed.
- The husky hook needs `pnpm` and installed deps. If `node_modules` is missing it is silently inert (`fails.md:3361-3363`); writerRules item 2 (`:126`) is the mitigation.
- Ledger traps:
  - `fails.md:3086-3097`: never `-X ours`/`-X theirs` on append-only docs. validate `:163` still does this locally (out of scope, follow-up).
  - `fails.md:3250-3252`, `:3381-3383`, `:3451-3453`: stale launcher input, a discover digest read from the main checkout, renumbering.
  - `fails.md:3361-3363`: inert husky.
- The `:178` re-spec commit bundles feature.md and context.md, against writerRules item 5 `:130`. This is a pre-existing deviation the new setup order removes.
- `@AC-*` IDs 1–23 also appear in `platform.feature` under other `@feature-*` tags. Promotion must keep `@feature-301`.

## Recommended Scope

Advisory; not binding:

1. **PR-0 spike** (no merge): prove `agentType` + worktree, the MCP tool via `tools:`, a first turn ≤30K, an end-to-end writer step with husky, and bash 3.2 parity. Calibrate `CONTEXT_MAX`.
2. Gate tests first: extend `pre()` / `replies()` and add the scenarios for AC-3..AC-12, AC-21, AC-22.
3. Agent definitions + `agentType` wiring + preflight MCP call (FR-1).
4. PREFLIGHT/SETUP schemas + gate predicate: record, resume, distill, `completed` (FR-2..FR-5).
5. Setup prompt rewrite: pinned shas, resolver, ledger-guard order, `Approved-record:`, fence last (FR-5).
6. Step prompt read scope + verification output clause, and the `SKILL.md:301` edit (FR-6, FR-7).
7. `context-engineering.md` §4 + `context-map.yaml` (FR-8).
