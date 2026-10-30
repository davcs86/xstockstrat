"""Runs checks sequentially in-process, one run at a time, and keeps the last runs in memory."""

import asyncio
import json
import math
import pathlib
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.check_api import CheckContext, CheckFailure
from app.evidence import sanitize

RUN_LOCK_HOLD_S = 900
RUN_BUFFER_SIZE = 50
TRIGGER_BY_SAN = {"xstockstrat-agent": "agent", "xstockstrat-smoke-trigger": "post-deploy"}


class RunInProgress(Exception):
    def __init__(self, retry_after_s: int):
        super().__init__(f"run in progress; retry after {retry_after_s}s")
        self.retry_after_s = retry_after_s


class UnknownChecks(Exception):
    def __init__(self, unknown: list[str]):
        super().__init__(f"unknown checks: {unknown}")
        self.unknown = unknown


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run_file_path(env: str, started_at: datetime, run_id: str) -> str:
    return f"smoke-results/{env}/{started_at:%Y%m%dT%H%M%SZ}-{run_id}.json"


@dataclass
class _Run:
    run_id: str
    ids: list[str]
    started_at: datetime
    triggered_by: str
    deadline: float
    records: list[dict] = field(default_factory=list)
    status: str = "running"
    task: asyncio.Task | None = None


class Runner:
    def __init__(self, *, catalog, rpc_factory, db, env, deployed_sha, hold_s=RUN_LOCK_HOLD_S):
        self.catalog = catalog
        self._rpc_factory = rpc_factory
        self._db = db
        self._env = env
        self._deployed_sha = deployed_sha
        self._hold_s = hold_s
        self._runs: OrderedDict[str, _Run] = OrderedDict()
        self._active: _Run | None = None

    async def start(self, ids: list[str], *, triggered_by: str) -> str:
        unknown = [i for i in ids if i not in self.catalog.checks]
        if unknown:
            raise UnknownChecks(unknown)
        loop = asyncio.get_running_loop()
        active = self._active
        if active is not None and active.status == "running" and loop.time() < active.deadline:
            wait = math.ceil(active.deadline - loop.time())
            raise RunInProgress(max(1, min(wait, math.ceil(self._hold_s))))
        run = _Run(
            run_id=uuid.uuid4().hex,
            ids=list(ids),
            started_at=datetime.now(UTC),
            triggered_by=triggered_by,
            deadline=loop.time() + self._hold_s,
        )
        self._runs[run.run_id] = run
        while len(self._runs) > RUN_BUFFER_SIZE:
            self._runs.popitem(last=False)
        self._active = run
        run.task = asyncio.create_task(self._execute(run), name=f"smoke-run-{run.run_id}")
        return run.run_id

    def get(self, run_id: str) -> dict | None:
        run = self._runs.get(run_id)
        if run is None:
            return None
        out = {"status": run.status, "records": list(run.records)}
        if run.status == "done":
            out["file"] = {"path": self._path(run), "body": self._body(run, run.records)}
        return out

    def write_stall_file(self, out_dir) -> pathlib.Path | None:
        """Called from the watchdog thread while the loop is blocked: the active run's remaining
        checks become ERROR and the run file is written under out_dir."""
        run = self._active
        if run is None or run.status != "running":
            return None
        now = _iso(datetime.now(UTC))
        records = list(run.records) + [
            self._record(
                self.catalog.checks[cid], "ERROR", now, 0, [], {"error": "event loop stalled"}
            )
            for cid in run.ids[len(run.records) :]
        ]
        path = pathlib.Path(out_dir) / self._path(run)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self._body(run, records), indent=2))
        return path

    def _path(self, run: _Run) -> str:
        return run_file_path(self._env, run.started_at, run.run_id)

    def _body(self, run: _Run, records: list[dict]) -> dict:
        return {
            "schema_version": 2,
            "run_id": run.run_id,
            "env": self._env,
            "deployed_sha": self._deployed_sha,
            "started_at": _iso(run.started_at),
            "trigger": TRIGGER_BY_SAN.get(run.triggered_by, "api"),
            "triggered_by": run.triggered_by,
            "records": list(records),
        }

    @classmethod
    def _record(cls, check, outcome, started_at, duration_ms, rpcs, evidence, **kw) -> dict:
        evidence = sanitize(evidence)
        return cls._raw_record(check, outcome, started_at, duration_ms, rpcs, evidence, **kw)

    @staticmethod
    def _raw_record(
        check, outcome, started_at, duration_ms, rpcs, evidence, *, writes=(), cleanup="NONE"
    ) -> dict:
        return {
            "check_id": check.id,
            "check_hash": check.check_hash,
            "feature": check.feature,
            "part": check.part,
            "outcome": outcome,
            "started_at": started_at,
            "duration_ms": duration_ms,
            "rpcs_invoked": rpcs,
            "writes_performed": list(writes),
            "cleanup": cleanup,
            "evidence": evidence,
        }

    async def _execute(self, run: _Run) -> None:
        loop = asyncio.get_running_loop()
        try:
            for cid in run.ids:
                check = self.catalog.checks[cid]
                started_at = _iso(datetime.now(UTC))
                try:
                    remaining = run.deadline - loop.time()
                    if remaining <= 0:
                        rec = self._record(
                            check, "TIMEOUT", started_at, 0, [], {"error": "run hold exceeded"}
                        )
                    else:
                        rec = await self._run_one(run, check, remaining)
                except Exception as e:  # noqa: BLE001 — every check must leave exactly one record
                    error = {"error": f"record build failed: {type(e).__name__}"}
                    rec = self._raw_record(check, "ERROR", started_at, 0, [], error)
                run.records.append(rec)
        finally:
            run.status = "done"

    async def _run_one(self, run: _Run, check, remaining: float) -> dict:
        hold_bound = remaining < check.timeout_s
        rpc = self._rpc_factory(run.run_id)
        ctx = CheckContext(db=self._db, rpc=rpc, run_id=run.run_id)
        started_at = _iso(datetime.now(UTC))
        t0 = time.monotonic()
        system: dict = {}
        timer = asyncio.timeout(min(check.timeout_s, remaining))
        outcome = "PASS"
        stage = "janitor"
        try:
            async with timer:
                if check.janitor is not None:
                    await check.janitor(ctx)
                stage = "body"
                await check.run(ctx)
        except CheckFailure as e:
            outcome, system["failure"] = "FAIL", str(e)
        except Exception as e:  # noqa: BLE001 — any check error is an ERROR record
            prefix = "janitor: " if stage == "janitor" else ""
            outcome, system["error"] = "ERROR", f"{prefix}{type(e).__name__}: {e}"
            if getattr(e, "sqlstate", None):
                system["sqlstate"] = e.sqlstate
        if timer.expired():
            outcome = "TIMEOUT"
            system = {"error": "run hold exceeded" if hold_bound else "check timeout exceeded"}
        try:
            cleanup, cleanup_error = await self._cleanup(run, ctx)
        finally:
            try:
                await rpc.close()
            except Exception:  # noqa: BLE001 — a close failure must not change the outcome
                pass
        if cleanup == "FAILED":
            system["original_outcome"], outcome = outcome, "ERROR"
            system["cleanup_error"] = cleanup_error
        evidence = dict(system)
        for key, value in ctx.evidence_items.items():
            evidence.setdefault(key, value)
        duration_ms = int((time.monotonic() - t0) * 1000)
        return self._record(
            check,
            outcome,
            started_at,
            duration_ms,
            list(rpc.invoked),
            evidence,
            writes=list(getattr(rpc, "writes", [])),
            cleanup=cleanup,
        )

    @staticmethod
    async def _cleanup(run: _Run, ctx) -> tuple[str, str | None]:
        if not ctx.cleanups:
            return "NONE", None
        loop = asyncio.get_running_loop()
        # The lock stays held through cleanup: grace = the sum of the cleanup deadlines.
        grace = sum(deadline for _, deadline in ctx.cleanups)
        run.deadline = max(run.deadline, loop.time() + grace)
        errors = []
        for fn, deadline in reversed(ctx.cleanups):
            try:
                async with asyncio.timeout(deadline):
                    await fn()
            except Exception as e:  # noqa: BLE001 — every cleanup runs; failures are collected
                errors.append(f"{type(e).__name__}: {e}")
        return ("FAILED", "; ".join(errors)) if errors else ("OK", None)
