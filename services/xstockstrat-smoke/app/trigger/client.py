"""mTLS client for the smoke API: stdlib only, server name pinned to xstockstrat-smoke."""

import http.client
import json
import os
import ssl
import tempfile
import time

SERVER_NAME = "xstockstrat-smoke"
RUN_LOCK_HOLD_S = 900
CLEANUP_GRACE_MAX_S = 60
RUN_WAIT_S = RUN_LOCK_HOLD_S + CLEANUP_GRACE_MAX_S
POLL_S = 2.0


class TriggerError(Exception):
    pass


class RunLost(Exception):
    pass


def build_context(cert_pem: str, key_pem: str, ca_pem: str) -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.load_verify_locations(cadata=ca_pem)
    paths = []
    try:
        for pem in (cert_pem, key_pem):
            fd, path = tempfile.mkstemp()
            paths.append(path)
            with os.fdopen(fd, "w") as f:
                f.write(pem)
        ctx.load_cert_chain(*paths)
    finally:
        for path in paths:
            os.unlink(path)
    return ctx


class _PinnedConnection(http.client.HTTPSConnection):
    def connect(self):
        http.client.HTTPConnection.connect(self)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=SERVER_NAME)


class Client:
    def __init__(self, endpoint, *, cert_pem, key_pem, ca_pem, sleep=time.sleep, poll_s=POLL_S):
        self._host, _, port = endpoint.rpartition(":")
        self._port = int(port)
        self._ctx = build_context(cert_pem, key_pem, ca_pem)
        self._sleep = sleep
        self._poll_s = poll_s

    def _request(self, method, path, body=None):
        conn = _PinnedConnection(self._host, self._port, context=self._ctx, timeout=30)
        try:
            payload = json.dumps(body).encode() if body is not None else None
            headers = {"Content-Type": "application/json"} if payload else {}
            conn.request(method, path, body=payload, headers=headers)
            resp = conn.getresponse()
            raw = resp.read()
            retry_after = resp.getheader("Retry-After")
        finally:
            conn.close()
        try:
            data = json.loads(raw) if raw else None
        except ValueError:
            data = None
        return resp.status, retry_after, data

    def checks(self) -> list[dict]:
        status, _, data = self._request("GET", "/checks")
        if status != 200 or not isinstance(data, dict):
            raise TriggerError(f"GET /checks returned {status}")
        return data["checks"]

    def start_run(self, ids: list[str]) -> str:
        deadline = time.monotonic() + RUN_WAIT_S
        while True:
            status, retry_after, data = self._request("POST", "/runs", {"checks": ids})
            if status == 202:
                return data["run_id"]
            if status != 409 or time.monotonic() >= deadline:
                raise TriggerError(f"POST /runs returned {status}: {data}")
            try:
                wait = min(int(retry_after), RUN_WAIT_S)
            except (TypeError, ValueError):
                wait = 1
            self._sleep(wait)

    def wait_for_run(self, run_id: str) -> dict:
        deadline = time.monotonic() + RUN_WAIT_S
        while True:
            try:
                status, _, data = self._request("GET", f"/runs/{run_id}")
            except (OSError, http.client.HTTPException) as e:
                raise RunLost(f"{run_id}: connection lost: {e}") from e
            if status == 404:
                raise RunLost(f"{run_id}: unknown to the service (restarted?)")
            if status != 200 or not isinstance(data, dict):
                raise TriggerError(f"GET /runs/{run_id} returned {status}")
            if data.get("status") == "done":
                return data["file"]["body"]
            if time.monotonic() >= deadline:
                raise TriggerError(f"{run_id}: not done within {RUN_WAIT_S}s")
            self._sleep(self._poll_s)
