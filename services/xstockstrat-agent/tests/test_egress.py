"""Unit tests for the SSRF egress validators (feature 207).

Pure functions — no network, no async. Deny/allow ranges, scheme allowlist, IPv4-mapped/NAT64/CGNAT
edge cases (asserted regardless of interpreter version), and the FR-6 no-leak guarantee.
"""

import pytest

from app.egress import EgressBlocked, assert_allowed_scheme, assert_public_ip

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
