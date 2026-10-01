"""Mutual-TLS secure-channel factory for the MCP agent's outbound gRPC dials (feature 210).

The agent is a gRPC CLIENT only (no backend server), so it needs just a channel factory. Cert
material is read from boot-time env PEM strings (MTLS_CERT / MTLS_KEY / MTLS_CA_CERT); absent
material raises (fail-closed — the agent must not dial a backend without presenting its leaf). The
verified server authority is pinned to the TARGET SERVICE NAME (never the dialed host) via
grpc.ssl_target_name_override, so verification is env-independent across docker-compose (bare
service name) and DO App Platform (PRIVATE_DOMAIN FQDN). This is the single DRY unit replacing the
agent's 69 inline insecure_channel sites. See docs/patterns/inter-service-mtls.md.
"""

import os

import grpc
import grpc.aio


def _load() -> tuple[bytes, bytes, bytes]:
    cert = os.environ.get("MTLS_CERT", "")
    key = os.environ.get("MTLS_KEY", "")
    ca = os.environ.get("MTLS_CA_CERT", "")
    if not cert or not key or not ca:
        raise RuntimeError(
            "mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)"
        )
    return key.encode(), cert.encode(), ca.encode()


def channel_credentials() -> grpc.ChannelCredentials:
    """Present the agent leaf and verify the server cert chains to the platform CA."""
    key, cert, ca = _load()
    return grpc.ssl_channel_credentials(
        root_certificates=ca, private_key=key, certificate_chain=cert
    )


def secure_channel(endpoint: str, target_service: str) -> grpc.aio.Channel:
    """Dial endpoint over mutual TLS, pinning the verified server authority to target_service."""
    return grpc.aio.secure_channel(
        endpoint,
        channel_credentials(),
        options=[("grpc.ssl_target_name_override", target_service)],
    )
