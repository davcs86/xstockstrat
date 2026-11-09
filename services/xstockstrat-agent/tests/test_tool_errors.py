"""Tool errors reach the MCP caller as `CODE: message` (feature 303, @AC-2/@AC-3/@AC-5).

The mapper table and drift guard run here; the dispatch-level tests are added by later steps.
"""

import ast
import logging
import pathlib
import re
from collections import Counter
from unittest.mock import MagicMock, patch

import grpc
import pytest
from gen.config.v1 import config_pb2_grpc
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from app import client, tools
from tests.conftest import ADMIN, _rpc_error, tools_ast_nodes

_SCORE_MSG = "fundamentals availability unknown — grade unchanged"
_OFFLINE_MSG = "positions not published; re-confirm to retry"
_ROOT = pathlib.Path(__file__).resolve().parents[3]
_WITHHELD = "upstream error, details withheld; report it"
_WRITE_TAIL = "outcome unknown, verify before retrying"


async def dispatch_error(name: str, args: dict, *, claims=ADMIN) -> ToolError:
    """Call a tool through the MCP server dispatch and return the ToolError it raises.

    `server.call_tool` injects a context with no request, so the claims are patched in. The exact
    type is asserted because UnexpectedToolError (the SDK's masked crash) subclasses ToolError.
    """
    server = MCPServer("test-agent")
    tools.register_tools(server)
    with patch.object(tools, "_claims_from_context", return_value=claims):
        with pytest.raises(ToolError) as exc_info:
            await server.call_tool(name, args)
    assert type(exc_info.value) is ToolError
    return exc_info.value


_ROWS = [
    (
        "fp",
        "FAILED_PRECONDITION",
        "ambiguous config key spelling: a and b both exist",
        {},
        "FAILED_PRECONDITION: ambiguous config key spelling: a and b both exist",
    ),
    ("pd_empty", "PERMISSION_DENIED", "", {}, "PERMISSION_DENIED: permission denied"),
    ("ia", "INVALID_ARGUMENT", "bad value", {}, "INVALID_ARGUMENT: bad value"),
    ("ae", "ALREADY_EXISTS", "dup", {}, "ALREADY_EXISTS: dup"),
    ("oor", "OUT_OF_RANGE", "too big", {}, "OUT_OF_RANGE: too big"),
    ("unauth_empty", "UNAUTHENTICATED", "", {}, "UNAUTHENTICATED: unauthenticated"),
    ("re", "RESOURCE_EXHAUSTED", "quota", {}, "RESOURCE_EXHAUSTED: quota"),
    ("ab", "ABORTED", "conflict", {}, "ABORTED: conflict"),
    (
        "nf_empty",
        "NOT_FOUND",
        "",
        {"not_found": "strategy not found"},
        "NOT_FOUND: strategy not found",
    ),
    (
        "nf_same",
        "NOT_FOUND",
        "watchlist not found",
        {"not_found": "watchlist not found"},
        "NOT_FOUND: watchlist not found",
    ),
    (
        "nf_contains",
        "NOT_FOUND",
        "no eligible evidence — run a backtest",
        {"not_found": "no eligible evidence"},
        "NOT_FOUND: no eligible evidence — run a backtest",
    ),
    # AC-2: the tool's literal is kept and the server's hint is appended.
    (
        "not_found_other",
        "NOT_FOUND",
        "config key not registered: analysis.foo",
        {"not_found": "config key not found"},
        "NOT_FOUND: config key not found: config key not registered: analysis.foo",
    ),
    (
        "deadline_server",
        "DEADLINE_EXCEEDED",
        "backtest exceeded max_duration_seconds",
        {"deadline_s": 45.0},
        "DEADLINE_EXCEEDED: backtest exceeded max_duration_seconds",
    ),
    (
        "deadline_sentinel_read",
        "DEADLINE_EXCEEDED",
        "Deadline Exceeded",
        {"deadline_s": 10.0},
        "DEADLINE_EXCEEDED: upstream did not respond within 10s (deadline exceeded); retry shortly",
    ),
    (
        "deadline_sentinel_write",
        "DEADLINE_EXCEEDED",
        "",
        {"write": True},
        f"DEADLINE_EXCEEDED: upstream did not respond (deadline exceeded); {_WRITE_TAIL}",
    ),
    (
        "unavail_pass",
        "UNAVAILABLE",
        _SCORE_MSG,
        {"pass_messages": frozenset({_SCORE_MSG})},
        f"UNAVAILABLE: {_SCORE_MSG}",
    ),
    (
        "unavail_not_listed",
        "UNAVAILABLE",
        "failed to connect to all addresses; last error: ipv4:10.0.0.1:50056",
        {},
        "UNAVAILABLE: upstream unavailable; retry shortly",
    ),
    (
        "unavail_write",
        "UNAVAILABLE",
        "failed to connect to all addresses; last error: ipv4:10.0.0.1:50056",
        {"write": True},
        f"UNAVAILABLE: upstream unavailable; {_WRITE_TAIL}",
    ),
    (
        "cancelled",
        "CANCELLED",
        "Locally cancelled by application!",
        {},
        "CANCELLED: upstream call cancelled; retry shortly",
    ),
    # AC-3: internal detail is replaced by a fixed hint.
    (
        "internal_read",
        "INTERNAL",
        "pq: connection refused 10.0.0.12:25060",
        {},
        f"INTERNAL: {_WITHHELD}",
    ),
    (
        "internal_write",
        "INTERNAL",
        "pq: connection refused 10.0.0.12:25060",
        {"write": True},
        f"INTERNAL: {_WITHHELD}; {_WRITE_TAIL}",
    ),
    ("unimplemented", "UNIMPLEMENTED", "Method not found!", {}, f"UNIMPLEMENTED: {_WITHHELD}"),
]


@pytest.mark.parametrize(
    ("code", "details", "kwargs", "expected"),
    [pytest.param(*row[1:], id=row[0]) for row in _ROWS],
)
def test_mapper_table(code, details, kwargs, expected):
    err = _rpc_error(grpc.StatusCode[code], details)
    assert tools._grpc_error_message(err, **kwargs) == expected


def test_mapper_warns_on_withheld_details(caplog):
    internal = _rpc_error(grpc.StatusCode.INTERNAL, "pq: connection refused 10.0.0.12:25060")
    with caplog.at_level(logging.WARNING, logger="app.tools"):
        tools._grpc_error_message(internal)
        tools._grpc_error_message(_rpc_error(grpc.StatusCode.FAILED_PRECONDITION, "refused"))

    warnings = [r for r in caplog.records if r.name == "app.tools" and r.levelno == logging.WARNING]
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert "code=INTERNAL" in message
    assert "pq: connection refused 10.0.0.12:25060" in message


def test_unavailable_pass_strings_match_backend_sources():
    """A reworded backend string would silently collapse to the generic hint; fail instead."""
    analysis = (_ROOT / "services/xstockstrat-analysis/app/handlers/servicer.py").read_text(
        encoding="utf-8"
    )
    trading = (_ROOT / "services/xstockstrat-trading/internal/service/trading.go").read_text(
        encoding="utf-8"
    )
    assert re.search(rf'StatusCode\.UNAVAILABLE,\s*"{re.escape(_SCORE_MSG)}"', analysis)
    assert re.search(rf'codes\.Unavailable,\s*"{re.escape(_OFFLINE_MSG)}"', trading)
    assert tools._SCORE_UNAVAILABLE_PASS == frozenset({_SCORE_MSG})
    assert tools._OFFLINE_UNAVAILABLE_PASS == frozenset({_OFFLINE_MSG})


_SET_CONFIG_ARGS = {
    "namespace": "analysis",
    "key": "a",
    "value_type": "int",
    "value": "5",
    "reason": "r",
}


@pytest.mark.parametrize("value", ["12abc", "99999999999999999999"])
async def test_set_config_bad_int_is_refused_without_echo(value):
    """@AC-4: the conversion runs before any RPC; the submitted value is never echoed."""
    stub_cls = MagicMock()
    with patch.object(config_pb2_grpc, "ConfigServiceStub", stub_cls):
        raised = await dispatch_error(
            "set_config", {**_SET_CONFIG_ARGS, "key": "analysis.x", "value": value}
        )

    assert str(raised) == "Error executing tool set_config: value is not a valid int"
    assert value not in str(raised)
    stub_cls.assert_not_called()


def test_iso_to_timestamp_refuses_without_echo():
    with pytest.raises(client.ClientArgumentError) as exc_info:
        client._iso_to_timestamp("not-a-date-xyz")

    assert str(exc_info.value) == "value is not a valid ISO-8601 timestamp"
    assert "not-a-date-xyz" not in str(exc_info.value)


def test_client_argument_error_is_both_tool_error_and_value_error():
    assert issubclass(client.ClientArgumentError, ToolError)
    assert issubclass(client.ClientArgumentError, ValueError)


def _refusal(tool: str):
    return _rpc_error(grpc.StatusCode.FAILED_PRECONDITION, f"probe refusal {tool}")


@pytest.fixture
def refusing_client(monkeypatch):
    """Every public coroutine in `app.client` refuses with FAILED_PRECONDITION naming the tool."""
    import inspect  # noqa: PLC0415
    from unittest.mock import AsyncMock  # noqa: PLC0415

    current = {"tool": ""}

    async def _raise(*_a, **_k):
        raise _refusal(current["tool"])

    for name, fn in vars(client).items():
        if not name.startswith("_") and inspect.iscoroutinefunction(fn):
            monkeypatch.setattr(client, name, AsyncMock(side_effect=_raise))
    return current


async def test_set_config_backend_refusal_reaches_the_caller(monkeypatch):
    """@AC-1: code + message survive the MCP dispatch (was 'Error executing tool set_config')."""
    from unittest.mock import AsyncMock  # noqa: PLC0415

    err = _rpc_error(
        grpc.StatusCode.FAILED_PRECONDITION,
        "ambiguous config key spelling: a and b both exist",
    )
    monkeypatch.setattr(client, "set_config", AsyncMock(side_effect=err))

    raised = await dispatch_error("set_config", _SET_CONFIG_ARGS)

    assert str(raised) == (
        "Error executing tool set_config: "
        "FAILED_PRECONDITION: ambiguous config key spelling: a and b both exist"
    )


async def test_set_config_not_found_keeps_literal_and_server_hint(monkeypatch):
    """@AC-2."""
    from unittest.mock import AsyncMock  # noqa: PLC0415

    hint = (
        "config key not registered: analysis.foo (env=staging, user=global); "
        "pass create_key=true to register it"
    )
    err = _rpc_error(grpc.StatusCode.NOT_FOUND, hint)
    monkeypatch.setattr(client, "set_config", AsyncMock(side_effect=err))

    raised = await dispatch_error("set_config", {**_SET_CONFIG_ARGS, "key": "analysis.foo"})

    assert (
        str(raised) == f"Error executing tool set_config: NOT_FOUND: config key not found: {hint}"
    )


@pytest.mark.parametrize(
    ("client_fn", "code", "details", "tool", "args", "hint"),
    [
        pytest.param(
            "get_config",
            grpc.StatusCode.INTERNAL,
            "pq: connection refused 10.0.0.12:25060",
            "get_config",
            {"namespace": "analysis"},
            _WITHHELD,
            id="config-internal",
        ),
        pytest.param(
            "score_strategy",
            grpc.StatusCode.UNAVAILABLE,
            "evidence store unavailable",
            "manage_strategy",
            {"operation": "score", "strategy_id": "s"},
            f"upstream unavailable; {_WRITE_TAIL}",
            id="analysis-unavailable",
        ),
    ],
)
async def test_internal_failures_are_withheld_and_logged(
    monkeypatch, caplog, client_fn, code, details, tool, args, hint
):
    """@AC-3."""
    from unittest.mock import AsyncMock  # noqa: PLC0415

    monkeypatch.setattr(client, client_fn, AsyncMock(side_effect=_rpc_error(code, details)))

    with caplog.at_level(logging.WARNING, logger="app.tools"):
        raised = await dispatch_error(tool, args)

    assert str(raised) == f"Error executing tool {tool}: {code.name}: {hint}"
    assert details not in str(raised)
    messages = [r.getMessage() for r in caplog.records if r.name == "app.tools"]
    assert any(f"code={code.name}" in m and details in m for m in messages)


def test_sdk_masks_exceptions_that_are_not_tool_errors():
    """Characterization (not red-first): the SDK contract the whole feature relies on."""
    import asyncio  # noqa: PLC0415

    from mcp.server.mcpserver.exceptions import ToolError as _TE  # noqa: PLC0415

    server = MCPServer("test-agent")

    @server.tool()
    async def boom() -> str:
        raise RuntimeError("secret detail")

    with pytest.raises(_TE) as exc_info:
        asyncio.run(server.call_tool("boom", {}))
    assert type(exc_info.value) is not _TE
    assert "secret detail" not in str(exc_info.value)


_PROBES: dict[str, dict] = {
    "query_bars": {"symbol": "AAPL"},
    "query_fundamentals": {"symbol": "AAPL"},
    "list_signal_sources": {},
    "extract_email_content": {"source_slug": "s", "urls": ["https://example.com/x"]},
    "extract_website_content": {"source_slug": "s"},
    "ingest_signal": {
        "source": "s",
        "symbol": "AAPL",
        "direction": "buy",
        "valid_from": "2026-01-01T00:00:00Z",
    },
    "emit_alert": {
        "severity": "info",
        "category": "c",
        "title": "t",
        "body": "b",
        "broadcast": True,
    },
    "run_backtest": {"strategy_id": "s", "symbols": ["AAPL"]},
    "screen_symbols": {"symbols": ["AAPL"]},
    "manage_strategy": {"operation": "deactivate", "strategy_id": "s"},
    "manage_formula": {"operation": "delete", "formula_id": "f"},
    "get_formula": {"formula_id": "f"},
    "list_formulas": {},
    "list_fundamental_metrics": {},
    "list_templates": {"kind": "formula"},
    "instantiate_template": {"kind": "formula", "template_id": "t"},
    "manage_signal_source": {"operation": "deactivate", "slug": "s"},
    "set_strategy_live": {"strategy_id": "s", "live_enabled": False},
    "trigger_backfill": {"symbols": ["AAPL"]},
    "run_fundamentals_scan": {},
    "get_backfill_status": {},
    "cancel_backfill": {"job_id": "j"},
    "test_formula": {"source": "x = 1"},
    "list_strategies": {},
    "list_opportunities": {},
    "get_strategy": {"strategy_id": "s"},
    "get_config": {"namespace": "analysis"},
    "list_config_keys": {"namespace": "analysis"},
    "set_config": _SET_CONFIG_ARGS,
    "get_user_metadata": {},
    "set_user_metadata": {"display_name": "d"},
    "manage_user": {"operation": "set_active", "user_id": "u", "active": True},
    "list_users": {},
    "get_user": {"user_id": "u"},
    "admin_get_user_metadata": {"user_id": "u"},
    "admin_set_user_metadata": {"user_id": "u", "display_name": "d"},
    "list_watchlists": {},
    "get_watchlist": {"watchlist_id": "w"},
    "manage_watchlist": {"operation": "delete", "watchlist_id": "w"},
    "manage_watchlist_symbols": {"operation": "remove", "watchlist_id": "w", "symbols": ["AAPL"]},
    "manage_offline_account": {"operation": "create_account", "display_name": "book"},
    "manage_account": {"operation": "deregister", "account_id": "a"},
    "list_accounts": {},
    "get_positions": {},
    "get_positions_by_account_id": {"account_id": "a"},
}


async def test_every_listed_tool_surfaces_a_backend_refusal_as_a_tool_error(refusing_client):
    """@AC-6: probe set == list_tools(), so a newly added tool cannot escape the sweep."""
    server = MCPServer("test-agent")
    tools.register_tools(server)
    listed = {t.name for t in await server.list_tools()}
    assert set(_PROBES) == listed

    failures = []
    for name, args in _PROBES.items():
        refusing_client["tool"] = name
        try:
            raised = await dispatch_error(name, args)
        except AssertionError as exc:
            failures.append(f"{name}: not a plain ToolError ({exc})".splitlines()[0])
            continue
        if f"FAILED_PRECONDITION: probe refusal {name}" not in str(raised):
            failures.append(f"{name}: {raised}")
    assert not failures, "\n".join(failures)


_NON_TOOL_ERROR_RAISES_ALLOWED = Counter(
    {("_extract_from_bytes", "ValueError"): 2, ("_fetch_url", "egress.EgressBlocked"): 2}
)


def test_tools_py_raises_only_tool_error():
    """@AC-6 / FR-1: any other raised class is masked by the SDK; exempt sites are internal."""
    found = Counter()
    for fn_name, node in tools_ast_nodes(ast.Raise):
        if node.exc is None:  # a bare `raise` re-raises
            continue
        callee = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
        name = ast.unparse(callee)
        if name != "ToolError":
            found[(fn_name, name)] += 1
    assert found == _NON_TOOL_ERROR_RAISES_ALLOWED
