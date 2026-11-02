"""Tool-level deadlines on agent -> backend calls (feature 273, @AC-1..4, @AC-6..9)."""

import ast
import asyncio
import json
import logging
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import grpc
import pytest
from mcp.server.mcpserver import MCPServer

from app import client, tools
from tests.conftest import ADMIN, HANG_GUARD_S, _ctx

_RPC_S = 0.2
_LONG_S = 0.6
_CONFIG_S = 0.2
_SLACK_S = 0.5

_LONG_TOOLS = {
    "run_backtest",
    "screen_symbols",
    "trigger_backfill",
    "run_fundamentals_scan",
    "_score_strategy",
}
_MUTATING_PREFIXES = (
    "manage_",
    "set_",
    "admin_set_",
    "trigger_",
    "cancel_",
    "instantiate_",
    "emit_",
    "ingest_",
    "run_fundamentals_",
    "_write_",
    "_score_",
)


def _tool(name: str):
    server = MCPServer("test-agent")
    tools.register_tools(server)
    return server._tool_manager.get_tool(name).fn


def _rpc_error(code, details=""):
    from grpc.aio import AioRpcError, Metadata  # noqa: PLC0415

    return AioRpcError(code, Metadata(), Metadata(), details=details)


@pytest.fixture
def patched_budgets(monkeypatch):
    monkeypatch.setattr(client, "_RPC_TIMEOUT_S", _RPC_S)
    monkeypatch.setattr(client, "_LONG_RPC_TIMEOUT_S", _LONG_S)
    monkeypatch.setattr(client, "_CONFIG_READ_TIMEOUT_S", _CONFIG_S)


async def _timed(coro):
    started = time.monotonic()
    result = await asyncio.wait_for(coro, HANG_GUARD_S)
    return result, time.monotonic() - started


async def _timed_error(coro) -> tuple[str, float]:
    started = time.monotonic()
    with pytest.raises(RuntimeError) as exc_info:
        await asyncio.wait_for(coro, HANG_GUARD_S)
    return str(exc_info.value), time.monotonic() - started


async def test_ac1_get_positions_hung_portfolio_surfaces_deadline(patched_budgets, hung_backend):
    handle = hung_backend("PORTFOLIO_ENDPOINT")

    message, elapsed = await _timed_error(_tool("get_positions")(_ctx(ADMIN)))

    assert "within 0.2s (deadline exceeded)" in message
    assert elapsed < _RPC_S + _SLACK_S
    assert handle.entered == 1


async def test_manage_strategy_score_hung_analysis_surfaces_long_deadline(
    patched_budgets, hung_backend
):
    handle = hung_backend("ANALYSIS_ENDPOINT")

    message, elapsed = await _timed_error(
        _tool("manage_strategy")(_ctx(ADMIN), operation="score", strategy_id="s")
    )

    assert "within 0.6s (deadline exceeded)" in message
    assert "outcome unknown, verify before retrying" in message
    assert elapsed < _LONG_S + _SLACK_S
    assert handle.entered == 1


async def test_ac2_get_config_tool_hung_config_surfaces_deadline(
    patched_budgets, hung_config_server
):
    handle = hung_config_server()

    message, elapsed = await _timed_error(_tool("get_config")(namespace="analysis"))

    assert "within 0.2s" in message
    assert elapsed < _RPC_S + _SLACK_S
    assert handle.entered == 1


async def test_ac3_ingest_signal_hung_ingest_surfaces_deadline(patched_budgets, hung_backend):
    handle = hung_backend("INGEST_ENDPOINT")

    with (
        patch.object(client, "emit_alert", AsyncMock()) as emit,
        patch.object(client, "ensure_signal_watchlist", AsyncMock()) as ensure,
    ):
        message, elapsed = await _timed_error(
            _tool("ingest_signal")(
                _ctx(ADMIN),
                source="src",
                symbol="AAPL",
                direction="watchlist",
                valid_from="2026-10-29T00:00:00Z",
                conviction=0.9,
            )
        )

    assert "within 0.2s" in message
    assert "outcome unknown, verify before retrying" in message
    assert elapsed < _RPC_S + _SLACK_S
    assert handle.entered == 1
    emit.assert_not_awaited()
    ensure.assert_not_awaited()


async def test_ac4_slow_backtest_above_default_still_succeeds(patched_budgets, hung_backend):
    from gen.analysis.v1 import analysis_pb2  # noqa: PLC0415

    hung_backend(
        "ANALYSIS_ENDPOINT",
        answers={"RunBacktest": (0.4, analysis_pb2.BacktestResult(backtest_id="bt-273"))},
    )

    result, elapsed = await _timed(
        _tool("run_backtest")(_ctx(ADMIN), strategy_id="sma_crossover", symbols=["AAPL"])
    )

    assert json.loads(result[0].text)["backtest_id"] == "bt-273"
    assert elapsed < _LONG_S + _SLACK_S


async def test_ac9_hung_backtest_bounded_by_long_budget(patched_budgets, hung_backend):
    hung_backend("ANALYSIS_ENDPOINT")

    message, elapsed = await _timed_error(
        _tool("run_backtest")(_ctx(ADMIN), strategy_id="sma_crossover", symbols=["AAPL"])
    )

    assert "within 0.6s" in message
    assert "retry shortly" in message
    assert elapsed < _LONG_S + _SLACK_S


async def test_ac6_run_backtest_tool_hop_bounded(patched_budgets, hung_backend):
    handle = hung_backend("ANALYSIS_ENDPOINT")

    message, elapsed = await _timed_error(
        _tool("run_backtest")(_ctx(ADMIN), strategy_id="sma_crossover", symbols=["AAPL"])
    )

    assert "within 0.6s (deadline exceeded)" in message
    assert elapsed < _LONG_S + _SLACK_S
    assert [method for method, _ in handle.calls] == ["RunBacktest"]


async def test_ac7_responsive_portfolio_result_unchanged(patched_budgets, hung_backend):
    from gen.portfolio.v1 import portfolio_pb2  # noqa: PLC0415

    position = portfolio_pb2.Position(
        symbol="AAPL", qty=100, account_id="acct-1", market_value=15000.0
    )
    hung_backend(
        "PORTFOLIO_ENDPOINT",
        answers={
            "ListPositions": (0.05, portfolio_pb2.ListPositionsResponse(positions=[position]))
        },
    )

    result, elapsed = await _timed(_tool("get_positions")(_ctx(ADMIN)))

    assert result["next_page_token"] == ""
    assert len(result["positions"]) == 1
    projected = result["positions"][0]
    assert projected["symbol"] == "AAPL"
    assert projected["qty"] == 100
    assert projected["account_id"] == "acct-1"
    assert projected["market_value"] == 15000.0
    assert projected["day_pnl"] == 0
    assert elapsed < _RPC_S + _SLACK_S


async def test_ac8_ingest_returns_signal_when_config_and_notify_stall(
    patched_budgets, hung_backend, hung_config_server
):
    from gen.ingest.v1 import ingest_pb2  # noqa: PLC0415

    hung_backend(
        "INGEST_ENDPOINT",
        answers={"IngestSignal": (0, ingest_pb2.IngestSignalResponse(signal_id=42))},
    )
    notify = hung_backend("NOTIFY_ENDPOINT")
    hung_config_server()

    result, elapsed = await _timed(
        _tool("ingest_signal")(
            _ctx(ADMIN),
            source="src",
            symbol="AAPL",
            direction="long",
            valid_from="2026-10-29T00:00:00Z",
            conviction=0.9,
        )
    )

    assert result["signal_id"] == 42
    assert notify.entered == 1
    assert elapsed < _RPC_S + _CONFIG_S + _RPC_S + _SLACK_S


async def test_ingest_watchlist_followup_stall_is_swallowed(
    patched_budgets, hung_backend, hung_config_server, caplog
):
    """127 @AC-4 PRESERVE: a stalled watchlist auto-add never fails the ingest."""
    from gen.ingest.v1 import ingest_pb2  # noqa: PLC0415

    hung_backend(
        "INGEST_ENDPOINT",
        answers={"IngestSignal": (0, ingest_pb2.IngestSignalResponse(signal_id=42))},
    )
    portfolio = hung_backend("PORTFOLIO_ENDPOINT")
    hung_config_server(answer_after_s=0, values={})

    with caplog.at_level(logging.WARNING):
        result, elapsed = await _timed(
            _tool("ingest_signal")(
                _ctx(ADMIN),
                source="src",
                symbol="AAPL",
                direction="watchlist",
                valid_from="2026-10-29T00:00:00Z",
            )
        )

    assert result["signal_id"] == 42
    assert portfolio.entered == 1
    assert any("Watchlist auto-add failed" in r.getMessage() for r in caplog.records)
    assert elapsed < _RPC_S + _CONFIG_S + _RPC_S + _SLACK_S


async def _instantiate_signal_source():
    return await _tool("instantiate_template")(
        _ctx(ADMIN),
        kind="signal_source",
        template_id="tpl-1",
        slug="my_src",
        bearer_token="tok",
    )


async def test_instantiate_template_deadline_after_bearer_is_not_success():
    """224 @AC-18/@AC-19 PRESERVE: a deadline after the bearer write is reported, never success."""
    deadline = _rpc_error(grpc.StatusCode.DEADLINE_EXCEEDED, "Deadline Exceeded")

    with (
        patch.object(client, "set_config", AsyncMock(return_value={})),
        patch.object(client, "instantiate_template", AsyncMock(side_effect=deadline)),
        pytest.raises(RuntimeError) as exc_info,
    ):
        await _instantiate_signal_source()
    assert "outcome unknown" in str(exc_info.value)

    with (
        patch.object(client, "set_config", AsyncMock(side_effect=deadline)),
        patch.object(client, "instantiate_template", AsyncMock(return_value={})) as inst,
        pytest.raises(RuntimeError) as exc_info,
    ):
        await _instantiate_signal_source()
    assert "outcome unknown" in str(exc_info.value)
    inst.assert_not_awaited()


def test_fr3_worst_cases_fit_under_57s():
    auth = client._RPC_TIMEOUT_S
    assert auth + client._LONG_RPC_TIMEOUT_S <= 57
    assert auth + 4 * client._RPC_TIMEOUT_S + client._CONFIG_READ_TIMEOUT_S <= 57
    assert auth + 2 * client._RPC_TIMEOUT_S <= 57


def _mapper_calls():
    """Yield (innermost enclosing function, call) for every _grpc_error_message call in tools.py."""
    tree = ast.parse(Path(tools.__file__).read_text())

    def walk(node, fn_name):
        for child in ast.iter_child_nodes(node):
            name = fn_name
            if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
                if child.name == "_grpc_error_message":
                    continue
                name = child.name
            if (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Name)
                and child.func.id == "_grpc_error_message"
            ):
                yield name, child
            yield from walk(child, name)

    yield from walk(tree, None)


def _kwarg(call: ast.Call, name: str) -> str | None:
    value = next((kw.value for kw in call.keywords if kw.arg == name), None)
    return None if value is None else ast.unparse(value)


def test_every_catch_site_passes_deadline_s():
    calls = list(_mapper_calls())
    assert len(calls) >= 40, f"matcher found only {len(calls)} mapper calls"

    wrong, long_seen = [], set()
    for fn_name, call in calls:
        actual = _kwarg(call, "deadline_s")
        if fn_name == "list_opportunities":
            expected = "timeout_s"
        elif fn_name in _LONG_TOOLS:
            expected = "client._LONG_RPC_TIMEOUT_S"
            long_seen.add(fn_name)
        else:
            expected = "client._RPC_TIMEOUT_S"
        if actual != expected:
            wrong.append(f"{fn_name}@{call.lineno}: deadline_s={actual} (want {expected})")

    assert not wrong, f"catch sites with a missing or wrong deadline_s: {wrong}"
    assert long_seen == _LONG_TOOLS


def test_mutating_tool_catch_sites_pass_write_explicitly():
    missing = [
        f"{fn_name}@{call.lineno}"
        for fn_name, call in _mapper_calls()
        if fn_name and fn_name.startswith(_MUTATING_PREFIXES) and _kwarg(call, "write") is None
    ]
    assert not missing, f"mutating catch sites without write=: {missing}"


async def _call_write_source_bearer():
    return await tools._write_source_bearer(_ctx(ADMIN), "instantiate_template", "my_src", "tok")


_SIX_UNMAPPED = [
    ("list_signal_sources", "list_signal_sources", lambda: _tool("list_signal_sources")()),
    (
        "extract_email_content",
        "list_signal_sources",
        lambda: _tool("extract_email_content")(source_slug="src", urls=["https://x.example"]),
    ),
    (
        "ingest_signal",
        "ingest_signal",
        lambda: _tool("ingest_signal")(
            _ctx(ADMIN),
            source="src",
            symbol="AAPL",
            direction="long",
            valid_from="2026-10-29T00:00:00Z",
        ),
    ),
    (
        "emit_alert",
        "emit_alert",
        lambda: _tool("emit_alert")(
            _ctx(ADMIN), severity="info", category="system", title="t", body="b", broadcast=True
        ),
    ),
    ("screen_symbols", "screen_symbols", lambda: _tool("screen_symbols")(symbols=["AAPL"])),
    ("_write_source_bearer", "set_config", _call_write_source_bearer),
]


@pytest.mark.parametrize(
    ("name", "client_fn", "call"), _SIX_UNMAPPED, ids=[row[0] for row in _SIX_UNMAPPED]
)
async def test_six_unmapped_tools_now_map(name, client_fn, call):
    down = _rpc_error(grpc.StatusCode.UNAVAILABLE, "down")
    with (
        patch.object(client, client_fn, AsyncMock(side_effect=down)),
        pytest.raises(RuntimeError),
    ):
        await asyncio.wait_for(call(), HANG_GUARD_S)
