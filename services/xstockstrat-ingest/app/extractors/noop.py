"""Noop extractor — canonical extractor_module for all mediated_* source types.
extractor_module: app.extractors.noop
"""
from app.extractors.base import BaseExtractor, RawInput


class NoopExtractor(BaseExtractor):
    async def extract(self, raw: RawInput) -> list[dict]:
        return []
