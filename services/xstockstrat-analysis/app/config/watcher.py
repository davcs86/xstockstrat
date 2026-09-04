"""
Config watcher for xstockstrat-indicators.
Subscribes to xstockstrat-config WatchConfig stream at startup.
"""

import asyncio
import logging
import os

import grpc
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2, config_pb2_grpc

log = logging.getLogger(__name__)


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


class ConfigWatcher:
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
        self._channel = grpc.aio.insecure_channel(endpoint)
        self._stub = config_pb2_grpc.ConfigServiceStub(self._channel)
        asyncio.get_event_loop().create_task(self._watch())

    async def _watch(self):
        while True:
            try:
                stream = self._stub.WatchConfig(
                    config_pb2.WatchConfigRequest(
                        namespace=self.namespace,
                        client_id=f"indicators-{id(self)}",
                        environment=self._environment,
                        trading_mode=self._trading_mode,
                    )
                )
                async for snapshot in stream:
                    self._snapshot = snapshot
                    self._snapshot_event.set()
                    log.debug(
                        "config updated namespace=%s version=%s",
                        snapshot.namespace,
                        snapshot.version,
                    )
            except grpc.aio.AioRpcError as e:
                log.warning("config stream error: %s, reconnecting in 2s", e)
                await asyncio.sleep(2)

    async def wait_for_snapshot(self, timeout_seconds: float = 90.0):
        try:
            await asyncio.wait_for(self._snapshot_event.wait(), timeout=timeout_seconds)
        except TimeoutError:
            raise RuntimeError(
                f"Timed out waiting for config snapshot from {self.endpoint} "
                f"namespace={self.namespace}"
            )

    def get_str(self, key: str, default: str = "") -> str:
        if self._snapshot is None:
            return default
        v = self._snapshot.values.get(key)
        if v is None:
            return default
        return v.string_val or default

    def get_int(self, key: str, default: int = 0) -> int:
        if self._snapshot is None:
            return default
        v = self._snapshot.values.get(key)
        if v is None:
            return default
        return v.int_val or default

    def get_int_present(self, key: str, default: int) -> int:
        """Presence-aware int read (feature 097): returns the stored ``int_val`` whenever the
        field is set — **including a legitimate 0** — else the default. Mirrors ``get_bool``'s
        ``HasField`` pattern; use this (never ``get_int``) for keys where 0 is a meaningful
        value, e.g. ``analysis.opportunity.refresh_hour_utc`` (0 = midnight UTC) which the
        ``get_int`` zero-trap would otherwise swallow into the default."""
        if self._snapshot is None:
            return default
        v = self._snapshot.values.get(key)
        if v is None:
            return default
        return v.int_val if v.HasField("int_val") else default

    def get_bool(self, key: str, default: bool = False) -> bool:
        if self._snapshot is None:
            return default
        v = self._snapshot.values.get(key)
        if v is None:
            return default
        return v.bool_val if v.HasField("bool_val") else default

    def get_float(self, key: str, default: float = 0.0) -> float:
        if self._snapshot is None:
            return default
        v = self._snapshot.values.get(key)
        if v is None:
            return default
        return v.float_val or default

    def get_float_present(self, key: str, default: float) -> float:
        """Presence-aware float read (feature 022): returns the stored ``float_val`` whenever the
        field is set — **including a legitimate 0.0** — else the default. Mirrors
        ``get_int_present``; use this (never ``get_float``) for keys where 0 is a meaningful
        value, e.g. ``analysis.scoring.signal_decay_half_life_hours`` (0 disables decay, FR-3)
        which the ``get_float`` zero-trap would otherwise swallow into the default."""
        if self._snapshot is None:
            return default
        v = self._snapshot.values.get(key)
        if v is None:
            return default
        return v.float_val if v.HasField("float_val") else default

    @property
    def sandbox_timeout_ms(self) -> int:
        return self.get_int("indicators.sandbox.timeout_ms", default=5000)

    @property
    def sandbox_memory_bytes(self) -> int:
        return self.get_int("indicators.sandbox.memory_bytes", default=128 * 1024 * 1024)

    @property
    def sandbox_allowed_imports(self) -> list[str]:
        raw = self.get_str(
            "indicators.sandbox.allowed_imports", default="numpy,pandas,math,statistics"
        )
        return [m.strip() for m in raw.split(",") if m.strip()]
