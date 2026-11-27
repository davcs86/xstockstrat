"""Agent `oidc` access-token validation and the MCP status map (feature 345, design § 2).

Never log the token or any claim value.
"""

import asyncio
import enum
import logging
import time
from dataclasses import dataclass

import grpc
import httpx
import jwt

from app import client, jwks
from app.jwks import _ASYMMETRIC_ALGS
from app.oauth_metadata import AGENT_PUBLIC_URL
from app.scopes import granted_scopes, roles_to_access_scope, scopes_to_mask
from app.tool_metrics import record_auth_rejected

log = logging.getLogger(__name__)

# Fixed invariant (F-07): a resolved (issuer, subject) → user mapping is reused this long, successes
# only and never past expiry. Not a config key.
_ROLE_TTL_S = 60.0
# Fixed invariant (F-07): leeway for nbf/iat; `exp` is still checked strictly. Not a config key.
_CLOCK_SKEW_S = 30
# Mirror of the vector file's refusals.resolve: the only FAILED_PRECONDITION details passed through.
RESOLVE_REFUSALS = ("not linked", "account inactive")

_ROLE_CACHE: dict[tuple[str, str], tuple[float, str, list[str]]] = {}


class Outcome(enum.Enum):
    OK = "ok"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    UNAVAILABLE = "unavailable"
    INTERNAL = "internal"


@dataclass
class Verdict:
    outcome: Outcome
    claims: dict | None = None
    body: str = ""


def _now() -> float:
    return time.monotonic()


def _reject(reason: str, outcome: Outcome, body: str = "") -> Verdict:
    record_auth_rejected(reason)
    return Verdict(outcome, body=body)


def _precheck(token: str, issuer: str) -> str | None:
    """The header `kid` when the token looks like one of the issuer's access tokens, else None."""
    try:
        header = jwt.get_unverified_header(token)
        payload = jwt.decode(token, options={"verify_signature": False})
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return None
    kid, alg, typ = header.get("kid"), header.get("alg"), header.get("typ")
    if not isinstance(kid, str) or not kid:
        return None
    if not isinstance(alg, str) or alg not in _ASYMMETRIC_ALGS:
        return None
    if not isinstance(typ, str) or typ.lower() != "at+jwt":
        return None
    if not isinstance(payload, dict) or payload.get("iss") != issuer:
        return None
    return kid


def _verify(token: str, key, alg: str, issuer: str) -> dict | str:
    """The verified payload, or the rejection reason."""
    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience=AGENT_PUBLIC_URL,
            issuer=issuer,
            leeway=_CLOCK_SKEW_S,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
        if not int(payload["exp"]) > time.time():
            return "invalid_token"
    except jwt.InvalidAudienceError:
        return "wrong_audience"
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return "invalid_token"
    aud = payload["aud"]
    if not (aud == AGENT_PUBLIC_URL or aud == [AGENT_PUBLIC_URL]):
        return "wrong_audience"
    sub = payload["sub"]
    if not isinstance(sub, str) or not sub:
        return "invalid_token"
    return payload


async def _resolve(issuer: str, sub: str, trace_id: str, deadline: float) -> Verdict | tuple:
    """(user_id, roles) from the cache or ResolveExternalIdentity, or the refusal verdict."""
    hit = _ROLE_CACHE.get((issuer, sub))
    if hit is not None and _now() < hit[0]:
        return hit[1], hit[2]
    loop = asyncio.get_running_loop()
    try:
        resolved = await client.resolve_external_identity(
            issuer, sub, trace_id=trace_id, timeout_s=max(0.0, deadline - loop.time())
        )
    except grpc.aio.AioRpcError as e:
        code = e.code()
        if code == grpc.StatusCode.FAILED_PRECONDITION and e.details() in RESOLVE_REFUSALS:
            return _reject("account_refused", Outcome.FORBIDDEN, e.details())
        if code in (grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED):
            return _reject("identity_unavailable", Outcome.UNAVAILABLE)
        log.error("ResolveExternalIdentity failed unexpectedly: %s", code.name)
        return _reject("internal_error", Outcome.INTERNAL)
    if not resolved["is_active"]:
        return _reject("account_refused", Outcome.FORBIDDEN, "account inactive")
    _ROLE_CACHE[(issuer, sub)] = (_now() + _ROLE_TTL_S, resolved["user_id"], resolved["roles"])
    return resolved["user_id"], resolved["roles"]


async def authenticate(token: str, issuer: str, trace_id: str) -> Verdict:
    kid = _precheck(token, issuer)
    if kid is None:
        return _reject("invalid_token", Outcome.UNAUTHORIZED)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + client.rpc_timeout_s()
    phase = "jwks"
    try:
        async with asyncio.timeout_at(deadline):
            try:
                await jwks.discovery(issuer)
            except (jwks.JwksError, httpx.HTTPError):
                return _reject("jwks_unavailable", Outcome.UNAVAILABLE)
            found = await jwks.key_for(issuer, kid)
            if found == "unknown_kid":
                return _reject("invalid_token", Outcome.UNAUTHORIZED)
            if found == "unavailable":
                return _reject("jwks_unavailable", Outcome.UNAVAILABLE)
            key, alg = found
            payload = _verify(token, key, alg, issuer)
            if isinstance(payload, str):
                return _reject(payload, Outcome.UNAUTHORIZED)
            phase = "resolve"
            resolved = await _resolve(issuer, payload["sub"], trace_id, deadline)
    except TimeoutError:
        reason = "jwks_unavailable" if phase == "jwks" else "identity_unavailable"
        return _reject(reason, Outcome.UNAVAILABLE)
    except Exception as e:
        log.error("Unexpected error authenticating an SSO token: %s", type(e).__name__)
        return _reject("internal_error", Outcome.INTERNAL)
    if isinstance(resolved, Verdict):
        return resolved
    user_id, roles = resolved
    access_scope = roles_to_access_scope(roles) & scopes_to_mask(granted_scopes(payload))
    return Verdict(
        Outcome.OK,
        claims={
            "user_id": user_id,
            "roles": roles,
            "access_scope": access_scope,
            "trace_id": trace_id,
        },
    )


def _reset_for_tests() -> None:
    _ROLE_CACHE.clear()
