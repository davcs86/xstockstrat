"""Pipeline job graph (feature 367): settings, engine primitives and the worker runtime."""

import asyncio
import logging
import random
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import IntEnum
from typing import NamedTuple

from app import supervision
from app.config.live_limits import ResizableLimiter
from app.config.watcher import int_positive
from app.repositories.pipeline_jobs import ParkRace
from app.repositories.read_budget import bounded_txn

log = logging.getLogger(__name__)

# Fixed invariants (design.md § Build order), not config keys.
MAX_PARK_ROUNDS = 8
MAX_CHILDREN_PER_PARK = 10_000
BACKOFF_BASE_S = 5
BACKOFF_CAP_S = 300
BACKOFF_JITTER = 0.2
ERROR_MAX_BYTES = 1024
HEARTBEAT_PERIOD_S = 7.5
MAINTENANCE_PERIOD_S = 5.0
SELF_FENCE_MARGIN_S = 3.0
TOLERATED_LAG_S = 2.0
ATTEMPT_DEADLINE_S = 900.0
STOP_GRACE_S = 10.0
REPORT_GIVE_UP_S = 300.0
REPORT_RETRY_MIN_S = 1.0
REPORT_RETRY_MAX_S = 30.0
SETTLE_MAX_BATCHES = 20
SETTLE_MAX_S = 8.0
STATS_EVERY_TICKS = 3
IDLE_CLAIM_CEILING_S = 5.0
RUNNER_BATCH_WAIT_S = 6.0
CLAIM_ACK_WINDOW_S = 7.0
HANDLER_BLOCK_CAP_S = 30.0


class Lane(IntEnum):
    WATCHLIST = 10
    HELD = 20


PRUNE_KIND = "pipeline.retention_prune"
PRUNE_SUBJECT = "global"
PRUNE_LANE = Lane.WATCHLIST


def prune_epoch(day: date) -> str:
    return day.isoformat()


def prune_run_id(day: date) -> str:
    return f"retention_prune:{day.isoformat()}"


class Child(NamedTuple):
    kind: str
    subject: str
    epoch: str
    lane: Lane | None = None


@dataclass(frozen=True)
class Succeeded:
    pass


@dataclass(frozen=True)
class WaitOn:
    children: tuple[Child, ...]


@dataclass(frozen=True)
class Verdict:
    label: str


class PermanentJobError(Exception):
    """The only permanent failure: the job ends `failed` and is never retried."""


class AttemptStopped(BaseException):
    """Raised into a stopped attempt; a BaseException, so `except Exception` cannot swallow it."""


def classify(exc: BaseException) -> str:
    return "permanent" if isinstance(exc, PermanentJobError) else "transient"


def check_outcome(value):
    if isinstance(value, Succeeded | WaitOn | Verdict):
        return value
    raise PermanentJobError(f"handler returned a non-outcome: {type(value).__name__}")


def backoff_seconds(attempt: int, *, rand=random.random) -> float:
    base = min(BACKOFF_BASE_S * 2 ** max(attempt - 1, 0), BACKOFF_CAP_S)
    return base * (1 + BACKOFF_JITTER * rand())


def truncate_error(text: str) -> str:
    return text.encode("utf-8")[:ERROR_MAX_BYTES].decode("utf-8", errors="ignore")


class HandlerRegistry:
    def __init__(self):
        self._handlers: dict[str, object] = {}
        self._children: dict[str, tuple[str, ...]] = {}

    def register(self, kind: str, handler, *, child_kinds=()) -> None:
        self._handlers[kind] = handler
        self._children[kind] = tuple(child_kinds)

    def kinds(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers))

    def get(self, kind: str):
        return self._handlers.get(kind)

    def child_kinds(self, kind: str) -> tuple[str, ...]:
        return self._children.get(kind, ())

    def validate(self) -> None:
        """Raise at boot on an unregistered child kind or a cycle (a self-edge included)."""
        for kind, children in self._children.items():
            for child in children:
                if child not in self._handlers:
                    raise ValueError(f"kind {kind!r} declares unregistered child kind {child!r}")
        done: set[str] = set()

        def visit(kind: str, path: tuple[str, ...]) -> None:
            if kind in path:
                raise ValueError(f"cyclic kind graph: {' -> '.join((*path, kind))}")
            if kind in done:
                return
            for child in self._children[kind]:
                visit(child, (*path, kind))
            done.add(kind)

        for kind in sorted(self._children):
            visit(kind, ())


def validate_wait_on(parent, children, registry: HandlerRegistry) -> tuple[Child, ...]:
    """Deduplicate and sort a WaitOn's children, or raise PermanentJobError naming the check."""
    if parent.wait_round >= MAX_PARK_ROUNDS:
        raise PermanentJobError(f"wait_on: already parked {MAX_PARK_ROUNDS} rounds")
    by_key: dict[tuple[str, str, str], Lane | None] = {}
    for c in children:
        key = (c.kind, c.subject, c.epoch)
        lane = None if c.lane is None else Lane(c.lane)
        prev = by_key.get(key)
        by_key[key] = lane if prev is None or (lane is not None and lane > prev) else prev
    if not by_key:
        raise PermanentJobError("wait_on: needs at least 1 child")
    if len(by_key) > MAX_CHILDREN_PER_PARK:
        raise PermanentJobError(f"wait_on: at most {MAX_CHILDREN_PER_PARK} children per park")
    if (parent.kind, parent.subject, parent.epoch) in by_key:
        raise PermanentJobError("wait_on: a job cannot wait on its own key")
    allowed = registry.child_kinds(parent.kind)
    for kind, _, _ in by_key:
        if kind not in allowed:
            raise PermanentJobError(f"wait_on: child kind {kind!r} not declared by {parent.kind!r}")
    return tuple(Child(k, s, e, lane) for (k, s, e), lane in sorted(by_key.items()))


def validate_verdict(label: str) -> str:
    if not label:
        raise PermanentJobError("verdict: the label must not be empty")
    return label


class JobGraphSettings:
    """Reads the six `analysis.pipeline.*` keys fresh at each use (PLAT-6)."""

    def __init__(self, config_watcher):
        self._cfg = config_watcher
        self._warned: dict[str, int] = {}

    def _clamped(self, key: str, value: int, lo: int, hi: int) -> int:
        used = min(max(value, lo), hi)
        if used != value and self._warned.get(key) != value:
            self._warned[key] = value
            log.warning(
                "config value analysis.%s=%d outside [%d, %d]; using %d", key, value, lo, hi, used
            )
        return used

    def worker_enabled(self) -> bool:
        return self._cfg.get_bool("pipeline.worker_enabled", default=True)

    # Bounds mirror SCALAR_BOUNDS_REGISTRY: a migration-written row never passed SetConfig.
    def worker_concurrency(self) -> int:
        v = int_positive(self._cfg, "pipeline.worker_concurrency", 4)
        return self._clamped("pipeline.worker_concurrency", v, 1, 16)

    def poll_interval_ms(self) -> int:
        v = int_positive(self._cfg, "pipeline.poll_interval_ms", 1000)
        return self._clamped("pipeline.poll_interval_ms", v, 200, 5000)

    def lease_seconds(self) -> int:
        v = int_positive(self._cfg, "pipeline.lease_seconds", 60)
        return self._clamped("pipeline.lease_seconds", v, 45, 600)

    def max_attempts(self) -> int:
        v = int_positive(self._cfg, "pipeline.max_attempts", 5)
        return self._clamped("pipeline.max_attempts", v, 2, 20)

    def retention_days(self) -> int:
        v = int_positive(self._cfg, "pipeline.retention_days", 7)
        return self._clamped("pipeline.retention_days", v, 1, 90)

    def on_change(self, callback) -> None:
        self._cfg.on_change(callback)


class _Raised(NamedTuple):
    exc: BaseException


_STOPPED = object()


def _utc_today() -> date:
    return datetime.now(UTC).date()


class _Batch:
    def __init__(self, keys):
        self.keys = frozenset(keys)
        self.done = asyncio.Event()


class _Attempt:
    """One claimed attempt: its fence deadline, stop state and current database stage."""

    def __init__(self, job: "ClaimedJob", fence_deadline: float):
        self.job = job
        self.key = (job.job_id, job.lease_token)
        self.fence_deadline = fence_deadline
        self.phase = "running"  # running | awaiting_lane | reporting | retry_wait
        self.stop: str | None = None  # lost | self_fence | deadline
        self.stop_at: float | None = None
        self.abandoned = False
        self.lost = asyncio.Event()
        self.stage: str | None = None  # gate | acquire | txn
        self.txn = None
        self.handler_task: asyncio.Task | None = None
        self.timers: dict[str, asyncio.TimerHandle] = {}

    def renewable(self) -> bool:
        return (
            self.phase != "reporting"
            and self.stop not in ("lost", "self_fence")
            and not self.abandoned
            and not self.lost.is_set()
        )

    def handler_running(self) -> bool:
        return self.handler_task is not None and not self.handler_task.done()

    def cancel_timers(self, *names) -> None:
        for name in names or list(self.timers):
            timer = self.timers.pop(name, None)
            if timer is not None:
                timer.cancel()


class ClaimedJob:
    """What a handler sees: the job's identity and `db(budget)`, its only database access."""

    def __init__(self, row, worker: "JobGraphWorker"):
        self.job_id = row["job_id"]
        self.kind = row["kind"]
        self.subject = row["subject"]
        self.epoch = row["epoch"]
        self.run_id = row["run_id"]
        self.lane = Lane(row["lane"])
        self.attempts = row["attempts"]
        self.wait_round = row["wait_round"]
        self.lease_token = row["lease_token"]
        self._worker = worker
        self._attempt: _Attempt | None = None

    @asynccontextmanager
    async def db(self, budget: float):
        if not 0 < budget <= HANDLER_BLOCK_CAP_S:
            raise PermanentJobError(f"job.db budget {budget!r} outside (0, {HANDLER_BLOCK_CAP_S}]")
        att, worker = self._attempt, self._worker
        if att.stop is not None or worker._monotonic() >= att.fence_deadline:
            raise AttemptStopped()
        gate = worker._gate
        att.stage = "gate"
        try:
            async with asyncio.timeout(budget):
                await gate.acquire()
        except BaseException:
            att.stage = None
            raise
        held = True

        def release_gate():
            nonlocal held
            if held:
                held = False
                gate.release()

        def on_acquired():
            if att.stop is not None:
                raise AttemptStopped()
            att.stage = "txn"

        att.stage = "acquire"
        try:
            async with bounded_txn(
                worker._service_pool,
                budget,
                on_acquired=on_acquired,
                on_terminate=release_gate,
                monotonic=worker._monotonic,
            ) as tx:
                att.txn = tx
                yield tx
        except (AttemptStopped, asyncio.CancelledError):
            raise
        except BaseException as e:
            if att.stop is not None:
                raise AttemptStopped() from e
            raise
        finally:
            att.txn = None
            att.stage = None
            release_gate()


class JobGraphWorker:
    """Claim, maintenance and heartbeat loops over one control lane (design.md § Worker runtime)."""

    def __init__(
        self,
        repo,
        service_pool,
        settings: JobGraphSettings,
        registry: HandlerRegistry,
        *,
        monotonic=time.monotonic,
        utc_today=_utc_today,
        rand=random.random,
    ):
        registry.validate()
        self._repo = repo
        self._service_pool = service_pool
        self._settings = settings
        self._registry = registry
        self._monotonic = monotonic
        self._utc_today = utc_today
        self._rand = rand
        self._limiter = ResizableLimiter(settings.worker_concurrency)
        self._gate = asyncio.Lock()
        self._attempts: dict[tuple, _Attempt] = {}
        self._inflight: _Batch | None = None
        self._empty_delay: float | None = None
        self._maintenance_ticks = 0
        self._ensured_day: date | None = None
        self.ready_stats = None

    def start_listening(self) -> None:
        self._settings.on_change(self._limiter.wake)

    async def run_claim_forever(self):
        await supervision.run_supervised(self.claim_tick, "pipeline-claim")

    async def run_maintenance_forever(self):
        await supervision.run_supervised(self.maintenance_tick, "pipeline-maintenance")

    async def run_heartbeat_forever(self):
        await supervision.run_supervised(self.heartbeat_tick, "pipeline-heartbeat")

    # ------------------------------------------------------------------ claim

    async def claim_tick(self) -> float:
        lim = self._limiter
        await lim.acquire()
        taken = 1
        while lim.in_use < lim.limit:
            await lim.acquire()
            taken += 1
        if not self._settings.worker_enabled():
            self._release_slots(taken)
            return IDLE_CLAIM_CEILING_S
        poll_s = self._settings.poll_interval_ms() / 1000
        try:
            async with self._repo.lane():
                if not self._settings.worker_enabled():
                    self._release_slots(taken)
                    return IDLE_CLAIM_CEILING_S
                lease = self._settings.lease_seconds()
                rows, sent = await self._repo.claim(
                    self._registry.kinds(), taken, lease, lane_held=True
                )
        except Exception as e:  # noqa: BLE001 — a failed claim frees its slots and backs off
            self._release_slots(taken)
            log.warning("pipeline claim failed (%s: %s)", type(e).__name__, e)
            return self._idle_delay(poll_s)
        self._release_slots(taken - len(rows))
        if rows:
            late = self._monotonic() - sent
            if late > CLAIM_ACK_WINDOW_S:
                log.warning("pipeline claim acknowledged %.1fs after it was sent", late)
        for row in rows:
            self._start(row, sent + lease - SELF_FENCE_MARGIN_S)
        if not rows:
            return self._idle_delay(poll_s)
        self._empty_delay = None
        return 0.0 if len(rows) == taken else poll_s

    def _idle_delay(self, poll_s: float) -> float:
        ceiling = max(poll_s, IDLE_CLAIM_CEILING_S)
        prev = self._empty_delay
        self._empty_delay = poll_s if prev is None else min(prev * 2, ceiling)
        return self._empty_delay

    def _release_slots(self, n: int) -> None:
        for _ in range(n):
            self._limiter.release()

    def _start(self, row, fence_deadline: float) -> None:
        job = ClaimedJob(row, self)
        att = _Attempt(job, fence_deadline)
        job._attempt = att
        self._attempts[att.key] = att
        runner = supervision.spawn(
            self._run_attempt(att), f"pipeline-runner-{job.job_id}", forever=False
        )
        runner.add_done_callback(lambda _t: self._limiter.release())

    # ------------------------------------------------------------------ attempt

    def _later(self, att: _Attempt, name: str, due: float, callback) -> None:
        att.cancel_timers(name)
        loop = asyncio.get_running_loop()

        def fire():
            att.timers.pop(name, None)
            lag = self._monotonic() - due
            if lag > TOLERATED_LAG_S:
                log.warning("pipeline %s timer for job %s fired %.1fs late", name, att.key[0], lag)
            callback()

        att.timers[name] = loop.call_later(max(due - self._monotonic(), 0.0), fire)

    def _arm_self_fence(self, att: _Attempt) -> None:
        if att.handler_running():
            self._later(
                att, "self_fence", att.fence_deadline, lambda: self._stop(att, "self_fence")
            )

    def _stop(self, att: _Attempt, kind: str) -> None:
        if kind != "lost" and not att.handler_running():
            return
        if att.stop in ("lost", "self_fence") or (att.stop == "deadline" and kind == "deadline"):
            return
        att.stop = kind
        att.stop_at = self._monotonic()
        if kind == "lost":
            att.lost.set()
        if not att.handler_running():
            return
        if att.stage == "txn" and att.txn is not None:
            att.txn.abort()
        else:
            att.handler_task.cancel()
        self._later(att, "grace", att.stop_at + STOP_GRACE_S, lambda: self._abandon(att))

    def _abandon(self, att: _Attempt) -> None:
        if att.handler_running():
            att.abandoned = True
            log.error(
                "pipeline job %s handler still running %.0fs after a %s stop; abandoned",
                att.key[0],
                STOP_GRACE_S,
                att.stop,
            )

    def _declare_lost(self, att: _Attempt) -> None:
        if att.lost.is_set() or att.stop == "self_fence":
            return
        if att.handler_running():
            self._stop(att, "lost")
        else:
            att.stop = "lost"
            att.lost.set()

    async def _run_handler(self, att: _Attempt):
        handler = self._registry.get(att.job.kind)
        try:
            return check_outcome(await handler(att.job))
        except AttemptStopped:
            return _STOPPED
        except Exception as e:  # noqa: BLE001 — every handler failure becomes an outcome
            return _Raised(e)

    async def _run_attempt(self, att: _Attempt) -> None:
        try:
            task = supervision.spawn(
                self._run_handler(att), f"pipeline-handler-{att.key[0]}", forever=False
            )
            att.handler_task = task
            task.add_done_callback(lambda _t: att.cancel_timers("self_fence", "deadline"))
            self._arm_self_fence(att)
            self._later(
                att,
                "deadline",
                self._monotonic() + ATTEMPT_DEADLINE_S,
                lambda: self._stop(att, "deadline"),
            )
            await asyncio.wait([task])
            ended = self._monotonic()
            att.cancel_timers("grace")
            if att.abandoned or att.stop in ("lost", "self_fence") or att.lost.is_set():
                return
            result = _STOPPED if task.cancelled() else task.result()
            if att.stop == "deadline" and ended - att.stop_at > STOP_GRACE_S:
                return
            if result is _STOPPED:
                result = _Raised(TimeoutError("attempt_timeout"))
            att.phase = "awaiting_lane"
            await self._write_result(att, result, ended)
        finally:
            att.cancel_timers()
            self._attempts.pop(att.key, None)

    def _writer(self, att: _Attempt, result):
        job, repo = att.job, self._repo
        max_attempts = self._settings.max_attempts()

        def report(outcome, **kw):
            async def write():
                return await repo.report(
                    job.job_id,
                    job.lease_token,
                    outcome,
                    max_attempts=max_attempts,
                    lane_held=True,
                    **kw,
                )

            return write

        try:
            if isinstance(result, Succeeded):
                return report("succeeded")
            if isinstance(result, Verdict):
                return report("verdict", verdict=validate_verdict(result.label))
            if isinstance(result, WaitOn):
                children = validate_wait_on(job, result.children, self._registry)

                async def park():
                    return await repo.park(
                        job.job_id,
                        job.lease_token,
                        [(c.kind, c.subject, c.epoch, c.lane) for c in children],
                        lane_held=True,
                    )

                return park
            raise result.exc
        except PermanentJobError as e:
            return report("permanent", error=truncate_error(str(e) or type(e).__name__))
        except Exception as e:  # noqa: BLE001 — classified below
            text = truncate_error(f"{type(e).__name__}: {e}")
            if classify(e) == "permanent":
                return report("permanent", error=text)
            return report(
                "transient",
                retry_delay_s=backoff_seconds(job.attempts, rand=self._rand),
                error=text,
            )

    async def _write_result(self, att: _Attempt, result, ended: float) -> None:
        write = self._writer(att, result)
        give_up_at = ended + REPORT_GIVE_UP_S
        retry_s = REPORT_RETRY_MIN_S
        last_error: BaseException | None = None
        while True:
            if att.lost.is_set():
                return
            if self._monotonic() >= give_up_at:
                return self._give_up(att, last_error)
            async with self._repo.lane():
                if att.lost.is_set():
                    return
                if self._monotonic() >= give_up_at:
                    return self._give_up(att, last_error)
                att.phase = "reporting"
                batch = self._inflight
                if batch is not None and att.key in batch.keys:
                    try:
                        await asyncio.wait_for(batch.done.wait(), RUNNER_BATCH_WAIT_S)
                    except TimeoutError:
                        pass
                try:
                    written = await write()
                except (ParkRace, Exception) as e:  # noqa: BLE001 — retried until the give-up
                    last_error = e
                else:
                    if not written:
                        log.info("pipeline job %s: result rejected by the fence", att.key[0])
                    return
            att.phase = "retry_wait"
            remaining = give_up_at - self._monotonic()
            if remaining <= 0:
                return self._give_up(att, last_error)
            try:
                await asyncio.wait_for(att.lost.wait(), min(retry_s, remaining))
            except TimeoutError:
                pass
            retry_s = min(retry_s * 2, REPORT_RETRY_MAX_S)

    def _give_up(self, att: _Attempt, last_error) -> None:
        log.error(
            "pipeline job %s: result not written within %.0fs; last error: %r",
            att.key[0],
            REPORT_GIVE_UP_S,
            last_error if last_error is not None else "no try was made",
        )

    # ------------------------------------------------------------------ heartbeat

    async def heartbeat_tick(self) -> float:
        start = self._monotonic()
        lease = self._settings.lease_seconds()
        keys = [k for k, a in self._attempts.items() if a.renewable()]
        if keys:
            batch = _Batch(keys)
            self._inflight = batch
            renewed = None
            try:
                renewed, sent = await self._repo.heartbeat(keys, lease)
            except Exception as e:  # noqa: BLE001 — a failed batch leaves every fence unchanged
                log.warning("pipeline heartbeat failed (%s: %s)", type(e).__name__, e)
            finally:
                batch.done.set()
                if self._inflight is batch:
                    self._inflight = None
            if renewed is not None:
                for key in keys:
                    att = self._attempts.get(key)
                    if att is None:
                        continue
                    if key in renewed:
                        att.fence_deadline = sent + lease - SELF_FENCE_MARGIN_S
                        self._arm_self_fence(att)
                    elif att.phase != "reporting":
                        self._declare_lost(att)
        return max(HEARTBEAT_PERIOD_S - (self._monotonic() - start), 0.0)

    # ------------------------------------------------------------------ maintenance

    async def maintenance_tick(self) -> float:
        start = self._monotonic()
        tick = self._maintenance_ticks
        self._maintenance_ticks += 1
        enabled = self._settings.worker_enabled
        if enabled():
            await self._guarded("reap", lambda: self._repo.reap(self._settings.max_attempts()))
        if enabled():
            await self._settle()
        if enabled():
            await self._guarded("ensure", self._ensure_prune)
        if tick % STATS_EVERY_TICKS == 0 and enabled():
            await self._guarded("stats", self.stats_step)
        return max(MAINTENANCE_PERIOD_S - (self._monotonic() - start), 0.0)

    async def _guarded(self, step: str, fn):
        try:
            return await fn()
        except Exception as e:  # noqa: BLE001 — one failing step never skips the others
            log.warning("pipeline %s failed (%s: %s)", step, type(e).__name__, e)
            return None

    async def _settle(self) -> None:
        began = self._monotonic()
        for _ in range(SETTLE_MAX_BATCHES):
            if self._monotonic() - began >= SETTLE_MAX_S or not self._settings.worker_enabled():
                return
            result = await self._guarded("settle", self._repo.settle_batch)
            if result is None or not result[2]:
                return

    async def _ensure_prune(self) -> None:
        today = self._utc_today()
        if self._ensured_day == today:
            return
        await self._repo.enqueue(
            PRUNE_KIND,
            PRUNE_SUBJECT,
            prune_epoch(today),
            run_id=prune_run_id(today),
            lane=PRUNE_LANE,
        )
        self._ensured_day = today

    async def stats_step(self):
        self.ready_stats = await self._repo.ready_stats()
        return self.ready_stats
