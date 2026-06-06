"""
SSE endpoint API key authentication for xstockstrat-agent.

Validates API keys against xstockstrat-identity's ValidateApiKey gRPC RPC.
Returns True if the key is valid; False on invalid/missing key.
Used as guard in the Starlette ASGI app wrapping the SSE transport.
"""

import logging
import os

import grpc
from gen.identity.v1 import identity_pb2, identity_pb2_grpc

log = logging.getLogger(__name__)

IDENTITY_ENDPOINT = os.environ.get("IDENTITY_ENDPOINT", "xstockstrat-identity:50058")
AGENT_PUBLIC_URL = os.environ.get("AGENT_PUBLIC_URL", "http://localhost:9000")
MCP_AGENT_SECRET = os.environ.get("MCP_AGENT_SECRET", "")


def _metadata() -> list[tuple[str, str]]:
    if MCP_AGENT_SECRET:
        return [("x-mcp-secret", MCP_AGENT_SECRET)]
    return []


async def validate_bearer_jwt(token: str) -> bool:
    """Validate an OAuth 2.1 access token as an audience-bound JWT.

    Returns True only if identity ValidateToken succeeds AND the token's `aud` claim equals this
    agent's public URL (RFC 8707 audience binding — closes the "any valid token works" gap, FR-B8).
    Never raises; failures are treated as auth failure.
    """
    if not token:
        return False
    try:
        async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
            stub = identity_pb2_grpc.IdentityServiceStub(channel)
            claims = await stub.ValidateToken(
                identity_pb2.ValidateTokenRequest(token=token), metadata=_metadata()
            )
            return claims.aud == AGENT_PUBLIC_URL
    except grpc.aio.AioRpcError as e:
        log.info("JWT validation failed: %s", e.details())
        return False
    except Exception as e:
        log.error("Unexpected error validating JWT: %s", e)
        return False


async def validate_api_key(authorization_header: str | None) -> bool:
    """
    Validate an API key from the Authorization: Bearer <key> header.

    Returns True when valid, False when missing, malformed, or identity rejects it.
    Never raises — errors are logged and treated as auth failure.
    """
    if not authorization_header:
        return False
    if not authorization_header.startswith("Bearer "):
        return False
    api_key = authorization_header[len("Bearer ") :]
    if not api_key:
        return False
    try:
        async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
            stub = identity_pb2_grpc.IdentityServiceStub(channel)
            await stub.ValidateApiKey(identity_pb2.ValidateApiKeyRequest(api_key=api_key))
            return True
    except grpc.aio.AioRpcError as e:
        log.info("API key validation failed: %s", e.details())
        return False
    except Exception as e:
        log.error("Unexpected error validating API key: %s", e)
        return False
