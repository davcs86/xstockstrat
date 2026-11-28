"""Effective access scope under SSO (feature 345): token scopes narrow the role scope."""

from types import SimpleNamespace

import pytest

from app import client, scopes
from app.scopes import MCP_CLAIMS_SCOPE_KEY
from app.tools import CallerPropagationMiddleware, _caller_access_scope
from tests.conftest import TRADER, VIEWER, _ctx


def _stamped(roles, payload):
    """The claims sso_auth stamps: role scope AND the token's granted-scope mask."""
    mask = scopes.scopes_to_mask(scopes.granted_scopes(payload))
    return {
        "user_id": "u-9",
        "roles": roles,
        "access_scope": scopes.roles_to_access_scope(roles) & mask,
    }


def test_ac12_trader_with_read_only_is_read():
    """@AC-12"""
    assert _stamped(TRADER["roles"], {"scp": ["xstockstrat.read"]})["access_scope"] == 1


def test_ac13_viewer_with_every_scope_stays_read():
    """@AC-13"""
    assert (
        _stamped(VIEWER["roles"], {"scp": list(scopes.MCP_SCOPES_SUPPORTED)})["access_scope"] == 1
    )


def test_ac22_trader_with_read_write_is_three():
    """@AC-22 (scope arithmetic)"""
    assert (
        _stamped(TRADER["roles"], {"scp": ["xstockstrat.read", "xstockstrat.write"]})[
            "access_scope"
        ]
        == 3
    )


def test_scope_string_fallback_matches_scp():
    by_list = scopes.granted_scopes({"scp": ["xstockstrat.read", "xstockstrat.write"]})
    by_str = scopes.granted_scopes({"scope": "xstockstrat.read xstockstrat.write"})
    assert scopes.scopes_to_mask(by_list) == scopes.scopes_to_mask(by_str) == 3


def test_neither_claim_is_zero():
    assert scopes.scopes_to_mask(scopes.granted_scopes({})) == 0


def test_non_list_scp_falls_back_to_scope():
    payload = {"scp": "xstockstrat.admin", "scope": "xstockstrat.read"}
    assert scopes.scopes_to_mask(scopes.granted_scopes(payload)) == 1


def test_scope_bits_and_supported_order():
    assert scopes.MCP_SCOPES_SUPPORTED == (
        "xstockstrat.read",
        "xstockstrat.write",
        "xstockstrat.admin",
        "xstockstrat.trade",
    )
    assert scopes.scopes_to_mask(scopes.MCP_SCOPES_SUPPORTED) == 15
    assert scopes.scopes_to_mask(["xstockstrat.trade", "openid"]) == 8


def test_effective_scope_prefers_a_present_key_even_zero():
    assert scopes.effective_access_scope({"roles": ["admin"], "access_scope": 0}) == 0
    assert scopes.effective_access_scope({"roles": ["admin"]}) == 15


async def _middleware_scope(claims) -> str:
    seen: dict = {}

    async def call_next(_ctx):
        seen.update(client._metadata())

    state = {MCP_CLAIMS_SCOPE_KEY: claims}
    ctx = SimpleNamespace(method="tools/call", request=SimpleNamespace(scope={"state": state}))
    await CallerPropagationMiddleware()(ctx, call_next)
    return seen["x-access-scope"]


@pytest.mark.parametrize("value", [3, 0])
async def test_both_sites_honour_a_stamped_access_scope(value):
    claims = {"user_id": "u-9", "roles": ["admin"], "access_scope": value}
    assert _caller_access_scope(_ctx(claims), "set_config") == value
    assert await _middleware_scope(claims) == str(value)


async def test_scp_empty_forwards_scope_zero():
    claims = _stamped(["admin"], {"scp": []})
    assert await _middleware_scope(claims) == "0"


async def test_legacy_claims_keep_role_scope():
    """PRESERVE: an identity-issued token's claims carry no access_scope."""
    assert _caller_access_scope(_ctx(TRADER), "set_config") == 11
    assert await _middleware_scope(TRADER) == "11"
