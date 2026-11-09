"""
Config watcher for xstockstrat-analysis.
Subscribes to xstockstrat-config WatchConfig stream at startup.
"""

import asyncio
import os

import grpc
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2, config_pb2_grpc

from app import mtls
from app.config.watch_core import KEEPALIVE_OPTIONS, WatchCore


def resolve_environment(application_env: str) -> int:
    """Map APPLICATION_ENV ("development" | "production") to the proto Environment enum.
    Anything other than "production" resolves to staging (feature 147).
    """
    return (
        common_pb2.ENVIRONMENT_PRODUCTION
        if application_env == "production"
        else common_pb2.ENVIRONMENT_STAGING
    )


def resolve_trading_mode(trading_mode: str) -> int:
    """Map TRADING_MODE ("paper" | "live") to the proto TradingMode enum.
    Anything other than "live" resolves to paper, matching this service's own default.
    """
    return common_pb2.TRADING_MODE_LIVE if trading_mode == "live" else common_pb2.TRADING_MODE_PAPER


class ConfigWatcher(WatchCore):
    """
    Subscribes to xstockstrat-config WatchConfig gRPC stream.
    All services must call wait_for_snapshot() before accepting traffic.
    """

    def __init__(self, endpoint: str, namespace: str):
        self.endpoint = endpoint
        self.namespace = namespace
        # Must be sent on every WatchConfig request, else the server serves the
        # zero-value dev/all default rows instead of this deployment's.
        self._environment = resolve_environment(os.environ.get("APPLICATION_ENV", "development"))
        self._trading_mode = resolve_trading_mode(os.environ.get("TRADING_MODE", "paper"))
        self._snapshot: config_pb2.ConfigSnapshot | None = None
        self._snapshot_event = asyncio.Event()
        self._channel = grpc.aio.secure_channel(
            endpoint,
            mtls.channel_credentials(),
            options=mtls.target_override("xstockstrat-config") + KEEPALIVE_OPTIONS,
        )
        self._stub = config_pb2_grpc.ConfigServiceStub(self._channel)
        self._start()

    def _build_watch_request(self) -> config_pb2.WatchConfigRequest:
        return config_pb2.WatchConfigRequest(
            namespace=self.namespace,
            client_id=f"analysis-{id(self)}",
            environment=self._environment,
            trading_mode=self._trading_mode,
        )

    get_int_present = WatchCore.get_int
    get_float_present = WatchCore.get_float


# >0, not >=0: these keys size semaphores, pools, intervals and caps, where 0 or a negative
# deadlocks, raises, busy-loops or empties the result just as an unset key never should.
def int_positive(cfg, key: str, default: int) -> int:
    v = cfg.get_int(key, default)
    return v if v > 0 else default


def float_positive(cfg, key: str, default: float) -> float:
    v = cfg.get_float(key, default)
    return v if v > 0 else default


def str_nonempty(cfg, key: str, default: str) -> str:
    v = cfg.get_str(key, default)
    return v if v else default
