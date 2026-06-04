"""Reference extractor for source_type=simple_email.
extractor_module: app.extractors.example_simple_email
"""

import re

from app.extractors.base import BaseExtractor, RawInput, SimpleEmailInput


class ExampleSimpleEmailExtractor(BaseExtractor):
    async def extract(self, raw: RawInput) -> list[dict]:
        """Extract signal dicts from a plain-text email body.
        Returns [] if no recognizable signal pattern is found.
        Each dict has keys: symbol (str), direction (str), headline (str).
        """
        if not isinstance(raw, SimpleEmailInput):
            return []
        signals = []
        for match in re.finditer(
            r"\b(BUY|SELL|HOLD|WATCHLIST)\s+([A-Z]{1,5})\b",
            raw.body_text.upper(),
        ):
            signals.append(
                {
                    "direction": match.group(1).lower(),
                    "symbol": match.group(2),
                    "headline": f"Extracted from email: {match.group(0)}",
                }
            )
        return signals
