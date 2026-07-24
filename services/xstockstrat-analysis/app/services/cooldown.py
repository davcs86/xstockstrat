"""Shared re-entry cooldown gate (feature 069).

Pure functions — no DB, gRPC, or proto imports — so the *same* gate is used identically by the
backtest engine (`servicer._backtest_symbol_evaluated`) and the live evaluation loop
(`live_loop._eval_pair`), satisfying the backtest/live-parity requirement (FR-4). The tz-awareness
invariant is enforced *inside* this chokepoint (`_require_aware`) rather than by a comment at each
call site, so a naive datetime can never silently produce a wrong verdict.

Semantics (feature 069, design-approved):
- ``cooldown_days`` unset → platform default (``analysis.strategy.default_cooldown_days``);
- explicit ``0`` → genuine no-cooldown (immediate re-entry allowed);
- negative → rejected at write time elsewhere (INVALID_ARGUMENT), never reaches here.
"""

from datetime import datetime, timedelta


def effective_cooldown_days(cooldown_days: int | None, default_cooldown_days: int) -> int:
    """Resolve the cooldown duration in calendar days.

    ``None`` (the field was left unset) → the platform default. Any explicit int — **including
    ``0``** — is returned as-is and is NEVER remapped to the default; explicit ``0`` is a genuine
    no-cooldown choice.
    """
    if cooldown_days is None:
        return default_cooldown_days
    return cooldown_days


def _require_aware(dt: datetime) -> None:
    """Raise ``ValueError`` if ``dt`` is a naive (tz-unaware) datetime."""
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError("cooldown check requires timezone-aware datetimes")


def is_cooldown_active(
    last_exit_at: datetime | None, current_ts: datetime, cooldown_days: int
) -> bool:
    """Return whether a re-entry is currently gated by the cooldown.

    A never-exited pair (``last_exit_at is None``) is never gated. Otherwise the window is the
    half-open interval ``[last_exit_at, last_exit_at + cooldown_days)`` (strict ``<``): a re-entry
    exactly ``cooldown_days`` days after the exit is allowed, and an explicit ``cooldown_days == 0``
    always yields ``False`` (immediate re-entry). Both timestamps must be tz-aware.
    """
    if last_exit_at is None:
        return False
    _require_aware(last_exit_at)
    _require_aware(current_ts)
    return current_ts < last_exit_at + timedelta(days=cooldown_days)
