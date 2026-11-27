"""Async JWKS + discovery cache (feature 345): D-31 as amended by D-138 (@AC-61, @AC-79)."""

import asyncio
import gc
import logging

import httpx
import pytest
import respx

from app import jwks

ISSUER = "https://auth.example.test"
DISCOVERY = f"{ISSUER}/.well-known/openid-configuration"
JWKS_URI = f"{ISSUER}/jwks.json"


class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    jwks._reset_for_tests()
    c = _Clock()
    monkeypatch.setattr(jwks, "_now", c)
    yield c
    jwks._reset_for_tests()


@pytest.fixture
def idp():
    with respx.mock(assert_all_called=False) as mock:
        disc = mock.get(DISCOVERY).mock(
            return_value=httpx.Response(200, json={"issuer": ISSUER, "jwks_uri": JWKS_URI})
        )
        keys = mock.get(JWKS_URI)
        yield disc, keys


def _ok(body):
    return httpx.Response(200, json=body)


def _n(result):
    """The JWK modulus of a key_for hit, so a test can tell the primary from the rotated key."""
    key, alg = result
    assert alg == "RS256"
    return key.key.public_numbers().n


def _modulus(jwk):
    from jwt import PyJWK  # noqa: PLC0415

    return PyJWK(jwk).key.public_numbers().n


async def _settle(issuer=ISSUER):
    st = jwks._STATE.get(issuer)
    while st is not None and st.task is not None:
        await asyncio.sleep(0)


async def test_fresh_hit_fetches_once(idp, sso_keys, clock):
    _, keys = idp
    keys.mock(return_value=_ok(sso_keys.jwks))
    first = await jwks.key_for(ISSUER, sso_keys.kid)
    clock.t += jwks._JWKS_FRESH_S
    second = await jwks.key_for(ISSUER, sso_keys.kid)
    assert _n(first) == _n(second) == _modulus(sso_keys.jwk)
    assert keys.call_count == 1


async def test_between_fresh_and_max_age_serves_and_refreshes(idp, sso_keys, clock):
    _, keys = idp
    keys.mock(return_value=_ok(sso_keys.jwks))
    await jwks.key_for(ISSUER, sso_keys.kid)
    keys.mock(return_value=_ok({"keys": [sso_keys.rotated_jwk]}))
    clock.t += jwks._JWKS_FRESH_S + 1
    served = await jwks.key_for(ISSUER, sso_keys.kid)
    assert _n(served) == _modulus(sso_keys.jwk)
    await _settle()
    assert keys.call_count == 2
    assert _n(await jwks.key_for(ISSUER, sso_keys.kid)) == _modulus(sso_keys.rotated_jwk)


async def test_ac79_known_kid_past_max_age_is_never_served(idp, sso_keys, clock):
    """@AC-79"""
    _, keys = idp
    keys.mock(return_value=_ok(sso_keys.jwks))
    await jwks.key_for(ISSUER, sso_keys.kid)
    clock.t += jwks._JWKS_MAX_AGE_S + 1
    keys.mock(return_value=httpx.Response(500))
    assert await jwks.key_for(ISSUER, sso_keys.kid) == "unavailable"
    assert keys.call_count == 2
    clock.t += 1
    assert await jwks.key_for(ISSUER, sso_keys.kid) == "unavailable"
    assert keys.call_count == 2
    clock.t += jwks._JWKS_COOLDOWN_S
    keys.mock(return_value=_ok({"keys": [sso_keys.rotated_jwk]}))
    assert _n(await jwks.key_for(ISSUER, sso_keys.kid)) == _modulus(sso_keys.rotated_jwk)
    assert keys.call_count == 3


async def test_never_fetched_inside_cooldown_is_unavailable(idp, sso_keys, clock):
    _, keys = idp
    keys.mock(return_value=httpx.Response(500))
    assert await jwks.key_for(ISSUER, sso_keys.kid) == "unavailable"
    assert await jwks.key_for(ISSUER, sso_keys.kid) == "unavailable"
    assert keys.call_count == 1


async def test_ac61_unknown_kid_jwks_down_is_unavailable(idp, sso_keys, clock):
    """@AC-61"""
    _, keys = idp
    keys.mock(return_value=_ok(sso_keys.jwks))
    await jwks.key_for(ISSUER, sso_keys.kid)
    clock.t += jwks._JWKS_COOLDOWN_S
    keys.mock(return_value=httpx.Response(500))
    assert await jwks.key_for(ISSUER, "other-kid") == "unavailable"


async def test_unknown_kid_after_ok_fetch_is_unknown(idp, sso_keys, clock):
    _, keys = idp
    keys.mock(return_value=_ok(sso_keys.jwks))
    assert await jwks.key_for(ISSUER, "other-kid") == "unknown_kid"
    assert await jwks.key_for(ISSUER, "other-kid") == "unknown_kid"
    assert keys.call_count == 1


async def test_cooldown_keeps_one_fetch_within_30s(idp, sso_keys, clock):
    _, keys = idp
    keys.mock(return_value=httpx.Response(500))
    for _ in range(3):
        assert await jwks.key_for(ISSUER, "other-kid") == "unavailable"
        clock.t += 9
    assert keys.call_count == 1
    clock.t += 3
    assert await jwks.key_for(ISSUER, "other-kid") == "unavailable"
    assert keys.call_count == 2


async def test_concurrent_unknown_kid_callers_share_one_fetch(idp, sso_keys):
    _, keys = idp
    keys.mock(return_value=_ok(sso_keys.jwks))
    results = await asyncio.gather(*(jwks.key_for(ISSUER, sso_keys.kid) for _ in range(5)))
    assert all(_n(r) == _modulus(sso_keys.jwk) for r in results)
    assert keys.call_count == 1


async def test_discovery_trailing_slash_issuer_rejected(idp, sso_keys):
    disc, keys = idp
    disc.mock(return_value=_ok({"issuer": ISSUER + "/", "jwks_uri": JWKS_URI}))
    keys.mock(return_value=_ok(sso_keys.jwks))
    with pytest.raises(jwks.JwksError):
        await jwks.discovery(ISSUER)
    assert await jwks.key_for(ISSUER, sso_keys.kid) == "unavailable"
    assert keys.call_count == 0


async def test_cross_origin_jwks_uri_rejected(idp, sso_keys):
    disc, _ = idp
    disc.mock(return_value=_ok({"issuer": ISSUER, "jwks_uri": "https://evil.example.test/jwks"}))
    with pytest.raises(jwks.JwksError):
        await jwks.discovery(ISSUER)


async def test_discovery_is_cached_and_rechecked_on_refetch(idp, clock):
    disc, _ = idp
    assert (await jwks.discovery(ISSUER))["jwks_uri"] == JWKS_URI
    await jwks.discovery(ISSUER)
    assert disc.call_count == 1
    clock.t += jwks._DISCOVERY_FRESH_S + 1
    disc.mock(return_value=_ok({"issuer": ISSUER, "jwks_uri": "https://evil.example.test/jwks"}))
    with pytest.raises(jwks.JwksError):
        await jwks.discovery(ISSUER)
    assert disc.call_count == 2


async def test_redirect_not_followed():
    with respx.mock(assert_all_called=False) as mock:
        target = mock.get("https://auth.example.test/elsewhere").mock(
            return_value=_ok({"issuer": ISSUER, "jwks_uri": JWKS_URI})
        )
        mock.get(DISCOVERY).mock(
            return_value=httpx.Response(302, headers={"Location": f"{ISSUER}/elsewhere"})
        )
        with pytest.raises(jwks.JwksError):
            await jwks.discovery(ISSUER)
        assert target.call_count == 0


async def test_oversized_content_length_rejected(idp, sso_keys):
    _, keys = idp
    keys.mock(return_value=httpx.Response(200, content=b" " * (jwks._JWKS_MAX_BYTES + 1)))
    assert await jwks.key_for(ISSUER, sso_keys.kid) == "unavailable"


async def test_unusable_keys_skipped_with_warn(idp, sso_keys, caplog):
    _, keys = idp
    bad = [
        {"kty": "OKP", "crv": "Ed25519", "x": "AAAA", "alg": "EdDSA", "kid": "ed"},
        {"kty": "RSA", "alg": "none", "kid": "none"},
        {"kty": "RSA", "kid": "no-alg", "n": sso_keys.jwk["n"], "e": "AQAB"},
        {"kty": "RSA", "alg": "RS256", "kid": "broken"},
    ]
    keys.mock(return_value=_ok({"keys": [*bad, sso_keys.jwk]}))
    with caplog.at_level(logging.WARNING, logger="app.jwks"):
        assert _n(await jwks.key_for(ISSUER, sso_keys.kid)) == _modulus(sso_keys.jwk)
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == len(bad)
    assert await jwks.key_for(ISSUER, "ed") == "unknown_kid"


async def test_only_unusable_keys_is_unavailable(idp, sso_keys):
    _, keys = idp
    keys.mock(return_value=_ok({"keys": [{"kty": "OKP", "alg": "EdDSA", "kid": sso_keys.kid}]}))
    assert await jwks.key_for(ISSUER, sso_keys.kid) == "unavailable"


async def test_failed_task_without_awaiter_is_retrieved(idp, sso_keys, clock):
    _, keys = idp
    keys.mock(return_value=_ok(sso_keys.jwks))
    await jwks.key_for(ISSUER, sso_keys.kid)
    seen = []
    loop = asyncio.get_running_loop()
    loop.set_exception_handler(lambda _loop, ctx: seen.append(ctx.get("message")))
    try:
        keys.mock(return_value=httpx.Response(500))
        clock.t += jwks._JWKS_FRESH_S + 1
        await jwks.key_for(ISSUER, sso_keys.kid)
        await _settle()
        assert keys.call_count == 2
        gc.collect()
        await asyncio.sleep(0)
    finally:
        loop.set_exception_handler(None)
    assert not [m for m in seen if m and "never retrieved" in m]
