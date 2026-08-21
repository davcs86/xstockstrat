"""Feature 148 — app/client.py watchlist gRPC wrappers.

Exercises the real dict→proto request builders against a mocked PortfolioService stub: pagination,
MANUAL-source stamping, and the read-modify-write merge that protects the stock set on a name-only
update (the F-12 replace-all footgun the design closed).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import client


def _channel_cm():
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=MagicMock())
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _patch_stub(mock_stub):
    """Patch grpc + PortfolioServiceStub → mock_stub; returns the grpc patcher context tuple."""
    from gen.portfolio.v1 import portfolio_pb2_grpc  # type: ignore

    grpc_patch = patch("app.client.grpc")
    stub_patch = patch.object(portfolio_pb2_grpc, "PortfolioServiceStub", return_value=mock_stub)
    return grpc_patch, stub_patch


# ── list_watchlists — pagination (AC-1) ──────────────────────────────────────


@pytest.mark.asyncio
async def test_list_watchlists_paginates_and_forwards_user():
    from gen.common.v1 import common_pb2  # type: ignore
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    resp = portfolio_pb2.ListWatchlistsResponse(
        watchlists=[portfolio_pb2.Watchlist(watchlist_id="wl-1", name="Momentum")],
        page=common_pb2.PageResponse(next_page_token="tok-2"),
    )
    mock_stub = MagicMock()
    mock_stub.ListWatchlists = AsyncMock(return_value=resp)

    grpc_patch, stub_patch = _patch_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.list_watchlists("user-42", limit=1, page_token="tok-1")

    assert mock_grpc.aio.insecure_channel.call_args[0][0] == client.PORTFOLIO_ENDPOINT
    sent = mock_stub.ListWatchlists.call_args.args[0]
    assert sent.page.page_size == 1
    assert sent.page.page_token == "tok-1"
    meta = mock_stub.ListWatchlists.call_args.kwargs["metadata"]
    assert ("x-user-id", "user-42") in meta
    assert out["next_page_token"] == "tok-2"
    assert out["watchlists"][0]["watchlist_id"] == "wl-1"
    # no user_id ever leaks into a request body
    assert not any("user_id" in f.name for f, _ in sent.ListFields())


# ── get_watchlist — returns bindings (AC-2) ──────────────────────────────────


@pytest.mark.asyncio
async def test_get_watchlist_returns_bindings():
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    wl = portfolio_pb2.Watchlist(
        watchlist_id="wl-momentum",
        name="Momentum",
        bindings=[
            portfolio_pb2.WatchlistBinding(symbol="NVDA", strategy_id="sma_crossover"),
            portfolio_pb2.WatchlistBinding(symbol="AAPL"),
        ],
    )
    mock_stub = MagicMock()
    mock_stub.GetWatchlist = AsyncMock(
        return_value=portfolio_pb2.GetWatchlistResponse(watchlist=wl)
    )
    grpc_patch, stub_patch = _patch_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            out = await client.get_watchlist("user-42", "wl-momentum")

    got = mock_stub.GetWatchlist.call_args.args[0]
    assert got.watchlist_id == "wl-momentum"
    bindings = out["watchlist"]["bindings"]
    assert {b["symbol"] for b in bindings} == {"NVDA", "AAPL"}
    assert any(b.get("strategy_id") == "sma_crossover" for b in bindings)


# ── create_watchlist — MANUAL source (AC-4, AC-7 provenance) ─────────────────


@pytest.mark.asyncio
async def test_create_stamps_manual_source_and_no_body_user_id():
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.CreateWatchlist = AsyncMock(
        return_value=portfolio_pb2.CreateWatchlistResponse(
            watchlist=portfolio_pb2.Watchlist(watchlist_id="wl-new", name="Breakouts")
        )
    )
    grpc_patch, stub_patch = _patch_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            await client.create_watchlist("user-42", name="Breakouts", symbols=["TSLA", "AMD"])

    sent = mock_stub.CreateWatchlist.call_args.args[0]
    assert sent.name == "Breakouts"
    assert {b.symbol for b in sent.bindings} == {"TSLA", "AMD"}
    assert all(b.source == portfolio_pb2.WATCHLIST_ENTRY_SOURCE_MANUAL for b in sent.bindings)
    assert not any(f.name == "user_id" for f, _ in sent.ListFields())


# ── update_watchlist — READ-MODIFY-WRITE merge (AC-5) ────────────────────────


@pytest.mark.asyncio
async def test_update_name_only_preserves_existing_bindings():
    """A name-only update must NOT wipe the stocks: the tool re-sends the fetched bindings."""
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    current = portfolio_pb2.Watchlist(
        watchlist_id="wl-momentum",
        name="Momentum",
        description="orig",
        bindings=[
            portfolio_pb2.WatchlistBinding(
                symbol="NVDA", source=portfolio_pb2.WATCHLIST_ENTRY_SOURCE_MANUAL
            ),
            portfolio_pb2.WatchlistBinding(
                symbol="AAPL", source=portfolio_pb2.WATCHLIST_ENTRY_SOURCE_MANUAL
            ),
        ],
    )
    mock_stub = MagicMock()
    mock_stub.GetWatchlist = AsyncMock(
        return_value=portfolio_pb2.GetWatchlistResponse(watchlist=current)
    )
    mock_stub.UpdateWatchlist = AsyncMock(
        return_value=portfolio_pb2.UpdateWatchlistResponse(watchlist=current)
    )
    grpc_patch, stub_patch = _patch_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            await client.update_watchlist("user-42", "wl-momentum", name="Momentum 2.0")

    sent = mock_stub.UpdateWatchlist.call_args.args[0]
    assert sent.name == "Momentum 2.0"  # new name applied
    assert sent.description == "orig"  # preserved
    assert {b.symbol for b in sent.bindings} == {"NVDA", "AAPL"}  # NOT wiped


@pytest.mark.asyncio
async def test_update_with_symbols_replaces_the_set():
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    current = portfolio_pb2.Watchlist(
        watchlist_id="wl-momentum",
        name="Momentum",
        bindings=[portfolio_pb2.WatchlistBinding(symbol="NVDA")],
    )
    mock_stub = MagicMock()
    mock_stub.GetWatchlist = AsyncMock(
        return_value=portfolio_pb2.GetWatchlistResponse(watchlist=current)
    )
    mock_stub.UpdateWatchlist = AsyncMock(
        return_value=portfolio_pb2.UpdateWatchlistResponse(watchlist=current)
    )
    grpc_patch, stub_patch = _patch_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            await client.update_watchlist("user-42", "wl-momentum", symbols=["MSFT", "GOOG"])

    sent = mock_stub.UpdateWatchlist.call_args.args[0]
    assert sent.name == "Momentum"  # preserved (not supplied)
    assert {b.symbol for b in sent.bindings} == {"MSFT", "GOOG"}  # full replace
    assert all(b.source == portfolio_pb2.WATCHLIST_ENTRY_SOURCE_MANUAL for b in sent.bindings)


# ── add / remove symbols (AC-7, AC-8) ────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_symbols_stamps_manual_and_merges_bindings():
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.AddWatchlistSymbols = AsyncMock(
        return_value=portfolio_pb2.AddWatchlistSymbolsResponse(
            watchlist=portfolio_pb2.Watchlist(watchlist_id="wl-momentum")
        )
    )
    grpc_patch, stub_patch = _patch_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            await client.add_watchlist_symbols(
                "user-42",
                "wl-momentum",
                symbols=["MSFT"],
                bindings=[{"symbol": "GOOG", "strategy_id": "sma_crossover"}],
            )

    sent = mock_stub.AddWatchlistSymbols.call_args.args[0]
    by_symbol = {b.symbol: b for b in sent.bindings}
    assert set(by_symbol) == {"MSFT", "GOOG"}
    assert by_symbol["GOOG"].strategy_id == "sma_crossover"
    assert all(b.source == portfolio_pb2.WATCHLIST_ENTRY_SOURCE_MANUAL for b in sent.bindings)


@pytest.mark.asyncio
async def test_remove_symbols_sends_symbol_list():
    from gen.portfolio.v1 import portfolio_pb2  # type: ignore

    mock_stub = MagicMock()
    mock_stub.RemoveWatchlistSymbols = AsyncMock(
        return_value=portfolio_pb2.RemoveWatchlistSymbolsResponse(
            watchlist=portfolio_pb2.Watchlist(watchlist_id="wl-momentum")
        )
    )
    grpc_patch, stub_patch = _patch_stub(mock_stub)
    with grpc_patch as mock_grpc:
        mock_grpc.aio.insecure_channel.return_value = _channel_cm()
        with stub_patch:
            await client.remove_watchlist_symbols("user-42", "wl-momentum", ["AAPL"])

    sent = mock_stub.RemoveWatchlistSymbols.call_args.args[0]
    assert sent.watchlist_id == "wl-momentum"
    assert list(sent.symbols) == ["AAPL"]
