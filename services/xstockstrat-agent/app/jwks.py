"""Async OIDC discovery and JWKS cache for the agent's `oidc` mode (feature 345).

Per-issuer single-flight state machine (D-31 as amended by D-138); keys from a set older than
`_JWKS_MAX_AGE_S` are never returned.
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urlsplit

import httpx
from jwt import PyJWK

log = logging.getLogger(__name__)

# Fixed invariant (F-07): a key set this fresh is used without a refresh. Not a config key.
_JWKS_FRESH_S = 300
# Fixed invariant (F-07): minimum seconds between two fetch attempts per issuer. Not a config key.
_JWKS_COOLDOWN_S = 30
# Fixed invariant (F-07): one discovery + JWKS fetch is bounded by this. Not a config key.
_JWKS_FETCH_TIMEOUT_S = 5
# Fixed invariant (F-07, D-138): keys from a set fetched longer ago are never used. Not a config
# key; there is no stale-key grace.
_JWKS_MAX_AGE_S = 3600
# Fixed invariant (F-07): cap on a discovery or JWKS response body. Not a config key.
_JWKS_MAX_BYTES = 65536
# Fixed invariant (F-07): a discovery document is reused this long. Not a config key.
_DISCOVERY_FRESH_S = 600
# Fixed invariant (F-07): the only accepted signing algorithms; HS*, EdDSA and `none` stay out.
_ASYMMETRIC_ALGS = frozenset(
    {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"}
)


class JwksError(Exception):
    """A discovery or JWKS response that must not be trusted or used."""


def _now() -> float:
    return time.monotonic()


@dataclass
class _IssuerKeys:
    keys_by_kid: dict = field(default_factory=dict)
    fetched_at: float | None = None
    last_attempt_at: float | None = None
    last_fetch_ok: bool = False
    task: asyncio.Task | None = None


_STATE: dict[str, _IssuerKeys] = {}
_DISCOVERY: dict[str, tuple[float, dict]] = {}


def _origin(url: str) -> tuple[str, str]:
    p = urlsplit(url)
    return p.scheme, p.netloc


async def _get_json(url: str):
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=_JWKS_FETCH_TIMEOUT_S,
        headers={"Accept-Encoding": "identity"},
    ) as http:
        async with http.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise JwksError(f"HTTP {resp.status_code}")
            length = resp.headers.get("Content-Length")
            if length is not None and (not length.isdigit() or int(length) > _JWKS_MAX_BYTES):
                raise JwksError("response too large")
            body = bytearray()
            async for chunk in resp.aiter_bytes():
                body.extend(chunk)
                if len(body) > _JWKS_MAX_BYTES:
                    raise JwksError("response too large")
    try:
        return json.loads(bytes(body))
    except ValueError as e:
        raise JwksError("response is not JSON") from e


async def discovery(issuer: str) -> dict:
    cached = _DISCOVERY.get(issuer)
    if cached is not None and _now() - cached[0] <= _DISCOVERY_FRESH_S:
        return cached[1]
    doc = await _get_json(f"{issuer}/.well-known/openid-configuration")
    if not isinstance(doc, dict) or doc.get("issuer") != issuer:
        raise JwksError("discovery issuer mismatch")
    jwks_uri = doc.get("jwks_uri")
    if not isinstance(jwks_uri, str) or _origin(jwks_uri) != _origin(issuer):
        raise JwksError("jwks_uri is not same-origin")
    _DISCOVERY[issuer] = (_now(), doc)
    return doc


def _ingest(body) -> dict:
    raw = body.get("keys") if isinstance(body, dict) else None
    if not isinstance(raw, list):
        raise JwksError("JWKS has no keys array")
    keys: dict = {}
    for jwk in raw:
        kid = jwk.get("kid") if isinstance(jwk, dict) else None
        alg = jwk.get("alg") if isinstance(jwk, dict) else None
        if not isinstance(kid, str) or not kid or alg not in _ASYMMETRIC_ALGS:
            log.warning("jwks key skipped", extra={"reason": "kid_or_alg"})
            continue
        try:
            keys[kid] = (PyJWK(jwk), alg)
        except Exception:
            log.warning("jwks key skipped", extra={"reason": "unusable"})
    if not keys:
        raise JwksError("JWKS has no usable keys")
    return keys


async def _refresh(issuer: str, st: _IssuerKeys) -> None:
    st.last_attempt_at = _now()
    try:
        async with asyncio.timeout(_JWKS_FETCH_TIMEOUT_S):
            doc = await discovery(issuer)
            keys = _ingest(await _get_json(doc["jwks_uri"]))
    except BaseException:
        st.last_fetch_ok = False
        raise
    st.keys_by_kid = keys
    st.fetched_at = _now()
    st.last_fetch_ok = True


def _task_done(st: _IssuerKeys, t: asyncio.Task) -> None:
    if st.task is t:
        st.task = None
    if not t.cancelled():
        t.exception()


def _start_fetch(issuer: str, st: _IssuerKeys) -> asyncio.Task | None:
    """The running task, or a new one when the cooldown allows; None inside the cooldown."""
    if st.task is not None:
        return st.task
    if st.last_attempt_at is not None and _now() - st.last_attempt_at < _JWKS_COOLDOWN_S:
        return None
    t = asyncio.get_running_loop().create_task(_refresh(issuer, st))
    t.add_done_callback(lambda done: _task_done(st, done))
    st.task = t
    return t


async def _await_fetch(task: asyncio.Task, st: _IssuerKeys, kid: str):
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        if task.cancelled():
            return "unavailable"
        raise
    except Exception:
        return "unavailable"
    hit = st.keys_by_kid.get(kid)
    return hit if hit is not None else "unknown_kid"


async def key_for(
    issuer: str, kid: str
) -> tuple[PyJWK, str] | Literal["unknown_kid", "unavailable"]:
    """The verifying key and its JWK `alg`; the caller's deadline bounds any wait (D-18)."""
    st = _STATE.setdefault(issuer, _IssuerKeys())
    age = None if st.fetched_at is None else _now() - st.fetched_at
    if age is None or age > _JWKS_MAX_AGE_S:
        task = _start_fetch(issuer, st)
        if task is None:
            return "unavailable"
        return await _await_fetch(task, st, kid)
    hit = st.keys_by_kid.get(kid)
    if hit is not None:
        if age > _JWKS_FRESH_S:
            _start_fetch(issuer, st)
        return hit
    task = _start_fetch(issuer, st)
    if task is None:
        return "unknown_kid" if st.last_fetch_ok else "unavailable"
    return await _await_fetch(task, st, kid)


def _reset_for_tests() -> None:
    _STATE.clear()
    _DISCOVERY.clear()
