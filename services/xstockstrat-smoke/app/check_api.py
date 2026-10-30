"""The API check modules are written against (contract: services/xstockstrat-smoke/CLAUDE.md)."""

import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.policy import FIXTURE_PREFIX

CHECKS_API_VERSION = 1
CLEANUP_DEADLINE_S = 10.0


@dataclass(frozen=True)
class CheckMeta:
    id: str
    feature: str
    part: str
    timeout_s: float
    janitor: Callable[..., Awaitable[None]] | None = None


def check(id: str, feature: str, part: str, timeout_s: float = 30, janitor=None):
    """`janitor(ctx)` runs before the body to sweep `smoke-` leftovers of earlier runs."""

    def register(fn):
        fn.__smoke_check__ = CheckMeta(id, feature, part, timeout_s, janitor)
        return fn

    return register


class CheckFailure(Exception):
    """Raised by a check to record outcome FAIL with this message as evidence."""


class CheckContext:
    def __init__(self, *, db, rpc, run_id: str = ""):
        self.db = db
        self.rpc = rpc
        self.run_id = run_id
        self.evidence_items: dict[str, Any] = {}
        self.cleanups: list[tuple[Callable[[], Awaitable[None]], float]] = []

    def evidence(self, key: str, value: Any) -> None:
        self.evidence_items[key] = value

    def fixture(self, hint: str) -> str:
        return f"{FIXTURE_PREFIX}{self.run_id}-{hint}"

    def on_cleanup(self, fn, *, deadline_s: float = CLEANUP_DEADLINE_S) -> None:
        """`fn()` runs after the check ends with any outcome, last registered first; the deadline
        is capped at CLEANUP_DEADLINE_S."""
        valid = isinstance(deadline_s, int | float) and not isinstance(deadline_s, bool)
        if not valid or not math.isfinite(deadline_s) or deadline_s <= 0:
            raise ValueError(f"cleanup deadline_s must be a positive number, got {deadline_s!r}")
        self.cleanups.append((fn, min(float(deadline_s), CLEANUP_DEADLINE_S)))
