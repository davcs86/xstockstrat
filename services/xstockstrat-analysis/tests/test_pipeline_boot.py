"""Feature 367 boot wiring: the two pools (F-06), gauge registration and scheduler disjointness."""

import inspect
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app import main as app_main
from app.repositories.read_budget import control_pool_reset

APP = Path(__file__).resolve().parent.parent / "app"


@pytest.fixture
def create_pool(monkeypatch):
    mock = AsyncMock(side_effect=lambda *a, **k: object())
    monkeypatch.setattr(app_main.asyncpg, "create_pool", mock)
    return mock


@pytest.mark.parametrize(("flag", "cache"), [("true", 0), ("1", 0), ("false", 100), (None, 100)])
async def test_create_pool_disables_the_statement_cache_under_pgbouncer(
    create_pool, monkeypatch, flag, cache
):
    if flag is None:
        monkeypatch.delenv("DB_PGBOUNCER", raising=False)
    else:
        monkeypatch.setenv("DB_PGBOUNCER", flag)
    await app_main._create_pool("postgres://x", min_size=1, max_size=2)
    assert create_pool.call_args.kwargs["statement_cache_size"] == cache


async def test_control_pool_is_fixed_at_two_and_ignores_db_pool_max(create_pool, monkeypatch):
    monkeypatch.setenv("DB_POOL_MAX", "7")
    monkeypatch.setenv("DB_PGBOUNCER", "true")
    await app_main._create_pools("postgres://x")
    service, control = (c.kwargs for c in create_pool.call_args_list)
    assert (service["min_size"], service["max_size"]) == (1, 7)
    assert (control["min_size"], control["max_size"]) == (0, 2)
    assert control["reset"] is control_pool_reset
    assert service["statement_cache_size"] == control["statement_cache_size"] == 0


def test_pipeline_gauges_are_registered_after_telemetry_init():
    source = inspect.getsource(app_main.serve)
    assert source.index("init_telemetry(") < source.index("register_pipeline_gauges(")


def test_the_job_graph_is_disjoint_from_the_durable_scheduler():
    files = [
        APP / "engine" / "job_graph.py",
        APP / "repositories" / "pipeline_jobs.py",
        *sorted((APP / "jobs").rglob("*.py")),
    ]
    for path in files:
        text = path.read_text()
        assert "job_schedule" not in text and "DurableSchedule" not in text, path.name
