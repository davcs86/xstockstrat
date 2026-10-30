"""mTLS listener: client certificates are required, and only SANs in ALLOWED_SANS reach the app."""

import json
import os
import pathlib
import ssl
import tempfile

import uvicorn
from uvicorn.protocols.http.h11_impl import H11Protocol

ALLOWED_SANS = frozenset({"xstockstrat-agent", "xstockstrat-smoke-trigger"})
PEER_SAN: dict[tuple[str, int], str | None] = {}


class SanHookMissing(RuntimeError):
    pass


class SanProtocol(H11Protocol):
    # Subclasses a uvicorn-internal class: uvicorn is pinned ==0.47.0 and the hook-bypass test
    # (test_san_hook_not_installed_is_fatal) must pass before any upgrade.
    def connection_made(self, transport):
        super().connection_made(transport)
        ssl_object = transport.get_extra_info("ssl_object")
        cert = ssl_object.getpeercert() if ssl_object else None
        sans = {v for k, v in (cert or {}).get("subjectAltName", ()) if k == "DNS"}
        allowed = sorted(sans & ALLOWED_SANS)
        self._peer_key = self.client
        if self.client is not None:
            PEER_SAN[self.client] = allowed[0] if allowed else None

    def connection_lost(self, exc):
        PEER_SAN.pop(getattr(self, "_peer_key", None), None)
        super().connection_lost(exc)


def build_ssl_context(cert_pem: str, key_pem: str, ca_pem: str) -> ssl.SSLContext:
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH, cadata=ca_pem)
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="smoke-tls-"))
    cert_path, key_path = tmp / "cert.pem", tmp / "key.pem"
    try:
        for path, pem in ((cert_path, cert_pem), (key_path, key_pem)):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(pem)
        ctx.load_cert_chain(cert_path, key_path)
    finally:
        cert_path.unlink(missing_ok=True)
        key_path.unlink(missing_ok=True)
        tmp.rmdir()
    return ctx


def san_gate(app):
    async def gated(scope, receive, send):
        if scope["type"] == "lifespan":
            return await app(scope, receive, send)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["type"] != "http":
            return
        client = scope.get("client")
        san = PEER_SAN.get(tuple(client)) if client else None
        if san is None:
            body = json.dumps({"error": "forbidden"}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        await app(dict(scope, peer_san=san), receive, send)

    return gated


def assert_san_hook(config: uvicorn.Config) -> None:
    if not issubclass(config.http_protocol_class, SanProtocol):
        raise SanHookMissing(
            f"SAN hook not installed: uvicorn http protocol is "
            f"{config.http_protocol_class.__name__}, expected SanProtocol"
        )


def make_server(app, ssl_ctx, *, host: str, port: int, http=SanProtocol) -> uvicorn.Server:
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        http=http,
        ssl_context_factory=lambda _config, _default: ssl_ctx,
        lifespan="off",
        log_level="info",
    )
    config.load()
    assert_san_hook(config)
    return uvicorn.Server(config)
