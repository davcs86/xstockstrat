"""AC-43 / FR-12: the committed stubs carry `idempotency_level = NO_SIDE_EFFECTS` on exactly the
pure-read RPCs of feature 280 (recon.md § RPC read/write classification, "Pure READ" bullet)."""

import importlib
import os

import pytest
from google.protobuf import descriptor_pb2

NSE = descriptor_pb2.MethodOptions.NO_SIDE_EFFECTS

# recon.md "Pure READ (annotate NO_SIDE_EFFECTS)" minus the streaming WatchConfig (a unary-only
# runner cannot call it and a stream is not a valid Connect GET; left for controller decision).
ANNOTATED = {
    "trading": (
        "TradingService",
        ["ListBrokerAccounts", "GetOrder", "ListOrders", "GetTradingEnvironment"],
    ),
    "portfolio": ("PortfolioService", ["GetSnapshot", "GetWatchlist", "ListWatchlists"]),
    "marketdata": ("MarketDataService", ["GetDataCoverage", "GetHistoricalFundamentals"]),
    "indicators": (
        "IndicatorsService",
        [
            "ComputeIndicator",
            "ListIndicators",
            "ListFundamentalMetrics",
            "ListFormulas",
            "ListTemplates",
        ],
    ),
    "ingest": (
        "IngestService",
        [
            "GetBackfillStatus",
            "ListBackfillJobs",
            "NormalizeRawData",
            "QuerySignals",
            "ListSignalSources",
            "ListTemplates",
        ],
    ),
    "analysis": (
        "AnalysisService",
        [
            "ListStrategies",
            "GetStrategyReport",
            "ListBacktests",
            "GetBacktest",
            "ScreenSymbols",
            "GetStrategyAnalytics",
            "QueryPnLPatterns",
            "GetAttribution",
            "ListTemplates",
        ],
    ),
    "ledger": ("LedgerService", ["QueryEvents", "GetEvent"]),
    "identity": ("IdentityService", ["ValidateToken", "GetOAuthClient", "GetUserMetadata"]),
    "notify": ("NotifyService", ["ListAlerts"]),
    "config": ("ConfigService", ["GetConfig", "ListKeys"]),
}

# recon.md "READ-SIDE-EFFECT", "OWNER-WRITE" and "PRIVILEGED / unsafe writes" bullets (sample),
# plus WatchConfig/streaming reads (out of scope, see above). Must never be annotated.
UNANNOTATED = {
    "ledger": ("LedgerService", ["AppendEvent", "StreamEvents", "ExportEvents"]),
    "marketdata": (
        "MarketDataService",
        [
            "GetFundamentals",
            "GetBars",
            "GetLatestPrice",
            "BackfillBars",
            "BackfillFundamentals",
            "DeleteBackfilledData",
        ],
    ),
    "config": ("ConfigService", ["GetSecret", "SetConfig", "WatchConfig"]),
    "notify": ("NotifyService", ["EmitAlert", "AcknowledgeAlert", "MarkAlertRead", "StreamAlerts"]),
    "identity": (
        "IdentityService",
        [
            "IssueAuthCode",
            "RevokeAuthorizedApp",
            "UpdateUserMetadata",
            "AdminGetUserMetadata",
            "CreateUser",
        ],
    ),
    "trading": ("TradingService", ["PlaceOrder", "ConfirmOrder", "CancelOrder"]),
    "portfolio": ("PortfolioService", ["GetPortfolio", "ListPositions", "CreateWatchlist"]),
    "analysis": (
        "AnalysisService",
        [
            "RunBacktest",
            "SetStrategyLive",
            "RunFundamentalsScan",
            "ManageTemplate",
            "ListOpportunities",
        ],
    ),
    "ingest": (
        "IngestService",
        ["IngestSignal", "TriggerBackfill", "CancelBackfill", "ManageSignalSource"],
    ),
}


def _level(pkg: str, service: str, method: str):
    mod = importlib.import_module(f"{pkg}.v1.{pkg}_pb2")
    return (
        mod.DESCRIPTOR.services_by_name[service]
        .methods_by_name[method]
        .GetOptions()
        .idempotency_level
    )


def _cases(table):
    return [(p, s, m) for p, (s, ms) in table.items() for m in ms]


def _not_regenerated() -> bool:
    return _level("ledger", "LedgerService", "QueryEvents") != NSE


@pytest.mark.parametrize(("pkg", "service", "method"), _cases(ANNOTATED))
def test_annotated_method_resolves_no_side_effects(pkg, service, method):
    if _not_regenerated():
        msg = "stubs not regenerated (UNVERIFIED-HERE: codegen host)"
        if os.environ.get("CI") == "true":
            pytest.fail(msg)
        pytest.skip(msg)
    assert _level(pkg, service, method) == NSE


@pytest.mark.parametrize(("pkg", "service", "method"), _cases(UNANNOTATED))
def test_unannotated_method_stays_unannotated(pkg, service, method):
    assert _level(pkg, service, method) != NSE
