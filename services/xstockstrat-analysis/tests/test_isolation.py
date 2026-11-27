"""Unit tests for the shared per-symbol isolation helper (feature 308)."""

import asyncio
import logging

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.services.isolation import isolated, log_isolation_tally

_LOGGER_NAME = "test.isolation"
_SITE = "site_under_test"


async def _returns(value):
    return value


async def _raises(exc: BaseException):
    raise exc


async def test_isolated_returns_value_and_no_error():
    assert await isolated(_returns(7)) == (7, None)


async def test_isolated_captures_exception():
    exc = ZeroDivisionError("boom")
    result, err = await isolated(_raises(exc))
    assert result is None
    assert err is exc


async def test_isolated_lets_cancelled_error_propagate():
    with pytest.raises(asyncio.CancelledError):
        await isolated(_raises(asyncio.CancelledError()))


def _records(caplog):
    return [r for r in caplog.records if r.name == _LOGGER_NAME]


def test_tally_no_record_on_empty_failures(caplog):
    with caplog.at_level(logging.DEBUG, logger=_LOGGER_NAME):
        log_isolation_tally(logging.getLogger(_LOGGER_NAME), _SITE, [], 3)
    assert _records(caplog) == []


def test_tally_warns_on_partial_failure(caplog):
    failures = [("NVDA", ZeroDivisionError("x"))]
    with caplog.at_level(logging.DEBUG, logger=_LOGGER_NAME):
        log_isolation_tally(logging.getLogger(_LOGGER_NAME), _SITE, failures, 3)
    (record,) = _records(caplog)
    assert record.levelno == logging.WARNING
    msg = record.getMessage()
    assert f"{_SITE}: 1/3 scanned symbols failed evaluation" in msg
    assert "NVDA:ZeroDivisionError" in msg


def test_tally_errors_when_every_symbol_failed(caplog):
    failures = [("NVDA", ZeroDivisionError("x")), ("AAPL", RuntimeError("y"))]
    with caplog.at_level(logging.DEBUG, logger=_LOGGER_NAME):
        log_isolation_tally(logging.getLogger(_LOGGER_NAME), _SITE, failures, 2)
    (record,) = _records(caplog)
    assert record.levelno == logging.ERROR
    msg = record.getMessage()
    assert f"{_SITE}: 2/2 scanned symbols failed evaluation" in msg
    assert "NVDA:ZeroDivisionError" in msg


def test_tally_sets_degraded_count_on_current_span():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    failures = [("NVDA", ZeroDivisionError("x"))]

    with provider.get_tracer("t").start_as_current_span("server"):
        log_isolation_tally(logging.getLogger(_LOGGER_NAME), _SITE, failures, 3)

    (span,) = [s for s in exporter.get_finished_spans() if s.name == "server"]
    assert span.attributes[f"{_SITE}.degraded_count"] == 1
    assert [e.name for e in span.events] == ["exception"]
