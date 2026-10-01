"""Unit tests for the SSRF egress validators + pinning transport (feature 207).

Pure validators: deny/allow ranges, scheme allowlist, IPv4-mapped/NAT64/CGNAT edge cases (asserted
regardless of interpreter version), and the FR-6 no-leak guarantee. Transport: DNS-rebind
fail-closed, reject-if-any mixed resolution, pinned-IP connect, construction-time pin identity
assertion, and the resolver-off-loop regression guard (AC-3). respx bypasses a custom transport, so
these monkeypatch the resolver / held inner backend directly rather than using respx (respx stays
for the Step 6 happy path).
"""

import socket
from unittest.mock import AsyncMock

import anyio
import httpcore
import pytest

import app.egress as egress_mod
from app.egress import (
    EgressBlocked,
    PinnedValidatingBackend,
    PinningTransport,
    assert_allowed_scheme,
    assert_public_ip,
)


def _addrinfo(*ips, port=443):
    """Build getaddrinfo-shaped 5-tuples (family, type, proto, canonname, sockaddr) for ``ips``."""
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in ips]


# Non-public / internal addresses that MUST be rejected.
DENY_IPS = [
    "169.254.169.254",  # AC-1 cloud metadata
    "10.0.0.5",  # AC-2 RFC1918
    "172.16.0.1",  # AC-2 RFC1918
    "192.168.1.1",  # AC-2 RFC1918
    "127.0.0.1",  # AC-2 loopback
    "::1",  # loopback (v6)
    "169.254.10.10",  # link-local
    "fe80::1",  # link-local (v6)
    "fc00::1",  # unique-local (ULA)
    "0.0.0.0",  # unspecified
    "::",  # unspecified (v6)
    "::ffff:169.254.169.254",  # IPv4-mapped metadata
    "::ffff:127.0.0.1",  # IPv4-mapped loopback
    "64:ff9b::7f00:1",  # NAT64 embedding 127.0.0.1
    "100.64.0.1",  # CGNAT / RFC6598 — the is_private fail-open the not-is_global gate closes
]

# Globally-routable public addresses that MUST pass.
ALLOW_IPS = [
    "93.184.216.34",  # example.com
    "8.8.8.8",
    "2606:2800:220:1:248:1893:25c8:1946",  # public IPv6
]


@pytest.mark.parametrize("ip", DENY_IPS)
def test_assert_public_ip_denies_non_public(ip):
    with pytest.raises(EgressBlocked):
        assert_public_ip(ip)


@pytest.mark.parametrize("ip", ALLOW_IPS)
def test_assert_public_ip_allows_public(ip):
    assert_public_ip(ip)  # must not raise


def test_assert_public_ip_denies_malformed():
    with pytest.raises(EgressBlocked):
        assert_public_ip("not-an-ip")


@pytest.mark.parametrize("scheme", ["http", "https", "HTTP", "HTTPS"])
def test_assert_allowed_scheme_allows_http(scheme):
    assert_allowed_scheme(scheme)  # must not raise


@pytest.mark.parametrize("scheme", ["file", "gopher", "ftp", "data", "dict", ""])
def test_assert_allowed_scheme_denies_other(scheme):
    with pytest.raises(EgressBlocked):
        assert_allowed_scheme(scheme)


def test_egress_blocked_does_not_leak_address():
    """FR-6: the raised error must not echo the offending address."""
    with pytest.raises(EgressBlocked) as exc:
        assert_public_ip("10.0.0.5")
    assert "10.0.0.5" not in str(exc.value)


# --- Pinning transport: DNS-rebind, reject-if-any, pinned-IP, identity, off-loop (AC-3) ---


@pytest.mark.asyncio
async def test_rebind_public_name_internal_record_is_blocked(monkeypatch):
    """AC-3: a public hostname that resolves to an internal A record is refused, and the real
    connect never fires — no packet reaches 10.1.2.3."""
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: _addrinfo("10.1.2.3"))
    backend = PinnedValidatingBackend()
    inner = AsyncMock()
    backend._auto.connect_tcp = inner  # patch the held inner backend's connect
    with pytest.raises(EgressBlocked):
        await backend.connect_tcp("evil.example.com", 443)
    inner.assert_not_called()


@pytest.mark.asyncio
async def test_reject_if_any_mixed_resolution_is_blocked(monkeypatch):
    """A resolution mixing one public + one private answer is the rebind signal: reject wholesale,
    never filter to the good one, and never connect."""
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *a, **k: _addrinfo("93.184.216.34", "10.0.0.9")
    )
    backend = PinnedValidatingBackend()
    inner = AsyncMock()
    backend._auto.connect_tcp = inner
    with pytest.raises(EgressBlocked):
        await backend.connect_tcp("mixed.example.com", 443)
    inner.assert_not_called()


@pytest.mark.asyncio
async def test_connect_targets_pinned_validated_ip_literal(monkeypatch):
    """AC-3 (second clause): the connection targets the validated IP literal, not the re-resolvable
    hostname — the pin closes the TOCTOU window between validation and connect."""
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: _addrinfo("93.184.216.34"))
    backend = PinnedValidatingBackend()
    inner = AsyncMock(return_value=object())
    backend._auto.connect_tcp = inner
    await backend.connect_tcp("good.example.com", 443)
    inner.assert_awaited_once()
    assert inner.await_args.kwargs["host"] == "93.184.216.34"
    assert inner.await_args.kwargs["port"] == 443


def test_transport_construction_asserts_pin_identity():
    """The pin is asserted on held-instance identity at construction, so a pin-absent pool cannot
    slip through: a fresh unpinned pool's backend is NOT the validating backend."""
    t = PinningTransport()
    assert t._pool._network_backend is t._pinned_backend
    assert isinstance(t._pinned_backend, PinnedValidatingBackend)
    # A fresh, unpinned pool would fail the same identity check — proving it discriminates.
    unpinned = httpcore.AsyncConnectionPool()
    assert unpinned._network_backend is not t._pinned_backend


@pytest.mark.asyncio
async def test_resolver_runs_off_the_event_loop(monkeypatch):
    """Regression guard (design round-2 DoS finding): the blocking getaddrinfo is dispatched via
    anyio.to_thread.run_sync, never called inline on the event loop."""
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: _addrinfo("93.184.216.34"))
    real_run_sync = anyio.to_thread.run_sync
    seen = []

    async def spy(func, *args, **kwargs):
        seen.append(func)
        return await real_run_sync(func, *args, **kwargs)

    monkeypatch.setattr(egress_mod.anyio.to_thread, "run_sync", spy)
    backend = PinnedValidatingBackend()
    backend._auto.connect_tcp = AsyncMock(return_value=object())
    await backend.connect_tcp("good.example.com", 443)
    assert seen, "resolver was not dispatched through anyio.to_thread.run_sync"
