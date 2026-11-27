"""Feature 367: the pipeline job graph settings reader (six `analysis.pipeline.*` keys)."""

import logging
import re
from pathlib import Path

import pytest
from gen.config.v1 import config_pb2

from app.engine.job_graph import JobGraphSettings
from tests.conftest import snapshot_watcher

_SEED_DIR = Path(__file__).resolve().parents[2] / "xstockstrat-config" / "migrations"
_SEED_ROW = re.compile(
    r"\('analysis', '(pipeline\.[a-z_]+)', '(bool|int)', '([0-9a-z]+)',\s*'(?:[^']|'')*',"
    r"\s*'[0-9a-z]+', 'xstockstrat-analysis', '[^']+', '([a-z]+)', NULL\)"
)

_INT_GETTERS = {
    "pipeline.worker_concurrency": ("worker_concurrency", 4),
    "pipeline.poll_interval_ms": ("poll_interval_ms", 1000),
    "pipeline.lease_seconds": ("lease_seconds", 60),
    "pipeline.max_attempts": ("max_attempts", 5),
    "pipeline.retention_days": ("retention_days", 7),
}


def _settings(**values):
    return JobGraphSettings(snapshot_watcher(**values))


def test_unset_keys_read_the_code_defaults():
    s = _settings()
    assert s.worker_enabled() is True
    assert (
        s.worker_concurrency(),
        s.poll_interval_ms(),
        s.lease_seconds(),
        s.max_attempts(),
        s.retention_days(),
    ) == (4, 1000, 60, 5, 7)


def test_ac14_stored_false_disables_the_worker():
    assert _settings(**{"pipeline.worker_enabled": False}).worker_enabled() is False


@pytest.mark.parametrize("key", sorted(_INT_GETTERS))
@pytest.mark.parametrize("stored", [0, -3])
def test_stored_zero_or_negative_reads_as_the_default(key, stored):
    getter, default = _INT_GETTERS[key]
    assert getattr(_settings(**{key: stored}), getter)() == default


@pytest.mark.parametrize(
    ("key", "stored", "used"),
    [
        ("pipeline.lease_seconds", 10, 45),
        ("pipeline.lease_seconds", 601, 600),
        ("pipeline.worker_concurrency", 64, 16),
        ("pipeline.poll_interval_ms", 100, 200),
        ("pipeline.poll_interval_ms", 9000, 5000),
        ("pipeline.max_attempts", 1, 2),
        ("pipeline.max_attempts", 21, 20),
        ("pipeline.retention_days", 91, 90),
    ],
)
def test_out_of_bounds_values_are_clamped(key, stored, used):
    getter, _ = _INT_GETTERS[key]
    assert getattr(_settings(**{key: stored}), getter)() == used


def test_clamp_warns_once_per_distinct_stored_value(caplog):
    w = snapshot_watcher(**{"pipeline.lease_seconds": 10})
    s = JobGraphSettings(w)
    with caplog.at_level(logging.WARNING, logger="app.engine.job_graph"):
        s.lease_seconds()
        s.lease_seconds()
        warns = [r for r in caplog.records if "analysis.pipeline.lease_seconds" in r.getMessage()]
        assert len(warns) == 1
        w._snapshot.values["pipeline.lease_seconds"].int_val = 700
        assert s.lease_seconds() == 600
        warns = [r for r in caplog.records if "analysis.pipeline.lease_seconds" in r.getMessage()]
        assert len(warns) == 2
        assert "700" in warns[1].getMessage() and "600" in warns[1].getMessage()


def test_reads_are_fresh_per_call():
    w = snapshot_watcher(**{"pipeline.worker_concurrency": 2})
    s = JobGraphSettings(w)
    assert s.worker_concurrency() == 2
    w._snapshot.values["pipeline.worker_concurrency"].int_val = 8
    assert s.worker_concurrency() == 8


def test_on_change_delegates_to_the_watcher():
    w = snapshot_watcher()
    w._apply(config_pb2.ConfigSnapshot(namespace="analysis", version="v1"))
    calls = []
    JobGraphSettings(w).on_change(calls.append)
    w._apply(config_pb2.ConfigSnapshot(namespace="analysis", version="v2"))
    assert len(calls) == 1


def _seeded_rows():
    files = sorted(_SEED_DIR.glob("*_analysis_pipeline_keys.up.sql"))
    assert len(files) == 1, files
    rows = _SEED_ROW.findall(files[0].read_text())
    assert len(rows) == 12
    return rows


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_seed_values_are_what_the_reader_returns(environment):
    seeded = {
        key: (value == "true") if typ == "bool" else int(value)
        for key, typ, value, env in _seeded_rows()
        if env == environment
    }
    assert set(seeded) == {"pipeline.worker_enabled", *_INT_GETTERS}
    s = _settings(**seeded)
    assert s.worker_enabled() is seeded["pipeline.worker_enabled"]
    for key, (getter, default) in _INT_GETTERS.items():
        assert getattr(s, getter)() == seeded[key] == default
