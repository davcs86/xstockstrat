"""
Streamable HTTP endpoint authentication for xstockstrat-agent.

Validates OAuth 2.1 audience-bound access JWTs against xstockstrat-identity's ValidateToken
gRPC RPC. Returns True only if the token is valid and its `aud` matches this agent's public URL.
Used as guard in the Starlette ASGI app wrapping the MCP transports.
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


async def validate_bearer_claims(token: str) -> dict | None:
    """Validate the token and return the caller's claims, or None.

    Same contract as ``validate_bearer_jwt`` — audience-bound, never raises — but it returns the
    claims instead of discarding them, so a tool can authorize on the *real* caller's roles
    (feature 073 FR-5) rather than the hardcoded admin tuple every other management tool forwards.

    Deliberately duplicates the ValidateToken call rather than having ``validate_bearer_jwt``
    delegate here: that function's tests patch ``app.auth``'s stub directly, and its
    never-raises contract is what keeps an expired token a 401 (with the WWW-Authenticate
    discovery pointer) instead of a 500.

    Returns a dict with user_id / email / roles / aud, or None when the token is missing,
    invalid, or bound to a different audience.
    """
    if not token:
        return None
    try:
        async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
            stub = identity_pb2_grpc.IdentityServiceStub(channel)
            claims = await stub.ValidateToken(
                identity_pb2.ValidateTokenRequest(token=token), metadata=_metadata()
            )
            if claims.aud != AGENT_PUBLIC_URL:
                return None
            return {
                "user_id": claims.user_id,
                "email": claims.email,
                "roles": list(claims.roles),
                "aud": claims.aud,
            }
    except grpc.aio.AioRpcError as e:
        log.info("JWT claims validation failed: %s", e.details())
        return None
    except Exception as e:
        log.error("Unexpected error validating JWT claims: %s", e)
        return None
