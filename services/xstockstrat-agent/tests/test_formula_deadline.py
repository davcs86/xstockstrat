"""test_formula's derived ExecuteFormula deadline (feature 295, @AC-18, @AC-31)."""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest

from tests.test_config_watcher import _tool, install_watcher

_T = "indicators.sandbox.timeout_ms"
_G = "indicators.sandbox.startup_grace_ms"


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _deadline_error():
    from grpc.aio import AioRpcError, Metadata  # noqa: PLC0415

    return AioRpcError(
        grpc.StatusCode.DEADLINE_EXCEEDED, Metadata(), Metadata(), details="Deadline Exceeded"
    )


class _SlowSandboxStub:
    """ExecuteFormula that takes `runtime_s`: it succeeds only under a deadline above that."""

    def __init__(self, runtime_s: float):
        self.runtime_s = runtime_s
        self.timeouts: list[float] = []

    async def ExecuteFormula(self, req, *, metadata=None, timeout=None):
        from gen.indicators.v1 import indicators_pb2  # noqa: PLC0415

        self.timeouts.append(timeout)
        if timeout is None or timeout <= self.runtime_s:
            raise _deadline_error()
        return indicators_pb2.ExecuteFormulaResponse(success=True)


async def _run(stub, **kwargs):
    from gen.indicators.v1 import indicators_pb2_grpc  # noqa: PLC0415

    with (
        patch("app.client.mtls") as mtls,
        patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=stub),
    ):
        mtls.secure_channel.return_value = _channel_cm()
        return await _tool("test_formula")(source="result = {'value': 1}", **kwargs)


async def test_configured_timeout_and_grace_cover_a_12s_formula(monkeypatch):
    """@AC-18: timeout 15000 + grace 5000 → deadline 22 s, so a 12 s formula succeeds."""
    install_watcher(monkeypatch, "indicators", **{_T: 15000, _G: 5000})
    stub = _SlowSandboxStub(runtime_s=12.0)
    result = await _run(stub)
    assert stub.timeouts == [22.0]
    assert result["success"] is True


@pytest.mark.parametrize(
    ("t", "g", "override", "expected", "clamped"),
    [
        (33000, 10000, 0, 45.0, False),
        (60000, 10000, 0, 45.0, True),
        (0, -1, 0, 12.0, False),
        (15000, 5000, 3000, 10.0, False),
        (15000, 5000, 20000, 22.0, False),
        (15000, 5000, -5, 22.0, False),
    ],
)
async def test_derived_deadline(monkeypatch, caplog, t, g, override, expected, clamped):
    """@AC-31: min(45, (t + g + 2000)/1000); stored ≤ 0 → 5000; override only if 0 < it < t."""
    install_watcher(monkeypatch, "indicators", **{_T: t, _G: g})
    stub = _SlowSandboxStub(runtime_s=0.0)
    with caplog.at_level(logging.WARNING, logger="app.client"):
        await _run(stub, timeout_ms=override)
    assert stub.timeouts == [expected]
    warned = [r for r in caplog.records if r.name == "app.client" and r.levelno >= logging.WARNING]
    assert bool(warned) is clamped


async def test_deadline_error_names_the_derived_deadline(monkeypatch):
    """A client-side deadline surfaces through _grpc_error_message with the derived deadline_s."""
    install_watcher(monkeypatch, "indicators", **{_T: 15000, _G: 5000})
    with pytest.raises(RuntimeError) as exc_info:
        await _run(_SlowSandboxStub(runtime_s=60.0))
    assert "within 22s (deadline exceeded)" in str(exc_info.value)
