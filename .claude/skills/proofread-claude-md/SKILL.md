---
name: proofread-claude-md
description: Advisory content review of CLAUDE.md files — checks for stale references, contradictions with root CLAUDE.md, and missing critical info. Runs within the current session at no extra API cost.
argument-hint: [file...]
allowed-tools: Read Bash(find *)
effort: low
---

Review the specified CLAUDE.md file(s) for content correctness. Runs entirely with the Read tool inside the current session — no external API calls.

## Arguments

- `$ARGUMENTS` — space-separated file paths (optional). If absent, find and review all CLAUDE.md files in the repo.

---

## Steps

### 1. Collect files

If `$ARGUMENTS` is non-empty: use the provided paths as the file list.

Otherwise:
```bash
find . -name "CLAUDE.md" -not -path "*/.git/*" | sort
```

### 2. Load source of truth

Before reviewing any file, read the root `CLAUDE.md` in full — it is the authoritative source for:
- Service names and their gRPC/HTTP ports (§Service Registry)
- Language versions and tooling (§Language Versions & Tooling)
- Config governance rules (§Config Governance Rules)
- Branch strategy and merge rules (§Branch Strategy)

### 3. Review each file

For each file in the list, use the Read tool to read it in full, then check for:

1. **Stale references** — port numbers, service names, tool versions, or file paths that conflict with root CLAUDE.md or are self-inconsistent
2. **Internal contradictions** — two instructions within the same file that cannot both be correct
3. **Root CLAUDE.md contradictions** — instructions that conflict with root-level governance (config keys, branch rules, migration conventions, etc.)
4. **Missing critical info** — a section tells developers to do X but omits the concrete command or path they need to act on it

### 4. Print results per file

For each file:
```
=== path/to/CLAUDE.md ===
1. <one-sentence issue description>
2. <one-sentence issue description>
   (or "No issues found.")
```

### 5. Print summary

```
Reviewed N file(s). Issues found in M file(s).
```

## Rules

- Flag concrete, actionable issues only — not style or rewrites
- One sentence per issue
- Do not skip files with no issues — print "No issues found." for them
- Do not modify any files
