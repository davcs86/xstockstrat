---
name: sdd-status
description: Show feature implementation status for all or a specific feature. Usage: /sdd-status [feature-slug]. Lists lifecycle status, step completion, last session, and next action. Read-only — makes no changes.
argument-hint: [feature-slug]
disable-model-invocation: true
allowed-tools: Read Bash(ls *) Bash(find *) Bash(grep *)
effort: low
---

You are reporting the status of SDD features. This skill is read-only — you make no changes to any files.

## Arguments

- `$ARGUMENTS[0]` — feature slug (optional). If absent, show all features.

---

## If no slug provided — show all features

1. Run: `find docs/roadmap/features -maxdepth 1 -mindepth 1 -type d | sort`
2. For each directory found:
   - Read `feature.md` → extract `**Lifecycle Status**` and the last row of the Status History table
   - Read `implementation-spec.md` (if it exists) → count steps by status: grep for `` **Status**: `done` ``, `` **Status**: `pending` ``, `` **Status**: `blocked` ``, `` **Status**: `in-progress` ``
   - Read `context.md` (if it exists) → find the most recent `## Session` heading for last-session date

3. Print a summary table:

```
Slug                  | Status               | Steps     | Last Session
----------------------|----------------------|-----------|----------------------------
polygon-data-source   | in-progress          | 3/7 done  | 2026-05-01 sdd-execute
rsi-alert             | implementation-ready | 0/5 done  | 2026-04-30 sdd-spec
legacy-cleanup        | demoted/canceled     | —         | 2026-04-28 sdd-story
```

4. After the table, print:
   - Features with `blocked` steps: "⚠ Blocked steps in: <slug-list>"
   - If no features exist: "No features found. Start with: /sdd-story <slug> <story text>"

---

## If slug provided — show detail for one feature

### 1. Read feature.md

Print:
```
Feature: <slug>
Lifecycle Status: <status>

Status History:
<full table from feature.md>
```

### 2. Read implementation-spec.md (if exists)

Print all steps with their current statuses:
```
Implementation Steps:
  Step 1 [done]     — proto: Add IngestSignal RPC
  Step 2 [done]     — proto-gen: Regenerate stubs
  Step 3 [pending]  — migration: Add signals table
  Step 4 [blocked]  — service: Register handler (see context.md)
  Step 5 [pending]  — config: Add ingest.signals.enabled key
```

Highlight any `blocked` steps with a note: "Step N is blocked — check context.md for details."

### 3. Read context.md (if exists)

Print all session entries (## Session headings) with their summaries:
```
Session Log:
  2026-05-01T10:00Z — sdd-story: created product-spec.md
  2026-05-01T11:30Z — sdd-spec: generated 7 steps, status → implementation-ready
  2026-05-01T14:00Z — sdd-execute: steps 1–2 done, stopped at step 3
```

### 4. Print recommended next action

- All steps done → "Feature complete (code-completed). Update feature.md manually when deployed."
- Any `blocked` steps → "Step N is blocked. Read context.md and resolve the blocker, then re-run /sdd-execute <slug> N"
- Steps pending → "/sdd-execute <slug> next  (next: Step N — <title>)"
- No implementation-spec.md → "/sdd-spec <slug>  (implementation spec not yet generated)"
- No product-spec.md → "/sdd-story <slug>  (no product spec — provide story text)"
