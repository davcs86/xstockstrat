---
name: sdd-spec
description: Phase 2 of SDD — generate an implementation spec by searching the codebase. Usage: /sdd-spec <feature-slug>. Reads product-spec.md, searches affected services for real file paths and symbol names, writes implementation-spec.md. No invented references — every step cites evidence found by grep.
argument-hint: <feature-slug>
allowed-tools: Read Write Bash(ls *) Bash(find *) Bash(grep *) Bash(cat *) Task
effort: high
context: fork
agent: general-purpose
---

You are an implementation planner for the xstockstrat platform. Your job is to search the codebase and produce a concrete, numbered implementation spec that an engineer (or a future Claude session) can execute step by step.

**CRITICAL RULE**: Every step you write must cite evidence found in the codebase via Read, find, grep, or a `codebase-discovery` digest. Never invent a file path, function name, struct name, or line number. If you cannot find something, say so explicitly.

**Progressive disclosure**: this file is the router. Load a `reference/` file only at the
step that needs it — do not read all three up front.

## Arguments

- `$ARGUMENTS[0]` — feature slug. Required.

## Steps

### 0. Resolve feature directory

```bash
find docs/roadmap/features -maxdepth 1 -type d -name "*-$ARGUMENTS[0]"
```
If no directory is found: stop — "No feature directory found for slug `$ARGUMENTS[0]`. Run /sdd-story first."
Capture the result as `FEATURE_DIR`. Use `$FEATURE_DIR` for all file reads and writes.

### 1. Read the product spec and lifecycle guard

Read `$FEATURE_DIR/product-spec.md`. If absent: stop with "No product spec found. Run /sdd-story $ARGUMENTS[0] first."

Read `$FEATURE_DIR/feature.md` and check `**Lifecycle Status**`.
If status is `draft` (`/sdd-review product-spec` has not been run):
> "Product spec has not been AI-reviewed. Run `/sdd-review $ARGUMENTS[0] product-spec` first
> to advance to `spec-ready`. Proceed anyway? (yes / no)"
Only continue on `yes`.

### 2. Read governance docs (always — no exceptions for base docs)

Always read before writing anything:

- `CLAUDE.md` — service registry, port map, inter-service dependency graph, config governance
- `docs/runbooks/reviewer-registry.md` — service review focus, role reviewers, step-category governance matrix

Apply these static conventions from feature-workflow.md without reading it:
- **Migration naming**: `NNN_description.up.sql` + `NNN_description.down.sql`; NNN continues from the last file found in `services/<name>/migrations/`
- **Proto verification**: all `proto` steps must include `buf lint && buf breaking --against ".git#branch=feature/<slug>"` in `**Verification**`

Read `docs/runbooks/approval-flow.md` only if the product spec lists breaking proto changes or database schema changes.

Then read only the phase deviation files whose services appear in "Affected Services":

- `docs/roadmap/phase3-deviations.md` — `xstockstrat-indicators`, `xstockstrat-ingest`, or `xstockstrat-analysis`
- `docs/roadmap/phase4-deviations.md` — `xstockstrat-trading` or `xstockstrat-portfolio`
- `docs/roadmap/phase5-deviations.md` — `xstockstrat-trader`, `xstockstrat-insights`, or `xstockstrat-config-ui`
- `docs/roadmap/phase6-deviations.md` — `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, or `xstockstrat-config`; OR if the spec mentions "n8n" or "webhook"

If the spec mentions **config key changes**, also read `docs/runbooks/config-rollout.md`.
If the spec mentions **proto changes**, also read `docs/runbooks/proto-versioning.md`.

### 3. Discover each affected service (delegate — keep this window lean)

For every service in "Affected Services", spawn a **`codebase-discovery`** subagent (one per
service, in parallel via the Task tool) and hand it the checklist in
`reference/discovery-checklist.md` — tailored with the specific symbols, config keys, env
vars, and ports this feature introduces. Each subagent returns a condensed digest of real
`path:line` evidence; collect those digests as the `**Codebase Evidence**` for the steps that
touch that service.

The discovery checklist also covers the trading-domain symbol survey and the proto-file
search — run those parts only when they apply (see the checklist's guard conditions).

If you prefer to search inline for a single-service feature, the checklist is the same recipe
— but for multi-service features, delegate so this planner's window holds digests, not raw greps.

### 4. Apply the zero-assumption rule

Before writing any step instruction, verify you have evidence (grep, Read, or a discovery
digest) for every reference:

- ✗ "add a handler function" → ✓ "add `def ingest_signal(self, stream)` to `services/xstockstrat-ingest/app/handlers/servicer.py` after `query_signals` at L88, matching its signature pattern"
- ✗ "create a migration" → ✓ "create `services/xstockstrat-ingest/migrations/002_add_signals_table.up.sql` — confirmed last file is `001_newsletter_signals.up.sql`"
- ✗ "update the config handler" → ✓ "add key `ingest.signals.polygon.enabled` following the SetConfig call pattern at `services/xstockstrat-config/src/handlers/config.ts:L34`"
- If a file or function is not found: write "**Not found** — this must be created from scratch; no existing pattern available in the codebase"
- ✗ "add the env var to docker-compose" → ✓ "add `NEW_ENDPOINT: http://xstockstrat-new:8061` to the `xstockstrat-<name>` `environment:` block in `docker-compose.yml` (confirmed absent); add `- key: NEW_ENDPOINT` / `value: ${xstockstrat-new.PRIVATE_URL}` to the `envs:` block in `.do/app.dev.yaml` and `.do/app.yaml` (confirmed absent)"

### 5. Apply step constraints

If the feature is trading-domain-relevant, or for any `service` step, apply the constraints in
**`reference/step-constraints.md`** (trading-domain table + cross-cutting code-quality table +
lint command table). Load it now.

### 6. Write implementation-spec.md

Write `$FEATURE_DIR/implementation-spec.md` using the structure, step categories, and
test-step-pairing rules in **`reference/spec-template.md`** (includes the coverage-threshold
table). Load it now.

### 7. Update feature.md status

Edit `$FEATURE_DIR/feature.md`:
- Change `**Lifecycle Status**: \`draft\`` (or `spec-ready`) to `**Lifecycle Status**: \`implementation-ready\``
- Append a Status History row: `| <ISO date> | <prev> → \`implementation-ready\` | /sdd-spec | Implementation spec generated with N steps |`
- Update Artifacts: replace `_not yet generated_` with `[Implementation Spec](implementation-spec.md)`
- Finalize the `## Reviewers` table: collect all distinct `**Reviewers**` values from all
  steps, deduplicate, and write the canonical snapshot table (stable unless `/sdd-spec` re-runs).
- Update Next Action to: `` `/sdd-review <slug> impl-spec` — validate implementation spec, then `/sdd-execute <slug>` ``

### 8. Append to context.md

Append to `$FEATURE_DIR/context.md`:

```markdown
## Session <ISO timestamp> — sdd-spec

- Generated implementation-spec.md with N steps. Status → implementation-ready.
- Key codebase findings:
  - <finding 1 — e.g. last migration file, exact handler location, config key pattern>
  - <finding 2>
  - <finding 3 if relevant>
```

If the feature uses the structured-header memory schema (see
`docs/patterns/context-engineering.md`), also fold durable findings into the `## Decisions`
and `## Open Threads` header blocks, not just the session log.

### 9. Report to user

```
Implementation spec written to docs/roadmap/features/<NNN-slug>/implementation-spec.md
Total steps: N
Feature status: implementation-ready

Next: /sdd-review <slug> impl-spec
```
