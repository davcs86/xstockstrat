"""Pipeline job graph (feature 367): settings, engine primitives and the worker runtime."""

import logging
import random
from dataclasses import dataclass
from datetime import date
from enum import IntEnum
from typing import NamedTuple

from app.config.watcher import int_positive

log = logging.getLogger(__name__)

# Fixed invariants (design.md § Build order), not config keys.
MAX_PARK_ROUNDS = 8
MAX_CHILDREN_PER_PARK = 10_000
BACKOFF_BASE_S = 5
BACKOFF_CAP_S = 300
BACKOFF_JITTER = 0.2
ERROR_MAX_BYTES = 1024


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
