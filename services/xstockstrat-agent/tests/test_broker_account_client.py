"""Feature 164 — app/client.py broker-account gRPC wrappers.

Exercises the real dict→proto request builders against a mocked TradingService stub: register /
update_credentials / deregister / list forward x-user-id and the request fields, credentials are
never echoed back (BrokerAccount has no credential field), and a fully-populated account projects
every proto field (the F-12 field-parity guard — a future proto field cannot silently vanish, and
the `accountId`-vs-`id` field-name trap cannot reappear).
"""

import json
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


_ALPACA_CREDS = '{"api_key":"AK123","api_secret":"SEC456"}'


def _assert_no_credentials(out: dict) -> None:
    blob = json.dumps(out)
    assert "api_key" not in blob
    assert "api_secret" not in blob
    assert "credentials_json" not in blob


@pytest.mark.asyncio
async def test_register_broker_account_binds_alpaca_and_hides_credentials():
    """@AC-1: register forwards broker_type + verbatim credentials_json + x-user-id; the returned
    account carries no credential field."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.RegisterBrokerAccount = AsyncMock(
        return_value=trading_pb2.RegisterBrokerAccountResponse(
            account=trading_pb2.BrokerAccount(
                id="acct-7", display_name="My Alpaca", broker_type=1, credential_status=1
            )
        )
    )
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.register_broker_account(
                "user-42", "My Alpaca", "alpaca", _ALPACA_CREDS
            )

    assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.TRADING_ENDPOINT
    sent = mock_stub.RegisterBrokerAccount.call_args.args[0]
    assert sent.broker_type == 1  # BROKER_TYPE_ALPACA
    assert sent.credentials_json == _ALPACA_CREDS  # forwarded verbatim
    meta = mock_stub.RegisterBrokerAccount.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    assert out["account"]["id"] == "acct-7"
    assert out["account"]["display_name"] == "My Alpaca"
    assert "credential_status" in out["account"]
    _assert_no_credentials(out)


@pytest.mark.asyncio
async def test_register_broker_account_binds_ibkr():
    """@AC-1: the second registrable broker type resolves to BROKER_TYPE_IBKR."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.RegisterBrokerAccount = AsyncMock(
        return_value=trading_pb2.RegisterBrokerAccountResponse(
            account=trading_pb2.BrokerAccount(id="acct-8", broker_type=2)
        )
    )
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.register_broker_account(
                "user-42", "My IBKR", "IBKR", '{"consumer_key":"ck"}'
            )

    sent = mock_stub.RegisterBrokerAccount.call_args.args[0]
    assert sent.broker_type == 2  # BROKER_TYPE_IBKR (case-insensitive)
    assert out["account"]["broker_type"] == "BROKER_TYPE_IBKR"


@pytest.mark.asyncio
async def test_register_broker_account_rejects_offline_and_unknown_without_rpc():
    """The client map excludes offline/unknown types; a miss raises before any RPC is issued."""
    mock_stub = MagicMock()
    mock_stub.RegisterBrokerAccount = AsyncMock()
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            with pytest.raises(ValueError, match="unsupported broker_type"):
                await client.register_broker_account("user-42", "x", "offline", "")
            with pytest.raises(ValueError, match="unsupported broker_type"):
                await client.register_broker_account("user-42", "x", "", "{}")
    mock_stub.RegisterBrokerAccount.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_broker_account_credentials_forwards_and_hides():
    """@AC-4: update forwards account_id + x-user-id; the returned account carries no credential."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.UpdateBrokerAccountCredentials = AsyncMock(
        return_value=trading_pb2.UpdateBrokerAccountCredentialsResponse(
            account=trading_pb2.BrokerAccount(id="acct-7", broker_type=1)
        )
    )
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.update_broker_account_credentials(
                "user-42", "acct-7", '{"api_key":"AKnew","api_secret":"SECnew"}'
            )

    sent = mock_stub.UpdateBrokerAccountCredentials.call_args.args[0]
    assert sent.account_id == "acct-7"
    meta = mock_stub.UpdateBrokerAccountCredentials.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    assert out["account"]["id"] == "acct-7"
    _assert_no_credentials(out)


@pytest.mark.asyncio
async def test_deregister_broker_account_synthesizes_confirmation():
    """@AC-5: deregister forwards account_id + x-user-id; the empty RPC response becomes a
    synthesized confirmation dict."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.DeregisterBrokerAccount = AsyncMock(
        return_value=trading_pb2.DeregisterBrokerAccountResponse()
    )
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.deregister_broker_account("user-42", "acct-7")

    sent = mock_stub.DeregisterBrokerAccount.call_args.args[0]
    assert sent.account_id == "acct-7"
    meta = mock_stub.DeregisterBrokerAccount.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    assert out == {"deregistered": True, "account_id": "acct-7"}


@pytest.mark.asyncio
async def test_list_broker_accounts_returns_broker_and_offline_together():
    """@AC-6: the single list surfaces both broker and offline accounts, each by broker_type."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.ListBrokerAccounts = AsyncMock(
        return_value=trading_pb2.ListBrokerAccountsResponse(
            accounts=[
                trading_pb2.BrokerAccount(id="acct-7", broker_type=1),  # ALPACA
                trading_pb2.BrokerAccount(id="acct-9", broker_type=3),  # OFFLINE
            ]
        )
    )
    grpc_patch, stub_patch = _patch_trading_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.list_broker_accounts("user-42")

    meta = mock_stub.ListBrokerAccounts.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    by_id = {a["id"]: a for a in out["accounts"]}
    assert by_id["acct-7"]["broker_type"] == "BROKER_TYPE_ALPACA"
    assert by_id["acct-9"]["broker_type"] == "BROKER_TYPE_OFFLINE"


def test_account_to_dict_covers_every_broker_account_field():
    """F-12 field-parity guard: freeze the BrokerAccount contract so a future proto field cannot
    silently vanish from list_accounts, and assert the id field is `id` (not `accountId`)."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    fields = set(trading_pb2.BrokerAccount.DESCRIPTOR.fields_by_name)
    # The frozen contract (trading.proto:217-237). A proto field addition/removal breaks this,
    # forcing a review of the list_accounts projection in the same change.
    assert fields == {
        "id",
        "display_name",
        "broker_type",
        "is_paper",
        "user_id",
        "is_active",
        "credential_status",
        "credential_checked_at",
        "halted",
        "halted_at",
        "halt_reason",
        "halt_source",
    }
    assert "id" in fields and "accountId" not in fields  # the fails.md:426-428 trap

    # A populated account projects only real proto fields (no invented keys, no credential leak).
    acct = trading_pb2.BrokerAccount(
        id="acct-7", display_name="My Alpaca", broker_type=1, user_id="user-42", is_active=True
    )
    projected = set(client._account_to_dict(acct))
    assert projected <= fields
    assert "id" in projected


def test_account_to_dict_always_surfaces_scalar_bools_even_when_false():
    """AGENT-7: proto3 omits a scalar bool at its zero value, so a plain MessageToDict drops
    is_active / is_paper / halted from any account where they are false — the agent then sees each
    field on some accounts but not others and cannot distinguish false from "field absent". The
    projection must pin all three on every account so their presence is uniform across the
    list_accounts output."""
    from gen.trading.v1 import trading_pb2  # type: ignore

    all_false = trading_pb2.BrokerAccount(
        id="acct-false", broker_type=1, is_active=False, is_paper=False, halted=False
    )
    all_true = trading_pb2.BrokerAccount(
        id="acct-true", broker_type=1, is_active=True, is_paper=True, halted=True
    )

    proj_false = client._account_to_dict(all_false)
    proj_true = client._account_to_dict(all_true)

    for field in ("is_active", "is_paper", "halted"):
        assert field in proj_false and proj_false[field] is False, field
        assert field in proj_true and proj_true[field] is True, field
