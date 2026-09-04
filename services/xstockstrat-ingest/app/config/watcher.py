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


# Must match config's SECRET_CALLER_ALLOWLIST ingest grant (keyPrefixes ['mcp_credential.']).
INGEST_INTERNAL_CALLER_ID = "ingest"
HEADER_INTERNAL_CALLER = "x-internal-caller"


def split_credentials_ref(ref: str) -> tuple[str, str]:
    """Split a stored credentials_ref (e.g. 'ingest.mcp_credential.<slug>') into (namespace, key) on
    the FIRST dot — config stores (namespace, key) where key may itself contain dots (cf. marketdata
    'marketdata' / 'alpaca.api_key'). Returns ('ingest', 'mcp_credential.<slug>')."""
    namespace, _, key = ref.partition(".")
    return namespace, key


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
        # Passed on every WatchConfig so the server serves this deployment's rows,
        # not the zero-value dev default.
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
        """Presence-aware int read: returns the stored ``int_val`` whenever the field is set —
        **including a legitimate 0** — else the default. Mirrors ``get_bool``'s ``HasField``
        pattern; use this (never ``get_int``) for keys where 0 is a meaningful value, e.g.
        ``ingest.backfill.max_retry_attempts`` (0 = no retries) and
        ``ingest.signals.dedup_window_hours`` (0 = disable the dedup window), which the
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

    async def resolve_secret(self, key: str) -> tuple[str, bool]:
        """Resolve an encrypted config secret (feature 166) via the config GetSecret RPC.

        Propagates this service's internal-caller identity so the config allow-list authorizes the
        read (x-internal-caller: ingest, keyPrefixes grant). Returns (plaintext, found); found=False
        means the key is unset — the caller treats that as degraded, never a crash (AC-5). Mirrors
        the marketdata ResolveSecret shape. RPC errors (e.g. an un-granted key → PERMISSION_DENIED)
        propagate to the caller's per-source guard."""
        resp = await self._stub.GetSecret(
            config_pb2.GetSecretRequest(
                namespace=self.namespace,
                key=key,
                environment=self._environment,
            ),
            metadata=((HEADER_INTERNAL_CALLER, INGEST_INTERNAL_CALLER_ID),),
        )
        return resp.value, resp.found

    # Sandbox config helpers — indicators.sandbox.*
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

    # Backfill config helpers — ingest.backfill.*
    @property
    def backfill_max_concurrent_jobs(self) -> int:
        # get_int (zero-trap intentional): a configured 0 → default 3; 0 would reach
        # asyncio.Semaphore(0) at servicer.py:191 and deadlock. Do NOT switch to get_int_present.
        return self.get_int("ingest.backfill.max_concurrent_jobs", default=3)

    @property
    def backfill_retry_on_failure(self) -> bool:
        return self.get_bool("ingest.backfill.retry_on_failure", default=True)

    @property
    def backfill_max_retry_attempts(self) -> int:
        return self.get_int_present("ingest.backfill.max_retry_attempts", default=3)

    # Chunked-backfill config helpers — ingest.backfill.*
    @property
    def backfill_chunk_max_bars(self) -> int:
        return self.get_int("ingest.backfill.chunk_max_bars", default=200000)

    @property
    def backfill_chunk_window_days(self) -> int:
        return self.get_int("ingest.backfill.chunk_window_days", default=90)

    @property
    def backfill_max_concurrent_chunks(self) -> int:
        # get_int (zero-trap intentional): a configured 0 → default 3; 0 would reach
        # asyncio.Semaphore(0) at servicer.py:519 and deadlock. Do NOT switch to get_int_present.
        return self.get_int("ingest.backfill.max_concurrent_chunks", default=3)

    # Signal dedup config helper — ingest.signals.*
    @property
    def dedup_window_hours(self) -> int:
        return self.get_int_present("ingest.signals.dedup_window_hours", default=24)
