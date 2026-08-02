"""Tests for app/client.py — gRPC client helpers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client


def test_metadata_includes_mcp_secret():
    """When MCP_AGENT_SECRET is set, _metadata returns x-mcp-secret tuple."""
    assert ("x-mcp-secret", "test-secret") in client._metadata()


def test_metadata_empty_when_no_secret(monkeypatch):
    """When MCP_AGENT_SECRET is empty, _metadata returns empty list."""
    monkeypatch.setattr(client, "MCP_AGENT_SECRET", "")
    assert client._metadata() == []


def test_iso_to_timestamp_utc():
    """ISO Z string converts to Timestamp with correct seconds."""
    ts = client._iso_to_timestamp("2026-05-01T00:00:00Z")
    assert ts.seconds == 1777593600


def test_iso_to_timestamp_offset():
    """ISO string with offset converts correctly."""
    ts = client._iso_to_timestamp("2026-05-01T01:00:00+01:00")
    assert ts.seconds == 1777593600


def test_severity_map_coverage():
    """All expected severity levels are mapped to non-zero ints."""
    for level in ("info", "warning", "error", "critical"):
        assert client._SEVERITY_MAP[level] > 0


@pytest.mark.asyncio
async def test_emit_alert_sends_grpc_call():
    """emit_alert calls EmitAlert on the NotifyService stub."""
    mock_resp = MagicMock()
    mock_resp.alert_id = "alert-123"

    mock_stub = MagicMock()
    mock_stub.EmitAlert = AsyncMock(return_value=mock_resp)

    channel_cm = MagicMock()
    channel_cm.__aenter__ = AsyncMock(return_value=MagicMock())
    channel_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("app.client.grpc") as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = channel_cm

        from gen.notify.v1 import notify_pb2_grpc  # type: ignore

        with patch.object(notify_pb2_grpc, "NotifyServiceStub", return_value=mock_stub):
            await client.emit_alert(
                severity="info",
                category="signal",
                title="Test Alert",
                body="Test body",
            )

    assert mock_stub.EmitAlert.called


# ── management client helpers (feature 047) ────────────────────────────────


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


class TestManageStrategyClient:
    @pytest.mark.asyncio
    async def test_uses_analysis_endpoint_and_admin_scope(self):
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        resp = analysis_pb2.StrategyDefinition(strategy_id="x", display_name="X")
        mock_stub = MagicMock()
        mock_stub.ManageStrategy = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                result = await client.manage_strategy(
                    operation="register",
                    definition={
                        "strategy_id": "x",
                        "display_name": "X",
                        "components": [],
                        "entry_rule": "",
                        "exit_rule": "",
                    },
                    access_scope=15,
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.ANALYSIS_ENDPOINT
        meta = mock_stub.ManageStrategy.call_args.kwargs["metadata"]
        assert ("x-mcp-secret", "test-secret") in meta
        # feature 092: forwards the caller's derived scope (was a hardcoded 7).
        assert ("x-access-scope", "15") in meta
        assert not any(k == "authorization" for k, _ in meta)
        assert result["strategyId"] == "x"

    @pytest.mark.asyncio
    async def test_cooldown_days_round_trips_presence(self):
        """FR-10: the client sets proto presence for 14 and 0, and leaves it unset when absent."""
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        async def _constructed_definition(defn: dict):
            resp = analysis_pb2.StrategyDefinition(strategy_id="x")
            mock_stub = MagicMock()
            mock_stub.ManageStrategy = AsyncMock(return_value=resp)
            with patch("app.client.grpc") as mock_grpc:
                mock_grpc.aio.insecure_channel.return_value = _channel_cm()
                with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                    await client.manage_strategy(operation="register", definition=defn)
            return mock_stub.ManageStrategy.call_args.args[0].definition

        base = {"strategy_id": "x", "display_name": "X", "components": []}

        d14 = await _constructed_definition({**base, "cooldown_days": 14})
        assert d14.HasField("cooldown_days") and d14.cooldown_days == 14

        d0 = await _constructed_definition({**base, "cooldown_days": 0})
        assert d0.HasField("cooldown_days") and d0.cooldown_days == 0

        d_unset = await _constructed_definition(base)
        assert not d_unset.HasField("cooldown_days")

    @pytest.mark.asyncio
    async def test_unknown_operation_raises(self):
        with pytest.raises(ValueError):
            await client.manage_strategy(operation="bogus", definition={})


class TestManageFormulaClient:
    @pytest.mark.asyncio
    async def test_register_uses_indicators_endpoint(self):
        from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

        resp = indicators_pb2.RegisterFormulaResponse(formula_id="f-9")
        mock_stub = MagicMock()
        mock_stub.RegisterFormula = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
                result = await client.manage_formula(
                    operation="register",
                    formula={"name": "rsi2", "source": "x=1"},
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.INDICATORS_ENDPOINT
        assert result == {"formula_id": "f-9"}


# ── screen_symbols client (feature 061) ────────────────────────────────────


class TestScreenSymbolsClient:
    @pytest.mark.asyncio
    async def test_screen_symbols_sends_grpc_call(self):
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        resp = analysis_pb2.ScreenSymbolsResponse(
            results=[
                analysis_pb2.ScreenResult(
                    symbol="NVDA",
                    score=0.91,
                    criterion_scores={"pe": 1.0},
                    passed=True,
                    status=analysis_pb2.SCREEN_RESULT_STATUS_OK,
                )
            ],
            coverage_gaps=[analysis_pb2.CoverageGap(symbol="TSLA")],
        )
        mock_stub = MagicMock()
        mock_stub.ScreenSymbols = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                result = await client.screen_symbols(
                    symbols=["NVDA"],
                    criteria=[
                        {
                            "ref_name": "pe",
                            "kind": "SCREEN_KIND_FUNDAMENTAL",
                            "metric_name": "pe_ratio",
                            "op": "COMPARATOR_LTE",
                            "threshold": 25.0,
                            "hard_filter": True,
                        }
                    ],
                )
        # Channel opened against the (test-patched) analysis endpoint symbol.
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.ANALYSIS_ENDPOINT
        # Read-only: carries x-mcp-secret, never an admin x-access-scope.
        meta = mock_stub.ScreenSymbols.call_args.kwargs["metadata"]
        assert ("x-mcp-secret", "test-secret") in meta
        assert not any(k == "x-access-scope" for k, _ in meta)
        # Response is shaped into a JSON-serializable dict.
        assert result["results"][0] == {
            "symbol": "NVDA",
            "score": pytest.approx(0.91),
            "criterion_scores": {"pe": 1.0},
            "passed": True,
            "status": "SCREEN_RESULT_STATUS_OK",
        }
        assert result["coverage_gaps"] == [{"symbol": "TSLA"}]
        # Enum-name criterion mapping reached the request unmodified.
        sent_req = mock_stub.ScreenSymbols.call_args[0][0]
        assert sent_req.criteria[0].kind == analysis_pb2.SCREEN_KIND_FUNDAMENTAL
        assert sent_req.criteria[0].op == analysis_pb2.COMPARATOR_LTE
        assert sent_req.criteria[0].hard_filter is True

    @pytest.mark.asyncio
    async def test_register_maps_parameter_definitions(self):
        from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc  # type: ignore

        resp = indicators_pb2.RegisterFormulaResponse(formula_id="f-10")
        mock_stub = MagicMock()
        mock_stub.RegisterFormula = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(indicators_pb2_grpc, "IndicatorsServiceStub", return_value=mock_stub):
                await client.manage_formula(
                    operation="register",
                    formula={
                        "name": "rsi3",
                        "source": "result = params['period']",
                        "parameters": [
                            {
                                "name": "period",
                                "type": "int",
                                "default": 14,
                                "required": True,
                                "min": 1,
                                "max": 200,
                            }
                        ],
                    },
                )
        req = mock_stub.RegisterFormula.call_args.args[0]
        assert len(req.parameters) == 1
        p = req.parameters[0]
        assert p.name == "period"
        assert p.type == indicators_pb2.PARAMETER_TYPE_INT
        assert p.required is True
        assert p.default_value.number_value == 14
        assert p.min == 1
        assert p.max == 200


class TestManageSignalSourceClient:
    @pytest.mark.asyncio
    async def test_uses_ingest_endpoint_and_omits_credentials_ref(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        resp = ingest_pb2.ManageSignalSourceResponse(
            source=ingest_pb2.SignalSource(slug="uw", display_name="UW")
        )
        mock_stub = MagicMock()
        mock_stub.ManageSignalSource = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                result = await client.manage_signal_source(
                    operation="register",
                    source={"slug": "uw", "display_name": "UW"},
                    credentials_ref="secret",
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.INGEST_ENDPOINT
        assert "credentials_ref" not in result  # FR-12
        assert result["slug"] == "uw"


class TestSetStrategyLiveClient:
    @pytest.mark.asyncio
    async def test_uses_analysis_endpoint_and_admin_scope(self):
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        resp = analysis_pb2.SetStrategyLiveResponse(
            definition=analysis_pb2.StrategyDefinition(
                strategy_id="s1", display_name="S1", live_enabled=True
            )
        )
        mock_stub = MagicMock()
        mock_stub.SetStrategyLive = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                result = await client.set_strategy_live(
                    strategy_id="s1", live_enabled=True, access_scope=15
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.ANALYSIS_ENDPOINT
        meta = mock_stub.SetStrategyLive.call_args.kwargs["metadata"]
        assert ("x-access-scope", "15") in meta  # feature 092: caller-derived scope
        assert not any(k == "authorization" for k, _ in meta)
        assert result["live_enabled"] is True


# ── backfill client (feature 066) ──────────────────────────────────────────


class TestTriggerBackfillClient:
    def _run(self, mock_stub, **kwargs):
        from gen.ingest.v1 import ingest_pb2_grpc  # type: ignore

        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                return mock_grpc, client.trigger_backfill(**kwargs)

    @pytest.mark.asyncio
    async def test_trigger_sends_admin_scope_and_returns_envelope(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        resp = ingest_pb2.TriggerBackfillResponse(
            job_id="j-1", status=ingest_pb2.BACKFILL_STATUS_QUEUED
        )
        mock_stub = MagicMock()
        mock_stub.TriggerBackfill = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                result = await client.trigger_backfill(
                    symbols=["AAPL"], timeframe="1d", access_scope=15
                )
        assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.INGEST_ENDPOINT
        meta = mock_stub.TriggerBackfill.call_args.kwargs["metadata"]
        assert ("x-mcp-secret", "test-secret") in meta
        assert ("x-access-scope", "15") in meta  # feature 092: caller-derived scope
        assert result == {"job_id": "j-1", "status": "BACKFILL_STATUS_QUEUED"}

    @pytest.mark.asyncio
    async def test_trigger_request_field_mapping_dual_field_and_alias(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.TriggerBackfill = AsyncMock(
            return_value=ingest_pb2.TriggerBackfillResponse(job_id="j")
        )
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                await client.trigger_backfill(
                    symbols=["AAPL", "MSFT"], timeframe="1Day", overwrite=True
                )
        sent_req = mock_stub.TriggerBackfill.call_args[0][0]
        assert list(sent_req.symbols) == ["AAPL", "MSFT"]
        # Alias canonicalized + dual-field send (deprecated string AND enum, FR-2).
        assert sent_req.timeframe == "1d"
        assert sent_req.timeframe_enum == 4  # TIMEFRAME_1DAY
        assert sent_req.overwrite is True
        assert sent_req.fill_mode == 0  # omitted → UNSPECIFIED (server FULL)

    @pytest.mark.asyncio
    async def test_trigger_fill_mode_gaps_only(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.TriggerBackfill = AsyncMock(
            return_value=ingest_pb2.TriggerBackfillResponse(job_id="j")
        )
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                await client.trigger_backfill(symbols=["AAPL"], fill_mode="gaps_only")
        assert mock_stub.TriggerBackfill.call_args[0][0].fill_mode == 2

    @pytest.mark.asyncio
    async def test_trigger_range_omitted_one_sided_and_both(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.TriggerBackfill = AsyncMock(
            return_value=ingest_pb2.TriggerBackfillResponse(job_id="j")
        )
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                await client.trigger_backfill(symbols=["AAPL"])
                no_range = mock_stub.TriggerBackfill.call_args[0][0]
                await client.trigger_backfill(symbols=["AAPL"], start="2025-01-01T00:00:00Z")
                start_only = mock_stub.TriggerBackfill.call_args[0][0]
                await client.trigger_backfill(
                    symbols=["AAPL"],
                    start="2025-01-01T00:00:00Z",
                    end="2025-06-30T00:00:00Z",
                )
                both = mock_stub.TriggerBackfill.call_args[0][0]
        assert no_range.HasField("range") is False
        assert start_only.range.start.seconds > 0
        assert start_only.range.end.seconds == 0
        assert both.range.start.seconds > 0
        assert both.range.end.seconds > both.range.start.seconds

    @pytest.mark.asyncio
    async def test_trigger_validation_valueerrors(self):
        with pytest.raises(ValueError, match="non-empty"):
            await client.trigger_backfill(symbols=[])
        with pytest.raises(ValueError, match="max 50"):
            await client.trigger_backfill(symbols=[f"S{i}" for i in range(51)])
        with pytest.raises(ValueError, match="15m/15Min/1h/1Hour/1d/1Day"):
            await client.trigger_backfill(symbols=["AAPL"], timeframe="1w")
        with pytest.raises(ValueError, match="full/gaps_only"):
            await client.trigger_backfill(symbols=["AAPL"], fill_mode="everything")
        with pytest.raises(ValueError, match="start"):
            await client.trigger_backfill(
                symbols=["AAPL"],
                start="2025-06-30T00:00:00Z",
                end="2025-01-01T00:00:00Z",
            )


class TestGetBackfillStatusClient:
    @pytest.mark.asyncio
    async def test_single_job_branch_read_only_metadata_and_envelope(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        job = ingest_pb2.BackfillJob(
            job_id="j-1",
            symbols=["AAPL"],
            status=ingest_pb2.BACKFILL_STATUS_RUNNING,
            bars_processed=0,
            bars_total=500,
        )
        mock_stub = MagicMock()
        mock_stub.GetBackfillStatus = AsyncMock(return_value=job)
        mock_stub.ListBackfillJobs = AsyncMock()
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                result = await client.get_backfill_status(job_id="j-1")
        assert mock_stub.GetBackfillStatus.called
        assert not mock_stub.ListBackfillJobs.called
        meta = mock_stub.GetBackfillStatus.call_args.kwargs["metadata"]
        assert ("x-mcp-secret", "test-secret") in meta
        assert not any(k == "x-access-scope" for k, _ in meta)
        # {"job": ...} envelope, snake_case keys, zero-valued fields visible while polling.
        # (int64 proto fields serialize as strings — same as run_backtest's output.)
        assert result["job"]["job_id"] == "j-1"
        assert result["job"]["status"] == "BACKFILL_STATUS_RUNNING"
        assert result["job"]["bars_processed"] == "0"

    @pytest.mark.asyncio
    async def test_not_found_propagates_as_aio_rpc_error(self):
        import grpc  # noqa: PLC0415
        from gen.ingest.v1 import ingest_pb2_grpc  # type: ignore
        from grpc.aio import AioRpcError, Metadata  # noqa: PLC0415

        err = AioRpcError(grpc.StatusCode.NOT_FOUND, Metadata(), Metadata(), details="nope")
        mock_stub = MagicMock()
        mock_stub.GetBackfillStatus = AsyncMock(side_effect=err)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                with pytest.raises(AioRpcError):
                    await client.get_backfill_status(job_id="missing")

    @pytest.mark.asyncio
    async def test_list_branch_filters_pagination_and_envelope(self):
        from gen.common.v1 import common_pb2  # type: ignore
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        resp = ingest_pb2.ListBackfillJobsResponse(
            jobs=[ingest_pb2.BackfillJob(job_id="j-2", status=3)],
            page=common_pb2.PageResponse(next_page_token="20"),
        )
        mock_stub = MagicMock()
        mock_stub.ListBackfillJobs = AsyncMock(return_value=resp)
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                result = await client.get_backfill_status(
                    status_filter="completed", symbol="AAPL", limit=5, page_token="10"
                )
        sent_req = mock_stub.ListBackfillJobs.call_args[0][0]
        assert sent_req.status_filter == 3  # BACKFILL_STATUS_COMPLETED
        assert sent_req.symbol == "AAPL"
        assert sent_req.page.page_size == 5
        assert sent_req.page.page_token == "10"
        assert result["jobs"][0]["job_id"] == "j-2"
        assert result["next_page_token"] == "20"

    @pytest.mark.asyncio
    async def test_list_branch_unspecified_filter_and_bad_filter(self):
        from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.ListBackfillJobs = AsyncMock(return_value=ingest_pb2.ListBackfillJobsResponse())
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=mock_stub):
                await client.get_backfill_status(status_filter="unspecified")
        assert mock_stub.ListBackfillJobs.call_args[0][0].status_filter == 0
        with pytest.raises(ValueError, match="queued/running/completed/failed/partial/canceled"):
            await client.get_backfill_status(status_filter="bogus")


class TestManageStrategyUpdateMask:
    """feature 070 — the mask must reach the wire, and `active` must not."""

    @pytest.mark.asyncio
    async def test_mask_is_attached_and_absent_when_not_given(self):
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.ManageStrategy = AsyncMock(
            return_value=analysis_pb2.StrategyDefinition(strategy_id="x")
        )
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                await client.manage_strategy(
                    operation="update",
                    definition={"strategy_id": "x", "cooldown_days": 45},
                    update_mask=["cooldown_days"],
                )
                masked = mock_stub.ManageStrategy.call_args[0][0]
                await client.manage_strategy(
                    operation="update", definition={"strategy_id": "x", "display_name": "X"}
                )
                maskless = mock_stub.ManageStrategy.call_args[0][0]

        assert masked.HasField("update_mask") is True
        assert list(masked.update_mask.paths) == ["cooldown_days"]
        assert masked.definition.cooldown_days == 45
        # Absent mask => full replace, the pre-070 contract.
        assert maskless.HasField("update_mask") is False

    @pytest.mark.asyncio
    async def test_active_is_no_longer_injected(self):
        """`active` is column-authoritative — the server overlays it and never writes it from
        the definition, so sending it only polluted the stored definition_json."""
        from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # type: ignore

        mock_stub = MagicMock()
        mock_stub.ManageStrategy = AsyncMock(
            return_value=analysis_pb2.StrategyDefinition(strategy_id="x")
        )
        with patch("app.client.grpc") as mock_grpc:
            mock_grpc.aio.insecure_channel.return_value = _channel_cm()
            with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=mock_stub):
                await client.manage_strategy(
                    operation="register", definition={"strategy_id": "x", "display_name": "X"}
                )
                sent = mock_stub.ManageStrategy.call_args[0][0]

        from google.protobuf import json_format  # noqa: PLC0415

        as_dict = json_format.MessageToDict(sent.definition, preserving_proto_field_name=True)
        assert "active" not in as_dict
