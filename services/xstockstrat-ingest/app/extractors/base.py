"""BaseExtractor — abstract interface all signal source extractors must implement."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class McpClientInput:
    # The already-fetched MCP tool result (CallToolResult.structured_content list);
    # the fetch/credentials live in the loop so the extractor stays pure.
    result_items: list[dict]
    # Log context only; never a metric label.
    slug: str = ""


RawInput = McpClientInput


class BaseExtractor(ABC):
    @abstractmethod
    async def extract(self, raw: RawInput) -> list[dict]:
        """Extract signals from raw input. Returns a list of signal dicts."""
        ...
