"""Unit tests for app/extractors/."""

import pytest

from app.extractors.base import (
    AuthenticatedWebsiteInput,
    BaseExtractor,
    EmailAttachmentInput,
    LinkedEmailInput,
    SimpleEmailInput,
    SimpleWebsiteInput,
)
from app.extractors.example_simple_email import ExampleSimpleEmailExtractor
from app.extractors.noop import NoopExtractor

# ---------------------------------------------------------------------------
# ExampleSimpleEmailExtractor
# ---------------------------------------------------------------------------


class TestExampleSimpleEmailExtractor:
    def test_is_subclass_of_base_extractor(self):
        assert issubclass(ExampleSimpleEmailExtractor, BaseExtractor)

    @pytest.mark.asyncio
    async def test_extracts_buy_signal(self):
        extractor = ExampleSimpleEmailExtractor()
        raw = SimpleEmailInput(body_text="BUY AAPL at market open", body_html="")
        result = await extractor.extract(raw)
        assert len(result) == 1
        assert result[0]["direction"] == "buy"
        assert result[0]["symbol"] == "AAPL"
        assert "headline" in result[0]

    @pytest.mark.asyncio
    async def test_extracts_sell_signal(self):
        extractor = ExampleSimpleEmailExtractor()
        raw = SimpleEmailInput(body_text="SELL TSLA now", body_html="")
        result = await extractor.extract(raw)
        assert len(result) == 1
        assert result[0]["direction"] == "sell"
        assert result[0]["symbol"] == "TSLA"

    @pytest.mark.asyncio
    async def test_extracts_multiple_signals(self):
        extractor = ExampleSimpleEmailExtractor()
        raw = SimpleEmailInput(body_text="BUY AAPL and HOLD MSFT", body_html="")
        result = await extractor.extract(raw)
        assert len(result) == 2
        symbols = {r["symbol"] for r in result}
        assert symbols == {"AAPL", "MSFT"}

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_match(self):
        extractor = ExampleSimpleEmailExtractor()
        raw = SimpleEmailInput(body_text="No signals here, just plain text.", body_html="")
        result = await extractor.extract(raw)
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_for_wrong_input_type(self):
        extractor = ExampleSimpleEmailExtractor()
        raw = EmailAttachmentInput(body_text="BUY AAPL", body_html="", attachments=[b"data"])
        result = await extractor.extract(raw)
        assert result == []

    @pytest.mark.asyncio
    async def test_watchlist_direction(self):
        extractor = ExampleSimpleEmailExtractor()
        raw = SimpleEmailInput(body_text="WATCHLIST NVDA for next week", body_html="")
        result = await extractor.extract(raw)
        assert len(result) == 1
        assert result[0]["direction"] == "watchlist"
        assert result[0]["symbol"] == "NVDA"


# ---------------------------------------------------------------------------
# NoopExtractor
# ---------------------------------------------------------------------------


class TestNoopExtractor:
    def test_is_subclass_of_base_extractor(self):
        assert issubclass(NoopExtractor, BaseExtractor)

    @pytest.mark.asyncio
    async def test_returns_empty_for_simple_email(self):
        extractor = NoopExtractor()
        raw = SimpleEmailInput(body_text="BUY AAPL", body_html="")
        assert await extractor.extract(raw) == []

    @pytest.mark.asyncio
    async def test_returns_empty_for_email_attachment(self):
        extractor = NoopExtractor()
        raw = EmailAttachmentInput(body_text="", body_html="", attachments=[b"data"])
        assert await extractor.extract(raw) == []

    @pytest.mark.asyncio
    async def test_returns_empty_for_linked_email(self):
        extractor = NoopExtractor()
        raw = LinkedEmailInput(body_text="", body_html="", urls=["https://example.com"])
        assert await extractor.extract(raw) == []

    @pytest.mark.asyncio
    async def test_returns_empty_for_simple_website(self):
        extractor = NoopExtractor()
        raw = SimpleWebsiteInput(url="https://example.com", html="<p>text</p>")
        assert await extractor.extract(raw) == []

    @pytest.mark.asyncio
    async def test_returns_empty_for_authenticated_website(self):
        extractor = NoopExtractor()
        raw = AuthenticatedWebsiteInput(
            url="https://example.com", html="", credentials={"token": "abc"}
        )
        assert await extractor.extract(raw) == []


# ---------------------------------------------------------------------------
# Dynamic importability
# ---------------------------------------------------------------------------


def test_noop_extractor_dynamically_importable():
    import importlib

    module = importlib.import_module("app.extractors.noop")
    assert hasattr(module, "NoopExtractor")


@pytest.mark.asyncio
async def test_noop_returns_empty_for_all_input_types():
    extractor = NoopExtractor()
    inputs = [
        SimpleEmailInput(body_text="BUY AAPL", body_html=""),
        EmailAttachmentInput(body_text="", body_html="", attachments=[b"data"]),
        LinkedEmailInput(body_text="", body_html="", urls=["https://example.com"]),
        SimpleWebsiteInput(url="https://example.com", html="<p>text</p>"),
        AuthenticatedWebsiteInput(url="https://example.com", html="", credentials={"token": "abc"}),
    ]
    for inp in inputs:
        result = await extractor.extract(inp)
        assert result == [], f"expected [] for {type(inp).__name__}, got {result}"


def test_reference_extractor_dynamically_importable():
    import importlib

    module = importlib.import_module("app.extractors.example_simple_email")
    assert hasattr(module, "ExampleSimpleEmailExtractor")
