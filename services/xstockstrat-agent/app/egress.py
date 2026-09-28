"""SSRF egress controls for the agent's outbound content-extraction fetches (feature 207).

Pure, dependency-light validators plus a DNS-rebind-safe pinning httpx transport (added in a later
step). ``EgressBlocked`` is opaque by design — it never carries the offending host/IP/port, so a
blocked fetch cannot enumerate internal targets back to the model (FR-6).
"""

from __future__ import annotations

import ipaddress
import socket
import typing

import anyio
import httpcore
import httpx

_ALLOWED_SCHEMES = frozenset({"http", "https"})
# Cloud-provider metadata endpoint — already covered by link-local / not-is_global,
# kept as an explicit fail-closed guard.
_METADATA_V4 = ipaddress.ip_address("169.254.169.254")


class EgressBlocked(Exception):
    """An egress target was refused by policy.

    Opaque on purpose: the message must never interpolate the offending IP/host/port (FR-6).
    """

    def __init__(self, message: str = "egress blocked") -> None:
        super().__init__(message)


def assert_allowed_scheme(scheme: str) -> None:
    """Permit only http/https; anything else fails closed (FR-3). No scheme echoed."""
    if (scheme or "").lower() not in _ALLOWED_SCHEMES:
        raise EgressBlocked("scheme not allowed")


def assert_public_ip(ip_str: str) -> None:
    """Raise EgressBlocked unless ``ip_str`` is a globally-routable public address (FR-1/FR-2).

    Fail-closed: an unparseable address is rejected. IPv4-mapped IPv6 addresses are unwrapped so
    the checks run against the real IPv4 regardless of interpreter ``is_global`` semantics.
    """
    try:
        ip: ipaddress._BaseAddress = ipaddress.ip_address(ip_str)
    except ValueError:
        raise EgressBlocked("invalid address") from None

    # Unwrap IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254 / ::ffff:127.0.0.1).
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped

    # Primary gate: deny anything not globally routable. Closes the CGNAT 100.64.0.0/10 hole that
    # ``is_private`` leaves open, and auto-covers future special-purpose ranges.
    if not ip.is_global:
        raise EgressBlocked("non-public address")

    # Defense-in-depth: explicit range checks guard against pre-3.12.4 is_global drift.
    if (
        ip.is_loopback
        or ip.is_link_local
        or ip.is_unspecified
        or ip.is_reserved
        or ip.is_private
        or ip.is_multicast
        or ip == _METADATA_V4
    ):
        raise EgressBlocked("non-public address")


class PinnedValidatingBackend(httpcore.AsyncNetworkBackend):
    """httpcore network backend that resolves + validates every candidate address and connects only
    to a pinned, validated public IP — closing the DNS-rebinding TOCTOU window (FR-2).

    ``connect_tcp`` fires on every connection, including each redirect hop, so per-hop IP validation
    is automatic. TLS SNI is unaffected: httpcore applies ``start_tls(server_hostname=...)`` on the
    stream separately, using the original request hostname, so pinning the TCP IP does not weaken
    certificate verification. The real connect is delegated to a held ``AnyIOBackend`` — the
    concrete backend ``AutoBackend`` picks under asyncio, and (unlike ``AutoBackend``) a public
    httpcore symbol.
    """

    def __init__(self) -> None:
        self._auto = httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: typing.Iterable[typing.Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        # Resolve off the event loop — a blocking getaddrinfo here would stall the whole MCP loop.
        infos = await anyio.to_thread.run_sync(
            lambda: socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        )
        ips = [info[4][0] for info in infos]
        if not ips:
            raise EgressBlocked("unresolvable host")
        # Reject-if-any: a mixed public/private answer is itself the rebind signal — never filter.
        for ip in ips:
            assert_public_ip(ip)
        # Connect to the pinned validated IP literal, never the (re-resolvable) hostname.
        return await self._auto.connect_tcp(
            host=ips[0],
            port=port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: typing.Iterable[typing.Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        # No unix-socket egress from the extract fetch path.
        raise EgressBlocked("unix socket egress not permitted")


class PinningTransport(httpx.AsyncHTTPTransport):
    """httpx transport whose httpcore pool uses the SSRF-validating pinning backend.

    Swaps the network backend on the pool httpx already configured (preserving its ssl_context /
    http2 / connection limits) and fails closed if the pin is ever silently absent.
    """

    def __init__(self, *args: typing.Any, **kwargs: typing.Any) -> None:
        super().__init__(*args, **kwargs)
        self._pinned_backend = PinnedValidatingBackend()
        # Swap the backend on httpx's already-built pool; it is read at connection-creation time and
        # no connection exists yet, so this takes effect for every request.
        self._pool._network_backend = self._pinned_backend
        # Fail closed (not `assert`, which -O strips): refuse to start if the pin is not installed.
        if self._pool._network_backend is not self._pinned_backend:
            raise EgressBlocked("egress pin not installed")


def build_pinned_client(*, connect_timeout: float, read_timeout: float) -> httpx.AsyncClient:
    """An ``httpx.AsyncClient`` that pins every connection to a validated public IP.

    ``follow_redirects`` is False by design — the caller owns a bounded redirect loop that
    re-validates scheme per hop and strips cross-origin credentials (FR-3/FR-4).
    """
    return httpx.AsyncClient(
        transport=PinningTransport(),
        timeout=httpx.Timeout(read_timeout, connect=connect_timeout),
        follow_redirects=False,
    )
