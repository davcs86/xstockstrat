"""Client-level deadlines on agent -> backend unary calls (feature 273, @AC-5, @AC-10)."""

import ast
import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest

from app import client
from tests.conftest import HANG_GUARD_S

_RPC = "_RPC_TIMEOUT_S"
_LONG = "_LONG_RPC_TIMEOUT_S"
_PATCHED_BUDGET_S = {_RPC: 0.2, _LONG: 0.4}

# acceptance.feature @AC-5: (rpc, endpoint attr, client call, budget constant)
_AC5_ROWS = [
    (
        "IngestSignal",
        "INGEST_ENDPOINT",
        lambda: client.ingest_signal("src", "AAPL", "long", "2026-10-29T00:00:00Z"),
        _RPC,
    ),
    ("EmitAlert", "NOTIFY_ENDPOINT", lambda: client.emit_alert("info", "c", "t", "b"), _RPC),
    ("ListPositions", "PORTFOLIO_ENDPOINT", lambda: client.list_positions("u-1"), _RPC),
    ("GetConfig", "CONFIG_ENDPOINT", lambda: client.get_config("analysis", "staging"), _RPC),
    (
        "RegisterOAuthClient",
        "IDENTITY_ENDPOINT",
        lambda: client.register_oauth_client(["https://x.example/cb"], "c"),
        _RPC,
    ),
    (
        "RunBacktest",
        "ANALYSIS_ENDPOINT",
        lambda: client.run_backtest("u-1", "s-1", ["AAPL"]),
        _LONG,
    ),
    ("ScreenSymbols", "ANALYSIS_ENDPOINT", lambda: client.screen_symbols(["AAPL"]), _LONG),
    ("RunFundamentalsScan", "ANALYSIS_ENDPOINT", lambda: client.run_fundamentals_scan(), _LONG),
    ("TriggerBackfill", "INGEST_ENDPOINT", lambda: client.trigger_backfill(["AAPL"]), _LONG),
    ("ScoreStrategy", "ANALYSIS_ENDPOINT", lambda: client.score_strategy("u-1", "s-1"), _LONG),
]
_AC5_IDS = [row[0] for row in _AC5_ROWS]

_LONG_RPCS = {
    "RunBacktest",
    "ScreenSymbols",
    "RunFundamentalsScan",
    "TriggerBackfill",
    "ScoreStrategy",
}
# (enclosing function, rpc) -> the only other `timeout` name allowed there.
_TIMEOUT_ALLOW_LIST = {
    ("list_opportunities", "ListOpportunities"): "timeout",  # feature 227 policy deadline
    ("get_config_value", "GetConfig"): "_CONFIG_READ_TIMEOUT_S",  # feature 247
}
_MIN_STUB_CALLS = 74


@pytest.mark.parametrize(("rpc", "endpoint_attr", "call", "budget_attr"), _AC5_ROWS, ids=_AC5_IDS)
async def test_ac5_every_listed_rpc_is_bounded(
    monkeypatch, hung_backend, hung_config_server, rpc, endpoint_attr, call, budget_attr
):
    """@AC-5: a backend that accepts the RPC but never answers fails it with DEADLINE_EXCEEDED."""
    monkeypatch.setattr(client, _RPC, _PATCHED_BUDGET_S[_RPC], raising=False)
    monkeypatch.setattr(client, _LONG, _PATCHED_BUDGET_S[_LONG], raising=False)
    handle = hung_config_server() if rpc == "GetConfig" else hung_backend(endpoint_attr)

    started = time.monotonic()
    with pytest.raises(grpc.aio.AioRpcError) as exc_info:
        await asyncio.wait_for(call(), HANG_GUARD_S)
    elapsed = time.monotonic() - started

    assert exc_info.value.code() == grpc.StatusCode.DEADLINE_EXCEEDED
    assert elapsed < _PATCHED_BUDGET_S[budget_attr] + 0.5
    assert handle.entered == 1


class _Recorded(Exception):
    """Raised by the mocked RPC once its call is recorded, so no response shape is needed."""


@pytest.mark.parametrize(("rpc", "endpoint_attr", "call", "budget_attr"), _AC5_ROWS, ids=_AC5_IDS)
async def test_ac5_listed_rpcs_pass_the_production_budget_kwarg(
    rpc, endpoint_attr, call, budget_attr
):
    """@AC-5: each listed RPC is issued with its production budget constant as `timeout`."""
    rpcs: dict[str, AsyncMock] = {}

    def _unary_unary(path, *_args, **_kwargs):
        return rpcs.setdefault(path.rsplit("/", 1)[-1], AsyncMock(side_effect=_Recorded))

    channel = MagicMock()
    channel.unary_unary.side_effect = _unary_unary
    with patch("app.client.mtls.secure_channel") as mock_channel:
        mock_channel.return_value.__aenter__ = AsyncMock(return_value=channel)
        mock_channel.return_value.__aexit__ = AsyncMock(return_value=False)
        with pytest.raises(_Recorded):
            await call()

    assert mock_channel.call_args.args[0] == getattr(client, endpoint_attr)
    kwargs = rpcs[rpc].call_args.kwargs
    assert "timeout" in kwargs, f"{rpc} is issued without a deadline"
    assert kwargs["timeout"] == getattr(client, budget_attr)


def test_deadline_constants_are_pinned():
    assert client._RPC_TIMEOUT_S == 10.0
    assert client._LONG_RPC_TIMEOUT_S == 45.0


def _stub_calls():
    """Yield (enclosing function, rpc, call) for every unary stub call in client.py.

    Matches awaited calls and `call = stub.<Rpc>(...)` call objects (awaited later for trailers).
    """
    tree = ast.parse(Path(client.__file__).read_text())
    for fn in tree.body:
        if not isinstance(fn, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        for node in ast.walk(fn):
            if (
                isinstance(node, ast.Assign)
                and isinstance(node.value, ast.Call)
                and isinstance(node.value.func, ast.Attribute)
                and isinstance(node.value.func.value, ast.Name)
                and node.value.func.value.id == "stub"
            ):
                yield fn.name, node.value.func.attr, node.value
                continue
            if not (
                isinstance(node, ast.Await)
                and isinstance(node.value, ast.Call)
                and isinstance(node.value.func, ast.Attribute)
            ):
                continue
            base = node.value.func.value
            if (isinstance(base, ast.Name) and base.id == "stub") or isinstance(base, ast.Call):
                yield fn.name, node.value.func.attr, node.value


def test_ac10_every_unary_stub_call_carries_a_deadline():
    """@AC-10: every agent -> backend unary call carries one of the deadline constants."""
    calls = list(_stub_calls())
    assert len(calls) >= _MIN_STUB_CALLS, f"matcher found only {len(calls)} stub calls"

    missing, wrong, long_rpcs = [], [], set()
    for fn_name, rpc, call in calls:
        timeout = next((kw.value for kw in call.keywords if kw.arg == "timeout"), None)
        if timeout is None:
            missing.append(f"{fn_name}.{rpc}@{call.lineno}")
            continue
        name = timeout.id if isinstance(timeout, ast.Name) else ast.unparse(timeout)
        if name == _LONG:
            long_rpcs.add(rpc)
        if name not in (_RPC, _LONG) and _TIMEOUT_ALLOW_LIST.get((fn_name, rpc)) != name:
            wrong.append(f"{fn_name}.{rpc}@{call.lineno}: timeout={name}")

    assert not missing, f"stub calls without timeout: {missing}"
    assert not wrong, f"stub calls with an unexpected timeout: {wrong}"
    assert long_rpcs == _LONG_RPCS
