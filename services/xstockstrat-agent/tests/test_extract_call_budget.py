"""Whole-call budget on the extract tools (feature 314, @AC-1)."""

import asyncio
import base64
import logging
import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from mcp.server.mcpserver.exceptions import ToolError

from app import client, tools
from tests.conftest import HANG_GUARD_S
from tests.test_config_watcher import install_watcher
from tests.test_tools import _make_server, _tool_fn, _website_source

_BUDGET_S = 0.3
_MARGIN_S = 1.0
_HOST = "news.example.test"
_URLS = [f"https://{_HOST}/a", f"https://{_HOST}/b", f"https://{_HOST}/c"]


class _Trickle(httpx.AsyncByteStream):
    """Yields a byte well inside the read timeout, forever, so no per-chunk timeout fires."""

    async def __aiter__(self):
        while True:
            await asyncio.sleep(0.02)
            yield b"x"


def _trickle_response(_request):
    return httpx.Response(200, stream=_Trickle())


@pytest.fixture
def scaled_budget(monkeypatch):
    real_policy = tools._agent_policy

    async def policy(key, default, cast):
        if key == "extract.call_budget_seconds":
            return _BUDGET_S
        return await real_policy(key, default, cast)

    monkeypatch.setattr(tools, "_agent_policy", policy)


@pytest.fixture
def email_source():
    sources = _website_source("mail-src", _URLS[0])
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=sources)):
        yield "mail-src"


async def _email(slug, urls, attachments_b64=None):
    fn = _tool_fn(_make_server(), "extract_email_content")
    return await asyncio.wait_for(
        fn(source_slug=slug, urls=urls, attachments_b64=attachments_b64), HANG_GUARD_S
    )


async def test_ac1_extract_email_content_returns_partial_before_mcp_timeout(
    scaled_budget, email_source
):
    """@AC-1: three trickling URLs return a PARTIAL result within the whole-call budget."""
    with respx.mock(assert_all_called=False) as mock:
        for url in _URLS:
            mock.get(url).mock(side_effect=_trickle_response)
        start = time.monotonic()
        result = await _email(email_source, list(_URLS))
        elapsed = time.monotonic() - start
    assert elapsed < _BUDGET_S + _MARGIN_S
    assert result == {
        "raw_text": "",
        "error": "PARTIAL: 3 of 3 URLs not fetched (deadline: 3, transport: 0)",
        "unfetched_urls": _URLS,
    }


async def test_partial_keeps_texts_gathered_so_far(scaled_budget, email_source):
    with respx.mock(assert_all_called=False) as mock:
        mock.get(_URLS[0]).mock(return_value=httpx.Response(200, text="first body"))
        mock.get(_URLS[1]).mock(side_effect=_trickle_response)
        third = mock.get(_URLS[2]).mock(return_value=httpx.Response(200, text="never"))
        result = await _email(email_source, list(_URLS))
    assert result["raw_text"] == "first body"
    assert result["error"] == "PARTIAL: 2 of 3 URLs not fetched (deadline: 2, transport: 0)"
    assert result["unfetched_urls"] == [_URLS[1], _URLS[2]]
    assert not third.called


async def test_partial_includes_attachment_text(scaled_budget, email_source):
    attachment = base64.b64encode(b"attachment body").decode()
    with respx.mock(assert_all_called=False) as mock:
        mock.get(_URLS[0]).mock(return_value=httpx.Response(200, text="first body"))
        mock.get(_URLS[1]).mock(side_effect=_trickle_response)
        result = await _email(email_source, _URLS[:2], attachments_b64=[attachment])
    assert "attachment body" in result["raw_text"]
    assert "first body" in result["raw_text"]
    assert result["error"] == "PARTIAL: 1 of 2 URLs not fetched (deadline: 1, transport: 0)"
    assert result["unfetched_urls"] == [_URLS[1]]


async def test_transport_failure_counts_and_continues(scaled_budget, email_source):
    with respx.mock() as mock:
        mock.get(_URLS[0]).mock(side_effect=httpx.ConnectError("refused"))
        mock.get(_URLS[1]).mock(return_value=httpx.Response(200, text="second body"))
        mock.get(_URLS[2]).mock(return_value=httpx.Response(200, text="third body"))
        result = await _email(email_source, list(_URLS))
    assert result["raw_text"] == "second body\n\nthird body"
    assert result["error"] == "PARTIAL: 1 of 3 URLs not fetched (deadline: 0, transport: 1)"
    assert result["unfetched_urls"] == [_URLS[0]]


async def test_per_url_httpx_timeout_counts_as_deadline(scaled_budget, email_source):
    with respx.mock() as mock:
        mock.get(_URLS[0]).mock(side_effect=httpx.ReadTimeout("slow"))
        mock.get(_URLS[1]).mock(return_value=httpx.Response(200, text="second body"))
        result = await _email(email_source, _URLS[:2])
    assert result["raw_text"] == "second body"
    assert result["error"] == "PARTIAL: 1 of 2 URLs not fetched (deadline: 1, transport: 0)"
    assert result["unfetched_urls"] == [_URLS[0]]


async def test_all_succeed_shape_unchanged(scaled_budget, email_source):
    with respx.mock() as mock:
        mock.get(_URLS[0]).mock(return_value=httpx.Response(200, text="one"))
        mock.get(_URLS[1]).mock(return_value=httpx.Response(200, text="two"))
        result = await _email(email_source, _URLS[:2])
    assert set(result) == {"raw_text"}
    assert result["raw_text"] == "one\n\ntwo"


async def test_egress_refusal_still_aborts_the_call(scaled_budget, email_source):
    """@AC-7 @feature-207 preserved: a refusal after an earlier success aborts the whole call."""
    with respx.mock(assert_all_called=False) as mock:
        mock.get(_URLS[0]).mock(return_value=httpx.Response(200, text="one"))
        with pytest.raises(ToolError, match="^content fetch refused by egress policy$"):
            await _email(email_source, [_URLS[0], f"file://{_HOST}/etc/passwd"])


async def test_http_status_error_still_propagates(scaled_budget, email_source):
    with respx.mock() as mock:
        mock.get(_URLS[0]).mock(return_value=httpx.Response(404))
        with pytest.raises(httpx.HTTPStatusError):
            await _email(email_source, [_URLS[0]])


async def test_partial_logs_one_warning_without_url_or_host(scaled_budget, email_source, caplog):
    import app.main  # noqa: F401, PLC0415 — applies the process logging levels

    caplog.set_level(logging.INFO)
    with respx.mock(assert_all_called=False) as mock:
        mock.get(_URLS[0]).mock(return_value=httpx.Response(200, text="one"))
        mock.get(_URLS[1]).mock(side_effect=httpx.ConnectError("refused"))
        mock.get(_URLS[2]).mock(side_effect=_trickle_response)
        await _email(email_source, list(_URLS))
    warnings = [r for r in caplog.records if r.name == "app.tools" and r.levelno == logging.WARNING]
    assert len(warnings) == 1
    for record in caplog.records:
        message = record.getMessage()
        assert _HOST not in message, f"{record.name}: {message}"
        assert all(url not in message for url in _URLS)


async def test_website_budget_expiry_raises_deadline_exceeded(scaled_budget):
    url = f"https://{_HOST}/feed"
    sources = _website_source("site", url)
    fn = _tool_fn(_make_server(), "extract_website_content")
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=sources)):
        with respx.mock() as mock:
            mock.get(url).mock(side_effect=_trickle_response)
            with pytest.raises(ToolError) as exc_info:
                await asyncio.wait_for(fn(source_slug="site"), HANG_GUARD_S)
    message = str(exc_info.value)
    assert message == f"DEADLINE_EXCEEDED: content fetch did not complete within {_BUDGET_S:g}s"
    assert url not in message and _HOST not in message


async def test_website_transport_failure_raises_fetch_failed(scaled_budget):
    url = f"https://{_HOST}/feed"
    sources = _website_source("site", url)
    fn = _tool_fn(_make_server(), "extract_website_content")
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=sources)):
        with respx.mock() as mock:
            mock.get(url).mock(side_effect=httpx.ConnectError("refused"))
            with pytest.raises(ToolError) as exc_info:
                await asyncio.wait_for(fn(source_slug="site"), HANG_GUARD_S)
    assert str(exc_info.value) == "FETCH_FAILED: ConnectError"


@pytest.mark.parametrize("value", [0.0, -1.0, float("nan"), float("inf")])
async def test_budget_guard_falls_back_to_default(monkeypatch, value):
    monkeypatch.setattr(tools, "_agent_policy", AsyncMock(return_value=value))
    assert await tools._extract_call_budget_s() == 35.0


async def test_budget_guard_keeps_a_valid_value(monkeypatch):
    monkeypatch.setattr(tools, "_agent_policy", AsyncMock(return_value=12.0))
    assert await tools._extract_call_budget_s() == 12.0


async def test_budget_reads_the_seeded_key_from_the_agent_snapshot(monkeypatch):
    assert await tools._extract_call_budget_s() == 35.0
    install_watcher(monkeypatch, "agent", **{"extract.call_budget_seconds": 12.0})
    assert await tools._extract_call_budget_s() == 12.0
