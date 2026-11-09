"""Feature 295 @AC-38 — the sandbox startup grace is the `indicators.sandbox.startup_grace_ms` key,
and ExecuteFormula clamps the sandbox timeout to the caller's remaining gRPC deadline."""

import logging
from unittest.mock import MagicMock

import pytest
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import IndicatorsServicer
from app.services import sandbox
from app.services.sandbox import SandboxResult
from tests.conftest import OWNER_HEADERS, ctx_with, snapshot_watcher

pytestmark = pytest.mark.asyncio

TIMEOUT_MS = 15_000
GRACE_MS = 5_000


def _watcher():
    return snapshot_watcher(
        **{
            "sandbox.timeout_ms": TIMEOUT_MS,
            "sandbox.startup_grace_ms": GRACE_MS,
            "sandbox.allowed_imports": "math",
        }
    )


def _recording_sandbox(monkeypatch):
    calls = []

    def _recorder(**kwargs):
        calls.append(kwargs)
        return SandboxResult(
            success=True,
            output={"value": 1.0},
            stdout="",
            stderr="",
            execution_ms=0,
            memory_used_bytes=0,
            error="",
            exit_reason="success",
        )

    monkeypatch.setattr(sandbox, "execute_formula", _recorder)
    return calls


def _ctx(time_remaining):
    ctx = ctx_with(OWNER_HEADERS)
    ctx.time_remaining = MagicMock(return_value=time_remaining)
    return ctx


def _req():
    return indicators_pb2.ExecuteFormulaRequest(formula_source="result = {'value': 1.0}")


async def test_timeout_clamped_to_remaining_deadline_with_warn(monkeypatch, caplog):
    calls = _recording_sandbox(monkeypatch)
    servicer = IndicatorsServicer(config_watcher=_watcher())

    with caplog.at_level(logging.WARNING):
        await servicer.ExecuteFormula(_req(), _ctx(8.0))

    assert len(calls) == 1
    # 8000 remaining − 5000 grace − 500 margin.
    assert calls[0]["timeout_ms"] <= 2500, calls[0]["timeout_ms"]
    assert any(r.levelno == logging.WARNING for r in caplog.records), caplog.records


async def test_too_little_remaining_deadline_fails_without_spawning(monkeypatch):
    calls = _recording_sandbox(monkeypatch)
    servicer = IndicatorsServicer(config_watcher=_watcher())

    # 5550 − 5000 − 500 = 50 ms < 100 ms.
    resp = await servicer.ExecuteFormula(_req(), _ctx(5.55))

    assert resp.success is False
    assert "5550" in resp.error, resp.error
    assert calls == []


async def test_no_deadline_keeps_configured_timeout(monkeypatch):
    calls = _recording_sandbox(monkeypatch)
    servicer = IndicatorsServicer(config_watcher=_watcher())

    await servicer.ExecuteFormula(_req(), _ctx(None))

    assert len(calls) == 1
    assert calls[0]["timeout_ms"] == TIMEOUT_MS


@pytest.mark.parametrize("stored", [0, -1])
async def test_non_positive_stored_grace_falls_back_to_default(stored):
    w = snapshot_watcher(**{"sandbox.startup_grace_ms": stored})
    assert w.sandbox_startup_grace_ms() == 5000
