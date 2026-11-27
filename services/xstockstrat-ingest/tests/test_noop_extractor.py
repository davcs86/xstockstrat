"""Unit tests for NoopExtractor, the module every mediated source stores as its extractor_module."""

import importlib

from app.extractors.base import BaseExtractor, McpClientInput
from app.extractors.noop import NoopExtractor
from app.handlers import servicer as servicer_mod


def test_noop_is_a_base_extractor():
    assert issubclass(NoopExtractor, BaseExtractor)


def test_stored_mediated_label_resolves_to_noop_extractor():
    module = importlib.import_module(servicer_mod._MEDIATED_EXTRACTOR_MODULE)
    assert module.NoopExtractor is NoopExtractor


async def test_noop_extracts_nothing():
    raw = McpClientInput(result_items=[{"symbol": "AAPL", "direction": "buy"}])
    assert await NoopExtractor().extract(raw) == []
