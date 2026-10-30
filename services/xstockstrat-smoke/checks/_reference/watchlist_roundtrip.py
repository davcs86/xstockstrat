from gen.portfolio.v1 import portfolio_pb2 as pb

from app.check_api import CheckFailure, check
from app.fixtures import sweep_watchlists

SVC = "xstockstrat.portfolio.v1.PortfolioService/"


@check(
    "reference.watchlist_roundtrip",
    feature="smoke-check-runtime",
    part="phase-2",
    timeout_s=30,
    janitor=sweep_watchlists,
)
async def run(ctx):
    name = ctx.fixture("wl")
    created = await ctx.rpc.call(SVC + "CreateWatchlist", pb.CreateWatchlistRequest(name=name))
    wid = created.watchlist.watchlist_id

    async def delete():
        await ctx.rpc.call(SVC + "DeleteWatchlist", pb.DeleteWatchlistRequest(watchlist_id=wid))

    ctx.on_cleanup(delete)
    await ctx.rpc.call(
        SVC + "AddWatchlistSymbols",
        pb.AddWatchlistSymbolsRequest(watchlist_id=wid, symbols=["SPY"]),
    )
    got = await ctx.rpc.call(SVC + "GetWatchlist", pb.GetWatchlistRequest(watchlist_id=wid))
    held = {b.symbol for b in got.watchlist.bindings} | set(got.watchlist.symbols)
    if got.watchlist.name != name or "SPY" not in held:
        raise CheckFailure(f"watchlist {name} did not round-trip")
    await ctx.rpc.call(
        SVC + "RemoveWatchlistSymbols",
        pb.RemoveWatchlistSymbolsRequest(watchlist_id=wid, symbols=["SPY"]),
    )
    ctx.evidence("watchlist", name)
