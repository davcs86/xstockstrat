# Strat Lab

A backtesting workbench for the **xstockstrat** MCP server, published for **Claude Code** and
**Cursor** from one shared skill tree.

> **Requires the xstockstrat MCP server.** Unlike the other plugins in this marketplace, this one
> is not repo-agnostic — every phase calls `run_backtest`, `trigger_backfill` /
> `get_backfill_status`, `manage_strategy`, or `set_strategy_live` on that server. Without it
> connected, the skill has nothing to call and there is no fallback path. Install this only if you
> already run xstockstrat.

It exists because the obvious way to backtest fails in three predictable ways, each with a learned
fix baked into the skill:

1. **The output blows the token limit.** `run_backtest` returns full day-by-day diagnostics
   (~6k–10k lines per symbol). The skill saves-and-parses, extracting only summary metrics — it
   never reads the raw payload into context.
2. **The multi-symbol call compounds capital.** That is the sequential portfolio view, not the
   independent-per-symbol basket most reports mean. The skill runs single-symbol backtests and
   aggregates them (sum PnL / average return).
3. **An edited strategy can silently produce garbage.** The skill verifies every run against an
   oracle to the digit — trade blotter and per-bar indicator checkpoints — before trusting it, and
   warns that `manage_strategy update` is a partial merge (feature 070): omitted fields are
   preserved, and only `clear_fields` blanks one — so a mis-aimed `clear_fields` is the way you
   wipe components, not an omission.

It also ensures **data coverage first** (`trigger_backfill` / `get_backfill_status`) so a data gap
is never mistaken for a strategy problem.

## Skill

- **`/backtest`** `<strategy_id> <symbols...> [--cooldown N] [--oracle FILE]` — the full pipeline:
  backfill → run → save-and-parse → aggregate → verify → report. Progressive-disclosure router in
  `skills/backtest/SKILL.md`, with `reference/` files loaded per phase and a report template.

## Install

This plugin is published from **this repository**, which is its own marketplace:

```shell
/plugin marketplace add davcs86/xstockstrat
/plugin install strat-lab@davcs86-xstockstrat
```

For Cursor, add this repository as a marketplace source and install `strat-lab` from it.

Requires the xstockstrat MCP server to be connected; the skill finds its tools (`run_backtest`,
`manage_strategy`, `trigger_backfill`, `get_backfill_status`, `set_strategy_live`) via ToolSearch
if they are not already loaded.

> It previously lived in [`davcs86/agent-plugins`](https://github.com/davcs86/agent-plugins) and
> moved here so that a change to this server's API and the skill update it forces land in the
> same pull request.

## Validate

```shell
python3 plugins/strat-lab/scripts/validate.py --self-test
python3 plugins/strat-lab/scripts/validate.py
```
