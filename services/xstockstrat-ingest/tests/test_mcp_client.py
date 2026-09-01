"""Unit tests for the mcp_client credential + outbound-auth seam (feature 166, AC-3).

Pure/fake-driven — no live config server and no real MCP endpoint. `resolve_secret` is exercised
against a fake ConfigService stub (built without ConfigWatcher.__init__'s channel/task effects);
the bearer header is asserted via the pure `build_bearer_headers` helper the concrete client uses.
"""

from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2

from app.config.watcher import (
    HEADER_INTERNAL_CALLER,
    INGEST_INTERNAL_CALLER_ID,
    ConfigWatcher,
    split_credentials_ref,
)
from app.mcp_client import build_bearer_headers


class _FakeSecretStub:
    def __init__(self, value: str, found: bool):
        self._value = value
        self._found = found
        self.last_request = None
        self.last_metadata = None

    async def GetSecret(self, request, metadata=None):
        self.last_request = request
        self.last_metadata = metadata
        return config_pb2.GetSecretResponse(value=self._value, found=self._found)


def _watcher_with(stub) -> ConfigWatcher:
    # Bypass __init__ (which opens a channel + starts _watch) — only resolve_secret is under test.
    w = object.__new__(ConfigWatcher)
    w.namespace = "ingest"
    w._environment = common_pb2.ENVIRONMENT_STAGING
    w._stub = stub
    return w


async def test_resolve_secret_sends_internal_caller_and_returns_value():
    stub = _FakeSecretStub("sk-live-abc123", True)
    w = _watcher_with(stub)

    value, found = await w.resolve_secret("mcp_credential.acme-mcp")

    assert (value, found) == ("sk-live-abc123", True)
    # metadata carries x-internal-caller: ingest (so the config allow-list authorizes the read).
    assert (HEADER_INTERNAL_CALLER, INGEST_INTERNAL_CALLER_ID) in list(stub.last_metadata)
    assert stub.last_request.namespace == "ingest"
    assert stub.last_request.key == "mcp_credential.acme-mcp"


async def test_resolve_secret_unset_returns_not_found():
    stub = _FakeSecretStub("", False)
    w = _watcher_with(stub)
    assert await w.resolve_secret("mcp_credential.absent") == ("", False)


def test_bearer_header_is_the_only_auth():
    headers = build_bearer_headers("sk-live-abc123")
    assert headers == {"Authorization": "Bearer sk-live-abc123"}
    # AC-3: no other auth scheme is sent alongside the bearer.
    assert list(headers.keys()) == ["Authorization"]


def test_split_credentials_ref_splits_on_first_dot():
    assert split_credentials_ref("ingest.mcp_credential.acme-mcp") == (
        "ingest",
        "mcp_credential.acme-mcp",
    )
