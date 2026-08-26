"""DurableSchedule — the shared durable, crash-safe schedule for analysis background loops (feature
158). Generalizes feature 156's inline fundsignal-loop timing into a thin, reusable unit backed by
the ``(job_name, user_id)``-keyed ``analysis.job_schedule`` table.

It owns ONLY the mode-branched timing/persistence seams — ``seed`` / ``next_sleep_seconds`` /
``advance`` — so each migrated loop keeps its own ``_tick``/``run_forever`` (disabled gate, overlap
lock, config reads, cycle body). The ``run_scheduled`` god-driver was deliberately rejected (design
§ Rejected Alternatives): the three loops have three different disabled/overlap shapes.

Write-**after**-completion is preserved and **no** lease/CAS/``process_name``-fencing is added — the
service runs at ``instance_count:1`` and an in-process ``asyncio.Lock`` guards overlap, so a fencing
token would be dead weight (ledger 2026-08-25 / feature 156).
"""

import os
import socket
from datetime import UTC, datetime, timedelta


def seconds_until_hour_utc(hour: int) -> float:
    """Seconds from now until the next occurrence of ``hour``:00 UTC (relocated from servicer.py's
    ``_seconds_until_hour_utc``, feature 097). Always returns a positive delay (a full day when we
    are already at/past the hour today), so a wall-clock job fires once per calendar day."""
    hour = hour % 24
    now = datetime.now(UTC)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return (target - now).total_seconds()


class DurableSchedule:
    """Durable schedule for one job, backed by ``analysis.job_schedule``.

    ``mode`` is ``"interval"`` or ``"wallclock"``; ``anchor_hour`` (wall-clock only) is a **zero-arg
    callable** so the anchor-hour config read stays in the loop, not the helper. ``user_id`` is
    ``""`` for a global job (one row per job) or set for a per-user job (one row per job+user).
    """

    def __init__(self, db_pool, job_name, mode, *, user_id="", anchor_hour=None):
        if mode not in ("interval", "wallclock"):
            raise ValueError(f"invalid mode {mode!r} (expected 'interval' or 'wallclock')")
        if mode == "wallclock" and anchor_hour is None:
            raise ValueError("wallclock mode requires an anchor_hour callable")
        self._db = db_pool
        self._job_name = job_name
        self._mode = mode
        self._user_id = user_id
        self._anchor_hour = anchor_hour

    def _now_ms(self):
        return int(datetime.now(UTC).timestamp() * 1000)

    def _process_name(self):
        return os.environ.get("HOSTNAME") or socket.gethostname()

    async def seed(self):
        """Ensure the schedule row exists (the sole mode branch). interval → due immediately
        (blocked_until_ms=0 → prompt first cycle on a fresh deploy); wall-clock → due at the next
        anchor hour. ``ON CONFLICT DO NOTHING`` preserves a persisted future due (redeploy/crash
        no-op) — never an upsert, which would reset the cadence."""
        if self._mode == "wallclock":
            due_in = seconds_until_hour_utc(self._anchor_hour())
            blocked_until_ms = self._now_ms() + int(due_in * 1000)
        else:
            blocked_until_ms = 0
        await self._db.execute(
            "INSERT INTO analysis.job_schedule (job_name, user_id, blocked_until_ms) "
            "VALUES ($1, $2, $3) ON CONFLICT (job_name, user_id) DO NOTHING",
            self._job_name,
            self._user_id,
            blocked_until_ms,
        )

    async def next_sleep_seconds(self):
        """Seconds to wait until the schedule is due; 0.0 if due now (compute-sleep-until-due, no
        polling). Byte-identical logic to feature 156, keyed on the composite ``(job_name,
        user_id)``."""
        blocked_until_ms = await self._db.fetchval(
            "SELECT blocked_until_ms FROM analysis.job_schedule "
            "WHERE job_name = $1 AND user_id = $2",
            self._job_name,
            self._user_id,
        )
        blocked_until_ms = int(blocked_until_ms) if blocked_until_ms is not None else 0
        now_ms = self._now_ms()
        if now_ms < blocked_until_ms:
            return (blocked_until_ms - now_ms) / 1000.0
        return 0.0

    async def advance(self, seconds):
        """Push the next-due time forward by ``seconds`` (mode-uniform — ``advance`` never branches
        on mode; the caller supplies the interval, the next wall-clock delta, or the retry cadence).
        Called ONLY after a cycle finishes — the crash-safety property."""
        await self._db.execute(
            "UPDATE analysis.job_schedule "
            "SET blocked_until_ms = $1, process_name = $2, updated_at = now() "
            "WHERE job_name = $3 AND user_id = $4",
            self._now_ms() + int(seconds * 1000),
            self._process_name(),
            self._job_name,
            self._user_id,
        )
