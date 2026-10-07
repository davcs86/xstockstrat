"""Tests for the GET /api/tools catalog endpoint (MCP tools UI display feature).

Unlike the Streamable HTTP MCP root, this endpoint is unauthenticated — it only ever
returns tool name/description/inputSchema, the same data already published in
docs/runbooks/mcp-tools.md, never user data or credentials.
"""

import re
from pathlib import Path

from starlette.testclient import TestClient

_REPO = Path(__file__).resolve().parents[3]
_TOOL_COUNT = 45


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
        "query_bars",
        "query_fundamentals",
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
        "get_positions",
        "get_positions_by_account_id",
        "manage_user",
        "list_users",
        "get_user",
        "admin_get_user_metadata",
        "admin_set_user_metadata",
        "list_fundamental_metrics",
        "list_templates",
        "instantiate_template",
    }
    assert len(body["tools"]) == _TOOL_COUNT


def _catalog() -> dict:
    with TestClient(_app()) as tc:
        return {t["name"]: t for t in tc.get("/api/tools").json()["tools"]}


def test_public_arguments_are_gone_from_formula_tools():
    """feature 224 AC-25: formulas are private to their author — no public toggles remain."""
    by_name = _catalog()
    assert "is_public" not in by_name["manage_formula"]["inputSchema"]["properties"]
    assert "include_public" not in by_name["list_formulas"]["inputSchema"]["properties"]


def test_docs_and_skill_parity_with_template_tools():
    """feature 224 AC-32: the runbook and the strat-lab skill name both template tools and never
    mention the removed public arguments."""
    for rel in ("docs/runbooks/mcp-tools.md", "plugins/strat-lab/skills/backtest/SKILL.md"):
        text = (_REPO / rel).read_text()
        assert "list_templates" in text and "instantiate_template" in text, rel
        assert "is_public" not in text and "include_public" not in text, rel


def test_every_catalog_tool_has_a_runbook_section():
    text = (_REPO / "docs/runbooks/mcp-tools.md").read_text()
    sections = set(re.findall(r"^### `([a-z_]+)`$", text, flags=re.M))
    assert set(_catalog()) <= sections


def test_every_tool_count_surface_states_the_catalog_size():
    """All six inventory surfaces state the same count as the live catalog (C-16 @feature-214)."""
    assert len(_catalog()) == _TOOL_COUNT
    agent = _REPO / "services/xstockstrat-agent"
    word = {
        agent / "app/tools.py": "Forty-five tools",
        agent / "CLAUDE.md": "registers forty-five tools",
        _REPO / "docs/runbooks/mcp-tools.md": "forty-five tools",
    }
    for path, phrase in word.items():
        text = path.read_text()
        assert phrase in text, path
        assert "forty-three" not in text.lower(), path
    copilot = (_REPO / "services/xstockstrat-ui/src/lib/copilot.ts").read_text()
    assert re.search(rf"COPILOT_MCP_TOOL_COUNT = {_TOOL_COUNT};", copilot)
    feature = (agent / "acceptance/remove-agent-postgres-mcp.feature").read_text()
    assert f"the advertised tool count is {_TOOL_COUNT}" in feature


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
