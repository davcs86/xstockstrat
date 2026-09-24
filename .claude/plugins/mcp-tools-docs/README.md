# MCP Tools Docs

A **reference skill** for the tools exposed by the **xstockstrat-agent** MCP server, published for
**Claude Code** and **Cursor** from one shared skill tree.

## Why this exists

`docs/runbooks/mcp-tools.md` is the maintainer's tool reference — parameter tables, return shapes,
error cases, transport/OAuth setup, cross-tool usage patterns. But that runbook lives in the repo,
so a **wire-connected agent** (one that reaches the server over MCP and never checks out the code)
cannot read it. The correlation guidance, the int64-as-string traps, the partial-merge semantics of
`manage_strategy` — none of it reaches such an agent except through the tool docstrings.

This plugin closes that gap: it **projects the runbook into a skill** the agent can load. The router
[`SKILL.md`](skills/mcp-tools/SKILL.md) indexes every tool with a one-line summary; each tool has its
own `reference/tools/<name>.md` so only the tool in play is pulled into context, plus
`reference/transport-auth.md` and `reference/usage-patterns.md` for connection and cross-tool guidance.

## Single source of truth — no hand-copied drift

Every file under `skills/mcp-tools/` is **generated** from `docs/runbooks/mcp-tools.md`. Never edit
the skill by hand — edit the runbook and regenerate:

```shell
python3 .claude/plugins/mcp-tools-docs/scripts/generate.py          # rewrite the skill from the runbook
python3 .claude/plugins/mcp-tools-docs/scripts/generate.py --check   # fail (exit 1) if the skill is stale
```

`--check` is the freshness gate (same idea as the repo's proto-freshness check): if the runbook
changes and the skill is not regenerated, the check — and the plugin validator — fail.

## Skill

- **`/mcp-tools`** — the tool index. Progressive-disclosure router in `skills/mcp-tools/SKILL.md`;
  open one `reference/tools/<name>.md` at a time.

## Install

This plugin is published from **this repository**, which is its own marketplace:

```shell
/plugin marketplace add davcs86/xstockstrat
/plugin install mcp-tools-docs@davcs86-xstockstrat
```

The skill only *describes* the tools; the tools themselves come from a connected xstockstrat-agent
MCP server. The docs are useful for understanding the API even without the server connected.

## Validate

```shell
python3 .claude/plugins/mcp-tools-docs/scripts/validate.py --self-test
python3 .claude/plugins/mcp-tools-docs/scripts/validate.py
```

The validator checks both manifests, the skill frontmatter, every internal `reference/` link, the
marketplace registration, **and** that the generated skill is fresh versus the runbook.
