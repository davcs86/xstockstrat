"""Feature 355 — mediated sources return prose, never an extractor module.

Tool-level shapes for list_signal_sources / manage_signal_source / instantiate_template, the
update-mask rule for the new field, and doc parity across the surfaces that describe them.
"""

import inspect
import json
import pathlib
import re
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from app import client, tools
from tests.conftest import ADMIN, TRADER, _ctx, _rpc_error
from tests.test_signal_source_builder import _channel_cm
from tests.test_template_tools import _run, _stubs
from tests.test_tools import _make_server, _tool_fn

_PROSE = "Each bolded ticker is a buy signal."
_REPO = pathlib.Path(__file__).resolve().parents[3]
_PROMPT = _REPO / "services/xstockstrat-agent/app/prompts/signal_extraction.md"
_RUNBOOK = _REPO / "docs/runbooks/mcp-tools.md"
_PRECEDENCE = "`extraction_instructions` override this generic guidance"
_LIST_KEYS = {
    "slug",
    "display_name",
    "source_type",
    "config_json",
    "extractor_tool",
    "has_credentials",
    "reliability_weight",
}
_INSTRUCTION_KEYS = {"extraction_instructions", "extraction_instructions_is_default"}


def _client_source(source_type="mediated_simple_email", **over):
    """A dict shaped like one client.list_signal_sources entry."""
    src = {
        "slug": "whale_alerts",
        "display_name": "Whale Alerts",
        "source_type": source_type,
        "config_json": {},
        "has_credentials": False,
        "reliability_weight": 1.0,
        "user_id": "u-1",
        "origin": None,
    }
    src.update(over)
    return src


async def _list(*sources):
    with patch.object(client, "list_signal_sources", AsyncMock(return_value=list(sources))):
        result = await _tool_fn(_make_server(), "list_signal_sources")()
    return result["sources"]


async def _manage(resp_source, **tool_kwargs):
    """Run the manage_signal_source tool through the real client against a stubbed ingest that
    answers `resp_source`; returns (request proto, tool result)."""
    from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # type: ignore

    stub = MagicMock()
    stub.ManageSignalSource = AsyncMock(
        return_value=ingest_pb2.ManageSignalSourceResponse(source=resp_source)
    )
    with patch("app.client.mtls") as mtls:
        mtls.secure_channel.return_value = _channel_cm()
        with patch.object(ingest_pb2_grpc, "IngestServiceStub", return_value=stub):
            result = await _tool_fn(_make_server(), "manage_signal_source")(
                ctx=_ctx(ADMIN), **tool_kwargs
            )
    return stub.ManageSignalSource.call_args[0][0], result


def _mediated_proto(instructions=_PROSE, **over):
    from gen.ingest.v1 import ingest_pb2  # type: ignore

    fields = {
        "slug": "whale_alerts",
        "display_name": "Whale Alerts",
        "source_type": "mediated_simple_email",
        "extractor_module": "app.extractors.noop",
        "active": True,
        "extraction_instructions": instructions,
    }
    fields.update(over)
    return ingest_pb2.SignalSource(**fields)


# ── list_signal_sources ──────────────────────────────────────────────────


async def test_ac6_listing_a_mediated_source_returns_its_stored_instructions():
    (entry,) = await _list(_client_source(extraction_instructions=_PROSE))
    assert entry["extraction_instructions"] == _PROSE
    assert entry["extraction_instructions_is_default"] is False


@pytest.mark.parametrize("source_type", ["mediated_simple_email", "mediated_simple_website"])
@pytest.mark.parametrize("stored", ["", "   ", None])
async def test_ac7_a_mediated_source_without_instructions_gets_the_default_text(
    source_type, stored
):
    src = _client_source(source_type)
    if stored is not None:
        src["extraction_instructions"] = stored
    (entry,) = await _list(src)
    assert tools._DEFAULT_EXTRACTION_INSTRUCTIONS.strip()
    assert entry["extraction_instructions"] == tools._DEFAULT_EXTRACTION_INSTRUCTIONS
    assert entry["extraction_instructions_is_default"] is True
    assert "noop" not in json.dumps(entry)


async def test_ac24_a_mediated_entry_carries_origin_and_a_non_mediated_one_does_not():
    origin = {
        "template_id": "tpl-robinhood_snacks",
        "template_version": 1,
        "latest_version": 1,
        "update_available": False,
    }
    mediated, other = await _list(
        _client_source(slug="my_snacks", origin=origin, extraction_instructions=_PROSE),
        _client_source(
            "mcp_client", slug="ext_feed", origin=origin, extraction_instructions=_PROSE
        ),
    )
    assert mediated["origin"]["template_id"] == "tpl-robinhood_snacks"
    assert set(mediated) == _LIST_KEYS | _INSTRUCTION_KEYS | {"origin"}
    assert set(other) == _LIST_KEYS


async def test_a_mediated_entry_without_a_template_has_a_null_origin():
    (entry,) = await _list(_client_source(extraction_instructions=_PROSE))
    assert entry["origin"] is None


# ── manage_signal_source ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "call",
    [
        {"operation": "update", "reliability_weight": 0.5},
        {"operation": "deactivate"},
        {"operation": "reactivate"},
    ],
)
async def test_ac8_manage_responses_for_a_mediated_source_carry_instructions_and_no_module(call):
    _req, result = await _manage(_mediated_proto(), slug="whale_alerts", **call)
    assert result["extraction_instructions"] == _PROSE
    assert result["extraction_instructions_is_default"] is False
    assert "extractor_module" not in result


async def test_ac8_a_legacy_mediated_response_returns_the_default_text():
    _req, result = await _manage(
        _mediated_proto(instructions=""), slug="whale_alerts", operation="deactivate"
    )
    assert result["extraction_instructions"] == tools._DEFAULT_EXTRACTION_INSTRUCTIONS
    assert result["extraction_instructions_is_default"] is True
    assert "extractor_module" not in result
    assert "noop" not in json.dumps(result)


async def test_ac10_a_non_mediated_source_still_carries_its_extractor_module():
    from gen.ingest.v1 import ingest_pb2  # type: ignore

    resp = ingest_pb2.SignalSource(
        slug="ext_feed",
        source_type="mcp_client",
        extractor_module="app.extractors.mcp_client",
        has_credentials=True,
    )
    with patch.object(client, "set_config", AsyncMock(return_value={"version": "1"})):
        _req, result = await _manage(
            resp,
            operation="register",
            slug="ext_feed",
            source_type="mcp_client",
            extractor_module="app.extractors.mcp_client",
            config_json={"mcp_endpoint": "https://mcp.example.com/mcp", "mcp_tool": "get_signals"},
            bearer_token="t0ken",
        )
    assert result["extractor_module"] == "app.extractors.mcp_client"
    assert not _INSTRUCTION_KEYS & set(result)


async def test_update_of_another_field_does_not_name_instructions_in_the_mask():
    req, _result = await _manage(
        _mediated_proto(), operation="update", slug="whale_alerts", display_name="Whales"
    )
    assert list(req.update_mask.paths) == ["display_name"]
    assert req.source.extraction_instructions == ""


@pytest.mark.parametrize("value", ["X", ""])
async def test_supplied_instructions_are_masked_even_when_empty(value):
    req, _result = await _manage(
        _mediated_proto(),
        operation="update",
        slug="whale_alerts",
        extraction_instructions=value,
    )
    assert list(req.update_mask.paths) == ["extraction_instructions"]
    assert req.source.extraction_instructions == value


async def test_registering_a_mediated_source_sends_the_prose_and_no_extractor_module():
    req, result = await _manage(
        _mediated_proto(),
        operation="register",
        slug="whale_alerts",
        display_name="Whale Alerts",
        source_type="mediated_simple_email",
        config_json={"sender_patterns": ["alerts@example.com"], "subject_patterns": ["*"]},
        extraction_instructions=_PROSE,
    )
    assert req.source.extraction_instructions == _PROSE
    assert req.source.extractor_module == ""
    assert result["extraction_instructions"] == _PROSE


async def test_an_invalid_argument_from_ingest_surfaces_as_a_tool_error():
    err = _rpc_error(
        grpc.StatusCode.INVALID_ARGUMENT,
        "mediated_simple_email source requires non-empty extraction_instructions",
    )
    with (
        patch.object(client, "manage_signal_source", AsyncMock(side_effect=err)),
        pytest.raises(ToolError, match="extraction_instructions"),
    ):
        await _tool_fn(_make_server(), "manage_signal_source")(
            _ctx(ADMIN),
            operation="register",
            slug="no_prose",
            source_type="mediated_simple_email",
        )


# ── instantiate_template ─────────────────────────────────────────────────


async def test_ac9_instantiating_a_mediated_template_inherits_its_instructions():
    stubs, patches = _stubs()
    stubs["signal_source"].InstantiateTemplate = AsyncMock(
        return_value=_mediated_proto(slug="my_snacks", user_id="u-2")
    )
    with patch("app.client.mtls") as mtls:
        mtls.secure_channel.return_value = _channel_cm()
        for p in patches:
            p.start()
        try:
            result = await _tool_fn(_make_server(), "instantiate_template")(
                ctx=_ctx(TRADER),
                kind="signal_source",
                template_id="tpl-robinhood_snacks",
                slug="my_snacks",
            )
        finally:
            for p in patches:
                p.stop()
    assert result["extraction_instructions"] == _PROSE
    assert result["extraction_instructions_is_default"] is False
    assert "extractor_module" not in result


async def test_instantiating_other_kinds_is_unchanged():
    formula, _ = await _run("instantiate_template", kind="formula", template_id="t")
    strategy, _ = await _run(
        "instantiate_template", kind="strategy", template_id="t", strategy_id="mean_reversion_2"
    )
    assert not _INSTRUCTION_KEYS & set(formula) and not _INSTRUCTION_KEYS & set(strategy)
    source, _ = await _run("instantiate_template", kind="signal_source", template_id="t")
    assert source["source_type"] == "mcp_client" and "extractor_module" in source
    assert not _INSTRUCTION_KEYS & set(source)


# ── AC-15: doc parity ────────────────────────────────────────────────────

_DOC_TOOLS = ("list_signal_sources", "manage_signal_source", "instantiate_template")


def _descriptions() -> dict[str, str]:
    server = _make_server()
    return {name: inspect.getdoc(_tool_fn(server, name)) or "" for name in _DOC_TOOLS}


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def test_ac15_every_surface_names_both_fields():
    surfaces = {"prompt": _PROMPT.read_text(), "runbook": _RUNBOOK.read_text(), **_descriptions()}
    for name, text in surfaces.items():
        for field in sorted(_INSTRUCTION_KEYS):
            assert field in text, f"{name} does not mention {field}"


def test_ac15_extractor_module_is_only_asked_for_on_non_mediated_sources():
    assert "extractor_module" not in _PROMPT.read_text()
    for name, text in {"runbook": _RUNBOOK.read_text(), **_descriptions()}.items():
        flat = _flat(text)
        for match in re.finditer("extractor_module", flat):
            window = flat[max(0, match.start() - 200) : match.end() + 200]
            assert "non-mediated" in window, f"{name}: …{window}…"


def test_ac15_a_null_extractor_tool_still_means_there_is_content_to_read():
    doc = _flat(_descriptions()["list_signal_sources"])
    assert "never that there is nothing to extract" in doc


def test_ac15_the_precedence_line_is_in_the_prompt_and_the_usage_patterns():
    assert _PRECEDENCE in _flat(_PROMPT.read_text())
    usage = _RUNBOOK.read_text().split("## Usage Patterns", 1)[1]
    assert _flat(usage).count(_PRECEDENCE) >= 2
