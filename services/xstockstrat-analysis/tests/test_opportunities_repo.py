"""feature 185 FR-5 — OpportunitiesRepository.replace_symbols (heal-only UPDATE) unit coverage.

Mirrors the AsyncMock-pool pattern of the sibling repo tests (test_backtest_runs_repo.py): the
pool's ``acquire()``/``transaction()`` are async context managers and ``executemany`` is stubbed, so
the SQL text + binds are asserted without a real database. The servicer-level heal behavior
(heal-in-place, no-resurrection, success-only readiness cache) is covered in the servicer tests.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.handlers.servicer import _primary_source
from app.repositories.opportunities import (
    _PROVENANCE_STRUCTURAL_MARKERS,
    OpportunitiesRepository,
)

pytestmark = pytest.mark.asyncio


def _fetch_pool():
    """A pool whose ``fetch`` is an AsyncMock — enough to assert the SQL text + positional binds of
    ``read``/``available_sources`` (which call ``self._db.fetch``) without a real asyncpg pool."""
    pool = MagicMock()
    pool.fetch = AsyncMock(return_value=[])
    return pool


def _mock_pool():
    """A pool whose ``acquire()`` and ``conn.transaction()`` are async context managers and whose
    ``conn.executemany`` records its call — enough to assert the SQL + binds of a transactional
    executemany without a real asyncpg connection."""
    conn = AsyncMock()
    conn.executemany = AsyncMock()
    tx = MagicMock()
    tx.__aenter__ = AsyncMock(return_value=None)
    tx.__aexit__ = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=tx)
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=None)
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=acquire_cm)
    return pool, conn


async def test_replace_symbols_issues_heal_only_update_with_binds():
    """The write is a transactional UPDATE (never INSERT), re-stamps computed_at, matches on
    (user_id, opportunity_key), and binds the mutable columns in order."""
    pool, conn = _mock_pool()
    repo = OpportunitiesRepository(pool)
    valid = datetime(2999, 1, 1, tzinfo=UTC)
    await repo.replace_symbols(
        "u1",
        [
            {
                "opportunity_key": "u1|AAPL|sx",
                "conviction": 0.8,
                "readiness_json": {"passing_conditions": 1, "total_conditions": 1},
                "signal_axis": 0.5,
                "provenance": ["watchlist"],
                "thesis": "t",
                "valid_until": valid,
            }
        ],
    )
    conn.executemany.assert_awaited_once()
    sql, params = conn.executemany.await_args.args
    assert "UPDATE analysis.opportunities" in sql
    assert "INSERT" not in sql  # heal-only — never resurrects a dropped row
    assert "computed_at = now()" in sql
    assert "WHERE user_id = $1 AND opportunity_key = $2" in sql
    (bind,) = params  # one row
    assert bind[0] == "u1"
    assert bind[1] == "u1|AAPL|sx"
    assert bind[2] == 0.8  # conviction
    assert bind[4] == 0.5  # signal_axis
    assert '"watchlist"' in bind[5]  # provenance JSON-dumped to jsonb
    assert bind[7] == valid


async def test_replace_symbols_empty_is_a_noop():
    """An empty heal set returns before acquiring a connection (no wasted transaction)."""
    pool, conn = _mock_pool()
    repo = OpportunitiesRepository(pool)
    await repo.replace_symbols("u1", [])
    conn.executemany.assert_not_awaited()
    pool.acquire.assert_not_called()


# ── feature 190 — server-side filters/sort + available_sources facet ─────────────────────────────


async def _read(**kwargs):
    """Drive ``read`` against the fetch-mock pool and return (sql, binds)."""
    pool = _fetch_pool()
    repo = OpportunitiesRepository(pool)
    await repo.read("u1", 0.5, 0.3, include_expired=False, **kwargs)
    args = pool.fetch.await_args.args
    return args[0], args[1:]


async def test_read_empty_sources_applies_no_predicate():
    """@AC-5/O2 — an empty ``sources`` list binds ``[]`` at $7 and the guard short-circuits so the
    default view is never emptied by ``= ANY('{}')``."""
    # binds = args[1:] → [user_id, min_conv, w, DISMISS, SNOOZE, markers, srcs, action]
    sql, binds = await _read(sources=[])
    assert binds[5] == _PROVENANCE_STRUCTURAL_MARKERS  # $6 marker array
    assert binds[6] == []  # $7 sources
    assert "cardinality($7::text[]) = 0 OR ps.elem = ANY($7::text[])" in sql


async def test_read_source_predicate_present_with_bind():
    """@AC-4 — a non-empty ``sources`` binds the array at $7; guarded predicate present in SQL."""
    sql, binds = await _read(sources=["live_strategy", "sec_edgar_8k"])
    assert binds[6] == ["live_strategy", "sec_edgar_8k"]
    assert "ps.elem = ANY($7::text[])" in sql


async def test_read_action_filter_binds_o_action_not_disposition():
    """@AC-6/@AC-7/O8 — a specific action binds the OpportunityActionTag int at $8 and filters
    ``o.action`` (the tag), NOT ``opportunity_actions.action`` (the disposition); 0 = any."""
    sql, binds = await _read(action_filter=3)  # OPPORTUNITY_ACTION_TAG_REDUCE
    assert binds[7] == 3
    assert "$8::int = 0 OR o.action = $8::int" in sql
    _, binds0 = await _read(action_filter=0)
    assert binds0[7] == 0  # guard makes it a no-op


async def test_read_sort_branches_lead_expression():
    """@AC-8/@AC-9/@AC-10/O6 — each sort enum selects the right ORDER BY lead, and ALL three keep
    the symbol-partition group key + the opportunity_key ASC paging tiebreak."""
    sql0, _ = await _read(sort=0)  # UNSPECIFIED = legacy blended
    sql1, _ = await _read(sort=1)  # CONVICTION = raw
    sql2, _ = await _read(sort=2)  # EXPIRY
    assert (
        "MAX(((1 - $3) * o.conviction + $3 * o.signal_axis)) OVER (PARTITION BY o.symbol) DESC"
        in sql0
    )
    assert "MAX(o.conviction) OVER (PARTITION BY o.symbol) DESC" in sql1
    assert "MIN(o.valid_until) OVER (PARTITION BY o.symbol) ASC NULLS LAST" in sql2
    for sql in (sql0, sql1, sql2):
        assert "PARTITION BY o.symbol" in sql
        assert "o.opportunity_key ASC" in sql


async def test_read_every_bound_param_is_referenced_in_every_sort_branch():
    """Regression (fails.md:190) — an asyncpg PREPARE fails with IndeterminateDatatypeError
    ('could not determine data type of parameter $N') if a positional bind is referenced NOWHERE
    in the statement. $3 (signal_rank_weight) is used only by the sort=0 blended ORDER BY, so a
    CONVICTION/EXPIRY sort orphaned it and every UI load (which never sends sort=0) aborted against
    real Postgres — invisible to the fake-pool tests. Guard: for all three sort branches every
    bound param $1..$N must appear in the SQL text."""
    import re

    for sort in (0, 1, 2):
        sql, binds = await _read(sort=sort)
        for i in range(1, len(binds) + 1):
            assert re.search(rf"\${i}(?![0-9])", sql), f"param ${i} unreferenced for sort={sort}"
    # $3 specifically — the regressed param — is anchored even when the ORDER BY does not use it.
    sql1, _ = await _read(sort=1)
    assert "$3::double precision IS NOT NULL" in sql1


async def test_read_floor_stays_sole_with_exemption():
    """@AC-2/@AC-3/O8 — the min-conviction floor + muted/unavailable exemption is unchanged and
    orthogonal to the new source/action predicates (never re-introduces fails.md:1547)."""
    sql, _ = await _read(sources=["x"], action_filter=3, sort=2)
    assert "o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable'" in sql


async def test_read_marker_bind_equals_constant():
    """O9 — the LATERAL binds the marker ARRAY (not a re-typed literal), equal to the constant."""
    sql, binds = await _read()
    assert binds[5] == _PROVENANCE_STRUCTURAL_MARKERS
    assert "elem <> ALL($6::text[])" in sql


async def test_available_sources_is_filter_independent_and_freshness_scoped():
    """O3/@AC-11 — the facet method takes no sources/action/min_conviction params, carries no such
    predicate, drops empty-source rows via CROSS JOIN LATERAL, and threads include_expired."""
    import inspect

    params = inspect.signature(OpportunitiesRepository.available_sources).parameters
    assert set(params) == {"self", "user_id", "include_expired"}  # no filter params (structural)

    pool = _fetch_pool()
    pool.fetch = AsyncMock(return_value=[{"source": "b"}, {"source": "a"}, {"source": ""}])
    repo = OpportunitiesRepository(pool)
    got = await repo.available_sources("u1", include_expired=False)
    assert got == ["a", "b"]  # sorted, distinct, empty dropped
    sql, binds = pool.fetch.await_args.args[0], pool.fetch.await_args.args[1:]
    assert "CROSS JOIN LATERAL" in sql
    assert "elem <> ALL($2::text[])" in sql
    assert binds[1] == _PROVENANCE_STRUCTURAL_MARKERS
    assert "AND o.valid_until > now()" in sql  # fresh scoping
    # facet is filter-independent: no conviction floor, no source-selection predicate, no o.action
    assert "o.conviction" not in sql
    assert "ps.elem = ANY" not in sql
    assert "o.action" not in sql

    pool2 = _fetch_pool()
    repo2 = OpportunitiesRepository(pool2)
    await repo2.available_sources("u1", include_expired=True)
    assert (
        "AND o.valid_until > now()" not in pool2.fetch.await_args.args[0]
    )  # stale = no freshness clause


@pytest.mark.parametrize(
    "provenance,expected",
    [
        ([], ""),
        (["watchlist", "position", "live_strategy"], "live_strategy"),
        (["unavailable", "x"], "unavailable"),  # "unavailable" is NOT a structural marker
        (["denied", "uw"], "uw"),
        (["a", "b"], "a"),
        (["watchlist", "position", "denied"], ""),  # all structural
    ],
)
def test_primary_source_parity(provenance, expected):
    """@AC-12 — the pure Python derivation the SQL LATERAL mirrors: skip exactly the structural
    markers, take the first remaining token."""
    assert _primary_source(provenance) == expected
