"""Tests for app/auth.py — SSE API key authentication via identity gRPC."""
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest

from app.auth import validate_api_key


@pytest.mark.asyncio
async def test_validate_api_key_missing_header():
    assert await validate_api_key(None) is False


@pytest.mark.asyncio
async def test_validate_api_key_wrong_scheme():
    assert await validate_api_key("Basic dXNlcjpwYXNz") is False


@pytest.mark.asyncio
async def test_validate_api_key_empty_token():
    assert await validate_api_key("Bearer ") is False


@pytest.mark.asyncio
async def test_validate_api_key_valid(monkeypatch):
    mock_stub = AsyncMock()
    mock_stub.ValidateApiKey = AsyncMock(return_value=MagicMock())
    with patch("app.auth.grpc.aio.insecure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            result = await validate_api_key("Bearer xss_validkey123")
            assert result is True


@pytest.mark.asyncio
async def test_validate_api_key_rejected(monkeypatch):
    mock_stub = AsyncMock()
    rpc_error = grpc.aio.AioRpcError(
        code=grpc.StatusCode.UNAUTHENTICATED,
        initial_metadata=None,
        trailing_metadata=None,
        details="invalid api key",
        debug_error_string=None,
    )
    mock_stub.ValidateApiKey = AsyncMock(side_effect=rpc_error)
    with patch("app.auth.grpc.aio.insecure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            result = await validate_api_key("Bearer xss_badkey")
            assert result is False
