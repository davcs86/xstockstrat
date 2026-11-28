"""Feature 367 engine primitives: lanes, outcomes, classifier, backoff, registry, wait-on checks."""

from datetime import date
from types import SimpleNamespace

import asyncpg
import pytest

from app.engine.job_graph import (
    MAX_CHILDREN_PER_PARK,
    MAX_PARK_ROUNDS,
    PRUNE_KIND,
    PRUNE_LANE,
    PRUNE_SUBJECT,
    AttemptStopped,
    Child,
    HandlerRegistry,
    Lane,
    PermanentJobError,
    Succeeded,
    Verdict,
    WaitOn,
    backoff_seconds,
    check_outcome,
    classify,
    prune_epoch,
    prune_run_id,
    truncate_error,
    validate_verdict,
    validate_wait_on,
)
from app.repositories.read_budget import DbBudgetExceeded


async def _noop(job):
    return Succeeded()


def _parent(kind="parent", subject="AAPL", epoch="2026-11-27", wait_round=0):
    return SimpleNamespace(kind=kind, subject=subject, epoch=epoch, wait_round=wait_round)


def _registry():
    reg = HandlerRegistry()
    reg.register("parent", _noop, child_kinds=("child",))
    reg.register("child", _noop)
    reg.validate()
    return reg


def test_lane_values_and_labels():
    assert (int(Lane.WATCHLIST), int(Lane.HELD)) == (10, 20)
    assert [m.name.lower() for m in Lane] == ["watchlist", "held"]


def test_ac5_backoff_is_at_least_five_seconds_with_at_most_twenty_percent_jitter():
    assert backoff_seconds(1, rand=lambda: 0.0) >= 5
    assert backoff_seconds(1, rand=lambda: 1.0) <= 6
    bases = [backoff_seconds(n, rand=lambda: 0.0) for n in range(1, 9)]
    assert bases == [5, 10, 20, 40, 80, 160, 300, 300]
    assert backoff_seconds(8, rand=lambda: 1.0) == pytest.approx(360)


def test_ac6_permanent_job_error_and_its_subclasses_classify_permanent():
    class Bad(PermanentJobError):
        pass

    assert classify(PermanentJobError("x")) == "permanent"
    assert classify(Bad("y")) == "permanent"


@pytest.mark.parametrize(
    "exc",
    [
        RuntimeError("r"),
        OSError("o"),
        asyncpg.PostgresError("p"),
        ValueError("v"),
        TimeoutError("t"),
        DbBudgetExceeded("d"),
    ],
)
def test_ac7_every_other_exception_classifies_transient(exc):
    assert classify(exc) == "transient"


def test_attempt_stopped_is_not_an_exception():
    assert issubclass(AttemptStopped, BaseException)
    assert not issubclass(AttemptStopped, Exception)


def test_a_non_outcome_return_is_a_permanent_failure():
    for outcome in (Succeeded(), WaitOn((Child("child", "A", "e"),)), Verdict("v")):
        assert check_outcome(outcome) is outcome
    for value in (None, 42, "succeeded", Succeeded):
        with pytest.raises(PermanentJobError) as ei:
            check_outcome(value)
        assert classify(ei.value) == "permanent"


def test_registry_accepts_a_dag():
    reg = _registry()
    assert reg.kinds() == ("child", "parent")
    assert reg.get("parent") is _noop and reg.child_kinds("parent") == ("child",)


@pytest.mark.parametrize(
    "edges",
    [
        {"a": ("b",), "b": ("a",)},
        {"a": ("a",)},
        {"a": ("ghost",)},
        {"a": ("b",), "b": ("c",), "c": ("a",)},
    ],
)
def test_registry_rejects_cycles_self_edges_and_unregistered_children(edges):
    reg = HandlerRegistry()
    for kind, children in edges.items():
        reg.register(kind, _noop, child_kinds=children)
    with pytest.raises(ValueError):
        reg.validate()


def test_validate_wait_on_dedups_sorts_and_keeps_the_higher_lane():
    children = [
        Child("child", "B", "e"),
        Child("child", "A", "e", Lane.WATCHLIST),
        Child("child", "A", "e", Lane.HELD),
        Child("child", "B", "e"),
    ]
    assert validate_wait_on(_parent(), children, _registry()) == (
        Child("child", "A", "e", Lane.HELD),
        Child("child", "B", "e"),
    )


@pytest.mark.parametrize(
    ("parent", "children", "names"),
    [
        (_parent(), [], "at least 1"),
        (
            _parent(),
            [Child("child", f"S{n}", "e") for n in range(MAX_CHILDREN_PER_PARK + 1)],
            "at most 10000",
        ),
        (_parent(), [Child("parent", "AAPL", "2026-11-27")], "own key"),
        (_parent(), [Child("other", "X", "e")], "not declared"),
        (_parent(wait_round=MAX_PARK_ROUNDS), [Child("child", "X", "e")], "rounds"),
    ],
)
def test_validate_wait_on_failures_are_permanent_and_name_the_check(parent, children, names):
    with pytest.raises(PermanentJobError, match=names):
        validate_wait_on(parent, children, _registry())


def test_empty_verdict_label_is_permanent():
    assert validate_verdict("no_vendor_data") == "no_vendor_data"
    with pytest.raises(PermanentJobError, match="verdict"):
        validate_verdict("")


def test_truncate_error_cuts_on_a_character_boundary():
    text = "é" * 600 + "x" * 900
    out = truncate_error(text)
    raw = out.encode("utf-8")
    assert len(raw) <= 1024 and raw.decode("utf-8") == out and out.startswith("é")
    assert truncate_error("short") == "short"


def test_prune_identity():
    day = date(2026, 11, 27)
    assert (PRUNE_KIND, PRUNE_SUBJECT, PRUNE_LANE) == (
        "pipeline.retention_prune",
        "global",
        Lane.WATCHLIST,
    )
    assert (prune_epoch(day), prune_run_id(day)) == ("2026-11-27", "retention_prune:2026-11-27")
