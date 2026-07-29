# Strat Lab Plugin — the bundled `backtest` skill tracks this server's API

This repo ships an agent plugin, `plugins/strat-lab/`, whose `backtest` skill is **a record of
how this server actually behaves**. It is not general backtesting advice: every countermeasure in
it exists because a specific xstockstrat API did something a caller would not expect.

That makes it different from documentation. Docs that fall behind are merely unhelpful; this skill
is *executed* by an agent that trusts it, so a stale claim here produces confidently wrong trading
numbers rather than a confused reader.

## The guard rail

**Changing any behavior listed below obliges you to update the skill in the same pull request.**
Not a follow-up issue, not a TODO — the same PR, because the two are only ever correct together.

| If you change… | Update |
|---|---|
| `manage_strategy` update semantics — currently **replace, not merge**: a partial update wipes a strategy's components and rules, and every later backtest returns 0 trades with `NO_TRADE_REASON_ENTRY_NEVER_TRUE` | `skills/backtest/SKILL.md` (Phase 0 mutation guard) |
| `run_backtest`'s diagnostics payload size — currently exceeds the agent tool-output token limit, so results are written to a file and parsed rather than read raw | `skills/backtest/reference/output-handling.md` (the JSON shape and save-and-parse recipe) |
| Multi-symbol `run_backtest` capital handling — currently **compounds sequentially**, which is not the independent-per-symbol basket most reports mean | `skills/backtest/reference/aggregation.md` (sum-PnL / average-return formulas) |
| `trigger_backfill` / `get_backfill_status` contracts, or what an uncovered symbol silently returns | `skills/backtest/reference/backfill.md` |
| Tool names or the server's exposed name (e.g. a staging vs prod prefix) | `skills/backtest/SKILL.md` (Scope paragraph) |

Renaming or removing any of `run_backtest`, `trigger_backfill`, `get_backfill_status`,
`manage_strategy`, `set_strategy_live` breaks the skill outright.

## Why the plugin lives here

It previously lived in [`davcs86/agent-plugins`](https://github.com/davcs86/agent-plugins)
alongside repo-agnostic plugins. It moved because nothing there could observe this server: an API
change and the skill correction landed in different repositories, at different times, with no test
binding them. Beside the code, the obligation above is reviewable in the diff that creates it.

The rest of that marketplace stayed put — those plugins work on any codebase, while this one does
nothing without this server connected.

## Working on it

The plugin ships its own dependency-free validator (manifests parse and carry required fields,
skill frontmatter is present and YAML-safe, every `reference/`/`templates/` path named in the
SKILL.md resolves, and no host-specific strings leak in):

```shell
python3 plugins/strat-lab/scripts/validate.py --self-test
python3 plugins/strat-lab/scripts/validate.py
```

Both must pass before the plugin changes ship. Note the frontmatter check is not cosmetic: an
unquoted frontmatter value containing `: ` parses as a nested mapping, which silently drops
*every* field including `name` and `allowed-tools`, leaving a skill that loads and does nothing.

The repo is its own marketplace — `.claude-plugin/marketplace.json` and
`.cursor-plugin/marketplace.json` register the plugin for Claude Code and Cursor respectively.
Keep the `version` in `plugins/strat-lab/.claude-plugin/plugin.json` and
`.cursor-plugin/plugin.json` byte-identical; they are two tools' views of one release.
