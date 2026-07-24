"""Unit tests for the shared re-entry cooldown gate helper (feature 069).

Pure-logic coverage of app/services/cooldown.py — the single gate used identically by the
backtest engine and the live loop (FR-4). Uses aware UTC timestamps throughout; the tz-awareness
invariant is enforced *inside* the helper, so the naive-datetime guard is asserted here directly.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.services.cooldown import effective_cooldown_days, is_cooldown_active


def test_effective_cooldown_days_unset_uses_default():
    # None (unset) → platform default; an explicit int (incl. 0) is returned as-is.
    assert effective_cooldown_days(None, 31) == 31


def test_effective_cooldown_days_explicit_zero_is_not_default():
    # explicit 0 → genuine no-cooldown, NEVER remapped to the default.
    assert effective_cooldown_days(0, 31) == 0


def test_effective_cooldown_days_explicit_value_passthrough():
    assert effective_cooldown_days(31, 250) == 31


def test_is_cooldown_active_never_exited_is_false():
    now = datetime(2026, 3, 1, tzinfo=UTC)
    assert is_cooldown_active(None, now, 31) is False


def test_is_cooldown_active_inside_window_is_true():
    last_exit = datetime(2026, 3, 1, tzinfo=UTC)
    current = last_exit + timedelta(days=5)
    assert is_cooldown_active(last_exit, current, 31) is True


def test_is_cooldown_active_at_boundary_is_false():
    # Half-open window [last_exit, last_exit + N days): re-entry exactly N days later is allowed.
    last_exit = datetime(2026, 3, 1, tzinfo=UTC)
    current = last_exit + timedelta(days=31)
    assert is_cooldown_active(last_exit, current, 31) is False


def test_is_cooldown_active_zero_cooldown_allows_immediate_reentry():
    last_exit = datetime(2026, 3, 1, tzinfo=UTC)
    current = last_exit + timedelta(seconds=1)
    assert is_cooldown_active(last_exit, current, 0) is False


def test_is_cooldown_active_rejects_naive_last_exit():
    naive = datetime(2026, 3, 1)  # noqa: DTZ001 — intentionally naive for the guard test
    aware = datetime(2026, 3, 2, tzinfo=UTC)
    with pytest.raises(ValueError):
        is_cooldown_active(naive, aware, 31)


def test_is_cooldown_active_rejects_naive_current_ts():
    aware = datetime(2026, 3, 1, tzinfo=UTC)
    naive = datetime(2026, 3, 2)  # noqa: DTZ001 — intentionally naive for the guard test
    with pytest.raises(ValueError):
        is_cooldown_active(aware, naive, 31)
