"""Shared sandbox primitives and the two memory gauges (feature 300 Step 1; AC-7, AC-12).

Pure parsers, the once-per-process registry, the setuid snippet parity, the headroom seam, and the
child-side `_HANDOFF` snippet executed against a canned `/proc/self/status`.
"""

import ast
import io
import logging
import os

import pytest

from app import telemetry
from app.services import sandbox
from tests import test_telemetry
from tests.test_sandbox_isolation import _fake_popen

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader

_MIB = 1024 * 1024


def _stat(comm="python", state="S", pgrp=456, starttime=987654):
    after = [state, "1", str(pgrp), str(pgrp), "0", "-1", "4194304", "0", "0", "0", "0"]
    after += ["0", "0", "0", "0", "20", "0", "1", "0", str(starttime)] + ["0"] * 10
    return f"123 ({comm}) " + " ".join(after) + "\n"


def _gauge(reader, name):
    data = reader.get_metrics_data()
    for rm in data.resource_metrics if data else []:
        for sm in rm.scope_metrics:
            for m in sm.metrics:
                if m.name == name:
                    points = list(m.data.data_points)
                    return points[-1].value if points else None
    return None


# ── parsers ─────────────────────────────────────────────────────────────────────────────────────
class TestParseStatus:
    def test_all_three_fields_are_scaled_from_kb(self, proc_status_text):
        text = proc_status_text(vmdata=300 * _MIB, rssanon=80 * _MIB, rssshmem=2 * _MIB)
        assert sandbox._parse_status(text) == {
            "VmData": 300 * _MIB,
            "RssAnon": 80 * _MIB,
            "RssShmem": 2 * _MIB,
        }

    def test_absent_fields_are_absent_not_zero(self, proc_status_text):
        parsed = sandbox._parse_status(proc_status_text(vmdata=10 * _MIB, rssshmem=0))
        assert "RssAnon" not in parsed
        assert parsed["VmData"] == 10 * _MIB

    def test_zombie_status_has_no_memory_fields(self, proc_status_text):
        assert sandbox._parse_status(proc_status_text(state="Z")) == {}


class TestParseStat:
    def test_state_pgrp_and_starttime_indices(self):
        assert sandbox._parse_stat(_stat(pgrp=456, starttime=987654)) == ("S", 456, 987654)

    def test_comm_with_spaces_and_parens_is_split_on_the_last_paren(self):
        assert sandbox._parse_stat(_stat(comm="a b) c")) == ("S", 456, 987654)

    def test_zombie_state_is_reported(self):
        assert sandbox._parse_stat(_stat(state="Z"))[0] == "Z"


class TestParseHandoff:
    def test_accepts_the_canonical_line(self, h1_line):
        assert sandbox._parse_handoff(h1_line(1000, -5, 8388608)) == (1000, -5, 8388608)

    def test_negative_ints_are_accepted_by_the_grammar(self, h1_line):
        assert sandbox._parse_handoff(h1_line(-1, -1, -1)) == (-1, -1, -1)

    @pytest.mark.parametrize(
        "line",
        [
            "",
            "H1 1 2 3",
            "H1 1 2 3 4\n",
            "H1 a 2 3\n",
            "H2 1 2 3\n",
            "H1 1 2 3\nextra",
            "H1 1 2 3\n\n",
            "H1 1 2\n",
            "H1  1 2 3\n",
        ],
    )
    def test_rejects_anything_else(self, line):
        assert sandbox._parse_handoff(line) is None


# ── once-per-process registry and the unobservable ERROR ───────────────────────────────────────
def test_first_time_is_true_once_per_key_and_reset_rearms_all():
    assert sandbox._first_time("a") is True
    assert sandbox._first_time("a") is False
    assert sandbox._first_time("b") is True
    sandbox._reset_once_flags()
    assert sandbox._first_time("a") is True
    assert sandbox._first_time("b") is True


def test_unobservable_logs_one_error_and_sets_the_gauge(caplog, metric_reader, monkeypatch):
    monkeypatch.setattr(telemetry, "_memory_watchdog_observable", None)
    with caplog.at_level(logging.ERROR):
        sandbox._warn_unobservable_once()
        sandbox._warn_unobservable_once()
    errors = [r for r in caplog.records if "cannot observe child" in r.getMessage()]
    assert len(errors) == 1
    assert errors[0].levelno == logging.ERROR
    assert _gauge(metric_reader, "indicators.sandbox.memory_watchdog_observable") == 0


def test_gauge_setters_report_their_value(metric_reader, monkeypatch):
    monkeypatch.setattr(telemetry, "_memory_cap_enforced", None)
    monkeypatch.setattr(telemetry, "_memory_watchdog_observable", None)
    telemetry.set_sandbox_memory_cap_enforced(1)
    telemetry.set_sandbox_memory_watchdog_observable(0)
    assert _gauge(metric_reader, "indicators.sandbox.memory_cap_enforced") == 1
    assert _gauge(metric_reader, "indicators.sandbox.memory_watchdog_observable") == 0


# ── headroom seam and wrapper parity ────────────────────────────────────────────────────────────
def test_child_headroom_is_the_identity_in_production():
    assert sandbox._child_headroom(64 * _MIB) == 64 * _MIB


def test_wrapper_text_is_unchanged_by_the_shared_setuid_snippet(monkeypatch):
    captured = {}
    monkeypatch.setattr("app.services.sandbox.subprocess.Popen", _fake_popen(captured))
    sandbox.execute_formula(
        "result = 1", {}, ["numpy"], timeout_ms=1000, memory_bytes=64 * _MIB, grace_ms=1000
    )
    wrapped = captured["wrapped"]
    setuid_block = (
        "if os.geteuid() == 0:\n    os.setgid(65534)\n    os.setgroups([])\n    os.setuid(65534)\n"
    )
    assert setuid_block in wrapped
    assert sandbox._DROP_UID + "\n" in wrapped
    assert "_cap = min(_baseline + 67108864, 2**63 - 1)" in wrapped
    order = [
        "os.setuid(65534)",
        "import pyseccomp",
        "VmData:",
        "setrlimit(resource.RLIMIT_DATA",
        "json.loads(",
        "_flt.load()",
        "exec(",
    ]
    positions = [wrapped.index(token) for token in order]
    assert positions == sorted(positions)


# ── the child-side handoff snippet ─────────────────────────────────────────────────────────────
def _run_handoff(status_text, open_raises=None):
    """exec the formatted snippet the way the wrapper runs it, with a canned /proc/self/status."""
    import resource

    r, w = os.pipe()

    def fake_open(path, *args, **kwargs):
        if open_raises is not None:
            raise open_raises
        assert path == "/proc/self/status"
        return io.StringIO(status_text)

    namespace = {"os": os, "resource": resource, "open": fake_open}
    try:
        exec(sandbox._HANDOFF.format(fd=w), namespace)  # noqa: S102 - trusted constant under test
        data = os.read(r, 256).decode()
    finally:
        os.close(r)
        try:
            os.close(w)
        except OSError:
            pass  # the snippet already closed it
    return data


class TestHandoffSnippet:
    def test_text_carries_the_newline_escape_and_no_handler(self):
        text = sandbox._HANDOFF.format(fd=7)
        assert "\\n'" in text
        assert not any(isinstance(n, ast.Try) for n in ast.walk(ast.parse(text)))

    def test_writes_one_well_formed_line_with_all_fields(self, proc_status_text):
        text = proc_status_text(vmdata=300 * _MIB, rssanon=80 * _MIB, rssshmem=2 * _MIB)
        parsed = sandbox._parse_handoff(_run_handoff(text))
        assert parsed is not None
        cap, r0, _stack = parsed
        assert r0 == 80 * _MIB + 2 * _MIB - 300 * _MIB
        assert cap == -1 or cap > 0

    def test_missing_rss_lines_still_yield_a_well_formed_line(self, proc_status_text):
        parsed = sandbox._parse_handoff(_run_handoff(proc_status_text(vmdata=300 * _MIB)))
        assert parsed is not None
        assert parsed[1] <= 0

    def test_an_open_failure_propagates_instead_of_being_swallowed(self):
        with pytest.raises(OSError):
            _run_handoff("", open_raises=OSError("no /proc"))
