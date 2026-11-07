"""
Config watchers for xstockstrat-agent (feature 295).
The lifespan subscribes to the `agent` and `indicators` WatchConfig streams before serving.
"""

import asyncio
import inspect
import os

import grpc

from app import mtls
from app.config.watch_core import KEEPALIVE_OPTIONS, SNAPSHOT_WAIT_TIMEOUT_S, WatchCore
from app.scopes import resolve_scope

WATCHED_NAMESPACES = ("agent", "indicators")

# Process-wide registry keyed by namespace; readers go through get_watcher().
_WATCHERS: dict = {}


class ConfigWatcher(WatchCore):
    """Subscribes to one namespace of the xstockstrat-config WatchConfig gRPC stream."""

    def __init__(self, endpoint: str, namespace: str):
        from gen.common.v1 import common_pb2  # noqa: PLC0415
        from gen.config.v1 import config_pb2_grpc  # noqa: PLC0415

        self.endpoint = endpoint
        self.namespace = namespace
        self._environment = (
            common_pb2.ENVIRONMENT_PRODUCTION
            if resolve_scope("") == "production"
            else common_pb2.ENVIRONMENT_STAGING
        )
        self._snapshot = None
        self._snapshot_event = asyncio.Event()
        self._channel = grpc.aio.secure_channel(
            endpoint,
            mtls.channel_credentials(),
            options=[("grpc.ssl_target_name_override", "xstockstrat-config")] + KEEPALIVE_OPTIONS,
        )
        self._stub = config_pb2_grpc.ConfigServiceStub(self._channel)
        self._start()

    def _build_watch_request(self):
        from gen.config.v1 import config_pb2  # noqa: PLC0415

        return config_pb2.WatchConfigRequest(
            namespace=self.namespace,
            client_id=f"agent-{os.getpid()}-{id(self)}",
            environment=self._environment,
        )

    async def close(self) -> None:
        for task in (self._watch_task, self._coverage_task):
            task.cancel()
        await asyncio.gather(self._watch_task, self._coverage_task, return_exceptions=True)
        closed = self._channel.close()
        if inspect.isawaitable(closed):
            await closed


def get_watcher(namespace: str):
    return _WATCHERS.get(namespace)


def read_value(namespace: str, key: str) -> str | None:
    """The key's active oneof stringified (client.get_config_value's projection); None if absent."""
    w = get_watcher(namespace)
    if w is None:
        return None
    value = w._lookup(key)
    if value is None:
        return None
    which = value.WhichOneof("value")
    return str(getattr(value, which)) if which else None


def int_positive(cfg, key: str, default: int) -> int:
    v = cfg.get_int(key, default)
    return v if v > 0 else default


async def start_watchers(endpoint: str) -> list[str]:
    """Start a watcher for each namespace not yet registered and wait for every snapshot.

    Raises RuntimeError naming the namespace whose snapshot did not arrive in time.
    """
    started: list[str] = []
    try:
        for ns in WATCHED_NAMESPACES:
            if ns not in _WATCHERS:
                _WATCHERS[ns] = ConfigWatcher(endpoint, ns)
                started.append(ns)
        for ns in WATCHED_NAMESPACES:
            await _WATCHERS[ns].wait_for_snapshot(SNAPSHOT_WAIT_TIMEOUT_S)
    except BaseException:
        await stop_watchers(started)
        raise
    return started


async def stop_watchers(namespaces: list[str]) -> None:
    for ns in namespaces:
        w = _WATCHERS.pop(ns, None)
        if w is not None:
            await w.close()
