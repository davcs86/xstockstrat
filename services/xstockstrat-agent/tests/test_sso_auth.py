"""Agent `oidc` token validation and status map (feature 345, design § 2)."""

import base64
import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock

import grpc
import httpx
import jwt
import pytest

from app import client, jwks, scopes, sso_auth
from app.sso_auth import Outcome
from tests.conftest import _rpc_error

VECTORS = json.loads(
    (
        Path(__file__).resolve().parents[3] / "scripts" / "testdata" / "oidc-issuer-vectors.json"
    ).read_text(encoding="utf-8")
)
SENTINEL_EMAIL = "sentinel-345@example.test"
TRADER = {"user_id": "u-trader", "roles": ["trader"], "is_active": True}


class _Clock:
    def __init__(self, t=5000.0):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture
def rejected(monkeypatch):
    seen: list[str] = []
    monkeypatch.setattr(sso_auth, "record_auth_rejected", seen.append)
    return seen


@pytest.fixture
def resolve(monkeypatch):
    mock = AsyncMock(return_value=dict(TRADER))
    monkeypatch.setattr(client, "resolve_external_identity", mock)
    return mock


def _b64(obj) -> str:
    raw = json.dumps(obj).encode() if not isinstance(obj, bytes) else obj
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _raw(header, payload, sig="c2ln") -> str:
    return f"{_b64(header)}.{_b64(payload)}.{sig}"


async def _auth(oidc_mode, token):
    return await sso_auth.authenticate(token, oidc_mode.issuer, "trace-345")


async def test_ok_stamps_only_the_minimal_claims(oidc_mode, resolve, rejected):
    v = await _auth(oidc_mode, oidc_mode.token(email=SENTINEL_EMAIL))
    assert v.outcome is Outcome.OK
    assert v.claims == {
        "user_id": "u-trader",
        "roles": ["trader"],
        "access_scope": 3,
        "trace_id": "trace-345",
    }
    assert resolve.await_args.args == (oidc_mode.issuer, "sso-subject-1")
    assert resolve.await_args.kwargs["trace_id"] == "trace-345"
    assert 0 < resolve.await_args.kwargs["timeout_s"] <= client.rpc_timeout_s()
    assert rejected == []


async def test_ac10_foreign_audience_is_401_wrong_audience(oidc_mode, resolve, rejected):
    """@AC-10"""
    v = await _auth(oidc_mode, oidc_mode.token(aud="https://other.example.test/agent"))
    assert v.outcome is Outcome.UNAUTHORIZED
    assert rejected == ["wrong_audience"]
    resolve.assert_not_awaited()


@pytest.mark.parametrize("aud_kind", ["str", "list"])
async def test_audience_string_or_single_list_passes(oidc_mode, resolve, aud_kind):
    aud = sso_auth.AGENT_PUBLIC_URL if aud_kind == "str" else [sso_auth.AGENT_PUBLIC_URL]
    assert (await _auth(oidc_mode, oidc_mode.token(aud=aud))).outcome is Outcome.OK


async def test_audience_list_with_extra_entry_is_wrong_audience(oidc_mode, resolve, rejected):
    token = oidc_mode.token(aud=[sso_auth.AGENT_PUBLIC_URL, "https://other.example.test"])
    assert (await _auth(oidc_mode, token)).outcome is Outcome.UNAUTHORIZED
    assert rejected == ["wrong_audience"]


async def test_ac23_foreign_issuer_401_without_jwks(oidc_mode, resolve, rejected):
    """@AC-23 row 1"""
    v = await _auth(oidc_mode, oidc_mode.token(iss="https://evil.example.test"))
    assert v.outcome is Outcome.UNAUTHORIZED
    assert oidc_mode.discovery.call_count == 0 and oidc_mode.jwks.call_count == 0
    assert rejected == ["invalid_token"]


async def test_ac23_expired_is_401(oidc_mode, resolve, rejected):
    """@AC-23 row 2 (strict exp: inside the 30 s leeway is still expired)"""
    import time  # noqa: PLC0415

    v = await _auth(oidc_mode, oidc_mode.token(exp=int(time.time()) - 5))
    assert v.outcome is Outcome.UNAUTHORIZED
    assert rejected == ["invalid_token"]


async def test_ac23_foreign_signature_is_401(oidc_mode, resolve, rejected):
    """@AC-23 row 3"""
    token = oidc_mode.keys.mint(signer="rotated", **oidc_mode.claims())
    assert (await _auth(oidc_mode, token)).outcome is Outcome.UNAUTHORIZED
    assert rejected == ["invalid_token"]
    resolve.assert_not_awaited()


async def test_ac23_identity_hs256_token_is_401_without_jwks(oidc_mode, resolve, rejected):
    """@AC-23 row 4"""
    token = jwt.encode(oidc_mode.claims(), "identity-hs256-secret-32-bytes-long", algorithm="HS256")
    assert (await _auth(oidc_mode, token)).outcome is Outcome.UNAUTHORIZED
    assert oidc_mode.discovery.call_count == 0 and oidc_mode.jwks.call_count == 0


@pytest.mark.parametrize(
    "token",
    [
        "",
        "garbage",
        "a.b.c",
        "a.b",
        _raw(b"not-json", {"iss": "x"}),
        _raw({"alg": "RS256", "typ": "at+jwt"}, {"iss": "https://auth.example.test"}),
        _raw({"alg": "RS256", "typ": "at+jwt", "kid": 7}, {"iss": "https://auth.example.test"}),
        _raw({"alg": "RS256", "typ": "at+jwt", "kid": ""}, {"iss": "https://auth.example.test"}),
        _raw({"alg": "RS256", "typ": "at+jwt", "kid": "k"}, ["not", "a", "dict"]),
        _raw({"alg": "EdDSA", "typ": "at+jwt", "kid": "k"}, {"iss": "https://auth.example.test"}),
        _raw(
            {"alg": "none", "typ": "at+jwt", "kid": "k"}, {"iss": "https://auth.example.test"}, ""
        ),
        _raw({"alg": 1, "typ": "at+jwt", "kid": "k"}, {"iss": "https://auth.example.test"}),
    ],
    ids=lambda t: t[:12] or "empty",
)
async def test_d84_garbage_and_refused_headers_are_401(oidc_mode, resolve, rejected, token):
    assert (await _auth(oidc_mode, token)).outcome is Outcome.UNAUTHORIZED
    assert oidc_mode.jwks.call_count == 0
    assert rejected == ["invalid_token"]


@pytest.mark.parametrize(
    "over",
    [{"sub": ""}, {"sub": 42}, {"sub": None}, {"exp": None}, {"aud": None}],
    ids=["empty_sub", "int_sub", "no_sub", "no_exp", "no_aud"],
)
async def test_bad_or_missing_claims_are_401(oidc_mode, resolve, rejected, over):
    assert (await _auth(oidc_mode, oidc_mode.token(**over))).outcome is Outcome.UNAUTHORIZED
    resolve.assert_not_awaited()


async def test_wrong_typ_is_401(oidc_mode, resolve):
    token = oidc_mode.keys.mint(headers={"typ": "JWT"}, **oidc_mode.claims())
    assert (await _auth(oidc_mode, token)).outcome is Outcome.UNAUTHORIZED


async def test_typ_is_case_insensitive(oidc_mode, resolve):
    token = oidc_mode.keys.mint(headers={"typ": "AT+JWT"}, **oidc_mode.claims())
    assert (await _auth(oidc_mode, token)).outcome is Outcome.OK


@pytest.mark.parametrize(("detail", "ac"), [("account inactive", "AC-21"), ("not linked", "AC-30")])
async def test_ac21_ac30_refusals_are_forbidden_with_the_detail(
    oidc_mode, resolve, rejected, detail, ac
):
    """@AC-21 @AC-30"""
    resolve.side_effect = _rpc_error(grpc.StatusCode.FAILED_PRECONDITION, detail)
    v = await _auth(oidc_mode, oidc_mode.token())
    assert (v.outcome, v.body) == (Outcome.FORBIDDEN, detail)
    assert rejected == ["account_refused"]


async def test_unknown_failed_precondition_detail_is_internal(oidc_mode, resolve, rejected, caplog):
    resolve.side_effect = _rpc_error(grpc.StatusCode.FAILED_PRECONDITION, "something new")
    with caplog.at_level(logging.ERROR, logger="app.sso_auth"):
        v = await _auth(oidc_mode, oidc_mode.token())
    assert v.outcome is Outcome.INTERNAL
    assert rejected == ["internal_error"]
    assert [r for r in caplog.records if r.levelno == logging.ERROR]


@pytest.mark.parametrize("code", [grpc.StatusCode.UNAVAILABLE, grpc.StatusCode.DEADLINE_EXCEEDED])
async def test_identity_down_is_unavailable(oidc_mode, resolve, rejected, code):
    resolve.side_effect = _rpc_error(code)
    assert (await _auth(oidc_mode, oidc_mode.token())).outcome is Outcome.UNAVAILABLE
    assert rejected == ["identity_unavailable"]


async def test_unexpected_exception_is_internal_and_names_the_class(
    oidc_mode, resolve, rejected, caplog
):
    resolve.side_effect = RuntimeError("boom")
    with caplog.at_level(logging.ERROR, logger="app.sso_auth"):
        assert (await _auth(oidc_mode, oidc_mode.token())).outcome is Outcome.INTERNAL
    assert rejected == ["internal_error"]
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1 and "RuntimeError" in errors[0]


def test_resolve_refusals_mirror_the_vector_file():
    assert list(sso_auth.RESOLVE_REFUSALS) == VECTORS["refusals"]["resolve"]


async def test_ac14_role_cache_ttl(oidc_mode, resolve, monkeypatch):
    """@AC-14"""
    clock = _Clock()
    monkeypatch.setattr(sso_auth, "_now", clock)
    token = oidc_mode.token(scp=list(scopes.MCP_SCOPES_SUPPORTED))
    assert (await _auth(oidc_mode, token)).claims["access_scope"] == 11
    resolve.return_value = {"user_id": "u-trader", "roles": ["admin"], "is_active": True}
    clock.t += 55
    assert (await _auth(oidc_mode, token)).claims["access_scope"] == 11
    assert resolve.await_count == 1
    clock.t += 6
    v = await _auth(oidc_mode, token)
    assert (v.claims["roles"], v.claims["access_scope"]) == (["admin"], 15)
    assert resolve.await_count == 2


async def test_ac15_expired_entry_and_identity_down_is_unavailable(
    oidc_mode, resolve, rejected, monkeypatch
):
    """@AC-15: never a stale cached answer."""
    clock = _Clock()
    monkeypatch.setattr(sso_auth, "_now", clock)
    token = oidc_mode.token()
    assert (await _auth(oidc_mode, token)).outcome is Outcome.OK
    clock.t += sso_auth._ROLE_TTL_S + 1
    resolve.side_effect = _rpc_error(grpc.StatusCode.UNAVAILABLE)
    v = await _auth(oidc_mode, token)
    assert (v.outcome, v.claims) == (Outcome.UNAVAILABLE, None)
    assert rejected == ["identity_unavailable"]


async def test_refusals_and_inactive_results_are_not_cached(oidc_mode, resolve):
    token = oidc_mode.token()
    resolve.side_effect = _rpc_error(grpc.StatusCode.FAILED_PRECONDITION, "account inactive")
    assert (await _auth(oidc_mode, token)).outcome is Outcome.FORBIDDEN
    resolve.side_effect = None
    resolve.return_value = {"user_id": "u-trader", "roles": ["trader"], "is_active": False}
    v = await _auth(oidc_mode, token)
    assert (v.outcome, v.body) == (Outcome.FORBIDDEN, "account inactive")
    resolve.return_value = dict(TRADER)
    assert (await _auth(oidc_mode, token)).outcome is Outcome.OK
    assert resolve.await_count == 3


async def test_ac61_unknown_kid_with_jwks_down_is_unavailable(oidc_mode, resolve, rejected):
    """@AC-61"""
    oidc_mode.jwks.mock(return_value=httpx.Response(500))
    token = oidc_mode.keys.mint(headers={"kid": "rotated-away"}, **oidc_mode.claims())
    assert (await _auth(oidc_mode, token)).outcome is Outcome.UNAVAILABLE
    assert rejected == ["jwks_unavailable"]
    resolve.assert_not_awaited()


async def test_unknown_kid_after_a_good_fetch_is_401(oidc_mode, resolve, rejected):
    token = oidc_mode.keys.mint(headers={"kid": "rotated-away"}, **oidc_mode.claims())
    assert (await _auth(oidc_mode, token)).outcome is Outcome.UNAUTHORIZED
    assert rejected == ["invalid_token"]


async def test_ac79_known_kid_on_a_set_past_max_age_with_jwks_down(
    oidc_mode, resolve, rejected, monkeypatch
):
    """@AC-79"""
    clock = _Clock()
    monkeypatch.setattr(jwks, "_now", clock)
    token = oidc_mode.token()
    assert (await _auth(oidc_mode, token)).outcome is Outcome.OK
    clock.t += jwks._JWKS_MAX_AGE_S + 1
    oidc_mode.jwks.mock(return_value=httpx.Response(500))
    v = await _auth(oidc_mode, token)
    assert v.outcome is Outcome.UNAVAILABLE
    assert rejected == ["jwks_unavailable"]


async def test_discovery_down_is_jwks_unavailable(oidc_mode, resolve, rejected):
    oidc_mode.discovery.mock(return_value=httpx.Response(503))
    assert (await _auth(oidc_mode, oidc_mode.token())).outcome is Outcome.UNAVAILABLE
    assert rejected == ["jwks_unavailable"]


async def test_logs_never_carry_the_token_or_a_claim(oidc_mode, resolve, caplog):
    token = oidc_mode.token(email=SENTINEL_EMAIL)
    with caplog.at_level(logging.DEBUG):
        await _auth(oidc_mode, token)
        resolve.side_effect = RuntimeError("boom")
        sso_auth._reset_for_tests()
        await _auth(oidc_mode, token)
        await _auth(oidc_mode, token + "x")
    assert token not in caplog.text
    assert SENTINEL_EMAIL not in caplog.text
    assert "sso-subject-1" not in caplog.text
