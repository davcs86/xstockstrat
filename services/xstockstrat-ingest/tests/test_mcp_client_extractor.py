"""Unit tests for McpClientExtractor (feature 166, AC-4 parse half).

Pure coroutine over an already-fetched result list — no DB, no network. Valid items map to
ExternalSignal-shaped dicts; malformed items (missing symbol/direction, direction outside the
four-value set, conviction outside [0,1] or NaN) are skipped, not fatal (FR-5).
"""

import math

from app.extractors.base import McpClientInput
from app.extractors.mcp_client import McpClientExtractor


async def test_valid_item_maps_all_fields():
    raw = McpClientInput(
        result_items=[
            {
                "symbol": "AAPL",
                "direction": "buy",
                "conviction": 0.72,
                "headline": "Model flags AAPL",
            }
        ]
    )
    out = await McpClientExtractor().extract(raw)
    assert len(out) == 1
    assert out[0]["symbol"] == "AAPL"
    assert out[0]["direction"] == "buy"
    assert out[0]["conviction"] == 0.72
    assert out[0]["headline"] == "Model flags AAPL"


async def test_malformed_items_are_skipped():
    raw = McpClientInput(
        result_items=[
            {"direction": "buy", "conviction": 0.5},  # missing symbol
            {"symbol": "MSFT", "direction": "up", "conviction": 0.5},  # bad direction
            {"symbol": "TSLA", "direction": "sell", "conviction": 1.5},  # out of range
            {"symbol": "NVDA", "direction": "buy", "conviction": math.nan},  # NaN
            {"symbol": "AAPL", "direction": "buy", "conviction": 0.72},  # the one valid item
        ]
    )
    out = await McpClientExtractor().extract(raw)
    assert [d["symbol"] for d in out] == ["AAPL"]


async def test_empty_result_list_returns_empty():
    out = await McpClientExtractor().extract(McpClientInput(result_items=[]))
    assert out == []
