"""Tests for the GET /api/tools catalog endpoint (MCP tools UI display feature).

Unlike /sse and the Streamable HTTP root, this endpoint is unauthenticated — it only ever
returns tool name/description/inputSchema, the same data already published in
docs/runbooks/mcp-tools.md, never user data or credentials.
"""

from starlette.testclient import TestClient


def _app():
    from app.main import build_sse_app  # noqa: PLC0415

    return build_sse_app()


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
        "manage_formula",
        "manage_signal_source",
        "set_strategy_live",
        "trigger_backfill",
        "get_backfill_status",
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
    """No Authorization header — unlike /sse, this never 401s."""
    with TestClient(_app()) as tc:
        r = tc.get("/api/tools")
    assert r.status_code == 200
