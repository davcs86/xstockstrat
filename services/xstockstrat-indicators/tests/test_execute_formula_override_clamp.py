"""ExecuteFormula request overrides may only tighten the configured sandbox limits
(docs/reports/2026-10-19-indicators-sandbox-overrides-unclamped-defect.md)."""

from unittest.mock import MagicMock

import pytest
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import IndicatorsServicer
from app.services import sandbox
from app.services.sandbox import SandboxResult
from tests.conftest import OWNER_HEADERS, ctx_with

pytestmark = pytest.mark.asyncio

CFG_TIMEOUT_MS = 5_000
CFG_MEMORY_BYTES = 128 * 1024 * 1024


def _cfg():
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = 4
    cfg.sandbox_timeout_ms = CFG_TIMEOUT_MS
    cfg.sandbox_memory_bytes = CFG_MEMORY_BYTES
    cfg.sandbox_allowed_imports = []
    return cfg


@pytest.mark.parametrize(
    ("timeout_override", "memory_override", "want_timeout", "want_memory"),
    [
        (2_000_000_000, 64 * 1024**3, CFG_TIMEOUT_MS, CFG_MEMORY_BYTES),  # above config → clamped
        (200, 32 * 1024 * 1024, 200, 32 * 1024 * 1024),  # tighter than config → honoured
        (0, 0, CFG_TIMEOUT_MS, CFG_MEMORY_BYTES),  # unset → config
        (-1, -1, CFG_TIMEOUT_MS, CFG_MEMORY_BYTES),  # negative → config, never "no limit"
    ],
)
async def test_overrides_never_exceed_configured_limits(
    monkeypatch, timeout_override, memory_override, want_timeout, want_memory
):
    seen = {}

    def _capture(**kwargs):
        seen.update(kwargs)
        return SandboxResult(
            success=True,
            output={"value": 1.0},
            stdout="",
            stderr="",
            execution_ms=1,
            memory_used_bytes=0,
            error="",
            exit_reason="success",
        )

    monkeypatch.setattr(sandbox, "execute_formula", _capture)
    req = indicators_pb2.ExecuteFormulaRequest(
        formula_source="result = {'value': 1.0}",
        timeout_ms_override=timeout_override,
        memory_bytes_override=memory_override,
    )

    await IndicatorsServicer(config_watcher=_cfg()).ExecuteFormula(req, ctx_with(OWNER_HEADERS))

    assert seen["timeout_ms"] == want_timeout
    assert seen["memory_bytes"] == want_memory
