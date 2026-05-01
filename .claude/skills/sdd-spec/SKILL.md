---
name: sdd-spec
description: Phase 2 of SDD — generate an implementation spec by searching the codebase. Usage: /sdd-spec <feature-slug>. Reads product-spec.md, searches affected services for real file paths and symbol names, writes implementation-spec.md. No invented references — every step cites evidence found by grep.
argument-hint: <feature-slug>
disable-model-invocation: true
allowed-tools: Read Write Bash(ls *) Bash(find *) Bash(grep *) Bash(cat *)
effort: high
context: fork
agent: general-purpose
---

You are an implementation planner for the xstockstrat platform. Your job is to search the codebase and produce a concrete, numbered implementation spec that an engineer (or a future Claude session) can execute step by step.

**CRITICAL RULE**: Every step you write must cite evidence found in the codebase via Read, find, or grep. Never invent a file path, function name, struct name, or line number. If you cannot find something, say so explicitly.

## Arguments

- `$ARGUMENTS[0]` — feature slug. Required.

## Steps

### 1. Read the product spec

Read `docs/roadmap/features/$ARGUMENTS[0]/product-spec.md`.
If absent: stop with "No product spec found. Run /sdd-story $ARGUMENTS[0] first."

### 2. Read governance docs (always — no exceptions)

Read all of these before writing anything:

- `CLAUDE.md` — service registry, port map, inter-service dependency graph, config governance
- `docs/runbooks/feature-workflow.md` — branch model, migration file conventions, proto change gate, PR requirements, deployment stages
- `docs/runbooks/approval-flow.md` — approver matrix per change type
- `docs/roadmap/phase3-deviations.md` — implementation gotchas (migration naming, grpc_tools fallback, asyncpg pool, pagination)
- `docs/roadmap/phase4-deviations.md` — dual in-memory+DB storage, fill detection, ledger event patterns
- `docs/roadmap/phase5-deviations.md` — Connect-RPC refactor, SSE polling, missing infrastructure patterns
- `docs/roadmap/phase6-deviations.md` — webhook naming discrepancies, n8n workflow storage, auth scope

If the product spec mentions **config key changes**, also read `docs/runbooks/config-rollout.md`.
If the product spec mentions **proto changes**, also read `docs/runbooks/proto-versioning.md`.

### 3. Search each affected service

For every service listed in the product spec's "Affected Services" section:

a. Read `services/<name>/CLAUDE.md`
b. Run `find services/<name> -type f | sort` — real file inventory
c. Read the service's main entry point:
   - Go: `services/<name>/cmd/server/main.go`
   - Python: `services/<name>/app/main.py`
   - Node.js: `services/<name>/src/index.ts`
d. Read the handler/servicer file (contains existing RPC implementations):
   - Go: grep for `func.*Server` or `func.*Handler`
   - Python: `services/<name>/app/handlers/servicer.py`
   - Node.js: grep for `export.*function\|router\.\(get\|post\|put\)`
e. Run: `grep -rn "func \|def \|export function\|export const\|register\|handler\|servicer" services/<name>/` — locate real symbols with line numbers
f. Run: `ls services/<name>/migrations/ 2>/dev/null | sort` — find last NNN migration number
g. Run: `grep -rn "GetConfig\|WatchConfig\|config\." services/<name>/` — find config key read patterns

### 4. Search proto files (if proto changes required)

- Read `packages/proto/<service>/v1/<service>.proto` for each affected service
- Read existing stubs in `packages/proto/gen/go/`, `gen/python/`, `gen/ts/` to understand generated code shape

### 5. Apply the zero-assumption rule

Before writing any step instruction, verify you have grep or Read evidence for every reference. Specifically:

- ✗ "add a handler function" → ✓ "add `def ingest_signal(self, stream)` to `services/xstockstrat-ingest/app/handlers/servicer.py` after `query_signals` at L88, matching its signature pattern"
- ✗ "create a migration" → ✓ "create `services/xstockstrat-ingest/migrations/002_add_signals_table.up.sql` — confirmed last file is `001_newsletter_signals.up.sql` via `ls`"
- ✗ "update the config handler" → ✓ "add key `ingest.signals.polygon.enabled` following the SetConfig call pattern at `services/xstockstrat-config/src/handlers/config.ts:L34`"
- If a file or function is not found: write "**Not found** — this must be created from scratch; no existing pattern available in the codebase"

### 6. Write implementation-spec.md

Write `docs/roadmap/features/$ARGUMENTS[0]/implementation-spec.md`:

```markdown
# Implementation Spec: <slug>

**Status**: `pending`
**Created**: <ISO date>
**Feature**: `docs/roadmap/features/<slug>/feature.md`
**Total Steps**: N
**Feature Branch**: `feature/<slug>`

---

## Execution Summary

<2–4 sentences explaining the implementation order and why>

## Step Dependencies

- Step N requires Step M: <reason>
- (list all ordering constraints)

---

### Step N — <category>: <title>

**Status**: `pending`
**Service**: `xstockstrat-<name>` (or `packages/proto`, `docs/runbooks/`, etc.)
**Files**:
- `exact/path/to/file` — modify | create | delete

**Codebase Evidence**:
- Confirmed via: `grep -n "SymbolName" services/.../file.ext` → line N
- Existing pattern: `<direct quote or close paraphrase of actual code found>`

**Instructions**:
<Precise, actionable steps that cite real file paths and real symbol names confirmed above>

**Verification**:
<Exact bash command to run, or exact output/behavior to observe>

---

(repeat for all steps)

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
```

Categories to use for step naming: `proto`, `proto-gen`, `migration`, `service`, `config`, `docs`, `test`.

### 7. Update feature.md status

Edit `docs/roadmap/features/$ARGUMENTS[0]/feature.md`:
- Change `**Lifecycle Status**: \`draft\`` (or `spec-ready`) to `**Lifecycle Status**: \`implementation-ready\``
- Append a row to the Status History table:
  `| <ISO date> | <prev> → \`implementation-ready\` | /sdd-spec | Implementation spec generated with N steps |`
- Update the Artifacts section: replace `_not yet generated_` with `[Implementation Spec](implementation-spec.md)`
- Update Next Action to: `` `/sdd-execute <slug>` — begin implementation ``

### 8. Append to context.md

Append to `docs/roadmap/features/$ARGUMENTS[0]/context.md`:

```markdown
## Session <ISO timestamp> — sdd-spec

- Generated implementation-spec.md with N steps. Status → implementation-ready.
- Key codebase findings:
  - <finding 1 — e.g. last migration file, exact handler location, config key pattern>
  - <finding 2>
  - <finding 3 if relevant>
```

### 9. Report to user

```
Implementation spec written to docs/roadmap/features/<slug>/implementation-spec.md
Total steps: N
Feature status: implementation-ready

Next: /sdd-execute <slug>
```
