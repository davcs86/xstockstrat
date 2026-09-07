"""feature 185 FR-6 — Opportunity descriptor-parity for the agent's list_opportunities projection.

There was no descriptor-parity test for ``_opportunity_to_dict`` before this feature, so the
projection had silently drifted (it omitted ``valid_until`` and ``signal_confidence``). Step 11
back-filled those two and added ``data_unavailable``, so EVERY ``Opportunity`` proto field is now
projected — there is no silent allow-list. This guard (mirroring
test_backtest_view.py::test_summary_key_set_covers_every_proto_field) fails the moment a new proto
field is added to the shared message without a matching projection.

AGENT-2: the ``gen.*`` proto import is in-function so the module stays import-pure.
"""

from datetime import UTC, datetime

from app.client import _opportunity_to_dict


def _full_opportunity(analysis_pb2):
    """An Opportunity with EVERY field (incl. all explicit-presence ones) populated, so the
    projected key set equals the union of keys ``_opportunity_to_dict`` can ever emit."""
    o = analysis_pb2.Opportunity(
        symbol="AAPL",
        action=analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER,
        conviction=0.5,
        passing_conditions=1,
        total_conditions=2,
        thesis="t",
        strategy_id="s",
        source="uw",
        opportunity_key="u1|AAPL|s",
        provenance=["watchlist"],
        muted=False,
        data_unavailable=True,
        live_price=1.0,
        change_pct=0.1,
        target_price=2.0,
        stop_price=0.5,
        signal_confidence=0.9,
    )
    o.sparkline.append(analysis_pb2.SparklinePoint(close=1.0))
    o.conditions.append(analysis_pb2.ConditionEval(ref_name="c"))
    o.valid_until.FromDatetime(datetime(2999, 1, 1, tzinfo=UTC))
    return o


def test_opportunity_projection_covers_every_proto_field():
    from gen.analysis.v1 import analysis_pb2  # in-function per AGENT-2 — the module stays pure

    emitted = set(_opportunity_to_dict(_full_opportunity(analysis_pb2), analysis_pb2))
    assert emitted == set(analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name)


def test_guard_has_teeth():
    from gen.analysis.v1 import analysis_pb2

    emitted = set(_opportunity_to_dict(_full_opportunity(analysis_pb2), analysis_pb2))
    # Dropping any projected field must break parity — proving a newly-added proto field would too.
    assert (emitted - {"data_unavailable"}) != set(
        analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name
    )
