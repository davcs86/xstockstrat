"""Feature 205 — G6 third-leg parity: the analysis-suite check that the hand-authored
`_FUNDAMENTAL_METRIC_DATA_KEY` lowering map (evaluator.py) agrees with both the mechanical
derivation the indicators `ListFundamentalMetrics` handler uses
(`name.removeprefix("FUNDAMENTAL_METRIC_").lower()`) and the proto enum descriptor.

This pins the three-way contract: (1) analysis's hand map, (2) the mechanical derivation, and
(3) the FundamentalMetric enum — so a new metric cannot be added to the enum, or to one map, without
the other legs failing loudly.
"""

from gen.indicators.v1 import indicators_pb2

from app.services.evaluator import _FUNDAMENTAL_METRIC_DATA_KEY


def _mechanical_data_key(enum_int: int) -> str:
    name = indicators_pb2.FundamentalMetric.Name(enum_int)
    return name.removeprefix("FUNDAMENTAL_METRIC_").lower()


def test_analysis_map_matches_mechanical_derivation():
    # Every hand-authored (enum, data_key) equals the mechanical name-lowering the indicators
    # handler applies — the two vocabularies can never silently diverge.
    for enum_int, data_key in _FUNDAMENTAL_METRIC_DATA_KEY.items():
        assert _mechanical_data_key(enum_int) == data_key


def test_analysis_map_is_complete_against_the_enum():
    # The map covers exactly the non-UNSPECIFIED enum values — nothing missing, nothing extra.
    enum_numbers = {
        v.number for v in indicators_pb2.FundamentalMetric.DESCRIPTOR.values if v.number != 0
    }
    assert set(_FUNDAMENTAL_METRIC_DATA_KEY) == enum_numbers
    assert len(_FUNDAMENTAL_METRIC_DATA_KEY) == 11
