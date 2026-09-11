"""Extractor for source_type=mcp_client (feature 166).

Pure parser over an already-fetched MCP tool result (McpClientInput) — no network, no secrets (the
credential-bearing fetch lives in app/engine/mcp_client_loop.py). Maps the fixed xstockstrat MCP
response contract — a list of {symbol, direction, conviction, headline?, valid_from?, valid_until?,
raw_url?, tags?} — to ExternalSignal-shaped dicts, skipping (not raising on) malformed items (FR-5).
"""

from __future__ import annotations

import logging

from app.extractors.base import BaseExtractor, McpClientInput, RawInput

log = logging.getLogger(__name__)

_VALID_DIRECTIONS = frozenset({"buy", "sell", "hold", "watchlist"})
_OPTIONAL_FIELDS = ("headline", "valid_from", "valid_until", "raw_url", "tags")


class McpClientExtractor(BaseExtractor):
    async def extract(self, raw: RawInput) -> list[dict]:
        if not isinstance(raw, McpClientInput):
            return []
        out: list[dict] = []
        for item in raw.result_items:
            if not isinstance(item, dict):
                log.warning("mcp_client: skipping non-object result item")
                continue
            symbol = item.get("symbol")
            direction = item.get("direction")
            conviction = item.get("conviction")
            if not symbol or direction not in _VALID_DIRECTIONS:
                log.warning("mcp_client: skipping item with bad symbol/direction: %r", item)
                continue
            # Inverted-range form (not (0<=x<=1)) also rejects NaN.
            if not isinstance(conviction, (int, float)) or not (0.0 <= float(conviction) <= 1.0):
                log.warning("mcp_client: skipping item with out-of-range conviction: %r", item)
                continue
            signal = {
                "symbol": symbol,
                "direction": direction,
                "conviction": float(conviction),
            }
            for field in _OPTIONAL_FIELDS:
                if item.get(field) is not None:
                    signal[field] = item[field]
            out.append(signal)
        return out
