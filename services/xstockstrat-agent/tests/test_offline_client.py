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
    # The request carries the fill fields and the ownership user_id...
    assert sent.order_id == "ord-1"
    assert sent.filled_qty == 10
    assert sent.filled_avg_price == 190.25
    assert sent.user_id == "user-42"
    # ...and the caller identity is forwarded as x-user-id metadata (never trusted from the body).
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
