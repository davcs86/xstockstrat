"""Presentation split for the `run_backtest` MCP tool (feature 072).

`run_backtest` used to return the whole `BacktestResult` inline, including the feature-064
per-bar `diagnostics` — one row per symbol per bar, bounded only by
`analysis.backtest.max_range_days`. This module splits that into a compact inline summary plus
one attached resource carrying the full detail.

**It never re-serializes the proto.** It projects the dict `client.run_backtest` already returns,
and the attachment carries that same dict verbatim — so FR-3 fidelity holds *by construction*,
with no reassembler and no type-reconstruction table to get wrong. That is deliberate: a
flat/untyped format (CSV) cannot round-trip, because `MessageToDict` maps int64 to a JSON
**string** while int32 stays a number, so two numeric-looking columns would have to reconstruct
to different Python types.

Pure by contract: no gRPC, no I/O, and no `gen.*` import (AGENT-2 — `docs/context-constitution.md`).
The descriptor-parity test imports the proto in the test module instead.
"""

import json
from typing import Any
from urllib.parse import quote

from mcp.types import Annotations, EmbeddedResource, TextResourceContents

# Presentation constants, not config — nothing here is operationally tunable.
_ATTACHMENT_MIME = "application/json"
_URI_TEMPLATE = "xstockstrat:///backtest/{backtest_id}/result.json"
_ATTACHMENT_PRIORITY = 0.1

# Fields `summarize` drops on purpose (asserted by the descriptor-parity test: kept | dropped ==
# fields_by_name). portfolio_equity_curve is O(bars) like trades, so it too rides the attachment.
_INTENTIONALLY_DROPPED = frozenset({"trades", "portfolio_equity_curve"})

# sizing_mode and fill_model live in the head block so the mode/model always reach the caller inline
# (a portfolio or next-bar-open run is never silently read as legacy).
_HEAD_KEYS = ("backtest_id", "strategy_id", "status", "completed_at", "sizing_mode", "fill_model")

_METRIC_KEYS = (
    "total_return",
    "annualized_return",
    "sharpe_ratio",
    "max_drawdown",
    "win_rate",
    "total_trades",
    "profit_factor",
    "initial_capital",
)

# Per-symbol 0-trade diagnosis set. `bars` is deliberately excluded — that keeps the summary
# O(symbols), not O(symbols x bars).
_SYMBOL_KEYS = ("symbol", "no_trade_reason", "bars_total", "warmup_bars")


def summarize(result: dict[str, Any]) -> dict[str, Any]:
    """Project the FR-2 inline summary from a `client.run_backtest` dict.

    Total over partial dicts: a key is copied only when present, never defaulted to `None`. The
    guard is `k in result`, not truthiness — `always_print_fields_with_no_presence=True` means a
    real payload carries `total_return: 0.0` and `total_trades: 0`, and those are exactly the
    values the "0 trades / 0% return" diagnosis needs (`client.py` documents why).

    Values pass through uncoerced. `CoverageGap.bars_have`/`bars_need` arrive as string int64s
    (`"120"`/`"504"`) and stay strings.
    """
    summary: dict[str, Any] = {k: result[k] for k in _HEAD_KEYS + _METRIC_KEYS if k in result}

    # The only path an INSUFFICIENT_DATA run has to report itself — it gets no attachment.
    if "coverage_gaps" in result:
        summary["coverage_gaps"] = result["coverage_gaps"]

    # Surface run warnings inline (e.g. a soft-deleted formula) — must reach the caller even on an
    # INSUFFICIENT_DATA run with no attachment.
    if "warnings" in result:
        summary["warnings"] = result["warnings"]

    # Surface a capital-skip COUNT inline (the full list rides the attachment). Present-key test,
    # not truthiness, so a real `[]` collapses to 0.
    if "capital_skips" in result:
        summary["capital_skips"] = len(result["capital_skips"] or [])

    # Same key name as the full result so existing readers keep their path — only `bars` is dropped.
    if "diagnostics" in result:
        summary["diagnostics"] = [
            {k: d[k] for k in _SYMBOL_KEYS if k in d} for d in result["diagnostics"] or []
        ]

    return summary


def build_blocks(result: dict[str, Any]) -> list[EmbeddedResource]:
    """Build the FR-3 attachment: at most one resource carrying the complete result.

    Returns `[]` when there is nothing to attach. The test is for *content*, never for `status`:
    an INSUFFICIENT_DATA run has no trades and no bars, so AC-4 falls out of the general rule
    instead of needing a status branch.
    """
    has_trades = bool(result.get("trades"))
    has_bars = any(d.get("bars") for d in result.get("diagnostics") or [])
    if not (has_trades or has_bars):
        return []

    return [
        EmbeddedResource(
            type="resource",
            annotations=Annotations(audience=["user"], priority=_ATTACHMENT_PRIORITY),
            resource=TextResourceContents(
                # quote() the id: AnyUrl silently normalises a path, so an un-quoted `../` could
                # collapse `xstockstrat:///backtest/<id>/...` into a different URI (path traversal).
                uri=_URI_TEMPLATE.format(
                    backtest_id=quote(result.get("backtest_id") or "unknown", safe="")
                ),
                mimeType=_ATTACHMENT_MIME,
                # `result` verbatim — no re-projection. This is the whole fidelity argument.
                text=json.dumps(result, separators=(",", ":")),
            ),
        )
    ]


def attachment_refs(blocks: list[EmbeddedResource]) -> list[dict[str, str]]:
    """Describe each block for the inline summary (FR-5 degradation aid).

    A client that renders no attachment affordance still shows the user that detail exists, and
    under what URI.
    """
    return [{"uri": str(b.resource.uri), "mime_type": b.resource.mime_type} for b in blocks]
