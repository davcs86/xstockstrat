"""Feature 169 — Position proto descriptor-parity test (AC-8).

Guards against silent proto drift: if a field is added to or removed from the Position message,
this test fails immediately — forcing an explicit decision about whether the new field should
surface through get_positions / get_positions_by_account_id.
"""

from gen.portfolio.v1 import portfolio_pb2  # type: ignore
from google.protobuf.json_format import MessageToDict
from google.protobuf.timestamp_pb2 import Timestamp as PbTimestamp

# All 23 fields from portfolio.proto Position (field numbers 1–23).
_POSITION_FIELD_SET = frozenset(
    {
        "symbol",
        "qty",
        "avg_entry_price",
        "current_price",
        "market_value",
        "unrealized_pnl",
        "unrealized_pnl_pct",
        "cost_basis",
        "opened_at",
        "trading_mode",
        "account_id",
        "day_pnl",
        "day_pnl_pct",
        "stop_price",
        "risk_at_stop",
        "stop_distance_pct",
        "factor",
        "flag",
        "exit_rule",
        "stop_order_id",
        "take_profit_order_id",
        "as_of",
        "source",
    }
)


def test_position_field_set_matches_proto_descriptor():
    """AC-8 guard A: the frozen set covers exactly the proto descriptor.

    If a field is added to Position in portfolio.proto, this test fails — forcing
    the developer to update _POSITION_FIELD_SET and decide whether the new field
    should surface through the MCP tools.
    """
    assert _POSITION_FIELD_SET == set(portfolio_pb2.Position.DESCRIPTOR.fields_by_name)


def test_position_messagetodict_produces_all_fields():
    """AC-8 guard B: MessageToDict with all-non-default values emits every field.

    Proto3 serialization omits zero-value fields; this confirms that a fully-
    populated Position round-trips through MessageToDict without silent loss.
    """
    ts = PbTimestamp()
    ts.FromJsonString("2026-01-15T16:00:00Z")

    pos = portfolio_pb2.Position(
        symbol="AAPL",
        qty=100.0,
        avg_entry_price=150.0,
        current_price=155.0,
        market_value=15500.0,
        unrealized_pnl=500.0,
        unrealized_pnl_pct=0.0333,
        cost_basis=15000.0,
        opened_at=ts,
        trading_mode=1,  # TRADING_MODE_PAPER
        account_id="acct-1",
        day_pnl=120.0,
        day_pnl_pct=0.0078,
        stop_price=148.0,
        risk_at_stop=200.0,
        stop_distance_pct=0.0452,
        factor="Technology",
        flag=1,  # POSITION_RISK_FLAG_NEAR_STOP
        exit_rule="trailing_stop_5pct",
        stop_order_id="ord-stop-1",
        take_profit_order_id="ord-tp-1",
        as_of=ts,
        source=2,  # POSITION_SOURCE_BASELINE
    )

    result = MessageToDict(pos, preserving_proto_field_name=True)
    assert set(result.keys()) == _POSITION_FIELD_SET
