"""Tests for app/auth.py — OAuth 2.1 aud-bound JWT authentication via identity gRPC."""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from starlette.testclient import TestClient

from app import auth, client
from app.auth import AGENT_PUBLIC_URL, validate_bearer_claims, validate_bearer_jwt
from tests.test_tool_metrics import counter_values

# ── validate_bearer_jwt — aud-bound JWT (feature 049 Part B, FR-B8) ──────────


@pytest.mark.asyncio
async def test_validate_bearer_jwt_empty_token():
    assert await validate_bearer_jwt("") is False


@pytest.mark.asyncio
async def test_validate_bearer_jwt_correct_aud_accepted():
    from gen.identity.v1 import identity_pb2  # noqa: PLC0415

    mock_stub = AsyncMock()
    mock_stub.ValidateToken = AsyncMock(
        return_value=identity_pb2.TokenClaims(user_id="u1", aud=AGENT_PUBLIC_URL)
    )
    with patch("app.auth.mtls.secure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            assert await validate_bearer_jwt("good.jwt.token") is True


@pytest.mark.asyncio
async def test_validate_bearer_jwt_wrong_aud_rejected():
    from gen.identity.v1 import identity_pb2  # noqa: PLC0415

    mock_stub = AsyncMock()
    mock_stub.ValidateToken = AsyncMock(
        return_value=identity_pb2.TokenClaims(user_id="u1", aud="https://other.example/agent")
    )
    with patch("app.auth.mtls.secure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            assert await validate_bearer_jwt("wrong.aud.token") is False


# ── ValidateToken deadline and three-way result (feature 273, @AC-11) ──────


@pytest.mark.asyncio
async def test_validate_bearer_jwt_passes_default_deadline():
    from gen.identity.v1 import identity_pb2  # noqa: PLC0415

    mock_stub = AsyncMock()
    mock_stub.ValidateToken = AsyncMock(
        return_value=identity_pb2.TokenClaims(user_id="u1", aud=AGENT_PUBLIC_URL)
    )
    with patch("app.auth.mtls.secure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            assert await validate_bearer_jwt("good.jwt.token") is True
    assert mock_stub.ValidateToken.call_args.kwargs.get("timeout") == client._RPC_TIMEOUT_S


@pytest.mark.asyncio
async def test_validate_bearer_claims_passes_default_deadline_and_trace():
    from gen.identity.v1 import identity_pb2  # noqa: PLC0415

    mock_stub = AsyncMock()
    mock_stub.ValidateToken = AsyncMock(
        return_value=identity_pb2.TokenClaims(user_id="u1", aud=AGENT_PUBLIC_URL)
    )
    with patch("app.auth.mtls.secure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            claims = await validate_bearer_claims("t", trace_id="trace-273")
    assert claims["user_id"] == "u1"
    kwargs = mock_stub.ValidateToken.call_args.kwargs
    assert kwargs.get("timeout") == client._RPC_TIMEOUT_S
    assert ("x-trace-id", "trace-273") in kwargs["metadata"]


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [grpc.StatusCode.DEADLINE_EXCEEDED, grpc.StatusCode.UNAVAILABLE])
async def test_validate_bearer_claims_unavailable_on_deadline_and_unavailable(code, caplog):
    from grpc.aio import AioRpcError, Metadata  # noqa: PLC0415

    mock_stub = AsyncMock()
    mock_stub.ValidateToken = AsyncMock(side_effect=AioRpcError(code, Metadata(), Metadata()))
    with patch("app.auth.mtls.secure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            with caplog.at_level(logging.WARNING, logger=auth.log.name):
                result = await validate_bearer_claims("t")
    assert result is getattr(auth, "IDENTITY_UNAVAILABLE", "missing sentinel")
    assert any(r.levelno == logging.WARNING for r in caplog.records)


@pytest.mark.asyncio
async def test_validate_bearer_claims_invalid_token_still_none():
    from grpc.aio import AioRpcError, Metadata  # noqa: PLC0415

    mock_stub = AsyncMock()
    mock_stub.ValidateToken = AsyncMock(
        side_effect=AioRpcError(grpc.StatusCode.UNAUTHENTICATED, Metadata(), Metadata())
    )
    with patch("app.auth.mtls.secure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=MagicMock())
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with patch("app.auth.identity_pb2_grpc.IdentityServiceStub", return_value=mock_stub):
            assert await validate_bearer_claims("expired.jwt") is None


# ── feature 294 @AC-19: an mTLS fault in the auth path is counted, status unchanged ──


def test_mtls_fault_in_auth_path_counts_internal_error_and_stays_401(
    monkeypatch, metric_reader, caplog
):
    from app.main import build_http_app  # noqa: PLC0415

    token = "tok-secret-19"
    monkeypatch.delenv("MTLS_CERT")
    with caplog.at_level(logging.DEBUG):
        with TestClient(build_http_app()) as tc:
            r = tc.post(
                "/",
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
                headers={"Authorization": f"Bearer {token}"},
            )
    assert r.status_code == 401
    assert counter_values(metric_reader, "mcp.auth.rejected") == {
        (("reason", "internal_error"),): 1
    }
    errors = [
        rec
        for rec in caplog.records
        if rec.levelno == logging.ERROR
        and rec.getMessage().startswith("Unexpected error validating JWT claims")
    ]
    assert len(errors) == 1
    assert "RuntimeError" in errors[0].getMessage()
    assert not [rec for rec in caplog.records if token in rec.getMessage()]
