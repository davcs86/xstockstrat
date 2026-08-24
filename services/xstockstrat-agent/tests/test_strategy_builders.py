"""Descriptor-parity tests for the strategy/screener request builders (feature 097, Step 16).

Mirrors tests/test_formula_builders.py + tests/test_backtest_view.py::
test_summary_key_set_covers_every_proto_field — the C-10 / RC-1 antidote: a hand-written
dict→proto builder that silently drops a newly-added proto field must fail a test, not ship.
We populate every field with a NON-default value, capture the request the client actually built,
and assert its set-field names (plus an explicitly justified opt-out set) equal the message's
full field set.

Feature 097 deprecates the signal blend from a *strategy's backtest score* (analysis side), but
leaves `screen_symbols`' signal params (the screener) and `manage_strategy`'s `signal_params`
(the live-loop symbol universe) intact — so those builders are unchanged and these tests pin
their current field sets. `run_backtest` passes no signal params, so it has no builder to guard.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client

# StrategyDefinition: the agent never authors the server-authoritative fields — `active`/
# `live_enabled` are column-authoritative (overlaid at read time) and `warnings` is populated by
# GetStrategy only. `user_id` (feature 133) is ownership-authoritative: it is resolved server-side
# from the propagated `x-user-id` header, never the request body, so the builder deliberately never
# authors it. Every other field is sent. A new StrategyDefinition field fails this test until the
# builder carries it or it is justified here.
_STRATEGY_INTENTIONALLY_UNSET = {"active", "live_enabled", "warnings", "user_id"}
# ScreenSymbolsRequest: `evaluation_window` (historical as-of) is deferred (OQ-060-e) — latest bar
# is the default — so the builder does not author it. Every other field is sent.
_SCREEN_INTENTIONALLY_UNSET = {"evaluation_window"}
# StrategyComponent: the builder authors every field.
_COMPONENT_INTENTIONALLY_UNSET: set[str] = set()


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


async def _capture_manage_strategy_request():
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

    mock_stub = MagicMock()
    mock_stub.ManageStrategy = AsyncMock(
        return_value=analysis_pb2.StrategyDefinition(strategy_id="s")
    )
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
            await client.manage_strategy(
                user_id="u-1",
                operation="register",
                definition={
                    "strategy_id": "s1",
                    "display_name": "S1",
                    "components": [
                        {
                            "kind": "formula",
                            "ref_name": "r",
                            "indicator": "SMA",
                            "formula_id": "f1",
                            "params": {"period": 3.0},
                        }
                    ],
                    "entry_rule": '{"fn":">","lhs":"r","rhs":1}',
                    "exit_rule": '{"fn":"<","lhs":"r","rhs":1}',
                    "cooldown_days": 5,
                    "exit_cooldown_days": 3,
                    "signal_params": {"symbols": ["AAPL"]},
                    # feature 132 — set both so they appear in ListFields for the parity check (the
                    # allowlist×signal_eligible conflict is a backend concern; this mock only
                    # captures the built request, it does not validate).
                    "denied_symbols": ["TSLA"],
                    "signal_eligible": True,
                },
            )
    return mock_stub.ManageStrategy.call_args[0][0]


async def _capture_screen_symbols_request():
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

    mock_stub = MagicMock()
    mock_stub.ScreenSymbols = AsyncMock(return_value=analysis_pb2.ScreenSymbolsResponse())
    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
            await client.screen_symbols(
                symbols=["AAPL"],
                criteria=[{"ref_name": "r", "kind": 1, "op": 1, "threshold": 1.0, "weight": 1.0}],
                signal_sources=["uw"],
                signal_weight=0.4,
                technical_weight=0.6,
                min_conviction=0.2,
                rank_limit=10,
            )
    return mock_stub.ScreenSymbols.call_args[0][0]


class TestStrategyBuilderParity:
    @pytest.mark.asyncio
    async def test_manage_strategy_definition_covers_every_proto_field(self):
        from gen.analysis.v1 import analysis_pb2  # type: ignore

        req = await _capture_manage_strategy_request()
        set_fields = {f.name for f, _ in req.definition.ListFields()}
        assert set_fields | _STRATEGY_INTENTIONALLY_UNSET == set(
            analysis_pb2.StrategyDefinition.DESCRIPTOR.fields_by_name
        )

    @pytest.mark.asyncio
    async def test_screen_symbols_request_covers_every_proto_field(self):
        from gen.analysis.v1 import analysis_pb2  # type: ignore

        req = await _capture_screen_symbols_request()
        set_fields = {f.name for f, _ in req.ListFields()}
        assert set_fields | _SCREEN_INTENTIONALLY_UNSET == set(
            analysis_pb2.ScreenSymbolsRequest.DESCRIPTOR.fields_by_name
        )

    def test_build_component_covers_every_proto_field(self):
        from gen.analysis.v1 import analysis_pb2  # type: ignore

        comp = client._build_component(
            {
                "kind": "formula",
                "ref_name": "r",
                "indicator": "SMA",
                "formula_id": "f1",
                "params": {"period": 3.0},
                # feature 152 — a benchmark component; the builder must carry source_symbol.
                "source_symbol": "VOO",
            }
        )
        set_fields = {f.name for f, _ in comp.ListFields()}
        assert set_fields | _COMPONENT_INTENTIONALLY_UNSET == set(
            analysis_pb2.StrategyComponent.DESCRIPTOR.fields_by_name
        )

    def test_build_component_maps_source_symbol_value(self):
        """feature 152: the source_symbol value actually reaches the built proto (not just
        present in the field set)."""
        from gen.analysis.v1 import analysis_pb2  # type: ignore  # noqa: F401

        comp = client._build_component(
            {"kind": "builtin", "ref_name": "mkt", "indicator": "SMA", "source_symbol": "VOO"}
        )
        assert comp.source_symbol == "VOO"

    def test_build_component_defaults_source_symbol_empty(self):
        """A component dict without source_symbol yields an unset (empty) value."""
        comp = client._build_component({"kind": "builtin", "ref_name": "f", "indicator": "SMA"})
        assert comp.source_symbol == ""

    @pytest.mark.asyncio
    async def test_guard_has_teeth(self):
        """A dropped field must break the equality — proves a future unmapped field would fail."""
        from gen.analysis.v1 import analysis_pb2  # type: ignore

        req = await _capture_manage_strategy_request()
        set_fields = {f.name for f, _ in req.definition.ListFields()}
        # Drop a real mapped field: parity must no longer hold.
        assert (set_fields - {"entry_rule"}) | _STRATEGY_INTENTIONALLY_UNSET != set(
            analysis_pb2.StrategyDefinition.DESCRIPTOR.fields_by_name
        )
