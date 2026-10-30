"""Fail-closed gRPC mTLS credentials from the MTLS_* env PEMs (docs/patterns/inter-service-mtls.md).
Clients pin the server authority to the target service name, never the dialed host."""

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


def channel_credentials() -> grpc.ChannelCredentials:
    key, cert, ca = _load()
    return grpc.ssl_channel_credentials(
        root_certificates=ca, private_key=key, certificate_chain=cert
    )


def target_override(target_service: str) -> list[tuple[str, str]]:
    return [("grpc.ssl_target_name_override", target_service)]
