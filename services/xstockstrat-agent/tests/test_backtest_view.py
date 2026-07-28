"""Unit tests for `app.backtest_view` — the feature-072 presentation split.

Pure projection tests: no gRPC, no FastMCP server. The tool-layer wiring is covered in
`test_tools.py`.
"""

import json

from app.backtest_view import (
    _HEAD_KEYS,
    _INTENTIONALLY_DROPPED,
    _METRIC_KEYS,
    _SYMBOL_KEYS,
    attachment_refs,
    build_blocks,
    summarize,
)

# The sentinel must appear ONLY in the attachment. If it ever leaks into the summary these tests
# stop proving which half a consumer read (ledger insights 2026-07-27 — the echoing-fixture trap).
_SENTINEL = "sentinel_only_in_attachment"


def _full_result(symbols: int = 1, bars: int = 50) -> dict:
    """A realistic `client.run_backtest`-shaped dict.

    Four properties this fixture must keep:

    1. **Non-echoing** — per-bar rows carry `_SENTINEL` and `close: 111.111`, values that appear
       nowhere in the FR-2 summary key set, so a test cannot pass by reading the wrong half.
    2. **Exactly ONE `coverage_gaps` entry, fixed, independent of `symbols`.** Gaps are per-symbol
       on OK runs too, so a factory that scaled them would push the marginal-cost assertion in
       `test_summary_grows_linearly_in_symbol_count` past its slope and go red for the wrong reason.
       One gap keeps it inside the cancelling fixed part.
    3. **`profit_factor` is finite** (`1.8`) — the producer clamps to `1.0`/`999.0` and never emits
       `Infinity`, so no fixture may pretend otherwise.
    4. **`volume` is the string `"51234567"`, `bar_index` an `int`** — `MessageToDict` maps int64 to
       a JSON string while int32 stays a number, and conflating the two is what makes a flat format
       unable to round-trip.
    """
    return {
        "backtest_id": "bt-abc123",
        "strategy_id": "sma_crossover",
        "status": "BACKTEST_STATUS_OK",
        "completed_at": "2026-07-27T00:00:00Z",
        "total_return": 0.15,
        "annualized_return": 0.22,
        "sharpe_ratio": 1.2,
        "max_drawdown": 0.08,
        "win_rate": 0.55,
        "total_trades": 42,
        "profit_factor": 1.8,
        "initial_capital": 100000.0,
        "trades": [{"symbol": "AAPL", "side": "long", "pnl": 680.0}],
        # Exactly one, regardless of `symbols` — see property 2.
        "coverage_gaps": [
            {
                "symbol": "AAPL",
                "timeframe": "TIMEFRAME_1DAY",
                "bars_have": "120",
                "bars_need": "504",
            }
        ],
        "diagnostics": [
            {
                "symbol": f"SYM{s}",
                "bars_total": bars,
                "warmup_bars": 20,
                "no_trade_reason": "NO_TRADE_REASON_ENTRY_NEVER_TRUE",
                "bars": [
                    {
                        "symbol": f"SYM{s}",
                        "bar_index": i,
                        "close": 111.111,
                        "volume": "51234567",
                        "indicators": {_SENTINEL: 42.0},
                    }
                    for i in range(bars)
                ],
            }
            for s in range(symbols)
        ],
    }


def _dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))


# ── summarize ──────────────────────────────────────────────────────────────


def test_summary_keeps_every_fr2_field():
    s = summarize(_full_result())
    for key in _HEAD_KEYS + _METRIC_KEYS:
        assert key in s, f"FR-2 field {key} dropped from the summary"
    assert "coverage_gaps" in s


def test_summary_keeps_zero_valued_metrics():
    """The feature-064 '0 trades / 0% return' case — the exact reason
    `always_print_fields_with_no_presence=True` exists. A truthy guard would delete both."""
    result = _full_result() | {"total_return": 0.0, "total_trades": 0}
    s = summarize(result)
    assert s["total_return"] == 0.0
    assert s["total_trades"] == 0


def test_summary_drops_per_bar_bars_but_keeps_the_diagnosis():
    """AC-3 — the 0-trade diagnosis survives inline, the per-bar array does not."""
    s = summarize(_full_result(symbols=2))
    assert len(s["diagnostics"]) == 2
    for entry in s["diagnostics"]:
        for key in _SYMBOL_KEYS:
            assert key in entry
        assert "bars" not in entry


def test_summary_is_independent_of_window_length():
    """AC-1, first half. NOT byte-identity: `bars_total` tracks bar count by definition, so
    demanding equality could only be met by pinning it — the inert-fixture trap."""
    a = summarize(_full_result(bars=50))
    b = summarize(_full_result(bars=5000))

    a_totals = [d.pop("bars_total") for d in a["diagnostics"]]
    b_totals = [d.pop("bars_total") for d in b["diagnostics"]]

    assert a == b  # (a) equal once the bar-count-tracking field is removed
    assert a_totals == [50] and b_totals == [5000]  # (b) the fixture is live, not inert
    # (c) digit-width growth only — nothing that scales with bar count
    assert abs(len(_dumps(a)) - len(_dumps(b))) < 16


def test_summary_grows_linearly_in_symbol_count():
    """AC-1, second half — assert the slope, not the intercept."""
    s1 = _dumps(summarize(_full_result(symbols=1)))
    s10 = _dumps(summarize(_full_result(symbols=10)))
    assert len(s10) - len(s1) < 9 * 250  # (a) marginal cost per added symbol
    assert len(s10) < 8_000  # (b) loose catch-all on the fixed part


def test_summary_preserves_the_serializer_string_mapping():
    """The reachable in-summary instance of the contract that decided the format: `int64` renders
    as a JSON string, `int32` as a number. Conflating them is what CSV could not survive."""
    s = summarize(_full_result())
    gap = s["coverage_gaps"][0]
    assert gap["bars_have"] == "120" and isinstance(gap["bars_have"], str)
    assert gap["bars_need"] == "504" and isinstance(gap["bars_need"], str)
    assert isinstance(s["total_trades"], int)  # int32 → number, not "42"


def test_summarize_tolerates_a_partial_dict():
    """Protects the feature-071 window tests, which mock `client.run_backtest` with only an id."""
    assert summarize({"backtest_id": "bt-2"}) == {"backtest_id": "bt-2"}


def test_summary_key_set_covers_every_proto_field():
    """C-10 guard against silent field loss.

    `summarize` is an allowlist over a contractually additive-only message that has already gained
    fields 13/14/15. A field 16 would vanish silently — and on an INSUFFICIENT_DATA run, where there
    is no attachment, it would never reach the caller at all. The union must include the dropped
    set: bare equality against `fields_by_name` is red by construction, since `trades` is dropped
    on purpose.
    """
    from gen.analysis.v1 import analysis_pb2  # in-function per AGENT-2 — the module stays pure

    kept = set(_HEAD_KEYS) | set(_METRIC_KEYS) | {"coverage_gaps", "diagnostics"}
    assert kept | set(_INTENTIONALLY_DROPPED) == set(
        analysis_pb2.BacktestResult.DESCRIPTOR.fields_by_name
    )
    assert set(_SYMBOL_KEYS) | {"bars"} == set(
        analysis_pb2.SymbolDiagnostics.DESCRIPTOR.fields_by_name
    )


# ── build_blocks / attachment_refs ─────────────────────────────────────────


def test_attachment_round_trips_to_the_complete_result():
    """AC-2 / FR-3 — the attachment IS the result, so fidelity holds by construction."""
    full = _full_result(symbols=2)
    block = build_blocks(full)[0]
    assert json.loads(block.resource.text) == full
    # Non-echoing proof: the sentinel is in the attachment and nowhere in the summary.
    assert _SENTINEL in block.resource.text
    assert _SENTINEL not in _dumps(summarize(full))


def test_attachment_block_shape():
    block = build_blocks(_full_result())[0]
    assert len(build_blocks(_full_result())) == 1
    assert block.type == "resource"
    assert block.resource.mimeType == "application/json"
    assert str(block.resource.uri).startswith("xstockstrat:///backtest/")
    assert "bt-abc123" in str(block.resource.uri)
    assert block.annotations.audience == ["user"]
    assert block.annotations.priority == 0.1


def test_no_attachment_when_there_is_no_detail():
    """AC-4 — an INSUFFICIENT_DATA run reports itself entirely inline. Note the rule is about
    *content*, not status: nothing here branches on the status string."""
    result = {
        "backtest_id": "bt-empty",
        "status": "BACKTEST_STATUS_INSUFFICIENT_DATA",
        "trades": [],
        "diagnostics": [],
        "coverage_gaps": [{"symbol": "AAPL", "bars_have": "3", "bars_need": "52"}],
    }
    assert build_blocks(result) == []
    assert summarize(result)["coverage_gaps"] == result["coverage_gaps"]


def test_attachment_refs_describe_each_block():
    blocks = build_blocks(_full_result())
    refs = attachment_refs(blocks)
    assert len(refs) == 1
    assert refs[0]["mime_type"] == "application/json"
    assert refs[0]["uri"].startswith("xstockstrat:///backtest/")
    assert attachment_refs([]) == []
