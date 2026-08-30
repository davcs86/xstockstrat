"""Feature 157 — app/client.py offline-account gRPC wrappers.

Exercises the real dict→proto request builders against a mocked TradingService stub: the confirm
path (@AC-6) forwards x-user-id + the fill fields and returns the server-DERIVED status (not an
echo of the request), and the register/record builders bind BROKER_TYPE_OFFLINE / signed side.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _patch_trading_stub(mock_stub):
    from gen.trading.v1 import trading_pb2_grpc  # type: ignore

    grpc_patch = patch("app.client.grpc")
    stub_patch = patch.object(trading_pb2_grpc, "TradingServiceStub", return_value=mock_stub)
    return grpc_patch, stub_patch


@pytest.mark.asyncio
async def test_confirm_offline_order_forwards_user_and_returns_derived_status():
    """@AC-6: confirm forwards x-user-id + fill fields; the returned status is the server's
    (FILLED here), proving the tool surfaces the derived status rather than echoing the request."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    # The stub returns a genuinely server-derived FILLED order (status 3), not a request echo.
    server_order = trading_pb2.Order(
        order_id="ord-1",
        status=3,  # ORDER_STATUS_FILLED — derived by the service from filled_qty == qty
        filled_qty=10,
        filled_avg_price=190.25,
        broker_type=3,  # BROKER_TYPE_OFFLINE
    )
    mock_stub = MagicMock()
    mock_stub.ConfirmOrder = AsyncMock(return_value=server_order)

    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.confirm_offline_order(
                "user-42", "ord-1", filled_qty=10, filled_avg_price=190.25
            )

    assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.TRADING_ENDPOINT
    sent = mock_stub.ConfirmOrder.call_args.args[0]
    # The request carries the fill fields...
    assert sent.order_id == "ord-1"
    assert sent.filled_qty == 10
    assert sent.filled_avg_price == 190.25
    # The deprecated request-body user_id is no longer sent — ownership is resolved server-side
    # from the x-user-id metadata the edge injects, never from the body.
    assert sent.user_id == ""
    meta = mock_stub.ConfirmOrder.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    # The returned status is the SERVER's derived value (3 = FILLED), surfaced verbatim.
    assert out["order"]["status"] == "ORDER_STATUS_FILLED"
    assert out["order"]["filled_qty"] == 10


@pytest.mark.asyncio
async def test_register_offline_account_binds_offline_broker_type():
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.RegisterBrokerAccount = AsyncMock(
        return_value=trading_pb2.RegisterBrokerAccountResponse(
            account=trading_pb2.BrokerAccount(id="off-1", broker_type=3, is_active=True)
        )
    )
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.register_offline_account("user-42", "Manual Book")

    sent = mock_stub.RegisterBrokerAccount.call_args.args[0]
    assert sent.broker_type == 3  # BROKER_TYPE_OFFLINE
    assert sent.credentials_json == ""  # offline accounts carry no credentials
    meta = mock_stub.RegisterBrokerAccount.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    assert out["account"]["broker_type"] == "BROKER_TYPE_OFFLINE"


@pytest.mark.asyncio
async def test_record_offline_order_signs_side_and_forwards_user():
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.PlaceOrder = AsyncMock(
        return_value=trading_pb2.Order(order_id="ord-9", status=1, broker_type=3)
    )
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.record_offline_order(
                "user-42", "off-1", "AAPL", "sell", "market", 5, "nonce-1"
            )

    sent = mock_stub.PlaceOrder.call_args.args[0]
    assert sent.symbol == "AAPL"
    assert sent.side == 2  # OrderSide SELL
    assert sent.order_type == 1  # MARKET
    assert sent.qty == 5
    assert sent.account_id == "off-1"
    assert sent.client_order_id == "nonce-1"
    assert out["order"]["order_id"] == "ord-9"


@pytest.mark.asyncio
async def test_record_offline_order_rejects_bad_side():
    with pytest.raises(ValueError, match="invalid side"):
        await client.record_offline_order("u", "off-1", "AAPL", "hodl", "market", 5, "n")


def _patch_portfolio_stub(mock_stub):
    from gen.portfolio.v1 import portfolio_pb2_grpc  # type: ignore

    grpc_patch = patch("app.client.grpc")
    stub_patch = patch.object(portfolio_pb2_grpc, "PortfolioServiceStub", return_value=mock_stub)
    return grpc_patch, stub_patch


@pytest.mark.asyncio
async def test_list_account_positions_forwards_user_id_via_header():
    """Regression: list_positions once failed with "user_id required" because the wrapper sent
    no user_id at all. The portfolio ListPositions handler now resolves the caller from the
    x-user-id header, so the wrapper forwards identity as metadata only and leaves the deprecated
    request-body user_id unset."""
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.ListPositions = AsyncMock(
        return_value=portfolio_pb2.ListPositionsResponse(positions=[])
    )
    grpc_patch, stub_patch = _patch_portfolio_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.list_account_positions("user-42", "off-1")

    sent = mock_stub.ListPositions.call_args.args[0]
    # user_id is resolved server-side from the x-user-id header, so the deprecated request-body
    # field is left unset and the identity travels only as metadata.
    assert sent.user_id == ""
    assert sent.account_id == "off-1"
    meta = mock_stub.ListPositions.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    assert out == {"positions": []}


@pytest.mark.asyncio
async def test_list_account_orders_forwards_user_id_in_request_body():
    """The known-good reference path: list_account_orders already carries user_id in the body.
    Pinned alongside positions so the two reconciliation reads stay symmetric."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.ListOrders = AsyncMock(return_value=trading_pb2.ListOrdersResponse(orders=[]))
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.list_account_orders("user-42", "off-1")

    sent = mock_stub.ListOrders.call_args.args[0]
    assert sent.user_id == "user-42"
    assert sent.account_id == "off-1"
    meta = mock_stub.ListOrders.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    assert out == {"orders": []}


# ── Feature 163 — snapshot_offline_positions client + provenance passthrough ──


@pytest.mark.asyncio
async def test_snapshot_offline_positions_forwards_baseline_and_user():
    """Step 13 @AC-13: snapshot_offline_positions parses the positions_json array, builds
    PositionBaseline messages, and forwards them with account_id, client_snapshot_id, as_of,
    and the x-user-id header to the SnapshotOfflinePositions RPC."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_resp = trading_pb2.SnapshotOfflinePositionsResponse(
        account_id="off-1",
        committed_count=2,
        warnings=["advisory: unconfirmed NEW orders"],
    )
    mock_stub = MagicMock()
    mock_stub.SnapshotOfflinePositions = AsyncMock(return_value=mock_resp)

    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.snapshot_offline_positions(
                "user-42",
                "off-1",
                "2026-01-15T16:00:00Z",
                "snap-nonce-1",
                '[{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},'
                '{"symbol":"NVDA","qty":50,"avg_cost_per_share":200.00}]',
            )

    # Verify the gRPC call target.
    assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.TRADING_ENDPOINT

    sent = mock_stub.SnapshotOfflinePositions.call_args.args[0]
    assert sent.account_id == "off-1"
    assert sent.user_id == "user-42"
    assert sent.client_snapshot_id == "snap-nonce-1"
    assert len(sent.positions) == 2
    assert sent.positions[0].symbol == "AAPL"
    assert sent.positions[0].qty == 100.0
    assert sent.positions[0].avg_cost_per_share == 150.0
    assert sent.positions[1].symbol == "NVDA"
    assert sent.positions[1].qty == 50.0
    assert sent.as_of.seconds > 0  # as_of was set from the ISO string

    meta = mock_stub.SnapshotOfflinePositions.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta

    # Return shape matches the proto response.
    assert out["account_id"] == "off-1"
    assert out["committed_count"] == 2
    assert out["warnings"] == ["advisory: unconfirmed NEW orders"]


@pytest.mark.asyncio
async def test_snapshot_offline_positions_no_as_of():
    """When as_of is None the request omits the timestamp (server defaults to now)."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_resp = trading_pb2.SnapshotOfflinePositionsResponse(account_id="off-1", committed_count=1)
    mock_stub = MagicMock()
    mock_stub.SnapshotOfflinePositions = AsyncMock(return_value=mock_resp)

    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.snapshot_offline_positions(
                "user-42",
                "off-1",
                None,  # no as_of
                "snap-2",
                '[{"symbol":"AAPL","qty":10,"avg_cost_per_share":100}]',
            )

    sent = mock_stub.SnapshotOfflinePositions.call_args.args[0]
    assert sent.as_of.seconds == 0  # unset timestamp
    assert out["committed_count"] == 1


@pytest.mark.asyncio
async def test_snapshot_offline_positions_bad_json_raises():
    """Unparseable positions_json raises ValueError before any gRPC call."""
    with pytest.raises(ValueError, match="not valid JSON"):
        await client.snapshot_offline_positions("u", "off-1", None, "n", "not json{")


@pytest.mark.asyncio
async def test_snapshot_offline_positions_non_array_raises():
    """positions_json that parses but is not an array raises ValueError."""
    with pytest.raises(ValueError, match="JSON array"):
        await client.snapshot_offline_positions("u", "off-1", None, "n", '{"a":1}')


@pytest.mark.asyncio
async def test_list_positions_provenance_passthrough():
    """Step 13 @AC-13: list_account_positions passes through source and as_of provenance
    fields when the backend returns a Position carrying them (feature 163)."""
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore
    from google.protobuf.timestamp_pb2 import Timestamp as PbTimestamp  # type: ignore

    as_of_ts = PbTimestamp()
    as_of_ts.FromJsonString("2026-01-15T16:00:00Z")
    pos = portfolio_pb2.Position(
        symbol="AAPL",
        qty=100,
        avg_entry_price=150.0,
        source=2,  # POSITION_SOURCE_BASELINE
        as_of=as_of_ts,
        account_id="off-1",
    )
    mock_stub = MagicMock()
    mock_stub.ListPositions = AsyncMock(
        return_value=portfolio_pb2.ListPositionsResponse(positions=[pos])
    )

    grpc_patch, stub_patch = _patch_portfolio_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.list_account_positions("user-42", "off-1")

    assert len(out["positions"]) == 1
    p = out["positions"][0]
    assert p["source"] == "POSITION_SOURCE_BASELINE"
    assert "as_of" in p  # timestamp is present
    assert p["symbol"] == "AAPL"
