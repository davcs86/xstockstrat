"""Tool errors reach the MCP caller as `CODE: message` (feature 303, @AC-2/@AC-3/@AC-5).

The mapper table and drift guard run here; the dispatch-level tests are added by later steps.
"""

import logging
import pathlib
import re
from unittest.mock import MagicMock, patch

import grpc
import pytest
from gen.config.v1 import config_pb2_grpc
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from app import client, tools
from tests.conftest import ADMIN, _rpc_error

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
