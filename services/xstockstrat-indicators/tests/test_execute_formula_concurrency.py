"""FR-5 (feature 176) — ExecuteFormula offloads the blocking sandbox subprocess off the
event loop and bounds concurrent spawns by `indicators.sandbox.max_concurrent`.

Mechanical proofs (not a real load test), mirroring the analysis concurrency-teeth test
(`test_analysis_servicer.py::test_cross_user_concurrency_bounded_by_semaphore`, which asserts an
exact peak, not merely an upper bound — an upper bound alone passes vacuously if nothing overlaps):
  - concurrent ExecuteFormula calls run off-loop (wall-clock ≈ one spawn, not the serial sum);
  - the semaphore caps in-flight spawns at exactly the configured bound;
  - the subprocess timeout semantics are preserved end-to-end.

C-13 verdict: the config-double factory below is test infrastructure (not domain data) and the
formula-source strings are single-consumer within this file → both stay inline (no conftest move).
"""

import asyncio
import threading
import time
from unittest.mock import MagicMock

import pytest
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import IndicatorsServicer
from app.services import sandbox
from app.services.sandbox import SandboxResult

pytestmark = pytest.mark.asyncio


def _cfg(max_concurrent: int, timeout_ms: int = 60_000):
    cfg = MagicMock()
    cfg.sandbox_max_concurrent.return_value = max_concurrent
    cfg.sandbox_timeout_ms = timeout_ms
    cfg.sandbox_memory_bytes = 256 * 1024 * 1024
    cfg.sandbox_allowed_imports = []
    return cfg


def _blocking_execute_double(sleep_s: float, tracker: dict, lock: threading.Lock):
    """A synchronous stand-in for sandbox.execute_formula that records peak in-flight
    concurrency while it 'runs' (sleeps). Runs in a worker thread once ExecuteFormula
    offloads via asyncio.to_thread — so the counter is guarded by a threading.Lock."""

    def _fn(**_kwargs):
        with lock:
            tracker["in_flight"] += 1
            tracker["peak"] = max(tracker["peak"], tracker["in_flight"])
        time.sleep(sleep_s)
        with lock:
            tracker["in_flight"] -= 1
        return SandboxResult(
            success=True,
            output={"value": 1.0},
            stdout="",
            stderr="",
            execution_ms=int(sleep_s * 1000),
            memory_used_bytes=0,
            error="",
            exit_reason="success",
        )

    return _fn


def _exec_req():
    return indicators_pb2.ExecuteFormulaRequest(
        formula_source="result = {'value': 1.0}",
    )


async def test_concurrent_formulas_run_off_loop_under_bound(monkeypatch):
    """4 concurrent ExecuteFormula calls, bound=4: they run off the event loop (wall-clock ≈ one
    ~0.2s spawn, not 4×) AND genuinely overlap (peak ≥ 2 — the teeth) while staying ≤ the bound."""
    tracker = {"in_flight": 0, "peak": 0}
    lock = threading.Lock()
    monkeypatch.setattr(sandbox, "execute_formula", _blocking_execute_double(0.2, tracker, lock))

    servicer = IndicatorsServicer(config_watcher=_cfg(max_concurrent=4))

    start = time.perf_counter()
    await asyncio.gather(*[servicer.ExecuteFormula(_exec_req(), MagicMock()) for _ in range(4)])
    elapsed = time.perf_counter() - start

    # Off-loop + concurrent: ~one sleep, not the serial ~0.8s sum.
    assert elapsed < 0.6, f"ExecuteFormula serialized on the loop (elapsed={elapsed:.3f}s)"
    # Teeth: they actually overlapped, but never beyond the configured bound.
    assert 2 <= tracker["peak"] <= 4, tracker["peak"]


async def test_semaphore_gates_at_configured_bound(monkeypatch):
    """bound=2, 4 concurrent calls: peak in-flight spawns is EXACTLY 2 — the semaphore, not the
    thread pool, is what caps concurrency."""
    tracker = {"in_flight": 0, "peak": 0}
    lock = threading.Lock()
    monkeypatch.setattr(sandbox, "execute_formula", _blocking_execute_double(0.2, tracker, lock))

    servicer = IndicatorsServicer(config_watcher=_cfg(max_concurrent=2))

    await asyncio.gather(*[servicer.ExecuteFormula(_exec_req(), MagicMock()) for _ in range(4)])

    assert tracker["peak"] == 2, tracker["peak"]


async def test_timeout_preserved_end_to_end():
    """The subprocess timeout still surfaces as SANDBOX_EXIT_REASON_TIMEOUT after the offload —
    execute_formula still owns the subprocess.run(timeout=…). Uses the REAL sandbox (no double)."""
    servicer = IndicatorsServicer(config_watcher=_cfg(max_concurrent=4))
    req = indicators_pb2.ExecuteFormulaRequest(
        formula_source="while True:\n    pass",
        timeout_ms_override=200,
    )

    resp = await servicer.ExecuteFormula(req, MagicMock())

    assert resp.exit_reason == indicators_pb2.SANDBOX_EXIT_REASON_TIMEOUT
