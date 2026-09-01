"""Tests for the GET /api/tools catalog endpoint (MCP tools UI display feature).

Unlike the Streamable HTTP MCP root, this endpoint is unauthenticated — it only ever
returns tool name/description/inputSchema, the same data already published in
docs/runbooks/mcp-tools.md, never user data or credentials.
"""

from starlette.testclient import TestClient


def _app():
    from app.main import build_http_app  # noqa: PLC0415

    return build_http_app()


def test_list_tools_returns_all_registered_tools():
    with TestClient(_app()) as tc:
        r = tc.get("/api/tools")
    assert r.status_code == 200
    body = r.json()
    names = {t["name"] for t in body["tools"]}
    assert names == {
        "list_signal_sources",
        "extract_email_content",
        "extract_website_content",
        "ingest_signal",
        "emit_alert",
        "run_backtest",
        "screen_symbols",
        "manage_strategy",
        "get_strategy",
        "manage_formula",
        "get_formula",
        "list_formulas",
        "manage_signal_source",
        "set_strategy_live",
        "run_fundamentals_scan",
        "trigger_backfill",
        "get_backfill_status",
        "cancel_backfill",
        "test_formula",
        "list_strategies",
        "list_opportunities",
        "get_config",
        "list_config_keys",
        "set_config",
        "get_user_metadata",
        "set_user_metadata",
        "list_watchlists",
        "get_watchlist",
        "manage_watchlist",
        "manage_watchlist_symbols",
        "manage_offline_account",
        "manage_account",
        "list_accounts",
    }


def test_list_tools_entries_have_description_and_input_schema():
    with TestClient(_app()) as tc:
        r = tc.get("/api/tools")
    body = r.json()
    by_name = {t["name"]: t for t in body["tools"]}
    ingest_signal = by_name["ingest_signal"]
    assert "Ingest a trading signal" in ingest_signal["description"]
    assert ingest_signal["inputSchema"]["type"] == "object"
    assert "symbol" in ingest_signal["inputSchema"]["properties"]
    # feature 066: the backfill tool's docstring/schema surfaced in the catalog (C-10 proof).
    trigger = by_name["trigger_backfill"]
    assert "symbols" in trigger["inputSchema"]["properties"]


def test_list_tools_does_not_require_auth():
    """No Authorization header — unlike the MCP root, this never 401s."""
    with TestClient(_app()) as tc:
        r = tc.get("/api/tools")
    assert r.status_code == 200


def test_client_has_get_user_metadata_method():
    """Smoke: client.get_user_metadata is importable and callable (feature 130)."""
    from app.client import get_user_metadata  # noqa: PLC0415

    assert callable(get_user_metadata)


def test_client_has_update_user_metadata_method():
    """Smoke: client.update_user_metadata is importable and callable (feature 130)."""
    from app.client import update_user_metadata  # noqa: PLC0415

    assert callable(update_user_metadata)
