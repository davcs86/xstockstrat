import asyncio
import logging

import grpc
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2, config_pb2_grpc

from app import mtls

log = logging.getLogger(__name__)


class ConfigWatcher:
    # Smoke is staging-only: always request the staging environment's rows.

    def __init__(self, endpoint: str, namespace: str):
        self.endpoint = endpoint
        self.namespace = namespace
        self._snapshot: config_pb2.ConfigSnapshot | None = None
        self._snapshot_event = asyncio.Event()
        self._channel = grpc.aio.secure_channel(
            endpoint, mtls.channel_credentials(), options=mtls.target_override("xstockstrat-config")
        )
        self._stub = config_pb2_grpc.ConfigServiceStub(self._channel)
        self._watch_task = asyncio.get_event_loop().create_task(
            self._watch(), name=f"config-watch-{namespace}"
        )

    def _build_watch_request(self) -> config_pb2.WatchConfigRequest:
        return config_pb2.WatchConfigRequest(
            namespace=self.namespace,
            client_id=f"smoke-{id(self)}",
            environment=common_pb2.ENVIRONMENT_STAGING,
        )

    async def _watch(self):
        while True:
            try:
                stream = self._stub.WatchConfig(self._build_watch_request())
                async for snapshot in stream:
                    self._snapshot = snapshot
                    self._snapshot_event.set()
            except Exception as e:  # noqa: BLE001 — any error reconnects; CancelledError propagates
                log.warning("config stream error (%s): %s, reconnecting in 2s", type(e).__name__, e)
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
        return v.string_val if v.HasField("string_val") else default
