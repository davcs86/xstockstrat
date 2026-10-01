"""Mutual-TLS transport credentials for inter-service gRPC (feature 210).

Cert material is read from boot-time env PEM strings (MTLS_CERT / MTLS_KEY / MTLS_CA_CERT), never
over WatchConfig. Absent material raises at import/call (fail-closed — the server/client must not
start without it). Clients pin the verified server authority to the TARGET SERVICE NAME (never the
dialed host) via grpc.ssl_target_name_override, so verification is env-independent across
docker-compose (bare service name) and DO App Platform (PRIVATE_DOMAIN FQDN). Dialing
xstockstrat-<svc>:<port> already presents xstockstrat-<svc> as the authority, so the override makes
the match explicit and correct regardless of env. See docs/patterns/inter-service-mtls.md.
"""

import os

import grpc


def _load() -> tuple[bytes, bytes, bytes]:
    cert = os.environ.get("MTLS_CERT", "")
    key = os.environ.get("MTLS_KEY", "")
    ca = os.environ.get("MTLS_CA_CERT", "")
    if not cert or not key or not ca:
        raise RuntimeError(
            "mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)"
        )
    return key.encode(), cert.encode(), ca.encode()


def server_credentials() -> grpc.ServerCredentials:
    """Require and verify the client cert chains to the platform CA (mutual TLS)."""
    key, cert, ca = _load()
    return grpc.ssl_server_credentials(
        [(key, cert)], root_certificates=ca, require_client_auth=True
    )


def channel_credentials() -> grpc.ChannelCredentials:
    """Present this service's leaf and verify the server cert chains to the platform CA."""
    key, cert, ca = _load()
    return grpc.ssl_channel_credentials(
        root_certificates=ca, private_key=key, certificate_chain=cert
    )


def target_override(target_service: str) -> list[tuple[str, str]]:
    """Channel options pinning the verified server authority to target_service (env-independent)."""
    return [("grpc.ssl_target_name_override", target_service)]
