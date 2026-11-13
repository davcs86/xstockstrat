"""
Config watcher core shared by the Python services (feature 295).
Byte-identical in xstockstrat-{indicators,ingest,analysis}/app/config; edit all three together
(scripts/check-watcher-copies.py fails CI on drift).
"""

import asyncio
import logging
import random
import time

log = logging.getLogger(__name__)

# Fixed invariant (F-07): config cannot configure its own channel, so this is not a config key.
# Matches the servers' keepalive enforcement (30 s / 10 s, pings allowed without a stream).
KEEPALIVE_OPTIONS = [
    ("grpc.keepalive_time_ms", 30000),
    ("grpc.keepalive_timeout_ms", 10000),
    ("grpc.keepalive_permit_without_calls", 1),
]
# Fixed invariant (F-07): a stream silent this long is cancelled and redialled; the config
# server's periodic re-send keeps a healthy stream under it.
LIVENESS_TIMEOUT_S = 30.0
# Fixed invariant (F-07): first reconnect backoff base; doubles per failure up to BACKOFF_MAX_S.
BACKOFF_INITIAL_S = 1.0
# Fixed invariant (F-07): reconnect backoff ceiling.
BACKOFF_MAX_S = 30.0
# Fixed invariant (F-07): the backoff resets only after a stream delivered for at least half the
# liveness timeout, so a snapshot-then-EOF server never resets it (AC-11).
BACKOFF_RESET_AFTER_S = LIVENESS_TIMEOUT_S / 2
# Fixed invariant (F-07): the FR-6 coverage tick that also re-emits config.read_key for every key.
READ_COVERAGE_INTERVAL_S = 21600
# Fixed invariant (F-07): at most one FR-11 WARN per FQN and reason in this window.
WARN_INTERVAL_S = 300.0
# Fixed invariant (F-07): wait_for_snapshot's default bound (config startup readiness).
SNAPSHOT_WAIT_TIMEOUT_S = 90.0

_FIELD_TYPE = {"string_val": "string", "int_val": "int", "float_val": "float", "bool_val": "bool"}


class _RealClock:
    def monotonic(self) -> float:
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)

    async def wait_for(self, aw, timeout: float):
        return await asyncio.wait_for(aw, timeout)


_REAL_CLOCK = _RealClock()


class WatchCore:
    """
    Stream loop, FR-11 typed getters and read-key evidence behind each service's ConfigWatcher.
    The subclass sets namespace, endpoint, _stub, _snapshot, _snapshot_event and supplies
    _build_watch_request(); getters also work on a bare __new__ instance holding only _snapshot.
    """

    @property
    def _clk(self):
        return getattr(self, "_clock", _REAL_CLOCK)

    def _evidence(self) -> dict:
        state = self.__dict__.get("_core_state")
        if state is None:
            state = {"read_keys": set(), "warned_at": {}, "hooks": [], "version": None}
            self.__dict__["_core_state"] = state
        return state

    def _start(self) -> None:
        loop = asyncio.get_event_loop()
        self._watch_task = loop.create_task(self._watch(), name=f"config-watch-{self.namespace}")
        self._watch_task.add_done_callback(self._on_task_done)
        self._coverage_task = loop.create_task(
            self._coverage_loop(), name=f"config-coverage-{self.namespace}"
        )
        self._coverage_task.add_done_callback(self._on_task_done)

    def _on_task_done(self, task) -> None:
        try:
            if task.cancelled():
                return
            log.error(
                "config watch task %s exited unexpectedly: %r", task.get_name(), task.exception()
            )
        except Exception:  # noqa: BLE001 — a done-callback must never raise
            pass

    def on_change(self, callback) -> None:
        """Register callback(version), called after a received snapshot changes the version."""
        self._evidence()["hooks"].append(callback)

    def _apply(self, snapshot) -> None:
        state = self._evidence()
        first = getattr(self, "_snapshot", None) is None
        self._snapshot = snapshot
        self._snapshot_event.set()
        log.debug("config updated namespace=%s version=%s", snapshot.namespace, snapshot.version)
        if first:
            self._log_coverage(reemit=False)
        if snapshot.version == state["version"]:
            return
        state["version"] = snapshot.version
        for hook in list(state["hooks"]):
            try:
                hook(snapshot.version)
            except Exception:  # noqa: BLE001 — a failing hook must not tear the stream down
                log.exception("config on_change callback failed version=%s", snapshot.version)

    async def _watch(self):
        base = BACKOFF_INITIAL_S
        while True:
            healthy = await self._stream_once()
            if healthy >= BACKOFF_RESET_AFTER_S:
                base = BACKOFF_INITIAL_S
            # Equal jitter: a delay in [base/2, base].
            await self._clk.sleep(random.uniform(base / 2, base))
            base = min(base * 2, BACKOFF_MAX_S)

    async def _stream_once(self) -> float:
        """Run one stream until it fails, ends or goes silent; return open-to-last-message time."""
        clk = self._clk
        opened = clk.monotonic()
        healthy = 0.0
        call = None
        try:
            call = self._stub.WatchConfig(self._build_watch_request())
            it = call.__aiter__()
            while True:
                try:
                    snapshot = await clk.wait_for(it.__anext__(), LIVENESS_TIMEOUT_S)
                except StopAsyncIteration:
                    log.warning("config stream ended namespace=%s, reconnecting", self.namespace)
                    break
                healthy = clk.monotonic() - opened
                self._apply(snapshot)
        except TimeoutError:
            log.warning(
                "config stream silent for %ss namespace=%s, redialling",
                LIVENESS_TIMEOUT_S,
                self.namespace,
            )
        except Exception as e:  # noqa: BLE001 — any error reconnects; CancelledError propagates
            log.warning("config stream error (%s): %s, reconnecting", type(e).__name__, e)
        finally:
            if call is not None:
                call.cancel()
        return healthy

    async def wait_for_snapshot(self, timeout_seconds: float = SNAPSHOT_WAIT_TIMEOUT_S):
        try:
            await asyncio.wait_for(self._snapshot_event.wait(), timeout=timeout_seconds)
        except TimeoutError:
            raise RuntimeError(
                f"Timed out waiting for config snapshot from {self.endpoint} "
                f"namespace={self.namespace}"
            )

    async def _coverage_loop(self):
        while True:
            await self._clk.sleep(READ_COVERAGE_INTERVAL_S)
            self._log_coverage(reemit=True)

    def _log_coverage(self, reemit: bool) -> None:
        ns = getattr(self, "namespace", "")
        keys = sorted(self._evidence()["read_keys"])
        log.info("config.read_coverage ns=%s keys=%d", ns, len(keys))
        if reemit:
            for key in keys:
                log.info("config.read_key ns=%s key=%s", ns, key)

    def _fqn(self, key: str) -> str:
        ns = getattr(self, "namespace", "")
        return key if not ns or key.startswith(ns + ".") else f"{ns}.{key}"

    def _warn(self, key: str, reason: str) -> None:
        fqn = self._fqn(key)
        now = self._clk.monotonic()
        warned_at = self._evidence()["warned_at"]
        last = warned_at.get((fqn, reason))
        if last is not None and now - last < WARN_INTERVAL_S:
            return
        warned_at[(fqn, reason)] = now
        log.warning("config value %s %s; using the code default", fqn, reason)

    def _lookup(self, key: str):
        read_keys = self._evidence()["read_keys"]
        if key not in read_keys:
            read_keys.add(key)
            log.info("config.read_key ns=%s key=%s", getattr(self, "namespace", ""), key)
        snapshot = getattr(self, "_snapshot", None)
        if snapshot is None:
            return None
        value = snapshot.values.get(key)
        if value is None:
            self._warn(key, "absent from the received snapshot")
        return value

    def _typed(self, key: str, default, field: str):
        value = self._lookup(key)
        if value is None:
            return default
        if value.HasField(field):
            return getattr(value, field)
        if field == "float_val" and value.HasField("int_val"):
            return float(value.int_val)
        stored = _FIELD_TYPE.get(value.WhichOneof("value"), "unset")
        self._warn(key, f"type mismatch (want {_FIELD_TYPE[field]}, stored {stored})")
        return default

    def get_str(self, key: str, default: str = "") -> str:
        return self._typed(key, default, "string_val")

    def get_int(self, key: str, default: int = 0) -> int:
        return self._typed(key, default, "int_val")

    def get_bool(self, key: str, default: bool = False) -> bool:
        return self._typed(key, default, "bool_val")

    def get_float(self, key: str, default: float = 0.0) -> float:
        return self._typed(key, default, "float_val")
