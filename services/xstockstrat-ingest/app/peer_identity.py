"""mTLS peer identity: does the verified client certificate carry an exact SAN entry?"""

_SAN_KEY = "x509_subject_alternative_name"


def peer_san_matches(context, expected: str) -> bool:
    """True only when the grpc.aio peer's verified SAN list contains ``expected`` exactly.

    Fails closed on a non-TLS transport, a missing key, or a non-iterable (mock) result.
    """
    try:
        if context.peer_identity_key() != _SAN_KEY:
            return False
        return expected.encode() in list(context.peer_identities())
    except Exception:
        return False
