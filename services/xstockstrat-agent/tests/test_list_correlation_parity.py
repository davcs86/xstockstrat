"""Parity test for the list-response correlation guidance (feature 197).

Pins the three consumer channels (tool docstrings, server `instructions`, the
`list_correlation_guide` prompt) and the maintainer runbook copy against drift — mirroring the
descriptor-parity discipline of `test_backtest_view.py` (Ledger RC-1 / Constitution C-10).

The crucial correctness rule (round-1 design-adversary): assert each tool's CORRECT key set, never
the union of all three keys on all five tools — the five tools do NOT all share all keys, and
demanding they did would force a fabricated join into a docstring (the exact anti-goal). So this
test asserts, per tool, only the joins that really exist plus the non-join statements that guard
against invented joins.

`asyncio_mode = "auto"` (pyproject.toml) runs the async tests without a decorator.
"""

import re
from pathlib import Path

from app.main import LIST_CORRELATION_INSTRUCTIONS, create_server
from app.tools import _LIST_CORRELATION_PROMPT_NAME

_REPO_ROOT = Path(__file__).resolve().parents[3]
_RUNBOOK = _REPO_ROOT / "docs" / "runbooks" / "mcp-tools.md"

# The three join keys and both non-join statements every "full graph" surface must name.
_JOIN_KEYS = ("account_id", "strategy_id", "symbol")
_FIELD_PAIRS = (
    ("list_accounts[].id", "get_positions[].account_id"),
    ("list_strategies[].strategy_id", "list_opportunities[].strategy_id"),
    ("get_positions[].symbol", "list_opportunities[].symbol"),
)


def _norm(text: str) -> str:
    """Collapse whitespace so wrapped docstrings match phrase substrings regardless of breaks."""
    return re.sub(r"\s+", " ", text)


async def _tool_descriptions() -> dict[str, str]:
    server = create_server()
    return {t.name: _norm(t.description or "") for t in await server.list_tools()}


async def _prompt_text() -> str:
    server = create_server()
    res = await server.get_prompt(_LIST_CORRELATION_PROMPT_NAME)
    return _norm(" ".join(m.content.text for m in res.messages))


# ── Channel 3: the list_correlation_guide prompt (the full canonical graph) ───────────────────────


async def test_prompt_is_registered_and_advertised():
    server = create_server()
    by_name = {p.name: p for p in await server.list_prompts()}
    assert _LIST_CORRELATION_PROMPT_NAME in by_name
    assert (by_name[_LIST_CORRELATION_PROMPT_NAME].description or "").strip()


async def test_prompt_body_names_all_joins_pairs_and_non_joins():
    text = await _prompt_text()
    for key in _JOIN_KEYS:
        assert key in text, f"prompt body missing join key {key!r}"
    for left, right in _FIELD_PAIRS:
        assert left in text and right in text, f"prompt body missing field-path pair {left}/{right}"
    # Both non-joins spelled out (the half of the feature that prevents invented joins).
    assert "no strategy_id" in text.lower() or "no `strategy_id`" in text.lower()
    assert "no account_id" in text.lower() or "no `account_id`" in text.lower()


async def test_prompt_body_leaks_no_user_data_or_secrets():
    text = (await _prompt_text()).lower()
    # Static guidance only — no credential/secret vocabulary (FR-5 / AC-7).
    for banned in (
        "api_key",
        "api_secret",
        "password",
        "bearer",
        "credentials_json",
        "value_encrypted",
    ):
        assert banned not in text, f"prompt body unexpectedly contains {banned!r}"


# ── Channel 2: server instructions (emitted in the initialize result, auto-surfaced) ─────────────


def test_server_instructions_name_all_keys_and_non_joins():
    server = create_server()
    instructions = _norm(server.instructions or "")
    assert instructions, "server was constructed without instructions"
    assert instructions == _norm(LIST_CORRELATION_INSTRUCTIONS)
    for key in _JOIN_KEYS:
        assert key in instructions, f"instructions missing join key {key!r}"
    assert "no strategy_id" in instructions.lower()
    assert "no account_id" in instructions.lower()


# ── Channel 1: per-tool docstrings — CORRECT key set per tool, never the union ───────────────────


async def test_list_accounts_docstring_states_only_the_account_join():
    d = await _tool_descriptions()
    desc = d["list_accounts"]
    # Its one join is id -> get_positions.account_id; it names no symbol/strategy_id join.
    assert "account_id" in desc and "get_positions" in desc
    assert "get_positions_by_account_id" in desc


async def test_get_positions_docstrings_state_account_and_symbol_joins_and_the_strategy_non_join():
    d = await _tool_descriptions()
    for tool in ("get_positions", "get_positions_by_account_id"):
        desc = d[tool]
        assert "account_id" in desc, f"{tool} missing account_id join"
        assert "symbol" in desc, f"{tool} missing symbol join"
        # The anti-fabrication guard: positions carry NO strategy_id.
        assert "no `strategy_id`" in desc.lower() or "no strategy_id" in desc.lower(), (
            f"{tool} must state the positions-have-no-strategy_id non-join"
        )


async def test_list_opportunities_docstring_states_symbol_and_strategy_joins_and_account_non_join():
    d = await _tool_descriptions()
    desc = d["list_opportunities"]
    assert "strategy_id" in desc and "list_strategies" in desc
    assert "symbol" in desc and "get_positions" in desc
    assert "no `account_id`" in desc.lower() or "no account_id" in desc.lower()


async def test_list_strategies_docstring_states_the_strategy_join_and_account_non_join():
    d = await _tool_descriptions()
    desc = d["list_strategies"]
    assert "strategy_id" in desc and "list_opportunities" in desc
    assert "no `account_id`" in desc.lower() or "no account_id" in desc.lower()


# ── Channel 4: the maintainer runbook copy (C-10 anti-drift; NOT a consumer channel) ─────────────


def test_runbook_correlation_section_matches_the_join_keys_and_non_joins():
    text = _norm(_RUNBOOK.read_text(encoding="utf-8"))
    assert "Correlating list responses" in text, "runbook missing the correlation section"
    for key in _JOIN_KEYS:
        assert key in text, f"runbook correlation section missing join key {key!r}"
    assert "no strategy_id" in text.lower() or "no `strategy_id`" in text.lower()
    assert "no account_id" in text.lower() or "no `account_id`" in text.lower()
