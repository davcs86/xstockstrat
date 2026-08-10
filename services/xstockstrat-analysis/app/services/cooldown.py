"""Shared cooldown gate — re-entry (feature 069) AND exit-cooldown (feature 116).

Pure functions — no DB, gRPC, or proto imports — so the *same* gate is used identically by the
backtest engine (`servicer._backtest_symbol_evaluated`) and the live evaluation loop
(`live_loop._eval_pair`), satisfying the backtest/live-parity requirement (FR-4). The tz-awareness
invariant is enforced *inside* this chokepoint (`_require_aware`) rather than by a comment at each
call site, so a naive datetime can never silently produce a wrong verdict.

`is_cooldown_active`/`effective_cooldown_days` are direction-agnostic: they only care whether
`current_ts` falls inside `[gate_start_at, gate_start_at + days)`, regardless of whether the anchor
is a last-exit timestamp (re-entry gate, feature 069) or a last-entry timestamp (exit-cooldown
gate, feature 116) — both consumers reuse the same functions unmodified.

Semantics (feature 069, design-approved):
- ``cooldown_days``/``exit_cooldown_days`` unset → platform default
  (``analysis.strategy.default_cooldown_days`` / ``analysis.strategy.default_exit_cooldown_days``);
- explicit ``0`` → genuine no-cooldown (immediate re-entry/exit allowed);
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
    gate_start_at: datetime | None, current_ts: datetime, cooldown_days: int
) -> bool:
    """Return whether a transition is currently gated by the cooldown.

    A never-anchored pair (``gate_start_at is None``) is never gated. Otherwise the window is the
    half-open interval ``[gate_start_at, gate_start_at + cooldown_days)`` (strict ``<``): a
    transition exactly ``cooldown_days`` days after the anchor is allowed, and an explicit
    ``cooldown_days == 0`` always yields ``False`` (immediately allowed). Both timestamps must be
    tz-aware.

    Used for both directions: the re-entry gate anchors ``gate_start_at`` on the last-exit
    timestamp (feature 069); the exit-cooldown gate anchors it on the last-entry timestamp
    (feature 116). Callers with a known-open pair but an unresolved anchor must not pass ``None``
    here expecting "ungated" — see `live_loop.py`'s skip-until-known guard, which handles that
    case before ever calling this function.
    """
    if gate_start_at is None:
        return False
    _require_aware(gate_start_at)
    _require_aware(current_ts)
    return current_ts < gate_start_at + timedelta(days=cooldown_days)
