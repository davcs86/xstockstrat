"""SSRF egress controls for the agent's outbound content-extraction fetches (feature 207).

Pure, dependency-light validators plus a DNS-rebind-safe pinning httpx transport (added in a later
step). ``EgressBlocked`` is opaque by design — it never carries the offending host/IP/port, so a
blocked fetch cannot enumerate internal targets back to the model (FR-6).
"""

from __future__ import annotations

import ipaddress

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
