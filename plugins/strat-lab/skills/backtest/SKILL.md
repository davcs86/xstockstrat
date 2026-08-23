---
name: backtest
description: "Run and analyze strategy backtests on the xstockstrat MCP server — REQUIRES that server to be connected; without it this skill has nothing to call. Use when the user asks to backtest a strategy, sweep a parameter such as cooldown, reconfirm or reproduce the numbers in a strategy report, run a basket of symbols, or validate a strategy in-engine. Handles the three ways the naive path silently fails: the diagnostics payload blowing the tool-output token limit, a multi-symbol run compounding capital sequentially instead of as an independent basket, and a freshly-edited strategy returning zero trades after an over-broad `clear_fields` erases its definition (`manage_strategy update` is a partial merge — an omitted field is preserved, and only `clear_fields` blanks one). Usage: `backtest <strategy_id> <symbols...> [--cooldown N] [--oracle FILE]`."
argument-hint: <strategy_id> <symbols...> [--cooldown N] [--oracle FILE]
allowed-tools: Read Write Bash(python3 *) Bash(ls *) Task AskUserQuestion
disable-model-invocation: true
---

You drive **strategy backtests on the xstockstrat MCP server** and turn their oversized diagnostics
into trustworthy numbers. This skill exists because the naive path fails three predictable ways:
the backtest result blows the tool-output token limit, the multi-symbol backtest compounds capital
sequentially (so it is *not* the independent basket a report usually means), and a
freshly-edited strategy can silently produce garbage. Each has a fixed, learned countermeasure below.

**Scope.** This targets the xstockstrat MCP tools: `run_backtest`, `trigger_backfill` /
`get_backfill_status`, `manage_strategy`, `set_strategy_live`. The server may be exposed under a
staging or prod name (e.g. `mcp__xstockstrat_staging__*`); if the tools are not loaded, find them
with ToolSearch first. Never assume a tool is absent without searching.

**Ownership (feature 133).** Strategies are **per-user**. `manage_strategy`, `set_strategy_live`,
`run_backtest`, `get_strategy` and `list_strategies` operate **only on the calling user's own
strategies** — they are **ownership-gated, not admin-gated** (any authenticated caller manages their
own; no admin role is required). A `strategy_id` you do not own returns `PERMISSION_DENIED` (uniform —
never NOT_FOUND, so it does not leak whether another user's id exists). `list_strategies` returns only
your own definitions. If a call unexpectedly returns `PERMISSION_DENIED`, you are acting on someone
else's `strategy_id`, not hitting a missing-admin-scope gate — pick an id you own or register a new
one.

**Progressive disclosure.** This file is the always-loaded router. Load each `reference/` file only
when its phase activates — not up front:
- `reference/backfill.md` — Phase 1, before any backtest.
- `reference/output-handling.md` — Phase 2, the moment the first `run_backtest` returns.
- `reference/aggregation.md` — Phase 3, when combining symbols into a basket.
- `reference/verification.md` — Phase 4, whenever an oracle or credibility gate is in play.
- `reference/self-grill.md` — Phase 4.5, before you report — the adversarial pass over your own result.

---

## Phase 0 — Frame the run

Establish, from the request: the `strategy_id`, the symbol list, and whether this is a **single
config** or a **parameter sweep** (e.g. a cooldown sweep). If the ask is "reconfirm the report" or
"validate in-engine," treat the report's own numbers as the **oracle** (Phase 4).

**A backtest score is technical-only (feature 097).** The number a `run_backtest` produces comes
from the strategy's technical rules alone — there is no newsletter-signal blend in the backtest
score (the old `signal_sources`/`signal_weight` blend in `strategy_params` was retired). Under
Option 2 a signal is a **universe + independent ranking axis** on the Decide → Opportunities queue,
never an input to a strategy's own score. So do not expect signal weighting to move backtest
numbers, and do not add signal params to a `run_backtest`. (`manage_strategy`'s `signal_params` is a
different thing — the live-loop symbol universe — and still matters for live evaluation.)

**Mutation guard (read before touching `manage_strategy`).** On this backend `manage_strategy
update` is a **partial merge (feature 070), not a full replace** — only the fields you actually pass
are changed, and everything you omit (`components`, `entry_rule`, `exit_rule`, `display_name`) is
preserved server-side. Tuning one parameter is therefore safe:
`manage_strategy(operation="update", strategy_id="range_mr_v3", cooldown_days=45)` leaves the rest
untouched. To **erase** a field deliberately, name it in `clear_fields` (e.g.
`clear_fields=["exit_rule"]`) — an omitted field is preserved, not cleared. The server refuses an
update that would empty `components` or blank a rule without naming it for erasure
(`INVALID_ARGUMENT`). If you mutate a strategy for a sweep, still record its original definition and
restore it at the end. If the strategy is `live_enabled`, disable live for the duration of a
parameter sweep and re-enable it at the end so it never evaluates at a config you are only testing.
`exit_cooldown_days` (the minimum-holding-period sibling to `cooldown_days`) behaves identically
under this partial-merge contract — send only it to change it, and use `clear_fields` to revert it
to the platform default.

**`denied_symbols` and `signal_eligible` (feature 132)** are two more partial-merge fields on
`manage_strategy`. `denied_symbols` is an **entry-only deny list** — a normalized-uppercase symbol
list the strategy must never evaluate *for entry*; a held position on a denied symbol still keeps
its **exit** tracing, so an operator can always exit what they already hold. Send only
`denied_symbols=[...]` to change it, or name it in `clear_fields` to clear. `signal_eligible` (a
bool, default false) gates whether the platform-wide active-signal term joins the strategy's live
evaluation universe; setting it `true` while `signal_params.symbols` already holds a non-empty
allowlist is rejected `INVALID_ARGUMENT` (the allowlist is already an explicit universe override, so
the two together are contradictory). Under the deny model an **empty** `signal_params.symbols` no
longer blocks enabling live — the strategy fires its whole owner universe (watchlist ∪ held ∪
signals-iff-eligible) minus the deny list.

## Phase 1 — Ensure data coverage (backfill)

A backtest silently reports fewer/short bars if the symbol's history is not backfilled. Before the
first run, confirm coverage and trigger a backfill if needed — see `reference/backfill.md`. Skip
only if the caller guarantees data is already present.

## Phase 2 — Run, and handle the oversized output

Call `run_backtest` **one symbol at a time** when you need clean per-symbol returns (the independent
basket; see Phase 3 for why). The result — full day-by-day diagnostics — almost always exceeds the
tool-output token limit and is written to a file instead. **Do not read that file raw.** Extract
only the summary fields and per-symbol trade counts with a small `python3` script (or a subagent).
The exact save-and-parse recipe, including the JSON shape, is in `reference/output-handling.md`.

## Phase 3 — Aggregate the basket

There are now **three** baskets, not two — pick before you aggregate:

1. **Portfolio mode (feature 150)** — `run_backtest(..., sizing_mode="portfolio")`. A real
   shared-capital portfolio: concurrent positions out of one pool, one **order-independent** equity
   curve. Its aggregate metrics (`total_return`, `max_drawdown`, `sharpe_ratio`) are directly
   comparable and need **no** manual per-symbol aggregation — read them straight off the result.
   The summary also carries a `capital_skips` count (entries the pool could not open). Use this when
   the request means "the real portfolio."
2. **Legacy sequential (default)** — a multi-symbol `run_backtest` with `sizing_mode` omitted still
   **compounds capital sequentially** in symbol order, so its multi-symbol aggregate is an
   ordering-dependent parlay. This is the footgun; prefer portfolio mode for the portfolio view.
3. **Independent-per-symbol** — run **single-symbol** backtests and aggregate them yourself (each on
   its own full capital). Still the right choice to isolate each symbol's response to a swept
   parameter, and what most sweep reports mean.

`reference/aggregation.md` has all three, plus the sum-PnL/avg-return formulas for option 3.

## Phase 4 — Verify before trusting

Numbers from a strategy you just created or edited are guilty until proven innocent. If you have an
oracle (a prior report, or a known-good pre-change run), confirm the new run reproduces it **to the
digit** — trade counts, total return, max drawdown, and a couple of per-bar indicator checkpoints.
`reference/verification.md` covers the credibility gate, what an exact match looks like, and the one
benign source of drift (a rolling data window that advances with the calendar). Report matches and
mismatches plainly; a mismatch is a finding, not a rounding error.

## Phase 4.5 — Self-grill (adversarial pass)

Before you report, **try to break your own conclusion.** Every headline this skill produces is one
mutation, one aggregation choice, or one un-restored config away from being wrong — this session's
findings each survived only because they were grilled. Load `reference/self-grill.md` and run its
checklist against your draft result. It is not a formality: each check that you cannot answer with
evidence already in hand is a backtest you must re-run before reporting. Resolve every doubt with a
tool call, not a caveat. Only a result that survives the grill (or whose residual doubts are stated
as explicit, bounded caveats) proceeds to Phase 5.

## Phase 5 — Report

Summarize per-symbol and basket results in a compact table (trades, return, PnL, and vs-oracle when
relevant). For a full write-up (sweep or report-style deliverable), start from
`templates/analysis-report.md`. State every caveat: single period vs out-of-sample, independent vs
sequential aggregation, and any strategy mutation you made and restored.
