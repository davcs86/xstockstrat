"""Feature 283: executable parity for `manage_strategy operation='score'` (AC-10).

Hand-written MCP prose drifts from the client and the protos, so the projection is pinned to the
`StrategyScore` descriptor and the operation set is pinned to the `StrategyOperation` enum on every
surface that documents it. Surfaces are located by regex markers, never by line numbers.
"""

import re
from pathlib import Path
from unittest.mock import MagicMock, patch

import grpc
import pytest

from app import client
from tests import test_client  # module import: a bare Test* import would be re-collected here
from tests.test_tools import _make_server

_REPO = Path(__file__).resolve().parents[3]
_RUNBOOK = _REPO / "docs/runbooks/mcp-tools.md"
_SKILL = _REPO / "plugins/strat-lab/skills/backtest/SKILL.md"


def _expected_operations() -> set[str]:
    from gen.analysis.v1 import analysis_pb2  # in-function per AGENT-2

    return {
        name.removeprefix("STRATEGY_OPERATION_").lower()
        for name in analysis_pb2.StrategyOperation.keys()
        if not name.endswith("_UNSPECIFIED")
    } | {"score"}


def _runbook_section() -> str:
    text = _RUNBOOK.read_text()
    m = re.search(r"^### `manage_strategy`$\n(.*?)(?=^### )", text, flags=re.M | re.S)
    assert m, "### `manage_strategy` section not found in mcp-tools.md"
    return m.group(1)


@pytest.mark.asyncio
async def test_score_projection_covers_every_proto_field():
    from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # in-function per AGENT-2

    descriptor = analysis_pb2.StrategyScore.DESCRIPTOR
    # A new optional/message field must be accounted for here: it is omitted when unset.
    assert {f.name for f in descriptor.fields if f.has_presence} == {"origin"}

    resp = analysis_pb2.StrategyScore(
        strategy_id="s",
        overall_score=0.7,
        component_scores={"sharpe": 0.5},
        rating="B",
        evidence_symbols=2,
        evidence_days=756,
        provisional=True,
    )
    call = test_client.TestScoreStrategyClient._FakeCall(resp, grpc.aio.Metadata())
    stub = MagicMock()
    stub.ScoreStrategy = MagicMock(return_value=call)
    with patch("app.client.mtls") as mock_mtls:
        mock_mtls.secure_channel.return_value = test_client._channel_cm()
        with patch.object(analysis_pb2_grpc, "AnalysisServiceStub", return_value=stub):
            result = await client.score_strategy(user_id="u-1", strategy_id="s")

    no_presence = {f.name for f in descriptor.fields if not f.has_presence}
    assert set(result) - {"excluded_symbols"} == no_presence


def test_operation_sets_match_the_enum_on_every_surface():
    expected = _expected_operations()

    description = _make_server()._tool_manager.get_tool("manage_strategy").description
    lines = [ln.strip().lstrip('"') for ln in description.strip().splitlines()]
    summary = re.match(r"^(.+?) a stored strategy", lines[0])
    assert summary, lines[0]
    assert {t.strip().lower() for t in summary.group(1).split("/")} == expected
    op_line = next(ln for ln in lines if ln.startswith("operation:"))
    assert set(re.findall(r"'([a-z_]+)'", op_line)) == expected

    row = re.search(r"^\| `operation` \|.*$", _runbook_section(), flags=re.M)
    assert row, "`operation` parameter row missing from the manage_strategy runbook section"
    assert set(re.findall(r'"([a-z_]+)"', row.group(0))) == expected

    canonical = re.search(r"`manage_strategy` operations: (.+)$", _SKILL.read_text(), flags=re.M)
    assert canonical, "canonical `manage_strategy` operations line missing from SKILL.md"
    assert set(re.findall(r"`([a-z_]+)`", canonical.group(1))) == expected


@pytest.mark.parametrize("surface", ["runbook", "skill"])
def test_score_side_effects_are_documented_on_runbook_and_skill(surface):
    """AC-10: both surfaces state the persist, the ledger event and the ignored time range."""
    text = _runbook_section() if surface == "runbook" else _SKILL.read_text()
    flat = " ".join(text.split())
    assert "analysis.strategy.scored" in flat
    assert re.search(r"\bpersists\b", flat)
    assert re.search(r"range[^.]*\bignored\b|\bignores\b[^.]*range", flat)
