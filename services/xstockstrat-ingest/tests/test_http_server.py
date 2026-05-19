from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.http_server import _NoopContext, build_app


def test_build_app_registers_routes():
    app = build_app(AsyncMock())
    paths = [r.path for r in app.routes]
    assert "/healthz" in paths
    assert "/xstockstrat.ingest.v1.IngestService/TriggerBackfill" in paths


@pytest.mark.asyncio
async def test_noop_context_abort_raises():
    with pytest.raises(HTTPException):
        await _NoopContext().abort(None, "test error")


@pytest.mark.asyncio
async def test_noop_context_send_initial_metadata():
    await _NoopContext().send_initial_metadata()
